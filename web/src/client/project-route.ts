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
// A native password form cannot see a fragment. Preserve only validated chat /
// branch IDs on explicit sign-in, once in this tab and for the exact entry.
const loginReturn = "cadence:login-return";
function loginChatHash(hash: string) {
  const { chat } = projectRoute("", hash);
  if (!chat) return null;
  const { leaf, selected } = activityRoute(hash, chat);
  return branchHash(`#chat=${chat}${selected ? "&activity=1" : ""}`, leaf);
}
export function rememberLoginReturn() {
  try {
    const hash = loginChatHash(location.hash);
    sessionStorage.removeItem(loginReturn);
    if (
      hash &&
      location.pathname === "/app" &&
      (!location.search || /^\?project=[a-f0-9]{64}$/.test(location.search))
    )
      sessionStorage.setItem(
        loginReturn,
        JSON.stringify([location.search, hash]),
      );
  } catch {
    /* Sign-in still works without browser storage. */
  }
}
export function restoreLoginReturn() {
  try {
    const saved = sessionStorage.getItem(loginReturn);
    if (!saved) return;
    sessionStorage.removeItem(loginReturn);
    const [search, hash] = JSON.parse(saved);
    if (
      location.hash ||
      location.pathname !== "/app" ||
      search !== location.search ||
      typeof hash !== "string"
    )
      return;
    const target = loginChatHash(hash);
    if (target) history.replaceState(history.state, "", target);
  } catch {
    /* A missing or invalid return must not prevent entry. */
  }
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

/** A chat hash naming the branch shown, or no longer naming one. Only the leaf
 * changes: the conversation and an activity mark stay as they are. */
export function branchHash(hash: string, leaf: string | null): string {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (leaf === null) params.delete("leaf");
  else params.set("leaf", decodeEntryId(leaf));
  return `#${params}`;
}
/** Keeps the branch shown in the address, so a refresh shows it again. The
 * entry is replaced, which is no navigation: nothing is re-read or sent. */
export function rememberBranch(conversation: string, leaf: string | null) {
  if (typeof window === "undefined" || chatFromLocation() !== conversation)
    return;
  const hash = branchHash(window.location.hash, leaf);
  if (hash !== window.location.hash)
    history.replaceState(
      history.state,
      "",
      `${location.pathname}${location.search}${hash}`,
    );
}
