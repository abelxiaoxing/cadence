import {
  decodeEntryId,
  decodeSessionId,
} from "../../../src/service/contracts/workbench.ts";

/** Complete links name server-owned identities, never a draft, path or token.
 * Pure parsing does not consult either browser storage or the recent project. */
export function projectRoute(search: string, hash: string) {
  const project = new URLSearchParams(search).get("project");
  const chat = new URLSearchParams(hash.replace(/^#/, "")).get("chat");
  let conversation: string | null = null;
  try {
    conversation = chat ? decodeSessionId(chat) : null;
  } catch {
    // Invalid links retain the existing controlled empty-selection behavior.
  }
  return {
    project: project && /^[a-f0-9]{64}$/.test(project) ? project : null,
    chat: conversation,
  };
}
export function currentProject(
  search = typeof window === "undefined" ? "" : window.location.search,
): string | null {
  return projectRoute(search, "").project;
}
export function chatFromLocation(
  hash = typeof window === "undefined" ? "" : window.location.hash,
): string | null {
  return projectRoute("", hash).chat;
}
export function projectPrefix(): string {
  const id = currentProject();
  return id ? `/projects/${id}` : "";
}

/** Activity navigation names an existing Pi branch, never a transcript path. */
export function activityRoute(
  hash = typeof window === "undefined" ? "" : window.location.hash,
  sessionId?: string,
): { selected: boolean; leaf: string | null } {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (sessionId !== undefined && projectRoute("", hash).chat !== sessionId)
    return { selected: false, leaf: null };
  try {
    return {
      selected: params.get("activity") === "1",
      leaf: params.has("leaf") ? decodeEntryId(params.get("leaf")) : null,
    };
  } catch {
    return { selected: false, leaf: null };
  }
}
