import { useEffect, useState } from "react";
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

/** Keyed by the owner's design ID, not its revision: saving a choice must
 * neither dismiss the dialog nor reopen one the user put aside. */
export function DesignCard({
  draft,
  active,
  disabled,
  error,
  onEdit,
  onSubmit,
}: {
  draft: DesignDraft;
  active: boolean;
  disabled: boolean;
  error?: string;
  onEdit(answers: DesignAnswer[]): void | Promise<void>;
  onSubmit(draft: DesignDraft): void;
}) {
  const { t } = useT();
  const ready = active && !disabled && !draft.submitted;
  const [view, setView] = useState<"waiting" | "open" | "closed">(
    ready ? "open" : "waiting",
  );
  useEffect(() => {
    if (view === "waiting" && ready) setView("open");
  }, [view, ready]);
  const [selected, focus] = useState("");
  const [custom, setCustom] = useState<{ question: string; value: string }>();
  const questions = draft.questions.filter((q) => available(q, draft.answers));
  const q = questions.find((row) => row.id === selected) ?? questions[0];
  const answer = draft.answers.find((a) => a.question === q.id);
  const savedOther = answer && "other" in answer ? answer.other : "";
  const otherValue = custom?.question === q.id ? custom.value : savedOther;
  const unsaved = !!otherValue.trim() && otherValue.trim() !== savedOther;
  const choose = (a: DesignAnswer) =>
    onEdit([...draft.answers.filter((old) => old.question !== q.id), a]);
  return (
    <section className="workflow-plan" aria-label={t("Design choices")}>
      <h3>{t("Design choices")}</h3>
      {draft.submitted ? (
        <>
          <p role="status">{t("Design submitted")}</p>
          <dl>
            {questions.map((row) => (
              <div key={row.id}>
                <dt>{row.question}</dt>
                <dd>
                  {answerText(
                    row,
                    draft.answers.find((a) => a.question === row.id),
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p>
          {t("{answered} of {total} questions answered", {
            answered: draft.answers.length,
            total: questions.length,
          })}
        </p>
      )}
      <button
        type="button"
        aria-haspopup="dialog"
        disabled={!active}
        onClick={() => setView("open")}
      >
        {draft.submitted ? t("Review choices") : t("Choose answers")}
      </button>
      {active && view === "open" && (
        <ActionDialog
          title={t("Design choices")}
          onClose={() => setView("closed")}
        >
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
              <p>{q.reason}</p>
              <p>
                {t("Acceptance")} · {q.acceptance}
              </p>
              <label>
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
            <p>
              {t("Submitting answers requests a plan, not implementation.")}
            </p>
          </section>
          {!draft.submitted && (
            <footer>
              <button
                type="button"
                disabled={
                  disabled ||
                  unsaved ||
                  draft.answers.length === questions.length
                }
                onClick={() =>
                  void onEdit(
                    selectDesign(draft.questions, draft.answers, true),
                  )
                }
              >
                {t("Fill unanswered with recommendations")}
              </button>
              <button
                type="button"
                className="primary"
                disabled={disabled || unsaved}
                onClick={() => {
                  setView("closed");
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
      )}
    </section>
  );
}
