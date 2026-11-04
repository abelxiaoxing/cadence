/** Explicit directory selection and Send preparation. Neither route sends a
 * conversation message or acquires execution consent. No automatic retry. */
import {
  decodeProjectEntry,
  decodeWorkbenchEntry,
  type ProjectEntry,
} from "../../../src/service/contracts/gateway.ts";
import type { ConversationLocation } from "../../../src/service/contracts/models.ts";
import { localBuild } from "./build-identity";
import type { PreparationProgress } from "./conversation-send";
import { errorCode, readJson } from "./service";

async function entry(signal?: AbortSignal) {
  const response = await fetch("/workbench/v1", {
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  const value = await readJson(response);
  if (!response.ok) throw new Error(errorCode(value));
  return decodeWorkbenchEntry(value);
}
async function command(
  path: string,
  value: object,
  current: Awaited<ReturnType<typeof entry>>,
  signal?: AbortSignal,
  dispatched?: () => void,
) {
  if (!localBuild) throw new Error("unsupported-context");
  const init: RequestInit = {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-Cadence-CSRF": current.csrf,
      "X-Cadence-Build": JSON.stringify({ kind: "browser", ...localBuild }),
    },
    body: JSON.stringify({ ...value, epoch: current.epoch }),
  };
  if (signal?.aborted) throw signal.reason;
  const pending = fetch(path, init);
  // Handed to fetch, not proof that the service received this POST.
  dispatched?.();
  const response = await pending;
  const reply = await readJson(response);
  if (
    !response.ok ||
    !reply ||
    typeof reply !== "object" ||
    !("kind" in reply) ||
    reply.kind !== "project" ||
    !("project" in reply)
  )
    throw new Error(errorCode(reply));
  const project = decodeProjectEntry(reply.project);
  return {
    project,
    entry: {
      ...current,
      projects: [
        ...current.projects.filter((p) => p.id !== project.id),
        project,
      ],
    },
  };
}
export async function selectDirectory(path: string) {
  const current = await entry();
  return command("/workbench/v1/select", { path }, current);
}
/** Re-read the gateway epoch/CSRF after a restart, but never substitute another
 * directory. This is preparation for the current Send, not replay of a Send. */
export async function prepareDirectorySend(
  selected: ProjectEntry,
  signal: AbortSignal,
  location?: ConversationLocation,
  progress?: PreparationProgress,
) {
  const current = await entry(signal);
  const kept = current.projects.find((p) => p.id === selected.id);
  if (!kept || kept.path !== selected.path || kept.cwd !== selected.cwd)
    throw new Error("stale");
  const result = await command(
    "/workbench/v1/prepare-send",
    {
      projectId: selected.id,
      commandId: crypto.randomUUID(),
      ...(location ? { location } : {}),
    },
    current,
    signal,
    () => progress?.("dispatched"),
  );
  if (
    !result.project.epoch ||
    result.project.id !== selected.id ||
    result.project.path !== selected.path ||
    result.project.cwd !== selected.cwd
  )
    throw new Error("stale");
  // Confirmation precedes attachment waiting; a later timeout cannot undo it.
  progress?.("confirmed");
  return result;
}
