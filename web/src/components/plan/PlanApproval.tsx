import { useEffect, useRef, useState } from "react";
import { canonicalJson } from "../../../../src/service-contract.ts";
import {
  type CommandObservation,
  type PreparedAction,
  prepare,
} from "../../client/actions";
import { planMetadataClient } from "../../client/plan-metadata";
import { approvePlan } from "../../client/task-entry";
import { contentCursor, readFullText } from "../../history/readers";
import { useT } from "../../i18n/locale";
import type { ContextVersion, RunProjection, ServiceClient } from "../../types";
import { ActionDialog } from "../actions/ActionDialog";
import { ActionProposal } from "../actions/ConfirmAction";

export function PlanApproval({
  client,
  storeId,
  context,
  runs,
  snapshotSeq,
  canAct,
  onResult,
}: {
  client: ServiceClient;
  storeId: string;
  context: ContextVersion;
  runs: RunProjection[];
  snapshotSeq: string;
  canAct: boolean;
  onResult(value: CommandObservation): void;
}) {
  const { t, tx } = useT();
  const [prepared, setPrepared] = useState<PreparedAction>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  const invalidated = useRef(false);
  const latest = useRef({ context, canAct });
  latest.current = { context, canAct };
  useEffect(() => () => operation.current?.abort(), []);
  const planner = runs.find(
    (run) =>
      run.childRunId &&
      run.admission.kind === "generate-plan" &&
      run.lifecycle === "settled" &&
      run.outcome === "completed" &&
      run.result &&
      run.coverage.observed === "complete",
  );
  const parent =
    planner &&
    runs.find((run) => !run.childRunId && run.runId === planner.runId);
  const ready =
    !!planner &&
    parent?.lifecycle === "settled" &&
    parent.outcome === "completed" &&
    parent.publication === "published";
  if (
    prepared &&
    canonicalJson(prepared.preflight.preview.version) !== canonicalJson(context)
  )
    invalidated.current = true;
  const stale = !!prepared && invalidated.current;
  const review = async () => {
    if (
      !canAct ||
      !ready ||
      !planner?.result ||
      !planner.childRunId ||
      operation.current ||
      !context.task
    )
      return;
    const abort = new AbortController();
    operation.current = abort;
    setBusy(true);
    setError("");
    const unchanged = () => {
      if (
        abort.signal.aborted ||
        !latest.current.canAct ||
        canonicalJson(latest.current.context) !== canonicalJson(context)
      )
        throw new Error("stale");
    };
    try {
      const text = await readFullText(
        client,
        contentCursor(
          storeId,
          { kind: "child", id: planner.childRunId },
          snapshotSeq,
          planner.result,
        ),
        abort.signal,
      );
      unchanged();
      if (!text.recordingComplete || !text.text.trim())
        throw new Error("incomplete-content");
      const metadata = planMetadataClient(client, storeId);
      const reply = await metadata.read(context);
      unchanged();
      if (reply.kind === "error") throw new Error(reply.error.code);
      if ("kind" in reply.value)
        throw new Error("Plan metadata read in progress. Try again after observation completes.");
      if (reply.value.savedGraph || reply.value.readablePlan.trim())
        throw new Error("This task already has a plan. Review it in Task details instead.");
      const role = reply.value.roles.find(
        (role) => role.role === "implementation-worker",
      );
      if (!role) throw new Error("unavailable");
      const action = await metadata.saveAction(context, {
        readablePlan: text.text,
        assignments: [
          {
            id: "implement",
            purpose: "edit",
            instructions:
              "Implement only the supplied human-approved plan. Stop and report any blocker or required scope change.",
            expectedOutput:
              "Implement the approved plan and report changes, attempted checks and remaining issues.",
            role,
            model: context.model,
            dependencies: [],
          },
        ],
      });
      unchanged();
      if (action.kind === "error") throw new Error(action.error.code);
      const result = await prepare(client, context, action.value);
      unchanged();
      if (result.kind === "error") throw new Error(result.error.code);
      invalidated.current = false;
      setPrepared(result.value);
    } catch (error) {
      if (!abort.signal.aborted)
        setError(error instanceof Error ? error.message : "unavailable");
    } finally {
      if (!abort.signal.aborted) setBusy(false);
      if (operation.current === abort) operation.current = null;
    }
  };
  const accept = async () => {
    if (!prepared || stale || !canAct || operation.current || prepared.submitted)
      return;
    if (Date.now() >= Date.parse(prepared.preflight.expiresAt)) {
      setError(t("Plan confirmation expired. Review the plan again."));
      setPrepared(undefined);
      return;
    }
    const abort = new AbortController();
    operation.current = abort;
    setBusy(true);
    try {
      await approvePlan({
        client,
        storeId,
        prepared,
        signal: abort.signal,
        observe: onResult,
      });
      if (!abort.signal.aborted) setPrepared(undefined);
    } catch (error) {
      if (!abort.signal.aborted) {
        setPrepared(undefined);
        setError(
          t("Plan execution stopped: {reason}. Observe the original receipt; no automatic retry.", {
            reason: error instanceof Error ? error.message : "unavailable",
          }),
        );
      }
    } finally {
      if (!abort.signal.aborted) setBusy(false);
      if (operation.current === abort) operation.current = null;
    }
  };
  if (
    context.task?.kind !== "code" ||
    (!prepared && !error && runs.some((run) => run.admission.kind === "start"))
  )
    return null;
  return (
    <section className="banner-notice" aria-label={t("Plan approval")}>
      <p>
        {ready
          ? t("Analysis complete. Review the plan before making changes.")
          : t("Analysis and progress appear below. No edits start before plan approval.")}
      </p>
      <button
        type="button"
        disabled={!canAct || !ready || busy}
        onClick={() => void review()}
      >
        {t("Review implementation plan")}
      </button>
      {error && <p role="alert">{tx(error)}</p>}
      {prepared && (
        <ActionDialog
          title={t("Confirm plan and execute")}
          onClose={() => {
            if (!busy) setPrepared(undefined);
          }}
        >
          <p>
            {t("Approving saves this exact plan and starts it. No separate Start confirmation is needed.")}
          </p>
          <p>
            <code>{prepared.preflight.preview.cwdLabel}</code> ·{" "}
            {context.model.provider}/{context.model.model} ·{" "}
            {context.model.thinking}
          </p>
          <ActionProposal preview={prepared.preflight.preview} />
          {prepared.preflight.preview.issues.length > 0 && (
            <p role="alert">
              {t("Issues: {issues}", {
                issues: prepared.preflight.preview.issues.map(tx).join(", "),
              })}
            </p>
          )}
          {stale && (
            <p role="alert">
              {t("Context changed. Close and review the plan again.")}
            </p>
          )}
          <footer>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPrepared(undefined)}
            >
              {t("Back — no new effect")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || stale || !canAct}
              onClick={() => void accept()}
            >
              {t("Confirm plan and execute")}
            </button>
          </footer>
        </ActionDialog>
      )}
    </section>
  );
}
