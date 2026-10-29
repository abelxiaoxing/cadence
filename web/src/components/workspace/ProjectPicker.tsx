/* Adapted from pi-web-ui ProjectPicker/DirectoryBrowser: path input, up/browse
 * navigation and explicit open. MIT (c) 2026 xing-shuyin. No global set_cwd,
 * SSH/profile copying, implicit mkdir, or directory-selection side effect. */
import { useEffect, useRef, useState } from "react";
import { FiArrowUp, FiFolder } from "react-icons/fi";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { useWorkbench } from "../../client/use-workbench";
import { useT } from "../../i18n/locale";
import { ActionDialog } from "../actions/ActionDialog";
export function ProjectPicker({
  client,
  current,
  initial,
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
  epoch: string;
  onClose(): void;
  onOpen?(path: string): Promise<void>;
}) {
  const { t } = useT();
  const [path, setPath] = useState(initial ?? current),
    [draft, setDraft] = useState(initial ?? current);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const page = useWorkbench(client, { kind: "directories", path });
  const listing = page.value?.kind === "directories" ? page.value : undefined;
  const browse = (value: string) => {
    if (busy) return;
    setPath(value);
    setDraft(value);
    setError("");
    page.refresh();
  };
  const canOpen =
    !busy && !!listing && !page.error && !page.loading && draft === path;
  const open = async () => {
    if (!canOpen || !listing) return;
    if (!onOpen && listing.path === current) {
      onClose();
      return;
    }
    setBusy(true);
    setError("");
    if (onOpen) {
      try {
        await onOpen(listing.path);
        if (alive.current) onClose();
      } catch (error) {
        if (alive.current) {
          setError(error instanceof Error ? error.message : "unavailable");
          setBusy(false);
        }
      }
      return;
    }
    if (!client.workbenchCommand) {
      setError("unavailable");
      setBusy(false);
      return;
    }
    const reply = await client.workbenchCommand({
      kind: "open-project",
      commandId: crypto.randomUUID(),
      path: listing.path,
      epoch,
    });
    if (!alive.current) return;
    if (reply.kind === "ok" && reply.value.kind === "project") {
      const target = new URL(reply.value.link);
      if (
        (target.protocol === "http:" &&
          ["127.0.0.1", "[::1]"].includes(target.hostname)) ||
        target.protocol === "https:"
      )
        window.location.assign(target.href);
      else {
        setError("unsupported-context");
        setBusy(false);
      }
    } else {
      setError(reply.kind === "error" ? reply.error.code : "unavailable");
      setBusy(false);
    }
  };
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
                title={project.path}
                aria-current={project.current ? "true" : undefined}
                disabled={busy}
                onClick={() => browse(project.path)}
              >
                <FiFolder aria-hidden="true" />
                <span>{project.path}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <form
        className="cwd-input"
        onSubmit={(event) => {
          event.preventDefault();
          browse(draft);
        }}
      >
        <input
          aria-label={t("Folder path")}
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={busy}>
          {t("Browse")}
        </button>
      </form>
      <div className="cwd-picker-list">
        {listing?.parent && (
          <button
            type="button"
            disabled={busy}
            onClick={() => browse(listing.parent as string)}
          >
            <FiArrowUp />
            {t("Parent folder")}
          </button>
        )}
        {listing?.entries.map((entry) => (
          <button
            type="button"
            key={entry.path}
            disabled={busy}
            onClick={() => browse(entry.path)}
          >
            <FiFolder />
            <span>{entry.name}</span>
          </button>
        ))}
      </div>
      {listing?.limited && (
        <p className="inspector-note">
          {t("Bounded listing; narrow the directory to see more.")}
        </p>
      )}
      {(error || page.error) && (
        <p role="alert">
          {error || page.error}
          {error === "registry-locked" && (
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
      <footer>
        <button
          type="button"
          className="primary"
          disabled={!canOpen}
          onClick={() => void open()}
        >
          {busy ? t("Opening project…") : t("Open this project")}
        </button>
      </footer>
    </ActionDialog>
  );
}
