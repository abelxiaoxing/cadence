import { ContractError } from "./contracts/core.ts";

/** Server-only proof: this conversation command (a Send, exit or browser plan
 * prepare/approval) or native workflow command (propose, prepare, research or
 * execute on the native route) has no prior attempt and failed, on a healthy
 * owner, before registration, admission or any control, acceptance, proposal or
 * approval-evidence write. Never inferred from an error code, a missing
 * response, or client-supplied fields. */
export class UnacceptedConversationCommand extends ContractError {}
