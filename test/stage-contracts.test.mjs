// Prompt text checks cover instructions without an executable equivalent.
// Runtime activation, Gates, recovery, isolation and completion are exercised
// by their integration suites; wording and character spacing are not contracts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateControlCommand } from "../src/control-contracts.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (name) =>
  readFileSync(path.join(root, "prompts", `${name}.md`), "utf8");
const design = read("abel-design");
const implement = read("abel-implement");
const diagnose = read("abel-diagnose");

it("publishes executable examples for each Implement control command", () => {
  const examples = [...implement.matchAll(/^\{"command":.+\}$/gm)].map(
    (match) => JSON.parse(match[0].replaceAll(/<[^>]+>/g, "example")),
  );
  expect(new Set(examples.map((example) => example.command))).toEqual(
    new Set(["start", "status", "resume", "rebind", "cancel", "discard"]),
  );
  for (const example of examples)
    expect(validateControlCommand(example).ok).toBe(true);
});

describe("Diagnose and browser-E2E contracts", () => {
  it("instructs the parent to establish evidence before repairing a defect", () => {
    expect(diagnose).toMatch(
      /Reproduce[\s\S]*falsify[\s\S]*regression[\s\S]*minimum repair/i,
    );
    expect(diagnose).toMatch(
      /parent runs reproduction and verification commands/i,
    );
  });

  it("pauses only an approved browser check when dev-browser is absent", () => {
    const text = `${design}\n${implement}\n${diagnose}`;
    expect(text).toMatch(/dev-browser/);
    expect(text).toMatch(/approved browser E2E/i);
    expect(text).toMatch(/pause only that check/i);
  });
});
