/** Recover only the readonly entry GET. Selection, preparation and Send never
 * participate in this retry lifetime. */
import { abortScope } from "../../../src/abort-scope.ts";
import {
  decodeWorkbenchEntry,
  type WorkbenchEntry,
} from "../../../src/service/contracts/gateway.ts";
import { ContractError } from "../../../src/service-contract.ts";
import { errorCode, readJson } from "./service";

export type EntryIssue =
  | "reconnecting"
  | "unauthenticated"
  | "forbidden"
  | "invalid";
export function observeWorkbenchEntry(
  ready: (entry: WorkbenchEntry | null) => void,
  issue: (reason: EntryIssue) => void,
) {
  const lifetime = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting = false;
  let delay = 1000;
  const load = async () => {
    clearTimeout(timer);
    waiting = false;
    const attempt = abortScope([lifetime.signal], 12000);
    try {
      const response = await fetch("/workbench/v1", {
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: attempt.signal,
      });
      if (lifetime.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        void response.body?.cancel().catch(() => {});
        issue(response.status === 401 ? "unauthenticated" : "forbidden");
        return;
      }
      if (
        response.status >= 500 ||
        response.status === 429 ||
        response.status === 408
      ) {
        void response.body?.cancel().catch(() => {});
        throw new Error("transient entry failure");
      }
      const value = await readJson(response);
      if (lifetime.signal.aborted) return;
      if (attempt.signal.aborted) throw new Error();
      if (response.ok) {
        ready(decodeWorkbenchEntry(value));
      } else if (response.status === 400 && errorCode(value) === "invalid") {
        ready(null); // direct project owner, not a gateway
      } else if (
        ["unavailable", "capacity", "stale"].includes(errorCode(value))
      )
        throw new Error();
      else issue("invalid");
    } catch (error) {
      if (lifetime.signal.aborted) return;
      if (error instanceof ContractError && !attempt.signal.aborted) {
        issue("invalid");
        return;
      }
      issue("reconnecting");
      waiting = true;
      timer = setTimeout(load, delay);
      delay = Math.min(delay * 2, 15000);
    } finally {
      attempt.dispose();
    }
  };
  const online = () => {
    if (waiting) void load();
  };
  window.addEventListener("online", online);
  void load();
  return () => {
    window.removeEventListener("online", online);
    lifetime.abort();
    clearTimeout(timer);
  };
}
