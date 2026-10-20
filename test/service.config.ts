import { defineConfig } from "vitest/config";
import base from "../vitest.config.ts";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      "test/service*.test.ts",
      "test/native-client*.test.ts",
      "test/history*.test.ts",
      "test/worker-capture.test.ts",
    ],
    fileParallelism: false,
  },
});
