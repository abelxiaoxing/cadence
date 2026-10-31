import { canonicalJson } from "../../../src/service/contracts/core.ts";
import type { CadenceConversation } from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";

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
