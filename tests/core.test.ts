import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { commands, parseSessions, quote } from "../src/screen";
import { requests, nameSchema, serverSchema } from "../src/shared";
import { Store } from "../src/store";
const config = {
  id: "12345678-1234-4234-8234-123456789012",
  name: "Dev",
  host: "localhost",
  port: 22,
  username: "test",
  auth: "password" as const,
  keyPath: "",
  remember: false,
};
const dirs: string[] = [];
const dir = () => {
  const d = mkdtempSync(path.join(tmpdir(), "screen-harbor-test-"));
  dirs.push(d);
  return d;
};
const crypto = {
  available: () => true,
  encrypt: (s: string) => Buffer.from(s).toString("base64"),
  decrypt: (s: string) => Buffer.from(s, "base64").toString(),
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
describe("Screen protocol", () => {
  it("reads dated and undated attached, detached and dead sockets", () => {
    expect(
      parseSessions(
        "There are screens on:\n\t123.build\t(11/13/2026 10:00:00 AM)\t(Detached)\n\t456.logs\t(Attached)\n\t789.old\t(Dead ???)\n3 Sockets in /run/screen/S-user.",
      ),
    ).toEqual([
      { id: "123.build", name: "build", state: "Detached" },
      { id: "456.logs", name: "logs", state: "Attached" },
      { id: "789.old", name: "old", state: "Dead" },
    ]);
  });
  it("does not treat informational lines as sessions", () => {
    expect(parseSessions("No Sockets found in /run/screen/S-user.")).toEqual(
      [],
    );
    expect(parseSessions("Permission denied")).toEqual([]);
  });
  it("quotes hostile identifiers without shell expansion", () => {
    expect(quote("a'b;$HOME")).toBe("'a'\\''b;$HOME'");
    expect(commands.end("123.a';$(id)")).toBe(
      "LC_ALL=C screen -S '123.a'\\'';$(id)' -X quit",
    );
    expect(() => quote("a\0b")).toThrow();
  });
  it("restricts new names and requires full socket identifiers", () => {
    for (const n of ["-x", "bad name", "x;reboot", "../foo", ""])
      expect(nameSchema.safeParse(n).success).toBe(false);
    expect(nameSchema.parse("build-api_2")).toBe("build-api_2");
    expect(() => commands.end("build")).toThrow();
    expect(commands.attach("123.build", true)).toContain("-d -r");
    expect(commands.attach("123.build", false)).not.toContain("-d");
  });
});
describe("IPC validation", () => {
  it("rejects malformed server and terminal arguments", () => {
    expect(serverSchema.safeParse({ ...config, port: 0 }).success).toBe(false);
    expect(serverSchema.safeParse({ ...config, auth: "key" }).success).toBe(
      false,
    );
    expect(
      requests.resize.safeParse({
        serverId: config.id,
        terminalId: config.id,
        cols: 0,
        rows: 24,
      }).success,
    ).toBe(false);
    expect(
      requests.input.safeParse({
        serverId: "bad",
        terminalId: config.id,
        data: "x",
      }).success,
    ).toBe(false);
    expect(
      requests.input.safeParse({
        serverId: config.id,
        terminalId: config.id,
        data: "x".repeat(65537),
      }).success,
    ).toBe(false);
  });
});
describe("configuration persistence", () => {
  it("never persists unremembered secrets and round trips versioned config", () => {
    const d = dir(),
      s = new Store(d, crypto);
    s.save(config, "plain-secret");
    expect(readFileSync(path.join(d, "servers.json"), "utf8")).not.toContain(
      "plain-secret",
    );
    expect(new Store(d, crypto).list()).toEqual([
      { ...config, hasSecret: false },
    ]);
  });
  it("encrypts remembered credentials, preserves only for unchanged identity, and forgets on opt-out", () => {
    const d = dir(),
      s = new Store(d, crypto);
    s.save({ ...config, remember: true }, "hidden");
    expect(s.secret(config.id)).toBe("hidden");
    expect(readFileSync(path.join(d, "servers.json"), "utf8")).not.toContain(
      "hidden",
    );
    s.save({ ...config, remember: true, name: "Renamed" });
    expect(s.secret(config.id)).toBe("hidden");
    s.save({ ...config, remember: true, host: "elsewhere" });
    expect(s.secret(config.id)).toBeUndefined();
    s.save({ ...config, remember: true }, "new");
    s.save(config);
    expect(s.secret(config.id)).toBeUndefined();
  });
  it("refuses insecure credential storage", () => {
    const s = new Store(dir(), { ...crypto, available: () => false });
    expect(() => s.save({ ...config, remember: true }, "hidden")).toThrow();
    expect(s.list()).toEqual([]);
  });
  it("persists host fingerprints and removes server credentials", () => {
    const d = dir(),
      s = new Store(d, crypto);
    s.save({ ...config, remember: true }, "secret");
    s.trust("localhost", 22, "SHA256:test");
    s.remove(config.id);
    expect(new Store(d, crypto).fingerprint("localhost", 22)).toBe(
      "SHA256:test",
    );
    expect(s.list()).toEqual([]);
    expect(s.secret(config.id)).toBeUndefined();
  });
  it("does not overwrite invalid configuration", () => {
    const d = dir(),
      file = path.join(d, "servers.json");
    writeFileSync(file, '{"version":999}');
    expect(() => new Store(d, crypto)).toThrow();
    expect(readFileSync(file, "utf8")).toBe('{"version":999}');
  });
});
