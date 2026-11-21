import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FiSliders } from "react-icons/fi";
import {
  answerText,
  available,
  type DesignAnswer,
  type DesignDraft,
  reviseDesign,
  selectDesign,
} from "../../../../src/service/contracts/design.ts";
import { useT } from "../../i18n/locale";
import { ActionDialog } from "../actions/ActionDialog";

export type DesignPlacement =
  | { kind: "none" }
  | { kind: "start" }
  | { kind: "after"; turnId: string }
  | { kind: "end" };

/** Where a submitted design batch sits in the transcript: right after the
 * newest loaded turn that began before it was published, matching
 * `placeWorkflows`. Unsubmitted drafts belong above the composer, not in the
 * transcript; undated records stay at the end so legacy sessions stay visible. */
export function placeDesign(
  turns: readonly { header: { id: string; at: number } }[],
  design: Pick<DesignDraft, "at" | "submitted"> | undefined,
  earlier: boolean,
): DesignPlacement {
  if (!design?.submitted) return { kind: "none" };
  if (design.at === undefined || !turns.length) return { kind: "end" };
  const dated = turns.filter((turn) => turn.header.at > 0);
  if (!dated.length) return { kind: "end" };
  const at = design.at;
  const holder = dated.findLast((turn) => turn.header.at <= at);
  if (holder) return { kind: "after", turnId: holder.header.id };
  return earlier ? { kind: "none" } : { kind: "start" };
}

/** Opens a pending design batch once answering is available, keeps a dismissed
 * modal closed across polling and edits of the same draft, and keeps the modal
 * open when revising a submitted choice flips `submitted` back to false. */
export function useDesignModal(
  draft: DesignDraft | undefined,
  active: boolean,
  disabled: boolean,
) {
  const ready = !!draft && active && !disabled && !draft.submitted;
  const id = draft?.id ?? "";
  const [state, setState] = useState<{
    id: string;
    view: "waiting" | "open" | "closed";
  }>(() => ({ id, view: ready ? "open" : "waiting" }));
  const view = state.id === id ? state.view : ready ? "open" : "waiting";
  useEffect(() => {
    if (state.id !== id) {
      setState({ id, view: ready ? "open" : "waiting" });
      return;
    }
    if (state.view === "waiting" && ready) {
      setState({ id, view: "open" });
    }
  }, [id, ready, state.id, state.view]);
  return {
    visible: !!draft && active && view === "open",
    open: () => {
      if (id) setState({ id, view: "open" });
    },
    close: () => {
      if (id) setState({ id, view: "closed" });
    },
  };
}

/** Single-line pending design reminder above the composer when the modal is
 * dismissed or waiting. Never occupies the transcript. */
export function DesignBar({
  draft,
  active,
  onOpen,
}: {
  draft: DesignDraft;
  active: boolean;
  onOpen(): void;
}) {
  const { t } = useT();
  const questions = draft.questions.filter((q) => available(q, draft.answers));
  return (
    <section
      className="composer-anchor design-bar"
      aria-label={t("Design choices")}
    >
      <FiSliders aria-hidden="true" />
      <div className="composer-anchor-text design-bar-text">
        <strong>{t("Design choices")}</strong>
        <span>
          {t("{answered} of {total} questions answered", {
            answered: draft.answers.length,
            total: questions.length,
          })}
        </span>
      </div>
      <button
        type="button"
        aria-haspopup="dialog"
        disabled={!active}
        onClick={onOpen}
      >
        {t("Choose answers")}
      </button>
    </section>
  );
}

/** Compact single-line summary anchored in the scrolling transcript where the
 * design was published. Reopens the dialog to review or revise choices until
 * plan approval retires the batch. */
export function DesignLine({
  draft,
  active,
  onOpen,
}: {
  draft: DesignDraft;
  active: boolean;
  onOpen(): void;
}) {
  const { t } = useT();
  const questions = draft.questions.filter((q) => available(q, draft.answers));
  const summary = questions
    .map((row) =>
      answerText(
        row,
        draft.answers.find((a) => a.question === row.id),
      ),
    )
    .filter(Boolean)
    .join(" · ");
  const details = questions
    .map(
      (row) =>
        `${row.question}: ${
          answerText(
            row,
            draft.answers.find((a) => a.question === row.id),
          ) ?? "…"
        }`,
    )
    .join("\n");
  return (
    <article
      className="workflow-line design-line"
      aria-label={t("Design choices")}
    >
      <button
        type="button"
        className="workflow-line-open"
        aria-haspopup="dialog"
        disabled={!active}
        title={details || t("Design choices")}
        onClick={onOpen}
      >
        <FiSliders className="design-line-icon" aria-hidden="true" />
        <span className="workflow-line-goal">
          {t("Design choices")}
          {summary && <span className="design-line-summary"> · {summary}</span>}
        </span>
        <span className="workflow-line-meta ep-state completed" role="status">
          {t("Design submitted")}
        </span>
        <span className="design-line-action">{t("Review choices")}</span>
      </button>
    </article>
  );
}

/** Keyed by the owner's design ID, not its revision: saving a choice must
 * neither dismiss the dialog nor reset the active question when editing a
 * submitted batch flips `submitted` back to false. */
export function DesignDialog({
  draft,
  open,
  disabled,
  error,
  onClose,
  onEdit,
  onSubmit,
}: {
  draft: DesignDraft;
  open: boolean;
  disabled: boolean;
  error?: string;
  onClose(): void;
  onEdit(answers: DesignAnswer[]): void | Promise<void>;
  onSubmit(draft: DesignDraft): void;
}) {
  const { t } = useT();
  const [selected, focus] = useState("");
  const [custom, setCustom] = useState<{ question: string; value: string }>();
  const questions = draft.questions.filter((q) => available(q, draft.answers));
  const q = questions.find((row) => row.id === selected) ?? questions[0];
  const answer = draft.answers.find((a) => a.question === q.id);
  const savedOther = answer && "other" in answer ? answer.other : "";
  const otherValue = custom?.question === q.id ? custom.value : savedOther;
  const unsaved = !!otherValue.trim() && otherValue.trim() !== savedOther;
  const track = useRef<HTMLDivElement>(null);
  const picked = answer && "option" in answer ? answer.option : null;
  useLayoutEffect(() => {
    void q.id; // Different questions may use the same option IDs.
    const node = track.current;
    if (!open || !node || !picked) return;
    const chosen = node
      .querySelector<HTMLInputElement>("input:checked")
      ?.closest("label");
    if (!chosen) return;
    const place = () => {
      node.style.setProperty("--pill-y", `${chosen.offsetTop}px`);
      node.style.setProperty("--pill-h", `${chosen.offsetHeight}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    for (const label of node.querySelectorAll("label")) observer.observe(label);
    return () => observer.disconnect();
  }, [open, picked, q.id]);
  if (!open) return null;
  const choose = (a: DesignAnswer) =>
    onEdit([...draft.answers.filter((old) => old.question !== q.id), a]);
  return (
    <ActionDialog title={t("Design choices")} onClose={onClose}>
      <section className="design-card">
        <nav aria-label={t("Questions")}>
          {questions.map((row, i) => (
            <button
              type="button"
              key={row.id}
              disabled={unsaved && row.id !== q.id}
              aria-current={row.id === q.id ? "step" : undefined}
              onClick={() => focus(row.id)}
            >
              {i + 1}. {row.question} ·{" "}
              {answerText(
                row,
                draft.answers.find((a) => a.question === row.id),
              ) ?? "…"}
            </button>
          ))}
        </nav>
        <fieldset disabled={disabled}>
          <legend>{q.question}</legend>
          <div className="design-track" ref={track} data-selected={!!picked}>
            {q.options.map((o) => (
              <label className="design-option" key={o.id}>
                <input
                  type="radio"
                  name={draft.id + q.id}
                  checked={
                    !!answer && "option" in answer && answer.option === o.id
                  }
                  onChange={() => {
                    setCustom(undefined);
                    void choose({ question: q.id, option: o.id });
                  }}
                />
                <span>
                  {o.label}
                  {o.id === q.recommended ? ` · ${t("Recommended")}` : ""}
                  <small>{o.cost}</small>
                </span>
              </label>
            ))}
          </div>
          <p>{q.reason}</p>
          <p>
            {t("Acceptance")} · {q.acceptance}
          </p>
          <label
            className={
              answer && "other" in answer
                ? "design-custom chosen"
                : "design-custom"
            }
          >
            {t("Other idea")}{" "}
            <input
              value={otherValue}
              onChange={(e) =>
                setCustom({ question: q.id, value: e.target.value })
              }
            />
          </label>
          <button
            type="button"
            disabled={!unsaved}
            onClick={() =>
              void choose({ question: q.id, other: otherValue.trim() })
            }
          >
            {t("Use this answer")}
          </button>
          {unsaved && (
            <button type="button" onClick={() => setCustom(undefined)}>
              {t("Discard typed answer")}
            </button>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <p>{t("Submitting answers requests a plan, not implementation.")}</p>
      </section>
      {!draft.submitted && (
        <footer>
          <button
            type="button"
            disabled={
              disabled || unsaved || draft.answers.length === questions.length
            }
            onClick={() =>
              void onEdit(selectDesign(draft.questions, draft.answers, true))
            }
          >
            {t("Fill unanswered with recommendations")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={disabled || unsaved}
            onClick={() => {
              onClose();
              onSubmit(reviseDesign(draft, draft.answers, true));
            }}
          >
            {t(
              "Submit design and use recommendations for unanswered questions",
            )}
          </button>
        </footer>
      )}
    </ActionDialog>
  );
}
