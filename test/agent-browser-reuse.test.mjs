import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
it("ships the attributed readonly browser, not an upstream agent manager", () => {
  const reuse = JSON.parse(read("provenance/agent-browser-reuse.json"));
  expect(reuse.repository).toBe("https://github.com/gotgenes/pi-packages");
  expect(reuse.commit).toBe("52854c12d590142e61a4f6a6947be9084035300d");
  const files = reuse.modules.flatMap((module) => module.localPaths);
  expect(files).toEqual([
    "src/agent-browser/session-navigator.ts",
    "src/agent-browser/transcript-pane.ts",
    "src/agent-browser/transcript-content.ts",
    "src/agent-browser/labeled-rule.ts",
  ]);
  const members = JSON.parse(read("provenance/package-members.json"));
  for (const module of reuse.modules) {
    expect(module.upstreamSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(module.changes.length).toBeGreaterThan(20);
  }
  for (const file of files) {
    const code = read(file);
    expect(code).toContain(reuse.commit);
    expect(code).toContain("MIT");
    expect(members).toContain(`package/${file}`);
    expect(code).not.toMatch(
      /from ["'](?:node:fs|node:child_process|@gotgenes|#src)/,
    );
  }
  expect(read(reuse.license)).toContain("Copyright (c) 2026 tintinweb");
  expect(read("THIRD_PARTY_NOTICES.md")).toContain(reuse.commit);
  expect(read("src/agent-panel.ts")).toContain("new SessionNavigator");
  expect(read("src/agent-panel.ts")).not.toMatch(
    /class Transcript|PanelFocus|panelLines/,
  );
  expect(read("src/agent-panel-model.ts")).not.toMatch(
    /visibleAgents|PanelFocus/,
  );
});
