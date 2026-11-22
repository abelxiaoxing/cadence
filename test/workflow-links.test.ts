import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { WorkflowStep } from "../src/service/contracts/workflow.ts";
import {
  acceptanceRecord,
  WorkflowDelivery,
} from "../src/service/workflow-delivery.ts";
import { worktreeResidue } from "../src/service/workflow-git.ts";
import {
  confirmedManagedLinkPaths,
  discoverManagedLinks,
  type ManagedLinkJournal,
  type ManagedLinkRecord,
  provisionManagedLinks,
  sameLinkTarget,
  unlinkManagedLinks,
  validateManagedLinks,
} from "../src/service/workflow-links.ts";
import { deliveryFixture } from "./helpers/delivery-fixture.ts";

function memoryJournal(): {
  journal: ManagedLinkJournal;
  records: () => ManagedLinkRecord[];
} {
  let state: ManagedLinkRecord[] = [];
  return {
    journal: {
      read: () => state.map((r) => ({ ...r })),
      write: (next) => {
        state = next.map((r) => ({ ...r }));
      },
    },
    records: () => state,
  };
}

const step = (id: string, kind: "check" | "review"): WorkflowStep => ({
  id,
  kind,
  status: "completed",
  exitCode: 0,
  text: "ok",
  truncated: false,
});

it("validateManagedLinks refuses missing sources, scope overlaps, and Git-tracked destinations", () => {
  const f = deliveryFixture("task-branch-v2");
  mkdirSync(join(f.root, "node_modules"));
  writeFileSync(join(f.root, "node_modules", "pkg.txt"), "installed");

  expect(() =>
    validateManagedLinks(f.root, [{ path: "node_modules" }], ["a.txt"]),
  ).not.toThrow();
  expect(() =>
    validateManagedLinks(f.root, [{ path: "missing_deps" }], ["a.txt"]),
  ).toThrow("invalid");
  expect(() =>
    validateManagedLinks(f.root, [{ path: "node_modules" }], ["node_modules"]),
  ).toThrow("invalid");
  expect(() =>
    validateManagedLinks(f.root, [{ path: "a.txt" }], ["b.txt"]),
  ).toThrow("invalid");
});

it("managed dependency symlinks work even under trailing-slash .gitignore, unlink cleanly on identity match without touching target node_modules, and enable clean worktree removal", async () => {
  const f2 = deliveryFixture("task-branch-v2");
  // Deliberately use trailing-slash `node_modules/` in .gitignore (very common in JS repos),
  // which makes Git report a symlink named `node_modules` as untracked unless verified by owner!
  writeFileSync(join(f2.root, ".gitignore"), "ignored/\nnode_modules/\n");
  f2.git("add", ".gitignore");
  f2.git("commit", "-qm", "ignore node_modules");
  const targetHead = f2.head(f2.root);
  mkdirSync(join(f2.root, "node_modules", "dep"), { recursive: true });
  writeFileSync(
    join(f2.root, "node_modules", "dep", "index.js"),
    "export default 42;\n",
  );

  const store = memoryJournal();
  const delivery = new WorkflowDelivery(f2.view, f2.resources, () => {}, {
    recordCheckpoints() {},
    managedLinks: (dir) => confirmedManagedLinkPaths(dir, store.journal),
  });
  delivery.prepareHome();
  await f2.resources.mutate(
    f2.binding.target.repository,
    new AbortController().signal,
    () => delivery.create(async (args) => f2.git(...args)),
    () => true,
  );
  const cwd = f2.view.worktreeRoot;
  // Advance candidate to include .gitignore commit.
  f2.gitAt(cwd, "checkout", "--detach", targetHead);
  delivery.update(targetHead);
  delivery.advanceFrontier(f2.base, targetHead);
  delivery.refreshed(targetHead);

  provisionManagedLinks(
    f2.root,
    cwd,
    [{ path: "node_modules", placement: "worktree" }],
    "worktree",
    store.journal,
  );
  expect(lstatSync(join(cwd, "node_modules")).isSymbolicLink()).toBe(true);
  expect(
    readFileSync(join(cwd, "node_modules", "dep", "index.js"), "utf8"),
  ).toBe("export default 42;\n");
  expect(confirmedManagedLinkPaths(cwd, store.journal)).toEqual([
    "node_modules",
  ]);
  // Before unlink, worktreeResidue STILL sees node_modules as residue!
  expect(await worktreeResidue(cwd)).toContain("node_modules");

  // Commit scoped work, seal (succeeds even with trailing-slash .gitignore!), merge, and clean up.
  writeFileSync(join(cwd, "a.txt"), "built with linked deps\n");
  f2.gitAt(cwd, "commit", "-qam", "work");
  delivery.update(f2.head(cwd));
  const c0 = await delivery.sealDeliveryCommit(
    targetHead,
    ["a.txt"],
    "Cadence: linked deps delivery",
    async (args) => ({ output: f2.gitAt(cwd, ...args) }),
  );
  f2.view.acceptance = acceptanceRecord(
    c0,
    f2.gitAt(cwd, "rev-parse", `${c0}^{tree}`),
    "b".repeat(64),
    f2.execution,
    [step("check-1", "check")],
    step("review-1", "review"),
    1,
  );
  await delivery.advanceTaskBranch(c0, async (args) => f2.git(...args));
  f2.git("merge", "--ff-only", c0);
  f2.view.integration = {
    status: "applied",
    before: targetHead,
    after: c0,
    reason: "",
  };
  f2.view.postChecks = "passed";

  await delivery.cleanup(
    async (path, check) => {
      await check();
      f2.git("worktree", "remove", path);
    },
    {
      prepareCleanup: () => unlinkManagedLinks(cwd, store.journal),
      deleteCheckpointRefs: async (refs) => {
        for (const r of refs) f2.git("update-ref", "-d", r.ref, r.oid);
        return refs.map((r) => r.ref);
      },
    },
  );
  expect(f2.view.cleanup.status).toBe("removed");
  expect(existsSync(cwd)).toBe(false);
  expect(store.records()[0].status).toBe("unlinked");
  // Target checkout's node_modules is 100% untouched!
  expect(
    readFileSync(join(f2.root, "node_modules", "dep", "index.js"), "utf8"),
  ).toBe("export default 42;\n");
  delivery.finish();
});

it("refuses unlink and retains worktree when a managed symlink is replaced by a real directory or retargeted, or when unknown ignored residue exists", async () => {
  const f = deliveryFixture("task-branch-v2");
  mkdirSync(join(f.root, "node_modules"), { recursive: true });
  mkdirSync(join(f.root, "other_deps"), { recursive: true });
  const cwd = await f.create();

  // Case 1: Replaced with a real directory holding user data -> REFUSE unlink!
  const store1 = memoryJournal();
  provisionManagedLinks(
    f.root,
    cwd,
    [{ path: "node_modules" }],
    "worktree",
    store1.journal,
  );
  rmSync(join(cwd, "node_modules"));
  mkdirSync(join(cwd, "node_modules"));
  writeFileSync(join(cwd, "node_modules", "user.txt"), "precious");
  expect(() => unlinkManagedLinks(cwd, store1.journal)).toThrow(
    /replaced or modified/i,
  );
  expect(store1.records()[0].status).toBe("retained");
  expect(readFileSync(join(cwd, "node_modules", "user.txt"), "utf8")).toBe(
    "precious",
  );

  // Case 2: Retargeted symlink -> REFUSE unlink!
  const store2 = memoryJournal();
  provisionManagedLinks(
    f.root,
    cwd,
    [{ path: "alt_modules", source: "node_modules" }],
    "worktree",
    store2.journal,
  );
  rmSync(join(cwd, "alt_modules"));
  symlinkSync(join(f.root, "other_deps"), join(cwd, "alt_modules"));
  expect(() => unlinkManagedLinks(cwd, store2.journal)).toThrow(
    /replaced or modified|target changed/i,
  );
  expect(lstatSync(join(cwd, "alt_modules")).isSymbolicLink()).toBe(true);

  // Case 3: Valid managed link unlinks, but sibling unknown ignored file STILL retains worktree!
  const store3 = memoryJournal();
  provisionManagedLinks(
    f.root,
    cwd,
    [{ path: "clean_link", source: "node_modules" }],
    "worktree",
    store3.journal,
  );
  mkdirSync(join(cwd, "ignored"), { recursive: true });
  writeFileSync(join(cwd, "ignored", "unknown-cache"), "keep");
  unlinkManagedLinks(cwd, store3.journal);
  expect(existsSync(join(cwd, "clean_link"))).toBe(false);
  expect(await worktreeResidue(cwd)).toContain("ignored/unknown-cache");
  f.delivery.finish();
});

it("sameLinkTarget handles Windows NTFS junction trailing separators and verbatim prefixes while keeping POSIX exact", () => {
  expect(
    sameLinkTarget(
      "C:\\repo\\node_modules\\",
      "C:\\repo\\node_modules",
      "win32",
    ),
  ).toBe(true);
  expect(
    sameLinkTarget(
      "\\\\?\\C:\\repo\\node_modules\\",
      "C:\\repo\\node_modules",
      "win32",
    ),
  ).toBe(true);
  expect(
    sameLinkTarget(
      "C:\\other\\node_modules\\",
      "C:\\repo\\node_modules",
      "win32",
    ),
  ).toBe(false);
  expect(
    sameLinkTarget("/repo/node_modules/", "/repo/node_modules", "linux"),
  ).toBe(false);
  expect(
    sameLinkTarget("/repo/node_modules", "/repo/node_modules", "linux"),
  ).toBe(true);
});

it("discoverManagedLinks finds only plain untracked Git-ignored node_modules up to depth 2 and respects exclusions", () => {
  const f = deliveryFixture("task-branch-v2");
  writeFileSync(
    join(f.root, ".gitignore"),
    "node_modules/\nweb/node_modules/\npackages/*/node_modules/\n.hidden/node_modules/\n",
  );
  // Tracked node_modules must be skipped even if matched by pattern.
  mkdirSync(join(f.root, "tracked-pkg", "node_modules"), { recursive: true });
  writeFileSync(
    join(f.root, "tracked-pkg", "node_modules", "committed.js"),
    "export const x = 1;\n",
  );
  f.git("add", "-f", ".gitignore", "tracked-pkg/node_modules/committed.js");
  f.git("commit", "-qm", "setup ignore and tracked fixture");

  // Valid ignored plain node_modules at depth 0, 1, 2.
  mkdirSync(join(f.root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(f.root, "web", "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(f.root, "packages", "core", "node_modules", "pkg"), {
    recursive: true,
  });
  // Depth 3 node_modules (too deep -> skipped).
  mkdirSync(join(f.root, "a", "b", "c", "node_modules"), { recursive: true });
  // Hidden directory (skipped).
  mkdirSync(join(f.root, ".hidden", "node_modules"), { recursive: true });
  // Directory containing >600 regular files alphabetically before web/ must not
  // starve BFS discovery of web/node_modules.
  mkdirSync(join(f.root, "aaa-files"), { recursive: true });
  for (let i = 0; i < 600; i++)
    writeFileSync(join(f.root, "aaa-files", `f-${i}.txt`), "");
  // Nested Git repository / submodule must not be descended into.
  mkdirSync(join(f.root, "nested-repo", ".git"), { recursive: true });
  mkdirSync(join(f.root, "nested-repo", "node_modules", "pkg"), {
    recursive: true,
  });
  // Symlinked node_modules (skipped).
  mkdirSync(join(f.root, "linked-pkg"), { recursive: true });
  symlinkSync(
    join(f.root, "node_modules"),
    join(f.root, "linked-pkg", "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );

  expect(discoverManagedLinks(f.root)).toEqual([
    { path: "node_modules", placement: "worktree" },
    { path: "packages/core/node_modules", placement: "worktree" },
    { path: "web/node_modules", placement: "worktree" },
  ]);
  // Overlapping write paths are excluded.
  expect(discoverManagedLinks(f.root, ["web"])).toEqual([
    { path: "node_modules", placement: "worktree" },
    { path: "packages/core/node_modules", placement: "worktree" },
  ]);

  // Verify non-ignored node_modules is skipped when .gitignore anchors `/node_modules/`.
  writeFileSync(join(f.root, ".gitignore"), "/node_modules/\n");
  expect(discoverManagedLinks(f.root)).toEqual([
    { path: "node_modules", placement: "worktree" },
  ]);
  f.delivery.finish();
});
