import {
  decodeEntryId,
  decodeSessionId,
} from "../../../src/service/contracts/workbench.ts";
import { localBuild } from "./build-identity";

const BUILD_HASH = /^[a-f0-9]{64}$/;
export const BUILD_RELOAD_MARKER = "cadence:build-reload";

export function isBuildId(value: unknown): value is string {
  return typeof value === "string" && BUILD_HASH.test(value);
}

/** Build a cache-busting `/app` URL carrying `v=<buildId>` while preserving
 * only the validated `project` query parameter and current fragment. */
export function buildReloadUrl(
  buildId: string,
  loc: Pick<Location, "pathname" | "search" | "hash"> = window.location,
): string | null {
  if (!isBuildId(buildId) || loc.pathname !== "/app") return null;
  const params = new URLSearchParams();
  const project = new URLSearchParams(loc.search).get("project");
  if (project && BUILD_HASH.test(project)) params.set("project", project);
  params.set("v", buildId);
  return `/app?${params}${loc.hash}`;
}

/** Strip the one-shot `v` cache-bust parameter after landing on the page and
 * retire any completed reload guard for this loaded build. */
export function cleanBuildQuery(
  currentBuildId: string | null = localBuild?.buildId ?? null,
): void {
  if (typeof window === "undefined") return;
  try {
    if (currentBuildId) {
      const guard = sessionStorage.getItem(BUILD_RELOAD_MARKER);
      if (guard?.endsWith(`->${currentBuildId}`))
        sessionStorage.removeItem(BUILD_RELOAD_MARKER);
    }
  } catch {
    /* Storage is optional. */
  }
  if (location.pathname !== "/app") return;
  const params = new URLSearchParams(location.search);
  if (!params.has("v")) return;
  params.delete("v");
  const query = params.toString();
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
  );
}

/** Navigate once via a cache-busting URL when the live server reports a
 * different compiled browser build than the currently running bundle. */
export function reloadIfBuildChanged(
  serverBuildId: string | undefined,
  currentBuildId: string | null = localBuild?.buildId ?? null,
): boolean {
  if (
    typeof window === "undefined" ||
    !currentBuildId ||
    !isBuildId(serverBuildId)
  )
    return false;
  if (serverBuildId === currentBuildId) {
    try {
      const guard = sessionStorage.getItem(BUILD_RELOAD_MARKER);
      if (guard?.endsWith(`->${currentBuildId}`))
        sessionStorage.removeItem(BUILD_RELOAD_MARKER);
    } catch {
      /* Storage is optional. */
    }
    return false;
  }
  const target = buildReloadUrl(serverBuildId, location);
  if (!target) return false;
  const pair = `${currentBuildId}->${serverBuildId}`;
  try {
    if (sessionStorage.getItem(BUILD_RELOAD_MARKER) === pair) return false;
    sessionStorage.setItem(BUILD_RELOAD_MARKER, pair);
  } catch {
    // No safe loop guard (blocked storage) means no automatic navigation.
    return false;
  }
  location.replace(target);
  return true;
}

/** Explicitly navigate to a fresh build (used after service upgrade/restart),
 * probing `/app` with cache-bypass headers if the new buildId is not yet known. */
export async function reloadToLatestBuild(
  knownBuildId?: string,
): Promise<void> {
  let targetBuild = isBuildId(knownBuildId) ? knownBuildId : undefined;
  if (!targetBuild && location.pathname === "/app") {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5000);
    try {
      const response = await fetch(`${location.pathname}${location.search}`, {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        signal: abort.signal,
      });
      const header = response.headers.get("X-Cadence-Web-Build");
      if (response.ok && isBuildId(header)) targetBuild = header;
    } catch {
      /* Fall back to ordinary reload below. */
    } finally {
      clearTimeout(timer);
    }
  }
  const url = targetBuild ? buildReloadUrl(targetBuild, location) : null;
  if (url) location.replace(url);
  else location.reload();
}

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
