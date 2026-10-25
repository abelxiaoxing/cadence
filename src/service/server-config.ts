/** The background service's WebUI port and private access token, kept with
 * the research settings in `~/.pi/agent/cadence/.env`:
 *
 *   CADENCE_PORT=17423
 *   CADENCE_TOKEN=<at least 32 characters>
 *
 * `cadence server install` and `restart` create the file when missing and add
 * either key when missing (port 17423, a random token), never changing an
 * existing line. The service starts with `start --server-config <.env>`, which
 * makes both authoritative: edit them, then `cadence server restart`. The file
 * keeps the research skills' syntax. Management-only and SDK-free. */
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { parseEnvFile } from "../../skills/_shared/load-config.mjs";
import { ensureUserConfig } from "../install-config.mjs";
import { ContractError, utf8Bytes } from "../service-contract.ts";
import { integer, text } from "./contracts/core.ts";
import { type FileSnapshot, PrivateFiles } from "./private-files.ts";

export const DEFAULT_PORT = 17423;
export const PORT_KEY = "CADENCE_PORT";
export const TOKEN_KEY = "CADENCE_TOKEN";
/** The research loader's own ceiling. */
export const CONFIG_BYTES = 64 * 1024;
const HEADER = [
  "# Cadence WebUI for `cadence server install`: edit, then run `cadence server restart`.",
  "# The token admits anyone who has it to your workspace; keep it private.",
];
export const TOKEN_BYTES = 1024;
/** At least 32 UTF-8 bytes, without control or format characters. */
export function accessToken(value: unknown): string {
  const result = text(value, TOKEN_BYTES, true);
  if (utf8Bytes(result) < 32 || /[\p{Cc}\p{Cf}]/u.test(result))
    throw new ContractError("invalid");
  return result; // Never trim, normalize or interpolate secret bytes.
}
export interface ServerConfig {
  port: number;
  token: string;
}
export function serverConfigPath(home: string): string {
  return join(home, ".pi", "agent", "cadence", ".env");
}
interface Setting {
  /** Index into the separator-keeping split of the file text. */
  at: number;
  value: string;
}
/** The whole file in the research loader's syntax, with each Cadence key at
 * most once so that one exact line can be rewritten. */
function settings(source: string): {
  parts: string[];
  port?: Setting;
  token?: Setting;
} {
  parseEnvFile(source);
  const parts = source.split(/(\r\n|\r|\n)/);
  const found: { port?: Setting; token?: Setting } = {};
  for (let at = 0; at < parts.length; at += 2) {
    const line = parts[at].trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    const name =
      key === PORT_KEY ? "port" : key === TOKEN_KEY ? "token" : undefined;
    if (!name) continue;
    if (found[name]) throw new ContractError("invalid");
    // The same values the research loader reads: trimmed, one quote pair off.
    let value = line.slice(separator + 1).trim();
    if (value[0] === '"' || value[0] === "'") value = value.slice(1, -1);
    found[name] = { at, value };
  }
  return { parts, ...found };
}
export function decodeServerConfig(source: string): ServerConfig {
  const { port, token } = settings(source);
  if (!port || !/^[1-9][0-9]{0,4}$/.test(port.value))
    throw new ContractError("invalid");
  if (!token) throw new ContractError("invalid");
  return {
    port: integer(Number(port.value), 1, 65535),
    token: accessToken(token.value),
  };
}
/** A refused file: missing, not the user's own private regular file (0600 in
 * a 0700 directory on POSIX), unreadable to the research loader, or without
 * exactly one valid port and token. Never carries the file's bytes. */
export class ServerConfigRefusal extends ContractError {
  constructor(readonly path: string) {
    super("corrupt-selected");
  }
}
export interface ServerConfigFile {
  path: string;
  config: ServerConfig;
  files: PrivateFiles;
  snapshot: FileSnapshot;
}
function decoded(snapshot: FileSnapshot): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes);
}
export function readServerConfig(path: string): ServerConfigFile {
  try {
    const files = new PrivateFiles(dirname(path));
    const snapshot = files.read(path, CONFIG_BYTES);
    if (!snapshot) throw new ContractError("corrupt-selected");
    return {
      path,
      config: decodeServerConfig(decoded(snapshot)),
      files,
      snapshot,
    };
  } catch {
    throw new ServerConfigRefusal(path);
  }
}
/** The same file with only the token line's value replaced; every other byte,
 * line ending and the port (perhaps edited for the next start) stay. */
export function withToken(file: ServerConfigFile, token: string): string {
  const { parts, token: line } = settings(decoded(file.snapshot));
  if (!line) throw new ContractError("invalid");
  const indent = /^\s*/.exec(parts[line.at])?.[0] ?? "";
  parts[line.at] = `${indent}${TOKEN_KEY}=${accessToken(token)}`;
  return parts.join("");
}
/** Missing-only: creates the research template when the file is missing and
 * appends only the absent keys; existing lines are never changed. */
export function ensureServerConfig(
  home: string,
): ServerConfigFile & { added: string[] } {
  const path = serverConfigPath(home);
  const added: string[] = [];
  try {
    ensureUserConfig(home);
    const files = new PrivateFiles(dirname(path));
    const snapshot = files.read(path, CONFIG_BYTES);
    if (!snapshot) throw new ContractError("corrupt-selected");
    const source = decoded(snapshot);
    const found = settings(source);
    const lines: string[] = [];
    if (!found.port) lines.push(`${PORT_KEY}=${DEFAULT_PORT}`);
    if (!found.token)
      lines.push(`${TOKEN_KEY}=${randomBytes(32).toString("base64url")}`);
    if (lines.length) {
      // The file's own line ending, after a blank line.
      const eol = source.includes("\r\n") ? "\r\n" : "\n";
      const ending = !source || /[\r\n]$/.test(source) ? "" : eol;
      const gap = source ? eol : "";
      files.replace(
        path,
        snapshot,
        `${source}${ending}${gap}${[...HEADER, ...lines].join(eol)}${eol}`,
        CONFIG_BYTES,
      );
      added.push(...lines.map((line) => line.slice(0, line.indexOf("="))));
    }
  } catch {
    throw new ServerConfigRefusal(path);
  }
  return { ...readServerConfig(path), added };
}
