// Run after `npm run package`: node_modules/.bin/electron scripts/smoke.cjs
const { app, BrowserWindow, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "screen-harbor-smoke-"));
app.disableHardwareAcceleration();
app.setPath("userData", data);
// Load the shipped archive so missing runtime dependencies cannot be masked by
// the development workspace's node_modules.
const archive = path.join(
  __dirname,
  "../out/Screen Harbor-win32-x64/resources/app.asar",
);
const shippedRequire = require("node:module").createRequire(
  path.join(archive, ".vite/build/main.cjs"),
);
for (const dependency of [
  "ssh2",
  "asn1",
  "bcrypt-pbkdf",
  "safer-buffer",
  "tweetnacl",
]) {
  const resolved = shippedRequire.resolve(dependency);
  if (!resolved.startsWith(archive + path.sep))
    throw new Error(`Dependency missing from archive: ${dependency}`);
}
shippedRequire("./main.cjs");
let done = false;
const timer = setTimeout(
  () => finish(new Error("Application startup timed out")),
  25000,
);
function finish(error) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  if (error) console.error(error);
  console.log(
    error
      ? "SMOKE FAILED"
      : "SMOKE PASSED: renderer, preload IPC, config, DPAPI, screenshot",
  );
  app.exit(error ? 1 : 0);
}
app.on("browser-window-created", (_event, window) => {
  window.webContents.on("did-fail-load", (_e, code, description) =>
    finish(new Error(`${code}: ${description}`)),
  );
  window.webContents.once("did-finish-load", async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const result = await window.webContents.executeJavaScript(`(async () => {
        if (!document.body.textContent.includes('Screen Harbor')) throw new Error('Missing application UI');
        if (!window.screenAPI) throw new Error('Missing preload bridge');
        const servers = await window.screenAPI.call('list', {});
        if (servers.length) throw new Error('Unexpected persisted fixture data');
        const fixture = {id: '12345678-1234-4234-8234-123456789012', name: 'Smoke', host: 'localhost', port: 22, username: 'test', auth: 'password', keyPath: '', remember: true};
        const saved = await window.screenAPI.call('save', {server: fixture, secret: 'ipc-smoke-secret'});
        if (!saved.hasSecret || JSON.stringify(saved).includes('ipc-smoke-secret')) throw new Error('Credential redaction failed');
        await window.screenAPI.call('remove', {serverId: fixture.id});
        const add = [...document.querySelectorAll('button')].find(b => b.textContent === '添加服务器');
        if (!add) throw new Error('Missing add button');
        add.click();
        return true;
      })()`);
      if (!result) throw new Error("Renderer check failed");
      console.log("Renderer and preload IPC passed");
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Windows secure storage unavailable");
      const ciphertext = safeStorage.encryptString("smoke-only-secret");
      if (safeStorage.decryptString(ciphertext) !== "smoke-only-secret")
        throw new Error("DPAPI roundtrip failed");
      console.log("Windows DPAPI passed");
      await new Promise((resolve) => setTimeout(resolve, 300));
      fs.mkdirSync(path.join(__dirname, "../out"), { recursive: true });
      fs.writeFileSync(
        path.join(__dirname, "../out/smoke.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      finish();
    } catch (error) {
      finish(error);
    }
  });
});
