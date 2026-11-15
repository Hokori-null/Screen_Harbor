import { nameSchema, sessionSchema, type Session } from "./shared";
export function quote(value: string) {
  if (value.includes("\0")) throw new Error("无效参数");
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
export function parseSessions(output: string): Session[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(
      /^\s+(\d+\.\S+)\s+.*\((Attached|Detached|Dead[^)]*|Unknown)\)\s*$/,
    );
    if (!match) return [];
    return [
      {
        id: match[1],
        name: match[1].slice(match[1].indexOf(".") + 1),
        state: match[2].startsWith("Dead")
          ? "Dead"
          : (match[2] as Session["state"]),
      },
    ];
  });
}
export const commands = {
  check: "command -v screen >/dev/null 2>&1",
  list: "LC_ALL=C screen -ls",
  create: (name: string) => `screen -dmS ${quote(nameSchema.parse(name))}`,
  rename: (id: string, name: string) =>
    `LC_ALL=C screen -S ${quote(sessionSchema.parse(id))} -X sessionname ${quote(nameSchema.parse(name))}`,
  end: (id: string) =>
    `LC_ALL=C screen -S ${quote(sessionSchema.parse(id))} -X quit`,
  attach: (id: string, takeover: boolean) =>
    `screen ${takeover ? "-d -r" : "-r"} ${quote(sessionSchema.parse(id))}`,
};
