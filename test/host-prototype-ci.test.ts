import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("[HOST-PREP:ci-contract] explicit native lanes and honest unshipped boundary", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  expect(workflow, "[HOST-PREP:ci-contract]").toContain("host-prototype:");
  expect(
    existsSync("docs/host-trusted-preparation.md"),
    "[HOST-PREP:ci-contract]",
  ).toBe(true);
  const job = workflow.slice(workflow.indexOf("  host-prototype:"));
  for (const token of [
    "windows-2022",
    "macos-15-intel",
    "macos-15",
    "arm64",
    "x64",
    "22.13.0",
    "24.13.0",
    "process.arch",
    "process.platform",
    "process.version",
    "build.mjs --output",
    "qualify.mjs --require-native --output",
    "--helper",
    "actions/upload-artifact@v4",
    "if: always()",
    "retention-days: 7",
  ])
    expect(job).toContain(token);
  expect(job).not.toMatch(/continue-on-error|secrets\.|pull_request_target/);
  for (const name of [
    "verify-linux:",
    "openspec-platform-contract:",
    "storage-platform-contract:",
    "implement-isolation-contract:",
  ])
    expect(workflow).toContain(name);
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.files).not.toContain("scripts");
  expect(JSON.stringify(manifest)).not.toContain("host-prototype");
  const docs = readFileSync("docs/host-trusted-preparation.md", "utf8");
  for (const text of [
    "native qualification pending",
    "setsid",
    "not a security sandbox",
    "--require-native",
    "preparation",
  ])
    expect(docs).toContain(text);
  expect(readFileSync("src/windows-job-backend.ts", "utf8")).not.toContain(
    "host-prototype",
  );
});
