/** Native model preference file: Pi's linked agent directory, explicit repair. */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CadencePreferences } from "../src/cadence-preferences.ts";

const model = {
  provider: "fixture",
  model: "fixed",
  api: "openai-completions",
  thinking: "off",
} as const;

it.skipIf(process.platform === "win32")(
  "follows a linked agent directory like Pi, but never a linked preference file",
  () => {
    const root = mkdtempSync(join(tmpdir(), "cadence-preferences-link-"));
    const real = join(root, "dotfiles", "agent");
    mkdirSync(real, { recursive: true });
    symlinkSync(join(root, "dotfiles"), join(root, ".pi"));
    const linked = join(root, ".pi", "agent");
    new CadencePreferences(linked).save(model);
    expect(new CadencePreferences(linked).read()).toEqual(model);
    expect(
      JSON.parse(readFileSync(join(real, "cadence", "settings.json"), "utf8"))
        .model,
    ).toEqual(model);
    // A missing agent directory below a link resolves the same way.
    expect(new CadencePreferences(join(linked, "nested")).path).toBe(
      join(real, "nested", "cadence", "settings.json"),
    );
    const other = mkdtempSync(join(tmpdir(), "cadence-preferences-target-"));
    writeFileSync(join(other, "settings.json"), "{}");
    const unsafe = join(root, "unsafe");
    mkdirSync(join(unsafe, "cadence"), { recursive: true });
    symlinkSync(
      join(other, "settings.json"),
      join(unsafe, "cadence", "settings.json"),
    );
    expect(() => new CadencePreferences(unsafe).read()).toThrow();
    expect(() => new CadencePreferences(unsafe).choose(model)).toThrow();
    expect(readFileSync(join(other, "settings.json"), "utf8")).toBe("{}");
  },
);
it("an explicit choice atomically replaces a corrupt file; implicit saving never does", () => {
  const root = mkdtempSync(join(tmpdir(), "cadence-preferences-repair-"));
  const p = new CadencePreferences(root);
  mkdirSync(join(root, "cadence"));
  writeFileSync(p.path, "{not json");
  expect(() => p.read()).toThrow();
  expect(() => p.save(model)).toThrow();
  expect(readFileSync(p.path, "utf8")).toBe("{not json");
  p.choose(model);
  expect(p.read()).toEqual(model);
  p.choose({ ...model, thinking: "high" });
  expect(p.read()).toEqual({ ...model, thinking: "high" });
});
