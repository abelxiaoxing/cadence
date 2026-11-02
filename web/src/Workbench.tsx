import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeWorkbenchEntry,
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
import {
  projectReadable,
  rememberProject,
  restorableProject,
} from "./client/last-project";
import { prepareDirectorySend, selectDirectory } from "./client/project-entry";
import { currentProject } from "./client/project-route";
import { errorCode, readJson as read } from "./client/service";
import { ProjectPicker } from "./components/workspace/ProjectPicker";
import { RecoveryNotices } from "./components/workspace/RecoveryNotices";
import { ServiceDialog } from "./components/workspace/ServiceDialog";
import { WorkbenchHome } from "./components/workspace/WorkbenchHome";
import { useT } from "./i18n/locale";

/** Entry discovery and directory selection never start execution. Only the
 * current explicit Send prepares a project owner.
 * Scope changes remount the thin project client, detaching rather than stopping.
 * An unselected first entry returns to the last project without requiring a running execution owner. */
export function Workbench() {
  const { t } = useT();
  const [entry, setEntry] = useState<WorkbenchEntry | null>();
  const [selected, setSelected] = useState(currentProject);
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
  }, [entry]);
  const navigate = useCallback(
    (project: ProjectEntry | null) => {
      cancelRestore();
      setRestore(null);
      if (
        selected &&
        history.state?.cadenceCwd ===
          entry?.projects.find((p) => p.id === selected)?.cwd
      )
        hashes.current.set(selected, window.location.hash);
      history.pushState(
        { cadenceCwd: project?.cwd },
        "",
        project
          ? `/app?project=${project.id}${hashes.current.get(project.id) ?? `#chat=${crypto.randomUUID()}`}`
          : "/app",
      );
      setSelected(project?.id ?? null);
      setPicker(null);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    [selected, cancelRestore, entry],
  );
  const open = useCallback(
    async (path: string) => {
      const selected = await selectDirectory(path);
      setEntry(selected.entry);
      navigate(selected.project);
    },
    [navigate],
  );
  const prepareSend = async (
    signal: AbortSignal,
    location?: ConversationLocation,
  ) => {
    const selectedProject = entry?.projects.find((p) => p.id === selected);
    if (!selectedProject) throw new Error("unavailable");
    const ready = await prepareDirectorySend(selectedProject, signal, location);
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
      current=""
      projects={entry.projects.map((p) => ({
        path: p.cwd,
        current: false,
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
          directoryNamespaces={entry?.projects
            .filter((p) => p.path === project.path)
            .map((p) => p.id)
            .sort()}
          onPrepareSend={prepareSend}
          onChooseFolder={(cwd) => setPicker(cwd ?? project.cwd)}
          onOpenProject={open}
          onWorkbenchHome={() => navigate(null)}
          workbenchHome={entry.home}
          projectEntries={entry.projects.map((p) => ({
            path: p.cwd,
            current: p.id === selected,
          }))}
          notices={
            <RecoveryNotices
              notices={entry.recoveries}
              project={project.path}
            />
          }
          onOpenService={openService}
        />
        {service}
        {folderPicker}
      </>
    );
  return (
    <>
      <WorkbenchHome
        ready={!!entry}
        projects={entry?.projects.map((p) => p.cwd) ?? []}
        restore={restore}
        opening={opening}
        onOpenService={entry ? openService : undefined}
        onOpenFolder={(path) => {
          cancelRestore();
          setOpenError("");
          setPicker(path ?? entry?.home ?? "");
        }}
        onOpenProject={(path) => {
          // One click selects a recent directory without starting execution; a failure
          // names the folder and opens nothing else.
          if (opening) return;
          cancelRestore();
          setOpenError("");
          setOpening(path);
          void open(path)
            .catch((e: unknown) =>
              setOpenError(
                t("{path} could not be opened ({code}).", {
                  path,
                  code: e instanceof Error ? e.message : "unavailable",
                }),
              ),
            )
            .finally(() => setOpening(null));
        }}
      >
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
              "Selected project is unavailable. Choose a project explicitly; no directory was reconstructed.",
            )}
          </p>
        )}
      </WorkbenchHome>
      {folderPicker}
      {service}
    </>
  );
}
