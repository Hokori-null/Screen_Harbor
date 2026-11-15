import { createRequire } from "node:module";
import { expect, it } from "vitest";
const { versionFromTag } = createRequire(import.meta.url)(
  "../scripts/tag-version.cjs",
);
it("extracts release versions without accepting shell fragments or malformed tags", () => {
  expect(versionFromTag("v1.2.3")).toBe("1.2.3");
  expect(versionFromTag("2.0.0")).toBe("2.0.0");
  for (const tag of [
    "",
    "v01.2.3",
    "v1.2",
    "v1.2.3;echo bad",
    "v1.2.3-beta.1",
  ]) {
    expect(() => versionFromTag(tag)).toThrow();
  }
});
