/** Local pre-folder input, never a Send or a session. Only explicit directory
 * selection may hand it to a fresh conversation; restoration/activity links do not. */
import {
  decodeModelSelector,
  type ModelSelector,
} from "../../../src/service-contract.ts";
import { draftKey } from "./conversation-send";

export interface FolderDraft {
  text: string;
  model: ModelSelector | null;
}
export const FOLDER_DRAFT_KEY = "cadence:folder-draft";
export const emptyFolderDraft = (): FolderDraft => ({ text: "", model: null });

export function readFolderDraft(): FolderDraft {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(FOLDER_DRAFT_KEY) ?? "null",
    );
    if (!value || typeof value.text !== "string") return emptyFolderDraft();
    let model: ModelSelector | null = null;
    try {
      if (value.model != null) model = decodeModelSelector(value.model);
    } catch {
      // An unreadable model choice must not discard readable message text.
    }
    return { text: value.text, model };
  } catch {
    return emptyFolderDraft();
  }
}
export function rememberFolderDraft(draft: FolderDraft): void {
  try {
    if (draft.text || draft.model)
      sessionStorage.setItem(FOLDER_DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(FOLDER_DRAFT_KEY);
  } catch {
    // Browser storage is optional; the mounted entry retains its input.
  }
}

/** Called with a newly generated conversation ID after a successful selection.
 * Persist before navigation, including while readonly history is still loading.
 * Failed/blocked storage keeps the source draft; the target also receives it in memory. */
export function bindFolderDraft(
  root: string,
  id: string,
  draft: FolderDraft,
): FolderDraft & { conversationId: string } {
  const key = draftKey(`checkout:${root}`, id);
  try {
    sessionStorage.setItem(key, draft.text);
    if (draft.model)
      sessionStorage.setItem(`${key}:model`, JSON.stringify(draft.model));
    sessionStorage.removeItem(FOLDER_DRAFT_KEY);
  } catch {
    // The in-memory handoff remains usable without storage.
  }
  return { ...draft, conversationId: id };
}
