/** Real owner + native shell. SDK scenario uses stock worker/fabricated loopback HTTP.
 * Each NEW multi-operation scenario has a 60s outer budget, SDK children remain15s. */
import type { SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, vi } from "vitest";
import { TaskActions } from "../../src/service/task-actions.ts";
import type {
  Action,
  CheckSelection,
  OwnerFact,
  Receipt,
} from "../../src/service-contract.ts";
import { createServiceHost } from "./source-host.ts";

const observedNatives = vi.hoisted(
  () =>
    [] as {
      kind: string;
      start: number;
      end: number | null;
      code: number | null;
      ignoredInput: boolean;
    }[],
);
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (command: string, args: string[], options: SpawnOptions) => {
      const sdk = args.some((a) => a.endsWith("sdk-worker.mjs"));
      const record = {
        kind: sdk ? "sdk" : "check",
        start: performance.now(),
        end: null as number | null,
        code: null as number | null,
        ignoredInput:
          Array.isArray(options.stdio) && options.stdio[0] === "ignore",
      };
      observedNatives.push(record);
      const child = actual.spawn(
        command,
        sdk
          ? [
              "--import",
              new URL("./lightweight-sdk-guard.mjs", import.meta.url).href,
              ...args,
            ]
          : args,
        options,
      );
      child.on("close", (code) => {
        record.end = performance.now();
        record.code = code;
      });
      return child;
    },
  };
});
export const natives = observedNatives;
const disposals: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
export async function fixture(
  script = "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('EOF observed\\n'));",
  timeoutMs = 15000,
) {
  natives.length = 0;
  const dir = mkdtempSync(join(tmpdir(), "service-checks-")),
    root = join(dir, "project"),
    home = join(dir, "home"),
    agentDir = join(home, "agent");
  for (const path of [root, agentDir])
    mkdirSync(path, { recursive: true, mode: 0o700 });
  let contacts = 0;
  let providerFailure = false;
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* consume actual SDK body without retention */
    }
    contacts++;
    if (providerFailure) {
      res.writeHead(500);
      res.end("fabricated provider failure");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "close",
    });
    for (const [delta, finish_reason] of [
      [{ role: "assistant", content: "actual SDK task result" }, null],
      [{}, "stop"],
    ])
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixed", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((yes) => server.listen(0, "127.0.0.1", yes));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture");
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      fixture: {
        type: "api_key",
        key: "fabricated-check-provider-key",
        env: { PRIVATE_AUTH_ONLY: "fabricated-scoped-auth" },
      },
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        fixture: {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: "openai-completions",
          models: [{ id: "fixed", reasoning: false }],
        },
      },
    }),
    { mode: 0o600 },
  );
  const allowed = new Set([
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "TMP",
    "TEMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "PATHEXT",
    "NODE_ENV",
    "VITEST",
    "VITEST_POOL_ID",
    "VITEST_WORKER_ID",
  ]);
  for (const key of Object.keys(process.env))
    if (!allowed.has(key)) vi.stubEnv(key, undefined);
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("ORDINARY_CHECK_VALUE", "launch-frozen");
  vi.stubEnv("CADENCE_CONTROL_CANARY", "not-a-check-variable");
  const h = await createServiceHost({
    workspace: root,
    stateHome: join(dir, "state"),
    environmentToken: null,
    config: {
      schema: "cadence-service-host/1",
      cwd: root,
      agentDir,
      tokenSource: "generated",
      tokenFile: null,
      http: {
        schema: "cadence-service-http/1",
        host: "127.0.0.1",
        port: 0,
        proxy: null,
      },
    },
  });
  const selection = h.models.select({
    provider: "fixture",
    model: "fixed",
    api: "openai-completions",
    thinking: "off",
  });
  const actions = new TaskActions({
    host: h,
    cwd: root,
    selection,
    ownerSecrets: [],
    workerTimeoutMs: 15000,
  });
  const caller = {
    attachmentId: randomUUID(),
    authority: "local" as const,
    accessGeneration: h.access.generation,
  };
  const scriptPath = join(dir, "check.cjs");
  writeFileSync(scriptPath, script);
  const check: CheckSelection = {
    kind: "configured",
    name: "Actual",
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`,
    timeoutMs,
  };
  mkdirSync(join(root, ".cadence/assistant"), { recursive: true });
  const configPath = join(root, ".cadence/assistant/config.json");
  const configure = (checks: CheckSelection[]) =>
    writeFileSync(
      configPath,
      JSON.stringify({
        schema: "cadence-assistant-checks/1",
        checks: checks.map(({ kind: _, ...c }) => c),
      }),
    );
  configure([check, { ...check, name: "Required but not run" }]);
  const submit = async (action: Action): Promise<Receipt> => {
    const preview = await actions.observe(action);
    const p = await actions.admission.preflight(
      { action, expected: preview.version },
      caller,
    );
    expect(p.kind).toBe("ok");
    if (p.kind !== "ok") throw Error(JSON.stringify(p));
    const r = await actions.admission.submit(
      {
        commandId: randomUUID(),
        expected: preview.version,
        action,
        grant: p.value.grant,
      },
      caller,
    );
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") throw Error(JSON.stringify(r));
    return r.value;
  };
  const create = async () => {
    const r = await submit({
      kind: "create",
      taskKind: "code",
      goal: "Actual parent checks",
    });
    await actions.settled(null);
    if (!r.created) throw Error("missing created task");
    return r.created.taskId;
  };
  const facts = (runId: string): OwnerFact[] => {
    const result: OwnerFact[] = [];
    for (const batch of h.reader.files.scan())
      for (const row of batch.rows)
        if (row.value.kind === "owner" && row.value.link.runId === runId)
          for (const e of row.value.events)
            if (e.kind === "owner" && e.value.kind === "fact")
              result.push(e.value.fact);
    return result;
  };
  disposals.push(async () => {
    const stop = await h.owner.stop(5000);
    await actions.settledAll();
    await h.writer.settled();
    await h.owner.settled();
    h.live.close();
    await h.http.close();
    server.closeAllConnections();
    await new Promise<void>((yes) => server.close(() => yes()));
    expect(natives.every((n) => n.end !== null)).toBe(true);
    writeFileSync(
      join(dir, "check-receipt.json"),
      JSON.stringify({
        stop,
        natives,
        pendingWrites: h.writer.pendingWrites,
        acceptedPending: h.owner.acceptedPending,
        locksRetained: existsSync(h.coordination.store.lockPath),
        contacts,
        productionAdmission: null,
        physicalHuman: false,
        paidProvider: false,
      }),
      { mode: 0o600 },
    );
  });
  return {
    dir,
    root,
    h,
    actions,
    caller,
    selection,
    check,
    configure,
    submit,
    create,
    facts,
    contacts: () => contacts,
    failProvider: () => {
      providerFailure = true;
    },
  };
}
