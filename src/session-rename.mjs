// Fixed-purpose child of the owner: records one name in one existing Pi session
// through Pi's own SessionManager, as the terminal's /name does, then exits.
// No model, credentials, tools, extensions or network. The owner launches it
// under its lease and confirms the name by reading the session back.
import { closeSync, constants, openSync, readSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { terminateLastLine } from "./session-file.mjs";

const INPUT_BYTES = 16 * 1024;
/** Only the identity header is read here; Pi reads the rest. */
const HEADER_BYTES = 64 * 1024;
/** Pi's session format this child appends to, as the owner's reader requires. */
const SESSION_VERSION = 3;

class Refusal extends Error {}
const refuse = (reason) => {
  throw new Refusal(reason);
};
/** The identity line of an existing session file. Pi would start a new session
 * in an empty file and rewrite an older format, so neither is ever opened. */
const header = (file) => {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, read).indexOf(10);
    return end < 0
      ? undefined
      : JSON.parse(buffer.subarray(0, end).toString("utf8"));
  } finally {
    closeSync(fd);
  }
};
try {
  if (
    process.env.CADENCE_SUBAGENT_CHILD !== "1" ||
    process.env.PI_OFFLINE !== "1"
  )
    refuse("guards-required");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > INPUT_BYTES) refuse("input-bound");
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    refuse("input");
  }
  const keys = ["id", "dir", "file", "cwd", "name"];
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    keys.some((key) => typeof input[key] !== "string") ||
    !input.id ||
    !input.dir ||
    !input.file ||
    !input.cwd
  )
    refuse("input");
  const { id, dir, file, cwd, name } = input;
  let identity;
  try {
    identity = header(file);
  } catch {
    refuse("session-unreadable");
  }
  if (
    !identity ||
    typeof identity !== "object" ||
    identity.type !== "session" ||
    identity.id !== id ||
    typeof identity.version !== "number" ||
    identity.version < SESSION_VERSION
  )
    refuse("session-mismatch");
  terminateLastLine(file);
  const manager = SessionManager.open(file, dir, cwd);
  if (manager.getSessionId() !== id) refuse("session-mismatch");
  manager.appendSessionInfo(name);
} catch (error) {
  // A fixed word only: never a path, the name or an exception's text.
  process.exitCode = 1;
  process.stderr.write(
    `session-rename: ${error instanceof Refusal ? error.message : "failed"}\n`,
  );
}
