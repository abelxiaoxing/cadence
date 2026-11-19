import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { abortScope } from "../../src/abort-scope.ts";
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
  rememberedProject,
  rememberProject,
  restorableProject,
} from "./client/last-project";
import { readModelPreview } from "./client/model-preview";
import {
  ObservationRefusal,
  observationRead,
  observationRetryMs,
  refusedAccess,
} from "./client/observation-read";
import { ObservationAccess } from "./client/observer";
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

async function readEntry(signal: AbortSignal) {
  try {
    return await observationRead("/workbench/v1", signal, decodeWorkbenchEntry);
  } catch (error) {
    // A direct legacy owner recognizes no gateway route. Never interpret a
    // timeout, malformed entry or access refusal as permission to switch APIs.
    if (
      error instanceof ObservationRefusal &&
      error.status === 400 &&
      error.message === "invalid"
    )
      return null;
    throw error;
  }
}

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
  const [serviceOpen, setServiceOpen] = useState(false);
  const [reading, setReading] = useState<{
    pending: boolean;
    entryError?: string;
    restoreError?: string;
    restoring?: string;
    missing?: boolean;
  }>({ pending: true });
  const navigation = useRef<AbortController | null>(null);
  const hashes = useRef(new Map<string, string>());
  const restoreAllowed = useRef(
    !selected && !folderDraft.text && !folderDraft.model,
  );
  const [holdingSetup, setHoldingSetup] = useState(false);
  const reader = useRef<AbortController | null>(null);
  const retire = useCallback(() => {
    reader.current?.abort();
    reader.current = null;
  }, []);
  const checkingNewEpoch = useRef(false);
  // A delayed activity callback, picker result or history event cannot undo
  // revocation. Signing in again reloads the page with a new lifetime.
  const refusal = useRef<string>(undefined);
  const selectedAccess = useRef<{
    selected: string | null;
    access: ObservationAccess;
  }>(null);
  if (
    !selectedAccess.current ||
    (!refusal.current && selectedAccess.current.selected !== selected)
  )
    selectedAccess.current = { selected, access: new ObservationAccess() };
  const { access } = selectedAccess.current;
  const refuseEntry = useCallback(
    (code: string, restoring?: string) => {
      if (refusal.current) return;
      refusal.current = code;
      retire();
      navigation.current?.abort();
      selectedAccess.current?.access.refuse("entry", code);
      setReading({
        pending: false,
        entryError: restoring ? undefined : code,
        restoreError: restoring ? code : undefined,
        restoring,
      });
    },
    [retire],
  );
  const refreshEntry = useCallback(() => {
    if (refusal.current) return;
    retire();
    const abort = new AbortController();
    reader.current = abort;
    let timer: ReturnType<typeof setTimeout>;
    abort.signal.addEventListener("abort", () => clearTimeout(timer), {
      once: true,
    });
    const load = async () => {
      if (abort.signal.aborted) return;
      setReading((previous) => ({
        ...previous,
        restoring: undefined,
        pending: true,
      }));
      let restoring: string | undefined;
      try {
        const next = await readEntry(abort.signal);
        if (abort.signal.aborted) return;
        checkingNewEpoch.current = false;
        setEntry(next);
        const last =
          restoreAllowed.current && next ? restorableProject(next) : undefined;
        if (last) {
          restoring = last.cwd;
          setReading((previous) => ({
            ...previous,
            entryError: undefined,
            restoring,
            pending: true,
          }));
          const readable = await projectReadable(last.id, abort.signal);
          if (abort.signal.aborted) return;
          if (!readable) throw new Error("unavailable");
          restoreAllowed.current = false;
          history.replaceState(null, "", `/app?project=${last.id}`);
          setSelected(last.id);
        }
        setReading({
          pending: false,
          missing: !!(
            next &&
            restoreAllowed.current &&
            rememberedProject() &&
            !last
          ),
        });
        reader.current = null;
      } catch (error) {
        if (abort.signal.aborted) return;
        const code = error instanceof Error ? error.message : "unavailable";
        if (refusedAccess(code)) return refuseEntry(code, restoring);
        setReading({
          pending: false,
          entryError: restoring ? undefined : code,
          restoreError: restoring ? code : undefined,
          restoring,
        });
        timer = setTimeout(load, observationRetryMs);
      }
    };
    void load();
  }, [retire, refuseEntry]);
  const revoked =
    refusedAccess(reading.entryError) || refusedAccess(reading.restoreError);
  // Several activity polls can report the same mismatch while entry headers or
  // body are stuck. Retire the former epoch once; don't starve its replacement.
  const invalidateEntry = useCallback(
    (code?: string) => {
      if (code && refusedAccess(code)) return refuseEntry(code);
      if (checkingNewEpoch.current) return;
      checkingNewEpoch.current = true;
      refreshEntry();
    },
    [refreshEntry, refuseEntry],
  );
  const activities = useActivity(
    revoked ? undefined : entry?.epoch,
    invalidateEntry,
  );
  useEffect(() => {
    refreshEntry();
    const changed = () => {
      navigation.current?.abort();
      restoreAllowed.current = false;
      setHoldingSetup(false);
      setSelected(currentProject());
      refreshEntry();
    };
    const hashChanged = () => {
      // A hash-only navigation can also supersede automatic return. If the
      // browser already reported popstate, changed() disarmed restoration.
      if (restoreAllowed.current && reader.current) changed();
    };
    window.addEventListener("hashchange", hashChanged);
    window.addEventListener("popstate", changed);
    return () => {
      window.removeEventListener("hashchange", hashChanged);
      window.removeEventListener("popstate", changed);
      retire();
      navigation.current?.abort();
    };
  }, [refreshEntry, retire]);
  // In setup, a draft or explicit destination beats either automatic return
  // or late discovery of a deep link's project. A fresh entry can enable the
  // picker, but must not take this composer away while the user is typing.
  const claimSetup = () => {
    restoreAllowed.current = false;
    setHoldingSetup(true);
    if (revoked || holdingSetup) return;
    if (entry && reading.restoring) {
      retire();
      setReading({ pending: false });
    } else if (reader.current) refreshEntry();
  };
  const adoptEntry = useCallback(
    (next: WorkbenchEntry) => {
      if (refusal.current) throw new Error(refusal.current);
      retire();
      checkingNewEpoch.current = false;
      setReading({ pending: false });
      setEntry(next);
    },
    [retire],
  );
  const navigate = useCallback(
    (project: ProjectEntry, activity?: Activity) => {
      restoreAllowed.current = false;
      setHoldingSetup(false);
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
        (holdingSetup || !entry?.projects.some((p) => p.id === selected)) &&
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
      // App also listens for hash changes when the chosen project stays mounted.
      window.dispatchEvent(new Event("hashchange"));
    },
    [selected, holdingSetup, entry, folderDraft],
  );
  const open = useCallback(
    async (path: string) => {
      if (refusal.current) throw new Error(refusal.current);
      navigation.current?.abort();
      const abort = new AbortController();
      navigation.current = abort;
      const selected = await selectDirectory(path, abort.signal);
      if (abort.signal.aborted) return;
      adoptEntry(selected.entry);
      navigate(selected.project);
    },
    [navigate, adoptEntry],
  );
  const discovery: ActivityListProps | undefined =
    entry && !revoked
      ? {
          value: activities.value,
          error: activities.error,
          opening: !!opening,
          project: entry.projects.find((p) => p.id === selected)?.path,
          onOpen: (path, activity) => {
            navigation.current?.abort();
            if (!project) claimSetup();
            const abort = new AbortController();
            navigation.current = abort;
            setOpening(activity.cwd);
            setOpenError("");
            void selectActivity(path, activity, abort.signal)
              .then((selected) => {
                if (abort.signal.aborted) return;
                adoptEntry(selected.entry);
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
    access.check();
    if (refusal.current) throw new Error(refusal.current);
    const selectedProject = entry?.projects.find((p) => p.id === selected);
    if (!selectedProject) throw new Error("unavailable");
    const wait = abortScope([signal, access.signal]);
    try {
      const ready = await prepareDirectoryExecution(
        selectedProject,
        purpose,
        wait.signal,
        location,
        progress,
      );
      access.check();
      if (wait.signal.aborted || selectedAccess.current?.access !== access)
        throw new Error("stale");
      adoptEntry(ready.entry);
      return ready.project.epoch as string;
    } finally {
      wait.dispose();
    }
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
  const entryEpoch = entry?.epoch;
  const api = useMemo(() => {
    // A remounted entry must not share its transport/CSRF with a detach
    // still settling for the previous authenticated entry.
    void entryEpoch;
    return selected ? browserClient(selected) : undefined;
  }, [selected, entryEpoch]);
  const project = holdingSetup
    ? undefined
    : entry?.projects.find((p) => p.id === selected);
  useEffect(() => {
    if (project) rememberProject(project.id);
  }, [project]);
  const entryObservation = {
    pending: reading.pending,
    error: reading.entryError ?? reading.restoreError,
    refresh: refreshEntry,
  };
  if (entry === null)
    return <App entryObservation={entryObservation} projectAccess={access} />;
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
          key={`${entry.epoch}:${project.id}`}
          entryObservation={entryObservation}
          projectAccess={access}
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
            if (reader.current && !revoked) refreshEntry();
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
        ready={!!entry && !revoked}
        previewModels={entry && !revoked ? previewModels : undefined}
        draft={folderDraft}
        onDraftChange={(draft) => {
          claimSetup();
          setFolderDraft(draft);
          rememberFolderDraft(draft);
        }}
        restoring={reading.restoring}
        missing={
          !reading.pending &&
          !reading.entryError &&
          !reading.restoreError &&
          (reading.missing ||
            !!(!holdingSetup && selected && !project && entry))
        }
        pending={reading.pending}
        entryError={reading.entryError}
        restoreError={reading.restoreError}
        onRefresh={refreshEntry}
        onOpenService={entry ? openService : undefined}
        onChooseFolder={() => {
          claimSetup();
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
          </>
        }
      />
      {folderPicker}
      {service}
    </>
  );
}
