/** The repository's pin refresher: values only, in place, nothing else. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  refreshDestinations,
  repositoryHash,
} from "../scripts/sync-provenance.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const OLD = "0".repeat(64);
/** The file's own layout: other maps reuse the same path names. */
const document = (entries, tail = "") =>
  [
    "{",
    '  "upstream": { "commit": "abc" },',
    '  "sources": {',
    `    "a.ts": "${"f".repeat(64)}"`,
    "  },",
    '  "groups": [{ "destinations": ["a.ts"], "sources": ["a.ts"] }],',
    '  "destinations": {',
    ...entries.map(
      ([path, hash], at) =>
        `    ${JSON.stringify(path)}: "${hash}"${at === entries.length - 1 ? "" : ","}`,
    ),
    `  }${tail}`,
    "}",
    "",
  ].join("\n");

it("only the hashes of pinned destinations change; every other byte, entry and order stays", () => {
  const before = document(
    [
      ["a.ts", OLD],
      ["dir/b with space.ts", sha("b")],
      ["gone.ts", OLD],
    ],
    ',\n  "note": "kept"',
  );
  const contents = { "a.ts": "a", "dir/b with space.ts": "b" };
  const result = refreshDestinations(before, (path) =>
    path in contents ? sha(contents[path]) : null,
  );
  expect(result).toMatchObject({
    total: 3,
    changed: ["a.ts"],
    // An absent file keeps its pin: whether the entry goes is not decided here.
    missing: ["gone.ts"],
  });
  expect(result.text).toBe(
    before.replace(`"a.ts": "${OLD}",`, `"a.ts": "${sha("a")}",`),
  );
  // The upstream pin under the same path name is not a destination.
  expect(JSON.parse(result.text).sources["a.ts"]).toBe("f".repeat(64));
  // A second run has nothing to do.
  expect(
    refreshDestinations(result.text, (path) =>
      path in contents ? sha(contents[path]) : null,
    ),
  ).toMatchObject({ changed: [], text: result.text });
});

it("a layout it does not recognise is refused, never guessed at", () => {
  const hash = () => sha("x");
  expect(() =>
    refreshDestinations('{\n  "destinations": []\n}\n', hash),
  ).toThrow('"destinations" is not an object');
  // Reformatted onto one line: valid JSON, but no block to edit in place.
  expect(() =>
    refreshDestinations(`{ "destinations": { "a.ts": "${OLD}" } }\n`, hash),
  ).toThrow('expected exactly one top-level "destinations" block');
  expect(() =>
    refreshDestinations(
      document([["a.ts", OLD]]).replace(`"${OLD}"`, '"not-a-hash"'),
      hash,
    ),
  ).toThrow('line 8 is not a "path": "sha256" entry');
  // An entry listed twice: JSON keeps the last one, the text has both.
  expect(() =>
    refreshDestinations(
      document([
        ["a.ts", OLD],
        ["a.ts", sha("a")],
      ]),
      hash,
    ),
  ).toThrow("line 8 is not the entry the document has for a.ts");
});

it("a pinned path outside the repository is refused; a missing file is not an error", () => {
  const root = mkdtempSync(join(tmpdir(), "sync-provenance-"));
  try {
    writeFileSync(join(root, "a.ts"), "a");
    expect(repositoryHash(root, "a.ts")).toBe(sha("a"));
    expect(repositoryHash(root, "absent.ts")).toBeNull();
    expect(repositoryHash(root, "a.ts/below")).toBeNull();
    for (const path of ["../outside", "/etc/hostname", "dir/../../outside"])
      expect(() => repositoryHash(root, path)).toThrow(
        "is not a path inside the repository",
      );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("run on a copy of this repository's record it refreshes in place, and --check says what is stale without writing", () => {
  const root = mkdtempSync(join(tmpdir(), "sync-provenance-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "provenance"));
    mkdirSync(join(root, "src"));
    cpSync(
      new URL("../scripts/sync-provenance.mjs", import.meta.url),
      join(root, "scripts/sync-provenance.mjs"),
    );
    writeFileSync(join(root, "src/a.ts"), "a");
    const stale = document([
      ["src/a.ts", OLD],
      ["src/gone.ts", OLD],
    ]);
    const record = join(root, "provenance/webui-reuse.json");
    writeFileSync(record, stale);
    const run = (...args) =>
      spawnSync(process.execPath, ["scripts/sync-provenance.mjs", ...args], {
        cwd: root,
        encoding: "utf8",
      });
    const check = run("--check");
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("the pin of src/a.ts is stale");
    expect(check.stderr).toContain(
      "src/gone.ts is pinned but does not exist; its entry was left as it is",
    );
    expect(readFileSync(record, "utf8")).toBe(stale);
    // As a build step it does not fail on an absent file: the entries are
    // not its to decide, and the project's own check names what is missing.
    const refreshed = run();
    expect(refreshed.status).toBe(0);
    expect(refreshed.stdout).toBe(
      "sync-provenance: refreshed 1 of 2 destination pins\n",
    );
    expect(readFileSync(record, "utf8")).toBe(
      stale.replace(`"src/a.ts": "${OLD}"`, `"src/a.ts": "${sha("a")}"`),
    );
    expect(run("--write").status).not.toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("this repository's own record has the layout the refresher edits, and its declared builds end with it", () => {
  const root = new URL("..", import.meta.url).pathname;
  const text = readFileSync(join(root, "provenance/webui-reuse.json"), "utf8");
  // Whether each pin is current is the package test's to say; here, that the
  // record can be refreshed at all and pins nothing that does not exist.
  const result = refreshDestinations(text, (path) =>
    repositoryHash(root, path),
  );
  expect(result.total).toBe(Object.keys(JSON.parse(text).destinations).length);
  expect(result.missing).toEqual([]);
  const declared = JSON.parse(
    readFileSync(join(root, ".cadence/derived.json"), "utf8"),
  ).build;
  expect(declared.map((b) => b.command)).toEqual([
    "bun scripts/build-operator.mjs",
    "bun scripts/build-service.mjs",
    "node scripts/build-web.mjs",
    "node scripts/sync-provenance.mjs",
  ]);
  // The refresher comes last: it pins what the builds before it wrote.
  expect(declared.at(-1)).toMatchObject({
    refreshes: ["provenance/webui-reuse.json"],
  });
  expect(declared.at(-1).outputs).toBeUndefined();
  // Every derived output it pins is declared by a build before it.
  const outputs = declared.flatMap((b) => b.outputs ?? []);
  for (const path of [
    "web/dist/index.html",
    "src/service-host.mjs",
    "src/native-build.ts",
  ])
    expect(
      outputs.some((o) => path === o || path.startsWith(`${o}/`)),
      path,
    ).toBe(true);
});
