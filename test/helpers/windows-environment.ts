import { vi } from "vitest";

/** Windows system variables a child process needs: CNG crypto and Winsock need
 * SystemRoot, CMD needs COMSPEC/PATHEXT, and the Pi SDK finds Git Bash under
 * ProgramFiles. System paths, not credentials; absent elsewhere. */
export const WINDOWS_SYSTEM_KEYS = [
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "SystemDrive",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
] as const;

export function windowsSystemEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of WINDOWS_SYSTEM_KEYS)
    if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

/** Remove every process variable outside `allowed` (plus the Windows system
 * set). Windows names are case-insensitive: process.env reports `Path`,
 * `ComSpec` and `windir`, which an exact-case set would wrongly delete. */
export function keepOnlyEnvironment(allowed: Iterable<string>): void {
  const fold = (key: string) =>
    process.platform === "win32" ? key.toUpperCase() : key;
  const keep = new Set([...allowed, ...WINDOWS_SYSTEM_KEYS].map(fold));
  for (const key of Object.keys(process.env))
    if (!keep.has(fold(key))) vi.stubEnv(key, undefined);
}
