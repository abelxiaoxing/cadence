/** Portable local proposal only. UUID/hash are prospective, not stored membership. */

import { text } from "./service/contracts/core.ts";
import {
  type Action,
  type Assignment,
  ContractError,
  type CurrentView,
  canonicalJson,
  decodeAction,
  decodeCurrentView,
  roleForPurpose,
  utf8Bytes,
} from "./service-contract.ts";

export interface ProposalCrypto {
  uuid(): string;
  sha256(bytes: Uint8Array): string | Promise<string>;
}
export async function proposePlan(
  input: CurrentView,
  readablePlan: string,
  assignments: readonly Assignment[],
  crypto: ProposalCrypto,
): Promise<Extract<Action, { kind: "save-plan" }>> {
  // Decode/copy BEFORE the digest await. Caller mutation cannot retarget a draft.
  const current = decodeCurrentView(input);
  if (
    current.context.status !== "available" ||
    !current.context.version.task ||
    !current.readablePlan?.editable ||
    current.savedGraph.status === "unavailable"
  )
    throw new ContractError("unavailable");
  const context = current.context.version;
  const task = context.task;
  if (!task) throw new ContractError("stale");
  const plan = text(readablePlan, 32768);
  // The shared action/graph decoder checks every role/capability/dependency/UTF8
  // and aggregate bound before invoking asynchronous caller-supplied crypto.
  const action = decodeAction({
    kind: "save-plan",
    taskId: task.id,
    plan,
    graph: {
      schema: "cadence-graph/2",
      taskId: task.id,
      taskKind: task.kind,
      taskRevision: task.revision + 1,
      revision: (task.graphRevision ?? 0) + 1,
      planRevision:
        current.savedGraph.status === "saved"
          ? current.savedGraph.planRevision + 1
          : 1,
      plan: {
        recordId: crypto.uuid(),
        version:
          current.savedGraph.status === "saved"
            ? current.savedGraph.planRevision + 1
            : 1,
        field: "plan",
        bytes: utf8Bytes(plan),
        // Structural placeholder only, replaced by the exact digest below.
        sha256: "0".repeat(64),
      },
      assignments,
    },
  });
  if (action.kind !== "save-plan") throw new ContractError("invalid");
  for (const assignment of action.graph.assignments) {
    const role = current.roles.find(
      (r) => r.role === roleForPurpose(assignment.purpose),
    );
    if (
      !role ||
      canonicalJson(role) !== canonicalJson(assignment.role) ||
      canonicalJson(context.model) !== canonicalJson(assignment.model)
    )
      throw new ContractError("stale");
  }
  action.graph.plan.sha256 = await crypto.sha256(
    new TextEncoder().encode(plan),
  );
  const proposal = decodeAction(action);
  if (proposal.kind !== "save-plan") throw new ContractError("invalid");
  return proposal;
}
