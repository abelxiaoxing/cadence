import { defineConfig } from "vitest/config";
import { shared } from "../vitest.config.ts";

export default defineConfig({
  test: {
    ...shared,
    include: [
      "test/service*.test.ts",
      "test/native-client*.test.ts",
      "test/history*.test.ts",
      "test/worker-capture.test.ts",
    ],
    fileParallelism: false,
  },
});
