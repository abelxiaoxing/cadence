/** Restart or upgrade the Cadence service this workbench runs in. The job runs
 * in its own systemd unit outside the service, so this page only observes it:
 * the old service stops, a new one starts, and the job records its outcome. */
import { useEffect, useState } from "react";
import { FiArrowUpCircle, FiRefreshCw } from "react-icons/fi";
import {
  canUpgrade,
  compareVersions,
  type MaintenanceJob,
  type MaintenanceReason,
  type MaintenanceWorkItem,
  type ReleaseEntry,
  type ServiceEntry,
} from "../../../../src/service/contracts/gateway.ts";
import {
  type MaintenanceResult,
  maintenanceWaitMs,
  observeMaintenance,
  unchanged,
} from "../../client/maintenance-observation";
import { rememberLoginReturn } from "../../client/project-route";
import {
  readRelease,
  readService,
  requestMaintenance,
} from "../../client/service";
import {
  describeError,
  type MessageKey,
  type Translator,
  useT,
} from "../../i18n/locale";
import { ActionDialog } from "../actions/ActionDialog";

const REASONS: Record<MaintenanceReason, MessageKey> = {
  "fetch-failed":
    "The release could not be downloaded; the service kept running.",
  "stop-unconfirmed": "The running service did not confirm its orderly stop.",
  "install-failed": "The package manager could not install the release.",
  "not-ready": "The new service did not become ready.",
  refused: "The service manager refused the operation.",
  interrupted: "The job ended without reporting.",
};

const message = (error: unknown) =>
  error instanceof Error ? error.message : "unavailable";

/** One sentence for a recorded job, in the page's language. */
export function describeJob(t: Translator["t"], job: MaintenanceJob): string {
  if (job.state === "ready")
    return job.action === "restart"
      ? t("Cadence restarted.")
      : job.version === job.from
        ? t("Cadence {version} was already installed.", {
            version: job.from,
          })
        : t("Cadence {version} is running.", { version: job.version ?? "" });
  if (job.state === "rolled-back")
    return t("Cadence {to} did not become ready; {version} was reinstalled.", {
      to: job.to ?? "",
      version: job.version ?? job.from,
    });
  if (job.state === "running") return t("In progress…");
  const reason = t(REASONS[job.reason ?? "refused"]);
  return job.action === "restart"
    ? t("The restart did not finish: {reason}", { reason })
    : t("The upgrade did not finish: {reason}", { reason });
}

/** The same closed route drives the explanation and server/client admission. */
export function installationMessage(
  t: Translator["t"],
  route: ServiceEntry["upgrade"],
): string {
  switch (route) {
    case "npm":
      return t("Installation: npm global.");
    case "bun":
      return t("Installation: Bun global.");
    case "npm-local":
      return t("Installation: npm local.");
    case "bun-local":
      return t("Installation: Bun local.");
    case "pi-npm":
      return t("Installation: Pi-managed (npm).");
    case "pi-bun":
      return t("Installation: Pi-managed (Bun).");
    case "pinned":
      return t(
        "Pi pins this package version; change its package declaration explicitly before upgrading.",
      );
    case "not-writable":
      return t(
        "This account cannot write the installation; update it in a terminal.",
      );
    case "unsupported-install":
      return t(
        "The installation method could not be safely identified; update it using its original installation method.",
      );
  }
}

export function ServiceDialog({
  epoch,
  csrf,
  onClose,
}: {
  epoch: string;
  csrf: string;
  onClose(): void;
}) {
  const { t } = useT();
  const [service, setService] = useState<ServiceEntry>();
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<ReleaseEntry | "checking" | "failed">();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [stopWork, setStopWork] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<MaintenanceJob>();
  const [down, setDown] = useState(false);
  const [result, setResult] = useState<MaintenanceResult>();
  const [revision, observe] = useState(0);
  const work = service?.work ?? null;
  const workUnavailable = service?.unit && !work && (
    <section>
      <p role="alert">
        {t(
          "Cadence could not confirm which work would stop. Refresh the service status to continue.",
        )}
      </p>
      <button type="button" onClick={() => observe((n) => n + 1)}>
        {t("Refresh status")}
      </button>
    </section>
  );

  useEffect(() => {
    void revision;
    const abort = new AbortController();
    readService(abort.signal).then(setService, (e: unknown) => {
      if (!abort.signal.aborted) setError(message(e));
    });
    return () => abort.abort();
  }, [revision]);

  // Polls until the job's outcome is recorded; a result ends the loop.
  useEffect(() => {
    if (!submitted) return;
    return observeMaintenance(
      submitted,
      () => setDown(true),
      (outcome) => {
        if (outcome === "reload") window.location.reload();
        else setResult(outcome);
      },
    );
  }, [submitted]);

  const check = async () => {
    setLatest("checking");
    setError("");
    const release = await readRelease().catch(() => "failed" as const);
    try {
      // Show the current route and work count alongside the final action.
      setService(await readService());
      setLatest(release);
    } catch (e) {
      setError(message(e));
      setLatest("failed");
    }
  };
  const submit = (to: string | null) => {
    if (!service || !work || sending) return;
    setSending(true);
    setError("");
    requestMaintenance(
      {
        action: to === null ? "restart" : "upgrade",
        from: service.version,
        to,
        work: work.digest,
        epoch,
      },
      csrf,
    )
      .then(setSubmitted)
      .catch((e: unknown) => {
        setError(message(e));
        // Work started or stopped since the dialog read it: confirm again.
        setService({ ...service, work: null });
        setStopWork(false);
        observe((n) => n + 1);
      })
      .finally(() => setSending(false));
  };

  if (submitted) {
    const job = submitted;
    const failed =
      result !== undefined &&
      (typeof result === "string" || result.state !== "ready");
    const kept = typeof result === "object" && unchanged(result);
    const unit = service?.unit;
    return (
      <ActionDialog
        title={t("Cadence service")}
        onClose={result ? onClose : undefined}
      >
        <section className="service-progress">
          {result === undefined ? (
            <p role="status">
              <span className="status-dot busy" aria-hidden="true" />
              {job.action === "restart"
                ? down
                  ? t("Cadence is starting again…")
                  : t("Stopping Cadence…")
                : down
                  ? t("Waiting for Cadence {to} to reconnect automatically…", {
                      to: job.to ?? "",
                    })
                  : t("Downloading {to}, then stopping Cadence…", {
                      to: job.to ?? "",
                    })}
            </p>
          ) : (
            <p role={failed ? "alert" : "status"}>
              <span
                className={`status-dot ${failed ? "error" : "ok"}`}
                aria-hidden="true"
              />
              {result === "timeout"
                ? t("Could not confirm the result within {minutes} minutes.", {
                    minutes: maintenanceWaitMs[job.action] / 60_000,
                  })
                : result === "access-denied"
                  ? t("Sign-in required")
                  : result === "changed"
                    ? t("The reported result does not match this request.")
                    : describeJob(t, result)}
            </p>
          )}
          {result === undefined ? (
            <p>
              {t(
                "This runs outside the service: closing or reloading the page does not stop it, and running work is stopped in order.",
              )}
            </p>
          ) : kept ? (
            <p>
              {t("The service was not changed; this page stays connected.")}
            </p>
          ) : null}
          {failed && result !== "access-denied" && unit && (
            <p className="service-commands">
              {t("Details in a terminal:")}{" "}
              <code>
                cadence server status
                {unit.scope === "system" ? " --system" : ""}
              </code>{" "}
              <code>
                journalctl {unit.scope === "system" ? "" : "--user "}-u{" "}
                {unit.name.replace(/\.service$/, ".maintenance.service")}
              </code>
            </p>
          )}
        </section>
        {result !== undefined && (
          <footer>
            {kept ? (
              <button type="button" onClick={onClose}>
                {t("Close")}
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  if (result === "access-denied") rememberLoginReturn();
                  window.location.reload();
                }}
              >
                {t(
                  result === "access-denied" ? "Sign in again" : "Reload page",
                )}
              </button>
            )}
          </footer>
        )}
      </ActionDialog>
    );
  }

  if (confirmRestart && service) {
    const items = work?.items ?? [];
    return (
      <ActionDialog
        title={t("Cadence service")}
        onClose={sending ? undefined : onClose}
      >
        <section>
          <h3>{t("Restart Cadence?")}</h3>
          <p>
            {t(
              "The service stops in order and starts again; this page waits for the result.",
            )}
          </p>
          {items.length > 0 && (
            <>
              <WorkToStop items={items} t={t} />
              <label className="service-confirm">
                <input
                  type="checkbox"
                  checked={stopWork}
                  onChange={(event) => setStopWork(event.target.checked)}
                />{" "}
                {t("Stop them and continue")}
              </label>
            </>
          )}
        </section>
        {workUnavailable}
        {error && <p role="alert">{describeError(t, error)}</p>}
        <footer>
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              setConfirmRestart(false);
              setStopWork(false);
              setError("");
            }}
          >
            {t("Back")}
          </button>
          <button
            type="button"
            className={items.length > 0 ? "danger" : "primary"}
            disabled={sending || !work || (items.length > 0 && !stopWork)}
            onClick={() => submit(null)}
          >
            {t("Restart now")}
          </button>
        </footer>
      </ActionDialog>
    );
  }

  const newer =
    service && latest && typeof latest === "object"
      ? compareVersions(latest.version, service.version) > 0
      : false;
  return (
    <ActionDialog
      title={t("Cadence service")}
      onClose={sending ? undefined : onClose}
    >
      {!service ? (
        <p role={error ? "alert" : "status"}>
          {error ? describeError(t, error) : t("Reading the service…")}
        </p>
      ) : (
        <>
          <section className="service-info">
            <h3>Cadence {service.version}</h3>
            <p>{installationMessage(t, service.upgrade)}</p>
            <p>
              {service.unit
                ? t("Runs as {unit} ({scope} systemd service).", {
                    unit: service.unit.name,
                    scope: service.unit.scope,
                  })
                : t(
                    "This Cadence instance was not started by its systemd service, so the page cannot restart or upgrade it. Use cadence server restart in a terminal.",
                  )}
            </p>
            {service.job && (
              <p>
                {t("Last request ({time}): {outcome}", {
                  time: new Date(service.job.at).toLocaleString(),
                  outcome: describeJob(t, service.job),
                })}
              </p>
            )}
          </section>
          {service.unit && (
            <section className="service-info">
              <h3>{t("Updates")}</h3>
              {latest === undefined || latest === "failed" ? (
                <>
                  {latest === "failed" && (
                    <p role="alert">
                      {t(
                        "Update information is unavailable for this installation.",
                      )}
                    </p>
                  )}
                  <button type="button" onClick={check}>
                    {t("Check for updates")}
                  </button>
                </>
              ) : latest === "checking" ? (
                <p role="status">
                  {t("Asking the package registry for the latest version…")}
                </p>
              ) : !newer ? (
                <p>
                  {t("Cadence {version} is the latest version.", {
                    version: service.version,
                  })}
                </p>
              ) : latest.deprecated ? (
                <p>
                  {t("{version} is deprecated on npm and is not offered.", {
                    version: latest.version,
                  })}
                </p>
              ) : !canUpgrade(service.upgrade) ? (
                <p>
                  {service.upgrade === "not-writable"
                    ? t(
                        "{version} is available, but this account cannot write the installation; upgrade it in a terminal.",
                        { version: latest.version },
                      )
                    : t(
                        "{version} is available, but this installation requires a manual update using its original installation method.",
                        { version: latest.version },
                      )}
                </p>
              ) : work ? (
                <UpgradeOffer
                  version={latest.version}
                  work={work.items}
                  sending={sending}
                  onUpgrade={submit}
                  t={t}
                />
              ) : null}
            </section>
          )}
          {workUnavailable}
          {error && <p role="alert">{describeError(t, error)}</p>}
        </>
      )}
      <footer>
        <button
          type="button"
          disabled={!service?.unit || !work || sending || latest === "checking"}
          onClick={() => setConfirmRestart(true)}
        >
          <FiRefreshCw aria-hidden="true" />
          {t("Restart service")}
        </button>
      </footer>
    </ActionDialog>
  );
}

function WorkToStop({
  items,
  t,
}: {
  items: MaintenanceWorkItem[];
  t: Translator["t"];
}) {
  return (
    <>
      <p role="alert">
        {t("{count} running workflows or conversations will be stopped.", {
          count: items.length,
        })}
      </p>
      <ul className="service-work">
        {items.map(({ project, source, id, sessionId }) => (
          <li key={JSON.stringify([project, source, id])}>
            {project} · {t(source === "turn" ? "Owner turn" : "Owner workflow")}{" "}
            <code>{id}</code>
            {sessionId && <> · {t("Conversation {id}", { id: sessionId })}</>}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The version button itself confirms the upgrade, including its orderly Stop. */
export function UpgradeOffer({
  version,
  work,
  sending,
  onUpgrade,
  t,
}: {
  version: string;
  work: MaintenanceWorkItem[];
  sending: boolean;
  onUpgrade(version: string): void;
  t: Translator["t"];
}) {
  return (
    <>
      <p>
        {t(
          "Cadence downloads the update before stopping. If startup fails, it tries to restore the previous version. After a successful upgrade, this page reloads automatically; unsent images must be attached again.",
        )}
      </p>
      {work.length > 0 && <WorkToStop items={work} t={t} />}
      <button
        type="button"
        className={work.length > 0 ? "danger" : "primary"}
        disabled={sending}
        onClick={() => onUpgrade(version)}
      >
        <FiArrowUpCircle aria-hidden="true" />
        {t(
          work.length > 0
            ? "Stop work and upgrade to {version}"
            : "Upgrade to {version}",
          { version },
        )}
      </button>
    </>
  );
}
