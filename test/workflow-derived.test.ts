/** What a replay left unmerged, sorted by who can settle it. Pure; the Git
 * that produces it is in merge-queue-delivery.test.ts. */
import { expect, it } from "vitest";
import type { WorkflowBuild } from "../src/service/contracts/workflow.ts";
import {
  classifyConflicts,
  conflictMarkers,
  describeConflict,
  parseUnmerged,
  refreshers,
} from "../src/service/workflow-derived.ts";

const A = "a".repeat(40),
  B = "b".repeat(40),
  C = "c".repeat(40);
const builds: WorkflowBuild[] = [
  { name: "bundle", command: "make dist", outputs: ["dist", "gen.ts"] },
  { name: "pins", command: "make pins", outputs: [], refreshes: ["pins.json"] },
  {
    name: "lock",
    command: "make lock",
    outputs: ["lock.bin"],
    refreshes: ["pins.json", "other.json"],
  },
];

it("reads Git's unmerged entries into the three sides of each path", () => {
  const listed = [
    `100644 ${A} 1\tsrc/a.ts`,
    `100644 ${B} 2\tsrc/a.ts`,
    `100755 ${C} 3\tsrc/a.ts`,
    // Both added: no common ancestor.
    `100644 ${B} 2\tnew file.ts`,
    `100644 ${C} 3\tnew file.ts`,
    // Deleted on the branch.
    `100644 ${A} 1\tgone.ts`,
    `100644 ${C} 3\tgone.ts`,
    "",
  ].join("\0");
  expect(parseUnmerged(listed)).toEqual([
    {
      path: "gone.ts",
      base: { mode: "100644", oid: A },
      theirs: { mode: "100644", oid: C },
    },
    {
      path: "new file.ts",
      ours: { mode: "100644", oid: B },
      theirs: { mode: "100644", oid: C },
    },
    {
      path: "src/a.ts",
      base: { mode: "100644", oid: A },
      ours: { mode: "100644", oid: B },
      theirs: { mode: "100755", oid: C },
    },
  ]);
  expect(parseUnmerged("")).toEqual([]);
  expect(() => parseUnmerged(`100644 ${A} 4\tx`)).toThrow();
  expect(() => parseUnmerged("not an entry")).toThrow();
});

it("sorts conflicts by who settles them: a rebuild, a recomputation, a worker, or a decision", () => {
  const file = (path: string, sides = "bot") => ({
    path,
    ...(sides.includes("b") ? { base: { mode: "100644", oid: A } } : {}),
    ...(sides.includes("o") ? { ours: { mode: "100644", oid: B } } : {}),
    ...(sides.includes("t") ? { theirs: { mode: "100644", oid: C } } : {}),
  });
  const link = { ...file("src/link"), theirs: { mode: "120000", oid: C } };
  const submodule = {
    path: "vendor/lib",
    base: { mode: "160000", oid: A },
    ours: { mode: "160000", oid: B },
    theirs: { mode: "160000", oid: C },
  };
  const sorted = classifyConflicts(
    [
      file("dist/app.js"),
      file("gen.ts", "ot"),
      file("pins.json"),
      // Created on both sides: nothing to recompute a common ancestor from.
      file("other.json", "ot"),
      file("src/a.ts"),
      file("src/added-by-both.ts", "ot"),
      file("src/deleted-on-branch.ts", "bt"),
      file("src/deleted-by-delivery.ts", "bo"),
      link,
      submodule,
    ],
    builds,
  );
  const paths = (list: { path: string }[]) => list.map((e) => e.path);
  expect(paths(sorted.derived)).toEqual(["dist/app.js", "gen.ts"]);
  expect(paths(sorted.refresh)).toEqual(["pins.json"]);
  // Created on both sides, Git still wrote both versions into the file.
  expect(paths(sorted.text)).toEqual([
    "other.json",
    "src/a.ts",
    "src/added-by-both.ts",
  ]);
  expect(paths(sorted.other)).toEqual([
    "src/deleted-on-branch.ts",
    "src/deleted-by-delivery.ts",
    "src/link",
    "vendor/lib",
  ]);
  expect(sorted.other.map(describeConflict)).toEqual([
    "src/deleted-on-branch.ts: deleted on the branch, changed by this delivery",
    "src/deleted-by-delivery.ts: changed on the branch, deleted by this delivery",
    "src/link: not a regular file on one side (a link or a changed file type)",
    "vendor/lib: a submodule pointer both sides moved",
  ]);
  // Without declared builds everything two sides have is text.
  expect(paths(classifyConflicts([file("dist/app.js")], []).text)).toEqual([
    "dist/app.js",
  ]);
});

it("the commands that recompute a file's values are the ones that declare it, in order", () => {
  expect(refreshers(builds, "pins.json").map((b) => b.name)).toEqual([
    "pins",
    "lock",
  ]);
  expect(refreshers(builds, "other.json").map((b) => b.name)).toEqual(["lock"]);
  expect(refreshers(builds, "dist/app.js")).toEqual([]);
});

it("the lines Git wrote around a conflict are told apart from a document's own rules", () => {
  const text = [
    "Title",
    "=======",
    "<<<<<<< HEAD",
    "the branch",
    "||||||| parent of 1234567 (Cadence: goal)",
    "the ancestor",
    "=======",
    "the delivery",
    ">>>>>>> 1234567 (Cadence: goal)",
    "<<<<<<<not a marker",
    ">>>>>>> ",
    "",
  ];
  expect(conflictMarkers(text.join("\n"))).toEqual([
    "<<<<<<< HEAD",
    "||||||| parent of 1234567 (Cadence: goal)",
    ">>>>>>> 1234567 (Cadence: goal)",
  ]);
  expect(conflictMarkers(text.join("\r\n"))).toHaveLength(3);
  // Reconciled: the heading's underline stays, no labelled line does.
  expect(conflictMarkers("Title\n=======\nboth\n")).toEqual([]);
});
