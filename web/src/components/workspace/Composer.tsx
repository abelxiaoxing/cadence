/* Adapted from pi-web-ui ChatInput.tsx inputbar/inputbox/composer-tools and
 * quick-row families. MIT (c) 2026 xing-shuyin. Cadence keeps only a local
 * goal draft: Enter requests a Create preview, never a send or a Start. */
import { type KeyboardEvent, type RefObject, useLayoutEffect } from "react";
import { FiArrowUp, FiCpu } from "react-icons/fi";
import { useT } from "../../i18n/locale";
import type { TaskKind } from "../../types";

const MAX_HEIGHT = 220;
// pi's auto-height: grow with the draft up to a cap, then scroll inside.
function fitHeight(area: HTMLTextAreaElement) {
  area.style.height = "auto";
  area.style.height = `${Math.min(area.scrollHeight, MAX_HEIGHT)}px`;
  area.style.overflowY = area.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
}
/** Plain Enter requests the preview; Shift+Enter adds a line, and Enter while
 * an IME is composing commits the candidate instead of the draft. */
export function submitsDraft(event: {
  key: string;
  shiftKey: boolean;
  keyCode: number;
  nativeEvent: { isComposing: boolean };
}): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229
  );
}
export function Composer({
  inputRef,
  goal,
  onGoal,
  kind,
  onKind,
  model,
  onModel,
  canSubmit,
  blocked,
  onSubmit,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  goal: string;
  onGoal: (goal: string) => void;
  kind: TaskKind;
  onKind: (kind: TaskKind) => void;
  /** Exact owner model label; null until one is explicitly chosen. */
  model: string | null;
  onModel: () => void;
  canSubmit: boolean;
  /** Why a Create preview is unavailable right now, when it is. */
  blocked?: string;
  onSubmit: () => void;
}) {
  const { t } = useT();
  // A starter card or a cleared draft changes the text without typing.
  useLayoutEffect(() => {
    const area = inputRef.current;
    if (area && area.value === goal) fitHeight(area);
  }, [goal, inputRef]);
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!submitsDraft(event)) return;
    event.preventDefault();
    if (canSubmit) onSubmit();
  };
  const submitLabel = t("Preview Create (does not Start)");
  return (
    <div className="inputbar">
      {blocked && (
        <p className="composer-hint" role="status">
          {blocked}
        </p>
      )}
      <div className="inputbox">
        <textarea
          ref={inputRef}
          aria-label={t("Goal")}
          value={goal}
          rows={1}
          placeholder={t(
            "Describe the task goal — Enter previews Create, Shift+Enter adds a line",
          )}
          onChange={(event) => {
            fitHeight(event.target);
            onGoal(event.target.value);
          }}
          onKeyDown={keyDown}
        />
        <div className="composer-tools">
          <div className="composer-tools-left">
            <span className="chip composer-select">
              <select
                aria-label={t("Kind")}
                value={kind}
                onChange={(e) =>
                  onKind(
                    e.target.value === "research"
                      ? "research"
                      : e.target.value === "diagnosis"
                        ? "diagnosis"
                        : "code",
                  )
                }
              >
                <option value="code">{t("Code")}</option>
                <option value="research">{t("Readonly research")}</option>
                <option value="diagnosis">{t("Readonly diagnosis")}</option>
              </select>
            </span>
            <button
              type="button"
              className={`chip composer-model${model ? "" : " unset"}`}
              title={t("Choose owner model")}
              onClick={onModel}
            >
              <FiCpu aria-hidden="true" />
              <span className="chip-model">
                {model ?? t("Choose a model first")}
              </span>
            </button>
          </div>
          <div className="composer-tools-right">
            <span className="composer-note">{t("Create does not Start")}</span>
            <button
              type="button"
              className="btn send"
              aria-label={submitLabel}
              title={submitLabel}
              disabled={!canSubmit}
              onClick={onSubmit}
            >
              <FiArrowUp aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
