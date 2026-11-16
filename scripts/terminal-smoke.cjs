const { app, safeStorage } = require("electron");
const { Server, utils } = require("ssh2");
const { generateKeyPairSync, createHash } = require("node:crypto");
const { mkdtempSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
app.disableHardwareAcceleration();
const data = mkdtempSync(path.join(os.tmpdir(), "screen-terminal-test-"));
app.setPath("userData", data);
const key = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
}).privateKey;
const fp =
  "SHA256:" +
  createHash("sha256")
    .update(utils.parseKey(key).getPublicSSH())
    .digest("base64")
    .replace(/=+$/, "");
const received = { work: "", logs: "" };
let workChannel;
const remote = new Server({ hostKeys: [key] }, (client) => {
  client.on("error", () => {});
  client.on("authentication", (ctx) =>
    ctx.method === "password" && ctx.password === "fixture"
      ? ctx.accept()
      : ctx.reject(),
  );
  client.on("ready", () =>
    client.on("session", (accept) => {
      const s = accept();
      s.on("pty", (accept) => accept?.());
      s.on("window-change", (accept) => accept?.());
      s.on("exec", (accept, reject, info) => {
        const ch = accept();
        if (info.command.includes("command -v")) {
          ch.exit(0);
          ch.end();
        } else if (info.command === "LC_ALL=C screen -ls") {
          ch.write(
            "\t123.work\t(Detached)\n\t456.logs\t(Detached)\n\t789.build\t(Detached)\n\t999.extra\t(Detached)\n",
          );
          ch.exit(0);
          ch.end();
        } else if (info.command.startsWith("screen -r")) {
          const name = info.command.includes("123.work") ? "work" : "logs";
          if (name === "work") workChannel = ch;
          ch.write("fixture> ");
          ch.on("data", (bytes) => {
            received[name] += bytes.toString("utf8");
            ch.write(bytes);
          });
        } else {
          ch.exit(1);
          ch.end();
        }
      });
    }),
  );
});
const until = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for terminal UI");
};
const timer = setTimeout(() => {
  console.error("Terminal smoke timed out");
  app.exit(1);
}, 30000);
app.on("browser-window-created", (_e, win) => {
  win.webContents.once("did-finish-load", async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    try {
      await until(() =>
        js(`document.body.textContent.includes('Terminal fixture')`),
      );
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='连接服务器').click()`,
      );
      await until(() =>
        js(`document.querySelectorAll('.session-row').length === 3`),
      );
      await js(
        `[...document.querySelectorAll('.session-pagination button')].find(b => b.textContent === '下一页').click()`,
      );
      await until(() =>
        js(
          `document.querySelectorAll('.session-row').length === 1 && document.querySelector('.session-row').textContent.includes('999.extra')`,
        ),
      );
      await js(
        `[...document.querySelectorAll('.session-pagination button')].find(b => b.textContent === '上一页').click()`,
      );
      await until(() =>
        js(`document.querySelectorAll('.session-row').length === 3`),
      );
      await js(
        `document.querySelectorAll('.session-row')[0].querySelector('button').click()`,
      );
      await until(() =>
        js(
          `document.querySelectorAll('.xterm-helper-textarea').length === 1 && !document.querySelector('.row-actions button').disabled`,
        ),
      );
      const state = await js(
        `(() => { const t=document.querySelector('.xterm-helper-textarea'); return {visibility:getComputedStyle(t).visibility,focused:document.activeElement===t}; })()`,
      );
      if (state.visibility !== "visible" || !state.focused)
        throw new Error(
          "Terminal cannot receive keys: " + JSON.stringify(state),
        );
      await js(
        `window.fixtureTerminal = document.querySelector('.xterm-helper-textarea'); document.querySelector('.terminal-maximize').click()`,
      );
      await until(() =>
        js(`(() => {
        const rect = document.querySelector('.terminal-panel').getBoundingClientRect();
        return rect.x === 0 && rect.y === 0 && rect.width === innerWidth && rect.height === innerHeight;
      })()`),
      );
      await js(`document.querySelector('.terminal-maximize').click()`);
      await until(() =>
        js(
          `!document.querySelector('.terminal-maximized') && document.querySelector('.terminal-panel').getBoundingClientRect().x > 0`,
        ),
      );
      if (
        !(await js(
          `window.fixtureTerminal === document.querySelector('.xterm-helper-textarea') && document.activeElement === window.fixtureTerminal`,
        ))
      )
        throw new Error("Maximize replaced terminal or lost input focus");
      console.log(
        "LAYOUT PASSED: three sessions per page; terminal fills window and restores without remounting",
      );
      win.focus();
      for (const c of "echo terminal-test")
        win.webContents.sendInputEvent({ type: "char", keyCode: c });
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
      await until(() => received.work.includes("echo terminal-test\r"));
      await win.webContents.insertText("中文");
      await until(() => received.work.includes("中文"));
      await js(
        `document.querySelectorAll('.session-row')[1].querySelector('button').click()`,
      );
      await until(() =>
        js(
          `document.querySelectorAll('.xterm-helper-textarea').length === 2 && !document.querySelector('.row-actions button').disabled`,
        ),
      );
      win.webContents.sendInputEvent({ type: "char", keyCode: "b" });
      await until(() => received.logs.includes("b"));
      await js(`document.querySelector('.tabs .tab button').click()`);
      await until(() =>
        js(
          `document.activeElement===document.querySelectorAll('.xterm-helper-textarea')[0]`,
        ),
      );
      win.webContents.sendInputEvent({ type: "char", keyCode: "a" });
      await until(() => received.work.endsWith("a"));
      if (received.logs !== "b")
        throw new Error("Terminal input leaked across tabs");
      workChannel.write(
        Array.from({ length: 200 }, (_, i) => `\r\nhistory ${i}`).join(""),
      );
      const top = () =>
        js(
          `document.querySelector('.terminal-viewport.active .xterm-viewport').scrollTop`,
        );
      await until(async () => (await top()) > 100);
      const beforeScroll = await top();
      const wheel = () =>
        js(
          `document.querySelector('.terminal-viewport.active .xterm-screen').dispatchEvent(new WheelEvent('wheel', {deltaY:-120, bubbles:true, cancelable:true}))`,
        );
      const beforeInput = received.work;
      await wheel();
      await until(async () => (await top()) < beforeScroll);
      // Alternate buffer without and with remote mouse reporting must never
      // turn a wheel gesture into terminal input.
      for (const mode of ["\x1b[?1049h", "\x1b[?1000h\x1b[?1006h"]) {
        workChannel.write(mode);
        await new Promise((r) => setTimeout(r, 150));
        await wheel();
        await new Promise((r) => setTimeout(r, 150));
        if (received.work !== beforeInput)
          throw new Error("Wheel leaked into remote input");
      }
      console.log(
        "WHEEL PASSED: local history scrolls; alternate screen and mouse reporting send no input",
      );
      console.log(
        "TERMINAL SMOKE PASSED: packaged renderer → keyboard/Unicode → preload IPC → SSH; tab switching and isolation",
      );
      clearTimeout(timer);
      app.exit(0);
    } catch (e) {
      console.error(e);
      clearTimeout(timer);
      app.exit(1);
    }
  });
});
void (async () => {
  await app.whenReady();
  await new Promise((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const port = remote.address().port;
  writeFileSync(
    path.join(data, "servers.json"),
    JSON.stringify({
      version: 1,
      servers: [
        {
          config: {
            id: "12345678-1234-4234-8234-123456789012",
            name: "Terminal fixture",
            host: "127.0.0.1",
            port,
            username: "test",
            auth: "password",
            keyPath: "",
            remember: true,
          },
          encrypted: safeStorage.encryptString("fixture").toString("base64"),
        },
      ],
      hosts: { ["127.0.0.1:" + port]: fp },
    }),
  );
  require("../out/Screen Harbor-win32-x64/resources/app.asar/.vite/build/main.cjs");
})().catch((e) => {
  console.error(e);
  app.exit(1);
});
