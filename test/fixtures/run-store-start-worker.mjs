import { parentPort, workerData } from "node:worker_threads";
import { RunStore } from "../../src/run-store.ts";

if (!parentPort) throw new Error("worker-parent-unavailable");

const store = RunStore.open(workerData.stateRoot);
parentPort.postMessage("ready");
parentPort.once("message", () => {
  try {
    const run = store.startRun({
      stage: "abel-design",
      provisionalKey: workerData.provisionalKey,
      operationId: workerData.operationId,
    });
    parentPort.postMessage({ ok: true, runId: run.runId });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      code: error instanceof Error ? error.message : "unknown",
    });
  } finally {
    store.close();
  }
});
