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
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { repository } from "./helpers/delivery-engine.ts";

const lines = (text: string) => text.trimEnd().split("\n");

it("two deliveries to one branch land in arrival order: the second replays onto what the first left and is verified again", async () => {
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

  await Promise.all([x.land(), y.land()]);
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
});

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
