// @module-tag slow
/** Deliveries landing on a real repository: the branch itself is the frontier,
 * a moved branch is taken in by replay, and the user's checkout is touched
 * only by Git's own fast-forward. Real Git throughout; workers are stand-ins. */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { repository } from "./helpers/delivery-engine.ts";

const lines = (text: string) => text.trimEnd().split("\n");

it("two deliveries to one branch, one after the other: the second replays onto what the first left and is verified again", async () => {
  const r = repository();
  const x = r.delivery("change two"),
    y = r.delivery("change b");
  await x.create();
  await y.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  writeFileSync(join(y.cwd, "b.txt"), "B\n");
  // Both verified in isolation on the same baseline, in parallel.
  await Promise.all([x.accept(), y.accept()]);
  expect(x.reviewed).toHaveLength(1);
  expect(y.reviewed).toHaveLength(1);
  expect(r.git("rev-parse", "HEAD")).toBe(x.base);

  await x.land();
  await y.land();
  const [second, first, base] = lines(r.git("log", "--format=%H", "-3"));
  expect(base).toBe(x.base);
  expect(first).toBe(x.live.run.mergedCommit);
  expect(second).toBe(y.live.run.mergedCommit);
  // Each is one commit with one parent; nothing was merged with a merge commit.
  expect(r.git("show", "-s", "--format=%P", second)).toBe(first);
  expect(r.git("show", "-s", "--format=%s", first)).toBe("Cadence: change two");
  expect(r.git("diff", "--name-only", first, second)).toBe("b.txt");
  // The first landed exactly what was verified; the second was verified again
  // as the commit that landed.
  expect(x.reviewed).toEqual([first]);
  expect(y.reviewed).toHaveLength(2);
  expect(y.reviewed[1]).toBe(second);
  // The user's checkout followed by fast-forward.
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toContain("TWO");
  expect(readFileSync(join(r.root, "b.txt"), "utf8")).toBe("B\n");
  expect(r.git("status", "--porcelain")).toBe("");
  // Task branches hold what landed; candidates are clean and detached.
  expect(r.git("rev-parse", x.view.taskBranch)).toBe(first);
  expect(r.git("rev-parse", y.view.taskBranch)).toBe(second);
  expect(r.gitAt(y.cwd, "status", "--porcelain")).toBe("");
  expect(y.view.integration).toMatchObject({
    status: "applied",
    before: first,
    after: second,
    sync: { mode: "fast-forward", worktree: r.root },
  });
  expect(r.queue.busy).toBe(false);
});

it("the same file changed in different places by a delivery and by the branch merges without anyone resolving anything", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  // The user commits to the same file, far enough away.
  writeFileSync(join(r.root, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
  r.git("commit", "-qam", "my own change");
  const mine = r.git("rev-parse", "HEAD");
  await x.land();
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe(
    "one\nTWO\nthree\nfour\nFIVE\n",
  );
  expect(r.git("show", "-s", "--format=%P", "HEAD")).toBe(mine);
  expect(x.reviewed).toHaveLength(2);
});

it("a checkout that switched to another branch is not touched: the target moves by reference alone", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  r.git("switch", "-qc", "debug-y");
  writeFileSync(join(r.root, "a.txt"), "my debugging mess\n");
  writeFileSync(join(r.root, "scratch.txt"), "untracked\n");
  await x.land();
  // The branch has the delivery; the checkout is exactly as the user left it.
  expect(r.git("rev-parse", r.BRANCH)).toBe(x.live.run.mergedCommit);
  expect(r.git("symbolic-ref", "HEAD")).toBe("refs/heads/debug-y");
  expect(r.git("rev-parse", "HEAD")).toBe(x.base);
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe(
    "my debugging mess\n",
  );
  expect(existsSync(join(r.root, "scratch.txt"))).toBe(true);
  expect(x.view.integration.sync).toEqual({ mode: "ref", worktree: null });
  // Exactly the verified commit: nothing had to be replayed.
  expect(x.reviewed).toEqual([x.live.run.mergedCommit]);
});

it("uncommitted and staged changes to other files survive the fast-forward exactly", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  writeFileSync(join(r.root, "b.txt"), "staged by me\n");
  r.git("add", "b.txt");
  writeFileSync(join(r.root, "b.txt"), "staged by me\nand more, unstaged\n");
  writeFileSync(join(r.root, "notes.txt"), "untracked\n");
  await x.land();
  expect(r.git("rev-parse", "HEAD")).toBe(x.live.run.mergedCommit);
  expect(lines(r.git("status", "--porcelain"))).toEqual([
    "MM b.txt",
    "?? notes.txt",
  ]);
  expect(r.git("show", ":b.txt")).toBe("staged by me");
  expect(readFileSync(join(r.root, "b.txt"), "utf8")).toBe(
    "staged by me\nand more, unstaged\n",
  );
});

it("rule files the branch changed are remembered for every later review", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  writeFileSync(join(r.root, "AGENTS.md"), "# Rules\nNo shouting.\n");
  r.git("add", "AGENTS.md");
  r.git("commit", "-qm", "new rule");
  const frontier = r.git("rev-parse", "HEAD");
  await x.land();
  expect(x.live.rules).toEqual({
    from: x.base,
    to: frontier,
    paths: ["AGENTS.md"],
  });
  // The candidate's own worktree now holds the current rules for its workers.
  expect(r.git("show", `${x.live.run.mergedCommit}:AGENTS.md`)).toContain(
    "No shouting.",
  );
  expect(await x.engine.rulesBrief(x.live, r.root)).toContain("+No shouting.");
});

it("a target whose history was rewritten is followed like any other move", async () => {
  const r = repository();
  r.git("commit", "-q", "--allow-empty", "-m", "to be reworded");
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  // The baseline commit is rewritten away: it is no ancestor of the branch.
  r.git("commit", "-q", "--amend", "--allow-empty", "-m", "reworded");
  const rewritten = r.git("rev-parse", "HEAD");
  expect(rewritten).not.toBe(x.base);
  await x.land();
  expect(r.git("show", "-s", "--format=%P", "HEAD")).toBe(rewritten);
  expect(r.git("rev-parse", x.view.taskBranch)).toBe(x.live.run.mergedCommit);
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toContain("TWO");
});

it("the same line changed on both sides goes to a worker with both versions marked; its result is verified again and lands", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  writeFileSync(join(r.root, "a.txt"), "one\ntwo, my way\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "the same line");
  const mine = r.git("rev-parse", "HEAD");
  let seen = "";
  x.hooks.repair = ({ cwd, writes }) => {
    expect(writes).toEqual(["a.txt"]);
    seen = readFileSync(join(cwd, "a.txt"), "utf8");
    writeFileSync(join(cwd, "a.txt"), "one\nTWO, my way\nthree\nfour\nfive\n");
  };
  await x.land();
  // Git wrote the branch's text, the common ancestor's and the delivery's.
  expect(seen).toBe(
    [
      "one",
      "<<<<<<< HEAD",
      "two, my way",
      `||||||| parent of ${x.reviewed[0].slice(0, 7)} (Cadence: change two)`,
      "two",
      "=======",
      "TWO",
      `>>>>>>> ${x.reviewed[0].slice(0, 7)} (Cadence: change two)`,
      "three",
      "four",
      "five",
      "",
    ].join("\n"),
  );
  const repair = x.asked.find((a) => a.kind === "repair");
  expect(repair?.prompt).toContain("could not merge these files: a.txt");
  expect(repair?.prompt).toContain("the same line");
  // No diagnosis was needed for the first answer.
  expect(x.asked.map((a) => a.kind)).toEqual(["review", "repair", "review"]);
  expect(r.git("show", "-s", "--format=%P", "HEAD")).toBe(mine);
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe(
    "one\nTWO, my way\nthree\nfour\nfive\n",
  );
  expect(r.git("status", "--porcelain")).toBe("");
  // The second review is pointed at the branch's side and at the hand merge.
  const review = x.asked.at(-1)?.prompt ?? "";
  expect(review).toContain("Both changed: a.txt.");
  expect(review).toContain(
    "Git could not merge a.txt; a worker reconciled them by hand.",
  );
  expect(x.live.merging).toBeUndefined();
  expect(r.queue.busy).toBe(false);
});

it("a marked line left in a file is not a reconciliation: nothing is staged, and recovery decides how to go on", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  writeFileSync(join(r.root, "a.txt"), "one\ntwo, my way\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "the same line");
  let repairs = 0;
  x.hooks.repair = ({ cwd }) => {
    // The first worker drops the closing marker's region but leaves the opening one.
    writeFileSync(
      join(cwd, "a.txt"),
      ++repairs === 1
        ? "one\n<<<<<<< HEAD\nTWO, my way\nthree\nfour\nfive\n"
        : "one\nTWO, my way\nthree\nfour\nfive\n",
    );
  };
  let told = "";
  x.hooks.diagnose = (prompt, failed) => {
    told = prompt;
    return {
      action: "continue",
      cause: "a marker was left behind",
      evidence: [failed],
      strategy: "finish the reconciliation",
      work: [
        {
          title: "finish",
          instructions: "remove the marker",
          writes: ["a.txt"],
        },
      ],
    };
  };
  await x.land();
  expect(repairs).toBe(2);
  expect(told).toContain(
    "Lines Git marked as conflicting are still in: a.txt.",
  );
  expect(told).toContain('Level "repair" reconciles those paths in place');
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toContain("TWO, my way");
});

it("a replan gives the merge up: the worktree is the branch's head again, and the work is done once more there", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  writeFileSync(join(x.cwd, "b.txt"), "B by the delivery\n");
  writeFileSync(join(x.cwd, "new.txt"), "added by the delivery\n");
  x.live.run.scope?.push("new.txt");
  await x.accept();
  const sealed = x.head();
  writeFileSync(join(r.root, "a.txt"), "one\ntwo, my way\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "the same line");
  const mine = r.git("rev-parse", "HEAD");
  let repairs = 0;
  let found: string[] = [];
  x.hooks.repair = ({ cwd }) => {
    // The first worker gives up without touching anything.
    if (++repairs === 1) return;
    // By now the merge is gone: nothing of the delivery is left here.
    found = [
      r.gitAt(cwd, "status", "--porcelain"),
      r.gitAt(cwd, "rev-parse", "HEAD"),
      readFileSync(join(cwd, "b.txt"), "utf8"),
      String(existsSync(join(cwd, "new.txt"))),
    ];
    writeFileSync(
      join(cwd, "a.txt"),
      "one\nTWO, done again\nthree\nfour\nfive\n",
    );
  };
  x.hooks.diagnose = (_prompt, failed) => ({
    action: "continue",
    level: "replan",
    cause: "the two changes cannot be combined line by line",
    evidence: [failed],
    strategy: "do the change again on the branch as it is now",
    work: [
      {
        title: "redo",
        instructions: "apply the goal again",
        writes: ["a.txt"],
      },
    ],
  });
  await x.land();
  expect(found).toEqual(["", mine, "b\n", "false"]);
  expect(x.live.notes.join("\n")).toContain(
    `The earlier result is commit ${sealed}.`,
  );
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toContain("done again");
  // The earlier result is still there to read.
  expect(r.git("cat-file", "-t", sealed)).toBe("commit");
  expect(r.git("show", "-s", "--format=%P", "HEAD")).toBe(mine);
});

it("a file one side deleted and the other changed goes to a decision, said as what it is, and is staged as its work left it", async () => {
  const r = repository();
  const x = r.delivery("change b");
  await x.create();
  writeFileSync(join(x.cwd, "b.txt"), "B by the delivery\n");
  await x.accept();
  r.git("rm", "-q", "b.txt");
  r.git("commit", "-qm", "b is gone");
  let told = "";
  x.hooks.diagnose = (prompt, failed) => {
    told = prompt;
    return {
      action: "continue",
      cause: "the branch removed the file on purpose",
      evidence: [failed],
      strategy: "keep it removed",
      work: [
        { title: "drop", instructions: "remove b.txt", writes: ["b.txt"] },
      ],
    };
  };
  x.hooks.repair = ({ cwd }) => rmSync(join(cwd, "b.txt"), { force: true });
  await x.land();
  expect(told).toContain(
    "b.txt: deleted on the branch, changed by this delivery",
  );
  // No marked lines, so no worker was sent before the decision.
  expect(x.asked.map((a) => a.kind)).toEqual([
    "review",
    "diagnosis",
    "repair",
    "review",
  ]);
  expect(existsSync(join(r.root, "b.txt"))).toBe(false);
  expect(r.git("status", "--porcelain")).toBe("");
});

/** A repository whose build derives `dist/app.js` from the sources and pins
 * the content of listed files in `pins.txt`. */
const derived = () => {
  const r = repository();
  mkdirSync(join(r.root, "dist"));
  writeFileSync(
    join(r.root, "build.sh"),
    "#!/bin/sh\ncat a.txt b.txt > dist/app.js\n",
    { mode: 0o755 },
  );
  writeFileSync(
    join(r.root, "pin.sh"),
    '#!/bin/sh\nwhile IFS="=" read -r k v; do [ -n "$k" ] && printf "%s=%s\\n" "$k" "$(git hash-object "$k" | cut -c1-8)"; done < pins.txt > pins.next && mv pins.next pins.txt\n',
    { mode: 0o755 },
  );
  writeFileSync(join(r.root, "pins.txt"), "a.txt=0\nb.txt=0\ndist/app.js=0\n");
  spawnSync("/bin/sh", ["-c", "./build.sh && ./pin.sh"], { cwd: r.root });
  r.git("add", "-A");
  r.git("commit", "-qm", "build");
  const build = [
    { name: "bundle", command: "./build.sh", outputs: ["dist"] },
    { name: "pins", command: "./pin.sh", outputs: [], refreshes: ["pins.txt"] },
  ];
  const scope = ["a.txt", "b.txt", "c.txt"];
  /** The user's own commit: sources changed, outputs rebuilt and pinned. */
  const commit = (message: string) => {
    spawnSync("/bin/sh", ["-c", "./build.sh && ./pin.sh"], { cwd: r.root });
    r.git("add", "-A");
    r.git("commit", "-qm", message);
    return r.git("rev-parse", "HEAD");
  };
  return { r, build, scope, commit };
};

it("derived outputs are rebuilt, never merged, and a pinned value both sides changed is recomputed instead of reconciled", async () => {
  const { r, build, scope, commit } = derived();
  const x = r.delivery("change two", { build, scope });
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  // Sealed with its own bundle and pins.
  expect(r.git("show", `${x.head()}:dist/app.js`)).toContain("TWO");
  writeFileSync(join(r.root, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
  const mine = commit("my own change");
  await x.land();
  // Both sides changed the bundle and the pins of a.txt and of the bundle;
  // nobody was asked about any of it.
  expect(x.asked.map((a) => a.kind)).toEqual(["review", "review"]);
  expect(r.git("show", "-s", "--format=%P", "HEAD")).toBe(mine);
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe(
    "one\nTWO\nthree\nfour\nFIVE\n",
  );
  expect(readFileSync(join(r.root, "dist/app.js"), "utf8")).toBe(
    "one\nTWO\nthree\nfour\nFIVE\nb\n",
  );
  const pin = (path: string) =>
    `${path}=${r.git("hash-object", path).slice(0, 8)}`;
  expect(readFileSync(join(r.root, "pins.txt"), "utf8")).toBe(
    `${pin("a.txt")}\n${pin("b.txt")}\n${pin("dist/app.js")}\n`,
  );
  expect(r.git("status", "--porcelain")).toBe("");
  // The values were recomputed on each of the three sides, then merged.
  expect(x.asked.some((a) => a.prompt.includes("<<<<<<<"))).toBe(false);
  const steps = x.live.run.steps.map((s) =>
    s.id.replace(/-[0-9a-f-]{36}$/u, ""),
  );
  expect(steps).toContain("merge-refreshed");
  expect(steps.filter((s) => s.startsWith("refresh: pins"))).toEqual([
    "refresh: pins (branch)",
    "refresh: pins (common ancestor)",
    "refresh: pins (delivery)",
  ]);
});

it("entries both sides added to a pinned file are a worker's, told that the values are not; the build then supplies them", async () => {
  const { r, build, scope, commit } = derived();
  const x = r.delivery("add c", { build, scope });
  await x.create();
  writeFileSync(join(x.cwd, "c.txt"), "c\n");
  writeFileSync(
    join(x.cwd, "pins.txt"),
    `${readFileSync(join(x.cwd, "pins.txt"), "utf8")}c.txt=0\n`,
  );
  x.live.run.scope?.push("pins.txt");
  await x.accept();
  writeFileSync(join(r.root, "d.txt"), "d\n");
  writeFileSync(
    join(r.root, "pins.txt"),
    `${readFileSync(join(r.root, "pins.txt"), "utf8")}d.txt=0\n`,
  );
  commit("my own file");
  let seen = "";
  x.hooks.repair = ({ cwd, prompt }) => {
    expect(prompt).toContain(
      "The owner's build recomputes the values in these files afterwards.",
    );
    seen = readFileSync(join(cwd, "pins.txt"), "utf8");
    // Keep both entries; the values are the build's to fill in.
    writeFileSync(
      join(cwd, "pins.txt"),
      "a.txt=0\nb.txt=0\ndist/app.js=0\nd.txt=0\nc.txt=0\n",
    );
  };
  await x.land();
  // Only the two added entries were marked: every value was already equal.
  expect(
    seen.split("\n").filter((line) => /^[<|=>]{7}/u.test(line)),
  ).toHaveLength(4);
  expect(seen).toMatch(
    /<<<<<<< HEAD\nd\.txt=[0-9a-f]{8}\n\|\|\|\|\|\|\| common ancestor\n=======\nc\.txt=[0-9a-f]{8}\n>>>>>>> this delivery\n$/u,
  );
  const pin = (path: string) =>
    `${path}=${r.git("hash-object", path).slice(0, 8)}`;
  expect(readFileSync(join(r.root, "pins.txt"), "utf8")).toBe(
    ["a.txt", "b.txt", "dist/app.js", "d.txt", "c.txt"]
      .map(pin)
      .join("\n")
      .concat("\n"),
  );
});

it("what a sibling's own agreement checks is checked again on the delivery that takes its landing in on the same file", async () => {
  const r = repository();
  const x = r.delivery("change two", {
    checks: [{ name: "two", command: "grep -q TWO a.txt" }],
  });
  const y = r.delivery("change five", {
    checks: [{ name: "five", command: "grep -q FIVE a.txt" }],
  });
  const z = r.delivery("change b", {
    checks: [{ name: "b", command: "grep -q B b.txt" }],
  });
  await Promise.all([x.create(), y.create(), z.create()]);
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  writeFileSync(join(y.cwd, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
  writeFileSync(join(z.cwd, "b.txt"), "B\n");
  await Promise.all([x.accept(), y.accept(), z.accept()]);
  await x.land();
  await y.land();
  await z.land();
  const ran = (d: typeof x) =>
    d.commands.filter((c) => c.cwd === d.cwd).map((c) => c.command);
  // y changed the file x landed on: x's check gates y's merged commit too.
  expect(ran(y)).toEqual([
    "grep -q FIVE a.txt",
    "grep -q FIVE a.txt",
    "grep -q TWO a.txt",
  ]);
  expect(
    y.live.run.steps.some((s) => s.id.startsWith("landed meanwhile: two-")),
  ).toBe(true);
  // z shares no source file with either: only its own check ran again.
  expect(ran(z)).toEqual(["grep -q B b.txt", "grep -q B b.txt"]);
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe(
    "one\nTWO\nthree\nfour\nFIVE\n",
  );
  // Nothing is kept once no run can ask for it.
  expect(
    r.landings.since(
      `${x.view.binding.target.repositoryIdentity}\0${r.BRANCH}`,
      0,
    ),
  ).toHaveLength(3);
}, 15_000);

it("a merged commit that breaks what a sibling established is repaired before it lands", async () => {
  const r = repository();
  const x = r.delivery("keep three", {
    checks: [{ name: "three", command: "grep -q '^three$' a.txt" }],
  });
  const y = r.delivery("change four", {
    checks: [{ name: "four", command: "grep -q FOUR a.txt" }],
  });
  await Promise.all([x.create(), y.create()]);
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  // y rewrites the line x's agreement checks, without conflicting textually.
  writeFileSync(join(y.cwd, "a.txt"), "one\ntwo\nTHREE\nFOUR\nfive\n");
  await Promise.all([x.accept(), y.accept()]);
  await x.land();
  y.hooks.repair = ({ cwd }) =>
    writeFileSync(join(cwd, "a.txt"), "one\nTWO\nthree\nFOUR\nfive\n");
  await y.land();
  expect(y.asked.filter((a) => a.kind === "repair")).toHaveLength(1);
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe(
    "one\nTWO\nthree\nFOUR\nfive\n",
  );
});

it("a branch that was deleted is not recreated: the verified commit is on the task branch and the delivery says it was not merged", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  const accepted = x.head();
  r.git("switch", "-qc", "elsewhere");
  r.git("branch", "-q", "-D", "main");
  await x.deliver();
  expect(r.git("for-each-ref", "refs/heads/main")).toBe("");
  expect(r.git("rev-parse", x.view.taskBranch)).toBe(accepted);
  expect(x.view.integration).toMatchObject({
    status: "branch",
    after: null,
    reason: `Completed, not merged into main: refs/heads/main no longer exists. The verified result is commit ${accepted} on ${x.view.taskBranch.replace("refs/heads/", "")}; to merge it yourself: git merge ${x.view.taskBranch.replace("refs/heads/", "")}`,
  });
  expect(x.view.acceptance?.candidate).toBe(accepted);
  expect(x.live.run.mergedCommit).toBeNull();
  // The user's checkout was never touched.
  expect(r.git("status", "--porcelain")).toBe("");
});

it("when no merge with the branch can be verified, the last verified commit is delivered on the task branch, not thrown away", async () => {
  const r = repository();
  const x = r.delivery("change two");
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  await x.accept();
  const accepted = x.head();
  writeFileSync(join(r.root, "a.txt"), "one\ntwo, my way\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "the same line");
  const mine = r.git("rev-parse", "HEAD");
  x.hooks.repair = () => {};
  x.hooks.diagnose = (_prompt, failed) => ({
    action: "blocked",
    blocker: "tool",
    cause: "nothing here can decide between the two",
    evidence: [failed],
    strategy: "a person has to choose",
    work: [],
  });
  await x.deliver();
  // The branch and the user's checkout are where the user left them.
  expect(r.git("rev-parse", r.BRANCH)).toBe(mine);
  expect(r.git("status", "--porcelain")).toBe("");
  expect(r.git("rev-parse", x.view.taskBranch)).toBe(accepted);
  expect(r.git("show", `${accepted}:a.txt`)).toContain("TWO");
  expect(x.view.integration.status).toBe("branch");
  expect(x.view.integration.reason).toMatch(
    /^Completed, not merged into main: Delivery blocked \(tool\): nothing here can decide between the two/u,
  );
  expect(x.view.cleanup.status).toBe("retained");
  expect(r.queue.busy).toBe(false);
});

it("a branch the user is rebasing is waited for; landing in between would strand the rebase", async () => {
  const r = repository();
  const x = r.delivery("change b");
  await x.create();
  writeFileSync(join(x.cwd, "b.txt"), "B\n");
  await x.accept();
  // main gains a commit that conflicts with an older branch being rebased
  // onto... the target itself: put main mid-rebase onto another branch.
  r.git("switch", "-qc", "upstream");
  writeFileSync(join(r.root, "a.txt"), "one\nupstream\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "upstream");
  r.git("switch", "-q", "main");
  writeFileSync(join(r.root, "a.txt"), "one\nmain\nthree\nfour\nfive\n");
  r.git("commit", "-qam", "main");
  expect(() => r.git("rebase", "upstream")).toThrow();
  const waits: string[] = [];
  x.engine.pause = async () => {
    waits.push(x.live.run.notice);
    // The user finishes the rebase.
    writeFileSync(join(r.root, "a.txt"), "one\nboth\nthree\nfour\nfive\n");
    r.git("add", "a.txt");
    r.git("-c", "core.editor=true", "rebase", "--continue");
  };
  await x.land();
  expect(waits).toHaveLength(1);
  expect(waits[0]).toContain("is being rebased");
  // The rebase finished untouched, and the delivery landed on its result.
  expect(r.git("symbolic-ref", "HEAD")).toBe(r.BRANCH);
  expect(r.git("rev-parse", "HEAD")).toBe(x.live.run.mergedCommit);
  expect(r.git("log", "--format=%s", "-3").split("\n")).toEqual([
    "Cadence: change b",
    "main",
    "upstream",
  ]);
  expect(readFileSync(join(r.root, "b.txt"), "utf8")).toBe("B\n");
});

/** A delivery that changed a.txt (line two), b.txt (its last line), gone.txt
 * and added new.txt, verified and ready, while the user's checkout still has
 * the branch checked out. */
const ready = async (
  options: Parameters<ReturnType<typeof repository>["delivery"]>[1] = {},
) => {
  const r = repository();
  writeFileSync(join(r.root, "b.txt"), "b1\nb2\nb3\nb4\nb5\n");
  writeFileSync(join(r.root, "c.txt"), "c\n");
  writeFileSync(join(r.root, "gone.txt"), "to be deleted\n");
  r.git("add", "-A");
  r.git("commit", "-qm", "more files");
  const x = r.delivery("change two", {
    scope: ["a.txt", "b.txt", "gone.txt", "new.txt"],
    ...options,
  });
  await x.create();
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  writeFileSync(join(x.cwd, "b.txt"), "b1\nb2\nb3\nb4\nB5 delivered\n");
  writeFileSync(join(x.cwd, "gone.txt"), "changed by the delivery\n");
  writeFileSync(join(x.cwd, "new.txt"), "added by the delivery\n");
  await x.accept();
  const backup = `refs/cadence/wip-backup/${x.id}`;
  /** `git status --porcelain`, column for column. */
  const status = (cwd = r.root) =>
    spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" })
      .stdout.split("\n")
      .filter(Boolean);
  const put = (path: string, text: string, cwd = r.root) =>
    writeFileSync(join(cwd, path), text);
  const read = (path: string, cwd = r.root) =>
    readFileSync(join(cwd, path), "utf8");
  return { r, x, backup, status, put, read };
};

it("uncommitted changes to the files a delivery changes are carried over: staged stays staged, unstaged unstaged, and no other file is touched", async () => {
  const { r, x, backup, status, put, read } = await ready();
  // a.txt: an unstaged edit elsewhere in the file.
  put("a.txt", "one\ntwo\nthree\nfour\nFIVE, mine\n");
  // b.txt: one line staged, another not.
  put("b.txt", "b1, staged\nb2\nb3\nb4\nb5\n");
  r.git("add", "b.txt");
  put("b.txt", "b1, staged\nb2\nb3, unstaged\nb4\nb5\n");
  // c.txt is none of the delivery's business.
  put("c.txt", "c, edited by me\n");
  const untouched = statSync(join(r.root, "c.txt"), { bigint: true }).mtimeNs;
  const stashes = r.git("stash", "list");
  await x.land();
  expect(r.git("rev-parse", "HEAD")).toBe(x.live.run.mergedCommit);
  expect(status()).toEqual([" M a.txt", "MM b.txt", " M c.txt"]);
  // Both the delivery's change and mine, in the worktree and in the index.
  expect(read("a.txt")).toBe("one\nTWO\nthree\nfour\nFIVE, mine\n");
  expect(r.git("show", ":b.txt")).toBe("b1, staged\nb2\nb3\nb4\nB5 delivered");
  expect(read("b.txt")).toBe(
    "b1, staged\nb2\nb3, unstaged\nb4\nB5 delivered\n",
  );
  expect(read("c.txt")).toBe("c, edited by me\n");
  expect(statSync(join(r.root, "c.txt"), { bigint: true }).mtimeNs).toBe(
    untouched,
  );
  // No worker was needed, and the user's own stash list was not used.
  expect(x.asked.map((a) => a.kind)).toEqual(["review"]);
  expect(r.git("stash", "list")).toBe(stashes);
  expect(x.view.integration).toMatchObject({
    status: "applied",
    sync: {
      mode: "wip",
      worktree: r.root,
      backup: { ref: backup, oid: r.git("rev-parse", backup) },
      fused: ["a.txt", "b.txt"],
    },
  });
  expect(x.live.notes.join("\n")).toContain(
    `${r.root} had uncommitted changes to 2 files this delivery changes; they were carried over onto the new commit — merged with them: a.txt, b.txt.`,
  );
  // The backup holds exactly those files as they were, and Git restores it.
  const before = join(r.home, "before");
  r.git("worktree", "add", "-q", "--detach", before, `${backup}^1`);
  r.gitAt(before, "stash", "apply", "--index", backup);
  expect(status(before)).toEqual([" M a.txt", "MM b.txt"]);
  expect(read("a.txt", before)).toBe("one\ntwo\nthree\nfour\nFIVE, mine\n");
  expect(r.gitAt(before, "show", ":b.txt")).toBe("b1, staged\nb2\nb3\nb4\nb5");
});

it("the same lines changed by the user and the delivery are reconciled by a worker in a copy; the result is written back and the earlier version is restorable", async () => {
  const { r, x, backup, status, put, read } = await ready();
  put("a.txt", "one\ntwo, half done\nthree\nfour\nfive\n");
  // My own untracked file where the delivery adds one of the same name.
  put("new.txt", "my own notes\n");
  let copy = "";
  let seen = "";
  x.hooks.repair = ({ cwd, prompt }) => {
    copy = cwd;
    expect(prompt).toContain(
      `${r.root} has uncommitted changes of the user's to these files`,
    );
    seen = read("a.txt", cwd);
    put("a.txt", "one\nTWO, half done\nthree\nfour\nfive\n", cwd);
    put("new.txt", "added by the delivery\nmy own notes\n", cwd);
  };
  await x.land();
  // The worker never worked in the user's checkout, and its copy is gone.
  expect(copy).not.toBe(r.root);
  expect(copy.startsWith(r.state)).toBe(true);
  expect(existsSync(copy)).toBe(false);
  expect(seen).toContain("<<<<<<< HEAD\nTWO\n");
  expect(seen).toContain("=======\ntwo, half done\n>>>>>>> ");
  expect(seen).toContain("(your uncommitted changes)");
  expect(r.git("rev-parse", "HEAD")).toBe(x.live.run.mergedCommit);
  // What was delivered is committed; what I had is uncommitted on top of it.
  expect(r.git("show", "HEAD:a.txt")).toBe("one\nTWO\nthree\nfour\nfive");
  expect(read("a.txt")).toBe("one\nTWO, half done\nthree\nfour\nfive\n");
  expect(read("new.txt")).toBe("added by the delivery\nmy own notes\n");
  expect(status()).toEqual([" M a.txt", " M new.txt"]);
  expect(x.live.notes.join("\n")).toContain(
    "reconciled with them by a worker: a.txt, new.txt",
  );
  // My files exactly as they were, the untracked one included.
  expect(r.git("show", `${backup}:a.txt`)).toBe(
    "one\ntwo, half done\nthree\nfour\nfive",
  );
  const before = join(r.home, "before");
  r.git("worktree", "add", "-q", "--detach", before, `${backup}^1`);
  r.gitAt(before, "stash", "apply", "--index", backup);
  expect(status(before)).toEqual([" M a.txt", "?? new.txt"]);
  expect(read("new.txt", before)).toBe("my own notes\n");
  // The candidate's own acceptance was not disturbed by that worker.
  expect(x.view.acceptance?.candidate).toBe(x.live.run.mergedCommit);
});

it("a file the worker leaves a marked line in goes back as Git wrote it; what cannot be merged stays as the user had it", async () => {
  const { r, x, status, put, read } = await ready();
  put("a.txt", "one\ntwo, half done\nthree\nfour\nfive\n");
  // I deleted a file the delivery changed.
  rmSync(join(r.root, "gone.txt"));
  x.hooks.repair = () => {};
  await x.land();
  expect(r.git("rev-parse", "HEAD")).toBe(x.live.run.mergedCommit);
  expect(read("a.txt")).toContain("<<<<<<< HEAD\nTWO\n");
  expect(read("a.txt")).toContain("two, half done\n>>>>>>> ");
  expect(status()).toEqual([" M a.txt", " D gone.txt"]);
  const notice = x.live.notes.join("\n");
  expect(notice).toContain(
    "left for you with both versions between conflict markers: a.txt",
  );
  expect(notice).toContain(
    "kept as your uncommitted version, because the two could not be merged (the delivered version is in HEAD): gone.txt",
  );
});

it("an uncommitted change to a file a build derives is replaced by the delivered one, and bytes an index flag hides are carried over with the flag left on", async () => {
  const { r, x, backup, status, put, read } = await ready({
    build: [{ name: "bundle", command: "true", outputs: ["b.txt"] }],
  });
  // b.txt is derived: my local bytes there are not something to merge.
  put("b.txt", "b1\nb2\nb3\nb4\nlocal build\n");
  // a.txt has local bytes Git was told not to look at.
  r.git("update-index", "--assume-unchanged", "a.txt");
  put("a.txt", "one\ntwo\nthree\nfour\nFIVE, hidden\n");
  expect(status()).toEqual([" M b.txt"]);
  await x.land();
  expect(r.git("rev-parse", "HEAD")).toBe(x.live.run.mergedCommit);
  expect(read("b.txt")).toBe("b1\nb2\nb3\nb4\nB5 delivered\n");
  expect(read("a.txt")).toBe("one\nTWO\nthree\nfour\nFIVE, hidden\n");
  // Still hidden, as the user had set it.
  expect(r.git("ls-files", "-v", "a.txt")).toBe("h a.txt");
  expect(status()).toEqual([]);
  expect(x.live.notes.join("\n")).toContain(
    "replaced by the delivered version, because a build derives them: b.txt",
  );
  expect(r.git("show", `${backup}:b.txt`)).toBe("b1\nb2\nb3\nb4\nlocal build");
  expect(r.git("show", `${backup}:a.txt`)).toContain("FIVE, hidden");
});

it("files that are written while the landing looks at them are waited for, not overwritten", async () => {
  const { r, x, put, read } = await ready();
  put("a.txt", "one\ntwo\nthree\nfour\nFIVE, mine\n");
  // Somebody saves the file again between the snapshot and the landing.
  const snapshot = x.engine.snapshotUncommitted.bind(x.engine);
  let snapshots = 0;
  x.engine.snapshotUncommitted = async (...args: unknown[]) => {
    const taken = await snapshot(...args);
    if (++snapshots === 1)
      put("a.txt", "one\ntwo\nthree\nfour\nFIVE, mine, and more\n");
    return taken;
  };
  const waits: string[] = [];
  x.engine.pause = async () => {
    waits.push(x.live.run.notice);
  };
  await x.land();
  expect(waits).toHaveLength(1);
  expect(waits[0]).toContain("are still being edited");
  // Nothing was lost: the later save is what was carried over.
  expect(read("a.txt")).toBe("one\nTWO\nthree\nfour\nFIVE, mine, and more\n");
  expect(r.git("rev-parse", "HEAD")).toBe(x.live.run.mergedCommit);
});

it("a file saved in the checkout after it was looked at makes Git refuse the fast-forward: nothing is touched, and the next look carries it over", async () => {
  const { r, x, put, read, status } = await ready();
  // Saved between the look at the checkout and the fast-forward.
  const move = x.engine.move.bind(x.engine);
  let moves = 0;
  x.engine.move = async (...args: unknown[]) => {
    if (++moves === 1)
      put("a.txt", "one\ntwo\nthree\nfour\nFIVE, just saved\n");
    return move(...args);
  };
  const waits: string[] = [];
  x.engine.pause = async () => {
    waits.push(x.live.run.notice);
    // Git refused: the branch and the file are exactly as they were.
    expect(r.git("rev-parse", "HEAD")).toBe(x.base);
    expect(read("a.txt")).toBe("one\ntwo\nthree\nfour\nFIVE, just saved\n");
    expect(x.live.run.mergedCommit).toBeNull();
  };
  await x.land();
  expect(waits).toHaveLength(1);
  expect(waits[0]).toContain(`Git did not fast-forward ${r.root}`);
  expect(moves).toBe(2);
  // Seen on the second look, and carried over like any other change.
  expect(r.git("rev-parse", "HEAD")).toBe(x.live.run.mergedCommit);
  expect(read("a.txt")).toBe("one\nTWO\nthree\nfour\nFIVE, just saved\n");
  expect(status()).toEqual([" M a.txt"]);
  expect(x.view.integration.sync?.mode).toBe("wip");
});

/** Three deliveries on the repository with a bundle and pins, each verified
 * alone on the same baseline and now ready to land. */
const three = async () => {
  const { r, build, scope } = derived();
  const make = (goal: string, name: string, command: string) =>
    r.delivery(goal, { build, scope, checks: [{ name, command }] });
  const x = make("change two", "two", "grep -q TWO a.txt"),
    y = make("change five", "five", "grep -q FIVE a.txt"),
    z = make("change b", "b", "grep -q B b.txt");
  await Promise.all([x.create(), y.create(), z.create()]);
  writeFileSync(join(x.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  writeFileSync(join(y.cwd, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
  writeFileSync(join(z.cwd, "b.txt"), "B\n");
  return { r, x, y, z };
};
/** What a run did from here on: its shell commands and what it asked workers. */
const from = (d: Awaited<ReturnType<typeof three>>["x"]) => {
  const commands = d.commands.length,
    asked = d.asked.length;
  return {
    commands: () => d.commands.slice(commands).map((c) => c.command),
    asked: () => d.asked.slice(asked),
  };
};

it("deliveries that are ready at the same time land together: each its own commit, rebuilt on the one before, and the last is checked and reviewed once for all", async () => {
  const { r, x, y, z } = await three();
  await Promise.all([x.accept(), y.accept(), z.accept()]);
  const did = { x: from(x), y: from(y), z: from(z) };
  await Promise.all([x.land(), y.land(), z.land()]);
  const [third, second, first, base] = lines(r.git("log", "--format=%H", "-4"));
  expect(base).toBe(x.base);
  expect(lines(r.git("log", "--format=%s", "-3"))).toEqual([
    "Cadence: change b",
    "Cadence: change five",
    "Cadence: change two",
  ]);
  // Every delivery is its own commit, with one parent.
  expect([x, y, z].map((d) => d.live.run.mergedCommit)).toEqual([
    first,
    second,
    third,
  ]);
  expect(r.git("diff", "--name-only", first, second)).toBe(
    "a.txt\ndist/app.js\npins.txt",
  );
  // Every commit of the chain is what its own sources build: none of them
  // carries another's bundle or pins.
  for (const commit of [first, second, third]) {
    const at = (path: string) => r.git("show", `${commit}:${path}`);
    expect(at("dist/app.js")).toBe(`${at("a.txt")}\n${at("b.txt")}`);
    const pin = (path: string) =>
      `${path}=${r.git("rev-parse", `${commit}:${path}`).slice(0, 8)}`;
    expect(at("pins.txt")).toBe(
      [pin("a.txt"), pin("b.txt"), pin("dist/app.js")].join("\n"),
    );
  }
  expect(readFileSync(join(r.root, "dist/app.js"), "utf8")).toBe(
    "one\nTWO\nthree\nfour\nFIVE\nB\n",
  );
  expect(r.git("status", "--porcelain")).toBe("");
  // The first in line did all of it: one rebuild per delivery it took along
  // (the pins both sides had changed were recomputed first, on every side),
  // every member's check once at the last commit, and one review.
  const ran = did.x.commands();
  expect(ran.filter((command) => command === "./build.sh")).toHaveLength(2);
  expect(ran.filter((command) => command.startsWith("grep"))).toEqual([
    "grep -q TWO a.txt",
    "grep -q FIVE a.txt",
    "grep -q B b.txt",
  ]);
  expect(ran.slice(-3).every((command) => command.startsWith("grep"))).toBe(
    true,
  );
  expect(did.y.commands()).toEqual([]);
  expect(did.z.commands()).toEqual([]);
  const reviews = did.x.asked();
  expect(reviews.map((a) => a.kind)).toEqual(["review"]);
  expect(reviews[0].prompt).toContain(
    "This candidate is 3 deliveries landing together, one commit each, in this order.",
  );
  for (const goal of ["change two", "change five", "change b"])
    expect(reviews[0].prompt).toContain(`goal: ${goal}`);
  expect(x.reviewed.at(-1)).toBe(third);
  expect(did.y.asked()).toEqual([]);
  expect(did.z.asked()).toEqual([]);
  // Each delivery's record: its own commit, accepted as part of that group.
  for (const [d, commit, parent] of [
    [x, first, base],
    [y, second, first],
    [z, third, second],
  ] as const) {
    expect(d.view.candidate).toBe(commit);
    expect(d.view.acceptance).toMatchObject({
      candidate: commit,
      group: { run: x.id, tip: third },
    });
    expect(d.view.integration).toMatchObject({
      status: "applied",
      after: commit,
      sync: { mode: "fast-forward", worktree: r.root },
    });
    expect(r.git("rev-parse", d.view.taskBranch)).toBe(commit);
    // Its own worktree stands on its own commit, with nothing left over.
    expect(d.head()).toBe(commit);
    expect(r.gitAt(d.cwd, "status", "--porcelain")).toBe("");
    expect(r.gitAt(d.cwd, "show", "-s", "--format=%P", commit)).toBe(parent);
    expect(d.live.notes.join("\n")).toContain("Landed together with 2 other");
  }
  // A later run verifies against each of them separately.
  expect(
    r.landings.since(
      `${x.view.binding.target.repositoryIdentity}\0${r.BRANCH}`,
      0,
    ),
  ).toMatchObject([
    { commit: first, paths: ["a.txt"] },
    { commit: second, paths: ["a.txt"] },
    { commit: third, paths: ["b.txt"] },
  ]);
  expect(r.queue.busy).toBe(false);
}, 20_000);

it("when the last commit of a group does not pass, half of it is tried; whoever stays behind lands by itself, repaired", async () => {
  const { r, build, scope, commit } = derived();
  // A file long enough for three changes that do not touch one another.
  const text = (change: Record<number, string> = {}) =>
    `${Array.from({ length: 12 }, (_, at) => change[at + 1] ?? `l${at + 1}`).join("\n")}\n`;
  writeFileSync(join(r.root, "a.txt"), text());
  commit("a longer file");
  const make = (goal: string, name: string, command: string) =>
    r.delivery(goal, { build, scope, checks: [{ name, command }] });
  // x's agreement relies on line eight staying as it is; z rewrites it.
  const x = make("change two", "eight stays", "grep -q '^l8$' a.txt"),
    y = make("change five", "five", "grep -q FIVE a.txt"),
    z = make("change eight", "eight", "grep -q EIGHT a.txt");
  await Promise.all([x.create(), y.create(), z.create()]);
  writeFileSync(join(x.cwd, "a.txt"), text({ 2: "TWO" }));
  writeFileSync(join(y.cwd, "a.txt"), text({ 5: "FIVE" }));
  writeFileSync(join(z.cwd, "a.txt"), text({ 8: "EIGHT" }));
  await Promise.all([x.accept(), y.accept(), z.accept()]);
  const did = { x: from(x), z: from(z) };
  // Alone, z finds a way to keep what x relies on.
  z.hooks.repair = ({ cwd }) =>
    writeFileSync(
      join(cwd, "a.txt"),
      `${text({ 2: "TWO", 5: "FIVE" })}EIGHT\n`,
    );
  await Promise.all([x.land(), y.land(), z.land()]);
  // All three were built into one chain. Its last commit failed x's check,
  // so the first two were verified as they stood, with no new build.
  const ran = did.x.commands();
  expect(ran.filter((command) => command === "./build.sh")).toHaveLength(2);
  expect(ran.filter((command) => command.startsWith("grep"))).toEqual([
    "grep -q '^l8$' a.txt",
    "grep -q '^l8$' a.txt",
    "grep -q FIVE a.txt",
  ]);
  expect(did.x.asked().map((a) => a.kind)).toEqual(["review"]);
  expect(did.x.asked()[0].prompt).toContain("2 deliveries landing together");
  expect(lines(r.git("log", "--format=%s", "-3"))).toEqual([
    "Cadence: change eight",
    "Cadence: change five",
    "Cadence: change two",
  ]);
  expect(x.view.acceptance?.group?.tip).toBe(y.live.run.mergedCommit);
  expect(y.view.acceptance?.group?.run).toBe(x.id);
  // z took what landed in, was held to x's check as well, and was repaired.
  expect(z.view.acceptance?.group).toBeUndefined();
  expect(did.z.commands()).toContain("grep -q '^l8$' a.txt");
  expect(did.z.asked().map((a) => a.kind)).toEqual(["repair", "review"]);
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe(
    `${text({ 2: "TWO", 5: "FIVE" })}EIGHT\n`,
  );
  expect(r.git("rev-parse", "HEAD")).toBe(z.live.run.mergedCommit);
  expect(r.queue.busy).toBe(false);
}, 30_000);

it("a delivery Git cannot place on the one before it stays in line, with everyone behind it; one that is built differently is not taken along", async () => {
  const { r, x, y, z } = await three();
  // y changes the very line x changes.
  writeFileSync(join(y.cwd, "a.txt"), "one\ntwo, my way\nthree\nfour\nfive\n");
  y.proposal.plan.checks = [{ name: "way", command: "grep -q 'my way' a.txt" }];
  await Promise.all([x.accept(), y.accept(), z.accept()]);
  const did = { x: from(x), y: from(y) };
  y.hooks.repair = ({ cwd }) =>
    writeFileSync(join(cwd, "a.txt"), "one\nTWO, my way\nthree\nfour\nfive\n");
  await Promise.all([x.land(), y.land(), z.land()]);
  // x was accepted alone and landed as that, with nothing run again.
  expect(did.x.commands()).toEqual([]);
  expect(did.x.asked()).toEqual([]);
  expect(x.view.acceptance?.group).toBeUndefined();
  // While y was being reconciled nobody waited for it: z landed first.
  expect(lines(r.git("log", "--format=%s", "-3"))).toEqual([
    "Cadence: change five",
    "Cadence: change b",
    "Cadence: change two",
  ]);
  // Reconciled and verified off the queue; back in it, what z had landed
  // meanwhile was taken in and verified once more.
  expect(did.y.asked().map((a) => a.kind)).toEqual([
    "repair",
    "review",
    "review",
  ]);
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe(
    "one\nTWO, my way\nthree\nfour\nfive\n",
  );

  // Built differently: each lands on its own.
  const s = repository();
  const plain = s.delivery("change two"),
    built = s.delivery("change b", {
      build: [{ name: "stamp", command: "true", outputs: ["stamp.txt"] }],
    });
  await Promise.all([plain.create(), built.create()]);
  writeFileSync(join(plain.cwd, "a.txt"), "one\nTWO\nthree\nfour\nfive\n");
  writeFileSync(join(built.cwd, "b.txt"), "B\n");
  await Promise.all([plain.accept(), built.accept()]);
  await Promise.all([plain.land(), built.land()]);
  expect(plain.view.acceptance?.group).toBeUndefined();
  expect(built.view.acceptance?.group).toBeUndefined();
  expect(built.reviewed).toHaveLength(2);
}, 30_000);

it("a delivery canceled while it is being landed with others is not landed: the rest is verified again without it", async () => {
  const { r, x, y, z } = await three();
  await Promise.all([x.accept(), y.accept(), z.accept()]);
  // z is canceled while the group of three is under review.
  let reviews = 0;
  x.hooks.review = () => {
    if (++reviews === 1) z.live.abort.abort();
    return true;
  };
  const landed = await Promise.allSettled([x.land(), y.land(), z.land()]);
  expect(landed.map((l) => l.status)).toEqual([
    "fulfilled",
    "fulfilled",
    "rejected",
  ]);
  // What was verified had z in it, so none of it was landed. The two that
  // are left landed together afterwards, verified as just the two of them.
  const subjects = lines(r.git("log", "--format=%s", "-3"));
  expect(subjects.at(-1)).toBe("build");
  expect(subjects.slice(0, 2).sort()).toEqual([
    "Cadence: change five",
    "Cadence: change two",
  ]);
  expect(readFileSync(join(r.root, "a.txt"), "utf8")).toBe(
    "one\nTWO\nthree\nfour\nFIVE\n",
  );
  expect(readFileSync(join(r.root, "b.txt"), "utf8")).toBe("b\n");
  // One review of the three, by the first in line; then one of the two, by
  // whichever of them had the turn next.
  expect(reviews).toBe(1);
  expect(y.reviewed).toHaveLength(2);
  const tip = r.git("rev-parse", "HEAD");
  expect(x.view.acceptance?.group?.tip).toBe(tip);
  expect(y.view.acceptance?.group?.tip).toBe(tip);
  expect(z.live.run.mergedCommit).toBeNull();
  expect(z.view.integration.status).toBe("pending");
  // Its task branch was never moved to a commit that did not land.
  expect(r.git("rev-parse", z.view.taskBranch)).toBe(z.base);
  expect(r.queue.busy).toBe(false);
}, 20_000);
