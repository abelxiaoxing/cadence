import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Activity } from "../../src/service/contracts/activity.ts";
import {
  decodeWorkbenchEntry,
  type ExecutionPreparation,
  type ProjectEntry,
  type WorkbenchEntry,
} from "../../src/service/contracts/gateway.ts";
import type { ConversationLocation } from "../../src/service/contracts/models.ts";
import { decodeWorkbenchResult } from "../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../src/service-client.ts";
import {
  ContractError,
  ERROR_CODES,
  publicError,
} from "../../src/service-contract.ts";
import { App } from "./App";
import { browserClient } from "./client/browser";
import type { PreparationProgress } from "./client/conversation-send";
import {
  bindFolderDraft,
  emptyFolderDraft,
  type FolderDraft,
  readFolderDraft,
  rememberFolderDraft,
} from "./client/folder-draft";
import {
  projectReadable,
  rememberProject,
  restorableProject,
} from "./client/last-project";
import { readModelPreview } from "./client/model-preview";
import {
  prepareDirectoryExecution,
  selectActivity,
  selectDirectory,
} from "./client/project-entry";
import { currentProject } from "./client/project-route";
import { errorCode, readJson as read } from "./client/service";
import { useActivity } from "./client/use-activity";
import type { ActivityListProps } from "./components/workspace/ActivityList";
import { FolderSetup } from "./components/workspace/FolderSetup";
import { ProjectPicker } from "./components/workspace/ProjectPicker";
import { RecoveryNotices } from "./components/workspace/RecoveryNotices";
import { ServiceDialog } from "./components/workspace/ServiceDialog";
import { describeError, useT } from "./i18n/locale";

/** Entry discovery and directory selection never start execution. Only an
 * explicit Send or plan-validation action prepares a project owner.
 * Scope changes remount the thin project client, detaching rather than stopping.
 * An unselected first entry returns to the last project without requiring a running execution owner. */
export function Workbench() {
  const { t } = useT();
  const [entry, setEntry] = useState<WorkbenchEntry | null>();
  const [folderDraft, setFolderDraft] = useState(readFolderDraft);
  const [initialDraft, setInitialDraft] = useState<
    FolderDraft & { conversationId: string }
  >();
  const draftApplied = useCallback((id: string) => {
    setInitialDraft((draft) =>
      draft?.conversationId === id ? undefined : draft,
    );
  }, []);
  const [selected, setSelected] = useState(currentProject);
  const previewModels = useCallback(
    (signal?: AbortSignal) => readModelPreview(selected ?? undefined, signal),
    [selected],
  );
  const [picker, setPicker] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [restore, setRestore] = useState<{
    status: "checking" | "unavailable";
    path: string;
  } | null>(null);
  const epochChanged = useCallback(() => refresh((n) => n + 1), []);
  const activities = useActivity(entry?.epoch, epochChanged);
  const navigation = useRef<AbortController | null>(null);
  useEffect(() => () => navigation.current?.abort(), []);
  const hashes = useRef(new Map<string, string>());
  const firstEntry = useRef(!selected);
  const restoring = useRef<AbortController | null>(null);
  // Clears a pending check; an unavailable-history notice stays until navigation.
  const cancelRestore = useCallback(() => {
    if (!restoring.current) return;
    restoring.current.abort();
    restoring.current = null;
    setRestore(null);
  }, []);
  useEffect(() => {
    void revision;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/workbench/v1", {
          credentials: "same-origin",
          redirect: "error",
          cache: "no-store",
          signal: abort.signal,
        });
        const value = await read(response);
        // A direct legacy project owner has no gateway route. No fallback for an
        // authentication, network or corrupt-entry failure.
        if (response.status === 400 && errorCode(value) === "invalid")
          setEntry(null);
        else if (!response.ok) setError(errorCode(value));
        else {
          setEntry(decodeWorkbenchEntry(value));
          setError("");
        }
      } catch {
        if (!abort.signal.aborted) setError("unavailable");
      }
    })();
    return () => abort.abort();
  }, [revision]);
  useEffect(() => {
    const changed = () => {
      navigation.current?.abort();
      cancelRestore();
      setRestore(null);
      setSelected(currentProject());
    };
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, [cancelRestore]);
  useEffect(() => {
    if (!entry || !firstEntry.current) return;
    firstEntry.current = false;
    // An unfinished first-use draft needs an explicit destination, not the last folder.
    if (folderDraft.text || folderDraft.model) return;
    const project = restorableProject(entry);
    if (!project) return;
    const abort = new AbortController();
    restoring.current = abort;
    setRestore({ status: "checking", path: project.cwd });
    void projectReadable(project.id, abort.signal).then((readable) => {
      // Any explicit navigation, Open or folder choice meanwhile wins.
      if (abort.signal.aborted) return;
      restoring.current = null;
      if (!readable) {
        setRestore({ status: "unavailable", path: project.cwd });
        return;
      }
      history.replaceState(null, "", `/app?project=${project.id}`);
      setRestore(null);
      setSelected(project.id);
    });
  }, [entry, folderDraft]);
  const navigate = useCallback(
    (project: ProjectEntry, activity?: Activity) => {
      cancelRestore();
      setRestore(null);
      if (
        selected &&
        history.state?.cadenceCwd ===
          entry?.projects.find((p) => p.id === selected)?.cwd
      )
        hashes.current.set(selected, window.location.hash);
      const newConversation = crypto.randomUUID();
      // Only an explicit folder choice from setup owns this draft. Activity
      // links and automatic restoration must never inject it into a session.
      const handoff =
        !entry?.projects.some((p) => p.id === selected) &&
        !activity &&
        !!(folderDraft.text || folderDraft.model);
      if (handoff) {
        setInitialDraft(
          bindFolderDraft(project.path, newConversation, folderDraft),
        );
        setFolderDraft(emptyFolderDraft());
      } else setInitialDraft(undefined);
      history.pushState(
        {
          cadenceCwd: activity?.cwd ?? project.cwd,
          cadenceConversationId: activity?.sessionId,
        },
        "",
        `/app?project=${project.id}${activity?.sessionId ? `#chat=${encodeURIComponent(activity.sessionId)}&activity=1${activity.leaf ? `&leaf=${encodeURIComponent(activity.leaf)}` : ""}` : handoff ? `#chat=${newConversation}` : (hashes.current.get(project.id) ?? `#chat=${newConversation}`)}`,
      );
      setSelected(project.id);
      setPicker(null);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    [selected, cancelRestore, entry, folderDraft],
  );
  const open = useCallback(
    async (path: string) => {
      navigation.current?.abort();
      const abort = new AbortController();
      navigation.current = abort;
      const selected = await selectDirectory(path, abort.signal);
      if (abort.signal.aborted) return;
      setEntry(selected.entry);
      navigate(selected.project);
    },
    [navigate],
  );
  const discovery: ActivityListProps | undefined = entry
    ? {
        value: activities.value,
        error: activities.error,
        opening: !!opening,
        project: entry.projects.find((p) => p.id === selected)?.path,
        onOpen: (path, activity) => {
          navigation.current?.abort();
          cancelRestore();
          const abort = new AbortController();
          navigation.current = abort;
          setOpening(activity.cwd);
          setOpenError("");
          void selectActivity(path, activity, abort.signal)
            .then((selected) => {
              if (abort.signal.aborted) return;
              setEntry(selected.entry);
              navigate(selected.project, activity);
            })
            .catch((error: unknown) => {
              if (!abort.signal.aborted)
                setOpenError(
                  describeError(
                    t,
                    error instanceof Error ? error.message : "unavailable",
                  ),
                );
            })
            .finally(() => {
              if (navigation.current === abort) setOpening(null);
            });
        },
      }
    : undefined;
  const prepareExecution = async (
    purpose: ExecutionPreparation,
    signal: AbortSignal,
    location?: ConversationLocation,
    progress?: PreparationProgress,
  ) => {
    const selectedProject = entry?.projects.find((p) => p.id === selected);
    if (!selectedProject) throw new Error("unavailable");
    const ready = await prepareDirectoryExecution(
      selectedProject,
      purpose,
      signal,
      location,
      progress,
    );
    if (signal.aborted) throw new Error("stale");
    setEntry(ready.entry);
    return ready.project.epoch as string;
  };
  const directories = useMemo<Pick<ServiceClient, "workbenchRead">>(
    () => ({
      async workbenchRead(request, signal) {
        try {
          if (request.kind !== "directories")
            throw new ContractError("invalid");
          const response = await fetch(
            `/workbench/v1/directories?path=${encodeURIComponent(request.path)}`,
            { credentials: "same-origin", redirect: "error", signal },
          );
          const value = await read(response);
          // Keep a refusal's public code so the picker can say why (missing,
          // refused, unreadable); anything unrecognised stays unavailable.
          if (!response.ok) {
            const code = errorCode(value);
            return {
              kind: "error",
              error: publicError(
                ERROR_CODES.find((known) => known === code) ?? "unavailable",
              ),
            };
          }
          return { kind: "ok", value: decodeWorkbenchResult(value) };
        } catch {
          return { kind: "error", error: publicError("unavailable") };
        }
      },
    }),
    [],
  );
  const api = useMemo(
    () => (selected ? browserClient(selected) : undefined),
    [selected],
  );
  const project = entry?.projects.find((p) => p.id === selected);
  useEffect(() => {
    if (project) rememberProject(project.id);
  }, [project]);
  if (entry === null) return <App />;
  const service = entry && serviceOpen && (
    <ServiceDialog
      epoch={entry.epoch}
      csrf={entry.csrf}
      onClose={() => setServiceOpen(false)}
    />
  );
  const openService = () => setServiceOpen(true);
  const folderPicker = entry && picker !== null && (
    <ProjectPicker
      selectOnly
      client={directories}
      current={project?.cwd ?? ""}
      projects={entry.projects.map((p) => ({
        path: p.cwd,
        current: p.id === selected,
      }))}
      initial={picker}
      home={entry.home}
      epoch={entry.epoch}
      onClose={() => setPicker(null)}
      onOpen={open}
    />
  );
  if (entry && project && api)
    return (
      <>
        <App
          key={project.id}
          api={api}
          project={project}
          previewModels={previewModels}
          initialDraft={initialDraft}
          onDraftApplied={draftApplied}
          directoryNamespaces={entry?.projects
            .filter((p) => p.path === project.path)
            .map((p) => p.id)
            .sort()}
          discovery={discovery}
          onPrepareExecution={prepareExecution}
          onChooseFolder={(cwd) => {
            navigation.current?.abort();
            setPicker(cwd ?? project.cwd);
          }}
          onOpenProject={open}
          homeFolder={entry.home}
          projectEntries={entry.projects.map((p) => ({
            path: p.cwd,
            current: p.id === selected,
          }))}
          notices={
            <>
              {openError && <p role="alert">{openError}</p>}
              <RecoveryNotices
                notices={entry.recoveries}
                project={project.path}
              />{" "}
            </>
          }
          onOpenService={openService}
        />
        {service}
        {folderPicker}
      </>
    );
  return (
    <>
      <FolderSetup
        discovery={discovery}
        ready={!!entry}
        previewModels={entry ? previewModels : undefined}
        draft={folderDraft}
        onDraftChange={(draft) => {
          cancelRestore();
          setFolderDraft(draft);
          rememberFolderDraft(draft);
        }}
        restore={restore}
        onRefresh={() => refresh((n) => n + 1)}
        onOpenService={entry ? openService : undefined}
        onChooseFolder={() => {
          cancelRestore();
          setOpenError("");
          navigation.current?.abort();
          setPicker(entry?.home ?? "");
        }}
        notices={
          <>
            {openError && (
              <p role="alert" className="banner-notice">
                {openError}
              </p>
            )}
            {entry && <RecoveryNotices notices={entry.recoveries} />}
            {error && (
              <p role="alert" className="banner-notice">
                {error}{" "}
                <button type="button" onClick={() => refresh((n) => n + 1)}>
                  {t("Reload observation")}
                </button>
              </p>
            )}
            {selected && !project && entry && (
              <p role="alert" className="banner-notice">
                {t(
                  "This folder is unavailable. Choose another folder; nothing was moved or recreated.",
                )}
              </p>
            )}
          </>
        }
      />
      {folderPicker}
      {service}
    </>
  );
}
