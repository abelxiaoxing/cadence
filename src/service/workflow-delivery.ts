/** One named branch and stable candidate per approved delivery. The workflow
 * owns all native Git execution; this module owns placement and evidence. */
import { lstatSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { safeDirectory } from "../workspace.ts";
import { ContractError, canonicalJson, decodeId } from "./contracts/core.ts";
import type { ExecutionContext } from "./contracts/models.ts";
import type {
  AcceptanceRecord,
  DeliveryBinding,
  DeliveryObservation,
  WorkflowStep,
} from "./contracts/workflow.ts";
import { hash } from "./private-files.ts";
import type { RepositoryCoordination } from "./repository-coordination.ts";
import {
  assertCandidate,
  assertCommittedScope,
  assertRepository,
  assertTarget,
  assertWorktree,
  gitHead,
  gitRun,
  gitText,
  nested,
  worktreeResidue,
} from "./workflow-git.ts";

export function taskBranch(goal: string, id: string): string {
  const slug =
    goal
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 48)
      .replace(/-$/u, "") || "task";
  return `refs/heads/cadence/${slug}-${decodeId(id)}`;
}
export function deliveryObservation(
  binding: DeliveryBinding,
  root: string,
  id: string,
  goal: string,
): DeliveryObservation {
  return {
    binding,
    taskBranch: taskBranch(goal, id),
    worktreeRoot: join(root, decodeId(id), "integration"),
    preparation: "pending",
    workspace: null,
    candidate: null,
    acceptance: null,
    integration: {
      status: "pending",
      before: binding.target.head,
      after: null,
      reason: "",
    },
    postChecks: "not-run",
    cleanup: { status: "pending", reason: "" },
  };
}
/** Actual current-round outcomes, never model-supplied or historical approval. */
export function acceptanceRecord(
  candidate: string,
  tree: string,
  digest: string,
  execution: ExecutionContext,
  checks: WorkflowStep[],
  review: WorkflowStep,
  expectedChecks: number,
): AcceptanceRecord {
  if (
    checks.length !== expectedChecks ||
    !checks.length ||
    new Set(checks.map((s) => s.id)).size !== checks.length ||
    checks.some(
      (s) => s.kind !== "check" || s.status !== "completed" || s.exitCode !== 0,
    ) ||
    review.kind !== "review" ||
    review.status !== "completed" ||
    review.exitCode !== 0
  )
    throw new ContractError("stale");
  return {
    candidate,
    tree,
    planDigest: digest,
    contextDigest: hash(canonicalJson(execution)),
    checks: checks.map((s) => s.id),
    review: review.id,
  };
}
export class WorkflowDelivery {
  private token: string | undefined;
  readonly home: string;
  constructor(
    readonly view: DeliveryObservation,
    readonly resources: RepositoryCoordination,
    private readonly save: () => void,
  ) {
    this.home = dirname(view.worktreeRoot);
  }
  prepareHome(): void {
    assertRepository(this.view.binding.target);
    if (nested(this.view.binding.target.checkoutRoot, this.home))
      throw new ContractError("unsupported-context");
    for (const path of [dirname(dirname(this.home)), dirname(this.home)]) {
      if (!safeDirectory(path, true)) throw new ContractError("forbidden");
      const stat = lstatSync(path);
      if (
        process.platform !== "win32" &&
        ((stat.mode & 0o077) !== 0 ||
          (process.getuid && stat.uid !== process.getuid()))
      )
        throw new ContractError("forbidden");
    }
    if (safeDirectory(this.home)) throw new ContractError("conflict");
    safeDirectory(this.home, true);
  }
  /** Caller holds the short repository mutation lease across creation. */
  async create(git: (args: string[]) => Promise<unknown>): Promise<string> {
    const { worktreeRoot: path, taskBranch: branch, binding } = this.view;
    if (this.view.workspace || safeDirectory(path))
      throw new ContractError("conflict");
    if (
      (
        await gitRun(binding.target.checkoutRoot, [
          "show-ref",
          "--verify",
          "--quiet",
          branch,
        ])
      ).code !== 1
    )
      throw new ContractError("conflict");
    this.token = this.resources.reserveWorkspace(path);
    this.view.workspace = { head: binding.target.head, state: "preparing" };
    this.save();
    await git([
      "worktree",
      "add",
      "-b",
      branch.slice("refs/heads/".length),
      path,
      binding.target.head,
    ]);
    await assertWorktree(binding.target.checkoutRoot, path);
    if (
      (await gitHead(path)) !== binding.target.head ||
      (await gitText(path, ["symbolic-ref", "HEAD"])).trim() !== branch
    )
      throw new ContractError("stale");
    this.resources.confirmWorkspace(this.token);
    this.view.workspace.state = "ready";
    this.view.preparation = "ready";
    this.save();
    return path;
  }
  assertWorkspace(path: string): void {
    if (path !== this.view.worktreeRoot) throw new ContractError("stale");
    this.resources.assertWorkspace(this.token ?? "");
  }
  async assertBinding(path: string): Promise<void> {
    this.assertWorkspace(path);
    if (
      this.view.workspace?.state !== "ready" ||
      (await gitText(path, ["symbolic-ref", "HEAD"])).trim() !==
        this.view.taskBranch
    )
      throw new ContractError("stale");
    await assertWorktree(this.view.binding.target.checkoutRoot, path);
  }
  /** Working bytes may be partial work. HEAD must still be the owner's last commit. */
  async assertTip(): Promise<string> {
    await this.assertBinding(this.view.worktreeRoot);
    const head = this.view.workspace?.head;
    if (!head || (await gitHead(this.view.worktreeRoot)) !== head)
      throw new ContractError("stale");
    return head;
  }
  update(head: string): void {
    if (this.view.workspace?.state !== "ready")
      throw new ContractError("stale");
    this.view.workspace.head = head;
    this.view.acceptance = null;
    this.save();
  }
  /** Only a confirmed merge by THIS run advances the delivery baseline. The
   * immutable approved target stays intact, and unknown effects never replay. */
  targetHead(): string {
    const i = this.view.integration;
    if (i.status === "pending") return this.view.binding.target.head;
    if (i.status === "applied" && i.after) return i.after;
    throw new ContractError("stale");
  }
  async assertAccepted(
    digest: string,
    execution: ExecutionContext,
    scope: string[],
  ): Promise<string> {
    const a = this.view.acceptance,
      candidate = this.view.candidate;
    if (
      !a ||
      !candidate ||
      a.candidate !== candidate ||
      a.planDigest !== digest ||
      a.contextDigest !== hash(canonicalJson(execution)) ||
      (await this.assertTip()) !== candidate
    )
      throw new ContractError("stale");
    await assertCandidate(this.view.worktreeRoot, candidate);
    await assertCommittedScope(
      this.view.worktreeRoot,
      this.view.binding.target.head,
      candidate,
      scope,
    );
    if (
      (
        await gitText(this.view.worktreeRoot, [
          "rev-parse",
          `${candidate}^{tree}`,
        ])
      ).trim() !== a.tree
    )
      throw new ContractError("stale");
    assertRepository(this.view.binding.target);
    const targetHead = this.targetHead();
    await assertTarget(
      this.view.binding.target.checkoutRoot,
      {
        branch: this.view.binding.target.branch,
        head: targetHead,
      },
      scope,
    );
    if (
      (
        await gitRun(this.view.worktreeRoot, [
          "merge-base",
          "--is-ancestor",
          targetHead,
          candidate,
        ])
      ).code !== 0
    )
      throw new ContractError("stale");
    return candidate;
  }
  /** Only successful post-checks can lead here; ignored residue anywhere retains
   * the worktree. The named branch is never deleted, even on successful cleanup. */
  async cleanup(
    remove: (path: string, check: () => Promise<void>) => Promise<void>,
  ): Promise<void> {
    const path = this.view.worktreeRoot;
    try {
      await remove(path, async () => {
        const { candidate, acceptance, integration, postChecks } = this.view;
        if (
          postChecks !== "passed" ||
          integration.status !== "applied" ||
          !candidate ||
          acceptance?.candidate !== candidate ||
          integration.after !== candidate ||
          (await this.assertTip()) !== candidate
        )
          throw new ContractError("stale");
        assertRepository(this.view.binding.target);
        if ((await worktreeResidue(path)).length)
          throw new Error(
            "Uncommitted, untracked, ignored or index-hidden files retained",
          );
        if (
          (
            await gitRun(this.view.binding.target.checkoutRoot, [
              "merge-base",
              "--is-ancestor",
              candidate,
              this.view.binding.target.branch,
            ])
          ).code !== 0
        )
          throw new ContractError("stale");
      });
      // A callback's exit zero alone cannot prove removal of this exact resource.
      if (safeDirectory(path))
        throw new Error("Worktree removal was not confirmed");
      this.resources.release(this.token ?? "");
      this.token = undefined;
      if (this.view.workspace) this.view.workspace.state = "removed";
      this.view.cleanup = { status: "removed", reason: "" };
    } catch (error) {
      if (this.view.workspace) this.view.workspace.state = "retained";
      this.view.cleanup = {
        status: "retained",
        reason: (error instanceof Error
          ? error.message
          : "Cleanup unavailable"
        ).slice(0, 2048),
      };
    }
    this.save();
    try {
      rmdirSync(this.home);
    } catch {
      /* Only remove an already empty home. */
    }
  }
  finish(): void {
    this.resources.finish();
    if (this.view.workspace && this.view.workspace.state !== "removed")
      this.view.workspace.state = "retained";
    if (this.view.preparation === "pending") this.view.preparation = "unknown";
    if (this.view.cleanup.status === "pending")
      this.view.cleanup = {
        status: "retained",
        reason: "Worktree retained; no automatic replay or cleanup.",
      };
  }
}
