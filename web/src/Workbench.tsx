import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeProjectEntry,
  decodeWorkbenchEntry,
  type ProjectEntry,
  type WorkbenchEntry,
} from "../../src/service/contracts/gateway.ts";
import { decodeWorkbenchResult } from "../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../src/service-client.ts";
import {
  ContractError,
  parseWireJson,
  publicError,
} from "../../src/service-contract.ts";
import { boundedText } from "../../src/service-http-client.ts";
import { App } from "./App";
import { browserClient } from "./client/browser";
import { localBuild } from "./client/build-identity";
import { currentProject } from "./client/project-route";
import { ProjectPicker } from "./components/workspace/ProjectPicker";
import { WorkbenchHome } from "./components/workspace/WorkbenchHome";
import { useT } from "./i18n/locale";

async function read(response: Response): Promise<unknown> {
  return parseWireJson(await boundedText(response, 1024 * 1024), 1024 * 1024);
}
function errorCode(value: unknown): string {
  return value &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "error" &&
    "error" in value &&
    value.error &&
    typeof value.error === "object" &&
    "code" in value.error
    ? String(value.error.code)
    : "unavailable";
}
/** Entry discovery is readonly. Only an explicit Open starts/reuses a project.
 * Scope changes remount the thin project client, detaching rather than stopping. */
export function Workbench() {
  const { t } = useT();
  const [entry, setEntry] = useState<WorkbenchEntry | null>();
  const [selected, setSelected] = useState(currentProject);
  const [picker, setPicker] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);
  const hashes = useRef(new Map<string, string>());
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
    const changed = () => setSelected(currentProject());
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  const navigate = useCallback(
    (project: ProjectEntry | null) => {
      if (selected) hashes.current.set(selected, window.location.hash);
      history.pushState(
        null,
        "",
        project
          ? `/app?project=${project.id}${hashes.current.get(project.id) ?? ""}`
          : "/app",
      );
      setSelected(project?.id ?? null);
      setPicker(null);
    },
    [selected],
  );
  const open = useCallback(
    async (path: string) => {
      if (!entry || !localBuild) throw new Error("unavailable");
      const commandId = crypto.randomUUID();
      // No retry, even when the response is lost. A separately explicit Open is
      // permitted; it observes/reuses the independently coordinated project owner.
      const response = await fetch("/workbench/v1/open", {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "X-Cadence-CSRF": entry.csrf,
          "X-Cadence-Build": JSON.stringify({ kind: "browser", ...localBuild }),
        },
        body: JSON.stringify({ commandId, path, epoch: entry.epoch }),
      });
      const value = await read(response);
      if (
        !response.ok ||
        !value ||
        typeof value !== "object" ||
        !("kind" in value) ||
        value.kind !== "project" ||
        !("project" in value)
      )
        throw new Error(errorCode(value));
      const project = decodeProjectEntry(value.project);
      setEntry((previous) =>
        previous
          ? {
              ...previous,
              projects: [
                ...previous.projects.filter((p) => p.id !== project.id),
                project,
              ],
            }
          : previous,
      );
      navigate(project);
    },
    [entry, navigate],
  );
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
          if (!response.ok) throw new ContractError("unavailable");
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
  if (entry === null) return <App />;
  const project = entry?.projects.find((p) => p.id === selected);
  if (entry && project && api)
    return (
      <App
        key={`${project.id}:${project.epoch}`}
        api={api}
        onOpenProject={open}
        onWorkbenchHome={() => navigate(null)}
        projectEntries={entry.projects.map((p) => ({
          path: p.cwd,
          current: p.id === selected,
        }))}
      />
    );
  return (
    <>
      <WorkbenchHome
        ready={!!entry}
        onOpenFolder={() => setPicker(entry?.home ?? "")}
      >
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
      {entry && picker !== null && (
        <ProjectPicker
          client={directories}
          current=""
          projects={entry.projects.map((p) => ({
            path: p.cwd,
            current: false,
          }))}
          initial={picker}
          epoch={entry.epoch}
          onClose={() => setPicker(null)}
          onOpen={open}
        />
      )}
    </>
  );
}
