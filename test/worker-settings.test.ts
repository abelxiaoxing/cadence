import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pi from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { readWorkerRuntime } from "../src/service/worker-settings.ts";
import {
  decodeWorkerRuntime,
  defaultWorkerTools,
  describeWorkerRuntime,
  resolveWorkerRuntime,
  UNATTENDED_RETRY,
  unattendedRuntime,
} from "../src/worker-model.mjs";
import { canonicalJson } from "../src/worker-public.mjs";

const model = { provider: "fixture", id: "fixed" };
function fixture(global: object = {}, project: object = {}) {
  const root = mkdtempSync(join(tmpdir(), "pi-worker-settings-"));
  const agent = join(root, "agent"),
    cwd = join(root, "project");
  mkdirSync(agent, { mode: 0o700 });
  mkdirSync(join(cwd, ".pi"), { recursive: true, mode: 0o700 });
  const globalPath = join(agent, "settings.json"),
    projectPath = join(cwd, ".pi", "settings.json");
  writeFileSync(globalPath, JSON.stringify(global), { mode: 0o600 });
  writeFileSync(projectPath, JSON.stringify(project), { mode: 0o600 });
  return {
    root,
    agent,
    cwd,
    globalPath,
    projectPath,
    read: () => readWorkerRuntime(cwd, agent, model, pi),
  };
}

it("uses Pi defaults, not Cadence's former seven tools or six-request retry policy", () => {
  const f = fixture();
  const runtime = f.read();
  const defaults = pi.SettingsManager.inMemory();
  expect(runtime.settings.compaction).toEqual(
    defaults.getCompactionSettings(model),
  );
  expect(runtime.settings.retry).toMatchObject(defaults.getRetrySettings());
  expect(runtime.tools.edit).toEqual(
    pi.createCodingTools(f.cwd).map((tool) => tool.name),
  );
  expect(runtime.tools.readonly).toEqual(
    pi.createReadOnlyTools(f.cwd).map((tool) => tool.name),
  );
  expect(runtime.settings.httpIdleTimeoutMs).toBe(0);
  expect(runtime.settings.retry.provider.maxRetries).toBe(0);
  expect(runtime.settings.cacheWarming).toBe("off");
});

it("Pi merges trusted project settings and resolves each selected-model compaction override", () => {
  const global = {
    defaultProjectTrust: "always",
    compaction: {
      enabled: true,
      reserveTokens: 5000,
      keepRecentTokens: 6000,
      modelOverrides: { "fixture/fixed": { reserveTokens: 7000 } },
    },
    defaultTools: ["read", "bash", "write", "edit"],
    retry: {
      maxRetries: 9,
      baseDelayMs: 12,
      maxAgentDelayMs: 500,
      provider: { maxRetries: 4, timeoutMs: 22000 },
    },
  };
  const project = {
    compaction: {
      enabled: false,
      reserveTokens: 8000,
      modelOverrides: { "fixture/fixed": { keepRecentTokens: 9000 } },
    },
    defaultTools: ["-bash", "+powershell", "+grep"],
    httpIdleTimeoutMs: 45000,
  };
  const f = fixture(global, project);
  const original = [readFileSync(f.globalPath), readFileSync(f.projectPath)];
  const actual = f.read();
  const expected = pi.SettingsManager.fromStorage({
    withLock(scope, use) {
      use(JSON.stringify(scope === "global" ? global : project));
    },
  });
  expect(actual.settings.compaction).toEqual(
    expected.getCompactionSettings(model),
  );
  expect(actual.settings.compaction).toEqual({
    enabled: false,
    reserveTokens: 7000,
    keepRecentTokens: 9000,
  });
  expect(actual.tools.edit).toEqual(expected.getDefaultTools());
  expect(actual.tools.readonly).toEqual(["read", "grep"]);
  expect(actual.settings.retry.maxRetries).toBe(9);
  expect(actual.settings.retry.provider).toMatchObject({
    maxRetries: 0,
    timeoutMs: 22000,
  });
  expect(actual.settings.httpIdleTimeoutMs).toBe(45000);
  expect([readFileSync(f.globalPath), readFileSync(f.projectPath)]).toEqual(
    original,
  );
  expect(readdirSync(f.agent)).toEqual(["settings.json"]);
});

it("saved Pi trust, including the closest denial, wins over defaultProjectTrust", () => {
  const f = fixture(
    { defaultProjectTrust: "always" },
    { compaction: { enabled: false } },
  );
  const trust = join(f.agent, "trust.json");
  writeFileSync(trust, JSON.stringify({ [f.root]: true, [f.cwd]: false }), {
    mode: 0o600,
  });
  const bytes = readFileSync(trust);
  expect(f.read().projectTrusted).toBe(false);
  expect(f.read().settings.compaction.enabled).toBe(true);
  expect(readFileSync(trust)).toEqual(bytes);
  expect(readdirSync(f.agent).sort()).toEqual(["settings.json", "trust.json"]);
  writeFileSync(trust, JSON.stringify({ [f.root]: true }));
  expect(f.read().settings.compaction.enabled).toBe(false);
});

it("ask/untrusted skips project settings rather than borrowing terminal consent or reading invalid project data", () => {
  const f = fixture({ compaction: { reserveTokens: 1234 } });
  writeFileSync(f.projectPath, "{broken project settings");
  expect(f.read().projectTrusted).toBe(false);
  expect(f.read().settings.compaction.reserveTokens).toBe(1234);
});

it("invalid selected settings fail without exposing values or rewriting files", () => {
  for (const body of [
    "{private-canary",
    "",
    "[]",
    "null",
    JSON.stringify({ compaction: { reserveTokens: "private-canary" } }),
    JSON.stringify({ retry: { maxRetries: -1 } }),
  ]) {
    const f = fixture();
    writeFileSync(f.globalPath, body);
    try {
      f.read();
      throw Error("Should refuse");
    } catch (error) {
      expect(String(error)).not.toContain("private-canary");
      expect(String(error)).not.toContain("Should refuse");
    }
    expect(readFileSync(f.globalPath, "utf8")).toBe(body);
  }
});

it("configured unavailable extension tools refuse, never install a profile or silently replace the tool set", () => {
  const f = fixture({ defaultTools: ["read", "terminal_only"] });
  expect(() => f.read()).toThrow("unsupported-context");
  expect(readdirSync(f.agent)).toEqual(["settings.json"]);
});

it("snapshot carries execution preferences only, with no package, auth, model selection, or extension authority", () => {
  const f = fixture({
    extensions: ["private-extension-canary"],
    packages: ["npm:private-package-canary"],
    defaultModel: "private-model-canary",
    defaultProvider: "private-provider-canary",
    defaultThinkingLevel: "high",
    compaction: { keepRecentTokens: 555 },
    shellPath: "/configured/bash",
    shellCommandPrefix: "export FIXTURE=1",
  });
  const runtime = f.read();
  expect(JSON.stringify(runtime)).not.toContain("private-");
  expect(runtime.settings.shellPath).toBe("/configured/bash");
  expect(runtime.settings.shellCommandPrefix).toBe("export FIXTURE=1");
  expect(() =>
    decodeWorkerRuntime({
      ...runtime,
      settings: { ...runtime.settings, packages: [] },
    }),
  ).toThrow();
  expect(describeWorkerRuntime(runtime)).toContain("shell configured");
  expect(readdirSync(f.agent)).toEqual(["settings.json"]);
});

it("changing files cannot mutate an admitted snapshot; irrelevant UI preferences do not change its identity", () => {
  const f = fixture({ retry: { maxRetries: 8 } });
  const pinned = f.read(),
    identity = canonicalJson(pinned);
  writeFileSync(
    f.globalPath,
    JSON.stringify({ retry: { maxRetries: 8 }, theme: "different" }),
  );
  expect(canonicalJson(f.read())).toBe(identity);
  writeFileSync(f.globalPath, JSON.stringify({ retry: { maxRetries: 2 } }));
  expect(f.read().settings.retry.maxRetries).toBe(2);
  expect(canonicalJson(pinned)).toBe(identity);
  const worker = pi.SettingsManager.inMemory(pinned.settings);
  worker.setCompactionEnabled(false);
  expect(canonicalJson(pinned)).toBe(identity);
  expect(JSON.parse(readFileSync(f.globalPath, "utf8"))).toEqual({
    retry: { maxRetries: 2 },
  });
});

it("explicitly disabled HTTP idle and empty Pi tool selections remain explicit", () => {
  const runtime = resolveWorkerRuntime(
    pi.SettingsManager.inMemory({
      httpIdleTimeoutMs: "disabled",
      defaultTools: [],
      retry: { enabled: false },
    }),
    model,
    defaultWorkerTools(pi, process.cwd()),
  );
  expect(runtime.tools).toEqual({ edit: [], readonly: [] });
  expect(runtime.settings.httpIdleTimeoutMs).toBe(0);
  expect(runtime.settings.retry.enabled).toBe(false);
});

it("an unattended worker's retry budget has a floor under Pi's, and stays off when the user turned retries off", () => {
  const inherited = fixture().read();
  expect(inherited.settings.retry).toMatchObject({
    enabled: true,
    maxRetries: 3,
    maxAgentDelayMs: 60000,
  });
  const patient = unattendedRuntime(inherited);
  expect(patient.settings.retry).toEqual({
    ...inherited.settings.retry,
    ...UNATTENDED_RETRY,
  });
  // Half an hour of backoff at Pi's base delay, not fourteen seconds.
  const waited = (retry: typeof patient.settings.retry) =>
    Array.from({ length: retry.maxRetries }, (_, i) =>
      Math.min(retry.baseDelayMs * 2 ** i, retry.maxAgentDelayMs),
    ).reduce((sum, ms) => sum + ms, 0);
  expect(waited(inherited.settings.retry)).toBe(14_000);
  expect(waited(patient.settings.retry)).toBe(1_710_000);
  // Nothing else of the snapshot changes, and the input is left as it was.
  expect({
    ...patient,
    settings: { ...patient.settings, retry: null },
  }).toEqual({
    ...inherited,
    settings: { ...inherited.settings, retry: null },
  });
  expect(inherited.settings.retry.maxRetries).toBe(3);
  expect(describeWorkerRuntime(patient)).toContain("request retries 12");
  // A larger budget of the user's own is kept; a disabled one stays disabled.
  const larger = fixture({
    retry: { maxRetries: 40, maxAgentDelayMs: 900000 },
  }).read();
  expect(unattendedRuntime(larger).settings.retry).toEqual(
    larger.settings.retry,
  );
  const off = fixture({ retry: { enabled: false } }).read();
  expect(unattendedRuntime(off)).toEqual(off);
});
