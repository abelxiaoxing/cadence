/** Behavior-family ReviewLedger kept privately inside workflows-v1.
 * Counts unclosed rounds per behavior family (not per arbitrary issue slug),
 * never silently closes omitted families, and escalates to architectural replan
 * when a behavior family fails to close twice after targeted repair or reopens. */
import { diagnosticText } from "../verification-diagnostics.ts";
import { sanitizeText } from "../worker-redaction.mjs";
import { issueText, type ReviewIssue } from "./workflow-report.ts";

export interface ReviewFamily {
  /** Owner-assigned stable ID ("F01", "F02", ...). */
  id: string;
  /** Acceptance item or invariant this obligation traces to (e.g. "AC-3"). */
  source: string;
  /** Concise behavioral family description. */
  summary: string;
  /** Latest concrete observable counterexample. */
  counterexample: string;
  /** Observable closing condition. */
  verify: string;
  status: "open" | "verified" | "reopened";
  /** Independent reviews after a targeted repair for this family that still found it unclosed. */
  unresolvedAfterRepair: number;
  /** True once a targeted repair for this family ran since the last review. */
  repairedSinceReview: boolean;
  /** Count of distinct architectural replan routes tried for this family. */
  replanRoutes: number;
  /** Latest candidate OID observed for this family. */
  lastCandidate: string | null;
  lastReviewStep: string;
  /** Historical issue IDs bound to this family (supports 4-field legacy review replies). */
  issueIds: string[];
}

export interface ReviewLedgerSnapshot {
  version: 1;
  round: number;
  families: ReviewFamily[];
  /** Acceptance sources with repeated `new` family creation requiring classification audit. */
  auditSources: string[];
}

export interface ReviewRoundOutcome {
  /** Unique owner-assigned family IDs hit by this review's blocking issues. */
  hitFamilies: string[];
  /** Families newly allocated in this round. */
  createdFamilies: string[];
  /** Families that require Architectural Replan escalation (unresolved >= 2 or reopened). */
  escalateFamilies: string[];
  /** Families where two distinct architectural replan routes already failed. */
  exhaustedFamilies: string[];
  /** Sources flagged for classification audit (never auto-merged or silently dropped). */
  auditSources: string[];
}

const FAMILY_ID = /^F[0-9]{2,4}$/u;

export class ReviewLedger {
  private round = 0;
  private nextId = 1;
  private readonly families = new Map<string, ReviewFamily>();
  private readonly newBySource = new Map<string, number>();
  private readonly auditSources = new Set<string>();

  snapshot(): ReviewLedgerSnapshot {
    return {
      version: 1,
      round: this.round,
      families: [...this.families.values()].map((f) => ({
        ...f,
        issueIds: [...f.issueIds],
      })),
      auditSources: [...this.auditSources].sort(),
    };
  }

  openFamilies(): ReviewFamily[] {
    return [...this.families.values()].filter((f) => f.status !== "verified");
  }

  /** Record the outcome of an independent review on `candidate`.
   * - Multiple counterexamples in the same round mapping to one family count ONCE.
   * - Unrepaired or unreviewed rounds never inflate `unresolvedAfterRepair`.
   * - Omitting an open family while rejecting does NOT close it; only explicit
   *   `closedFamilies` or `approved: true` transitions a family to `verified`. */
  recordReview(input: {
    approved: boolean;
    blockers: readonly (string | ReviewIssue)[];
    closedFamilies?: readonly string[];
    candidate: string | null;
    reviewStep: string;
  }): ReviewRoundOutcome {
    this.round++;
    const hit = new Set<string>();
    const created: string[] = [];
    const createdThisRoundBySource = new Map<string, number>();

    for (const blocker of input.blockers) {
      const fam = this.resolveOrCreate(
        blocker,
        input.candidate,
        input.reviewStep,
        created,
        createdThisRoundBySource,
      );
      hit.add(fam.id);
    }

    const escalateFamilies: string[] = [];
    const exhaustedFamilies: string[] = [];
    const hitSources = new Set<string>();

    for (const id of hit) {
      const fam = this.families.get(id);
      if (!fam) continue;
      hitSources.add(fam.source);
      const wasVerified = fam.status === "verified";
      if (wasVerified) {
        fam.status = "reopened";
        fam.unresolvedAfterRepair++;
      } else if (fam.repairedSinceReview) {
        fam.unresolvedAfterRepair++;
      }
      fam.repairedSinceReview = false;
      fam.lastCandidate = input.candidate;
      fam.lastReviewStep = input.reviewStep;
      if (fam.status === "reopened" || fam.unresolvedAfterRepair >= 2)
        escalateFamilies.push(fam.id);
      if (fam.replanRoutes >= 2 && fam.unresolvedAfterRepair >= 2)
        exhaustedFamilies.push(fam.id);
    }

    // Close only families explicitly verified by the reviewer (or all open on approval).
    const closedSet = new Set(input.closedFamilies ?? []);
    for (const fam of this.families.values()) {
      if (hit.has(fam.id) || fam.status === "verified") continue;
      if (input.approved || closedSet.has(fam.id)) {
        fam.status = "verified";
        fam.repairedSinceReview = false;
        fam.lastCandidate = input.candidate;
        fam.lastReviewStep = input.reviewStep;
      }
    }

    // Track frequent `new` allocations under one acceptance source to trigger
    // classification audit rather than silently merging or discarding.
    for (const [source, count] of createdThisRoundBySource) {
      if (source === "agreement") continue;
      const total = (this.newBySource.get(source) ?? 0) + count;
      this.newBySource.set(source, total);
      const openUnderSource = [...this.families.values()].filter(
        (f) => f.source === source && f.status !== "verified",
      ).length;
      if (openUnderSource > 0 && (total >= 3 || openUnderSource >= 3))
        this.auditSources.add(source);
    }

    // Prune sources whose families have all been closed so prior audits never
    // permanently poison unrelated future rejections.
    for (const source of [...this.auditSources]) {
      const hasOpen = [...this.families.values()].some(
        (f) => f.source === source && f.status !== "verified",
      );
      if (!hasOpen) this.auditSources.delete(source);
    }

    return {
      hitFamilies: [...hit].sort(),
      createdFamilies: created,
      escalateFamilies: escalateFamilies.sort(),
      exhaustedFamilies: exhaustedFamilies.sort(),
      auditSources: [...this.auditSources]
        .filter((s) => hitSources.has(s))
        .sort(),
    };
  }

  /** Called by the owner ONLY after a repair/replan work item actually executes
   * against `familyIds`, so build failures or skipped reviews never advance counts. */
  markRepaired(
    familyIds: readonly string[],
    architecturalReplan = false,
  ): void {
    for (const id of new Set(familyIds)) {
      const fam = this.families.get(id);
      if (!fam) continue;
      fam.repairedSinceReview = true;
      if (architecturalReplan) fam.replanRoutes++;
    }
  }

  private resolveOrCreate(
    blocker: string | ReviewIssue,
    candidate: string | null,
    reviewStep: string,
    created: string[],
    createdBySource: Map<string, number>,
  ): ReviewFamily {
    if (typeof blocker !== "string") {
      const requested = blocker.family?.trim();
      if (requested && FAMILY_ID.test(requested)) {
        const existing = this.families.get(requested);
        if (existing) {
          existing.counterexample = blocker.evidence;
          existing.verify = blocker.verify;
          if (!existing.issueIds.includes(blocker.id))
            existing.issueIds.push(blocker.id);
          return existing;
        }
      }
      if (!requested || requested !== "new") {
        // Legacy 4-field issue (no family field): match existing family by issue ID.
        for (const fam of this.families.values()) {
          if (fam.issueIds.includes(blocker.id)) {
            fam.counterexample = blocker.evidence;
            fam.verify = blocker.verify;
            return fam;
          }
        }
      }
      const id = `F${String(this.nextId++).padStart(2, "0")}`;
      const source = blocker.source?.trim() || "agreement";
      const summary =
        blocker.familySummary?.trim() || blocker.evidence.slice(0, 180).trim();
      const fam: ReviewFamily = {
        id,
        source,
        summary,
        counterexample: blocker.evidence,
        verify: blocker.verify,
        status: "open",
        unresolvedAfterRepair: 0,
        repairedSinceReview: false,
        replanRoutes: 0,
        lastCandidate: candidate,
        lastReviewStep: reviewStep,
        issueIds: [blocker.id],
      };
      this.families.set(id, fam);
      created.push(id);
      createdBySource.set(source, (createdBySource.get(source) ?? 0) + 1);
      return fam;
    }

    // Freeform string blocker fallback: match exact text if previously recorded.
    for (const fam of this.families.values()) {
      if (fam.counterexample === blocker) return fam;
    }
    const id = `F${String(this.nextId++).padStart(2, "0")}`;
    const fam: ReviewFamily = {
      id,
      source: "agreement",
      summary: issueText(blocker).slice(0, 180),
      counterexample: blocker,
      verify: "Resolve the reported blocking condition.",
      status: "open",
      unresolvedAfterRepair: 0,
      repairedSinceReview: false,
      replanRoutes: 0,
      lastCandidate: candidate,
      lastReviewStep: reviewStep,
      issueIds: [],
    };
    this.families.set(id, fam);
    created.push(id);
    return fam;
  }

  /** Concise ledger context supplied to the independent Reviewer on every round. */
  briefForReview(secrets: readonly string[], maxBytes = 4096): string {
    if (!this.families.size) return "";
    const lines = [...this.families.values()].map(
      (f) =>
        `- ${f.id} [${f.status}; source: ${f.source}; unresolved-after-repair: ${f.unresolvedAfterRepair}; replan-routes: ${f.replanRoutes}]: ${f.summary}\n  Counterexample: ${f.counterexample}\n  Closing condition: ${f.verify}`,
    );
    const audit = this.auditSources.size
      ? `\nClassification audit required for acceptance source(s): ${[...this.auditSources].join(", ")}. Check whether distinct families under this source share one root behavioral invariant; cite existing family IDs rather than creating duplicates, and only use "new" for genuinely distinct behavior.`
      : "";
    return diagnosticText(
      `Behavior-family review ledger (reuse an existing family ID like "F01" when a finding belongs to that behavior family; use "new" with familySummary only for a distinct behavior; list any previously open family IDs confirmed closed on this candidate in closedFamilies; omitting an open family does NOT close it):\n${lines.join("\n")}${audit}`,
      maxBytes,
      secrets,
    );
  }

  /** Architectural Replan brief for diagnosis when families fail to converge. */
  briefForReplan(
    hitFamilies: readonly string[],
    churnWarnings: readonly string[],
    secrets: readonly string[],
  ): string {
    const items = hitFamilies
      .map((id) => this.families.get(id))
      .filter((f): f is ReviewFamily => !!f);
    if (!items.length) return "";
    const exhausted = items.filter(
      (f) => f.replanRoutes >= 2 && f.unresolvedAfterRepair >= 2,
    );
    const lines = items.map(
      (f) =>
        `- ${f.id} (${f.status}, source ${f.source}, unresolved ${f.unresolvedAfterRepair}x after repair, ${f.replanRoutes} replan routes): ${f.summary} | Latest counterexample: ${f.counterexample} | Closing condition: ${f.verify}`,
    );
    const churn = churnWarnings.length
      ? `\nAdvisory non-build source file churn (>=3 edits): ${churnWarnings.join(", ")} (warning only; derived build outputs are excluded).`
      : "";
    const guidance = exhausted.length
      ? `\nTwo genuinely distinct architectural replan routes already failed for ${exhausted.map((f) => f.id).join(", ")}. Do NOT propose another minor patch of the same architecture. Only propose level "deviate" if concrete evidence proves the acceptance item is objectively impossible as written (never merely because attempts ran out); otherwise return action "blocked" (or end honestly) so the candidate is retained unmerged.`
      : `\nARCHITECTURAL REPLAN REQUIRED (local patching failed to close these behavior families). Name: (1) the shared false assumption across failed patches, (2) a genuinely distinct alternative architecture/behavior matrix, (3) obsolete or tangled branches to delete, and (4) the minimal discriminating test that separates old and new designs.`;
    return diagnosticText(
      sanitizeText(
        `Unconverged behavior families:\n${lines.join("\n")}${churn}${guidance}`,
        secrets,
      ),
      4096,
    );
  }
}
