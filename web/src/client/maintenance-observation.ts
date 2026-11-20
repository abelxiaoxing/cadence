import {
  decodeMaintenanceJob,
  decodeVersion,
  type MaintenanceJob,
} from "../../../src/service/contracts/gateway.ts";
import { ContractError } from "../../../src/service-contract.ts";
import { ObservationRefusal, observationRead } from "./observation-read";

export const maintenanceWaitMs = { restart: 3 * 60_000, upgrade: 20 * 60_000 };
const pollMs = 1000;
export type MaintenanceResult =
  | MaintenanceJob
  | "changed"
  | "timeout"
  | "access-denied";

/** This read spans two installations. Decode only the observation, not the
 * other version's installation method or work-to-stop confirmation fields. */
function readStatus(signal: AbortSignal) {
  return observationRead("/workbench/v1/service", signal, (value) => {
    if (
      !value ||
      typeof value !== "object" ||
      !("kind" in value) ||
      value.kind !== "service" ||
      !("version" in value) ||
      !("job" in value)
    )
      throw new ContractError("invalid");
    return {
      version: decodeVersion(value.version),
      job: value.job === null ? null : decodeMaintenanceJob(value.job),
    };
  });
}

/** A job that ended before stopping anything leaves this page connected. */
export function unchanged(job: MaintenanceJob): boolean {
  return job.state === "failed"
    ? job.reason === "fetch-failed" || job.reason === "refused"
    : job.state === "ready" &&
        job.action === "upgrade" &&
        job.version === job.from;
}

export function maintenanceOutcome(
  submitted: MaintenanceJob,
  current: Awaited<ReturnType<typeof readStatus>>,
): MaintenanceResult | "reload" | undefined {
  const job = current.job;
  if (job?.id !== submitted.id || job.state === "running") return;
  if (
    job.action !== submitted.action ||
    job.from !== submitted.from ||
    job.to !== submitted.to
  )
    return "changed";
  if (job.action === "restart" || job.state !== "ready" || unchanged(job))
    return job;
  if (job.version !== submitted.to) return "changed";
  // A ready record can arrive before a request reaches the new instance.
  if (current.version === submitted.to) return "reload";
}

/** Follow only this page's acknowledged request. An unreadable response
 * during replacement (e.g. a proxy's 502 HTML) proves no job outcome. */
export function observeMaintenance(
  submitted: MaintenanceJob,
  onUnavailable: () => void,
  onResult: (result: MaintenanceResult | "reload") => void,
) {
  const abort = new AbortController();
  const deadline = setTimeout(
    () => finish("timeout"),
    maintenanceWaitMs[submitted.action],
  );
  let timer = setTimeout(poll, pollMs);
  function stop() {
    clearTimeout(deadline);
    clearTimeout(timer);
    abort.abort();
  }
  function finish(result: MaintenanceResult | "reload") {
    stop();
    onResult(result);
  }
  async function poll() {
    let outcome: ReturnType<typeof maintenanceOutcome>;
    try {
      outcome = maintenanceOutcome(submitted, await readStatus(abort.signal));
    } catch (error) {
      if (abort.signal.aborted) return;
      if (
        error instanceof ObservationRefusal &&
        (error.status === 401 || error.status === 403)
      )
        return finish("access-denied");
      onUnavailable();
    }
    if (abort.signal.aborted) return;
    if (outcome !== undefined) return finish(outcome);
    timer = setTimeout(poll, pollMs);
  }
  return stop;
}
