/** The workbench's own routes: service observation and the restart or upgrade
 * the browser explicitly confirms. Authentication is the gateway's cookie. */

import { closed, literal } from "../../../src/service/contracts/core.ts";
import {
  decodeMaintenanceJob,
  decodeReleaseEntry,
  decodeServiceEntry,
  type MaintenanceJob,
  type ReleaseEntry,
  type ServiceEntry,
} from "../../../src/service/contracts/gateway.ts";
import { parseWireJson } from "../../../src/service-contract.ts";
import { boundedText } from "../../../src/service-http-client.ts";
import { localBuild } from "./build-identity";

export async function readJson(response: Response): Promise<unknown> {
  return parseWireJson(await boundedText(response, 1024 * 1024), 1024 * 1024);
}
/** The public error code of a refusal; anything else is unavailable. */
export function errorCode(value: unknown): string {
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
async function get<T>(
  path: string,
  decode: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  const value = await readJson(response);
  if (!response.ok) throw new Error(errorCode(value));
  return decode(value);
}
export function readService(signal?: AbortSignal): Promise<ServiceEntry> {
  return get("/workbench/v1/service", decodeServiceEntry, signal);
}
/** Contacts the npm registry; only on an explicit check. */
export function readRelease(signal?: AbortSignal): Promise<ReleaseEntry> {
  return get("/workbench/v1/service/release", decodeReleaseEntry, signal);
}
export interface MaintenanceRequest {
  action: MaintenanceJob["action"];
  /** The version, target and work count the confirmation showed. */
  from: string;
  to: string | null;
  work: number;
  epoch: string;
}
/** One explicit request; never retried, since its response may be lost while
 * the service it restarts is already stopping. */
export async function requestMaintenance(
  request: MaintenanceRequest,
  csrf: string,
): Promise<MaintenanceJob> {
  if (!localBuild) throw new Error("unavailable");
  const response = await fetch("/workbench/v1/service", {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "X-Cadence-CSRF": csrf,
      "X-Cadence-Build": JSON.stringify({ kind: "browser", ...localBuild }),
    },
    body: JSON.stringify(request),
  });
  const value = await readJson(response);
  if (!response.ok) throw new Error(errorCode(value));
  const o = closed(value, ["kind", "job"]);
  literal(o.kind, "service-job");
  return decodeMaintenanceJob(o.job);
}
