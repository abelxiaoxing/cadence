import { canonicalJson } from "../../../src/service/contracts/core.ts";
import type { ModelSelector } from "../../../src/service/contracts/domain.ts";
import type {
  ChoiceVersion,
  ConversationContext,
} from "../../../src/service/contracts/models.ts";
import type { CadenceConversation } from "../../../src/service/contracts/workbench.ts";
import type { WorkflowProposal } from "../../../src/service/contracts/workflow.ts";
import type { ServiceClient } from "../../../src/service-client.ts";
import {
  type PreparationProgress,
  type PrepareExecution,
  waitForPreparation,
} from "./conversation-send";

/** Availability is not plan validity. Both actions are explicit; validation
 * always ends before approval, including when only an owner identity changed. */
export function planAction(
  proposal: WorkflowProposal,
  ready: boolean,
  version?: ChoiceVersion,
  changed = false,
): "restore" | "validate" | "approve" {
  if (!ready) return "restore";
  return changed ||
    !version ||
    canonicalJson(version) !== canonicalJson(proposal.model)
    ? "validate"
    : "approve";
}

/** Captures the exact original intent before startup. Revalidation is a single
 * command, never Send/approval, and does not continue into execution. */
export async function revalidateWorkflow(o: {
  client: ServiceClient;
  state: CadenceConversation;
  context: ConversationContext;
  model: ModelSelector;
  head: string | null;
  signal: AbortSignal;
  current(): boolean;
  prepare?: PrepareExecution;
  progress?: PreparationProgress;
}) {
  const state = structuredClone(o.state);
  const proposal = state.proposal;
  const context = structuredClone(o.context);
  const location = { id: context.id, cwd: context.cwd };
  const model = structuredClone(o.model);
  const head = o.head;
  const commandId = crypto.randomUUID();
  const current = () => !o.signal.aborted && o.current();
  if (!proposal || !state.enabled || context.id !== state.id || !current())
    throw new Error("stale");
  if (o.prepare)
    await waitForPreparation(
      o.prepare,
      o.signal,
      location,
      o.progress ?? (() => {}),
    );
  if (!current()) throw new Error("stale");
  const catalog = await o.client.models(o.signal, location);
  if (!current()) throw new Error("stale");
  if (catalog.kind !== "ok") throw new Error(catalog.error.code);
  const reply = await o.client.workbenchCommand({
    kind: "cadence-revalidate",
    commandId,
    conversationId: state.id,
    revision: state.revision,
    proposalId: proposal.id,
    digest: proposal.digest,
    head,
    context,
    model,
    expected: catalog.value.version,
  });
  if (!current()) throw new Error("stale");
  if (reply.kind !== "ok") throw new Error(reply.error.code);
  if (
    reply.value.kind !== "cadence-revalidated" ||
    reply.value.state.id !== state.id ||
    reply.value.state.revision !== state.revision + 1 ||
    !reply.value.state.enabled ||
    reply.value.state.head !== state.head ||
    canonicalJson(reply.value.state.runs) !== canonicalJson(state.runs) ||
    reply.value.state.proposal?.id !== commandId ||
    reply.value.state.proposal.revalidatedFrom !== proposal.id ||
    reply.value.state.proposal.epoch !== catalog.value.version.epoch ||
    reply.value.state.proposal.cwd !== context.cwd ||
    canonicalJson(reply.value.state.proposal.model.conversation ?? null) !==
      canonicalJson(location) ||
    canonicalJson(reply.value.state.proposal.plan) !==
      canonicalJson(proposal.plan)
  )
    throw new Error("stale");
  return reply.value.state;
}

/** One human action, bound to the plan actually displayed. Never called by an effect/reconnect. */
export async function approveWorkflow(o: {
  client: ServiceClient;
  state: CadenceConversation;
  current(): boolean;
  submitting(id: string): void;
}) {
  const p = o.state.proposal;
  if (!p || !o.state.enabled || !o.current()) throw new Error("stale");
  const base = {
    conversationId: o.state.id,
    revision: o.state.revision,
    proposalId: p.id,
    digest: p.digest,
  };
  const prepared = await o.client.workbenchCommand({
    kind: "cadence-prepare",
    commandId: crypto.randomUUID(),
    ...base,
  });
  if (prepared.kind !== "ok") throw new Error(prepared.error.code);
  if (
    prepared.value.kind !== "cadence-grant" ||
    !o.current() ||
    prepared.value.revision !== o.state.revision ||
    canonicalJson(prepared.value.proposal) !== canonicalJson(p) ||
    Date.now() >= prepared.value.expiresAt
  )
    throw new Error("stale");
  const commandId = crypto.randomUUID();
  o.submitting(commandId); // Persist attempted identity before the uncertain request.
  return o.client.workbenchCommand({
    kind: "cadence-approve",
    commandId,
    ...base,
    grant: prepared.value.grant,
  });
}
export function cadenceExit(text: string) {
  return /^(?:退出\s*cadence|关闭\s*cadence(?:模式)?|exit cadence)$/iu.test(
    text.trim(),
  );
}
export function cadenceApproval(text: string) {
  return /^(?:按(?:这个|本)?计划(?:开始)?(?:执行|实施)|确认(?:计划并)?(?:执行|实施)|approve and execute)[。.!！]?$/iu.test(
    text.trim(),
  );
}
