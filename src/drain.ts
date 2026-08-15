// Unified idempotent drain (P-006). One drain step closes admission, erases
// retained diffs and Worker metadata, and removes only the dispatcher
// activation. No private files are created; child usage is returned exactly
// once by the child-session dispose path.
import type { Activation } from "./activation.ts";
import type { ResultStore } from "./result-store.ts";
import type { WorkerRegistry } from "./worker.ts";

export interface DrainTargets {
  results: ResultStore;
  registry: WorkerRegistry;
  activation: Activation;
}

/** Close admission, erase retained diffs and Worker metadata, deactivate. */
export function drainStage(targets: DrainTargets): void {
  targets.results.clear();
  targets.registry.clear();
  targets.activation.drain();
}
