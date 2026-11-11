/** Custom Pi session entry types Cadence writes, shared by the Pi extension,
 * the SDK worker and the owner's session reader. */

/** Native Cadence mode state, appended by the terminal extension. */
export const CADENCE_MODE_ENTRY = "cadence-conversation-mode/1";
/** Marks a session the browser created; Pi ignores it in the model context. */
export const WEBUI_SESSION_ENTRY = "cadence-webui/1";

/** Browser command/user identity and finalized message boundary, not model
 * context: `{commandId, userId}`, with `run` naming the reply's own command
 * when the message was sent into a reply that was already running. */
export const BROWSER_COMMAND_ENTRY = "cadence-browser-command/1";
