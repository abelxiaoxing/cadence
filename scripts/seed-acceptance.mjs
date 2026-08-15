#!/usr/bin/env bun
import { execFileSync } from "node:child_process";

const cwd = new URL("..", import.meta.url).pathname;
const expectNotReady = process.argv.includes("--expect-not-ready");
const files = [
  "test/child-session.integration.test.ts",
  "test/patch.integration.test.ts",
  "test/usage.property.test.ts",
];

try {
  execFileSync("bun", ["run", "test:target", ...files], {
    cwd,
    stdio: "inherit",
  });
  if (expectNotReady) {
    console.error(
      "seed-acceptance: expected not_ready but target verification passed",
    );
    process.exit(1);
  }
  execFileSync("bun", ["run", "check"], { cwd, stdio: "inherit" });
  console.log(
    "seed-acceptance: real child/apply path accepted in a fresh process",
  );
} catch (error) {
  if (expectNotReady) {
    console.log("seed-acceptance: not_ready confirmed");
    process.exit(0);
  }
  throw error;
}
