import { ContractError } from "./contracts/core.ts";

/** Server-only proof: this conversation command has no prior attempt and failed
 * before registration or any control/acceptance write. Never inferred from an
 * error code, a missing response, or client-supplied fields. */
export class UnacceptedConversationCommand extends ContractError {}
