/* Adapted from pi-web-ui web/src/components/ChatInput.tsx @ b627452c: the
 * composer's auto-growing text area with a remembered manual height, prompt
 * recall on Up/Down and the `@` popup. MIT (c) 2026 xing-shuyin.
 * Cadence: the composer holds no message state of its own. The conversation
 * owns the draft, the images and Send; this component only edits the draft,
 * and nothing here sends except the Send control and Enter. The height handle
 * is a keyboard-operable range input, the `@` popup completes a path from the
 * bounded `files` listing one folder at a time, and recalled prompts end with
 * the tab. No slash commands, queue, plugin providers or server draft sync. */
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FiArrowUp, FiFile, FiFolder, FiImage, FiSquare } from "react-icons/fi";
import { IMAGE_TYPES } from "../../../../src/image-content.mjs";
import type { ConversationLocation } from "../../../../src/service/contracts/models.ts";
import type { FileEntry } from "../../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { useWorkbench } from "../../client/use-workbench";
import {
  applyMention,
  matchAtToken,
  mentionEntries,
  mentionQuery,
  mentionReadable,
} from "../../composer/at-mention";
import { caretVisualLineFlags } from "../../composer/caret-visual-line";
import {
  HISTORY_IDLE,
  loadPromptHistory,
  stepHistory,
} from "../../composer/prompt-history";
import { describeError, useT } from "../../i18n/locale";
import { ModelPicker } from "../actions/ModelPicker";
import { CadenceModeButton } from "./CadenceModeButton";
import { DraftImage } from "./ChatImages";

/** The text area's own height bounds, in CSS pixels. A manual height at the
 * lower bound means automatic again. */
export const COMPOSER_MIN_HEIGHT = 64;
export const COMPOSER_MAX_HEIGHT = 320;
export const COMPOSER_HEIGHT_KEY = "cadence:composer-height";
const STEP = 16;

/** A remembered manual height, or null for a text area that grows with its
 * text. A display preference: this browser only. */
export function readComposerHeight(saved: string | null): number | null {
  const value = Number(saved);
  return saved !== null &&
    Number.isFinite(value) &&
    value > COMPOSER_MIN_HEIGHT + 4
    ? Math.min(Math.round(value), COMPOSER_MAX_HEIGHT)
    : null;
}
/** Never more than about two fifths of a short window. */
export const composerHeightCap = (viewport: number): number =>
  viewport > 0
    ? Math.max(160, Math.min(COMPOSER_MAX_HEIGHT, Math.floor(viewport * 0.42)))
    : COMPOSER_MAX_HEIGHT;
const heightCap = () =>
  composerHeightCap(typeof window === "undefined" ? 0 : window.innerHeight);

export interface ChatComposerProps {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraft(text: string): void;
  /** A Send is in flight or unconfirmed: its text stays as it was sent. */
  locked: boolean;
  images: readonly File[];
  imageKey(file: File): string | undefined;
  imagesLocked: boolean;
  onAddImages(files: File[]): void;
  onRemoveImage(file: File): void;
  /** What the next message continues, when that is not simply the end of the
   * latest branch. */
  anchor?: ReactNode;
  /** Why Send is unavailable. */
  status?: string;
  cadence: Parameters<typeof CadenceModeButton>[0];
  model: Parameters<typeof ModelPicker>[0];
  hint: string;
  /** A reply is queued or running: Stop takes Send's place. */
  running: boolean;
  canStop: boolean;
  onStop(): void;
  canSend: boolean;
  onSend(): void;
  /** Prompts are recalled per checkout. */
  historyScope: string;
  /** The conversation folder's listing; readable once its context (the
   * location) is observed. */
  files: {
    client: Pick<ServiceClient, "workbenchRead">;
    location?: ConversationLocation;
  };
  /** The composer's height changed: the transcript may keep its end in view. */
  onResized?(): void;
}

export function ChatComposer({
  inputRef,
  draft,
  onDraft,
  locked,
  images,
  imageKey,
  imagesLocked,
  onAddImages,
  onRemoveImage,
  anchor,
  status,
  cadence,
  model,
  hint,
  running,
  canStop,
  onStop,
  canSend,
  onSend,
  historyScope,
  files,
  onResized,
}: ChatComposerProps) {
  const { t } = useT();
  const form = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const listId = useId();

  // ---- Height: grows with the text unless a manual height was set. ----
  const [manual, setManual] = useState<number | null>(() => {
    try {
      return readComposerHeight(localStorage.getItem(COMPOSER_HEIGHT_KEY));
    } catch {
      return null;
    }
  });
  const [height, setHeight] = useState(COMPOSER_MIN_HEIGHT);
  // The form's width (text wraps differently) and the window's height (cap).
  const [frame, setFrame] = useState("");
  useLayoutEffect(() => {
    void draft;
    void frame;
    const ta = inputRef.current;
    if (!ta) return;
    const cap = heightCap();
    ta.style.height = "auto";
    const natural = ta.scrollHeight;
    const next =
      manual !== null
        ? Math.min(manual, cap)
        : Math.min(Math.max(natural, COMPOSER_MIN_HEIGHT), cap);
    ta.style.height = `${next}px`;
    ta.style.overflowY = natural > next ? "auto" : "hidden";
    setHeight(next);
  }, [draft, manual, frame, inputRef]);
  const resized = useRef(onResized);
  resized.current = onResized;
  useEffect(() => {
    const el = form.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = el.offsetHeight;
    const measure = () => {
      setFrame(`${el.clientWidth}:${window.innerHeight}`);
      if (el.offsetHeight === last) return;
      last = el.offsetHeight;
      resized.current?.();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const chooseHeight = (value: number | null, remember: boolean) => {
    const next =
      value === null || value <= COMPOSER_MIN_HEIGHT + 4
        ? null
        : Math.min(Math.round(value), COMPOSER_MAX_HEIGHT);
    setManual(next);
    if (!remember) return;
    try {
      if (next === null) localStorage.removeItem(COMPOSER_HEIGHT_KEY);
      else localStorage.setItem(COMPOSER_HEIGHT_KEY, String(next));
    } catch {
      // The height still applies when storage is unavailable.
    }
  };
  const dragging = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => dragging.current?.(), []);

  // ---- Prompt recall: Up/Down on the first/last visual line. ----
  const recall = useRef(HISTORY_IDLE);
  const recalled = useRef<string | null>(null);
  useEffect(() => {
    // Any other change of the draft ends the walk; its own text is the draft.
    if (draft !== recalled.current) recall.current = HISTORY_IDLE;
  }, [draft]);
  const caretTo = useRef<number | null>(null);
  const [caret, setCaret] = useState(-1);
  useLayoutEffect(() => {
    void draft;
    const ta = inputRef.current;
    if (!ta || caretTo.current === null) return;
    ta.setSelectionRange(caretTo.current, caretTo.current);
    setCaret(caretTo.current);
    caretTo.current = null;
  }, [draft, inputRef]);
  const show = (text: string) => {
    recalled.current = text;
    caretTo.current = text.length;
    onDraft(text);
  };

  // ---- `@` popup: a path reference from the folder's bounded listing. ----
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(-1);
  // Completion is offered for what was typed here: a path the Files pane
  // inserted, a recalled prompt or a message put back to be rewritten opens
  // nothing until it is typed in.
  const [typed, setTyped] = useState<string | null>(null);
  const { location } = files;
  const token =
    location && focused && !locked && typed === draft
      ? matchAtToken(draft, caret)
      : null;
  const query = mentionQuery(token?.query ?? "");
  const open =
    token !== null &&
    token.start !== dismissed &&
    mentionReadable(query.folder);
  const listing = useWorkbench(
    files.client,
    open && location ? { kind: "files", path: query.folder, location } : null,
  );
  const listed = listing.value?.kind === "files" ? listing.value : undefined;
  const entries = listed ? mentionEntries(listed.entries, query.name) : [];
  const [picked, setPicked] = useState(0);
  const tokenKey = token ? `${token.start}:${token.query}` : "";
  useEffect(() => {
    void tokenKey;
    setPicked(0);
    if (!tokenKey) setDismissed(-1);
  }, [tokenKey]);
  const at = Math.min(picked, entries.length - 1);
  const row: FileEntry | undefined = entries[at];
  const rowId = row ? `${listId}-${at}` : undefined;
  useEffect(() => {
    if (rowId)
      document.getElementById(rowId)?.scrollIntoView({ block: "nearest" });
  }, [rowId]);
  const accept = (entry: FileEntry) => {
    if (!token) return;
    const next = applyMention(draft, token, caret, entry);
    caretTo.current = next.cursor;
    setTyped(next.text);
    onDraft(next.text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (open) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(token.start);
        return;
      }
      if (row) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          setPicked((at + step + entries.length) % entries.length);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          accept(row);
          return;
        }
      }
    }
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      const older = event.key === "ArrowUp";
      if (!older && recall.current.index === -1) return;
      const line = caretVisualLineFlags(event.currentTarget);
      if (older ? !line.first : !line.last) return;
      const step = stepHistory(
        loadPromptHistory(historyScope),
        recall.current,
        older ? "older" : "newer",
        draft,
      );
      if (!step) return;
      event.preventDefault();
      recall.current = step.cursor;
      show(step.text);
      return;
    }
    if (event.key === "Escape" && recall.current.index !== -1) {
      event.preventDefault();
      const own = recall.current.draft;
      recall.current = HISTORY_IDLE;
      show(own);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  const manualLabel =
    manual === null
      ? t(
          "Message box height: automatic. Drag or use the arrow keys to set it.",
        )
      : t(
          "Message box height: fixed. Double-click or press Home for automatic.",
        );
  return (
    <form
      ref={form}
      className="chat-composer"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        onAddImages(Array.from(event.dataTransfer.files));
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <input
        type="range"
        className={`composer-resize${manual === null ? "" : " is-manual"}`}
        min={COMPOSER_MIN_HEIGHT}
        max={COMPOSER_MAX_HEIGHT}
        step={STEP}
        value={Math.round(height)}
        aria-label={manualLabel}
        title={manualLabel}
        aria-orientation="vertical"
        aria-valuetext={
          manual === null
            ? t("Automatic")
            : t("{pixels} pixels", { pixels: Math.round(height) })
        }
        onChange={(event) => chooseHeight(Number(event.target.value), true)}
        onKeyDown={(event) => {
          if (event.key !== "Home") return;
          event.preventDefault();
          chooseHeight(null, true);
        }}
        onDoubleClick={() => chooseHeight(null, true)}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.focus();
          dragging.current?.();
          const startY = event.clientY;
          const start =
            inputRef.current?.getBoundingClientRect().height ?? height;
          let next: number | null = null;
          const move = (moved: PointerEvent) => {
            next = Math.min(
              heightCap(),
              Math.max(COMPOSER_MIN_HEIGHT, start + (startY - moved.clientY)),
            );
            chooseHeight(next, false);
          };
          const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
            dragging.current = undefined;
            // A press without a drag changes nothing.
            if (next !== null) chooseHeight(next, true);
          };
          dragging.current = stop;
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", stop, { once: true });
          window.addEventListener("pointercancel", stop, { once: true });
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        hidden
        disabled={imagesLocked}
        aria-label={t("Add images")}
        onChange={(event) => {
          onAddImages(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      {anchor}
      {images.length > 0 && (
        <div className="chat-images">
          {images.map((file) => (
            <DraftImage
              key={imageKey(file)}
              file={file}
              disabled={imagesLocked}
              remove={() => onRemoveImage(file)}
            />
          ))}
        </div>
      )}
      {status && (
        <p className="composer-status" role="status">
          {status}
        </p>
      )}
      {open && (
        <div
          className="mention-menu"
          id={listId}
          role="listbox"
          aria-label={t("Files to reference")}
          // Choosing a row must not take the caret out of the message.
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="mention-menu-hint">
            <span className="mention-menu-folder">
              {query.folder
                ? `@${query.folder}`
                : t("Files in the conversation folder")}
            </span>
            <span>{t("Enter inserts the path · Esc closes")}</span>
          </div>
          {listing.error ? (
            <p className="mention-menu-note" role="alert">
              {describeError(t, listing.error)}
            </p>
          ) : !listed ? (
            <p className="mention-menu-note">{t("Reading files…")}</p>
          ) : entries.length === 0 ? (
            <p className="mention-menu-note">{t("No matching files")}</p>
          ) : null}
          {entries.map((entry, index) => (
            <button
              type="button"
              role="option"
              key={entry.path}
              id={`${listId}-${index}`}
              className={`mention-item${entry === row ? " active" : ""}`}
              aria-selected={entry === row}
              tabIndex={-1}
              title={entry.path}
              onMouseEnter={() => setPicked(index)}
              onClick={() => accept(entry)}
            >
              {entry.directory ? (
                <FiFolder aria-hidden="true" />
              ) : (
                <FiFile aria-hidden="true" />
              )}
              <span className="mention-name">{entry.name}</span>
              {entry.path !== entry.name && (
                <span className="mention-path">{entry.path}</span>
              )}
            </button>
          ))}
          {listed?.limited && (
            <p className="mention-menu-note">
              {t("Bounded listing; narrow the directory to see more.")}
            </p>
          )}
        </div>
      )}
      <textarea
        ref={inputRef}
        disabled={locked}
        aria-label={t("Message")}
        aria-autocomplete={location ? "list" : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? rowId : undefined}
        value={draft}
        placeholder={t(
          "Message, or /cadence to enter continuous Cadence mode…",
        )}
        rows={2}
        onChange={(event) => {
          setCaret(event.target.selectionStart);
          setTyped(event.target.value);
          onDraft(event.target.value);
        }}
        onSelect={(event) => {
          const { selectionStart, selectionEnd } = event.currentTarget;
          setCaret(selectionStart === selectionEnd ? selectionStart : -1);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPaste={(event) => {
          const pasted = Array.from(event.clipboardData.files).filter((f) =>
            f.type.startsWith("image/"),
          );
          if (!pasted.length) return;
          event.preventDefault();
          onAddImages(pasted);
        }}
        onKeyDown={onKeyDown}
      />
      <div className="composer-toolbar">
        <button
          type="button"
          className="ghost icon"
          disabled={imagesLocked}
          aria-label={t("Add images")}
          title={t("Add images")}
          onClick={() => fileInput.current?.click()}
        >
          <FiImage aria-hidden="true" />
        </button>
        <CadenceModeButton {...cadence} />
        <ModelPicker {...model} />
        <span className="composer-hint">{hint}</span>
        {running ? (
          <button
            type="button"
            className="danger"
            aria-label={t("Stop response")}
            title={t("Stop response")}
            disabled={!canStop}
            onClick={onStop}
          >
            <FiSquare aria-hidden="true" />
          </button>
        ) : (
          <button
            aria-label={t("Send")}
            title={t("Send")}
            type="submit"
            className="primary"
            disabled={!canSend}
          >
            <FiArrowUp aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}
