/* Adapted from pi-web-ui components/PlanBoard.tsx @ e8bab487af208bc9a1ab60a821652323f598127f.
 * MIT Copyright (c) 2026 xing-shuyin. Retains expandable board, inline editing,
 * add/delete and Markdown copy. Replaces outcome toggles/prompt dispatch with local drafts. */
import { useState } from "react";
import {
  FiChevronDown,
  FiChevronUp,
  FiEdit2,
  FiList,
  FiPlus,
  FiTrash2,
} from "react-icons/fi";
import {
  canonicalJson,
  dependency,
  parseWireJson,
  roleForPurpose,
} from "../../../../src/service-contract.ts";
import type { PlanDraft } from "../../client/plan-metadata";
import { PLAN_METADATA_UNAVAILABLE } from "../../client/plan-metadata";
import { useT } from "../../i18n/locale";
import type {
  Assignment,
  ContextVersion,
  Dependency,
  Purpose,
  RoleSelection,
} from "../../types";
import { CopyButton } from "../rich/CopyButton";
import { Markdown } from "../rich/Markdown";

interface Props {
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
  context: ContextVersion;
  roles: RoleSelection[] | null;
  onSave: () => void;
  onGenerate: () => void;
  onStart: () => void;
  canSave: boolean;
  canAct: boolean;
}
export function PlanBoard({
  draft,
  onChange,
  context,
  roles,
  onSave,
  onGenerate,
  onStart,
  canSave,
  canAct,
}: Props) {
  const { t, tx } = useT();
  const [expanded, setExpanded] = useState(true),
    [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState(""),
    [editDesc, setEditDesc] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("research"),
    [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [historical, setHistorical] = useState(""),
    [error, setError] = useState("");
  const steps = draft.assignments;
  const startEdit = (step: Assignment) => {
    setEditingId(step.id);
    setEditTitle(step.instructions);
    setEditDesc(step.expectedOutput);
    setPurpose(step.purpose);
    setDependencies(step.dependencies);
    setError("");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
    setEditDesc("");
    setError("");
  };
  const saveEdit = (stepId: string) => {
    const selectedRole = roles?.find((r) => r.role === roleForPurpose(purpose));
    if (!selectedRole) {
      setError(PLAN_METADATA_UNAVAILABLE);
      return;
    }
    onChange({
      ...draft,
      assignments: steps.map((s) =>
        s.id === stepId
          ? {
              ...s,
              purpose,
              instructions: editTitle,
              expectedOutput: editDesc,
              dependencies,
              role: selectedRole,
            }
          : s,
      ),
    });
    cancelEdit();
  };
  const add = () => {
    const selectedRole = roles?.find(
      (r) => r.role === roleForPurpose("research"),
    );
    if (!selectedRole) {
      setError(PLAN_METADATA_UNAVAILABLE);
      return;
    }
    let i = 1;
    while (steps.some((s) => s.id === `assignment-${i}`)) i++;
    const step: Assignment = {
      id: `assignment-${i}`,
      purpose: "research",
      instructions: "",
      expectedOutput: "",
      dependencies: [],
      role: selectedRole,
      model: context.model,
    };
    onChange({ ...draft, assignments: [...steps, step] });
    startEdit(step);
  };
  const remove = (id: string) => {
    if (
      steps.some((s) =>
        s.dependencies.some(
          (d) => d.source.kind === "current" && d.source.assignmentId === id,
        ),
      )
    ) {
      setError(
        "Remove dependent edges explicitly before deleting this assignment.",
      );
      return;
    }
    onChange({ ...draft, assignments: steps.filter((s) => s.id !== id) });
  };
  return (
    <section className={`plan-board ${expanded ? "" : "plan-board-collapsed"}`}>
      <div className="plan-board-head">
        <button
          type="button"
          className="plan-board-head-main"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <FiList />
          <span>{t("Readable plan & decomposition")}</span>
          <span>
            {t("{count} required assignments", { count: steps.length })}
          </span>
          {expanded ? <FiChevronUp /> : <FiChevronDown />}
        </button>
      </div>
      <div className="toolbar">
        <button
          type="button"
          disabled={!canAct || context.task?.kind !== "code"}
          onClick={onGenerate}
        >
          {t("Preview readonly Generate proposal")}
        </button>
        <button type="button" disabled={!canSave} onClick={onSave}>
          {t("Preview Save plan")}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!canAct}
          onClick={onStart}
        >
          {t("Preview Start saved graph")}
        </button>
      </div>
      <p>
        {t(
          "Draft changes never execute. Start uses the saved graph shown in its fresh preview, not unsaved text. Generated proposals never save or start themselves.",
        )}
      </p>
      {steps.some(
        (s) => canonicalJson(s.model) !== canonicalJson(context.model),
      ) && (
        <section>
          <p>
            {t(
              "Saved assignments name an old model selection. Reading does not rebind them.",
            )}
          </p>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...draft,
                assignments: steps.map((s) => ({ ...s, model: context.model })),
              })
            }
          >
            {t("Explicitly rebind draft to current model (requires new Save)")}
          </button>
        </section>
      )}
      {!roles && <p role="status">{tx(PLAN_METADATA_UNAVAILABLE)}</p>}
      {error && <p role="alert">{tx(error)}</p>}
      {expanded && (
        <>
          <label>
            {t("Readable plan")}
            <textarea
              aria-label={t("Readable plan")}
              value={draft.readablePlan}
              onChange={(e) =>
                onChange({ ...draft, readablePlan: e.target.value })
              }
              rows={8}
            />
          </label>
          <details>
            <summary>{t("Read rendered plan")}</summary>
            <Markdown text={draft.readablePlan} />
          </details>
          <CopyButton text={draft.readablePlan} />
          <ol className="plan-board-steps">
            {steps.map((step) => (
              <li key={step.id} className="plan-board-step">
                <div className="plan-step-head">
                  <strong>{step.id}</strong>
                  <span>
                    {tx(step.purpose)} —{" "}
                    {step.purpose === "edit"
                      ? t("checkout writer")
                      : t("readonly")}
                  </span>
                  <button type="button" onClick={() => startEdit(step)}>
                    <FiEdit2 /> {t("Edit")}
                  </button>
                  <button type="button" onClick={() => remove(step.id)}>
                    <FiTrash2 /> {t("Remove draft assignment")}
                  </button>
                </div>
                {editingId === step.id ? (
                  <div className="plan-step-edit">
                    <label>
                      {t("Purpose")}
                      <select
                        value={purpose}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (
                            value === "research" ||
                            value === "diagnosis" ||
                            value === "review" ||
                            (value === "edit" && context.task?.kind === "code")
                          )
                            setPurpose(value);
                        }}
                      >
                        {(["research", "diagnosis", "review", "edit"] as const)
                          .filter(
                            (p) =>
                              p !== "edit" || context.task?.kind === "code",
                          )
                          .map((p) => (
                            <option key={p} value={p}>
                              {tx(p)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      {t("Instructions")}
                      <textarea
                        aria-label={t("Instructions")}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        rows={5}
                      />
                    </label>
                    <label>
                      {t("Expected output")}
                      <textarea
                        aria-label={t("Expected output")}
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        rows={3}
                      />
                    </label>
                    <fieldset>
                      <legend>
                        {t(
                          "Current-episode dependencies (whole final text by default)",
                        )}
                      </legend>
                      {steps
                        .filter((s) => s.id !== step.id)
                        .map((s) => {
                          const index = dependencies.findIndex(
                            (d) =>
                              d.source.kind === "current" &&
                              d.source.assignmentId === s.id,
                          );
                          return (
                            <label key={s.id}>
                              <input
                                type="checkbox"
                                checked={index >= 0}
                                onChange={(e) =>
                                  setDependencies((ds) =>
                                    e.target.checked
                                      ? [
                                          ...ds,
                                          {
                                            source: {
                                              kind: "current",
                                              assignmentId: s.id,
                                            },
                                            range: null,
                                            requireCompleteObservation: false,
                                          },
                                        ]
                                      : ds.filter(
                                          (d) =>
                                            !(
                                              d.source.kind === "current" &&
                                              d.source.assignmentId === s.id
                                            ),
                                        ),
                                  )
                                }
                              />
                              {s.id}
                            </label>
                          );
                        })}
                    </fieldset>
                    {dependencies.map((d, i) => (
                      <div
                        className="dependency-editor"
                        key={
                          d.source.kind === "current"
                            ? d.source.assignmentId
                            : d.source.childRunId
                        }
                      >
                        <code>{JSON.stringify(d.source)}</code>
                        <label>
                          <input
                            type="checkbox"
                            checked={d.requireCompleteObservation}
                            onChange={(e) =>
                              setDependencies((ds) =>
                                ds.map((v, j) =>
                                  i === j
                                    ? {
                                        ...v,
                                        requireCompleteObservation:
                                          e.target.checked,
                                      }
                                    : v,
                                ),
                              )
                            }
                          />
                          {t("Require complete observation")}
                        </label>
                        <p>
                          {t("Selection: {range}", {
                            range: d.range
                              ? t("reviewed UTF-8 bytes {start}–{end}", {
                                  start: d.range.start,
                                  end: d.range.end,
                                })
                              : t("whole final text; no silent clipping"),
                          })}
                        </p>
                        <label>
                          {t(
                            "Reviewed edge JSON (range/null and exact historical identity)",
                          )}
                          <textarea
                            defaultValue={JSON.stringify(d)}
                            onBlur={(e) => {
                              try {
                                const edge = dependency(
                                  parseWireJson(e.target.value),
                                );
                                setDependencies((ds) =>
                                  ds.map((v, j) => (i === j ? edge : v)),
                                );
                                setError("");
                              } catch {
                                setError(
                                  "Invalid dependency. Original edge retained; review before Save.",
                                );
                              }
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setDependencies((ds) =>
                              ds.filter((_, j) => i !== j),
                            )
                          }
                        >
                          {t("Remove edge")}
                        </button>
                      </div>
                    ))}
                    <label>
                      {t("Explicit historical/advisory edge JSON")}
                      <textarea
                        value={historical}
                        onChange={(e) => setHistorical(e.target.value)}
                        placeholder={t(
                          "Exact committed run/child/result/version plus range and coverage requirement",
                        )}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const edge = dependency(parseWireJson(historical));
                          if (edge.source.kind !== "historical")
                            throw new Error();
                          setDependencies((ds) => [...ds, edge]);
                          setHistorical("");
                          setError("");
                        } catch {
                          setError(
                            "Historical edge requires actual committed identity; no guessed result reference.",
                          );
                        }
                      }}
                    >
                      {t("Add reviewed historical edge")}
                    </button>
                    <button type="button" onClick={cancelEdit}>
                      {t("Discard inline edits")}
                    </button>
                    <button
                      type="button"
                      disabled={!!error}
                      onClick={() => saveEdit(step.id)}
                    >
                      {t("Apply to local draft")}
                    </button>
                  </div>
                ) : (
                  <>
                    <Markdown text={step.instructions} />
                    <p>
                      {t("Expected: {output}", { output: step.expectedOutput })}
                    </p>
                    <p>
                      {t("Role {role}", { role: step.role.role })} /{" "}
                      <code>{step.role.sha256}</code>
                    </p>
                    <p>
                      {step.model.provider}/{step.model.model} ·{" "}
                      {step.model.thinking}
                    </p>
                    <pre>{JSON.stringify(step.dependencies, null, 2)}</pre>
                  </>
                )}
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled={!roles || steps.length >= 16}
            onClick={add}
          >
            <FiPlus /> {t("Add assignment")}
          </button>
        </>
      )}
    </section>
  );
}
