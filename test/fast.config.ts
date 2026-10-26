import { defineConfig } from "vitest/config";
import { shared } from "../vitest.config.ts";

// Reviewed short regressions only. New root tests stay in the integration lane
// until explicitly promoted here; cached timing never changes test selection.
export const fastTests = [
  "test/config-context7.test.mjs",
  "test/git-commit.test.mjs",
  "test/grok-search.test.mjs",
  "test/independence.test.ts",
  "test/install-config.test.ts",
  "test/lightweight-shell.test.ts",
  "test/lightweight-store-controller.test.ts",
  "test/native-history.test.ts",
  "test/package-audit.test.mjs",
  "test/package-contract.test.mjs",
  "test/scheduler-diagnostics.test.ts",
  "test/scheduler-io-diagnostics.test.ts",
  "test/service-auth-network.test.ts",
  "test/service-check-recording.test.ts",
  "test/service-contract.test.ts",
  "test/service-core-review.test.ts",
  "test/service-history-blocker-repair.test.ts",
  "test/service-history-graph-boundary-review.test.ts",
  "test/service-history-graph-boundary.test.ts",
  "test/service-history-list-contract.test.ts",
  "test/service-history-metadata-cost.test.ts",
  "test/service-history-progress-review.test.ts",
  "test/service-history-progress.test.ts",
  "test/service-history-proof-http.test.ts",
  "test/service-history-search-scope.test.ts",
  "test/service-model-choice-review.test.ts",
  "test/service-package.test.ts",
  "test/service-private-files.test.ts",
  "test/service-publication-parity-review.test.ts",
  "test/service-scheduler-facts.test.ts",
  "test/startup-card.test.ts",
  "test/traceability-check.test.mjs",
  "test/worker-accounting-observer.test.mjs",
  "test/worker-canonical-budget.test.ts",
];

export default defineConfig({
  test: {
    // No inherited projects: extends merges include arrays and would run these
    // files again in each serial project as well as the entire parallel group.
    ...shared,
    include: fastTests,
    fileParallelism: true,
  },
});
