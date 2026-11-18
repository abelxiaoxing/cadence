/** One batch of product decisions, shared by the terminal, browser and owner. */
import {
  bool,
  ContractError,
  canonicalJson,
  closed,
  decodeId,
  integer,
  list,
  text,
} from "./core.ts";

export interface DesignQuestion {
  id: string;
  question: string;
  options: { id: string; label: string; cost: string }[];
  recommended: string;
  reason: string;
  acceptance: string;
  when?: { question: string; option: string };
}
export type DesignAnswer =
  | { question: string; option: string }
  | { question: string; other: string };
export interface DesignDraft {
  revision: number;
  id: string;
  questions: DesignQuestion[];
  answers: DesignAnswer[];
  submitted: boolean;
}
const label = (v: unknown) => text(v, 1024, true);
const key = (v: unknown) => {
  const s = text(v, 48, true);
  if (!/^[a-z][a-z0-9-]*$/u.test(s))
    throw new Error("id: use lowercase letters, digits and hyphens");
  return s;
};
export function designQuestions(input: unknown): DesignQuestion[] {
  const { questions } = closed(input, ["questions"]);
  const seen = new Map<string, Set<string>>();
  const rows = list(questions, 12, (raw) => {
    const q = closed(raw, [
      "id",
      "question",
      "options",
      "recommended",
      "reason",
      "acceptance",
      ...(Object.hasOwn(raw ?? {}, "when") ? ["when"] : []),
    ]);
    const id = key(q.id);
    const options = list(q.options, 6, (raw) => {
      const o = closed(raw, ["id", "label", "cost"]);
      return { id: key(o.id), label: label(o.label), cost: label(o.cost) };
    });
    const ids = new Set(options.map((o) => o.id));
    const recommended = key(q.recommended);
    if (
      seen.has(id) ||
      ids.size !== options.length ||
      ids.size < 2 ||
      !ids.has(recommended)
    )
      throw new Error(
        "questions: use distinct question and option IDs and identify one recommended option",
      );
    const dep =
      q.when === undefined ? null : closed(q.when, ["question", "option"]);
    const when = dep && {
      question: key(dep.question),
      option: key(dep.option),
    };
    if (when && !seen.get(when.question)?.has(when.option))
      throw new Error("when: name an option of an earlier question");
    seen.set(id, ids);
    return {
      id,
      question: label(q.question),
      options,
      recommended,
      reason: label(q.reason),
      acceptance: label(q.acceptance),
      ...(when ? { when } : {}),
    };
  });
  if (!rows.length)
    throw new Error("questions: supply a material product decision");
  canonicalJson(rows, 24 * 1024);
  return rows;
}
export function designAnswers(v: unknown): DesignAnswer[] {
  return list(v, 12, (raw) => {
    const other = Object.hasOwn(raw ?? {}, "other");
    const a = closed(raw, ["question", other ? "other" : "option"]);
    const question = key(a.question);
    return other
      ? { question, other: label(a.other) }
      : { question, option: key(a.option) };
  });
}
export function available(q: DesignQuestion, answers: DesignAnswer[]) {
  const dep = q.when;
  return (
    !dep ||
    answers.some(
      (a) =>
        a.question === dep.question && "option" in a && a.option === dep.option,
    )
  );
}
/** Recompute in dependency order. Unrelated answers survive edits. */
export function selectDesign(
  questions: DesignQuestion[],
  choices: DesignAnswer[],
  fill = false,
) {
  const answers: DesignAnswer[] = [];
  const indexed = new Map(choices.map((a) => [a.question, a]));
  if (
    indexed.size !== choices.length ||
    choices.some((a) => !questions.some((q) => q.id === a.question))
  )
    throw new ContractError("invalid");
  for (const q of questions) {
    if (!available(q, answers)) continue;
    const a = indexed.get(q.id);
    if (a && "option" in a && !q.options.some((o) => o.id === a.option))
      throw new ContractError("invalid");
    if (a) answers.push(a);
    else if (fill) answers.push({ question: q.id, option: q.recommended });
  }
  return answers;
}
export function decodeDesign(v: unknown): DesignDraft {
  const o = closed(v, ["id", "revision", "questions", "answers", "submitted"]);
  const questions = designQuestions({ questions: o.questions });
  const submitted = bool(o.submitted);
  const answers = designAnswers(o.answers);
  if (
    canonicalJson(selectDesign(questions, answers, submitted)) !==
    canonicalJson(answers)
  )
    throw new ContractError("invalid");
  return {
    id: decodeId(o.id),
    revision: integer(o.revision, 1),
    questions,
    answers,
    submitted,
  };
}
export function newDesign(
  id: string,
  input: unknown,
  previous?: DesignDraft,
): DesignDraft {
  const questions = designQuestions(input);
  const retained =
    previous?.answers.filter((a) => {
      const before = previous.questions.find((q) => q.id === a.question);
      const after = questions.find((q) => q.id === a.question);
      return before && after && canonicalJson(before) === canonicalJson(after);
    }) ?? [];
  return {
    id,
    revision: 1,
    questions,
    answers: selectDesign(questions, retained),
    submitted: false,
  };
}
export function answerText(q: DesignQuestion, a?: DesignAnswer) {
  return (
    a &&
    ("other" in a ? a.other : q.options.find((o) => o.id === a.option)?.label)
  );
}
export function designSummary(d: DesignDraft) {
  return d.questions
    .filter((q) => available(q, d.answers))
    .map(
      (q) =>
        `- ${q.question} — ${
          answerText(
            q,
            d.answers.find((a) => a.question === q.id),
          ) ?? "…"
        }\n  Acceptance: ${q.acceptance}`,
    )
    .join("\n");
}
/** The turn retains its visible decisions where they fit. The owner keeps
 * the full revision and exposes it to the coordinator in either case. */
export function designMessage(d: DesignDraft, maximum: number) {
  const summary = designSummary(d);
  return new TextEncoder().encode(summary).length <= maximum
    ? summary
    : `Submit design ${d.id}, revision ${d.revision}. Read the confirmed decisions in cadence_status and publish the implementation plan.`;
}
export const recommendsDesign = (s: string) =>
  /^(?:按你推荐的来|采用全部推荐|use (?:all |your )?recommendations)[。.!！]?$/iu.test(
    s.trim(),
  );

export function reviseDesign(
  d: DesignDraft,
  answers: DesignAnswer[],
  submit: boolean,
): DesignDraft {
  return {
    ...d,
    revision: d.revision + 1,
    answers: selectDesign(d.questions, answers, submit),
    submitted: submit,
  };
}
