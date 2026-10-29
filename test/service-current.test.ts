/** Actual isolated owner/choice/SDK/disk/check paths. No accepting production HTTP. */
import type { SpawnOptions } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HistoryProjection } from "../src/history/projection.ts";
import { proposePlan } from "../src/plan-proposal.ts";
import { HttpAuthentication } from "../src/service/auth.ts";
import { ServiceHttpServer } from "../src/service/http.ts";
import { TaskActions } from "../src/service/task-actions.ts";
import { ServiceClient } from "../src/service-client.ts";
import {
  type Action,
  canonicalJson,
  decodeCurrentChanges,
  decodeCurrentView,
  decodeWorkspaceBootstrap,
  LIMITS,
  publicError,
} from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { request as httpRequest } from "./helpers/service-http-fixture.ts";
import { createServiceHost } from "./helpers/source-host.ts";
import { keepOnlyEnvironment } from "./helpers/windows-environment.ts";

const natives = vi.hoisted(
  () => [] as { closed: boolean; code: number | null }[],
);
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (command: string, args: string[], options: SpawnOptions) => {
      const sdk = args.some((a) => a.endsWith("sdk-worker.mjs"));
      const child = actual.spawn(
        command,
        sdk
          ? [
              "--import",
              new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url)
                .href,
              ...args,
            ]
          : args,
        options,
      );
      if (sdk) {
        const receipt = { closed: false, code: null as number | null };
        natives.push(receipt);
        child.on("close", (code) => {
          receipt.closed = true;
          receipt.code = code;
        });
      }
      return child;
    },
  };
});
const disposals: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function tree(root: string): unknown {
  return readdirSync(root)
    .sort()
    .map((name) => {
      const path = join(root, name),
        s = statSync(path);
      return s.isDirectory()
        ? [name, s.ino, tree(path)]
        : [
            name,
            s.ino,
            createHash("sha256").update(readFileSync(path)).digest("hex"),
          ];
    });
}
async function fixture(rootName = "project") {
  natives.length = 0;
  const dir = mkdtempSync(join(tmpdir(), "current-owner-")),
    root = join(dir, rootName),
    home = join(dir, "home"),
    agentDir = join(home, "agent");
  for (const p of [root, agentDir])
    mkdirSync(p, { recursive: true, mode: 0o700 });
  let contacts = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* genuine request, no persisted credentials */
    }
    contacts++;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "close",
    });
    for (const [delta, finish_reason] of [
      [{ role: "assistant", content: "Actual readonly result." }, null],
      [{}, "stop"],
    ])
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixed", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((yes) => server.listen(0, "127.0.0.1", yes));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture address");
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      fixture: { type: "api_key", key: "fabricated-current-secret" },
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
          models: [
            { id: "fixed", reasoning: false },
            { id: "other", reasoning: false },
          ],
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
  keepOnlyEnvironment(allowed);
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
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
  const actions = new TaskActions({
    host: h,
    cwd: root,
    choice: h.choice,
    ownerSecrets: [],
    workerTimeoutMs: 15000,
  });
  disposals.push(async () => {
    const stopped = await h.owner.stop(5000);
    await actions.settledAll();
    await h.writer.settled();
    await h.owner.settled();
    h.live.close();
    await h.http.close();
    server.closeAllConnections();
    await new Promise<void>((yes) => server.close(() => yes()));
    expect(natives.every((n) => n.closed)).toBe(true);
    writeFileSync(
      join(dir, "current-native-receipt.json"),
      JSON.stringify({
        stopped,
        contacts,
        natives,
        productionAdmission: null,
        fixtureProvider: true,
        locksRetained: existsSync(h.coordination.store.lockPath),
      }),
      { mode: 0o600 },
    );
  });
  const caller = {
    attachmentId: randomUUID(),
    authority: "local" as const,
    accessGeneration: h.access.generation,
  };
  const choose = (model = "fixed") =>
    h.choice.choose({
      expected: h.choice.snapshot().version,
      choice: {
        provider: "fixture",
        model,
        api: "openai-completions",
        thinking: "off",
      },
    });
  const current = (taskId: string | null) =>
    actions.current({ storeId: h.reader.storeId, taskId });
  const submit = async (
    action: Action,
    view = current(action.kind === "create" ? null : action.taskId),
  ) => {
    if (view.context.status !== "available")
      throw Error("missing actual choice");
    const preflight = await actions.admission.preflight(
      { action, expected: view.context.version },
      caller,
    );
    if (preflight.kind !== "ok") throw Error(JSON.stringify(preflight));
    const reply = await actions.admission.submit(
      {
        action,
        expected: view.context.version,
        commandId: randomUUID(),
        grant: preflight.value.grant,
      },
      caller,
    );
    if (reply.kind !== "ok") throw Error(JSON.stringify(reply));
    return reply.value;
  };
  const create = async (kind: "research" | "code" = "research") => {
    const receipt = await submit({
      kind: "create",
      taskKind: kind,
      goal: "Actual current owner",
    });
    await actions.settledAll();
    if (!receipt.created) throw Error("create identity");
    return receipt.created.taskId;
  };
  const save = async (
    taskId: string,
    plan = "Reviewed Unicode plan 中文 🙂",
  ) => {
    const view = current(taskId);
    const preview = await actions.observe({ kind: "start", taskId });
    if (!preview.graph) throw Error("actual default graph");
    const action = await proposePlan(view, plan, preview.graph.assignments, {
      uuid: randomUUID,
      sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    });
    await submit(action, view);
    await actions.settledAll();
    return action;
  };
  return {
    h,
    actions,
    current,
    choose,
    submit,
    create,
    save,
    root,
    dir,
    agentDir,
    caller,
    contacts: () => contacts,
  };
}

it("initial none reads real legacy plan/roles without private writes; choice enables the same owner and invalidates unused grants", async () => {
  const f = await fixture();
  const id = randomUUID();
  f.h.coordination.store.save(
    {
      schema: "cadence-workflow-assistant/1",
      id,
      revision: 1,
      kind: "research",
      goal: "legacy",
      plan: "Readable 中文 plan",
      cwd: f.root,
      phase: "planning",
      result: "",
      baseline: "",
      checks: [],
      activity: [],
    },
    0,
    f.h.owner.lease.checkout,
  );
  const before = tree(f.h.reader.files.directory);
  const view = f.current(id);
  expect(view.context.status).toBe("unavailable");
  expect(view.readablePlan).toMatchObject({
    source: "current-v1",
    text: "Readable 中文 plan",
    editable: true,
  });
  expect(view.roles.map((r) => r.role)).toEqual([
    "design-explorer",
    "implementation-worker",
    "diagnosis-worker",
  ]);
  expect(view.savedGraph).toEqual({ status: "none" });
  expect(tree(f.h.reader.files.directory)).toEqual(before);
  expect(f.contacts()).toBe(0);
  const legacyPath = join(
    f.root,
    ".cadence",
    "assistant",
    "tasks",
    id,
    "task.json",
  );
  const legacyBytes = readFileSync(legacyPath);
  writeFileSync(
    legacyPath,
    JSON.stringify({
      ...JSON.parse(legacyBytes.toString()),
      plan: "fabricated-current-secret",
    }),
  );
  const redacted = f.current(id);
  expect(redacted.readablePlan?.editable).toBe(false);
  expect(redacted.readablePlan?.coverage.redacted).toBe(true);
  expect(redacted.readablePlan?.text).not.toContain(
    "fabricated-current-secret",
  );
  expect(tree(f.h.reader.files.directory)).toEqual(before);
  writeFileSync(legacyPath, legacyBytes);
  const first = f.choose();
  const available = f.current(id);
  expect(available.context.status).toBe("available");
  if (available.context.status !== "available") throw Error("context");
  expect(available.context.version.configRev).toBe(first.version.configRev);
  const action = { kind: "start" as const, taskId: id };
  const grant = await f.actions.admission.preflight(
    { action, expected: available.context.version },
    f.caller,
  );
  expect(grant.kind).toBe("ok");
  const changed = f.choose("other");
  expect(changed.version.configRev).toBe(first.version.configRev + 1);
  if (grant.kind !== "ok") throw Error("grant");
  const refused = await f.actions.admission.submit(
    {
      action,
      expected: available.context.version,
      grant: grant.value.grant,
      commandId: randomUUID(),
    },
    f.caller,
  );
  expect(refused.kind).toBe("error");
  expect(f.h.models.observe()).toEqual([changed.selected]);
  expect(f.contacts()).toBe(0);
});

it("current text and change body redact real private literals without editable identity or writes", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create();
  const raw = f.h.coordination.store.loadSnapshot(id);
  if (!raw) throw Error("task");
  const path = join(f.root, ".cadence", "assistant", "tasks", id, "task.json");
  writeFileSync(
    path,
    JSON.stringify({ ...raw.record, plan: "fabricated-current-secret 中文" }),
  );
  writeFileSync(join(f.root, "file.txt"), "fabricated-current-secret");
  const before = tree(f.h.reader.files.directory),
    view = f.current(id);
  expect(view.readablePlan?.text).not.toContain("fabricated-current-secret");
  expect(view.readablePlan?.editable).toBe(false);
  expect(view.readablePlan?.coverage.redacted).toBe(true);
  const changes = f.actions.currentChanges({
    storeId: f.h.reader.storeId,
    taskId: id,
  });
  expect(canonicalJson(changes)).not.toContain("fabricated-current-secret");
  expect(changes.observation.checkoutGeneration).toBe(0);
  expect(decodeCurrentChanges(changes)).toEqual(changes);
  expect(tree(f.h.reader.files.directory)).toEqual(before);
  expect(f.contacts()).toBe(0);
});

it("retained-only current/snapshot reads preserve history without granting action authority or repairing live state", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create();
  await f.save(id);
  const prior = f.current(id);
  expect(prior.savedGraph.status).toBe("saved");
  if (prior.context.status !== "available") throw Error("context");
  const action = { kind: "start" as const, taskId: id };
  const preflight = await f.actions.admission.preflight(
    { action, expected: prior.context.version },
    f.caller,
  );
  if (preflight.kind !== "ok") throw Error(JSON.stringify(preflight));
  const path = join(f.root, ".cadence", "assistant", "tasks", id, "task.json");
  unlinkSync(path);
  const before = tree(f.h.reader.files.directory),
    checkout = tree(f.root);
  const unavailable = {
    status: "unavailable" as const,
    workspaceId: f.h.reader.files.format.workspaceId,
    taskId: id,
    error: publicError("unavailable"),
  };
  const view = f.current(id);
  expect(view.context).toEqual(unavailable);
  expect(view.task).toBeNull();
  expect(view.readablePlan).toBeNull();
  expect(view.savedGraph).toEqual({ status: "none" });
  expect(decodeCurrentView(view)).toEqual(view);
  expect(f.actions.context(id)).toEqual(unavailable);
  expect(() =>
    f.actions.currentChanges({ storeId: f.h.reader.storeId, taskId: id }),
  ).toThrowError("unavailable");
  expect(() => f.actions.checkObligations(id)).toThrowError("unavailable");
  // The source host defers actions: exercise the real action callback, not its
  // always-unavailable fixture fallback (which would pass before the fix).
  const projection = new HistoryProjection(f.h.reader, {
    ...f.h.projection.environment,
    context: (taskId) => f.actions.context(taskId),
  });
  const snapshot = await projection.snapshot({ kind: "task", id });
  expect(snapshot.context).toEqual(unavailable);
  expect(snapshot.scope).toEqual({ kind: "task", id });
  const commandId = randomUUID();
  expect(
    await f.actions.admission.submit(
      {
        commandId,
        action,
        expected: prior.context.version,
        grant: preflight.value.grant,
      },
      f.caller,
    ),
  ).toMatchObject({ kind: "error", error: { effect: "none" } });
  expect(await f.h.writer.lookup(commandId)).toMatchObject({
    status: "absent",
  });
  expect(f.actions.activeRuns()).toMatchObject({
    status: "complete",
    runs: [],
  });
  expect(
    await f.actions.admission.preflight(
      {
        action: { kind: "start", taskId: id },
        expected: prior.context.version,
      },
      f.caller,
    ),
  ).toMatchObject({ kind: "error", error: { effect: "none" } });
  expect(tree(f.h.reader.files.directory)).toEqual(before);
  expect(tree(f.root)).toEqual(checkout);
  expect(existsSync(path)).toBe(false);
  expect(f.contacts()).toBe(0);
});

it.each(["appears", "disappears"])(
  "a live task that %s during a current observation still refuses as stale",
  async (transition) => {
    const f = await fixture();
    f.choose();
    const id = await f.create();
    const store = f.h.coordination.store,
      load = store.loadSnapshot.bind(store);
    const spy = vi.spyOn(store, "loadSnapshot");
    if (transition === "appears") spy.mockReturnValueOnce(undefined);
    else {
      // Initial selection and saved-graph lookup succeed, final revalidation
      // sees absence. Do not relax that race into a successful available view.
      spy
        .mockImplementationOnce(load)
        .mockImplementationOnce(load)
        .mockReturnValueOnce(undefined);
    }
    expect(() => f.current(id)).toThrowError("stale");
    spy.mockRestore();
    expect(f.current(id).context.status).toBe("available");
    expect(f.contacts()).toBe(0);
  },
);

it("malformed live task bytes are not silently downgraded to an absent retained-only task", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create();
  const path = join(f.root, ".cadence", "assistant", "tasks", id, "task.json");
  writeFileSync(path, "{broken");
  expect(() => f.current(id)).toThrow();
  expect(readFileSync(path, "utf8")).toBe("{broken");
  expect(f.contacts()).toBe(0);
});

it("raw-byte and real model-source changes refuse instead of refreshing prior current authority", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create();
  const view = f.current(id);
  if (view.context.status !== "available") throw Error("context");
  const path = join(f.root, ".cadence", "assistant", "tasks", id, "task.json");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
  const preflight = await f.actions.admission.preflight(
    { action: { kind: "start", taskId: id }, expected: view.context.version },
    f.caller,
  );
  expect(preflight.kind).toBe("error");
  writeFileSync(
    join(f.agentDir, "auth.json"),
    JSON.stringify({
      fixture: { type: "api_key", key: "replaced-fabricated-key" },
    }),
    { mode: 0o600 },
  );
  expect(() => f.current(id)).toThrow();
  expect(() => f.choose("other")).toThrow();
  expect(f.contacts()).toBe(0);
});

it("actual checks/changes use shared callbacks, exact own-generation PASS and relevant result revision", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create("code");
  writeFileSync(
    join(f.root, ".cadence", "assistant", "config.json"),
    JSON.stringify({
      schema: "cadence-assistant-checks/1",
      checks: [
        {
          name: "Actual",
          command: process.platform === "win32" ? "exit /b 0" : "true",
          timeoutMs: 1000,
        },
        { name: "Missing", command: "unused", timeoutMs: 1000 },
      ],
    }),
  );
  const before = f.actions.checkObligations(id);
  expect(before.definitions.map((d) => d.status)).toEqual([
    "not-run",
    "not-run",
  ]);
  const definition = f.actions.checks(id).selections[0];
  await f.submit({ kind: "check", taskId: id, check: definition });
  await f.actions.settledAll();
  const after = f.actions.checkObligations(id);
  expect(after.definitions.map((d) => d.status)).toEqual(["passed", "not-run"]);
  expect(after.revision).toBeGreaterThan(before.revision);
  const environment = {
    ...f.h.projection.environment,
    workspace: () => f.actions.workspace(),
    context: (id: string) => f.actions.context(id),
    checks: (id: string) => f.actions.checks(id),
    checkObligations: (id: string) => f.actions.checkObligations(id),
  };
  const projection = new HistoryProjection(f.h.reader, environment);
  expect(await projection.checkObligations(id)).toEqual(after);
  expect(
    decodeWorkspaceBootstrap(await projection.workspace()).activeRuns,
  ).toMatchObject({ status: "complete", runs: [] });
  const changes = f.actions.currentChanges({
    storeId: f.h.reader.storeId,
    taskId: id,
  });
  expect(changes.observation.checkoutGeneration).toBe(1);
  expect(
    changes.context.status === "available" &&
      changes.context.version.observation.identity,
  ).toBe(changes.observation.identity);
  writeFileSync(join(f.root, "foreign.txt"), "external change");
  expect(f.actions.checkObligations(id).definitions[0].status).toBe("stale");
  expect(f.contacts()).toBe(0);
}, 60000);

it("proposal snapshots before hash await, enforces UTF8 limits and never rebinds an old source", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create();
  const current = f.current(id),
    preview = await f.actions.observe({ kind: "start", taskId: id });
  if (!preview.graph) throw Error("graph");
  const seq = f.h.writer.committedSeq;
  let release!: (value: string) => void;
  const waiting = new Promise<string>((yes) => {
    release = yes;
  });
  const proposal = proposePlan(
    current,
    "Unicode 🙂",
    preview.graph.assignments,
    { uuid: randomUUID, sha256: () => waiting },
  );
  f.choose("other");
  preview.graph.assignments[0].instructions = "caller mutation";
  release(createHash("sha256").update("Unicode 🙂").digest("hex"));
  const action = await proposal;
  expect(action.graph.assignments[0].instructions).not.toBe("caller mutation");
  expect(f.h.writer.committedSeq).toBe(seq);
  if (current.context.status !== "available") throw Error("context");
  expect(
    (
      await f.actions.admission.preflight(
        { action, expected: current.context.version },
        f.caller,
      )
    ).kind,
  ).toBe("error");
  await expect(
    proposePlan(current, "🙂".repeat(8193), action.graph.assignments, {
      uuid: randomUUID,
      sha256: () => "0".repeat(64),
    }),
  ).rejects.toThrow();
  expect(() =>
    decodeCurrentView({
      ...current,
      request: { ...current.request, taskId: randomUUID() },
    }),
  ).toThrow();
  expect(f.contacts()).toBe(0);
});

it("real readonly HTTP current GET/POST and typed clients preserve no-effect, abort and correlation; production stays closed", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create();
  const native = f.h.coordination.localAccess();
  const auth = new HttpAuthentication(
    f.h.access,
    native.epoch,
    f.h.reader.files.format.workspaceId,
    native.capability,
  );
  const server = new ServiceHttpServer({
    policy: {
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 0,
      proxy: null,
    },
    auth,
    adapters: {
      admission: null,
      modelChoice: undefined,
      current: f.actions,
      projection: f.h.projection,
      receipts: null,
      live: null,
    },
  });
  const endpoint = await server.listen();
  server.admit();
  const transport = new HttpServiceTransport({
    origin: endpoint,
    localCapability: native.capability,
  });
  const client = new ServiceClient(transport);
  const request = { storeId: f.h.reader.storeId, taskId: id };
  const before = tree(f.h.reader.files.directory),
    seq = f.h.writer.committedSeq;
  try {
    expect((await client.session()).kind).toBe("ok");
    const response = await client.current(request);
    expect(response).toEqual({ kind: "ok", value: f.current(id) });
    const rawSession = await httpRequest(endpoint, "/api/v1/session", {
      headers: { "x-cadence-local": native.capability },
    });
    const attachment = String(rawSession.headers["x-cadence-attachment"]);
    const postHeaders = {
      "x-cadence-local": native.capability,
      "x-cadence-attachment": attachment,
      "content-type": "application/json",
    };
    const post = await httpRequest(endpoint, "/api/v1/current", {
      method: "POST",
      headers: postHeaders,
      body: JSON.stringify(request),
    });
    expect(post.status).toBe(200);
    expect(JSON.parse(post.text)).toEqual(response);
    const changes = await client.currentChanges(request);
    expect(changes.kind).toBe("ok");
    expect(await client.activeRuns()).toMatchObject({
      kind: "ok",
      value: { status: "complete", runs: [] },
    });
    const bad = await httpRequest(endpoint, "/api/v1/current?request=x", {
      method: "POST",
      headers: postHeaders,
      body: JSON.stringify(request),
    });
    expect(bad.status).not.toBe(200);
    expect(JSON.parse(bad.text)).toMatchObject({
      kind: "error",
      error: { effect: "none" },
    });
    const aborted = new AbortController();
    aborted.abort();
    expect(await client.current(request, aborted.signal)).toMatchObject({
      kind: "error",
      error: { effect: "none" },
    });
    const current = transport.current.bind(transport);
    vi.spyOn(transport, "current").mockImplementation(
      async (request, signal) => {
        const reply = await current(request, signal);
        if (!reply || typeof reply !== "object") throw Error("reply");
        // Labeled response substitution: real reader value from another task must
        // not correlate to this request. No fixture execution authority is supplied.
        return { kind: "ok", value: f.current(null) };
      },
    );
    expect(await client.current(request)).toMatchObject({
      kind: "error",
      error: { effect: "none" },
    });
    const production = new ServiceClient(
      new HttpServiceTransport({
        origin: f.h.endpoint,
        localCapability: native.capability,
      }),
    );
    expect(await production.current(request)).toMatchObject({
      kind: "error",
      error: { effect: "none", code: "unavailable" },
    });
    expect(
      await production.chooseModel({
        expected: f.h.choice.snapshot().version,
        choice: {
          provider: "fixture",
          model: "other",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    ).toMatchObject({ kind: "error" });
    expect(f.h.writer.committedSeq).toBe(seq);
    expect(tree(f.h.reader.files.directory)).toEqual(before);
    expect(f.contacts()).toBe(0);
  } finally {
    await transport.detach();
    await server.close();
  }
});

it("restart begins none above the accepted revision floor; old saved source IDs stay stale until explicit rebind/Save", async () => {
  const f = await fixture();
  const chosen = f.choose();
  const id = await f.create();
  const saved = await f.save(id);
  expect((await f.h.owner.stop(5000)).state).toBe("stopped");
  const config = {
    schema: "cadence-service-host/1" as const,
    cwd: f.root,
    agentDir: f.agentDir,
    tokenSource: "generated" as const,
    tokenFile: null,
    http: {
      schema: "cadence-service-http/1" as const,
      host: "127.0.0.1" as const,
      port: Number(new URL(f.h.endpoint).port),
      proxy: null,
    },
  };
  const h = await createServiceHost({
    workspace: f.root,
    stateHome: join(f.dir, "state"),
    environmentToken: null,
    config,
  });
  const actions = new TaskActions({
    host: h,
    cwd: f.root,
    choice: h.choice,
    ownerSecrets: [],
    workerTimeoutMs: 15000,
  });
  disposals.push(async () => {
    await h.owner.stop(5000);
    await actions.settledAll();
    await h.writer.settled();
    await h.owner.settled();
    h.live.close();
    await h.http.close();
  });
  const request = { storeId: h.reader.storeId, taskId: id };
  expect(h.choice.snapshot().selected).toBeNull();
  expect(h.choice.snapshot().version.configRev).toBeGreaterThan(
    chosen.version.configRev,
  );
  const initial = actions.current(request);
  expect(initial.context.status).toBe("unavailable");
  expect(initial.savedGraph.status).toBe("saved");
  expect(initial.readablePlan?.text).toBe(saved.plan);
  const selected = h.choice.choose({
    expected: h.choice.snapshot().version,
    choice: {
      provider: "fixture",
      model: "fixed",
      api: "openai-completions",
      thinking: "off",
    },
  });
  expect(selected.selected?.sourceSelectionId).not.toBe(
    chosen.selected?.sourceSelectionId,
  );
  const current = actions.current(request);
  expect(current.savedGraph.status).toBe("saved");
  await expect(
    actions.observe({ kind: "start", taskId: id }),
  ).rejects.toThrow();
  await expect(
    proposePlan(current, saved.plan, saved.graph.assignments, {
      uuid: randomUUID,
      sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    }),
  ).rejects.toThrow();
  expect(f.contacts()).toBe(0);
}, 60000);

it("current raw HTTP whole-Reply limit, Unicode plan limits and source-safe configured text are enforced", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create();
  const raw = f.h.coordination.store.loadSnapshot(id);
  if (!raw) throw Error("task");
  f.h.coordination.store.save(
    {
      ...raw.record,
      revision: raw.record.revision + 1,
      plan: "🙂".repeat(8192),
    },
    raw.record.revision,
    f.h.owner.lease.checkout,
    raw.identity,
  );
  const current = f.current(id);
  expect(Buffer.byteLength(current.readablePlan?.text ?? "")).toBe(32768);
  expect(() =>
    decodeCurrentView({
      ...current,
      readablePlan: { ...current.readablePlan, text: "🙂".repeat(8193) },
    }),
  ).toThrow();
  const encoded = JSON.stringify({ kind: "ok", value: current });
  let extra = 0,
    calls = 0;
  const server = createServer((req, res) => {
    req.resume();
    calls++;
    res.setHeader("content-type", "application/json");
    res.end(
      encoded +
        " ".repeat(LIMITS.pageBytes - Buffer.byteLength(encoded) + extra),
    );
  });
  await new Promise<void>((yes) => server.listen(0, "127.0.0.1", yes));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("address");
  const transport = new HttpServiceTransport({
    origin: `http://127.0.0.1:${address.port}`,
  });
  try {
    // Labeled raw-response transport fixture. Value comes from the actual owner;
    // this separate listener supplies padding, not authentication or authority.
    expect(await transport.current(current.request)).toEqual({
      kind: "ok",
      value: current,
    });
    extra = 1;
    await expect(transport.current(current.request)).rejects.toMatchObject({
      code: "oversize",
    });
    expect(calls).toBe(2);
  } finally {
    await new Promise<void>((yes) => server.close(() => yes()));
  }
  writeFileSync(
    join(f.root, ".cadence", "assistant", "config.json"),
    JSON.stringify({
      schema: "cadence-assistant-checks/1",
      checks: [
        {
          name: "Known literal",
          command: "echo fabricated-current-secret",
          timeoutMs: 1000,
        },
      ],
    }),
  );
  expect(() => f.actions.checks(id)).toThrow();
  expect(f.contacts()).toBe(0);
});

it("pending Save and external raw bytes yield unavailable graph authority, never proven none or old saved approval", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create();
  const saved = await f.save(id),
    current = f.current(id);
  const action = await proposePlan(
    current,
    "Explicit second plan",
    saved.graph.assignments,
    {
      uuid: randomUUID,
      sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    },
  );
  let release!: () => void;
  const pending = new Promise<void>((yes) => {
    release = yes;
  });
  const original = f.h.writer.retainAcceptedPlan.bind(f.h.writer);
  vi.spyOn(f.h.writer, "retainAcceptedPlan").mockImplementation(
    async (...args) => {
      await pending;
      return original(...args);
    },
  );
  try {
    await f.submit(action, current);
    const before = tree(f.h.reader.files.directory);
    const held = f.current(id);
    expect(held.savedGraph.status).toBe("unavailable");
    expect(held.context.status).toBe("unavailable");
    expect(held.readablePlan?.text).toBe(saved.plan);
    expect(() => f.choose("other")).toThrow();
    expect(tree(f.h.reader.files.directory)).toEqual(before);
  } finally {
    release();
  }
  await f.actions.settledAll();
  expect(f.current(id).readablePlan?.text).toBe(action.plan);
  expect(f.current(id).savedGraph.status).toBe("saved");
  const path = join(f.root, ".cadence", "assistant", "tasks", id, "task.json");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
  const changed = readFileSync(path);
  expect(f.current(id).savedGraph.status).toBe("unavailable");
  expect(f.current(id).context.status).toBe("unavailable");
  expect(readFileSync(path)).toEqual(changed);
  expect(f.contacts()).toBe(0);
}, 60000);

it("review counterexample: no-choice current revalidates private literals after selected history reads", async () => {
  const f = await fixture();
  const id = randomUUID(),
    canary = "new-fabricated-current-canary";
  f.h.coordination.store.save(
    {
      schema: "cadence-workflow-assistant/1",
      id,
      revision: 1,
      kind: "research",
      goal: "Legacy readonly source timing",
      plan: canary,
      cwd: f.root,
      phase: "planning",
      result: "",
      baseline: "",
      checks: [],
      activity: [],
    },
    0,
    f.h.owner.lease.checkout,
  );
  const original = f.h.reader.publishedPlan.bind(f.h.reader);
  vi.spyOn(f.h.reader, "publishedPlan").mockImplementationOnce((...args) => {
    const result = original(...args);
    // Labeled synchronous filesystem interleaving, not a fake source/authority.
    writeFileSync(
      join(f.agentDir, "auth.json"),
      JSON.stringify({
        fixture: { type: "api_key", key: canary },
      }),
      { mode: 0o600 },
    );
    return result;
  });
  const before = tree(f.h.reader.files.directory);
  expect(() => f.current(id)).toThrow();
  const next = f.current(id);
  expect(next.context.status).toBe("unavailable");
  expect(next.readablePlan).toMatchObject({
    editable: false,
    coverage: { redacted: true },
  });
  expect(canonicalJson(next)).not.toContain(canary);
  expect(f.h.choice.snapshot().selected).toBeNull();
  expect(f.h.models.observe()).toEqual([]);
  expect(tree(f.h.reader.files.directory)).toEqual(before);
  expect(f.contacts()).toBe(0);
});

it("review counterexample: preview rechecks actual task bytes after configured-obligation reads", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create();
  const displayed = f.current(id);
  const path = join(f.root, ".cadence", "assistant", "tasks", id, "task.json");
  const original = f.h.coordination.store.checks.bind(f.h.coordination.store);
  vi.spyOn(f.h.coordination.store, "checks").mockImplementationOnce(() => {
    const result = original();
    writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
    return result;
  });
  if (displayed.context.status !== "available") throw Error("context");
  const before = tree(f.h.reader.files.directory);
  const reply = await f.actions.admission.preflight(
    {
      action: { kind: "start", taskId: id },
      expected: displayed.context.version,
    },
    f.caller,
  );
  expect(reply).toMatchObject({
    kind: "error",
    error: { code: "stale", effect: "none" },
  });
  expect(tree(f.h.reader.files.directory)).toEqual(before);
  expect(f.contacts()).toBe(0);
});

it("review counterexample: workspace label uses the current owner literal policy", async () => {
  const f = await fixture("project-fabricated-current-secret");
  const before = tree(f.h.reader.files.directory);
  const workspace = f.actions.workspace();
  expect(workspace.context.status).toBe("unavailable");
  expect(workspace.rootLabel).not.toContain("fabricated-current-secret");
  expect(tree(f.h.reader.files.directory)).toEqual(before);
  expect(f.contacts()).toBe(0);
});

it("review counterexample: obligations revalidate configured definitions before returning their revision", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create("code");
  const path = join(f.root, ".cadence", "assistant", "config.json");
  const set = (name: string) =>
    writeFileSync(
      path,
      JSON.stringify({
        schema: "cadence-assistant-checks/1",
        checks: [{ name, command: "unused", timeoutMs: 1000 }],
      }),
    );
  set("Before");
  const original = f.h.coordination.store.checks.bind(f.h.coordination.store);
  vi.spyOn(f.h.coordination.store, "checks").mockImplementationOnce(() => {
    const result = original();
    set("After");
    return result;
  });
  expect(() => f.actions.checkObligations(id)).toThrow();
  expect(f.actions.checkObligations(id).definitions).toMatchObject([
    { selection: { name: "After" }, status: "not-run", checkId: null },
  ]);
  expect(f.contacts()).toBe(0);
});

it("nullable consumer refuses configuration replacement across actual admission, owner originals, journal leases and review barriers", async () => {
  const f = await fixture();
  const choice = f.choose();
  const unchanged = () => {
    expect(() => f.choose("other")).toThrow();
    expect(f.h.choice.snapshot()).toEqual(choice);
    expect(f.h.models.observe()).toEqual([choice.selected]);
  };
  // Explicit original-work injection through the real owner's accounting, not a
  // fabricated busy/current callback in OwnerModelChoice or TaskActions.
  let finish!: (value: { status: "settled" }) => void;
  const original = new Promise<{ status: "settled" }>((yes) => {
    finish = yes;
  });
  f.h.owner.trackAccepted(original);
  unchanged();
  finish({ status: "settled" });
  await original;
  await Promise.resolve();
  const reservation = f.h.writer.owner().reserve({
    sourceFrames: 0,
    retainedBytes: 0,
    outputBytes: 4096,
    outputChunks: 1,
    lane: "control",
  });
  if (reservation.status !== "reserved") throw Error("owner lease");
  try {
    unchanged();
  } finally {
    reservation.reservation.release();
  }
  const held = await f.actions.scheduler.reviewBarrier(randomUUID());
  const queued = f.actions.scheduler.reviewBarrier(randomUUID());
  try {
    unchanged();
  } finally {
    held.release();
  }
  const next = await queued;
  try {
    unchanged();
  } finally {
    next.release();
  }
  // A real in-flight admission reserves synchronously, even before observation.
  const view = f.current(null);
  if (view.context.status !== "available") throw Error("context");
  const preparing = f.actions.admission.preflight(
    {
      action: { kind: "create", taskKind: "research", goal: "Not submitted" },
      expected: view.context.version,
    },
    f.caller,
  );
  unchanged();
  expect((await preparing).kind).toBe("ok");
  const changed = f.choose("other");
  expect(changed.version.configRev).toBe(choice.version.configRev + 1);
  expect(f.contacts()).toBe(0);
});

it("prospective helper rejects role/model/UTF8/graph/version/crypto faults before returning authority or invoking an invalid digest", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create();
  const current = f.current(id),
    preview = await f.actions.observe({ kind: "start", taskId: id });
  if (!preview.graph || current.context.status !== "available")
    throw Error("context");
  const assignments = preview.graph.assignments;
  const digest = vi.fn((bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex"),
  );
  const invalidCases = [
    { plan: "\ud800", assignments },
    { plan: "🙂".repeat(8193), assignments },
    {
      plan: "valid",
      assignments: [{ ...assignments[0], instructions: "x".repeat(16385) }],
    },
    {
      plan: "valid",
      assignments: [
        {
          ...assignments[0],
          role: { ...assignments[0].role, sha256: "0".repeat(64) },
        },
      ],
    },
    {
      plan: "valid",
      assignments: [
        {
          ...assignments[0],
          model: { ...assignments[0].model, sourceSelectionId: randomUUID() },
        },
      ],
    },
    { plan: "valid", assignments: [assignments[0], assignments[0]] },
  ];
  const before = tree(f.h.reader.files.directory);
  for (const c of invalidCases)
    await expect(
      proposePlan(current, c.plan, c.assignments, {
        uuid: randomUUID,
        sha256: digest,
      }),
    ).rejects.toThrow();
  for (const key of ["revision", "graphRevision"] as const) {
    const maximal = structuredClone(current);
    if (
      maximal.context.status !== "available" ||
      !maximal.context.version.task ||
      !maximal.task
    )
      throw Error("context");
    maximal.context.version.task[key] = Number.MAX_SAFE_INTEGER;
    if (key === "revision") maximal.task.revision = Number.MAX_SAFE_INTEGER;
    await expect(
      proposePlan(maximal, "valid", assignments, {
        uuid: randomUUID,
        sha256: digest,
      }),
    ).rejects.toThrow();
  }
  await expect(
    proposePlan(current, "valid", assignments, {
      uuid: () => "not-a-uuid",
      sha256: digest,
    }),
  ).rejects.toThrow();
  expect(digest).not.toHaveBeenCalled();
  await expect(
    proposePlan(current, "valid", assignments, {
      uuid: randomUUID,
      sha256: async () => "not-a-hash",
    }),
  ).rejects.toThrow();
  const wrongHash = await proposePlan(current, "valid", assignments, {
    uuid: randomUUID,
    sha256: () => "0".repeat(64),
  });
  expect(
    (
      await f.actions.admission.preflight(
        { action: wrongHash, expected: current.context.version },
        f.caller,
      )
    ).kind,
  ).toBe("error");
  expect(tree(f.h.reader.files.directory)).toEqual(before);
  expect(f.contacts()).toBe(0);
});

it("a colliding prospective plan UUID cannot adopt retained membership through actual explicit Save", async () => {
  const f = await fixture();
  f.choose();
  const id = await f.create();
  const saved = await f.save(id),
    current = f.current(id);
  const action = await proposePlan(
    current,
    "A second separately approved plan",
    saved.graph.assignments,
    {
      uuid: () => saved.graph.plan.recordId,
      sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    },
  );
  expect(action.graph.plan.version).toBe(saved.graph.plan.version + 1);
  const raw = f.h.coordination.store.loadSnapshot(id);
  const receipt = await f.submit(action, current);
  await f.actions.settledAll();
  expect(f.h.coordination.store.loadSnapshot(id)).toEqual(raw);
  expect(f.h.owner.state).toBe("quarantined");
  const recorded = await f.h.writer.lookup(receipt.commandId);
  expect(
    recorded.status === "found" && recorded.record.receipt.publication,
  ).not.toBe("published");
  expect(f.contacts()).toBe(0);
}, 20000);

function legacyResearch(f: Awaited<ReturnType<typeof fixture>>) {
  const id = randomUUID();
  f.h.coordination.store.save(
    {
      schema: "cadence-workflow-assistant/1",
      id,
      revision: 1,
      kind: "research",
      goal: "Explicit fixture task",
      plan: "",
      cwd: f.root,
      phase: "planning",
      result: "",
      baseline: "",
      checks: [],
      activity: [],
    },
    0,
    f.h.owner.lease.checkout,
  );
  return id;
}

it("current default eviction and same-revision changes stale the old proposal instead of rebasing Start", async () => {
  const f = await fixture();
  f.choose();
  const ids = Array.from({ length: 17 }, () => legacyResearch(f));
  const before = tree(f.h.reader.files.directory),
    first = f.current(ids[0]);
  for (const id of ids.slice(1)) f.current(id);
  const refreshed = f.current(ids[0]);
  if (
    first.context.status !== "available" ||
    refreshed.context.status !== "available"
  )
    throw Error("context");
  expect(refreshed.context.version.task?.graphIdentity).not.toBe(
    first.context.version.task?.graphIdentity,
  );
  expect(refreshed.savedGraph).toEqual({ status: "none" });
  expect(
    (
      await f.actions.admission.preflight(
        {
          action: { kind: "start", taskId: ids[0] },
          expected: first.context.version,
        },
        f.caller,
      )
    ).kind,
  ).toBe("error");
  const path = join(
    f.root,
    ".cadence",
    "assistant",
    "tasks",
    ids[0],
    "task.json",
  );
  writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
  const edited = f.current(ids[0]);
  expect(
    edited.context.status === "available" &&
      edited.context.version.task?.graphIdentity,
  ).not.toBe(refreshed.context.version.task?.graphIdentity);
  expect(
    (
      await f.actions.admission.preflight(
        {
          action: { kind: "start", taskId: ids[0] },
          expected: refreshed.context.version,
        },
        f.caller,
      )
    ).kind,
  ).toBe("error");
  writeFileSync(join(f.root, "AGENTS.md"), "New actual project hints");
  expect(() => f.current(ids[0])).toThrow();
  expect(tree(f.h.reader.files.directory)).toEqual(before);
  expect(f.contacts()).toBe(0);
});
