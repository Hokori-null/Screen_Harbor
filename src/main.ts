import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  Menu,
} from "electron";
import path from "node:path";
import { Store } from "./store";
import { SSH } from "./ssh";
import { requests, type Method } from "./shared";
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
let window: BrowserWindow;
let ssh: SSH;
if (process.argv.some((a) => a.startsWith("--squirrel-"))) app.quit();
else
  void app
    .whenReady()
    .then(() => {
      Menu.setApplicationMenu(null);
      const store = new Store(app.getPath("userData"), {
        available: () =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== "linux" ||
            safeStorage.getSelectedStorageBackend() !== "basic_text"),
        encrypt: (s) => safeStorage.encryptString(s).toString("base64"),
        decrypt: (s) => safeStorage.decryptString(Buffer.from(s, "base64")),
      });
      window = new BrowserWindow({
        width: 1440,
        height: 930,
        minWidth: 1000,
        minHeight: 680,
        backgroundColor: "#10151e",
        title: "Screen Harbor",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      ssh = new SSH(
        (event) => {
          if (!window.isDestroyed())
            window.webContents.send("screen:event", event);
        },
        async (server, fp) => {
          const known = store.fingerprint(server.host, server.port);
          if (known === fp) return true;
          const changed = !!known;
          const result = await dialog.showMessageBox(window, {
            type: changed ? "warning" : "question",
            title: changed ? "SSH 主机密钥已变化" : "首次连接：验证服务器",
            message: `${server.host}:${server.port}`,
            detail: `${changed ? "主机密钥与记录不符。请通过可信渠道核验后才能更新。" : "请通过可信渠道核对服务器指纹。"}\n\n新指纹：${fp}${known ? "\n原指纹：" + known : ""}`,
            buttons: ["取消", changed ? "已核验，更新并连接" : "信任并连接"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (result.response !== 1) return false;
          store.trust(server.host, server.port, fp);
          return true;
        },
      );
      const handlers: Record<Method, (a: any) => unknown> = {
        list: () => store.list(),
        save: ({ server, secret }) => {
          const old = store.list().find((s) => s.id === server.id);
          const result = store.save(server, secret);
          if (
            old &&
            ["host", "port", "username", "auth", "keyPath"].some(
              (k) => old[k as keyof typeof old] !== server[k],
            )
          )
            ssh.disconnect(server.id);
          return result;
        },
        remove: ({ serverId }) => {
          ssh.disconnect(serverId);
          store.remove(serverId);
        },
        pickKey: async () => {
          const r = await dialog.showOpenDialog(window, {
            title: "选择 SSH 私钥",
            properties: ["openFile"],
          });
          return r.canceled ? null : r.filePaths[0];
        },
        connect: ({ serverId, secret }) =>
          ssh.connect(store.get(serverId), secret ?? store.secret(serverId)),
        disconnect: ({ serverId }) => ssh.disconnect(serverId),
        sessions: ({ serverId }) => ssh.sessions(serverId),
        create: ({ serverId, name }) => ssh.create(serverId, name),
        rename: ({ serverId, sessionId, name }) =>
          ssh.rename(serverId, sessionId, name),
        end: async ({ serverId, sessionId }) => {
          const r = await dialog.showMessageBox(window, {
            type: "warning",
            message: `结束会话 ${sessionId}？`,
            detail: "其中运行的程序将被终止，此操作不可撤销。",
            buttons: ["取消", "结束会话"],
            defaultId: 0,
            cancelId: 0,
          });
          if (r.response !== 1) throw new Error("已取消");
          await ssh.end(serverId, sessionId);
        },
        attach: async ({
          serverId,
          sessionId,
          terminalId,
          takeover,
          cols,
          rows,
        }) => {
          if (takeover) {
            const r = await dialog.showMessageBox(window, {
              type: "warning",
              message: `接管 ${sessionId}？`,
              detail: "当前连接会被分离，远程任务继续运行。",
              buttons: ["取消", "接管连接"],
              defaultId: 0,
              cancelId: 0,
            });
            if (r.response !== 1) throw new Error("已取消");
          }
          await ssh.attach(
            serverId,
            sessionId,
            terminalId,
            takeover,
            cols,
            rows,
          );
        },
        input: ({ serverId, terminalId, data }) =>
          ssh.input(serverId, terminalId, data),
        resize: ({ serverId, terminalId, cols, rows }) =>
          ssh.resize(serverId, terminalId, cols, rows),
        close: ({ serverId, terminalId }) => ssh.close(serverId, terminalId),
      };
      ipcMain.handle(
        "screen:call",
        async (event, method: unknown, args: unknown) => {
          if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame
          )
            throw new Error("不受信任的调用来源");
          if (
            typeof method !== "string" ||
            !Object.prototype.hasOwnProperty.call(requests, method)
          )
            throw new Error("未知操作");
          const parsed = requests[method as Method].parse(args);
          return handlers[method as Method](parsed);
        },
      );
      if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
        void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      else
        void window.loadFile(
          path.join(
            __dirname,
            `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
          ),
        );
    })
    .catch(async () => {
      await dialog.showMessageBox({
        type: "error",
        message: "无法启动 Screen Harbor",
        detail:
          "请检查用户数据目录中的 servers.json 是否损坏或配置版本不受支持。原文件不会被覆盖。",
      });
      app.quit();
    });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => ssh?.dispose());
