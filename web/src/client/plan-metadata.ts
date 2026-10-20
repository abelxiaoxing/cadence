import { proposePlan } from "../../../src/plan-proposal.ts";
import {
  ContractError,
  canonicalJson,
  publicError,
} from "../../../src/service-contract.ts";
import type {
  Action,
  Assignment,
  CaptureCoverage,
  ContextVersion,
  CurrentView,
  Graph,
  GraphReadRequest,
  Reply,
  RoleSelection,
  ServiceClient,
} from "../types";
/** Local editable draft, never committed membership or Start consent. */
export interface PlanDraft {
  readablePlan: string;
  assignments: Assignment[];
}
export interface PlanMetadata {
  context: ContextVersion;
  roles: RoleSelection[];
  savedGraph: Graph | null;
  readablePlan: string;
  editable?: boolean;
}
export type PlanMetadataRead =
  | PlanMetadata
  | {
      kind: "progress";
      context: ContextVersion;
      next: GraphReadRequest;
      coverage: CaptureCoverage;
    };
export interface PlanMetadataPort {
  read(
    context: ContextVersion,
    next?: GraphReadRequest,
  ): Promise<Reply<PlanMetadataRead>>;
  saveAction(
    context: ContextVersion,
    draft: PlanDraft,
  ): Promise<Reply<Extract<Action, { kind: "save-plan" }>>>;
}
export const PLAN_METADATA_UNAVAILABLE =
  "Current plan metadata unavailable. Observe again; historical text is not action authority.";
export function planMetadataClient(
  client: ServiceClient,
  storeId: string,
): PlanMetadataPort {
  const current = async (context: ContextVersion): Promise<CurrentView> => {
    const reply = await client.current({
      storeId,
      taskId: context.task?.id ?? null,
    });
    if (reply.kind === "error") throw new ContractError(reply.error.code);
    if (
      reply.value.context.status !== "available" ||
      canonicalJson(reply.value.context.version) !== canonicalJson(context)
    )
      throw new ContractError("stale");
    return reply.value;
  };
  const failure = (error: unknown) => ({
    kind: "error" as const,
    error: publicError(
      error instanceof ContractError ? error.code : "unavailable",
    ),
  });
  return {
    async read(context, next) {
      try {
        const view = await current(context);
        if (!view.readablePlan || view.savedGraph.status === "unavailable")
          throw new ContractError("unavailable");
        let savedGraph: Graph | null = null;
        if (view.savedGraph.status === "saved") {
          const seed = view.savedGraph.request;
          if (
            next &&
            (next.storeId !== seed.storeId ||
              canonicalJson(next.graph) !== canonicalJson(seed.graph) ||
              canonicalJson(next.scope) !== canonicalJson(seed.scope))
          )
            throw new ContractError("stale");
          const reply = await client.graph(next ?? seed);
          if (reply.kind === "error") return reply;
          await current(context); // Graph/proof await cannot silently retarget the draft.
          if ("kind" in reply.value)
            return { kind: "ok", value: { ...reply.value, context } };
          savedGraph = reply.value.graph;
        } else if (next) throw new ContractError("stale");
        return {
          kind: "ok",
          value: {
            context,
            roles: view.roles,
            savedGraph,
            readablePlan: view.readablePlan.text,
            editable: view.readablePlan.editable,
          },
        };
      } catch (error) {
        return failure(error);
      }
    },
    async saveAction(context, draft) {
      const frozen = structuredClone(draft);
      try {
        const view = await current(context);
        const action = await proposePlan(
          view,
          frozen.readablePlan,
          frozen.assignments,
          {
            uuid: () => crypto.randomUUID(),
            sha256: async (bytes) =>
              Array.from(
                new Uint8Array(
                  await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
                ),
                (b) => b.toString(16).padStart(2, "0"),
              ).join(""),
          },
        );
        await current(context); // Digest is asynchronous; require the exact displayed version again.
        return { kind: "ok", value: action };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
