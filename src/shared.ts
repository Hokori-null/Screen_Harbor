import { z } from "zod";
export const idSchema = z.string().uuid();
export const serverSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(80),
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.:%_-]+$/),
    port: z.number().int().min(1).max(65535),
    username: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[^\s\x00-\x1f]+$/),
    auth: z.enum(["password", "key"]),
    keyPath: z.string().max(4096).default(""),
    remember: z.boolean().default(false),
  })
  .superRefine((s, c) => {
    if (s.auth === "key" && !s.keyPath)
      c.addIssue({
        code: "custom",
        message: "请选择私钥文件",
        path: ["keyPath"],
      });
  });
export type Server = z.infer<typeof serverSchema>;
export type ServerView = Server & { hasSecret: boolean };
export const nameSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/,
    "名称需为 1–64 位字母、数字、下划线或连字符，首位为字母或数字",
  );
export const sessionSchema = z
  .string()
  .max(256)
  .regex(/^\d+\.[^\s\x00-\x1f]+$/);
export const sizeSchema = z.object({
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(300),
});
export const requests = {
  list: z.object({}),
  save: z.object({
    server: serverSchema,
    secret: z.string().max(16384).optional(),
  }),
  remove: z.object({ serverId: idSchema }),
  pickKey: z.object({}),
  connect: z.object({
    serverId: idSchema,
    secret: z.string().max(16384).optional(),
  }),
  disconnect: z.object({ serverId: idSchema }),
  sessions: z.object({ serverId: idSchema }),
  create: z.object({ serverId: idSchema, name: nameSchema }),
  rename: z.object({
    serverId: idSchema,
    sessionId: sessionSchema,
    name: nameSchema,
  }),
  end: z.object({ serverId: idSchema, sessionId: sessionSchema }),
  attach: z.object({
    serverId: idSchema,
    sessionId: sessionSchema,
    terminalId: idSchema,
    takeover: z.boolean(),
    ...sizeSchema.shape,
  }),
  input: z.object({
    serverId: idSchema,
    terminalId: idSchema,
    data: z.string().max(65536),
  }),
  resize: z.object({
    serverId: idSchema,
    terminalId: idSchema,
    ...sizeSchema.shape,
  }),
  close: z.object({ serverId: idSchema, terminalId: idSchema }),
};
export type Session = {
  id: string;
  name: string;
  state: "Attached" | "Detached" | "Dead" | "Unknown";
};
export type Event =
  | {
      type: "status";
      serverId: string;
      status: "connecting" | "connected" | "disconnected";
      message?: string;
    }
  | {
      type: "data" | "closed";
      serverId: string;
      terminalId: string;
      data?: string;
    };
export type Results = {
  list: ServerView[];
  save: ServerView;
  remove: void;
  pickKey: string | null;
  connect: void;
  disconnect: void;
  sessions: Session[];
  create: Session;
  rename: void;
  end: void;
  attach: void;
  input: void;
  resize: void;
  close: void;
};
export type Method = keyof typeof requests;
export interface API {
  call<K extends Method>(
    method: K,
    args: z.input<(typeof requests)[K]>,
  ): Promise<Results[K]>;
  onEvent(fn: (event: Event) => void): () => void;
}
declare global {
  interface Window {
    screenAPI: API;
  }
}
