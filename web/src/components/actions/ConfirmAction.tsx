import { useEffect, useRef, useState } from "react";
import { canonicalJson } from "../../../../src/service-contract.ts";
import {
  type CommandObservation,
  confirm,
  type PreparedAction,
} from "../../client/actions";
import type { ContextVersion, ServiceClient } from "../../types";
import { Markdown } from "../rich/Markdown";
import { ActionDialog } from "./ActionDialog";
export function ConfirmAction({
  prepared,
  client,
  current,
  onClose,
  onResult,
  attachmentVersion,
}: {
  prepared: PreparedAction;
  client: ServiceClient;
  current: ContextVersion | null;
  attachmentVersion: number;
  onClose: () => void;
  onResult: (r: CommandObservation) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const p = prepared.preflight,
    preview = p.preview;
  const initialAttachment = useRef(attachmentVersion);
  const invalidated = useRef(false);
  const changed =
    !current ||
    canonicalJson(current) !== canonicalJson(preview.version) ||
    now >= Date.parse(p.expiresAt) ||
    initialAttachment.current !== attachmentVersion;
  if (changed) invalidated.current = true;
  const stale = invalidated.current;
  const submit = async () => {
    if (stale || prepared.submitted) return;
    setSending(true);
    // Register identity before the await so a lost response remains observable after dismissal.
    onResult({
      commandId: prepared.commandId,
      error: "Admission pending/unknown — observe this exact receipt.",
    });
    try {
      const reply = await confirm(client, prepared);
      onResult(
        reply.kind === "ok"
          ? { commandId: prepared.commandId, receipt: reply.value }
          : {
              commandId: prepared.commandId,
              error: `${reply.error.code}; effect ${reply.error.effect}`,
            },
      );
    } catch {
      onResult({
        commandId: prepared.commandId,
        error: "Uncertain; do not repeat the action.",
      });
    }
    onClose();
  };
  return (
    <ActionDialog title={`Confirm ${preview.action.kind}`} onClose={onClose}>
      <p>
        Access is not consent. This confirmation applies only to the displayed
        context, once.
      </p>
      <dl>
        <dt>Checkout</dt>
        <dd>{preview.rootLabel}</dd>
        <dt>Working directory</dt>
        <dd>
          <code>{preview.cwdLabel}</code>
        </dd>
        <dt>Model / API / thinking</dt>
        <dd>
          {preview.version.model.provider} / {preview.version.model.model} /{" "}
          {preview.version.model.api} / {preview.version.model.thinking}
        </dd>
        <dt>Check environment</dt>
        <dd>
          Service launch environment policy, generation{" "}
          {preview.version.checkEnvGeneration}; no browser environment overlays.
        </dd>
        <dt>Observation</dt>
        <dd>
          {preview.version.observation.complete
            ? "Complete within bounded scope"
            : "Incomplete bounded coverage"}
        </dd>
        <dt>Expires</dt>
        <dd>{p.expiresAt}</dd>
      </dl>
      <ActionProposal preview={preview} />
      {preview.action.kind === "check" && (
        <section>
          <h3>Exact parent check</h3>
          <pre>{preview.action.check.command}</pre>
          <p>
            {preview.action.check.name}; timeout{" "}
            {preview.action.check.timeoutMs} ms; cwd above.
          </p>
        </section>
      )}
      {preview.action.kind === "generate-plan" && (
        <p>
          Readonly proposal only. It will not save itself or dispatch editing.
        </p>
      )}
      {preview.issues.length > 0 && (
        <p role="alert">Issues: {preview.issues.join(", ")}</p>
      )}
      {stale && (
        <p role="alert">
          Context changed or confirmation expired. Close, observe again and
          request a new preview.
        </p>
      )}
      <footer>
        <button type="button" onClick={onClose}>
          Back — no new effect
        </button>
        <button
          type="button"
          className="primary"
          disabled={stale || sending || prepared.submitted}
          onClick={() => void submit()}
        >
          Confirm {preview.action.kind}
        </button>
      </footer>
    </ActionDialog>
  );
}

/** Action payload, not the old saved plan, is the final confirmation source. */
export function ActionProposal({
  preview,
}: {
  preview: PreparedAction["preflight"]["preview"];
}) {
  const action = preview.action;
  const graph = action.kind === "save-plan" ? action.graph : preview.graph;
  return (
    <>
      {action.kind === "create" && (
        <section>
          <h3>Create {action.taskKind} task</h3>
          <pre>{action.goal}</pre>
          <p>No Start is included.</p>
        </section>
      )}
      {action.kind !== "create" && (
        <Markdown
          text={
            action.kind === "save-plan" ? action.plan : preview.readablePlan
          }
        />
      )}
      {graph?.assignments.map((a) => (
        <section key={a.id}>
          <h3>
            {a.id} · {a.purpose}
          </h3>
          <p>
            {a.role.role} / {a.role.sha256}
          </p>
          <pre>{JSON.stringify(a.model, null, 2)}</pre>
          <Markdown text={a.instructions} />
          <p>Expected: {a.expectedOutput}</p>
          <pre>{JSON.stringify(a.dependencies, null, 2)}</pre>
        </section>
      ))}
      {action.kind === "save-plan" && (
        <>
          <h3>Exact proposed graph and identities (not yet committed)</h3>
          <pre>{JSON.stringify(action.graph, null, 2)}</pre>
        </>
      )}
      {action.kind === "review" && (
        <section>
          <h3>Exact human review targets</h3>
          <pre>{JSON.stringify(action, null, 2)}</pre>
          <p>
            Human review only; failures, native exit, stale and not-run checks
            remain unchanged. Issues acknowledgment:{" "}
            {String(action.acceptIssues)}.
          </p>
        </section>
      )}
    </>
  );
}
