/** The last selected project, remembered only in this browser like the locale.
 * It holds the opaque owner key, never a path or token. Restoring it navigates
 * to retained conversations, even when execution is stopped; it is never an Open and never starts one. */
import type {
  ProjectEntry,
  WorkbenchEntry,
} from "../../../src/service/contracts/gateway.ts";
import { decodeProjectObservation } from "../../../src/service/contracts/gateway.ts";
import { readJson } from "./service";

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
/** Observe existing history identity without allocating an execution attachment
 * or a history scan. Restoring navigation never starts the execution owner. */
export async function projectReadable(
  id: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch(`/workbench/v1/projects/${id}`, {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
    });
    if (!response.ok) return false;
    const value = decodeProjectObservation(await readJson(response));
    return (
      (value.workspaceId !== null || value.status === "not-started") &&
      !signal.aborted
    );
  } catch {
    return false;
  }
}
