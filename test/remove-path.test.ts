import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { removePathSync } from "../src/remove-path.ts";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it.each(["native", "win32"])(
  "removes Unicode paths without traversing directory links (%s)",
  (platform) => {
    const root = mkdtempSync(path.join(tmpdir(), "cadence-remove-"));
    roots.push(root);
    const owned = path.join(root, "owned 中文"),
      external = path.join(root, "external 中文");
    mkdirSync(owned);
    mkdirSync(external);
    writeFileSync(path.join(owned, "file 中文"), "owned");
    writeFileSync(path.join(external, "keep"), "external");
    symlinkSync(
      external,
      path.join(owned, "link 中文"),
      process.platform === "win32" ? "junction" : "dir",
    );
    if (platform === "win32")
      vi.stubGlobal(
        "process",
        Object.create(process, { platform: { value: "win32" } }),
      );
    expect(() => removePathSync(owned)).toThrow();
    expect(existsSync(owned)).toBe(true);
    removePathSync(owned, { recursive: true, force: true });
    expect(existsSync(owned)).toBe(false);
    expect(readFileSync(path.join(external, "keep"), "utf8")).toBe("external");
    removePathSync(owned, { recursive: true, force: true });
    expect(() => removePathSync(owned)).toThrow();
    removePathSync(external, { recursive: true });
  },
);
