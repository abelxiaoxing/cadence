/** One concrete local-delivery resource owner. Git still runs through the
 * workflow's recorded native runner; there is no second executor here. */
import { lstatSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { safeDirectory } from "../workspace.ts";
import { ContractError, canonicalJson, decodeId } from "./contracts/core.ts";
import type { ExecutionContext } from "./contracts/models.ts";
import type {
  AcceptanceRecord,
  DeliveryArtifact,
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
    artifacts: [],
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
/** Only original owner outcomes can produce this reference. No model-supplied
 * candidate identity or historical check is accepted. */
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
  private readonly tokens = new Map<string, string>();
  readonly home: string;
  constructor(
    readonly view: DeliveryObservation,
    readonly resources: RepositoryCoordination,
    private readonly save: () => void,
  ) {
    this.home = dirname(view.worktreeRoot);
  }
  prepareHome(): void {
    const target = this.view.binding.target;
    assertRepository(target);
    if (nested(target.checkoutRoot, this.home))
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
    safeDirectory(join(this.home, "tasks"), true);
  }
  /** Caller holds the repository mutation lease across checks and creation. */
  async create(
    id: string,
    base: string,
    git: (args: string[]) => Promise<unknown>,
  ): Promise<string> {
    const candidate = id === "@candidate";
    const path = candidate
      ? this.view.worktreeRoot
      : join(this.home, "tasks", id);
    const branch = candidate ? this.view.taskBranch : null;
    if (safeDirectory(path)) throw new ContractError("conflict");
    if (
      branch &&
      (
        await gitRun(this.view.binding.target.checkoutRoot, [
          "show-ref",
          "--verify",
          "--quiet",
          branch,
        ])
      ).code !== 1
    )
      throw new ContractError("conflict");
    const token = this.resources.reserveWorkspace(path);
    this.tokens.set(path, token);
    const artifact: DeliveryArtifact = {
      id,
      path,
      branch,
      head: base,
      appliedCommit: null,
      state: "preparing",
    };
    this.view.artifacts.push(artifact);
    this.save();
    await git([
      "worktree",
      "add",
      ...(branch ? ["-b", branch.slice("refs/heads/".length)] : ["--detach"]),
      path,
      base,
    ]);
    await assertWorktree(this.view.binding.target.checkoutRoot, path);
    if ((await gitHead(path)) !== base) throw new ContractError("stale");
    if (
      branch &&
      (await gitText(path, ["symbolic-ref", "HEAD"])).trim() !== branch
    )
      throw new ContractError("stale");
    this.resources.confirmWorkspace(token);
    artifact.state = "ready";
    if (candidate) this.view.preparation = "ready";
    this.save();
    return path;
  }
  assertWorkspace(path: string): void {
    this.resources.assertWorkspace(this.tokens.get(path) ?? "");
  }
  async assertBinding(path: string): Promise<void> {
    this.assertWorkspace(path);
    const artifact = this.view.artifacts.find((a) => a.path === path);
    if (artifact?.state !== "ready") throw new ContractError("stale");
    const branch = await gitRun(path, ["symbolic-ref", "--quiet", "HEAD"]);
    if (
      artifact.branch
        ? branch.code !== 0 || branch.stdout.trim() !== artifact.branch
        : branch.code !== 1
    )
      throw new ContractError("stale");
  }
  async assertHead(path: string): Promise<string> {
    await this.assertBinding(path);
    const artifact = this.view.artifacts.find((a) => a.path === path);
    if (!artifact) throw new ContractError("stale");
    await assertCandidate(path, artifact.head);
    return artifact.head;
  }
  update(path: string, head: string): void {
    const a = this.view.artifacts.find((a) => a.path === path);
    if (!a) throw new ContractError("stale");
    a.head = head;
    this.save();
  }
  applied(id: string, commit: string | null): void {
    const a = this.view.artifacts.find((a) => a.id === id);
    if (!a) throw new ContractError("stale");
    a.appliedCommit = commit;
    this.save();
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
      a.contextDigest !== hash(canonicalJson(execution))
    )
      throw new ContractError("stale");
    this.resources.assertWorkspace(
      this.tokens.get(this.view.worktreeRoot) ?? "",
    );
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
      ).trim() !== a.tree ||
      (
        await gitText(this.view.worktreeRoot, ["symbolic-ref", "HEAD"])
      ).trim() !== this.view.taskBranch
    )
      throw new ContractError("stale");
    assertRepository(this.view.binding.target);
    await assertTarget(
      this.view.binding.target.checkoutRoot,
      this.view.binding.target,
      scope,
    );
    if (
      (
        await gitRun(this.view.worktreeRoot, [
          "merge-base",
          "--is-ancestor",
          this.view.binding.target.head,
          candidate,
        ])
      ).code !== 0
    )
      throw new ContractError("stale");
    return candidate;
  }
  /** Each callback owns the short lease for one complete cleanup observation. */
  async cleanup(
    remove: (
      artifact: DeliveryArtifact,
      check: () => Promise<void>,
    ) => Promise<void>,
  ): Promise<void> {
    const retained: string[] = [];
    for (const artifact of this.view.artifacts) {
      try {
        await remove(artifact, async () => {
          if (
            this.view.integration.status !== "applied" ||
            !this.view.candidate ||
            this.view.integration.after !== this.view.candidate
          )
            throw new ContractError("stale");
          if (artifact.id !== "@candidate" && !artifact.appliedCommit)
            throw new ContractError("stale");
          if (
            artifact.appliedCommit &&
            (
              await gitRun(this.view.binding.target.checkoutRoot, [
                "merge-base",
                "--is-ancestor",
                artifact.appliedCommit,
                this.view.candidate,
              ])
            ).code !== 0
          )
            throw new ContractError("stale");
          this.resources.assertWorkspace(this.tokens.get(artifact.path) ?? "");
          if ((await gitHead(artifact.path)) !== artifact.head)
            throw new ContractError("stale");
          const branch = await gitRun(artifact.path, [
            "symbolic-ref",
            "--quiet",
            "HEAD",
          ]);
          if (
            artifact.branch
              ? branch.code !== 0 || branch.stdout.trim() !== artifact.branch
              : branch.code !== 1
          )
            throw new ContractError("stale");
          if ((await worktreeResidue(artifact.path)).length)
            throw new Error(
              "Uncommitted, untracked, ignored or index-hidden files retained",
            );
          if (
            (
              await gitRun(this.view.binding.target.checkoutRoot, [
                "merge-base",
                "--is-ancestor",
                this.view.candidate,
                this.view.binding.target.branch,
              ])
            ).code !== 0
          )
            throw new ContractError("stale");
        });
        this.resources.release(this.tokens.get(artifact.path) ?? "");
        this.tokens.delete(artifact.path);
        artifact.state = "removed";
      } catch (error) {
        artifact.state = "retained";
        retained.push(
          `${artifact.id}: ${error instanceof Error ? error.message : "cleanup unavailable"}`,
        );
      }
      this.save();
    }
    this.view.cleanup = {
      status: retained.length ? "retained" : "removed",
      reason: retained.join("; ").slice(0, 2048),
    };
    this.save();
    for (const path of [join(this.home, "tasks"), this.home])
      try {
        rmdirSync(path);
      } catch {
        /* Never recursively remove residue. */
      }
  }
  finish(): void {
    this.resources.finish();
    for (const a of this.view.artifacts)
      if (a.state !== "removed") a.state = "retained";
    if (this.view.preparation === "pending") this.view.preparation = "unknown";
    if (this.view.cleanup.status === "pending")
      this.view.cleanup = {
        status: "retained",
        reason: "Workspaces retained; no automatic replay or cleanup.",
      };
  }
}
