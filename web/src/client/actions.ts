import type {
  Action,
  Command,
  ContextVersion,
  Preflight,
  Receipt,
  ReceiptLookup,
  Reply,
  ServiceClient,
} from "../types";
export interface PreparedAction {
  preflight: Preflight;
  commandId: string;
  submitted: boolean;
}
/** The caller explicitly invokes this only after reviewing the currently displayed context. */
export async function prepare(
  client: ServiceClient,
  context: ContextVersion,
  action: Action,
): Promise<Reply<PreparedAction>> {
  const reply = await client.preflight(context, action);
  return reply.kind === "error"
    ? reply
    : {
        kind: "ok",
        value: {
          preflight: reply.value,
          commandId: crypto.randomUUID(),
          submitted: false,
        },
      };
}
export function confirm(
  client: ServiceClient,
  prepared: PreparedAction,
): Promise<Reply<Receipt>> {
  if (prepared.submitted)
    throw new Error("Already submitted; observe the same receipt.");
  prepared.submitted = true; // before await; no resubmit on timeout/disconnect
  const p = prepared.preflight;
  const base: Omit<Command, "action"> = {
    commandId: prepared.commandId,
    expected: p.preview.version,
    grant: p.grant,
  };
  const action = p.preview.action;
  switch (action.kind) {
    case "create":
      return client.create({ ...base, action });
    case "save-plan":
      return client.savePlan({ ...base, action });
    case "generate-plan":
      return client.generatePlan({ ...base, action });
    case "start":
      return client.start({ ...base, action });
    case "check":
      return client.check({ ...base, action });
    case "review":
      return client.review({ ...base, action });
  }
}
export interface CommandObservation {
  commandId: string;
  receipt?: Receipt;
  lookup?: ReceiptLookup;
  error?: string;
}
