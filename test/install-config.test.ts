import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_TEMPLATE, ensureUserConfig } from "../src/install-config.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("user configuration installer", () => {
  it("creates the template once without overwriting existing configuration", () => {
    const home = mkdtempSync(path.join(tmpdir(), "cadence-install-"));
    roots.push(home);
    const result = ensureUserConfig(home);
    const file = path.join(home, ".pi", "agent", "cadence", ".env");
    expect(result).toEqual({ created: true, path: file });
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(CONFIG_TEMPLATE);

    writeFileSync(file, "GROK_API_KEY=keep-me\n");
    expect(ensureUserConfig(home)).toEqual({ created: false, path: file });
    expect(readFileSync(file, "utf8")).toBe("GROK_API_KEY=keep-me\n");
  });
});
