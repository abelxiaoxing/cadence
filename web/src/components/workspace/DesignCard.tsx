import { useState } from "react";
import {
  answerText,
  available,
  type DesignAnswer,
  type DesignDraft,
  reviseDesign,
  selectDesign,
} from "../../../../src/service/contracts/design.ts";
import { useT } from "../../i18n/locale";

export function DesignCard({
  draft: saved,
  disabled,
  onEdit,
  onSubmit,
}: {
  draft: DesignDraft;
  disabled: boolean;
  onEdit(answers: DesignAnswer[]): void | Promise<void>;
  onSubmit(draft: DesignDraft): void;
}) {
  const { t } = useT();
  const [pending, setPending] = useState<DesignDraft>();
  const draft =
    pending && pending.revision === saved.revision + 1 ? pending : saved;
  const edit = async (answers: DesignAnswer[]) => {
    setPending(reviseDesign(saved, answers, false));
    try {
      await onEdit(answers);
    } finally {
      setPending(undefined);
    }
  };
  const [selected, focus] = useState("");
  const [custom, setCustom] = useState<{ question: string; value: string }>();
  const questions = draft.questions.filter((q) => available(q, draft.answers));
  const q = questions.find((row) => row.id === selected) ?? questions[0];
  const answer = draft.answers.find((a) => a.question === q.id);
  const choose = (a: DesignAnswer) =>
    edit([...draft.answers.filter((old) => old.question !== q.id), a]);
  const otherValue =
    custom?.question === q.id
      ? custom.value
      : answer && "other" in answer
        ? answer.other
        : "";
  return (
    <section
      className="workflow-plan design-card"
      aria-label={t("Design choices")}
    >
      <h3>{t("Design choices")}</h3>
      <nav aria-label={t("Questions")}>
        {questions.map((row) => (
          <button
            type="button"
            key={row.id}
            aria-current={row.id === q.id ? "step" : undefined}
            onClick={() => focus(row.id)}
          >
            {row.question} ·{" "}
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
          <label key={o.id}>
            <input
              type="radio"
              name={draft.id + q.id}
              checked={!!answer && "option" in answer && answer.option === o.id}
              onChange={() => choose({ question: q.id, option: o.id })}
            />{" "}
            {o.label}
            {o.id === q.recommended ? ` · ${t("Recommended")}` : ""}
            <small>{o.cost}</small>
          </label>
        ))}
        <p>{q.reason}</p>
        <p>
          {t("Acceptance")} · {q.acceptance}
        </p>
        <label>
          {t("Other idea")}
          <input
            value={otherValue}
            onChange={(e) =>
              setCustom({ question: q.id, value: e.target.value })
            }
          />
        </label>
        <button
          type="button"
          disabled={!otherValue.trim()}
          onClick={() => choose({ question: q.id, other: otherValue.trim() })}
        >
          {t("Use this answer")}
        </button>
      </fieldset>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void edit(selectDesign(draft.questions, [], true))}
      >
        {t("Use all recommendations")}
      </button>
      {draft.submitted ? (
        <p role="status">{t("Design submitted")}</p>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit(reviseDesign(draft, draft.answers, true))}
        >
          {t("Submit design and use recommendations for unanswered questions")}
        </button>
      )}
    </section>
  );
}
