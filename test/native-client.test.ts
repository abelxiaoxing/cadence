import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EnvHttpProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from "undici";
import { afterEach, expect, it, vi } from "vitest";
import { NativeConnection } from "../src/native-client.ts";
import { exportNative } from "../src/native-export.ts";
import {
  NativeHistory,
  type NativeViews,
  value,
} from "../src/native-history.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { ServiceClient } from "../src/service-client.ts";
import {
  type Action,
  type ExportRequest,
  encodeExportFrame,
  type ReadCursor,
  type Receipt,
} from "../src/service-contract.ts";
import { confirm, prepare } from "../web/src/client/actions.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("native owner absence is readonly and never creates task/service state or a fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "native-absent-"));
  vi.stubEnv("XDG_STATE_HOME", join(root, "state"));
  const connection = new NativeConnection();
  await expect(connection.attach(root)).rejects.toThrow();
  await connection.detach();
  expect(existsSync(join(root, "state"))).toBe(false);
  expect(existsSync(join(root, ".cadence"))).toBe(false);
});
it("native local capability never traverses an ambient provider proxy", async () => {
  const f = await acceptingFixture("generated");
  vi.stubEnv("XDG_STATE_HOME", join(f.dir, "state"));
  if (process.platform === "win32")
    vi.stubEnv("LOCALAPPDATA", join(f.dir, "state"));
  let proxyContacts = 0;
  const proxy = createServer((_req, res) => {
    proxyContacts++;
    res.writeHead(502);
    res.end();
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const address = proxy.address();
  if (!address || typeof address === "string") throw Error("fixture");
  const route = `http://127.0.0.1:${address.port}`;
  const previous = getGlobalDispatcher();
  const owned = new EnvHttpProxyAgent({
    httpProxy: route,
    httpsProxy: route,
    noProxy: "",
  });
  const connection = new NativeConnection();
  try {
    // Actual public proxy dispatcher is a fixture prerequisite, never a fetch mock.
    setGlobalDispatcher(owned);
    await connection.attach(f.root);
    expect(connection.session?.authority).toBe("local");
    expect(proxyContacts).toBe(0);
    expect(getGlobalDispatcher()).toBe(owned);
    await connection.detach();
    expect(getGlobalDispatcher()).toBe(owned);
  } finally {
    setGlobalDispatcher(previous); // restore only the test's own temporary replacement
    await connection.detach();
    await owned.close();
    await f.close();
    await new Promise<void>((r) => {
      proxy.close(() => r());
      proxy.closeAllConnections();
    });
  }
}, 20000);
it("actual compiled owner: native local compatibility, retained IDs/readers/export and uncertain detach slot retention", async () => {
  const f = await acceptingFixture("generated");
  vi.stubEnv("XDG_STATE_HOME", join(f.dir, "state"));
  if (process.platform === "win32")
    vi.stubEnv("LOCALAPPDATA", join(f.dir, "state"));
  const connection = new NativeConnection();
  let cleanup: unknown;
  try {
    const c = await connection.attach(f.root);
    expect(connection.compatible()).toBe(true);
    expect(connection.session?.authority).toBe("local");
    expect(connection.session?.capabilities.actions).toBe(false);
    expect(f.contacts()).toBe(0);
    const session = connection.session!;
    const catalog = value(await c.models());
    value(
      await c.chooseModel({
        expected: catalog.version,
        choice: {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    );
    expect((await connection.refresh()).capabilities.actions).toBe(true);
    const submit = async (action: Action) => {
      const view = value(
        await c.current({
          storeId: session.storeId,
          taskId: action.kind === "create" ? null : action.taskId,
        }),
      );
      if (view.context.status !== "available")
        throw Error("current unavailable");
      return value(
        await confirm(c, value(await prepare(c, view.context.version, action))),
      );
    };
    const settle = async (initial: Receipt, execution = false) => {
      let receipt = initial;
      await expect
        .poll(
          async () => {
            const r = await c.receipt(initial.commandId);
            if (r.status === "found") receipt = r.receipt;
            const active = value(await c.activeRuns());
            return (
              active.status === "complete" &&
              !active.runs.some((run) => run.runId === initial.runId) &&
              receipt.publication === "published" &&
              (!execution || receipt.execution !== null)
            );
          },
          { timeout: 15000, interval: 100 },
        )
        .toBe(true);
      return receipt;
    };
    const created = await settle(
      await submit({
        kind: "create",
        taskKind: "research",
        goal: "Native retained history 中文 🧪",
      }),
    );
    const taskId = created.created!.taskId;
    const done = await settle(await submit({ kind: "start", taskId }), true);
    expect(done.execution).toBe("completed");
    const snapshot = value(await c.snapshot({ kind: "run", id: done.runId! }));
    const child = snapshot.runs.find((r) => r.childRunId)!;
    expect(child.settlement?.kind).toBe("sdk");
    const output: string[] = [],
      selections: string[] = [];
    let budget = 100;
    const ui: NativeViews = {
      signal: new AbortController().signal,
      current() {
        if (--budget < 0) throw Error("fixture bounded navigation");
      },
      notify: (t) => output.push(t),
      show: async (t) => {
        output.push(t);
      },
      input: async () => "Advisory",
      confirm: async () => true,
      select: async (title, choices) => {
        selections.push(title);
        return choices.find((c) => c.startsWith("Next")) ?? "Return";
      },
    };
    const history = new NativeHistory(c, session.storeId, ui);
    expect(child.result).not.toBeNull();
    const cursor: ReadCursor = {
      storeId: session.storeId,
      scope: { kind: "child", id: child.childRunId! },
      snapshotSeq: snapshot.committedSeq,
      query: null,
      recordId: child.result!.recordId,
      recordVersion: child.result!.version,
      field: child.result!.field,
      offset: 0,
    };
    await history.detail(cursor);
    expect(output.join("\n")).toContain("Advisory:");
    let hitOpened = false;
    ui.select = async (title, choices) => {
      selections.push(title);
      if (
        title.startsWith("Search") &&
        !hitOpened &&
        choices[0]?.startsWith("1.")
      ) {
        hitOpened = true;
        return choices[0];
      }
      return choices.find((c) => c.startsWith("Next")) ?? "Return";
    };
    await history.search({ kind: "task", id: taskId }, snapshot.committedSeq);
    expect(hitOpened).toBe(true);
    expect(output.join("\n")).toContain("Exact hit (UTF-8 range");
    // Every retained category and scope is the same typed reader as the browser.
    ui.select = async (_title, choices) =>
      choices.find((c) => c.startsWith("Next")) ?? "Return";
    for (const reader of [
      "runs",
      "messages",
      "tools",
      "contents",
      "events",
      "checks",
      "changes",
      "reviews",
    ] as const)
      await history.pages(
        reader,
        { kind: "task", id: taskId },
        snapshot.committedSeq,
      );
    for (const scope of [
      { kind: "task" as const, id: taskId },
      { kind: "run" as const, id: done.runId! },
      { kind: "child" as const, id: child.childRunId! },
    ])
      for (const format of ["ndjson", "markdown"] as const) {
        const request: ExportRequest = {
            storeId: session.storeId,
            scope,
            snapshotSeq: snapshot.committedSeq,
            format,
          },
          destination = join(f.dir, `${scope.kind}-${format}.txt`);
        expect(
          await exportNative(
            c,
            request,
            destination,
            new AbortController().signal,
          ),
        ).toBe("complete");
        const bytes = readFileSync(destination, "utf8");
        expect(bytes).toContain("Advisory:");
        expect(bytes).toContain("cadence-public-export/2");
        expect(bytes).toContain('"kind":"trailer"');
        expect(bytes).not.toContain("fabricated-accepting-key");
        await expect(
          exportNative(c, request, destination, new AbortController().signal),
        ).rejects.toThrow();
        expect(readFileSync(destination, "utf8")).toBe(bytes);
      }
    // Observe an old task without losing the independent current stop roster.
    const old = value(
      await c.current({ storeId: session.storeId, taskId: f.legacyId }),
    );
    expect(old.task?.id).toBe(f.legacyId);
    expect(value(await c.activeRuns()).status).toBe("complete");
    const code = await settle(
      await submit({
        kind: "create",
        taskKind: "code",
        goal: "Explicit native-local manual parent check",
      }),
    );
    writeFileSync(
      join(f.root, "native-env-check.mjs"),
      `
import assert from "node:assert/strict";
assert.equal(process.env.HOME, ${JSON.stringify(join(f.dir, "home"))});
assert.equal(process.env.PATH, ${JSON.stringify(process.env.PATH)});
assert.equal(process.env.NO_COLOR, "1");
assert.equal(process.env.CADENCE_SUBAGENT_CHILD, "1");
for (const name of ["CADENCE_WEB_TOKEN", "CADENCE_LOCAL_CAPABILITY", "PI_SESSION_ID"])
  assert.equal(process.env[name], undefined);
assert.equal(Object.values(process.env).some(value => value?.includes("fabricated-accepting-key")), false);
console.log("NATIVE-MANUAL: ordinary launch env, no resolved model auth");
`,
    );
    const checked = await settle(
      await submit({
        kind: "check",
        taskId: code.created!.taskId,
        check: {
          kind: "manual",
          name: "Manual",
          command: `"${process.execPath}" native-env-check.mjs`,
          timeoutMs: 120000,
        },
      }),
      true,
    );
    expect(checked.execution).toBe("completed");
    expect(checked.settlement?.kind).toBe("check");
    if (checked.settlement?.kind === "check")
      expect(checked.settlement.native).toMatchObject({
        outcome: "completed",
        closure: "direct-child-closed",
        exitCode: 0,
      });
    const fetch = globalThis.fetch.bind(globalThis);
    let sessions = 0,
      refuseDetach = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/session")) sessions++;
      if (String(url).endsWith("/detach") && refuseDetach)
        throw Error("fabricated lost detach");
      return fetch(url, init);
    });
    await expect(connection.detach()).rejects.toThrow();
    await expect(connection.attach(f.root)).rejects.toThrow();
    expect(sessions).toBe(0);
    expect(connection.client).toBe(c);
    refuseDetach = false;
    await connection.detach();
    expect(connection.client).toBeUndefined();
  } catch (error) {
    writeFileSync(
      join(f.dir, "native-client-failure.txt"),
      error instanceof Error
        ? (error.stack ?? error.message)
        : "unknown native test failure",
    );
    throw error;
  } finally {
    vi.restoreAllMocks();
    try {
      await connection.detach();
    } catch (error) {
      cleanup = error;
    }
    try {
      await f.close();
    } catch (error) {
      cleanup ??= error;
    }
  }
  if (cleanup) throw cleanup;
}, 60000);
it("native export verifies digest/EOF, refuses overwrites/links and preserves interrupted output", async () => {
  const root = mkdtempSync(join(tmpdir(), "native-export-"));
  const request: ExportRequest = {
    storeId: randomUUID(),
    scope: { kind: "task", id: randomUUID() },
    snapshotSeq: "1",
    format: "ndjson",
  };
  const coverage = {
    observed: "complete",
    source: "complete",
    redacted: false,
    omissions: [],
  } as const;
  const manifest: any = {
    exportId: randomUUID(),
    ordinal: 1,
    event: {
      kind: "manifest",
      schema: "cadence-public-export/2",
      request,
      coverage,
      serviceProtocol: 1,
      workerProtocol: 2,
      provenance: {
        exporterBuildSha256: "1".repeat(64),
        capturePolicy: "public-text-tools/2",
      },
    },
  };
  const encoded = encodeExportFrame(manifest, "ndjson");
  const trailer: any = {
    exportId: manifest.exportId,
    ordinal: 2,
    event: {
      kind: "trailer",
      complete: true,
      frames: 1,
      encodedBytes: Buffer.byteLength(encoded),
      sha256: createHash("sha256").update(encoded).digest("hex"),
      committedSeq: "1",
      coverage,
    },
  };
  for (const variant of [
    "bad-digest",
    "missing-trailer",
    "post-trailer-failure",
  ]) {
    const transport: any = {
      async *export() {
        yield manifest;
        if (variant !== "missing-trailer")
          yield variant === "bad-digest"
            ? {
                ...trailer,
                event: { ...trailer.event, sha256: "0".repeat(64) },
              }
            : trailer;
        if (variant === "post-trailer-failure")
          throw Error("lost original EOF");
      },
    };
    const path = join(root, variant);
    await expect(
      exportNative(
        new ServiceClient(transport),
        request,
        path,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(readFileSync(path, "utf8")).toBe(encoded);
  }
  writeFileSync(join(root, "existing"), "preserve");
  symlinkSync(join(root, "existing"), join(root, "linked"));
  const client = new ServiceClient({
    async *export() {
      yield manifest;
      yield trailer;
    },
  } as any);
  await expect(
    exportNative(
      client,
      request,
      join(root, "linked"),
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(readFileSync(join(root, "existing"), "utf8")).toBe("preserve");

  // Deterministic deadline injection, not a real ten-second network wait. Finite
  // native requests stay bounded; an actively progressing export has no total
  // ten-second ceiling and still needs its original trailer/EOF.
  const epoch = randomUUID();
  vi.spyOn(ServiceCoordination.prototype, "localAccess").mockReturnValue({
    endpoint: "http://127.0.0.1:17423",
    epoch,
    capability: "a".repeat(43),
  });
  const deadlines: AbortController[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    expect(milliseconds).toBe(10000);
    const controller = new AbortController();
    deadlines.push(controller);
    return controller.signal;
  });
  let exportSignal: AbortSignal | null | undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).endsWith("/session"))
      return Response.json(
        {
          kind: "ok",
          value: {
            protocol: 1,
            storeId: request.storeId,
            epoch,
            accessGeneration: 1,
            authority: "local",
            csrf: null,
            capabilities: {
              actions: false,
              manualChecks: false,
              history: true,
            },
          },
        },
        { headers: { "x-cadence-attachment": randomUUID() } },
      );
    if (String(url).endsWith("/detach"))
      return Response.json({ kind: "ok", value: null });
    expect(new URL(String(url)).pathname).toBe("/api/v1/export");
    exportSignal = init?.signal;
    let first = true;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (first) {
            first = false;
            controller.enqueue(Buffer.from(encoded));
            return;
          }
          // Model the original native fetch deadline firing while bytes flow.
          for (const deadline of deadlines) deadline.abort();
          if (exportSignal?.aborted)
            controller.error(new Error("total deadline"));
          else {
            controller.enqueue(
              Buffer.from(encodeExportFrame(trailer, "ndjson")),
            );
            controller.close();
          }
        },
      }),
    );
  });
  const connection = new NativeConnection();
  try {
    const native = await connection.attach(root);
    expect(deadlines).toHaveLength(1);
    deadlines.length = 0;
    const caller = new AbortController();
    const destination = join(root, " 汉🧪 complete export ");
    await expect(
      exportNative(native, request, destination, caller.signal),
    ).resolves.toBe("complete");
    expect(exportSignal?.aborted).toBe(false);
    expect(readFileSync(destination, "utf8")).toBe(
      encoded + encodeExportFrame(trailer, "ndjson"),
    );
  } finally {
    await connection.detach();
  }
});
