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
 * keeps the research skills' syntax. Management-only and SDK-free.
 *
 * It is the user's own file, created by hand, by older Cadence docs or by a
 * dotfiles manager, so it is treated like Pi's sources: links in its path and
 * the file itself are followed, its mode bits are not a premise (0644, or
 * 0664 under umask 002), and only ownership is. A file Cadence rewrites is
 * written 0600. Every refusal names its reason, never a byte of the file. */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseEnvFile } from "../../skills/_shared/load-config.mjs";
import { ensureUserConfig } from "../install-config.mjs";
import { ContractError, utf8Bytes } from "../service-contract.ts";
import { text } from "./contracts/core.ts";
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
export function serverConfigPath(home: string, name?: string): string {
  if (name !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(name))
    throw new ContractError("invalid");
  return name === undefined
    ? join(home, ".pi", "agent", "cadence", ".env")
    : join(home, ".pi", "agent", "cadence", "servers", `${name}.env`);
}
/** A refused file and why, in words that carry none of its bytes. */
export class ServerConfigRefusal extends ContractError {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super("corrupt-selected");
  }
}
/** Internal: a reason that the caller attaches to the user's path. */
class Unusable extends Error {}
const unusable = (reason: string): never => {
  throw new Unusable(reason);
};
interface Setting {
  /** Index into the separator-keeping split of the file text. */
  at: number;
  line: number;
  value: string;
}
/** The research loader's own refusals, by line. */
function syntax(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const line = /at line (\d+)$/.exec(message)?.[1];
  if (!line) return "is not in KEY=value lines";
  if (message.startsWith("Invalid configuration name"))
    return `has an invalid name on line ${line} (letters, digits and _ only, no "export")`;
  if (message.startsWith("Unterminated"))
    return `has an unterminated quote on line ${line}`;
  return `has no KEY=value setting on line ${line}`;
}
/** The whole file in the research loader's syntax, with each Cadence key at
 * most once so that one exact line can be rewritten. */
function settings(source: string): {
  parts: string[];
  port?: Setting;
  token?: Setting;
} {
  try {
    parseEnvFile(source);
  } catch (error) {
    unusable(`${syntax(error)}, which the research skills refuse too`);
  }
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
    const previous = found[name];
    if (previous)
      unusable(
        `sets ${key} twice (lines ${previous.line} and ${at / 2 + 1}); keep one`,
      );
    // The same values the research loader reads: trimmed, one quote pair off.
    let value = line.slice(separator + 1).trim();
    if (value[0] === '"' || value[0] === "'") value = value.slice(1, -1);
    found[name] = { at, line: at / 2 + 1, value };
  }
  return { parts, ...found };
}
function decode(source: string): ServerConfig {
  const { port, token } = settings(source);
  if (!port) unusable(`has no ${PORT_KEY} line`);
  if (!token) unusable(`has no ${TOKEN_KEY} line`);
  const p = port as Setting,
    t = token as Setting;
  const number = Number(p.value);
  if (!/^[1-9][0-9]{0,4}$/.test(p.value) || number > 65535)
    unusable(
      `has ${PORT_KEY} on line ${p.line} that is not a whole number from 1 to 65535`,
    );
  try {
    return { port: number, token: accessToken(t.value) };
  } catch {
    return unusable(
      `has ${TOKEN_KEY} on line ${t.line} shorter than 32 characters or with control characters`,
    );
  }
}
const code = (error: unknown) =>
  (error as NodeJS.ErrnoException | undefined)?.code ?? "error";
/** Like Pi's sources: every link in the path, the file included, resolves to
 * the real file, whose directory is read without a mode premise. */
function locate(path: string): { real: string; files: PrivateFiles } {
  let real: string;
  try {
    real = realpathSync(path);
  } catch (error) {
    if (code(error) !== "ENOENT") unusable(`cannot be read (${code(error)})`);
    let link = false;
    try {
      link = lstatSync(path).isSymbolicLink();
    } catch {
      /* absent */
    }
    return unusable(
      link ? "is a link to a file that does not exist" : "does not exist",
    );
  }
  return { real, files: new PrivateFiles(dirname(real), false) };
}
/** Why the private reader refused an existing file; only for the message. */
function explain(real: string): string {
  const uid = process.getuid?.();
  try {
    const st = lstatSync(real);
    if (!st.isFile()) return "is not a regular file";
    if (uid !== undefined && st.uid !== uid) return "is not owned by you";
    if (uid !== undefined && lstatSync(dirname(real)).uid !== uid)
      return `is in ${dirname(real)}, which is not owned by you`;
    if (st.nlink !== 1) return "has more than one hard link";
    if (st.size > CONFIG_BYTES) return "is larger than 64 KiB";
    return "changed while Cadence read it; try again";
  } catch (error) {
    return `cannot be read (${code(error)})`;
  }
}
export interface ServerConfigFile {
  /** The path as named, for messages and the selected token source. */
  path: string;
  /** The resolved file that is read and rewritten; a link stays a link. */
  real: string;
  files: PrivateFiles;
  snapshot: FileSnapshot;
}
function load(path: string): ServerConfigFile & { source: string } {
  const { real, files } = locate(path);
  let snapshot: FileSnapshot | undefined;
  try {
    snapshot = files.read(real, CONFIG_BYTES);
  } catch {
    return unusable(explain(real));
  }
  if (!snapshot) return unusable("does not exist");
  let source: string;
  try {
    source = decoded(snapshot);
  } catch {
    return unusable("is not UTF-8 text");
  }
  return { path, real, files, snapshot, source };
}
function decoded(snapshot: FileSnapshot): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes);
}
function refusing<T>(path: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof ServerConfigRefusal) throw error;
    throw new ServerConfigRefusal(
      path,
      error instanceof Unusable
        ? error.message
        : `cannot be read (${code(error)})`,
    );
  }
}
export function readServerConfig(
  path: string,
): ServerConfigFile & { config: ServerConfig } {
  return refusing(path, () => {
    const file = load(path);
    return { ...file, config: decode(file.source) };
  });
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
 * appends only the absent keys; existing lines are never changed. `exposed`:
 * other users can read the file, which keeps working but deserves a note. */
export function ensureServerConfig(
  home: string,
  options: { name?: string; port?: number } = {},
): ServerConfigFile & {
  config: ServerConfig;
  added: string[];
  exposed: boolean;
} {
  const path = serverConfigPath(home, options.name);
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535)
  )
    throw new ContractError("invalid");
  const added = refusing(path, () => {
    try {
      if (options.name === undefined) ensureUserConfig(home);
      else if (!existsSync(path)) {
        // Named services get independent access material, never a copy of the
        // default service's token or research/provider configuration.
        if (options.port === undefined)
          unusable("needs --port for a new named service");
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        const directory = realpathSync(dirname(path));
        new PrivateFiles(directory, false).create(
          join(directory, `${options.name}.env`),
          "",
        );
      }
    } catch (error) {
      if (error instanceof Unusable) throw error;
      unusable(`could not be created (${code(error)})`);
    }
    const file = load(path);
    const found = settings(file.source);
    const lines: string[] = [];
    if (
      found.port &&
      options.port !== undefined &&
      found.port.value !== String(options.port)
    )
      unusable(
        `already selects another ${PORT_KEY}; edit that line explicitly, then restart`,
      );
    if (!found.port) lines.push(`${PORT_KEY}=${options.port ?? DEFAULT_PORT}`);
    if (!found.token)
      lines.push(`${TOKEN_KEY}=${randomBytes(32).toString("base64url")}`);
    if (lines.length) {
      // The file's own line ending, after a blank line.
      const { source } = file;
      const eol = source.includes("\r\n") ? "\r\n" : "\n";
      const ending = !source || /[\r\n]$/.test(source) ? "" : eol;
      const gap = source ? eol : "";
      try {
        file.files.replace(
          file.real,
          file.snapshot,
          `${source}${ending}${gap}${[...HEADER, ...lines].join(eol)}${eol}`,
          CONFIG_BYTES,
        );
      } catch (error) {
        unusable(`could not be updated (${code(error)})`);
      }
    }
    return lines.map((line) => line.slice(0, line.indexOf("=")));
  });
  const file = readServerConfig(path);
  const exposed =
    process.platform !== "win32" && (statSync(file.real).mode & 0o077) !== 0;
  return { ...file, added, exposed };
}
