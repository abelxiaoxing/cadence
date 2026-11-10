/** Recorded investigations rest on the files they cite: which those are,
 * whether they still read the same, and when a question is the same one. */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import {
  changedFiles,
  citedFiles,
  INVESTIGATIONS,
  questionKey,
} from "../src/service/investigations.ts";

function project(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "investigations-"));
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) put(path, text);
  return { root, put };
}

it("an answer's citations are the project files it names, however they are written", () => {
  const p = project({
    "src/export/cursor.ts": "export const page = 20;\n",
    "docs/export.md": "# Export\n",
    "README.md": "# Readme\n",
    ".env": "TOKEN=1\n",
    "src/big.bin": "x",
  });
  symlinkSync(join(p.root, "README.md"), join(p.root, "link.md"));
  const cited = citedFiles(
    p.root,
    [
      "Paging is decided in `src/export/cursor.ts:12` (see ./docs/export.md#Paging).",
      "The entry point is README.md. Also src/export/cursor.ts again,",
      "a directory src/export, a missing file src/none.ts, the secret .env,",
      "a link link.md and something outside ../outside.ts or /etc/passwd.",
    ].join("\n"),
  );
  expect(cited.map((file) => file.path)).toEqual([
    "src/export/cursor.ts",
    "docs/export.md",
    "README.md",
  ]);
  expect(cited.every((file) => /^[0-9a-f]{64}$/u.test(file.digest))).toBe(true);
  // Unchanged: nothing to report. Changed or gone: named.
  expect(changedFiles(p.root, cited)).toEqual([]);
  p.put("src/export/cursor.ts", "export const page = 50;\n");
  rmSync(join(p.root, "docs/export.md"));
  expect(changedFiles(p.root, cited)).toEqual([
    "src/export/cursor.ts",
    "docs/export.md",
  ]);
  // An answer that names no file rests on nothing that can be checked.
  expect(citedFiles(p.root, "It works as the user expects.")).toEqual([]);
});

it("one record keeps a bounded number of citations", () => {
  const files: Record<string, string> = {};
  for (let n = 0; n < INVESTIGATIONS.cited + 8; n++)
    files[`src/f${n}.ts`] = `${n}\n`;
  const p = project(files);
  expect(citedFiles(p.root, Object.keys(files).join(" "))).toHaveLength(
    INVESTIGATIONS.cited,
  );
});

it("the same question about the same directories is recognized whatever its spacing or the order of the directories", () => {
  const key = questionKey("Where is  paging\ndecided?", ["src", "docs"]);
  expect(key).toMatch(/^[0-9a-f]{64}$/u);
  expect(questionKey(" Where is paging decided? ", ["docs", "src"])).toBe(key);
  expect(questionKey("Where is paging decided?", undefined)).not.toBe(key);
  expect(questionKey("Where is paging Decided?", ["src", "docs"])).not.toBe(
    key,
  );
});
