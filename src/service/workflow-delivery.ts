/** One named branch and stable candidate per approved delivery. The workflow
 * owns all native Git execution; this module owns placement and evidence.
 * Development checkpoints stay detached and pinned under private run refs
 * (`refs/cadence/runs/<run-id>/checkpoints/<n>`). The candidate is sealed as a
 * single-parent commit on the commit it was developed from; when the target
 * branch has moved, that sealed commit is replayed onto the branch's current
 * head. The named task branch advances only to a signed-off OID, and private
 * checkpoint refs are removed only after confirmed worktree removal. */
import { lstatSync, rmdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { diagnosticText } from "../verification-diagnostics.ts";
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
  assertWorktree,
  gitHead,
  gitRun,
  gitText,
  nested,
  WorkflowRefusal,
  worktreeResidue,
} from "./workflow-git.ts";

export interface CheckpointEntry {
  seq: number;
  ref: string;
  oid: string;
  kind: "dev" | "merge" | "delivery";
  status: "intent" | "confirmed" | "deleted";
}

export interface BranchUpdateEntry {
  branch: string;
  oldOid: string;
  newOid: string;
  status: "intent" | "confirmed";
}

export interface DeliveryJournal {
  recordCheckpoints(entries: readonly CheckpointEntry[]): void;
  recordBranchUpdate?(entry: BranchUpdateEntry): void;
  /** Identity-verified owner-provisioned symlinks in `cwd` (never excludes staged/committed/residue). */
  managedLinks?(cwd: string): readonly string[];
}

type Git = (args: string[]) => Promise<unknown>;
/** A Git command whose output is read (the OID `commit-tree` prints). */
type GitOutput = (
  args: string[],
) => Promise<{ stdout?: string; output?: string }>;

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
    lastCheckpoint: null,
    checkpointCount: 0,
    candidate: null,
    acceptance: null,
    integration: {
      status: "pending",
      before: binding.target.head,
      after: null,
      reason: "",
    },
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
  /** Check steps a recorded deviation set aside: they ran and settled as failed. */
  waived: ReadonlySet<string> = new Set(),
  /** The run and commit a group of deliveries was verified in, for a member. */
  group?: AcceptanceRecord["group"],
): AcceptanceRecord {
  if (
    checks.length !== expectedChecks ||
    !checks.length ||
    new Set(checks.map((s) => s.id)).size !== checks.length ||
    checks.some((s) =>
      s.kind !== "check" || waived.has(s.id)
        ? s.kind !== "check" || s.status !== "failed"
        : s.status !== "completed" || s.exitCode !== 0,
    ) ||
    // Never a delivery whose every check was set aside.
    checks.every((s) => waived.has(s.id)) ||
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
    ...(waived.size
      ? { waived: checks.filter((s) => waived.has(s.id)).map((s) => s.id) }
      : {}),
    ...(group ? { group } : {}),
  };
}

const zeroOid = (oid: string) => "0".repeat(oid.length);

const RESIDUE_PREVIEW_LIMIT = 8;

function residueMessage(
  paths: readonly string[],
  secrets: readonly string[] = [],
): string {
  const shown = paths.slice(0, RESIDUE_PREVIEW_LIMIT).join(", ");
  const more =
    paths.length > RESIDUE_PREVIEW_LIMIT
      ? ` and ${paths.length - RESIDUE_PREVIEW_LIMIT} more`
      : "";
  return diagnosticText(
    `Uncommitted, untracked, ignored or index-hidden files retained: ${shown}${more}`,
    1024,
    secrets,
  );
}

export class WorkflowDelivery {
  private token: string | undefined;
  /** Reservation of each live child worktree, by its path. */
  private readonly children = new Map<string, string>();
  /** Private checkpoint refs pinned by this run (in creation order). */
  private readonly checkpoints: CheckpointEntry[] = [];
  /** The commit the candidate is sealed on: the target's head when the run
   * was admitted, then each head it was replayed onto. In memory only;
   * interrupted deliveries are never resumed after restart. */
  private base: string;
  readonly home: string;
  private readonly runId: string;
  constructor(
    readonly view: DeliveryObservation,
    readonly resources: RepositoryCoordination,
    private readonly save: () => void,
    private readonly journal?: DeliveryJournal,
  ) {
    this.home = dirname(view.worktreeRoot);
    this.runId = basename(this.home);
    this.base = view.binding.target.head;
  }

  /** Confirmed private checkpoint refs currently owned by this run. */
  confirmedCheckpoints(): readonly CheckpointEntry[] {
    return this.checkpoints.filter((c) => c.status === "confirmed");
  }

  /** Whether `oid` was confirmed as a sealed delivery commit owned by this run. */
  isSealedDelivery(oid: string): boolean {
    return this.checkpoints.some(
      (c) => c.kind === "delivery" && c.status === "confirmed" && c.oid === oid,
    );
  }

  private links(cwd = this.view.worktreeRoot): readonly string[] {
    return this.journal?.managedLinks?.(cwd) ?? [];
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

  /** Reserves the named task branch at the baseline and creates the detached
   * candidate there. Caller holds the short repository mutation lease. */
  async create(git: Git): Promise<string> {
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
    this.view.workspace = {
      head: binding.target.head,
      state: "preparing",
      mode: "detached",
    };
    this.save();
    // Intermediate work stays detached until a signed-off delivery commit
    // advances the branch.
    await git([
      "update-ref",
      branch,
      binding.target.head,
      zeroOid(binding.target.head),
    ]);
    await git(["worktree", "add", "--detach", path, binding.target.head]);
    await assertWorktree(binding.target.checkoutRoot, path);
    if (
      (await gitHead(path)) !== binding.target.head ||
      (await gitRun(path, ["symbolic-ref", "-q", "HEAD"])).code === 0 ||
      (
        await gitText(binding.target.checkoutRoot, [
          "rev-parse",
          "--verify",
          branch,
        ])
      ).trim() !== binding.target.head
    )
      throw new ContractError("stale");
    this.resources.confirmWorkspace(this.token);
    this.view.workspace.state = "ready";
    this.view.preparation = "ready";
    this.save();
    return path;
  }

  /** Pin a detached commit under `refs/cadence/runs/<run-id>/checkpoints/<n>`
   * so Git GC never reaps it. Writes private intent BEFORE creating the ref and
   * reads the ref back before confirming. Caller holds the repo mutation lease. */
  async pinCheckpoint(
    oid: string,
    kind: CheckpointEntry["kind"],
    git: Git,
    cwd = this.view.worktreeRoot,
  ): Promise<CheckpointEntry> {
    const seq = this.checkpoints.length + 1;
    const ref = `refs/cadence/runs/${decodeId(this.runId)}/checkpoints/${seq}`;
    const entry: CheckpointEntry = {
      seq,
      ref,
      oid,
      kind,
      status: "intent",
    };
    this.checkpoints.push(entry);
    this.journal?.recordCheckpoints(this.checkpoints);
    await git(["update-ref", "--no-deref", ref, oid, zeroOid(oid)]);
    const confirmed = (
      await gitText(cwd, ["rev-parse", "--verify", "--quiet", ref])
    ).trim();
    if (confirmed !== oid) throw new ContractError("stale");
    entry.status = "confirmed";
    this.journal?.recordCheckpoints(this.checkpoints);
    this.view.lastCheckpoint = oid;
    this.view.checkpointCount = this.checkpoints.filter(
      (c) => c.status === "confirmed",
    ).length;
    this.save();
    return entry;
  }

  /** A delivery commit the candidate's HEAD already is: exactly one parent,
   * nothing outside the scope, nothing uncommitted. Pinned before it becomes
   * the candidate. */
  private async adopt(
    delivery: string,
    parent: string,
    scope: readonly string[],
  ): Promise<string> {
    const cwd = this.view.worktreeRoot;
    if (
      (await gitHead(cwd)) !== delivery ||
      (await gitText(cwd, ["show", "-s", "--format=%P", delivery])).trim() !==
        parent
    )
      throw new ContractError("stale");
    await assertCandidate(cwd, delivery, this.links());
    await assertCommittedScope(cwd, parent, delivery, scope);
    this.update(delivery, cwd);
    this.view.candidate = delivery;
    this.save();
    return delivery;
  }

  /** Seal a single-parent delivery commit on top of `parentOid` whose tree matches
   * the current verified candidate tree identically. Never moves `taskBranch`.
   * Caller holds the repository mutation lease. */
  async sealDeliveryCommit(
    parentOid: string,
    scope: readonly string[],
    message: string,
    git: GitOutput,
  ): Promise<string> {
    const cwd = this.view.worktreeRoot;
    const current = await this.assertTip(cwd);
    await assertCandidate(cwd, current, this.links());
    await assertCommittedScope(cwd, parentOid, current, scope);
    const tree = (
      await gitText(cwd, ["rev-parse", `${current}^{tree}`])
    ).trim();
    const created = await git([
      "commit-tree",
      tree,
      "-p",
      parentOid,
      "-m",
      message,
    ]);
    const deliveryOid = (created.output ?? created.stdout ?? "").trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(deliveryOid))
      throw new ContractError("unavailable");
    // Pin immediately before moving detached HEAD so the sealed object is
    // GC-reachable even if the process crashes mid-seal.
    await this.pinCheckpoint(deliveryOid, "delivery", git, cwd);
    await git(["reset", "--soft", deliveryOid]);
    if (
      (await gitText(cwd, ["rev-parse", `${deliveryOid}^{tree}`])).trim() !==
      tree
    )
      throw new ContractError("stale");
    return this.adopt(deliveryOid, parentOid, scope);
  }

  /** The candidate's worktree now stands on the target branch's current head,
   * ready for the sealed commit to be replayed there. Until what the replay
   * leaves is committed and sealed there is no candidate and no acceptance. */
  moved(frontier: string): void {
    if (this.view.workspace?.state !== "ready")
      throw new ContractError("stale");
    this.view.workspace.head = frontier;
    this.base = frontier;
    this.view.candidate = null;
    this.view.acceptance = null;
    this.save();
  }

  /** Another run landed this candidate as one of several: `commit` is what
   * it became on the branch, on `parent`, with the evidence that group was
   * accepted on. `moved` says the worktree was put onto that commit. */
  carried(
    commit: string,
    parent: string,
    acceptance: AcceptanceRecord,
    moved: boolean,
  ): void {
    if (
      this.view.workspace?.state !== "ready" ||
      acceptance.candidate !== commit
    )
      throw new ContractError("stale");
    if (moved) this.view.workspace.head = commit;
    this.base = parent;
    this.view.candidate = commit;
    this.view.acceptance = acceptance;
    this.save();
  }

  /** Git refused to replay at all and the attempt was undone: the worktree is
   * back on the sealed commit it had before, on the base it had before. */
  restored(sealed: string, base: string): void {
    if (this.view.workspace?.state !== "ready")
      throw new ContractError("stale");
    this.view.workspace.head = sealed;
    this.base = base;
    this.view.candidate = sealed;
    this.view.acceptance = null;
    this.save();
  }

  /** Advance the reserved `taskBranch` to a signed-off delivery OID by
   * compare-and-swap. The branch belongs to this run, so its new value need
   * not descend from the old one: a target whose history was rewritten is
   * followed like any other. Caller holds the repo mutation lease. */
  async advanceTaskBranch(signedOid: string, git: Git): Promise<void> {
    const targetRoot = this.view.binding.target.checkoutRoot;
    const branch = this.view.taskBranch;
    const oldOid = (
      await gitText(targetRoot, ["rev-parse", "--verify", branch])
    ).trim();
    if (oldOid === signedOid) return;
    this.journal?.recordBranchUpdate?.({
      branch,
      oldOid,
      newOid: signedOid,
      status: "intent",
    });
    await git(["update-ref", branch, signedOid, oldOid]);
    const observed = (
      await gitText(targetRoot, ["rev-parse", "--verify", branch])
    ).trim();
    if (observed !== signedOid) throw new ContractError("stale");
    this.journal?.recordBranchUpdate?.({
      branch,
      oldOid,
      newOid: signedOid,
      status: "confirmed",
    });
  }

  /** Nothing could be put on the target branch: the task branch takes the
   * last accepted candidate, which stays this delivery's result. The worktree
   * is kept, whatever state the attempt to land left it in. Caller holds the
   * repo mutation lease. */
  async retainOnBranch(
    candidate: string,
    record: AcceptanceRecord,
    reason: string,
    git: Git,
  ): Promise<void> {
    if (record.candidate !== candidate || !this.isSealedDelivery(candidate))
      throw new ContractError("stale");
    await this.advanceTaskBranch(candidate, git);
    this.view.candidate = candidate;
    this.view.acceptance = record;
    this.view.integration = {
      status: "branch",
      before: this.view.integration.before,
      after: null,
      reason,
    };
    this.view.cleanup = {
      status: "retained",
      reason: "The delivery was not merged; its worktree is kept.",
    };
    this.save();
  }

  /** Where the assignment's own worktree lives, beside the candidate. */
  childPath(id: string): string {
    return join(this.home, "tasks", id);
  }

  /** The live child worktree at `path`, if this run owns one there. */
  private child(path: string): DeliveryArtifact | undefined {
    return this.view.artifacts?.find(
      (a) => a.path === path && this.children.has(path),
    );
  }

  /** A worktree for one assignment that runs beside others, detached at the
   * candidate's current commit so it starts from everything already integrated.
   * Caller holds the short repository mutation lease across creation. */
  async createChild(id: string, git: Git): Promise<string> {
    const path = this.childPath(id);
    const base = await this.assertTip();
    if (
      this.view.artifacts?.some((a) => a.path === path) ||
      safeDirectory(path)
    )
      throw new ContractError("conflict");
    if (!safeDirectory(dirname(path), true))
      throw new ContractError("forbidden");
    const token = this.resources.reserveWorkspace(path);
    this.children.set(path, token);
    const artifact: DeliveryArtifact = {
      id,
      path,
      base,
      head: base,
      applied: null,
      state: "preparing",
    };
    this.view.artifacts = [...(this.view.artifacts ?? []), artifact];
    this.save();
    await git(["worktree", "add", "--detach", path, base]);
    await assertWorktree(this.view.binding.target.checkoutRoot, path);
    if ((await gitHead(path)) !== base) throw new ContractError("stale");
    this.resources.confirmWorkspace(token);
    artifact.state = "ready";
    this.save();
    return path;
  }

  assertWorkspace(path: string): void {
    if (path === this.view.worktreeRoot) {
      this.resources.assertWorkspace(this.token ?? "");
      return;
    }
    const token = this.children.get(path);
    if (!token || !this.child(path)) throw new ContractError("stale");
    this.resources.assertWorkspace(token);
  }

  /** The candidate and every child work on a detached HEAD; none of them ever
   * owns or moves a branch. */
  async assertBinding(path: string): Promise<void> {
    this.assertWorkspace(path);
    if (
      (path === this.view.worktreeRoot
        ? this.view.workspace?.state
        : this.child(path)?.state) !== "ready" ||
      (await gitRun(path, ["symbolic-ref", "-q", "HEAD"])).code === 0
    )
      throw new ContractError("stale");
    await assertWorktree(this.view.binding.target.checkoutRoot, path);
  }

  /** Working bytes may be partial work. HEAD must still be the owner's last
   * commit, in the candidate (the default) or in one of its child worktrees. */
  async assertTip(path = this.view.worktreeRoot): Promise<string> {
    await this.assertBinding(path);
    const head =
      path === this.view.worktreeRoot
        ? this.view.workspace?.head
        : this.child(path)?.head;
    if (!head)
      throw new WorkflowRefusal(
        "stale",
        `No owner-recorded HEAD exists for worktree ${path}; its files and commits are retained.`,
      );
    const observed = await gitHead(path);
    if (observed !== head)
      throw new WorkflowRefusal(
        "stale",
        `Worktree HEAD changed outside the owner's recorded Git operations: ${path}; expected ${head}, observed ${observed}. Its files and commits are retained; no automatic adoption or replay.`,
      );
    return head;
  }

  update(head: string, path = this.view.worktreeRoot): void {
    if (path !== this.view.worktreeRoot) {
      const child = this.child(path);
      if (child?.state !== "ready") throw new ContractError("stale");
      child.head = head;
      this.save();
      return;
    }
    if (this.view.workspace?.state !== "ready")
      throw new ContractError("stale");
    this.view.workspace.head = head;
    this.view.acceptance = null;
    this.save();
  }

  /** The candidate commit a child's work became. */
  applied(path: string, commit: string): void {
    const child = this.child(path);
    if (!child) throw new ContractError("stale");
    child.applied = commit;
    this.save();
  }

  /** Removes an integrated child's worktree when nothing at all is left in it;
   * optional `prepareCleanup` unlinks identity-verified owner-managed links
   * strictly before `worktreeResidue()`. Any residue or unconfirmed removal retains it. */
  async removeChild(
    path: string,
    remove: (path: string, check: () => Promise<void>) => Promise<void>,
    options: {
      prepareCleanup?: () => Promise<void> | void;
      secrets?: () => readonly string[];
    } = {},
  ): Promise<void> {
    const child = this.child(path);
    if (!child) throw new ContractError("stale");
    try {
      await remove(path, async () => {
        if (!child.applied || (await this.assertTip(path)) !== child.head)
          throw new ContractError("stale");
        await options.prepareCleanup?.();
        const residue = await worktreeResidue(path);
        if (residue.length)
          throw new Error(residueMessage(residue, options.secrets?.() ?? []));
      });
      if (safeDirectory(path))
        throw new Error("Worktree removal was not confirmed");
      this.resources.release(this.children.get(path) ?? "");
      this.children.delete(path);
      child.state = "removed";
    } catch {
      child.state = "retained";
    }
    this.save();
    try {
      rmdirSync(dirname(path));
    } catch {
      /* Only remove an already empty directory. */
    }
  }

  /** The commit the candidate is sealed on, and so the base of this run's own
   * changes: everything the target branch had up to there is not ours. */
  candidateBase(): string {
    return this.base;
  }

  /** The candidate's current-round evidence: this plan, this context, this
   * exact commit and tree, nothing uncommitted and nothing outside the scope.
   * Where the target branch stands is decided at the landing, not here. */
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
    await assertCandidate(this.view.worktreeRoot, candidate, this.links());
    await assertCommittedScope(
      this.view.worktreeRoot,
      this.base,
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
    return candidate;
  }

  /** Only a landed, accepted candidate leads here; ignored residue anywhere
   * retains the worktree. The named branch is never deleted, even on
   * successful cleanup: it is what keeps the delivery commit reachable once
   * the confirmed private checkpoint refs are deleted, by exact OID, after
   * confirmed worktree removal. */
  async cleanup(
    remove: (path: string, check: () => Promise<void>) => Promise<void>,
    options: {
      prepareCleanup?: () => Promise<void> | void;
      deleteCheckpointRefs?: (
        refs: readonly { ref: string; oid: string }[],
      ) => Promise<readonly string[]>;
      secrets?: () => readonly string[];
    } = {},
  ): Promise<void> {
    const path = this.view.worktreeRoot;
    try {
      await remove(path, async () => {
        const { candidate, acceptance, integration } = this.view;
        if (
          integration.status !== "applied" ||
          !candidate ||
          acceptance?.candidate !== candidate ||
          integration.after !== candidate ||
          (await this.assertTip()) !== candidate
        )
          throw new ContractError("stale");
        assertRepository(this.view.binding.target);
        await options.prepareCleanup?.();
        const residue = await worktreeResidue(path);
        if (residue.length)
          throw new Error(residueMessage(residue, options.secrets?.() ?? []));
        if (
          (
            await gitRun(this.view.binding.target.checkoutRoot, [
              "merge-base",
              "--is-ancestor",
              candidate,
              this.view.taskBranch,
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
      const confirmed = this.checkpoints.filter(
        (cp) => cp.status === "confirmed",
      );
      if (options.deleteCheckpointRefs && confirmed.length) {
        try {
          const deleted = new Set(
            await options.deleteCheckpointRefs(
              confirmed.map((cp) => ({ ref: cp.ref, oid: cp.oid })),
            ),
          );
          for (const cp of confirmed)
            if (deleted.has(cp.ref)) cp.status = "deleted";
        } catch {
          /* Retain refs if exact-OID deletion fails; never break settled cleanup. */
        }
        this.journal?.recordCheckpoints(this.checkpoints);
      }
    } catch (error) {
      if (this.view.workspace) this.view.workspace.state = "retained";
      this.view.cleanup = {
        status: "retained",
        reason: diagnosticText(
          error instanceof Error ? error.message : "Cleanup unavailable",
          1536,
          options.secrets?.() ?? [],
        ),
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
    for (const child of this.view.artifacts ?? [])
      if (child.state !== "removed") child.state = "retained";
    if (this.view.preparation === "pending") this.view.preparation = "unknown";
    if (this.view.cleanup.status === "pending")
      this.view.cleanup = {
        status: "retained",
        reason: "Worktree retained; no automatic replay or cleanup.",
      };
  }
}
