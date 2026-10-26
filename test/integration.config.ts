import { configDefaults, defineConfig } from "vitest/config";
import base from "../vitest.config.ts";
import { fastTests } from "./fast.config.ts";

// Exact complement of the fast lane, including newly added root tests.
// Preserve the original serial native/SDK/large-history regression behavior.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    exclude: [...(base.test?.exclude ?? configDefaults.exclude), ...fastTests],
    fileParallelism: false,
  },
});
