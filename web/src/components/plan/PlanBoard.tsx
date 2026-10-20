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
          <span>Readable plan & decomposition</span>
          <span>{steps.length} required assignments</span>
          {expanded ? <FiChevronUp /> : <FiChevronDown />}
        </button>
      </div>
      <div className="toolbar">
        <button
          type="button"
          disabled={!canAct || context.task?.kind !== "code"}
          onClick={onGenerate}
        >
          Preview readonly Generate proposal
        </button>
        <button type="button" disabled={!canSave} onClick={onSave}>
          Preview Save plan
        </button>
        <button
          type="button"
          className="primary"
          disabled={!canAct}
          onClick={onStart}
        >
          Preview Start saved graph
        </button>
      </div>
      <p>
        Draft changes never execute. Start uses the saved graph shown in its
        fresh preview, not unsaved text. Generated proposals never save or start
        themselves.
      </p>
      {steps.some(
        (s) => canonicalJson(s.model) !== canonicalJson(context.model),
      ) && (
        <section>
          <p>
            Saved assignments name an old model selection. Reading does not
            rebind them.
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
            Explicitly rebind draft to current model (requires new Save)
          </button>
        </section>
      )}
      {!roles && <p role="status">{PLAN_METADATA_UNAVAILABLE}</p>}
      {error && <p role="alert">{error}</p>}
      {expanded && (
        <>
          <label>
            Readable plan
            <textarea
              aria-label="Readable plan"
              value={draft.readablePlan}
              onChange={(e) =>
                onChange({ ...draft, readablePlan: e.target.value })
              }
              rows={8}
            />
          </label>
          <details>
            <summary>Read rendered plan</summary>
            <Markdown text={draft.readablePlan} />
          </details>
          <CopyButton text={draft.readablePlan} />
          <ol className="plan-board-steps">
            {steps.map((step) => (
              <li key={step.id} className="plan-board-step">
                <div className="plan-step-head">
                  <strong>{step.id}</strong>
                  <span>
                    {step.purpose} —{" "}
                    {step.purpose === "edit" ? "checkout writer" : "readonly"}
                  </span>
                  <button type="button" onClick={() => startEdit(step)}>
                    <FiEdit2 /> Edit
                  </button>
                  <button type="button" onClick={() => remove(step.id)}>
                    <FiTrash2 /> Remove draft assignment
                  </button>
                </div>
                {editingId === step.id ? (
                  <div className="plan-step-edit">
                    <label>
                      Purpose
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
                            <option key={p}>{p}</option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Instructions
                      <textarea
                        aria-label="Instructions"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        rows={5}
                      />
                    </label>
                    <label>
                      Expected output
                      <textarea
                        aria-label="Expected output"
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        rows={3}
                      />
                    </label>
                    <fieldset>
                      <legend>
                        Current-episode dependencies (whole final text by
                        default)
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
                          Require complete observation
                        </label>
                        <p>
                          Selection:{" "}
                          {d.range
                            ? `reviewed UTF-8 bytes ${d.range.start}–${d.range.end}`
                            : "whole final text; no silent clipping"}
                        </p>
                        <label>
                          Reviewed edge JSON (range/null and exact historical
                          identity)
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
                          Remove edge
                        </button>
                      </div>
                    ))}
                    <label>
                      Explicit historical/advisory edge JSON
                      <textarea
                        value={historical}
                        onChange={(e) => setHistorical(e.target.value)}
                        placeholder="Exact committed run/child/result/version plus range and coverage requirement"
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
                      Add reviewed historical edge
                    </button>
                    <button type="button" onClick={cancelEdit}>
                      Discard inline edits
                    </button>
                    <button
                      type="button"
                      disabled={!!error}
                      onClick={() => saveEdit(step.id)}
                    >
                      Apply to local draft
                    </button>
                  </div>
                ) : (
                  <>
                    <Markdown text={step.instructions} />
                    <p>Expected: {step.expectedOutput}</p>
                    <p>
                      Role {step.role.role} / <code>{step.role.sha256}</code>
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
            <FiPlus /> Add assignment
          </button>
        </>
      )}
    </section>
  );
}
