/** The managed knowledge store: its route table, topic cards, budget and the
 * deterministic checks a delivery must pass. Files only; nothing is executed. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import {
  KNOWLEDGE_STORE,
  knowledgeEntries,
  knowledgeRoutes,
  knowledgeSection,
  lintKnowledge,
  matchKnowledgeRoutes,
  readKnowledgeStore,
} from "../src/service/knowledge-store.ts";
import { projectKnowledge } from "../src/service/project-knowledge.ts";

function project(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "knowledge-store-"));
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) put(path, text);
  return { root, put, drop: (path: string) => rmSync(join(root, path)) };
}
const TABLE = `# Project knowledge

Where things are decided. Keep it short.

## Routes

- \`src/delivery\`, \`test/delivery\` -> \`.cadence/knowledge/delivery.md#Scheduling\` — how assignments are scheduled
- \`web/src\` -> \`docs/ui.md\` — what the interface may show
- \`src/legacy/**\` → \`.cadence/knowledge/delivery.md\`: older pipeline notes
`;
const TOPIC = `# Delivery

## Scheduling

### Assignments that run together never share a write path
Kind: contract
Why: a picked commit must not conflict.
Anchors: \`src/delivery/schedule.ts#contended\`, \`test/delivery/schedule.test.ts\`
Source: delivery 876fc6f, 2026-11-10

### A lone assignment runs in the candidate
Kind: practice
Why: a serial plan creates no other worktree.
Anchors: \`src/delivery/schedule.ts#inCandidate\`

## Integration

### Picks keep one parent
Kind: contract
Anchors: \`src/delivery/integrate.ts\`
`;
const files = () => ({
  ".cadence/project.md": TABLE,
  ".cadence/knowledge/delivery.md": TOPIC,
  "docs/ui.md": "# Interface\n\nWhat may be shown.\n",
  "src/delivery/schedule.ts":
    "export const contended = 1;\nexport const inCandidate = 2;\n",
  "src/delivery/integrate.ts": "export const pick = 1;\n",
  "test/delivery/schedule.test.ts": "it('schedules', () => {});\n",
});

it("the route table names, per code area, the document and section to read first", () => {
  const { routes, unparsed } = knowledgeRoutes(
    `${TABLE}- not a route at all\n- \`src/x\` -> nowhere\n`,
  );
  expect(routes).toEqual([
    {
      patterns: ["src/delivery", "test/delivery"],
      target: ".cadence/knowledge/delivery.md",
      section: "Scheduling",
      summary: "how assignments are scheduled",
    },
    {
      patterns: ["web/src"],
      target: "docs/ui.md",
      section: null,
      summary: "what the interface may show",
    },
    {
      patterns: ["src/legacy"],
      target: ".cadence/knowledge/delivery.md",
      section: null,
      summary: "older pipeline notes",
    },
  ]);
  expect(unparsed).toEqual(["- not a route at all", "- `src/x` -> nowhere"]);
  // A write path under a route's area, or a directory that contains it, matches.
  const targets = (writes: string[]) =>
    matchKnowledgeRoutes(routes, writes).map((r) => r.target);
  expect(targets(["src/delivery/schedule.ts"])).toEqual([
    ".cadence/knowledge/delivery.md",
  ]);
  expect(targets(["src"])).toEqual([
    ".cadence/knowledge/delivery.md",
    ".cadence/knowledge/delivery.md",
  ]);
  expect(targets(["web/src/App.tsx", "README.md"])).toEqual(["docs/ui.md"]);
  expect(targets(["src/deliveryx/a.ts", "docs/guide.md"])).toEqual([]);
});

it("a section is addressed by its heading and ends at the next heading of its level", () => {
  expect(knowledgeSection(TOPIC, "Scheduling")).toContain(
    "A lone assignment runs in the candidate",
  );
  expect(knowledgeSection(TOPIC, "scheduling")).not.toContain("## Integration");
  expect(knowledgeSection(TOPIC, "Integration")).toBe(
    "## Integration\n\n### Picks keep one parent\nKind: contract\nAnchors: `src/delivery/integrate.ts`",
  );
  expect(knowledgeSection(TOPIC, "Absent")).toBeNull();
  // A heading inside a code fence is not a heading.
  expect(knowledgeSection("# A\n\n```md\n## B\n```\n\ntext\n", "B")).toBeNull();
});

it("a topic is read as entries with their section and anchors", () => {
  const entries = knowledgeEntries(".cadence/knowledge/delivery.md", TOPIC);
  expect(entries.map((e) => [e.section, e.title, e.anchors.length])).toEqual([
    ["Scheduling", "Assignments that run together never share a write path", 2],
    ["Scheduling", "A lone assignment runs in the candidate", 1],
    ["Integration", "Picks keep one parent", 1],
  ]);
  expect(entries[0].anchors).toEqual([
    { path: "src/delivery/schedule.ts", symbol: "contended" },
    { path: "test/delivery/schedule.test.ts", symbol: null },
  ]);
  expect(entries.every((e) => e.bytes > 0 && e.bytes < 400)).toBe(true);
});

it("a store inside its budget with resolvable references has nothing to report", () => {
  const p = project(files());
  const store = readKnowledgeStore(p.root);
  expect(store.index?.routes).toHaveLength(3);
  expect(store.topics.map((t) => t.path)).toEqual([
    ".cadence/knowledge/delivery.md",
  ]);
  const lint = lintKnowledge(p.root, []);
  expect(lint.findings).toEqual([]);
  expect(lint.revalidate).toEqual([]);
  expect(lint.usage.totalBytes).toBe(
    Buffer.byteLength(TABLE) + Buffer.byteLength(TOPIC),
  );
  // A project without a store is simply empty, not an error.
  expect(lintKnowledge(project({}).root, [])).toMatchObject({
    findings: [],
    usage: { totalBytes: 0, indexBytes: 0, topics: [] },
  });
});

it("the budget always holds: a route table, topic, entry or store over it fails the delivery", () => {
  const filler = (bytes: number) => "x".repeat(bytes);
  const oversized = (path: string, text: string, expected: string) => {
    const p = project({ ...files(), [path]: text });
    const blocking = lintKnowledge(p.root, []).findings.filter(
      (f) => f.kind === "over-budget",
    );
    expect(blocking.length, path).toBeGreaterThan(0);
    expect(blocking.every((f) => f.blocking)).toBe(true);
    expect(blocking.map((f) => f.detail).join(" ")).toContain(expected);
  };
  oversized(
    ".cadence/project.md",
    `${TABLE}\n${filler(KNOWLEDGE_STORE.indexBytes)}\n`,
    "the route table is",
  );
  oversized(
    ".cadence/knowledge/big.md",
    `# Big\n\n### One\nAnchors: \`docs/ui.md\`\n${filler(KNOWLEDGE_STORE.entryBytes)}\n`,
    'entry "One" is',
  );
  oversized(
    ".cadence/knowledge/long.md",
    `# Long\n\n${Array.from({ length: 12 }, (_, i) => `### Entry ${i}\nAnchors: \`docs/ui.md\`\n${filler(800)}\n`).join("\n")}`,
    "the topic is",
  );
  const many = project(files());
  for (let i = 0; i < 30; i++)
    many.put(
      `.cadence/knowledge/t${i}.md`,
      `# T${i}\n\n${Array.from({ length: 9 }, (_, n) => `### E${n}\nAnchors: \`docs/ui.md\`\n${filler(760)}\n`).join("\n")}`,
    );
  expect(
    lintKnowledge(many.root, [])
      .findings.map((f) => f.detail)
      .join(" "),
  ).toContain("the store is");
});

it("a broken reference fails only the delivery that wrote it or moved its target; elsewhere it is a note, and touched code asks for a recheck", () => {
  const p = project(files());
  p.drop("src/delivery/integrate.ts");
  p.put("docs/ui.md", "# Interface\n");
  p.put(
    ".cadence/project.md",
    TABLE.replace("`docs/ui.md`", "`docs/ui.md#Colours`"),
  );
  // Somebody else's delivery: nothing here was written or moved by it.
  const idle = lintKnowledge(p.root, ["README.md"]);
  expect(idle.findings.map((f) => [f.kind, f.blocking])).toEqual([
    ["dead-route", false],
    ["dead-anchor", false],
  ]);
  // This delivery removed the anchored file: its own breakage.
  const mover = lintKnowledge(p.root, ["src/delivery/integrate.ts"]);
  expect(mover.findings.find((f) => f.kind === "dead-anchor")).toMatchObject({
    blocking: true,
    detail: expect.stringContaining("src/delivery/integrate.ts"),
  });
  // This delivery edited the table: its routes must resolve.
  expect(
    lintKnowledge(p.root, [".cadence/project.md"]).findings.find(
      (f) => f.kind === "dead-route",
    ),
  ).toMatchObject({ blocking: true });
  // Code an entry is about changed: the entry is to be checked again.
  const touched = lintKnowledge(p.root, ["src/delivery/schedule.ts"]);
  expect(touched.revalidate.map((e) => e.title)).toEqual([
    "Assignments that run together never share a write path",
    "A lone assignment runs in the candidate",
  ]);
  // A symbol that left the file is a dead anchor even though the file exists.
  p.put("src/delivery/schedule.ts", "export const inCandidate = 2;\n");
  expect(
    lintKnowledge(p.root, ["src/delivery/schedule.ts"]).findings.some(
      (f) => f.kind === "dead-anchor" && f.detail.includes("#contended"),
    ),
  ).toBe(true);
});

it("an entry a delivery writes needs an anchor and a title of its own", () => {
  const p = project(files());
  p.put(
    ".cadence/knowledge/notes.md",
    "# Notes\n\n### Same\nAnchors: `docs/ui.md`\n\n### Same\nAnchors: `docs/ui.md`\n\n### Bare\nNo evidence named.\n",
  );
  const kinds = (changed: string[]) =>
    lintKnowledge(p.root, changed)
      .findings.filter((f) => f.path.endsWith("notes.md"))
      .map((f) => [f.kind, f.blocking]);
  expect(kinds([".cadence/knowledge/notes.md"])).toEqual([
    ["duplicate", true],
    ["unanchored", true],
  ]);
  expect(kinds([])).toEqual([
    ["duplicate", false],
    ["unanchored", false],
  ]);
});

it("a worker receives the route table, then what the agreement names, then what the table routes its write paths to; discovery only fills the rest", () => {
  const p = project({
    ...files(),
    "AGENTS.md": "# Rules\n\nAlways run the checks.\n",
    "docs/guide.md": `# Guide\n\n## Setup\n\n${"setup detail. ".repeat(40)}\n\n## Limits\n\nThe limit is 16.\n`,
  });
  const context = projectKnowledge(
    p.root,
    "change the scheduler",
    ["src/delivery/schedule.ts"],
    [],
    12 * 1024,
    {
      reads: [
        {
          path: "docs/guide.md",
          section: "Limits",
          reason: "Bounds that apply",
        },
        {
          research: "0f8b1a52-7a3c-4f0e-9d51-2f6c1e7a9b10",
          reason: "resolved elsewhere",
        },
      ],
      extra: [
        {
          label: "investigation 0f8b1a52",
          reason: "Recorded investigation: where scheduling happens",
          body: "Scheduling is in src/delivery/schedule.ts.",
        },
      ],
    },
  );
  expect(context.sources.map((s) => s.path).slice(0, 4)).toEqual([
    ".cadence/project.md",
    "docs/guide.md#Limits",
    "investigation 0f8b1a52",
    ".cadence/knowledge/delivery.md#Scheduling",
  ]);
  expect(context.text).toContain("The limit is 16.");
  // Only the section that was named, not the rest of the document.
  expect(context.text).not.toContain("setup detail.");
  expect(context.text).toContain("Named by the agreement: Bounds that apply");
  expect(context.text).toContain(
    "Routed for src/delivery, test/delivery: how assignments are scheduled",
  );
  expect(context.text).not.toContain("Picks keep one parent");
  expect(context.sources.map((s) => s.path)).toContain("AGENTS.md");
  // A named document that is missing is said to be missing.
  const missing = projectKnowledge(p.root, "x", [], [], 12 * 1024, {
    reads: [{ path: "docs/absent.md", reason: "r" }],
  });
  expect(missing.omitted).toContain(
    "docs/absent.md: absent, unsafe or unreadable",
  );
});

it("a long document contributes the sections about the reader's terms, and a Chinese goal still matches Chinese documents", () => {
  const p = project({
    "AGENTS.md": `# 规则\n\n## 构建\n\n${"构建相关的说明。".repeat(400)}\n\n## 调度器\n\n并行任务的调度规则：同时运行的任务不能写同一个路径。\n\n## 发布\n\n${"发布相关的说明。".repeat(400)}\n`,
  });
  const context = projectKnowledge(
    p.root,
    "请修改并行调度器的排队策略",
    ["src/x.ts"],
    [],
    12 * 1024,
  );
  const agents = context.sources.find((s) => s.path === "AGENTS.md");
  expect(agents?.truncated).toBe(true);
  expect(agents?.excerpt).toContain("同时运行的任务不能写同一个路径");
  expect(Buffer.byteLength(agents?.excerpt ?? "")).toBeLessThanOrEqual(4096);
});

it("named sources that do not fit keep their reason as a pointer", () => {
  const p = project({
    ...files(),
    "docs/big.md": `# Big\n\n${"detail ".repeat(3000)}\n`,
  });
  const context = projectKnowledge(p.root, "x", [], [], 2048, {
    reads: [
      { path: "docs/ui.md", reason: "Small and first" },
      { path: "docs/big.md", reason: "Too large for what is left" },
    ],
  });
  expect(context.sources.map((s) => s.path)).toContain("docs/ui.md");
  expect(Buffer.byteLength(context.text)).toBeLessThanOrEqual(2048);
  expect(context.text).toMatch(
    /load\s+on\s+demand|load relevant files on demand/u,
  );
});
