/* Adapted from pi-web-ui RightPanel.tsx narrow props/tab composition, panel chrome
 * and PlanBoard. MIT (c) 2026 xing-shuyin.
 * Authority and current metadata are never panel defaults. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  FiCheckSquare,
  FiFileText,
  FiGitPullRequest,
  FiUserCheck,
} from "react-icons/fi";
import {
  canonicalJson,
  decodeContext,
  parseWireJson,
} from "../../../../src/service-contract.ts";
import type {
  PlanDraft,
  PlanMetadata,
  PlanMetadataPort,
  PlanMetadataRead,
} from "../../client/plan-metadata";
import { PLAN_METADATA_UNAVAILABLE } from "../../client/plan-metadata";
import { ViewLifetime } from "../../client/view-lifetime";
import { type MessageKey, useT } from "../../i18n/locale";
import type {
  Action,
  CheckObligations,
  ContextVersion,
  ListRequest,
  RunProjection,
  ServiceClient,
} from "../../types";
import { PlanBoard } from "../plan/PlanBoard";
import { CheckPanel } from "../review/CheckPanel";
import { CurrentChangesPanel } from "../review/CurrentChangesPanel";
import { ObservationPanel } from "../review/ObservationPanel";

const INSPECTOR_TABS: readonly (readonly [string, IconType])[] = [
  ["plan", FiFileText],
  ["checks", FiCheckSquare],
  ["changes", FiGitPullRequest],
  ["review", FiUserCheck],
];
const GUIDE: readonly (readonly [MessageKey, MessageKey])[] = [
  [
    "Describe the goal",
    "Type it in the input box; Create is previewed and confirmed, and starts nothing.",
  ],
  [
    "Write or generate a plan",
    "The Plan tab holds a readable plan and 1–16 assignments. Save it explicitly.",
  ],
  [
    "Confirm Start",
    "Start runs the saved graph after its own preview. Runs and subagents appear under the task in the left sidebar.",
  ],
  [
    "Check and review",
    "Run configured checks, read current changes and record human review here.",
  ],
];
export function InspectorPlaceholder() {
  const { t } = useT();
  return (
    <aside className="panel panel-right">
      <div className="inspector-body inspector-guide">
        <h3>{t("How a task works")}</h3>
        <ol>
          {GUIDE.map(([title, text]) => (
            <li key={title}>
              <strong>{t(title)}</strong>
              <span>{t(text)}</span>
            </li>
          ))}
        </ol>
        <p className="panel-hint">
          {t("Select a task to inspect plans, checks, changes and review.")}
        </p>
      </div>
    </aside>
  );
}
export function InspectorPanel({
  client,
  context: contextInput,
  seed,
  runs,
  canAct,
  onAction,
  planMetadata,
  tab: shownTab,
  onTab,
}: {
  client: ServiceClient;
  context: ContextVersion | null;
  seed: ListRequest;
  runs: RunProjection[];
  canAct: boolean;
  onAction: (a: Action) => void;
  planMetadata?: PlanMetadataPort;
  /** Optional owner of the selected tab, so the task flow can open one. */
  tab?: string;
  onTab?: (tab: string) => void;
}) {
  const { t, tx } = useT();
  const contextKey = contextInput ? canonicalJson(contextInput) : "unavailable";
  const context = useMemo(
    () =>
      contextKey === "unavailable"
        ? null
        : decodeContext(parseWireJson(contextKey)),
    [contextKey],
  );
  const [localTab, setLocalTab] = useState("plan");
  const tab = shownTab ?? localTab,
    setTab = onTab ?? setLocalTab;
  const [draft, setDraft] = useState<PlanDraft>({
    readablePlan: "",
    assignments: [],
  });
  const [progress, setProgress] =
    useState<Extract<PlanMetadataRead, { kind: "progress" }>>();
  const [meta, setMeta] = useState<PlanMetadata>(),
    [metaError, setMetaError] = useState<string>();
  const [checks, setChecks] = useState<CheckObligations>(),
    [reviewRun, setReviewRun] = useState(""),
    [issues, setIssues] = useState(false);
  const taskId =
    context?.task?.id ?? (seed.scope.kind === "task" ? seed.scope.id : null);
  const lifetime = useRef(new ViewLifetime());
  lifetime.current.select(canonicalJson({ context, tab, draft, canAct }));
  useEffect(() => () => lifetime.current.depart(), []);
  useEffect(() => {
    let current = true;
    setMeta(undefined);
    setProgress(undefined);
    if (!planMetadata || !context) {
      setMetaError(PLAN_METADATA_UNAVAILABLE);
      return;
    }
    void planMetadata
      .read(context)
      .then((reply) => {
        if (!current) return;
        if (reply.kind === "error") setMetaError(reply.error.code);
        else if (canonicalJson(reply.value.context) === contextKey) {
          if ("kind" in reply.value) setProgress(reply.value);
          else setMeta(reply.value);
          setMetaError(undefined);
        } else setMetaError("Owner metadata is stale.");
      })
      .catch(() => {
        if (current) setMetaError("Owner metadata unavailable.");
      });
    return () => {
      current = false;
    };
  }, [planMetadata, context, contextKey]);
  // A pristine local draft starts from the observed saved plan. It changes only
  // this browser's draft; saving still needs its own preview and confirmation.
  useEffect(() => {
    if (!meta) return;
    setDraft((current) =>
      current.readablePlan || current.assignments.length
        ? current
        : {
            readablePlan: meta.readablePlan,
            assignments: meta.savedGraph?.assignments ?? [],
          },
    );
  }, [meta]);
  const rememberChecks = useCallback(
    (value: CheckObligations) => setChecks(value),
    [],
  );
  if (!taskId) return <InspectorPlaceholder />;
  const taskSeed = { ...seed, scope: { kind: "task" as const, id: taskId } };
  return (
    <aside className="panel panel-right">
      <nav className="rp-tabs" aria-label={t("Inspector")}>
        {INSPECTOR_TABS.map(([name, Icon]) => (
          <button
            type="button"
            key={name}
            className="rp-tab"
            aria-label={tx(name)}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            <Icon aria-hidden="true" />
            <span>{tx(name)}</span>
          </button>
        ))}
      </nav>
      <div className="inspector-body">
        {tab === "plan" && (
          <>
            {metaError && (
              <p className="inspector-note" role="status">
                {tx(metaError)}
              </p>
            )}
            {progress && (
              <section>
                <p>
                  {t("Saved graph proof in progress.")}{" "}
                  {JSON.stringify(progress.coverage)}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!planMetadata || !context) return;
                    const ticket = lifetime.current.ticket();
                    void planMetadata
                      .read(context, progress.next)
                      .then((reply) => {
                        if (!lifetime.current.current(ticket)) return;
                        if (reply.kind === "error")
                          setMetaError(reply.error.code);
                        else if ("kind" in reply.value)
                          setProgress(reply.value);
                        else {
                          setProgress(undefined);
                          setMeta(reply.value);
                        }
                      });
                  }}
                >
                  {t("Continue saved graph read")}
                </button>
              </section>
            )}
            {meta && (
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    readablePlan: meta.readablePlan,
                    assignments: meta.savedGraph?.assignments ?? [],
                  })
                }
              >
                {t("Load observed saved plan into local draft")}
              </button>
            )}
            {context ? (
              <PlanBoard
                draft={draft}
                onChange={setDraft}
                context={context}
                roles={meta?.roles ?? null}
                canAct={canAct}
                canSave={
                  canAct && !!meta && meta.editable !== false && !!planMetadata
                }
                onGenerate={() => onAction({ kind: "generate-plan", taskId })}
                onStart={() => onAction({ kind: "start", taskId })}
                onSave={() => {
                  if (!planMetadata) return;
                  const ticket = lifetime.current.ticket();
                  void planMetadata
                    .saveAction(context, structuredClone(draft))
                    .then((reply) => {
                      if (!lifetime.current.current(ticket)) return;
                      if (reply.kind === "error")
                        setMetaError(reply.error.code);
                      else onAction(reply.value);
                    })
                    .catch(() => {
                      if (lifetime.current.current(ticket))
                        setMetaError("Plan proposal unavailable.");
                    });
                }}
              />
            ) : (
              <p>
                {t(
                  "Current control context unavailable. Historical data is not action authority.",
                )}
              </p>
            )}
          </>
        )}
        {tab === "checks" && (
          <CheckPanel
            client={client}
            taskId={taskId}
            seed={taskSeed}
            canAct={canAct}
            onAction={onAction}
            onObligations={rememberChecks}
          />
        )}
        {tab === "changes" && (
          <>
            <CurrentChangesPanel
              client={client}
              storeId={seed.storeId}
              taskId={taskId}
            />
            <h3>{t("Captured historical observations")}</h3>
            <ObservationPanel
              client={client}
              seed={{ ...taskSeed, reader: "changes" }}
            />
          </>
        )}
        {tab === "review" && (
          <>
            <h3>{t("Human review")}</h3>
            <p>
              {t(
                "Done records human acknowledgment, not execution success or certification. It cannot restart a blocked episode.",
              )}
            </p>
            <label>
              {t("Episode to review")}
              <select
                value={reviewRun}
                onChange={(e) => setReviewRun(e.target.value)}
              >
                <option value="">{t("Select an observed episode")}</option>
                {runs
                  .filter(
                    (r) =>
                      r.childRunId === null && r.admission.kind !== "check",
                  )
                  .map((r) => (
                    <option key={r.runId} value={r.runId}>
                      {r.runId} · {tx(r.outcome ?? r.lifecycle)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={issues}
                onChange={(e) => setIssues(e.target.checked)}
              />
              {t(
                "I acknowledge current unresolved issues if present; original results will not be rewritten.",
              )}
            </label>
            <button
              type="button"
              disabled={
                !canAct ||
                !context ||
                !checks ||
                checks.taskId !== taskId ||
                !reviewRun
              }
              onClick={() => {
                if (context && checks)
                  onAction({
                    kind: "review",
                    taskId,
                    runId: reviewRun,
                    changesIdentity: context.observation.identity,
                    checksRevision: checks.revision,
                    acceptIssues: issues,
                  });
              }}
            >
              {t("Preview human review / Done")}
            </button>
            {!checks && (
              <p>
                {t(
                  "Observe current obligations in Checks before requesting review.",
                )}
              </p>
            )}
            <ObservationPanel
              client={client}
              seed={{ ...taskSeed, reader: "reviews" }}
            />
          </>
        )}
      </div>
    </aside>
  );
}
