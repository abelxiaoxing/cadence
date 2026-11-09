import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { OwnerModelContext } from "../src/service/model-context.ts";
import { legacyWorkerEnvelope } from "../src/subagent-process.ts";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";

const seam = vi.hoisted(() => ({ runtime: {} as Record<string, unknown> }));
vi.mock("@earendil-works/pi-coding-agent", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-coding-agent")>()),
  ModelRuntime: { create: async () => seam.runtime },
}));
afterEach(() => vi.useRealTimers());

async function fixture() {
  const home = mkdtempSync(join(tmpdir(), "request-auth-"));
  const agentDir = join(home, "agent");
  const cwd = join(home, "project");
  mkdirSync(agentDir, { mode: 0o700 });
  mkdirSync(cwd, { mode: 0o700 });
  const epoch = randomUUID();
  const provider = "fixture-oauth";
  const model = {
    id: "fixed",
    provider,
    api: "openai-completions",
    name: "Fixture",
    baseUrl: "https://fixture.invalid",
    reasoning: false,
    input: ["text"],
    contextWindow: 32000,
    maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const credential = (access: string) =>
    writeFileSync(
      join(agentDir, "auth.json"),
      JSON.stringify({
        [provider]: {
          type: "oauth",
          access,
          refresh: "fixture-refresh",
          expires: Date.now() + 300_000,
        },
      }),
      { mode: 0o600 },
    );
  credential("initial-token");
  let generation = 0;
  const getAuth = vi.fn(async () => {
    const apiKey = `renewed-token-${++generation}`;
    credential(apiKey);
    return { auth: { apiKey } };
  });
  seam.runtime = {
    getError: () => undefined,
    getRegisteredNativeProvider: () => undefined,
    getRegisteredProviderConfig: () => undefined,
    getModel: () => model,
    getProvider: () => ({ auth: { oauth: {} } }),
    getAuth,
  };
  const originals = new Set<Promise<unknown>>();
  const owner = {
    state: "idle",
    lease: { assert() {}, registration: { epoch } },
    trackAuth(p: Promise<unknown>) {
      originals.add(p);
      void p.then(
        () => originals.delete(p),
        () => originals.delete(p),
      );
    },
  };
  const context = new OwnerModelContext({
    home,
    cwd,
    agentDir,
    environment: {},
    owner,
    accounting: {},
    network: { initialize: async () => {}, assert() {}, literals: [] },
  } as unknown as ConstructorParameters<typeof OwnerModelContext>[0]);
  await context.load();
  const selection = context.select({
    provider,
    model: model.id,
    api: "openai-completions",
    thinking: "off",
  });
  const request = legacyWorkerEnvelope({
    cwd,
    model,
    auth: { ok: true, apiKey: "fixture" },
    kind: "research",
    prompt: "Investigate",
    instructions: "Readonly",
  }).request;
  request.model = selection;
  const abort = new AbortController();
  const intents: { operationId: string; validityMs: number }[] = [];
  const settlements: {
    operationId: string;
    outcome: string;
    admissionClosed: boolean;
  }[] = [];
  const preparation = context.prepareTracked({
    runtime: fixtureRuntime(),
    request,
    operationId: randomUUID(),
    epoch,
    signal: abort.signal,
    current: () => true,
    journal: {
      preparation: (v) => intents.push(v),
      settlement: (v) => settlements.push(v),
    },
  });
  const result = await preparation.result;
  await preparation.settled;
  expect(result.status).toBe("prepared");
  if (result.status !== "prepared") throw Error("fixture preparation refused");
  result.prepared.consume(JSON.stringify, () => {});
  return {
    context,
    agentDir,
    cwd,
    prepared: result.prepared,
    getAuth,
    credential,
    intents,
    settlements,
    abort,
    originals,
    selection,
  };
}

it("owner refreshes the pinned identity at later requests, with request validity rather than worker lifetime", async () => {
  const f = await fixture();
  vi.useFakeTimers();
  await vi.advanceTimersByTimeAsync(1_800_000);
  expect(await f.prepared.refreshAuth()).toEqual({
    ok: true,
    apiKey: "renewed-token-2",
  });
  f.context.assertCurrent(f.selection);
  expect(f.intents.map((v) => v.validityMs)).toEqual([120_000, 120_000]);
  expect(new Set(f.intents.map((v) => v.operationId)).size).toBe(2);
  expect(f.settlements.map((v) => v.outcome)).toEqual(["resolved", "resolved"]);
  expect(f.getAuth).toHaveBeenCalledTimes(2);
  expect(f.context.pending).toBe(0);
});

it("external credential replacement cannot rebind an admitted worker", async () => {
  const f = await fixture();
  f.credential("different-account-token");
  await expect(f.prepared.refreshAuth()).rejects.toThrow("stale");
  expect(f.getAuth).toHaveBeenCalledTimes(1);
});

it("abort and slow OAuth do not release the original refresh or its writeback", async () => {
  const f = await fixture();
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const implementation = f.getAuth.getMockImplementation()!;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.getAuth.mockImplementationOnce(async () => {
    started();
    await blocked;
    return implementation();
  });
  const pending = f.prepared.refreshAuth();
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await entered;
  vi.useFakeTimers();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(settled).toBe(false);
  expect(f.context.pending).toBe(1);
  f.abort.abort();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(settled).toBe(false);
  expect(f.originals.size).toBe(1);
  const refused = expect(pending).rejects.toThrow();
  finish();
  await refused;
  expect(f.context.pending).toBe(0);
  expect(f.settlements.at(-1)?.admissionClosed).toBe(true);
});

it("real authentication failure is reported once, without refresh or workflow replay", async () => {
  const f = await fixture();
  f.getAuth.mockRejectedValueOnce(new Error("fixture authentication failure"));
  await expect(f.prepared.refreshAuth()).rejects.toThrow("auth-unavailable");
  expect(f.getAuth).toHaveBeenCalledTimes(2);
  expect(f.settlements.at(-1)?.outcome).toBe("failed");
  expect(f.context.pending).toBe(0);
});

it("request authentication renewal cannot reload or replace the admitted Pi preferences", async () => {
  const f = await fixture();
  writeFileSync(
    join(f.agentDir, "settings.json"),
    JSON.stringify({ retry: { maxRetries: 8 } }),
  );
  const capture = vi.spyOn(f.context, "workerSettings");
  await f.prepared.refreshAuth();
  expect(capture).not.toHaveBeenCalled();
  expect(
    f.context.workerSettings(f.cwd, f.selection).settings.retry.maxRetries,
  ).toBe(8);
  capture.mockRestore();
});
