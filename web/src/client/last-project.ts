/** The last selected project, remembered only in this browser like the locale.
 * It holds the opaque owner key, never a path or token. Restoring it navigates
 * to an owner that is already running; it is never an Open and never starts one. */
import type {
  ProjectEntry,
  WorkbenchEntry,
} from "../../../src/service/contracts/gateway.ts";
import { browserClient } from "./browser";

export const LAST_PROJECT_STORAGE_KEY = "cadence-last-project";

export function rememberedProject(): string | null {
  try {
    const id = localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
    return id && /^[a-f0-9]{64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export function rememberProject(id: string): void {
  try {
    if (localStorage.getItem(LAST_PROJECT_STORAGE_KEY) !== id)
      localStorage.setItem(LAST_PROJECT_STORAGE_KEY, id);
  } catch {}
}
/** Only a project this workbench still associates is a candidate. */
export function restorableProject(
  entry: WorkbenchEntry,
): ProjectEntry | undefined {
  const id = rememberedProject();
  return id ? entry.projects.find((p) => p.id === id) : undefined;
}
/** A readonly conversation listing through the gateway. It succeeds only while
 * the owner runs in its associated epoch; a stopped owner stays stopped. */
export async function projectRunning(
  id: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const reply = await browserClient(id).client.workbenchRead(
      { kind: "conversations" },
      signal,
    );
    return reply.kind === "ok" && !signal.aborted;
  } catch {
    return false;
  }
}
