import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  KNOWLEDGE_LIMITS,
  projectKnowledge,
} from "../src/service/project-knowledge.ts";

const scan = vi.hoisted(() => ({ path: "", reads: 0, closed: 0 }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    opendirSync: (path: string) =>
      path !== scan.path
        ? fs.opendirSync(path)
        : {
            readSync: () => ({
              name: `irrelevant-${scan.reads++}.txt`,
              isDirectory: () => false,
              isFile: () => true,
              isSymbolicLink: () => false,
            }),
            closeSync: () => {
              scan.closed++;
            },
          },
  };
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "knowledge-bounds-"));
  const put = (p: string, body: string) => {
    const path = join(root, p);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  };
  return { root, put };
}
it("irrelevant directory entries consume discovery capacity and the directory is closed", () => {
  const { root } = fixture();
  Object.assign(scan, { path: join(root, "docs"), reads: 0, closed: 0 });
  const result = projectKnowledge(root, "search", [], []);
  expect(scan.reads).toBe(KNOWLEDGE_LIMITS.entries);
  expect(scan.closed).toBe(1);
  expect(result.omitted.join(" ")).toContain("discovery reached");
  scan.path = "";
});
it("the complete injection obeys its byte allowance including long paths, reasons and omissions", () => {
  const { root, put } = fixture();
  const directory = `docs/${"a".repeat(100)}/${"b".repeat(100)}/${"c".repeat(100)}`;
  put("AGENTS.md", "Read the relevant search specification.");
  put(
    `${directory}/index.md`,
    Array.from({ length: 8 }, (_, i) => `[Topic](topic-${i}.md)`).join("\n"),
  );
  for (let i = 0; i < 8; i++)
    put(`${directory}/topic-${i}.md`, "搜索 search contract. ".repeat(2000));
  for (const maximum of [0, 64, 500, 2500, KNOWLEDGE_LIMITS.contextBytes]) {
    const result = projectKnowledge(root, "search", [], [], maximum);
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(maximum);
    expect(result.text).not.toContain("�");
    for (const source of result.sources)
      expect(result.text).toContain(source.excerpt);
  }
});
it("explicit documentation targets cannot incidentally inject personal journals or legacy raw notes", () => {
  const { root, put } = fixture();
  const paths = [
    ".trellis/workspace/person/journal.md",
    ".trellis/tasks/old/prd.md",
    ".cadence/assistant/tasks/old/summary.md",
  ];
  for (const path of paths) put(path, "PRIVATE search conversation");
  const result = projectKnowledge(root, "search", paths, []);
  expect(result.text).not.toContain("PRIVATE");
  expect(result.sources).toEqual([]);
});
