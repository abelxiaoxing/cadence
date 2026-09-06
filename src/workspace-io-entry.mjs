import { parentPort, workerData } from "node:worker_threads";
import { ArtifactStore } from "./artifact-store.ts";
import { WorkspaceStore } from "./workspace-store.ts";

const controller = new AbortController();
const flag = new Int32Array(workerData.cancelled);
parentPort.on("message", () => controller.abort(new Error("cancelled")));
const checkCancelled = () => {
  if (Atomics.load(flag, 0)) throw new Error("cancelled");
};
try {
  const artifacts = new ArtifactStore(workerData.artifactRoot);
  const store = new WorkspaceStore(workerData.root, artifacts, {
    checkCancelled,
  });
  let result;
  let revision;
  checkCancelled();
  if (workerData.operation === "captureBaseline") {
    revision = await store.captureBaselineWithGit(
      workerData.args[0],
      controller.signal,
    );
    result = revision;
  } else if (workerData.operation === "materialize") {
    revision = store.getRevision(workerData.args[0]);
    store.materialize(workerData.args[0], workerData.args[1]);
  } else {
    throw new Error("workspace-io-operation-invalid");
  }
  const files = Object.values(revision.entries).filter(
    (entry) => entry.kind === "file",
  );
  parentPort.postMessage({
    ok: true,
    result,
    files: files.length,
    bytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
  });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : "workspace-io-failed",
    files: 0,
    bytes: 0,
  });
} finally {
  parentPort.close();
}
