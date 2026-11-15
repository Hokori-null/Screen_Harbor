import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server as SSHServer, type Connection } from "ssh2";
import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { SSH } from "../src/ssh";
import type { Event, Server } from "../src/shared";

// A local SSH protocol fixture, not a real GNU Screen installation.
const hostKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
}).privateKey;
const sockets = new Set<Connection>();
let remote: SSHServer, port: number;
beforeAll(async () => {
  remote = new SSHServer({ hostKeys: [hostKey] }, (client) => {
    sockets.add(client);
    client.on("error", () => {});
    client.on("close", () => sockets.delete(client));
    client.on("authentication", (ctx) => {
      if (
        ctx.method === "password" &&
        ctx.username === "tester" &&
        ctx.password === "correct"
      )
        ctx.accept();
      else ctx.reject();
    });
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("pty", (accept) => accept?.());
        session.on("window-change", (accept) => accept?.());
        session.on("exec", (accept, _reject, info) => {
          const stream = accept();
          if (info.command === "command -v screen >/dev/null 2>&1") {
            stream.exit(0);
            stream.end();
          } else if (info.command === "LC_ALL=C screen -ls") {
            stream.write(
              "There is a screen on:\n\t123.work\t(Detached)\n1 Socket in /run/screen/S-tester.\n",
            );
            stream.exit(0);
            stream.end();
          } else if (info.command === "screen -r '123.work'") {
            stream.write("ready> ");
            stream.on("data", (data: Buffer) => stream.write(data));
          } else {
            stream.stderr.write("unsupported command");
            stream.exit(1);
            stream.end();
          }
        });
      }),
    );
  });
  await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
  port = (remote.address() as AddressInfo).port;
});
afterAll(async () => {
  for (const s of sockets) s.end();
  await new Promise<void>((resolve) => remote.close(() => resolve()));
});
const server = (id: string): Server => ({
  id,
  name: "Fixture",
  host: "127.0.0.1",
  port,
  username: "tester",
  auth: "password",
  keyPath: "",
  remember: false,
});
const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Fixture event timeout");
};
describe("SSH transport with local protocol fixture", () => {
  it("verifies the host, isolates terminals, streams Unicode, and preserves other connections", async () => {
    const events: Event[] = [];
    const fingerprints: string[] = [];
    const ssh = new SSH(
      (e) => events.push(e),
      async (_s, fp) => {
        fingerprints.push(fp);
        return true;
      },
    );
    try {
      await ssh.connect(server("a"), "correct");
      await ssh.connect(server("b"), "correct");
      expect(fingerprints[0]).toMatch(/^SHA256:/);
      expect(fingerprints[0]).toBe(fingerprints[1]);
      expect(await ssh.sessions("a")).toEqual([
        { id: "123.work", name: "work", state: "Detached" },
      ]);
      await ssh.attach("a", "123.work", "terminal-a", false, 80, 24);
      await ssh.attach("b", "123.work", "terminal-b", false, 80, 24);
      expect(() => ssh.input("b", "terminal-a", "leak")).toThrow("终端已断开");
      ssh.input("a", "terminal-a", "你好");
      ssh.resize("a", "terminal-a", 120, 30);
      await until(() =>
        events.some(
          (e) =>
            e.type === "data" &&
            e.terminalId === "terminal-a" &&
            e.data?.includes("你好"),
        ),
      );
      expect(
        events.some(
          (e) =>
            e.type === "data" &&
            e.terminalId === "terminal-b" &&
            e.data?.includes("你好"),
        ),
      ).toBe(false);
      ssh.close("a", "terminal-a");
      await until(() =>
        events.some(
          (e) => e.type === "closed" && e.terminalId === "terminal-a",
        ),
      );
      expect((await ssh.sessions("a")).length).toBe(1);
      ssh.disconnect("a");
      expect((await ssh.sessions("b")).length).toBe(1);
    } finally {
      ssh.dispose();
    }
  }, 15000);
  it("rejects untrusted hosts and bad passwords", async () => {
    const denied = new SSH(
        () => {},
        async () => false,
      ),
      bad = new SSH(
        () => {},
        async () => true,
      );
    try {
      await expect(denied.connect(server("deny"), "correct")).rejects.toThrow(
        /verification failed/,
      );
      await expect(bad.connect(server("bad"), "wrong")).rejects.toThrow(
        /authentication methods failed/,
      );
    } finally {
      denied.dispose();
      bad.dispose();
    }
  }, 15000);
});
