/* Adapted from pi-web-ui ProjectPicker/DirectoryBrowser: path input, up/browse
 * navigation and explicit open. MIT (c) 2026 xing-shuyin. No global set_cwd,
 * SSH/profile copying, implicit mkdir, or directory-selection side effect.
 * Cadence revision: breadcrumb location, Enter-to-go path entry, a folder
 * filter and a named Open target; a recent project opens on one click. */
import { Fragment, useEffect, useRef, useState } from "react";
import {
  FiArrowUp,
  FiChevronRight,
  FiEdit2,
  FiFolder,
  FiHome,
  FiSearch,
} from "react-icons/fi";
import type { WorkbenchResult } from "../../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { type MessageKey, useT } from "../../i18n/locale";
import { ActionDialog } from "../actions/ActionDialog";

type Listing = Extract<WorkbenchResult, { kind: "files" | "directories" }>;
type Problem = { step: "read" | "open"; code: string };
const readProblems: Readonly<Record<string, MessageKey>> = {
  relative: "Enter a full path, for example ~/project.",
  invalid: "This folder does not exist. Check the path.",
  forbidden:
    "This location cannot be browsed: it belongs to another account, is protected, or is not a plain folder (for example a link).",
  unavailable:
    "This folder could not be read right now; it may lack read permission. Try again.",
};
/** A full service-host path, or `~` for the service account's home. */
const full = (path: string) =>
  /^(?:~(?:[\\/]|$)|[\\/]|[A-Za-z]:[\\/])/.test(path);
/** Clickable ancestors of a canonical path; inside `home` they start below it. */
function crumbs(path: string, home?: string) {
  const sep = path.startsWith("/") ? "/" : "\\";
  const join = (head: string, part: string) =>
    head.endsWith(sep) ? head + part : head + sep + part;
  const inside = !!home && (path === home || path.startsWith(join(home, "")));
  const root = inside
    ? (home as string)
    : (/^(?:\\\\[^\\]+\\[^\\]+|[A-Za-z]:\\|\/)/.exec(path)?.[0] ?? "");
  if (!root) return { inside, trail: [{ name: path, path }] };
  const trail = inside
    ? []
    : [{ name: root === "/" ? "/" : root.replace(/\\$/, ""), path: root }];
  let at = root;
  for (const part of path.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    at = join(at, part);
    trail.push({ name: part, path: at });
  }
  return { inside, trail };
}
export function ProjectPicker({
  client,
  current,
  initial,
  home,
  epoch,
  onClose,
  onOpen,
  projects = [],
}: {
  client: Pick<ServiceClient, "workbenchRead"> &
    Partial<Pick<ServiceClient, "workbenchCommand">>;
  projects?: { path: string; current: boolean }[];
  current: string;
  initial?: string;
  /** The service account's home, when known; the location trail starts there. */
  home?: string;
  epoch: string;
  onClose(): void;
  onOpen?(path: string): Promise<void>;
}) {
  const { t, tx } = useT();
  const [listing, setListing] = useState<Listing>();
  const [draft, setDraft] = useState(initial ?? current),
    [editing, setEditing] = useState(false),
    [filter, setFilter] = useState("");
  // The mount observation is outstanding until it settles: nothing to open yet.
  const [reading, setReading] = useState(true),
    [starting, setStarting] = useState(true),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState<Problem | null>(null);
  const alive = useRef(true),
    reads = useRef<AbortController | undefined>(undefined),
    start = useRef(initial ?? current),
    input = useRef<HTMLInputElement>(null),
    trail = useRef<HTMLElement>(null);
  /** One fresh readonly observation; the latest wins and a failure keeps the
   * previous listing in view. It never opens or replays an Open. */
  const observe = async (path: string): Promise<Listing | undefined> => {
    reads.current?.abort();
    const abort = new AbortController();
    reads.current = abort;
    setReading(true);
    setProblem(null);
    const reply = await client
      .workbenchRead({ kind: "directories", path }, abort.signal)
      .catch(() => undefined);
    if (abort.signal.aborted || !alive.current) return undefined;
    reads.current = undefined;
    setReading(false);
    if (reply?.kind === "ok" && reply.value.kind === "directories") {
      setListing(reply.value);
      setDraft(reply.value.path);
      setEditing(false);
      setFilter("");
      return reply.value;
    }
    setProblem({
      step: "read",
      code: reply?.kind === "error" ? reply.error.code : "unavailable",
    });
    return undefined;
  };
  const first = useRef(observe);
  useEffect(() => {
    alive.current = true;
    void first.current(start.current).then(() => {
      if (alive.current) setStarting(false);
    });
    return () => {
      alive.current = false;
      reads.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  useEffect(() => {
    if (trail.current) trail.current.scrollLeft = trail.current.scrollWidth;
  });
  const navigate = (path: string) => {
    if (!busy) void observe(path);
  };
  const go = () => {
    const path = draft.trim();
    if (busy) return;
    if (full(path)) void observe(path);
    else setProblem({ step: "read", code: "relative" });
  };
  const target = ((editing || !listing) && draft.trim()) || listing?.path || "";
  const canOpen = !busy && !reading && !!target;
  const open = async (path: string) => {
    // A pending read may replace the listing named here; a typed or recent
    // path makes its own observation, which supersedes the pending one.
    if (busy || !path || (reading && path === listing?.path)) return;
    if (path !== listing?.path && !full(path)) {
      setProblem({ step: "read", code: "relative" });
      return;
    }
    setBusy(true);
    setProblem(null);
    // A typed or recent path is observed once, fresh, and only its canonical
    // folder opens; Open never targets a listing other than the one named.
    const folder =
      path === listing?.path ? listing.path : (await observe(path))?.path;
    if (!alive.current) return;
    if (!folder) {
      setBusy(false);
      return;
    }
    if (!onOpen && folder === current) {
      onClose();
      return;
    }
    if (onOpen) {
      try {
        await onOpen(folder);
        if (alive.current) onClose();
      } catch (error) {
        if (alive.current) {
          setProblem({
            step: "open",
            code: error instanceof Error ? error.message : "unavailable",
          });
          setBusy(false);
        }
      }
      return;
    }
    if (!client.workbenchCommand) {
      setProblem({ step: "open", code: "unavailable" });
      setBusy(false);
      return;
    }
    const reply = await client.workbenchCommand({
      kind: "open-project",
      commandId: crypto.randomUUID(),
      path: folder,
      epoch,
    });
    if (!alive.current) return;
    if (reply.kind === "ok" && reply.value.kind === "project") {
      const link = new URL(reply.value.link);
      if (
        (link.protocol === "http:" &&
          ["127.0.0.1", "[::1]"].includes(link.hostname)) ||
        link.protocol === "https:"
      )
        window.location.assign(link.href);
      else {
        setProblem({ step: "open", code: "unsupported-context" });
        setBusy(false);
      }
    } else {
      setProblem({
        step: "open",
        code: reply.kind === "error" ? reply.error.code : "unavailable",
      });
      setBusy(false);
    }
  };
  const location = listing ? crumbs(listing.path, home) : undefined;
  const needle = filter.trim().toLowerCase();
  const shown =
    listing?.entries.filter((entry) =>
      entry.name.toLowerCase().includes(needle),
    ) ?? [];
  const message =
    problem &&
    (problem.step === "read" && readProblems[problem.code]
      ? t(readProblems[problem.code])
      : tx(problem.code));
  return (
    <ActionDialog title={t("Open working folder")} onClose={onClose}>
      <p>
        {t(
          "Choose a folder on the service host. Opening reuses or starts that project's independent service; current work keeps running.",
        )}
      </p>
      {projects.length > 0 && (
        <section className="cwd-recent" aria-label={t("Recent projects")}>
          <h3>{t("Recent projects")}</h3>
          <div className="cwd-recent-list">
            {projects.map((project) => (
              <button
                type="button"
                key={project.path}
                title={t("Open {path}", { path: project.path })}
                aria-current={project.current ? "true" : undefined}
                disabled={busy}
                onClick={() =>
                  project.current ? onClose() : void open(project.path)
                }
              >
                <FiFolder aria-hidden="true" />
                <span>{project.path}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="cwd-location">
        {location && !editing ? (
          <nav
            ref={trail}
            className="cwd-crumbs"
            aria-label={t("Current location")}
          >
            <button
              type="button"
              aria-label={t("Home folder")}
              title={t("Home folder (~)")}
              aria-current={
                home && listing?.path === home ? "location" : undefined
              }
              disabled={busy}
              onClick={() => navigate("~")}
            >
              <FiHome aria-hidden="true" />
              {location.inside && <span aria-hidden="true">~</span>}
            </button>
            {location.trail.map((crumb, index) => (
              <Fragment key={crumb.path}>
                {(index > 0 || location.inside) && (
                  <FiChevronRight
                    aria-hidden="true"
                    className="cwd-crumb-sep"
                  />
                )}
                <button
                  type="button"
                  aria-current={
                    crumb.path === listing?.path ? "location" : undefined
                  }
                  disabled={busy}
                  onClick={() => navigate(crumb.path)}
                >
                  {crumb.name}
                </button>
              </Fragment>
            ))}
          </nav>
        ) : starting ? (
          <div className="cwd-crumbs" />
        ) : (
          <form
            className="cwd-input"
            onSubmit={(event) => {
              event.preventDefault();
              go();
            }}
          >
            <input
              ref={input}
              aria-label={t("Folder path")}
              placeholder={t("Type or paste a path, then press Enter")}
              value={draft}
              disabled={busy}
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="go"
              onChange={(event) => {
                setDraft(event.target.value);
                // A read refusal names the previous attempt, not this text.
                if (problem?.step === "read") setProblem(null);
              }}
              onKeyDown={(event) => {
                // Esc leaves path entry and keeps the dialog open.
                if (event.key !== "Escape" || !listing) return;
                event.preventDefault();
                setEditing(false);
                setDraft(listing.path);
                setProblem(null);
              }}
            />
          </form>
        )}
        {listing && (
          <button
            type="button"
            className="ghost"
            aria-label={t("Edit path")}
            title={t("Edit path")}
            aria-pressed={editing}
            disabled={busy}
            onClick={() => {
              setDraft(listing.path);
              setEditing(!editing);
              setProblem(null);
            }}
          >
            <FiEdit2 aria-hidden="true" />
          </button>
        )}
      </div>
      {listing && (
        <label className="cwd-filter">
          <FiSearch aria-hidden="true" />
          <input
            aria-label={t("Filter folders")}
            placeholder={t("Filter this folder…")}
            value={filter}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      )}
      <div className="cwd-picker-list" aria-busy={reading || undefined}>
        {reading && (
          <p role="status" className="cwd-picker-note">
            {t("Reading folder…")}
          </p>
        )}
        {listing?.parent && (
          <button
            type="button"
            disabled={busy}
            onClick={() => navigate(listing.parent as string)}
          >
            <FiArrowUp />
            {t("Parent folder")}
          </button>
        )}
        {shown.map((entry) => (
          <button
            type="button"
            key={entry.path}
            disabled={busy}
            onClick={() => navigate(entry.path)}
          >
            <FiFolder />
            <span>{entry.name}</span>
          </button>
        ))}
        {listing && !reading && shown.length === 0 && (
          <p className="cwd-picker-note">
            {needle ? t("No matching folders.") : t("No subfolders.")}
          </p>
        )}
      </div>
      {listing?.limited && (
        <p className="inspector-note">
          {t("Bounded listing; narrow the directory to see more.")}
        </p>
      )}
      {message && (
        <p role="alert">
          {message}
          {problem?.code === "registry-locked" && (
            <>
              {" "}
              —{" "}
              {t(
                "The shared registry lock is blocking projects. On the service host, run cadence recover inspect --workspace <project> with the same --state-home, then use recover resolve in a local terminal if eligible. Do not delete lock files manually.",
              )}
            </>
          )}
        </p>
      )}
      <footer className="cwd-footer">
        {target && (
          <p className="cwd-target">
            <span>{t("Will open:")}</span> <code>{target}</code>
          </p>
        )}
        <button
          type="button"
          className="primary"
          disabled={!canOpen}
          onClick={() => void open(target)}
        >
          {busy ? t("Opening folder…") : t("Open this folder")}
        </button>
      </footer>
    </ActionDialog>
  );
}
