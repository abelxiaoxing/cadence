import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import {
  knowledgeInstructions,
  projectKnowledge,
} from "../src/service/project-knowledge.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cadence-knowledge-"));
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  return { root, put };
}
it("injects real relevant project conventions and ancestor instructions without creating a knowledge system", () => {
  const { root, put } = fixture();
  put("AGENTS.md", "Read engineering/search.md before changing search.");
  put(
    "engineering/search.md",
    "Chinese search tokenization must preserve user data. Test search-query.test.ts.",
  );
  put(
    "engineering/releases.md",
    "Historic release unrelated to this assignment.",
  );
  put("src/AGENTS.md", "Keep source conventions.");
  const result = projectKnowledge(
    root,
    "Chinese search",
    ["src/search.ts"],
    [],
  );
  expect(result.sources.map((s) => s.path)).toContain("engineering/search.md");
  expect(result.text).toContain("preserve user data");
  expect(result.text).toContain("Keep source conventions");
  expect(result.sources.every((s) => /^[a-f0-9]{64}$/.test(s.digest))).toBe(
    true,
  );
  expect(readdirSync(root)).not.toContain(".cadence");
});
it("the next worker gets updated source knowledge rather than a stale cached conclusion", () => {
  const { root, put } = fixture();
  put("docs/search.md", "Search uses the old adapter.");
  const a = projectKnowledge(root, "search", [], []);
  put("docs/search.md", "Search uses the verified replacement adapter.");
  const b = projectKnowledge(root, "search", [], []);
  expect(b.text).toContain("verified replacement");
  expect(b.sources[0].digest).not.toBe(a.sources[0].digest);
});
it("supports existing Trellis specs without installing hooks, importing sessions or copying templates", () => {
  const { root, put } = fixture();
  put(".trellis/spec/backend/index.md", "Search invariants and validation.");
  put(
    ".trellis/workspace/person/journal.md",
    "PRIVATE raw conversation search",
  );
  const result = projectKnowledge(root, "search", [], []);
  expect(result.text).toContain("Search invariants");
  expect(result.text).not.toContain("PRIVATE");
  expect(
    readFileSync(join(root, ".trellis/workspace/person/journal.md"), "utf8"),
  ).toContain("PRIVATE");
});
it("labels excerpts and omitted sources, redacts known secrets, and refuses symlinks", () => {
  const { root, put } = fixture();
  put("AGENTS.md", "Policy ".repeat(3000));
  put("docs/search.md", "search fixture-secret-value");
  const external = fixture();
  external.put("private.md", "external secret search");
  symlinkSync(join(external.root, "private.md"), join(root, "docs/linked.md"));
  const result = projectKnowledge(root, "search", [], ["fixture-secret-value"]);
  expect(result.text).not.toContain("fixture-secret-value");
  expect(result.text).not.toContain("external secret");
  expect(result.sources.find((s) => s.path === "AGENTS.md")?.truncated).toBe(
    true,
  );
  expect(result.text).toContain("read the file for full context");
  const small = projectKnowledge(root, "search", [], [], 500);
  expect(small.omitted.some((s) => s.includes("load on demand"))).toBe(true);
});
it("knowledge maintenance calls for evidence and existing topic owners, not guessed planning prose", () => {
  const text = knowledgeInstructions(["engineering/search.md"]);
  expect(text).toContain("actual implemented files");
  expect(text).toContain("existing topic owner");
  expect(text).toContain("Preserve human text");
  expect(text).toContain("not the initial plan");
  expect(text).toContain("Do not modify implementation code");
});

it("known secrets in document filenames do not leak through manifests or omission notices", () => {
  const { root, put } = fixture();
  put("docs/fixture-secret-path.md", "Search fact");
  const result = projectKnowledge(root, "search", [], ["fixture-secret-path"]);
  expect(JSON.stringify(result)).not.toContain("fixture-secret-path");
  expect(result.omitted).toContain("Protected document path omitted");
});
