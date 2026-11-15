import { Client, type ClientChannel } from "ssh2";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { commands, parseSessions } from "./screen";
import type { Event, Server } from "./shared";
type Connection = { client: Client; ready: boolean };
export class SSH {
  private connections = new Map<string, Connection>();
  private terminals = new Map<
    string,
    { serverId: string; channel: ClientChannel }
  >();
  constructor(
    private emit: (e: Event) => void,
    private verify: (server: Server, fp: string) => Promise<boolean>,
  ) {}
  async connect(server: Server, secret?: string) {
    if (this.connections.has(server.id))
      throw new Error("连接已存在，请先断开");
    const privateKey =
      server.auth === "key" ? await readFile(server.keyPath) : undefined;
    const client = new Client();
    const connection = { client, ready: false };
    this.connections.set(server.id, connection);
    this.emit({ type: "status", serverId: server.id, status: "connecting" });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };
      client.on("ready", () => {
        connection.ready = true;
        settled = true;
        this.emit({ type: "status", serverId: server.id, status: "connected" });
        resolve();
      });
      client.on("error", (err) => {
        fail(new Error(`SSH 连接失败：${err.message}`));
        client.end();
      });
      client.on("close", () => {
        if (this.connections.get(server.id) === connection) {
          this.connections.delete(server.id);
          this.emit({
            type: "status",
            serverId: server.id,
            status: "disconnected",
          });
        }
        fail(new Error("SSH 连接已关闭"));
      });
      try {
        client.connect({
          host: server.host,
          port: server.port,
          username: server.username,
          password: server.auth === "password" ? secret : undefined,
          privateKey,
          passphrase: server.auth === "key" ? secret : undefined,
          readyTimeout: 60000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => {
            const fp =
              "SHA256:" +
              createHash("sha256")
                .update(key)
                .digest("base64")
                .replace(/=+$/, "");
            void this.verify(server, fp).then(callback, () => callback(false));
          },
        });
      } catch (e) {
        this.connections.delete(server.id);
        this.emit({
          type: "status",
          serverId: server.id,
          status: "disconnected",
        });
        fail(e as Error);
      }
    });
  }
  private client(id: string) {
    const c = this.connections.get(id);
    if (!c?.ready) throw new Error("服务器尚未连接");
    return c.client;
  }
  disconnect(id: string) {
    for (const [tid, t] of this.terminals)
      if (t.serverId === id) this.close(id, tid);
    const c = this.connections.get(id);
    this.connections.delete(id);
    c?.client.end();
    this.emit({ type: "status", serverId: id, status: "disconnected" });
  }
  dispose() {
    for (const id of this.connections.keys()) this.disconnect(id);
  }
  exec(
    id: string,
    command: string,
  ): Promise<{ code: number; out: string; err: string }> {
    const client = this.client(id);
    return new Promise((resolve, reject) => {
      let stream: ClientChannel | undefined;
      let out = "",
        err = "";
      const timer = setTimeout(() => {
        stream?.close();
        reject(new Error("远程命令执行超时"));
      }, 15000);
      client.exec(command, (error, channel) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        stream = channel;
        const stdout = new StringDecoder("utf8"),
          stderr = new StringDecoder("utf8");
        channel.on("data", (b: Buffer) => {
          out += stdout.write(b);
          if (out.length > 1048576) {
            channel.close();
            clearTimeout(timer);
            reject(new Error("远程输出过大"));
          }
        });
        channel.stderr.on("data", (b: Buffer) => {
          err += stderr.write(b);
          if (err.length > 1048576) {
            channel.close();
            clearTimeout(timer);
            reject(new Error("远程错误输出过大"));
          }
        });
        channel.on("error", (e: Error) => {
          clearTimeout(timer);
          reject(e);
        });
        channel.on("close", (code: number) => {
          clearTimeout(timer);
          resolve({
            code: code ?? -1,
            out: out + stdout.end(),
            err: err + stderr.end(),
          });
        });
      });
    });
  }
  async checked(id: string, command: string) {
    const r = await this.exec(id, command);
    if (r.code !== 0)
      throw new Error(
        r.err.trim() || r.out.trim() || `远程命令失败 (${r.code})`,
      );
    return r.out;
  }
  async sessions(id: string) {
    const check = await this.exec(id, commands.check);
    if (check.code !== 0)
      throw new Error(
        "远程服务器未安装 screen 或当前用户无法访问，请在服务器上检查安装与 PATH。",
      );
    const r = await this.exec(id, commands.list);
    const parsed = parseSessions(r.out);
    if (parsed.length) return parsed;
    if (/No Sockets found/i.test(r.out + r.err)) return [];
    throw new Error(r.err.trim() || r.out.trim() || "无法读取 Screen 会话列表");
  }
  async create(id: string, name: string) {
    if ((await this.sessions(id)).some((s) => s.name === name))
      throw new Error("同名会话已存在");
    await this.checked(id, commands.create(name));
    const s = (await this.sessions(id)).find((s) => s.name === name);
    if (!s) throw new Error("会话未能启动或已立即退出");
    return s;
  }
  async assertSession(id: string, sessionId: string) {
    const s = (await this.sessions(id)).find((s) => s.id === sessionId);
    if (!s) throw new Error("会话已不存在，请刷新");
    return s;
  }
  async rename(id: string, sessionId: string, name: string) {
    await this.assertSession(id, sessionId);
    if (
      (await this.sessions(id)).some(
        (s) => s.name === name && s.id !== sessionId,
      )
    )
      throw new Error("同名会话已存在");
    await this.checked(id, commands.rename(sessionId, name));
  }
  async end(id: string, sessionId: string) {
    await this.assertSession(id, sessionId);
    await this.checked(id, commands.end(sessionId));
  }
  async attach(
    id: string,
    sessionId: string,
    terminalId: string,
    takeover: boolean,
    cols: number,
    rows: number,
  ) {
    if (this.terminals.has(terminalId)) throw new Error("终端标识已存在");
    const s = await this.assertSession(id, sessionId);
    if (s.state === "Attached" && !takeover)
      throw new Error("会话正在使用，请确认接管");
    if (s.state !== "Attached" && s.state !== "Detached")
      throw new Error("该会话不可接入");
    await new Promise<void>((resolve, reject) =>
      this.client(id).exec(
        commands.attach(sessionId, takeover),
        { pty: { term: "xterm-256color", cols, rows, width: 0, height: 0 } },
        (err, channel) => {
          if (err) {
            reject(err);
            return;
          }
          this.terminals.set(terminalId, { serverId: id, channel });
          const decoder = new StringDecoder("utf8");
          channel.on("data", (b: Buffer) =>
            this.emit({
              type: "data",
              serverId: id,
              terminalId,
              data: decoder.write(b),
            }),
          );
          channel.stderr.on("data", (b: Buffer) =>
            this.emit({
              type: "data",
              serverId: id,
              terminalId,
              data: b.toString("utf8"),
            }),
          );
          channel.on("error", () => channel.close());
          channel.on("close", () => {
            const tail = decoder.end();
            if (tail)
              this.emit({ type: "data", serverId: id, terminalId, data: tail });
            this.terminals.delete(terminalId);
            this.emit({ type: "closed", serverId: id, terminalId });
          });
          resolve();
        },
      ),
    );
  }
  private terminal(id: string, tid: string) {
    const t = this.terminals.get(tid);
    if (!t || t.serverId !== id) throw new Error("终端已断开");
    return t.channel;
  }
  input(id: string, tid: string, data: string) {
    this.terminal(id, tid).write(data);
  }
  resize(id: string, tid: string, cols: number, rows: number) {
    this.terminal(id, tid).setWindow(rows, cols, 0, 0);
  }
  close(id: string, tid: string) {
    const t = this.terminals.get(tid);
    if (!t) return;
    if (t.serverId !== id) throw new Error("终端不属于此服务器");
    t.channel.close();
    this.terminals.delete(tid);
  }
}
