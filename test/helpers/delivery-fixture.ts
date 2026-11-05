import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionContext } from "../../src/service/contracts/models.ts";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { RepositoryCoordination } from "../../src/service/repository-coordination.ts";
import {
  deliveryObservation,
  WorkflowDelivery,
} from "../../src/service/workflow-delivery.ts";
import { deliveryTarget, gitRead } from "../../src/service/workflow-git.ts";

export function deliveryFixture() {
  const home = mkdtempSync(join(tmpdir(), "delivery-"));
  const root = join(home, "repo"),
    state = join(home, "state");
  mkdirSync(root);
  mkdirSync(state, { mode: 0o700 });
  const gitAt = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Delivery fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  const git = (...args: string[]) => gitAt(root, ...args);
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "a.txt"), "before\n");
  writeFileSync(join(root, ".gitignore"), "ignored/\n");
  git("add", "--", "a.txt", ".gitignore");
  git("commit", "-qm", "baseline");
  const base = git("rev-parse", "HEAD");
  const c = new ServiceCoordination(root, state),
    epoch = randomUUID(),
    run = randomUUID();
  const binding = {
    policy: "task-branch-v1" as const,
    target: deliveryTarget(root, { head: base, branch: "refs/heads/main" }),
  };
  const view = deliveryObservation(
    binding,
    join(state, "cadence-worktrees-v1", "fixture"),
    run,
    "Fixture task",
  );
  let fault = false;
  const resources = new RepositoryCoordination(
    c,
    root,
    epoch,
    run,
    () => {},
    () => {
      fault = true;
    },
  );
  const delivery = new WorkflowDelivery(view, resources, () => {});
  const execution: ExecutionContext = {
    cwd: root,
    checkoutRoot: root,
    model: null,
    version: {
      epoch,
      accessGeneration: 1,
      configRev: 1,
      catalogId: randomUUID(),
    },
  };
  const create = async () => {
    delivery.prepareHome();
    await resources.mutate(
      binding.target.repository,
      new AbortController().signal,
      () => delivery.create(async (args) => git(...args)),
      () => !fault,
    );
    return view.worktreeRoot;
  };
  return {
    home,
    root,
    state,
    c,
    epoch,
    run,
    binding,
    view,
    resources,
    delivery,
    execution,
    base,
    git,
    gitAt,
    create,
    fault: () => fault,
    head: (cwd: string) => gitRead(cwd, ["rev-parse", "HEAD"]).trim(),
  };
}
