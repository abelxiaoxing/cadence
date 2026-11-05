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
  type ReleaseEntry,
  type ServiceEntry,
} from "../../../../src/service/contracts/gateway.ts";
import { ContractError } from "../../../../src/service-contract.ts";
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

/** How long the page waits before naming the terminal commands instead. */
const WAIT_MS = { restart: 3 * 60_000, upgrade: 20 * 60_000 };
const POLL_MS = 1000;
const REASONS: Record<MaintenanceReason, MessageKey> = {
  "fetch-failed":
    "The release could not be downloaded; the service kept running.",
  "stop-unconfirmed": "The running service did not confirm its orderly stop.",
  "install-failed": "The package manager could not install the release.",
  "not-ready": "The new service did not become ready.",
  refused: "The service manager refused the operation.",
  interrupted: "The job ended without reporting.",
};
type Choice =
  | { action: "restart"; to: null }
  | { action: "upgrade"; to: string };
/** Recorded outcome, no report in time, or a different version answering. */
type Result = MaintenanceJob | "timeout" | "changed";
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

/** A job that ended before stopping anything leaves this page connected. */
export function unchanged(job: MaintenanceJob): boolean {
  return job.state === "failed"
    ? job.reason === "fetch-failed" || job.reason === "refused"
    : job.state === "ready" &&
        job.action === "upgrade" &&
        job.version === job.from;
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
  const [choice, setChoice] = useState<Choice | null>(null);
  const [stopWork, setStopWork] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<{
    job: MaintenanceJob;
    since: number;
  } | null>(null);
  /** The old service stopped answering. */
  const [down, setDown] = useState(false);
  const [result, setResult] = useState<Result>();
  const [revision, observe] = useState(0);

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
    const { job, since } = submitted;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() - since > WAIT_MS[job.action]) return setResult("timeout");
      try {
        const current = await readService(abort.signal);
        if (current.job?.id === job.id && current.job.state !== "running")
          return setResult(current.job);
      } catch (e) {
        if (abort.signal.aborted) return;
        // It answered, but in a shape this page's build cannot read, or
        // without this route: an older version started instead.
        if (
          e instanceof ContractError ||
          (e instanceof Error && e.message === "invalid")
        )
          return setResult("changed");
        setDown(true);
      }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [submitted]);

  const check = () => {
    setLatest("checking");
    readRelease()
      .then(setLatest, () => setLatest("failed"))
      // The server re-observes the route even when it refuses the query.
      .finally(() => observe((n) => n + 1));
  };
  const submit = (selected: Choice) => {
    if (!service) return;
    setSending(true);
    setError("");
    requestMaintenance(
      {
        action: selected.action,
        from: service.version,
        to: selected.to,
        work: service.work,
        epoch,
      },
      csrf,
    )
      .then((job) => setSubmitted({ job, since: Date.now() }))
      .catch((e: unknown) => {
        setError(message(e));
        // Work started or stopped since the dialog read it: confirm again.
        setStopWork(false);
        observe((n) => n + 1);
      })
      .finally(() => setSending(false));
  };

  if (submitted) {
    const { job } = submitted;
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
                  ? t("Installing {to} and starting Cadence…", {
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
                ? t("Cadence did not report back within {minutes} minutes.", {
                    minutes: WAIT_MS[job.action] / 60_000,
                  })
                : result === "changed"
                  ? t("Cadence answered with a different version.")
                  : describeJob(t, result)}
            </p>
          )}
          <p>
            {result === undefined
              ? t(
                  "This runs outside the service: closing or reloading the page does not stop it, and running work is stopped in order.",
                )
              : kept
                ? t("The service was not changed; this page stays connected.")
                : t("Reload the page to reconnect to the new service.")}
          </p>
          {failed && unit && (
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
                onClick={() => window.location.reload()}
              >
                {t("Reload page")}
              </button>
            )}
          </footer>
        )}
      </ActionDialog>
    );
  }

  if (choice && service) {
    const work = service.work;
    return (
      <ActionDialog title={t("Cadence service")} onClose={onClose}>
        <section>
          <h3>
            {choice.action === "restart"
              ? t("Restart Cadence?")
              : t("Upgrade Cadence {from} to {to}?", {
                  from: service.version,
                  to: choice.to,
                })}
          </h3>
          <p>
            {choice.action === "restart"
              ? t(
                  "The service stops in order and starts again; this page waits and then reloads.",
                )
              : t(
                  "The package manager downloads {to} while Cadence keeps running; then the service stops, {to} is installed and the service starts again. If {to} does not become ready, {from} is reinstalled.",
                  { to: choice.to, from: service.version },
                )}
          </p>
          {work > 0 && (
            <>
              <p role="alert">
                {t(
                  "{count} running workflows or conversations will be stopped.",
                  {
                    count: work,
                  },
                )}
              </p>
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
        {error && <p role="alert">{describeError(t, error)}</p>}
        <footer>
          <button
            type="button"
            onClick={() => {
              setChoice(null);
              setStopWork(false);
              setError("");
            }}
          >
            {t("Back")}
          </button>
          <button
            type="button"
            className={work > 0 ? "danger" : "primary"}
            disabled={sending || (work > 0 && !stopWork)}
            onClick={() => submit(choice)}
          >
            {choice.action === "restart" ? t("Restart now") : t("Upgrade now")}
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
    <ActionDialog title={t("Cadence service")} onClose={onClose}>
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
                    "This workbench was not started by Cadence's systemd service, so the page cannot restart or upgrade it. Use cadence server restart in a terminal.",
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
              ) : (
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    setChoice({ action: "upgrade", to: latest.version })
                  }
                >
                  <FiArrowUpCircle aria-hidden="true" />
                  {t("Upgrade to {version}", { version: latest.version })}
                </button>
              )}
            </section>
          )}
          {error && <p role="alert">{describeError(t, error)}</p>}
        </>
      )}
      <footer>
        <button
          type="button"
          disabled={!service?.unit}
          onClick={() => setChoice({ action: "restart", to: null })}
        >
          <FiRefreshCw aria-hidden="true" />
          {t("Restart service")}
        </button>
      </footer>
    </ActionDialog>
  );
}
