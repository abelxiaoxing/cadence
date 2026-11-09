import * as pi from "@earendil-works/pi-coding-agent";
import {
  defaultWorkerTools,
  resolveWorkerRuntime,
} from "../../src/worker-model.mjs";

/** Explicit fixture preferences, not production defaults or ambient user files. */
export function fixtureRuntime(
  settings: Parameters<typeof pi.SettingsManager.inMemory>[0] = {},
) {
  const manager = pi.SettingsManager.inMemory({
    defaultTools: ["read", "grep", "find", "ls", "write", "edit", "bash"],
    ...settings,
  });
  return resolveWorkerRuntime(
    manager,
    { provider: "fixture", id: "fixed" },
    defaultWorkerTools(pi, process.cwd()),
  );
}
