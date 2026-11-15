import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { serverSchema, type Server, type ServerView } from "./shared";
const diskSchema = z.object({
  version: z.literal(1),
  servers: z.array(
    z.object({ config: serverSchema, encrypted: z.string().optional() }),
  ),
  hosts: z.record(z.string(), z.string()),
});
export interface Crypto {
  available(): boolean;
  encrypt(s: string): string;
  decrypt(s: string): string;
}
export class Store {
  private data: z.infer<typeof diskSchema>;
  private file: string;
  constructor(
    dir: string,
    private crypto: Crypto,
  ) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "servers.json");
    this.data = existsSync(this.file)
      ? diskSchema.parse(JSON.parse(readFileSync(this.file, "utf8")))
      : { version: 1, servers: [], hosts: {} };
  }
  private commit(data: z.infer<typeof diskSchema>) {
    writeFileSync(this.file + ".tmp", JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
    renameSync(this.file + ".tmp", this.file);
    this.data = data;
  }
  list(): ServerView[] {
    return this.data.servers.map((s) => ({
      ...s.config,
      hasSecret: !!s.encrypted,
    }));
  }
  get(id: string) {
    const s = this.data.servers.find((s) => s.config.id === id);
    if (!s) throw new Error("服务器不存在");
    return s.config;
  }
  secret(id: string) {
    const s = this.data.servers.find((s) => s.config.id === id);
    return s?.encrypted ? this.crypto.decrypt(s.encrypted) : undefined;
  }
  save(config: Server, secret?: string) {
    const old = this.data.servers.find((s) => s.config.id === config.id);
    let encrypted: string | undefined;
    if (config.remember) {
      if (!this.crypto.available())
        throw new Error("系统安全加密不可用，无法保存凭据");
      const same =
        old &&
        ["host", "port", "username", "auth", "keyPath"].every(
          (k) => old.config[k as keyof Server] === config[k as keyof Server],
        );
      encrypted =
        secret !== undefined
          ? this.crypto.encrypt(secret)
          : same
            ? old?.encrypted
            : undefined;
    }
    const index = this.data.servers.findIndex((s) => s.config.id === config.id);
    const servers = [...this.data.servers];
    if (index < 0) servers.push({ config, encrypted });
    else servers[index] = { config, encrypted };
    this.commit({ ...this.data, servers });
    return { ...config, hasSecret: !!encrypted };
  }
  remove(id: string) {
    this.commit({
      ...this.data,
      servers: this.data.servers.filter((s) => s.config.id !== id),
    });
  }
  fingerprint(host: string, port: number) {
    return this.data.hosts[`${host}:${port}`];
  }
  trust(host: string, port: number, fingerprint: string) {
    this.commit({
      ...this.data,
      hosts: { ...this.data.hosts, [`${host}:${port}`]: fingerprint },
    });
  }
}
