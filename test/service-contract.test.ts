import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ActionAdmission } from "../src/service/admission.ts";
import type {
  AdmissionCommit,
  AdmissionIntent,
  AdmissionOwner,
  AdmissionPersistence,
  Caller,
  StoredCommand,
  StoredLookup,
} from "../src/service/ports.ts";
import {
  ProjectionTracker,
  ServiceClient,
  type ServiceTransport,
} from "../src/service-client.ts";
import type * as contract from "../src/service-contract.ts";
import type {
  Action,
  ActionPreview,
  CaptureCoverage,
  CaptureFrame,
  Command,
  ContentRef,
  ContextVersion,
  Graph,
  NativeSettlement,
  ReadCursor,
  Receipt,
  Reply,
  RunProjection,
  Snapshot,
  WorkerPublicRequest,
} from "../src/service-contract.ts";
import * as facade from "../src/service-contract.ts";
import * as worker from "../src/worker-public.mjs";

describe.each([
  { name: "service facade", contract: facade },
  { name: "direct maintained JS", contract: { ...facade, ...worker } },
])("shared vectors: $name", ({ contract }) => {
  const {
    advanceCapture,
    assertWorkerEnvelopeSize,
    canonicalJson,
    decodeAction,
    decodeCaptureFrame,
    decodeCommand,
    decodeContext,
    decodeCoverage,
    decodeCursor,
    decodeDetailPage,
    decodeGraph,
    decodeHandoff,
    decodeId,
    decodeNativeSettlement,
    decodePreflight,
    decodeReceipt,
    decodeReceiptLookup,
    decodeRunProjection,
    decodeSearchPage,
    decodeSnapshot,
    decodeWorkerPublicRequest,
    ERROR_CODES,
    errorStatus,
    GRAPH_SCHEMA,
    LIMITS,
    parseWireJson,
    publicError,
  } = contract;

  let idCounter = 0;
  const id = () =>
    `00000000-0000-4000-8000-${(++idCounter).toString(16).padStart(12, "0")}`;
  const hash = "a".repeat(64);
  const coverage: CaptureCoverage = {
    observed: "complete",
    source: "complete",
    redacted: false,
    omissions: [],
  };
  function ref(
    field: ContentRef["field"] = "final-text",
    bytes = 4,
  ): ContentRef {
    return { recordId: id(), version: 1, field, bytes, sha256: hash };
  }
  function context(): ContextVersion {
    return {
      epoch: id(),
      accessGeneration: 1,
      configRev: 1,
      controlRev: 1,
      workspaceId: id(),
      cwdId: id(),
      model: {
        sourceSelectionId: id(),
        provider: "fabricated",
        model: "fixture",
        api: "openai-completions",
        thinking: "off",
      },
      checkEnvGeneration: 1,
      checkoutGeneration: 0,
      observation: { identity: hash, complete: true },
      task: {
        id: id(),
        kind: "code",
        revision: 1,
        identity: hash,
        graphRevision: 1,
        graphIdentity: hash,
      },
    };
  }
  function graph(c = context()): Graph {
    return {
      schema: GRAPH_SCHEMA,
      taskId: c.task!.id,
      taskKind: c.task!.kind,
      taskRevision: 1,
      revision: 1,
      planRevision: 1,
      plan: ref("plan"),
      assignments: [
        {
          id: "inspect",
          purpose: "research",
          instructions: "Read the chosen file",
          expectedOutput: "Observed facts",
          role: { role: "design-explorer", sha256: hash },
          model: c.model,
          dependencies: [],
        },
      ],
    };
  }
  function native(): NativeSettlement {
    return {
      outcome: "completed",
      closure: "direct-child-closed",
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdin: "delivered",
      final: "valid",
      cleanup: "settled",
      capture: coverage,
    };
  }
  function receipt(commandId = id()): Receipt {
    return {
      commandId,
      operationId: id(),
      runId: id(),
      admission: "accepted",
      committedSeq: "1",
      execution: null,
      settlement: null,
      created: null,
      publication: "pending",
    };
  }
  function run(taskId = id(), c = context()): RunProjection {
    c.task!.id = taskId;
    return {
      taskId,
      runId: id(),
      childRunId: null,
      assignmentId: null,
      admission: {
        operationId: id(),
        commandId: id(),
        kind: "start",
        context: c,
        assignments: [{ assignmentId: "inspect", childRunId: id() }],
        graph: { recordId: id(), revision: 1, sha256: hash },
      },
      lifecycle: "running",
      outcome: null,
      settlement: null,
      reason: null,
      publication: "pending",
      coverage,
      result: null,
    };
  }
  function snapshot(): Snapshot {
    const c = context();
    const storeId = id();
    return {
      protocol: 1,
      storeId,
      epoch: c.epoch,
      scope: { kind: "task", id: c.task!.id },
      committedSeq: "1",
      context: { status: "available", version: c },
      horizon: {
        policy: "active-and-recent",
        historicalRuns: {
          reader: "runs",
          storeId,
          scope: { kind: "task", id: c.task!.id },
          snapshotSeq: "1",
          after: null,
          limit: 50,
        },
      },
      runs: [run(c.task!.id, structuredClone(c))],
    };
  }
  function worker(): WorkerPublicRequest {
    const c = context();
    return {
      protocol: 2,
      taskId: c.task!.id,
      taskKind: "code",
      runId: id(),
      childRunId: id(),
      assignmentId: "inspect",
      purpose: "research",
      model: c.model,
      role: { role: "design-explorer", sha256: hash },
      context: "Root instructions",
      instructions: "Read only",
      prompt: "Investigate",
      handoff: { graphRevision: 1, inputs: [] },
    };
  }
  function unwrap<T>(reply: Reply<T>): T {
    expect(reply.kind).toBe("ok");
    if (reply.kind !== "ok") throw new Error(reply.error.code);
    return reply.value;
  }
  function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  /** Injected-memory ports only. No disk durability, SDK/provider/native process,
   * HTTP/authentication or product acceptance is claimed by this fixture. */
  function fixture() {
    let current = context();
    let selectedGraph = graph(current);
    let plan = "Read before editing";
    let now = 1_800_000_000_000;
    let seq = 0;
    let active: string | null = null;
    let lookupMode: "normal" | "inconclusive" | "throw" = "normal";
    let commitMode:
      | "normal"
      | "uncertain"
      | "throw-before"
      | "throw-after"
      | "refused" = "normal";
    let beforeObserve: (() => Promise<void>) | undefined;
    let beforeCommit: (() => Promise<void>) | undefined;
    let afterCommit: (() => void) | undefined;
    const rows = new Map<string, StoredCommand>();
    const calls: string[] = [];
    const launches: AdmissionIntent[] = [];
    const stops: string[] = [];
    const reasons: string[] = [];
    const targets = new Map<string, "active" | "settled" | "unknown">();
    const caller: Caller = {
      attachmentId: id(),
      authority: "browser",
      accessGeneration: 1,
    };
    const persistence: AdmissionPersistence = {
      async lookup(commandId): Promise<StoredLookup> {
        calls.push("lookup");
        if (lookupMode === "throw") throw new Error("SECRET exception");
        if (lookupMode === "inconclusive") return { status: "inconclusive" };
        const row = rows.get(commandId);
        return row
          ? { status: "found", record: structuredClone(row) }
          : { status: "absent", committedSeq: String(seq) };
      },
      async commit(intent): Promise<AdmissionCommit> {
        calls.push("commit-begin");
        await beforeCommit?.();
        if (commitMode === "throw-before") throw new Error("SECRET exception");
        if (commitMode === "uncertain") return { status: "uncertain" };
        if (commitMode === "refused")
          return {
            status: "refused",
            error: publicError("recording-exhausted"),
          };
        const old = rows.get(intent.commandId);
        if (old) return { status: "existing", record: structuredClone(old) };
        if (intent.identity.kind === "action") {
          if (
            canonicalJson(intent.identity.expected) !== canonicalJson(current)
          )
            return { status: "refused", error: publicError("stale") };
          current.controlRev++;
        }
        const recorded: StoredCommand = {
          identity: structuredClone(intent.identity),
          receipt: {
            commandId: intent.commandId,
            operationId: intent.operationId,
            runId: intent.runId,
            admission: "accepted",
            committedSeq: String(++seq),
            execution: null,
            settlement: null,
            created: intent.createdTaskId
              ? {
                  kind: "task",
                  taskId: intent.createdTaskId,
                  state: "reserved",
                }
              : null,
            publication: "pending",
          },
        };
        rows.set(intent.commandId, recorded);
        calls.push("committed");
        afterCommit?.();
        if (commitMode === "throw-after") throw new Error("SECRET lost ack");
        return { status: "committed", record: structuredClone(recorded) };
      },
    };
    const owner: AdmissionOwner = {
      async observe(action): Promise<ActionPreview> {
        calls.push("observe");
        await beforeObserve?.();
        return structuredClone({
          version: current,
          action,
          rootLabel: "/fixture",
          cwdLabel: "/fixture",
          readablePlan: plan,
          graph: selectedGraph,
          activeRunId: active,
          issues: [],
          configuredChecks: [],
          checksRevision: 1,
          reviewRunId: null,
        });
      },
      currentAccess: () => ({
        epoch: current.epoch,
        accessGeneration: current.accessGeneration,
      }),
      run: (runId) =>
        targets.has(runId)
          ? {
              runId,
              epoch: current.epoch,
              state: targets.get(runId)!,
              cancelRequested: stops.includes(runId),
            }
          : undefined,
      activate: (intent) => {
        calls.push("activate");
        launches.push(intent);
        if (intent.runId) {
          active = intent.runId;
          targets.set(intent.runId, "active");
        }
      },
      requestCancel: (command) => {
        calls.push("cancel-request");
        if (!stops.includes(command.runId)) stops.push(command.runId);
      },
      quarantine: (reason) => {
        reasons.push(reason);
      },
    };
    const clock = { now: () => now, uuid: id };
    const admission = new ActionAdmission(persistence, owner, clock);
    const action = (): Action => ({ kind: "start", taskId: current.task!.id });
    async function prepare(
      selected = action(),
      user = caller,
    ): Promise<Command> {
      const expected = structuredClone(current);
      const prepared = unwrap(
        await admission.preflight({ expected, action: selected }, user),
      );
      return {
        commandId: id(),
        expected,
        action: selected,
        grant: prepared.grant,
      };
    }
    return {
      admission,
      persistence,
      owner,
      clock,
      caller,
      rows,
      calls,
      launches,
      stops,
      reasons,
      targets,
      action,
      prepare,
      get current() {
        return current;
      },
      set current(value) {
        current = value;
      },
      get graph() {
        return selectedGraph;
      },
      set graph(value) {
        selectedGraph = value;
      },
      set plan(value: string) {
        plan = value;
      },
      set active(value: string | null) {
        active = value;
      },
      set now(value: number) {
        now = value;
      },
      get now() {
        return now;
      },
      set lookupMode(value: typeof lookupMode) {
        lookupMode = value;
      },
      set commitMode(value: typeof commitMode) {
        commitMode = value;
      },
      set beforeObserve(value: typeof beforeObserve) {
        beforeObserve = value;
      },
      set beforeCommit(value: typeof beforeCommit) {
        beforeCommit = value;
      },
      set afterCommit(value: typeof afterCommit) {
        afterCommit = value;
      },
    };
  }

  describe("portable closed DTOs (no runtime authentication or native evidence)", () => {
    it("keeps portable files independent of Node/Pi/React and legacy Buffer decoder", () => {
      for (const path of [
        "src/service-contract.ts",
        "src/worker-public.mjs",
        "src/worker-public.d.mts",
        "src/service-client.ts",
        ...["core", "domain", "capture", "history", "budget"].map(
          (name) => `src/service/contracts/${name}.ts`,
        ),
      ]) {
        const source = readFileSync(path, "utf8");
        expect(source).not.toMatch(
          /(?:from|import\()\s*["'](?:node:|@earendil|react|.*task-types)/,
        );
        expect(source).not.toMatch(/\b(?:Buffer|process|require)\s*[.(]/);
      }
    });
    it.each([
      "../file",
      id().toUpperCase().replace("0000", "ZZZZ"),
      "00000000-0000-1000-8000-000000000001",
      "00000000-0000-4000-7000-000000000001",
      "",
      null,
    ])("refuses non-v4/path ID %s", (value) => {
      expect(() => decodeId(value)).toThrow();
    });
    it("rejects duplicate escaped keys, malformed numbers/trailing JSON and duplicate nested keys", () => {
      for (const source of [
        '{"a":1,"\\u0061":2}',
        '{"nested":{"x":1,"x":2}}',
        "[1,]",
        '{"x":01}',
        '{"x":1e999}',
        "{}{}",
        '{"x":NaN}',
        '"\\ud800"',
      ])
        expect(() => parseWireJson(source)).toThrow();
      expect(
        parseWireJson('{"s":"a\\"b","nested":[true,null,-0.1e2]}'),
      ).toEqual({
        s: 'a"b',
        nested: [true, null, -10],
      });
      expect(() => parseWireJson(" ".repeat(LIMITS.controlBytes + 1))).toThrow(
        "oversize",
      );
      expect(() =>
        parseWireJson(`${"[".repeat(66)}0${"]".repeat(66)}`),
      ).toThrow();
    });
    it("canonicalizes object key order only, rejects getters/undefined/cycles without invoking them", () => {
      expect(canonicalJson({ b: [2, 1], a: "é" })).toBe(
        canonicalJson({ a: "é", b: [2, 1] }),
      );
      expect(canonicalJson({ a: [1, 2] })).not.toBe(
        canonicalJson({ a: [2, 1] }),
      );
      const get = vi.fn(() => "secret");
      const hostile = {
        get kind() {
          return get();
        },
      };
      expect(() => decodeAction(hostile)).toThrow();
      expect(get).not.toHaveBeenCalled();
      expect(() => canonicalJson({ value: undefined })).toThrow();
      const cycle: { cycle?: unknown } = {};
      cycle.cycle = cycle;
      expect(() => canonicalJson(cycle)).toThrow();
      expect(() =>
        decodeAction({
          kind: "create",
          taskKind: "code",
          goal: "ok",
          apiKey: "secret",
        }),
      ).toThrow();
    });
    it("rejects inherited/symbol/hidden/accessor DTO fields without calling getters or toJSON", () => {
      const action = { kind: "create", taskKind: "code", goal: "😀" };
      const get = vi.fn(() => "code");
      const inherited = Object.assign(Object.create({ goal: "inherited" }), {
        kind: "create",
        taskKind: "code",
      });
      const hidden = Object.defineProperty({ ...action }, "goal", {
        enumerable: false,
      });
      const accessor = Object.defineProperty({ ...action }, "taskKind", {
        get,
      });
      const toJSON = vi.fn(() => action);
      for (const input of [
        inherited,
        hidden,
        accessor,
        { ...action, [Symbol()]: 1 },
        { ...action, toJSON },
      ])
        expect(() => decodeAction(input)).toThrow();
      const g = graph();
      const arrayGetter = Object.defineProperty([...g.assignments], "0", {
        get,
      });
      for (const assignments of [
        arrayGetter,
        new Array(1),
        Object.assign([...g.assignments], { extra: 1 }),
      ])
        expect(() => decodeGraph({ ...g, assignments })).toThrow();
      expect(get).not.toHaveBeenCalled();
      expect(toJSON).not.toHaveBeenCalled();
      expect(decodeAction(parseWireJson(JSON.stringify(action)))).toEqual(
        action,
      );
      const prototypeKey = parseWireJson('{"__proto__":{"polluted":true}}');
      expect(Object.getPrototypeOf(prototypeKey)).toBeNull();
      expect(canonicalJson(prototypeKey)).toBe(
        '{"__proto__":{"polluted":true}}',
      );
      expect(() => decodeAction(prototypeKey)).toThrow();
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    });
    it("enforces byte limits, closed nested context and protocol versions", () => {
      expect(() =>
        decodeAction({
          kind: "create",
          taskKind: "code",
          goal: "é".repeat(4097),
        }),
      ).toThrow("oversize");
      const c = context();
      expect(decodeContext(c)).toEqual(c);
      for (const value of [
        { ...c, progressSeq: "9" },
        { ...c, controlRev: 0 },
        { ...c, configRev: 0.1 },
        { ...c, model: { ...c.model, headers: {} } },
        { ...c, task: { ...c.task, graphIdentity: null } },
      ])
        expect(() => decodeContext(value)).toThrow();
      expect(() => decodeSnapshot({ ...snapshot(), protocol: 2 })).toThrow();
      expect(() =>
        decodeWorkerPublicRequest({ ...worker(), protocol: 1 }),
      ).toThrow();
      expect(() =>
        decodeCommand({
          commandId: id(),
          expected: c,
          grant: id(),
          action: { kind: "start", taskId: c.task!.id },
          surface: "terminal",
        }),
      ).toThrow();
    });
    it("validates graph revisions, purpose/role capability and finite unique acyclic edges", () => {
      const valid = graph();
      expect(decodeGraph(valid)).toEqual(valid);
      const dep = {
        source: { kind: "current", assignmentId: "inspect" },
        range: null,
        requireCompleteObservation: false,
      };
      const second = {
        ...valid.assignments[0],
        id: "review",
        dependencies: [dep],
      };
      expect(
        decodeGraph({ ...valid, assignments: [...valid.assignments, second] })
          .assignments,
      ).toHaveLength(2);
      const invalids = [
        { ...valid, revision: 0 },
        { ...valid, schema: "cadence-graph/1" },
        { ...valid, planRevision: 2 },
        { ...valid, assignments: [] },
        { ...valid, assignments: [...valid.assignments, ...valid.assignments] },
        {
          ...valid,
          assignments: Array.from({ length: 17 }, (_, i) => ({
            ...second,
            id: `item-${i}`,
          })),
        },
        {
          ...valid,
          assignments: [
            {
              ...second,
              dependencies: [
                {
                  ...dep,
                  source: { kind: "current", assignmentId: "missing" },
                },
              ],
            },
          ],
        },
        {
          ...valid,
          assignments: [{ ...valid.assignments[0], dependencies: [dep] }],
        },
        {
          ...valid,
          assignments: [
            ...valid.assignments,
            { ...second, dependencies: [dep, dep] },
          ],
        },
        {
          ...valid,
          assignments: [
            {
              ...valid.assignments[0],
              dependencies: [
                { ...dep, source: { kind: "current", assignmentId: "review" } },
              ],
            },
            second,
          ],
        },
        {
          ...valid,
          taskKind: "research",
          assignments: [
            {
              ...valid.assignments[0],
              purpose: "edit",
              role: { role: "implementation-worker", sha256: hash },
            },
          ],
        },
        {
          ...valid,
          assignments: [
            {
              ...valid.assignments[0],
              role: { role: "implementation-worker", sha256: hash },
            },
          ],
        },
        {
          ...valid,
          assignments: [
            {
              ...valid.assignments[0],
              instructions: "x".repeat(LIMITS.instructionsBytes + 1),
            },
          ],
        },
        { ...valid, assignments: [{ ...valid.assignments[0], id: "../path" }] },
      ];
      for (const value of invalids) expect(() => decodeGraph(value)).toThrow();
      expect(() =>
        decodeGraph({ ...valid, extra: "x".repeat(LIMITS.graphBytes) }),
      ).toThrow("oversize");
    });
    it("preserves historical exact references and refuses out-of-source ranges", () => {
      const g = graph();
      const source = {
        kind: "historical" as const,
        runId: id(),
        childRunId: id(),
        result: ref(),
      };
      g.assignments[0].dependencies = [
        {
          source,
          range: { start: 0, end: 4 },
          requireCompleteObservation: true,
        },
      ];
      expect(decodeGraph(g)).toEqual(g);
      expect(() =>
        decodeGraph({
          ...g,
          assignments: [
            {
              ...g.assignments[0],
              dependencies: [
                {
                  ...g.assignments[0].dependencies[0],
                  range: { start: 0, end: 5 },
                },
              ],
            },
          ],
        }),
      ).toThrow();
    });
    it("separates 512KiB graph/1MiB control, 96KiB public and actual 128KiB worker envelope", () => {
      const input = worker();
      expect(decodeWorkerPublicRequest(input)).toEqual(input);
      const huge = {
        ...input,
        context: "x".repeat(32768),
        prompt: "x".repeat(32768),
        instructions: "x".repeat(16384),
        handoff: {
          graphRevision: 1,
          inputs: [0, 1].map((dependencyIndex) => ({
            assignmentId: "inspect",
            dependencyIndex,
            runId: id(),
            childRunId: id(),
            result: ref("final-text", 16384),
            range: null,
            text: "x".repeat(16384),
            coverage,
          })),
        },
      };
      expect(() => decodeWorkerPublicRequest(huge)).toThrow("oversize");
      // Exact actual serialized envelope, including escaped strings and fake auth, not a sum of fields.
      const serialized = JSON.stringify({
        public: input,
        auth: "x".repeat(LIMITS.workerRequestBytes),
      });
      expect(() => assertWorkerEnvelopeSize(serialized)).toThrow("oversize");
      expect(() =>
        assertWorkerEnvelopeSize(" ".repeat(LIMITS.workerRequestBytes)),
      ).not.toThrow();
      expect(() =>
        assertWorkerEnvelopeSize("é".repeat(LIMITS.workerRequestBytes / 2 + 1)),
      ).toThrow();
      expect(() =>
        decodeWorkerPublicRequest({
          ...input,
          taskKind: "research",
          purpose: "edit",
          role: { role: "implementation-worker", sha256: hash },
        }),
      ).toThrow("forbidden");
    });
    it("does not silently clip predecessor input and preserves supplied/omitted coverage", () => {
      const value = {
        assignmentId: "inspect",
        dependencyIndex: 0,
        runId: id(),
        childRunId: id(),
        result: ref("final-text", 4),
        range: null,
        text: "éé",
        coverage: {
          ...coverage,
          source: "limited",
          redacted: true,
          omissions: ["source-limit"],
        },
      };
      expect(
        decodeHandoff({ graphRevision: 1, inputs: [value] }).inputs[0].coverage,
      ).toEqual(value.coverage);
      for (const inputs of [
        [{ ...value, text: "é" }],
        [value, value],
        [{ ...value, range: { start: 3, end: 5 } }],
        [{ ...value, text: "x".repeat(16385) }],
        [0, 1, 2].map((dependencyIndex) => ({
          ...value,
          dependencyIndex,
          text: "x".repeat(16384),
          result: ref("final-text", 16384),
        })),
      ])
        expect(() => decodeHandoff({ graphRevision: 1, inputs })).toThrow();
    });
    it("keeps genuine frame identity/header progression separate from detail/native proof", () => {
      const childRunId = id();
      const first: CaptureFrame = {
        protocol: 2,
        childRunId,
        workerSeq: 1,
        observedMs: 0,
        event: { kind: "ready", requestProtocol: 2 },
      };
      const start = { childRunId, workerSeq: 0, observedMs: 0, final: false };
      const next = advanceCapture(start, first).position;
      for (const bad of [
        { ...first, protocol: 1 },
        { ...first, childRunId: id() },
        { ...first, workerSeq: 3 },
        { ...first, event: { kind: "ready", requestProtocol: 1 } },
        { ...first, auth: { apiKey: "secret" } },
      ])
        expect(() => advanceCapture(start, bad)).toThrow();
      expect(() => advanceCapture(next, { ...first, workerSeq: 2 })).toThrow();
      const final = {
        ...first,
        workerSeq: 2,
        event: {
          kind: "final",
          messageId: id(),
          detailId: id(),
          stopReason: "stop",
        },
      };
      const ended = advanceCapture(next, final).position;
      expect(ended.final).toBe(true);
      expect(() => advanceCapture(ended, { ...final, workerSeq: 3 })).toThrow();
      expect(() =>
        decodeCaptureFrame({
          ...first,
          workerSeq: 2,
          event: {
            kind: "detail-chunk",
            detailId: id(),
            offset: 0,
            text: "é".repeat(4097),
          },
        }),
      ).toThrow("oversize");
      expect(() =>
        decodeCaptureFrame({
          ...first,
          event: {
            kind: "tool-start",
            callId: id(),
            sourceId: "unsafe/id",
            name: "read",
            argsDetailId: id(),
          },
        }),
      ).toThrow();
      expect(() =>
        decodeCoverage({ ...coverage, omissions: ["gap"] }),
      ).toThrow();
    });
    it("accepts all finite rich event variants without raw payload escape hatches", () => {
      const messageId = id(),
        detailId = id(),
        callId = id();
      const events = [
        {
          kind: "message-start",
          messageId,
          role: "assistant",
          source: { disposition: "unavailable", value: null },
          resultCallId: null,
        },
        { kind: "message-text", messageId, blockId: id(), detailId },
        {
          kind: "message-end",
          messageId,
          finalDetailId: detailId,
          finalBlockCount: 1,
          stopReason: "stop",
        },
        {
          kind: "tool-start",
          callId,
          source: { disposition: "observed", value: "safe_id" },
          declaration: null,
          name: "read",
          argsDetailId: detailId,
        },
        { kind: "tool-update", callId, detailId, semantics: "snapshot" },
        {
          kind: "tool-end",
          callId,
          resultDetailId: detailId,
          isError: true,
          association: "execution-only",
          startObserved: true,
          declaration: null,
          source: { disposition: "unavailable", value: null },
          name: "read",
        },
        {
          kind: "detail-begin",
          detailId,
          descriptor: {
            owner: {
              kind: "tool",
              callId,
              blockId: id(),
              index: 0,
              stage: "result",
            },
            field: "tool-result",
            encoding: "utf8",
          },
        },
        { kind: "detail-chunk", detailId, offset: 0, text: "é" },
        { kind: "detail-end", detailId, bytes: 2, sha256: hash, coverage },
        { kind: "capture-status", coverage },
        { kind: "worker-failure", code: "cleanup" },
      ];
      for (const event of events) {
        const frame = {
          protocol: 2,
          childRunId: id(),
          workerSeq: 2,
          observedMs: 1,
          event,
        };
        expect(decodeCaptureFrame(frame).event).toEqual(event);
        expect(() =>
          decodeCaptureFrame({ ...frame, event: { ...event, raw: {} } }),
        ).toThrow();
      }
    });
    it.each([
      "closure",
      "exitCode",
      "signal",
      "stdin",
      "final",
      "cleanup",
      "capture",
    ] as const)("completed native facts reject broken %s", (field) => {
      const replacements = {
        closure: "unconfirmed",
        exitCode: 1,
        signal: "SIGTERM",
        stdin: "failed",
        final: "missing",
        cleanup: "unconfirmed",
        capture: { ...coverage, observed: "incomplete" },
      };
      expect(() =>
        decodeNativeSettlement({ ...native(), [field]: replacements[field] }),
      ).toThrow();
      expect(
        decodeNativeSettlement({
          ...native(),
          outcome: "failed",
          exitCode: 0,
          capture: { ...coverage, observed: "incomplete" },
        }).exitCode,
      ).toBe(0);
    });
    it("retains unsigned Windows native exit facts without treating them as success (codec only)", () => {
      for (const exitCode of [0xc000013a, 0xffffffff]) {
        expect(
          decodeNativeSettlement({ ...native(), outcome: "failed", exitCode })
            .exitCode,
        ).toBe(exitCode);
        expect(() =>
          decodeNativeSettlement({ ...native(), exitCode }),
        ).toThrow();
      }
      for (const exitCode of [0x100000000, -2147483649, 1.5])
        expect(() =>
          decodeNativeSettlement({ ...native(), outcome: "failed", exitCode }),
        ).toThrow();
    });
    it("rejects a different task context even in an empty snapshot", () => {
      const value = { ...snapshot(), runs: [] };
      expect(decodeSnapshot(value).runs).toEqual([]);
      expect(() =>
        decodeSnapshot({ ...value, scope: { kind: "task", id: id() } }),
      ).toThrow();
      expect(() =>
        decodeSnapshot({ ...value, context: { ...value.context, task: null } }),
      ).toThrow();
    });
    it("never calls pending receipt/prose/human publication completed execution", () => {
      const r = receipt();
      expect(decodeReceipt(r).execution).toBeNull();
      expect(() => decodeReceipt({ ...r, committedSeq: "01" })).toThrow();
      expect(() =>
        decodeReceipt({ ...r, execution: "completed", closure: "unconfirmed" }),
      ).toThrow();
      expect(
        decodeReceipt({ ...r, execution: "failed", publication: "published" })
          .execution,
      ).toBe("failed");
      expect(() =>
        decodeRunProjection({ ...run(), outcome: "completed" }),
      ).toThrow();
      expect(
        decodeReceiptLookup({ status: "absent", committedSeq: "10" }).status,
      ).toBe("absent");
      expect(
        decodeReceiptLookup({
          status: "inconclusive",
          error: publicError("receipt-inconclusive", "uncertain"),
        }).status,
      ).toBe("inconclusive");
    });
    it("fixes public error labels/status and cannot include arbitrary exception text", () => {
      expect(ERROR_CODES.map(errorStatus)).toContain(507);
      expect(errorStatus("expired-grant")).toBe(410);
      expect(errorStatus("quarantine")).toBe(423);
      expect(() =>
        decodeReceiptLookup({
          status: "inconclusive",
          error: { ...publicError("unavailable"), message: "secret" },
        }),
      ).toThrow();
    });
    it("rejects nonprogressing search continuations and nonliteral hit ranges", () => {
      const content = ref("message", 6);
      const cursor: ReadCursor = {
        storeId: id(),
        scope: { kind: "run", id: id() },
        query: "é",
        snapshotSeq: "3",
        recordId: content.recordId,
        recordVersion: 1,
        field: "message",
        offset: 2,
      };
      const hit = {
        content,
        range: { start: 2, end: 4 },
        preview: "é",
        cursor,
        owner: {
          taskId: id(),
          runId: cursor.scope.id,
          childRunId: id(),
          entity: { kind: "message", id: id(), version: 1 },
        },
      };
      const page = { cursor, hits: [hit], next: null, coverage };
      expect(decodeSearchPage(page)).toEqual(page);
      expect(() =>
        decodeSearchPage({
          ...page,
          hits: [{ ...hit, range: { start: 2, end: 6 } }],
        }),
      ).toThrow();
      for (const offset of [2, 1])
        expect(() =>
          decodeSearchPage({ ...page, hits: [], next: { ...cursor, offset } }),
        ).toThrow();
      expect(
        decodeSearchPage({ ...page, hits: [], next: { ...cursor, offset: 4 } })
          .next?.offset,
      ).toBe(4);
      // IDs are opaque, not lexically ordered. Advancing to another field/record is allowed.
      expect(
        decodeSearchPage({
          ...page,
          next: { ...cursor, recordId: id(), offset: 0 },
        }).next,
      ).not.toBeNull();
    });
    it("binds restart-stable read cursors, UTF-8 detail offsets and search hit identity", () => {
      const content = ref("message", 4);
      const cursor: ReadCursor = {
        storeId: id(),
        scope: { kind: "run", id: id() },
        query: null,
        snapshotSeq: "99",
        recordId: content.recordId,
        recordVersion: 1,
        field: "message",
        offset: 0,
      };
      expect(decodeCursor(cursor)).toEqual(cursor);
      expect(() => decodeCursor({ ...cursor, epoch: id() })).toThrow();
      const page = {
        cursor,
        content,
        range: { start: 0, end: 2 },
        text: "é",
        next: { ...cursor, offset: 2 },
        coverage,
      };
      expect(decodeDetailPage(page)).toEqual(page);
      for (const next of [
        { ...cursor, offset: 1 },
        { ...cursor, storeId: id(), offset: 2 },
        { ...cursor, snapshotSeq: "100", offset: 2 },
      ])
        expect(() => decodeDetailPage({ ...page, next })).toThrow();
      expect(() => decodeDetailPage({ ...page, text: "e" })).toThrow();
      const searchCursor = { ...cursor, query: "é" };
      const search = {
        cursor: searchCursor,
        hits: [
          {
            content,
            range: { start: 0, end: 2 },
            preview: "é",
            cursor: searchCursor,
            owner: {
              taskId: id(),
              runId: cursor.scope.id,
              childRunId: id(),
              entity: { kind: "message", id: id(), version: 1 },
            },
          },
        ],
        next: null,
        coverage,
      };
      expect(decodeSearchPage(search).hits).toHaveLength(1);
      expect(
        decodeSearchPage({
          ...search,
          hits: [],
          next: { ...searchCursor, offset: 2 },
        }).next,
      ).not.toBeNull();
      expect(() =>
        decodeSearchPage({
          ...search,
          hits: [
            {
              ...search.hits[0],
              cursor: { ...searchCursor, recordVersion: 2 },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("fresh-action admission with injected-memory owner/persistence", () => {
    it.each(["commit", "post-commit-observe"] as const)(
      "a quarantine during %s blocks a pending accepted action, not receipt observation",
      async (boundary) => {
        const f = fixture();
        const oldRun = id();
        f.targets.set(oldRun, "active");
        const command = await f.prepare();
        const entered = deferred(),
          release = deferred();
        const wait = async () => {
          entered.resolve();
          await release.promise;
        };
        if (boundary === "commit") f.beforeCommit = wait;
        else
          f.afterCommit = () => {
            f.beforeObserve = wait;
          };
        const pending = f.admission.submit(command, f.caller);
        await entered.promise;
        f.lookupMode = "inconclusive";
        const cancel = await f.admission.cancel(
          { commandId: id(), epoch: f.current.epoch, runId: oldRun },
          f.caller,
        );
        expect(cancel).toMatchObject({
          kind: "error",
          error: { effect: "uncertain" },
        });
        expect(f.stops).toEqual([oldRun]);
        expect(f.reasons).toEqual(["persistence"]);
        f.lookupMode = "normal";
        release.resolve();
        expect(await pending).toMatchObject({
          kind: "error",
          error: { code: "quarantine", effect: "accepted" },
        });
        expect(f.rows.get(command.commandId)?.receipt.admission).toBe(
          "accepted",
        );
        expect(f.launches).toHaveLength(0);
        expect(
          unwrap(await f.admission.submit(command, f.caller)).admission,
        ).toBe("accepted");
        expect(f.launches).toHaveLength(0);
      },
    );
    it.each(["corrupt-selected", "receipt-inconclusive"] as const)(
      "Cancel still requests stop when persistence refuses with %s",
      async (code) => {
        const f = fixture();
        const runId = id();
        f.targets.set(runId, "active");
        f.persistence.commit = async () => ({
          status: "refused",
          error: publicError(code),
        });
        expect(
          await f.admission.cancel(
            { commandId: id(), epoch: f.current.epoch, runId },
            f.caller,
          ),
        ).toMatchObject({
          kind: "error",
          error: { effect: "uncertain" },
        });
        expect(f.stops).toEqual([runId]);
        expect(f.reasons).toEqual(["persistence"]);
        expect(f.rows.size).toBe(0);
      },
    );
    it("an authenticated safety Cancel precedes journal wait; later rotation cannot undo it", async () => {
      const f = fixture();
      const runId = id();
      f.targets.set(runId, "active");
      const entered = deferred(),
        release = deferred();
      f.persistence.commit = async () => {
        entered.resolve();
        await release.promise;
        return { status: "uncertain" };
      };
      const pending = f.admission.cancel(
        { commandId: id(), epoch: f.current.epoch, runId },
        f.caller,
      );
      await entered.promise;
      expect(f.stops).toEqual([runId]);
      f.current.accessGeneration++;
      release.resolve();
      expect(await pending).toMatchObject({
        kind: "error",
        error: { effect: "uncertain" },
      });
      expect(f.stops).toEqual([runId]);
      expect(f.rows.size).toBe(0);
    });
    it("rotation during receipt lookup denies a not-yet-authorized safety Cancel", async () => {
      const f = fixture(),
        runId = id();
      f.targets.set(runId, "active");
      const entered = deferred(),
        release = deferred();
      f.persistence.lookup = async () => {
        entered.resolve();
        await release.promise;
        return { status: "absent", committedSeq: "0" };
      };
      const pending = f.admission.cancel(
        { commandId: id(), epoch: f.current.epoch, runId },
        f.caller,
      );
      await entered.promise;
      f.current.accessGeneration++;
      release.resolve();
      expect(await pending).toMatchObject({ kind: "error" });
      expect(f.stops).toEqual([]);
      expect(f.rows.size).toBe(0);
    });
    it("preflight observes only, does not persist/auth/launch and is bound to exactly displayed input", async () => {
      const f = fixture();
      const c = await f.prepare();
      expect(f.calls).toEqual(["observe"]);
      expect(f.rows.size).toBe(0);
      expect(f.launches).toHaveLength(0);
      const changed = {
        ...c,
        action: { kind: "generate-plan", taskId: f.current.task!.id },
      };
      expect(await f.admission.submit(changed, f.caller)).toMatchObject({
        kind: "error",
        error: { code: "conflict", effect: "none" },
      });
      expect(await f.admission.submit(c, f.caller)).toMatchObject({
        kind: "error",
        error: { code: "consumed-grant" },
      });
      expect(f.launches).toHaveLength(0);
    });
    it("flushes a durable receipt and control revision before effect; exact duplicate/lost reply observes", async () => {
      const f = fixture();
      const c = await f.prepare();
      const first = unwrap(await f.admission.submit(c, f.caller));
      expect(f.calls.indexOf("committed")).toBeLessThan(
        f.calls.indexOf("activate"),
      );
      expect(f.current.controlRev).toBe(2);
      expect(
        unwrap(await f.admission.submit({ ...c, grant: id() }, f.caller)),
      ).toEqual(first);
      expect(f.launches).toHaveLength(1);
      expect(
        await f.admission.submit(
          { ...c, expected: { ...c.expected, configRev: 2 } },
          f.caller,
        ),
      ).toMatchObject({ kind: "error", error: { code: "conflict" } });
      // New owner epoch and no grants still returns historical receipt, never dispatches.
      f.current.epoch = id();
      const restarted = new ActionAdmission(f.persistence, f.owner, f.clock);
      expect(unwrap(await restarted.submit(c, f.caller))).toEqual(first);
      expect(f.launches).toHaveLength(1);
    });
    it("concurrent same-ID submissions launch once; two different-ID Starts cannot both pass", async () => {
      const f = fixture();
      const command = await f.prepare();
      const replies = await Promise.all([
        f.admission.submit(command, f.caller),
        f.admission.submit(command, f.caller),
      ]);
      expect(unwrap(replies[0])).toEqual(unwrap(replies[1]));
      expect(f.launches).toHaveLength(1);
      const g = fixture();
      const other = { ...g.caller, attachmentId: id() };
      const first = await g.prepare();
      const second = await g.prepare(g.action(), other);
      const race = await Promise.all([
        g.admission.submit(first, g.caller),
        g.admission.submit(second, other),
      ]);
      expect(race.map((r) => r.kind)).toEqual(["ok", "error"]);
      expect(g.launches).toHaveLength(1);
      expect(g.rows.size).toBe(1);
      expect(
        await g.admission.preflight(
          { expected: g.current, action: g.action() },
          other,
        ),
      ).toMatchObject({ kind: "error", error: { code: "conflict" } });
    });
    it.each([
      "epoch",
      "accessGeneration",
      "configRev",
      "controlRev",
      "workspaceId",
      "cwdId",
      "checkEnvGeneration",
      "checkoutGeneration",
      "taskIdentity",
      "graphRevision",
      "model",
      "observation",
      "plan",
    ])("stales grant when %s changes, without any effect", async (field) => {
      const f = fixture();
      const c = await f.prepare();
      if (field === "taskIdentity") f.current.task!.identity = "b".repeat(64);
      else if (field === "graphRevision") f.current.task!.graphRevision = 2;
      else if (field === "model") f.current.model.thinking = "high";
      else if (field === "observation")
        f.current.observation.identity = "b".repeat(64);
      else if (field === "plan") f.plan = "Different readable plan";
      else if (["epoch", "workspaceId", "cwdId"].includes(field))
        Object.assign(f.current, { [field]: id() });
      else Object.assign(f.current, { [field]: 2 });
      const result = await f.admission.submit(c, f.caller);
      expect(result.kind).toBe("error");
      expect(f.launches).toHaveLength(0);
      expect(f.rows.size).toBe(0);
    });
    it("does not silently preflight a changed caller-displayed context", async () => {
      const f = fixture();
      const expected = structuredClone(f.current);
      f.current.controlRev++;
      expect(
        await f.admission.preflight({ expected, action: f.action() }, f.caller),
      ).toMatchObject({ kind: "error", error: { code: "stale" } });
      expect(f.rows.size).toBe(0);
    });
    it("expires at exactly 120 seconds and rejects clock rollback/reuse/other attachment", async () => {
      for (const delta of [LIMITS.grantMs, -1]) {
        const f = fixture();
        const c = await f.prepare();
        f.now += delta;
        expect(await f.admission.submit(c, f.caller)).toMatchObject({
          kind: "error",
          error: { code: "expired-grant" },
        });
        expect(f.launches).toHaveLength(0);
      }
      const f = fixture();
      const c = await f.prepare();
      expect(
        await f.admission.submit(c, { ...f.caller, attachmentId: id() }),
      ).toMatchObject({ kind: "error", error: { code: "consumed-grant" } });
      expect(unwrap(await f.admission.submit(c, f.caller)).admission).toBe(
        "accepted",
      );
    });
    it("departure and rotation revoke pending and in-flight confirmations, not accepted work", async () => {
      const f = fixture();
      const c = await f.prepare();
      f.admission.detach(f.caller.attachmentId);
      expect(await f.admission.submit(c, f.caller)).toMatchObject({
        kind: "error",
        error: { code: "consumed-grant" },
      });
      const waiting = deferred();
      const entered = deferred();
      f.beforeObserve = async () => {
        entered.resolve();
        await waiting.promise;
      };
      const pending = f.admission.preflight(
        { expected: f.current, action: f.action() },
        f.caller,
      );
      await entered.promise;
      f.admission.detach(f.caller.attachmentId);
      waiting.resolve();
      expect(await pending).toMatchObject({
        kind: "error",
        error: { code: "stale" },
      });
      f.beforeObserve = undefined;
      const ready = await f.prepare();
      f.afterCommit = () => {
        f.admission.revokeGrants();
        f.current.accessGeneration++;
        f.now += LIMITS.grantMs;
      };
      expect(unwrap(await f.admission.submit(ready, f.caller)).admission).toBe(
        "accepted",
      );
      expect(f.launches).toHaveLength(1);
      expect(f.rows.size).toBe(1);
    });
    it.each(["inconclusive", "throw"] as const)(
      "receipt %s never counts as absent or authorizes effect",
      async (mode) => {
        const f = fixture();
        const c = await f.prepare();
        f.lookupMode = mode;
        const result = await f.admission.submit(c, f.caller);
        expect(result).toMatchObject({
          kind: "error",
          error: { code: "receipt-inconclusive", effect: "uncertain" },
        });
        expect(JSON.stringify(result)).not.toContain("SECRET");
        expect(f.launches).toHaveLength(0);
        expect(f.rows.size).toBe(0);
      },
    );
    it.each(["uncertain", "throw-before", "throw-after", "refused"] as const)(
      "commit %s cannot activate or replay; failed bytes/intents are store-owned",
      async (mode) => {
        const f = fixture();
        const c = await f.prepare();
        f.commitMode = mode;
        expect((await f.admission.submit(c, f.caller)).kind).toBe("error");
        expect(f.launches).toHaveLength(0);
        f.commitMode = "normal";
        if (mode === "throw-after")
          expect(unwrap(await f.admission.submit(c, f.caller)).admission).toBe(
            "accepted",
          );
        else expect((await f.admission.submit(c, f.caller)).kind).toBe("error");
        expect(f.launches).toHaveLength(0);
      },
    );
    it("revalidates post-commit execution context, preserving accepted-but-not-launched truth", async () => {
      for (const change of ["epoch", "model"] as const) {
        const f = fixture();
        const c = await f.prepare();
        f.afterCommit = () => {
          if (change === "epoch") f.current.epoch = id();
          else f.current.model.model = "different";
        };
        expect((await f.admission.submit(c, f.caller)).kind).toBe("error");
        expect(f.rows.size).toBe(1);
        expect(f.launches).toHaveLength(0);
        expect(f.reasons).not.toHaveLength(0);
      }
    });
    it("snapshots mutable caller action/context before queued async work", async () => {
      const f = fixture();
      const c = await f.prepare();
      const promise = f.admission.submit(c, f.caller);
      c.expected.model.model = "mutated";
      c.action = { kind: "generate-plan", taskId: f.current.task!.id };
      unwrap(await promise);
      expect(f.launches[0].identity).toMatchObject({
        kind: "action",
        action: { kind: "start" },
        expected: { model: { model: "fixture" } },
      });
    });
    it("readonly generation is a separate episode; it cannot contain an editing proposal or auto-Start", async () => {
      const f = fixture();
      f.plan = "";
      const c = await f.prepare({
        kind: "generate-plan",
        taskId: f.current.task!.id,
      });
      unwrap(await f.admission.submit(c, f.caller));
      expect(f.launches).toHaveLength(1);
      expect(f.launches[0].identity).toMatchObject({
        action: { kind: "generate-plan" },
      });
      expect(() => decodeAction({ ...c.action, graph: f.graph })).toThrow();
      const g = fixture();
      g.plan = "";
      expect(
        await g.admission.preflight(
          { expected: g.current, action: g.action() },
          g.caller,
        ),
      ).toMatchObject({
        kind: "error",
        error: { code: "unsupported-context" },
      });
    });
    it("checks actual parent kind, model/graph revisions, local manual capability and review issues", async () => {
      const f = fixture();
      f.graph.assignments[0].model = { ...f.current.model, model: "other" };
      expect(
        await f.admission.preflight(
          { expected: f.current, action: f.action() },
          f.caller,
        ),
      ).toMatchObject({
        kind: "error",
        error: { code: "unsupported-context" },
      });
      f.graph = graph(f.current);
      f.graph.revision = 2;
      expect(
        await f.admission.preflight(
          { expected: f.current, action: f.action() },
          f.caller,
        ),
      ).toMatchObject({ kind: "error", error: { code: "stale" } });
      const check: Action = {
        kind: "check",
        taskId: f.current.task!.id,
        check: {
          kind: "manual",
          name: "Manual",
          command: "echo test",
          timeoutMs: 120_000,
        },
      };
      expect(
        await f.admission.preflight(
          { expected: f.current, action: check },
          f.caller,
        ),
      ).toMatchObject({ kind: "error", error: { code: "forbidden" } });
      expect(
        (
          await f.admission.preflight(
            { expected: f.current, action: check },
            { ...f.caller, authority: "local" },
          )
        ).kind,
      ).toBe("ok");
      f.current.task!.kind = "research";
      expect(
        await f.admission.preflight(
          { expected: f.current, action: check },
          { ...f.caller, authority: "local" },
        ),
      ).toMatchObject({ kind: "error", error: { code: "forbidden" } });
      const review: Action = {
        kind: "review",
        taskId: f.current.task!.id,
        runId: id(),
        changesIdentity: hash,
        checksRevision: 1,
        acceptIssues: false,
      };
      const observed = f.owner.observe;
      f.owner.observe = async (action) => ({
        ...(await observed(action)),
        reviewRunId: review.runId,
      });
      f.current.observation.complete = false;
      expect(
        await f.admission.preflight(
          { expected: f.current, action: review },
          f.caller,
        ),
      ).toMatchObject({ kind: "error", error: { code: "conflict" } });
    });
    it("handles create and save-plan as explicit metadata commands without allocating a worker run", async () => {
      const f = fixture();
      f.current.task = null;
      const create = await f.prepare({
        kind: "create",
        taskKind: "research",
        goal: "Read facts",
      });
      const created = unwrap(await f.admission.submit(create, f.caller));
      expect(created.runId).toBeNull();
      const g = fixture();
      const proposed = {
        ...g.graph,
        revision: 2,
        taskRevision: 2,
        planRevision: 2,
        plan: { ...g.graph.plan, version: 2 },
      };
      const save = await g.prepare({
        kind: "save-plan",
        taskId: g.current.task!.id,
        plan: "Updated plan",
        graph: proposed,
      });
      expect(unwrap(await g.admission.submit(save, g.caller)).runId).toBeNull();
    });
    it("Cancel uses explicit run/epoch and idempotency, never grant/progress revision", async () => {
      const f = fixture();
      const started = unwrap(
        await f.admission.submit(await f.prepare(), f.caller),
      );
      const cancel = {
        commandId: id(),
        epoch: f.current.epoch,
        runId: started.runId!,
      };
      f.current.controlRev += 10;
      const stopped = unwrap(await f.admission.cancel(cancel, f.caller));
      expect(stopped.settlement).toBeNull();
      expect(f.stops).toEqual([started.runId]);
      expect(unwrap(await f.admission.cancel(cancel, f.caller))).toEqual(
        stopped,
      );
      expect(f.stops).toHaveLength(1);
      const cancelCalls = f.calls.filter((x) => x === "cancel-request").length;
      expect(cancelCalls).toBe(1);
      expect(
        await f.admission.cancel({ ...cancel, runId: id() }, f.caller),
      ).toMatchObject({ kind: "error", error: { code: "conflict" } });
      expect(
        await f.admission.cancel(
          { ...cancel, commandId: id(), epoch: id() },
          f.caller,
        ),
      ).toMatchObject({ kind: "error", error: { code: "stale" } });
      expect(
        await f.admission.cancel(
          { ...cancel, commandId: id(), runId: id() },
          f.caller,
        ),
      ).toMatchObject({ kind: "error", error: { code: "stale" } });
    });
    it("requests safety cancellation despite inconclusive/failed recording, reporting uncertainty not stopped", async () => {
      for (const unavailable of ["lookup", "commit"]) {
        const f = fixture();
        const started = unwrap(
          await f.admission.submit(await f.prepare(), f.caller),
        );
        if (unavailable === "lookup") f.lookupMode = "inconclusive";
        else f.commitMode = "throw-before";
        const result = await f.admission.cancel(
          { commandId: id(), epoch: f.current.epoch, runId: started.runId! },
          f.caller,
        );
        expect(result).toMatchObject({
          kind: "error",
          error: { effect: "uncertain" },
        });
        expect(f.stops).toEqual([started.runId]);
        expect(f.reasons).toEqual(["persistence"]);
      }
    });
    it("configured browser checks must match owner definitions and review must bind the selected run/check revision", async () => {
      const f = fixture();
      const configured: Extract<Action, { kind: "check" }> = {
        kind: "check",
        taskId: f.current.task!.id,
        check: {
          kind: "configured",
          name: "Unit",
          command: "test command",
          timeoutMs: 1000,
        },
      };
      const observe = f.owner.observe;
      const reviewRunId = id();
      f.owner.observe = async (action) => ({
        ...(await observe(action)),
        configuredChecks: [configured.check],
        reviewRunId,
        checksRevision: 3,
      });
      expect(
        (
          await f.admission.preflight(
            { expected: f.current, action: configured },
            f.caller,
          )
        ).kind,
      ).toBe("ok");
      expect(
        await f.admission.preflight(
          {
            expected: f.current,
            action: {
              ...configured,
              check: { ...configured.check, command: "arbitrary shell" },
            },
          },
          f.caller,
        ),
      ).toMatchObject({ kind: "error", error: { code: "forbidden" } });
      const review: Action = {
        kind: "review",
        taskId: f.current.task!.id,
        runId: reviewRunId,
        checksRevision: 3,
        changesIdentity: hash,
        acceptIssues: true,
      };
      expect(
        (
          await f.admission.preflight(
            { expected: f.current, action: review },
            f.caller,
          )
        ).kind,
      ).toBe("ok");
      for (const action of [
        { ...review, runId: id() },
        { ...review, checksRevision: 2 },
      ])
        expect(
          await f.admission.preflight(
            { expected: f.current, action },
            f.caller,
          ),
        ).toMatchObject({ kind: "error", error: { code: "stale" } });
      expect(f.launches).toHaveLength(0);
    });
    it("a queued preflight detached before its first observation cannot create a later grant", async () => {
      const f = fixture();
      const entered = deferred(),
        release = deferred();
      f.beforeObserve = async () => {
        entered.resolve();
        await release.promise;
      };
      const first = f.admission.preflight(
        { expected: f.current, action: f.action() },
        f.caller,
      );
      await entered.promise;
      const secondCaller = { ...f.caller, attachmentId: id() };
      const second = f.admission.preflight(
        { expected: f.current, action: f.action() },
        secondCaller,
      );
      f.admission.detach(secondCaller.attachmentId);
      release.resolve();
      expect((await first).kind).toBe("ok");
      expect(await second).toMatchObject({
        kind: "error",
        error: { code: "stale" },
      });
    });
    it("Cancel does not wait behind another task's blocked preflight", async () => {
      const f = fixture();
      const started = unwrap(
        await f.admission.submit(await f.prepare(), f.caller),
      );
      f.active = null;
      f.current.task = { ...f.current.task!, id: id() };
      f.graph = graph(f.current);
      const entered = deferred(),
        release = deferred();
      f.beforeObserve = async () => {
        entered.resolve();
        await release.promise;
      };
      const pending = f.admission.preflight(
        { expected: f.current, action: f.action() },
        f.caller,
      );
      await entered.promise;
      unwrap(
        await f.admission.cancel(
          { commandId: id(), epoch: f.current.epoch, runId: started.runId! },
          f.caller,
        ),
      );
      expect(f.stops).toEqual([started.runId]);
      release.resolve();
      await pending;
    });
    it("stalled cancel recording reports non-durable uncertainty and requests stop; late write never replays", async () => {
      const f = fixture();
      const started = unwrap(
        await f.admission.submit(await f.prepare(), f.caller),
      );
      const delayed = deferred<AdmissionCommit>();
      const original = f.persistence.commit;
      let saved: AdmissionIntent | undefined;
      f.persistence.commit = (intent) => {
        saved = intent;
        return delayed.promise;
      };
      vi.useFakeTimers();
      try {
        const pending = f.admission.cancel(
          { commandId: id(), epoch: f.current.epoch, runId: started.runId! },
          f.caller,
        );
        await vi.advanceTimersByTimeAsync(LIMITS.recordingStallMs);
        expect(await pending).toMatchObject({
          kind: "error",
          error: { effect: "uncertain" },
        });
        expect(f.stops).toEqual([started.runId]);
        delayed.resolve(await original(saved!));
        await Promise.resolve();
        expect(
          f.calls.filter((call) => call === "cancel-request"),
        ).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("portable client/observation, injected transport only", () => {
    function transport(
      overrides: Partial<ServiceTransport> = {},
    ): ServiceTransport {
      const nope = async () => {
        throw new Error("SECRET transport failure");
      };
      return {
        entity: nope,
        checkObligations: nope,
        session: nope,
        workspace: nope,
        tasks: nope,
        runs: nope,
        messages: nope,
        tools: nope,
        contents: nope,
        events: nope,
        checks: nope,
        changes: nope,
        reviews: nope,
        graph: nope,
        export: () => ({
          [Symbol.asyncIterator]() {
            return { next: nope };
          },
        }),
        preflight: nope,
        command: nope,
        cancel: nope,
        receipt: nope,
        snapshot: nope,
        detail: nope,
        search: nope,
        ...overrides,
      };
    }
    it("lost command reply never retries, generates IDs or assumes missing receipts are absent", async () => {
      const f = fixture();
      const command = await f.prepare();
      let calls = 0;
      const client = new ServiceClient(
        transport({
          command: async (c) => {
            calls++;
            unwrap(await f.admission.submit(c, f.caller));
            throw new Error("lost reply");
          },
          receipt: async (commandId) => {
            const row = f.rows.get(commandId);
            return row
              ? { status: "found", receipt: row.receipt }
              : {
                  status: "inconclusive",
                  error: publicError("receipt-inconclusive", "uncertain"),
                };
          },
        }),
      );
      const result = await client.start(
        command as Command & { action: Extract<Action, { kind: "start" }> },
      );
      expect(result).toMatchObject({
        kind: "error",
        error: { effect: "uncertain" },
      });
      expect(calls).toBe(1);
      expect(f.launches).toHaveLength(1);
      expect((await client.receipt(command.commandId)).status).toBe("found");
      expect((await client.receipt(id())).status).toBe("inconclusive");
      expect(calls).toBe(1);
      const missing = new ServiceClient(
        transport({
          receipt: async () => ({ status: "absent", committedSeq: "1" }),
        }),
      );
      expect((await missing.receipt(id())).status).toBe("absent");
    });
    it("rejects mismatched/unknown response identity and does not replay malformed replies", async () => {
      const f = fixture();
      const command = await f.prepare();
      const call = vi.fn(async () => ({ kind: "ok", value: receipt() }));
      const client = new ServiceClient(
        transport({
          command: call,
          receipt: async () => ({ status: "found", receipt: receipt() }),
          snapshot: async () => ({ kind: "ok", value: snapshot() }),
        }),
      );
      expect(
        await client.start(
          command as Command & { action: Extract<Action, { kind: "start" }> },
        ),
      ).toMatchObject({ kind: "error", error: { effect: "uncertain" } });
      expect(call).toHaveBeenCalledTimes(1);
      expect((await client.receipt(id())).status).toBe("inconclusive");
      expect((await client.snapshot({ kind: "task", id: id() })).kind).toBe(
        "error",
      );
      expect(() =>
        decodePreflight({
          grant: id(),
          expiresAt: "2026-02-30T00:00:00.000Z",
          preview: {},
        }),
      ).toThrow();
    });
    it("handles duplicate/reordered updates, gaps/epoch changes and stale sockets without outcome inference", () => {
      const initial = snapshot();
      const tracker = new ProjectionTracker();
      const generation = tracker.install(initial, 0, tracker.beginSnapshot())!;
      const update = {
        kind: "update",
        storeId: initial.storeId,
        epoch: initial.epoch,
        scope: initial.scope,
        previousSeq: "1",
        committedSeq: "2",
        runs: [initial.runs[0]],
        removed: [],
        context: initial.context,
      };
      expect(tracker.receive(update, generation, 10)).toBe("applied");
      expect(tracker.receive(update, generation, 11)).toBe("duplicate");
      expect(tracker.state!.snapshot.context).toMatchObject({
        status: "available",
        version: { controlRev: 1 },
      });
      expect(
        tracker.receive(
          { ...update, previousSeq: "0", committedSeq: "1" },
          generation,
          12,
        ),
      ).toBe("duplicate");
      tracker.tick(15010);
      expect(tracker.state!.connection).toBe("stale");
      expect(tracker.state!.snapshot.runs[0].outcome).toBeNull();
      expect(
        tracker.receive(
          { ...update, previousSeq: "3", committedSeq: "4" },
          generation,
          15011,
        ),
      ).toBe("resync");
      const nextGeneration = tracker.install(
        {
          ...initial,
          committedSeq: "2",
          horizon: {
            ...initial.horizon,
            historicalRuns: {
              ...initial.horizon.historicalRuns,
              snapshotSeq: "2",
            },
          },
        },
        16000,
        tracker.beginSnapshot(),
      )!;
      expect(tracker.receive(update, generation, 16001)).toBe("ignored");
      expect(
        tracker.receive({ ...update, epoch: id() }, nextGeneration, 16002),
      ).toBe("resync");
      expect(tracker.state!.snapshot.runs[0].outcome).toBeNull();
    });
    it("heartbeat watermark repairs lost final updates; periodic polling remains required without later events", () => {
      const initial = snapshot();
      const tracker = new ProjectionTracker();
      const generation = tracker.install(initial, 0, tracker.beginSnapshot())!;
      expect(tracker.needsPoll(LIMITS.reconcileMs - 1)).toBe(false);
      expect(tracker.needsPoll(LIMITS.reconcileMs)).toBe(true);
      expect(
        tracker.receive(
          {
            kind: "heartbeat",
            storeId: initial.storeId,
            epoch: initial.epoch,
            scope: initial.scope,
            committedSeq: "2",
          },
          generation,
          5000,
        ),
      ).toBe("resync");
      const complete = {
        ...initial,
        committedSeq: "2",
        horizon: {
          ...initial.horizon,
          historicalRuns: {
            ...initial.horizon.historicalRuns,
            snapshotSeq: "2",
          },
        },
        runs: [
          {
            ...initial.runs[0],
            lifecycle: "settled",
            outcome: "failed",
            settlement: null,
          },
        ],
      };
      tracker.install(complete, 5001, tracker.beginSnapshot())!;
      expect(tracker.state!.snapshot.runs[0].outcome).toBe("failed");
      const exported = tracker.state!;
      exported.snapshot.runs[0].outcome = "completed";
      expect(tracker.state!.snapshot.runs[0].outcome).toBe("failed");
    });
    it.each(["gap", "epoch"] as const)(
      "a %s resync invalidates a snapshot already in flight",
      (fault) => {
        const initial = snapshot();
        const tracker = new ProjectionTracker();
        const generation = tracker.install(
          initial,
          0,
          tracker.beginSnapshot(),
        )!;
        const inFlight = tracker.beginSnapshot();
        const heartbeat = {
          kind: "heartbeat",
          storeId: initial.storeId,
          scope: initial.scope,
          epoch: fault === "epoch" ? id() : initial.epoch,
          committedSeq: fault === "gap" ? "2" : "1",
        };
        expect(tracker.receive(heartbeat, generation, 1)).toBe("resync");
        expect(tracker.install(initial, 2, inFlight)).toBeUndefined();
        expect(tracker.state!.connection).toBe("resync");
        const fresh = {
          ...initial,
          committedSeq: heartbeat.committedSeq,
          epoch: heartbeat.epoch,
          context:
            initial.context.status === "available"
              ? {
                  status: "available",
                  version: {
                    ...initial.context.version,
                    epoch: heartbeat.epoch,
                  },
                }
              : initial.context,
          horizon: {
            ...initial.horizon,
            historicalRuns: {
              ...initial.horizon.historicalRuns,
              snapshotSeq: heartbeat.committedSeq,
            },
          },
        };
        const next = tracker.install(fresh, 3, tracker.beginSnapshot())!;
        expect(next).toBeGreaterThan(generation);
        expect(tracker.state!.connection).toBe("current");
        expect(tracker.receive(heartbeat, generation, 4)).toBe("ignored");
      },
    );
    it.each(["runId", "assignmentId"] as const)(
      "cannot reparent an existing child by changing %s in an update",
      (field) => {
        const initial = snapshot();
        const child = {
          ...initial.runs[0],
          childRunId: initial.runs[0].admission.assignments[0].childRunId,
          assignmentId: "inspect",
        };
        initial.runs.push(child);
        const tracker = new ProjectionTracker();
        const generation = tracker.install(
          initial,
          0,
          tracker.beginSnapshot(),
        )!;
        const update = {
          kind: "update",
          storeId: initial.storeId,
          epoch: initial.epoch,
          scope: initial.scope,
          previousSeq: "1",
          committedSeq: "2",
          context: initial.context,
          runs: [{ ...child, [field]: field === "runId" ? id() : "different" }],
          removed: [],
        };
        expect(tracker.receive(update, generation, 1)).toBe("resync");
        expect(tracker.state!.snapshot.runs[1]).toEqual(child);
        expect(tracker.state!.snapshot.committedSeq).toBe("1");
      },
    );
    it("correlates snapshot requests and refuses committed-watermark rollback", () => {
      const initial = snapshot();
      const tracker = new ProjectionTracker();
      const oldRequest = tracker.beginSnapshot(),
        freshRequest = tracker.beginSnapshot();
      const newest = { ...initial, epoch: id(), committedSeq: "5" };
      if (newest.context.status === "available")
        newest.context = {
          status: "available",
          version: { ...newest.context.version, epoch: newest.epoch },
        };
      newest.horizon = {
        ...newest.horizon,
        historicalRuns: { ...newest.horizon.historicalRuns, snapshotSeq: "5" },
      };
      expect(tracker.install(newest, 1, freshRequest)).toBe(1);
      expect(tracker.install(initial, 2, oldRequest)).toBeUndefined();
      expect(tracker.state!.snapshot.epoch).toBe(newest.epoch);
      expect(
        tracker.install(initial, 3, tracker.beginSnapshot()),
      ).toBeUndefined();
      expect(tracker.state!.connection).toBe("resync");
      expect(tracker.state!.snapshot.committedSeq).toBe("5");
    });
  });

  describe("bounded admission revision (injected ports, not native/disk qualification)", () => {
    it.each([
      "preflight-observe",
      "lookup",
      "submit-observe",
      "commit",
      "post-commit-observe",
    ] as const)(
      "bounds %s and accounts the unresolved original after timeout; never activates late",
      async (boundary) => {
        const f = fixture(),
          command = await f.prepare();
        const held = deferred(),
          entered = deferred();
        const wait = async () => {
          entered.resolve();
          await held.promise;
        };
        const lookup = f.persistence.lookup;
        if (boundary === "lookup")
          f.persistence.lookup = async (key) => {
            await wait();
            return lookup(key);
          };
        if (boundary === "preflight-observe" || boundary === "submit-observe")
          f.beforeObserve = wait;
        if (boundary === "commit") f.beforeCommit = wait;
        if (boundary === "post-commit-observe")
          f.afterCommit = () => {
            f.beforeObserve = wait;
          };
        vi.useFakeTimers();
        try {
          const pending =
            boundary === "preflight-observe"
              ? f.admission.preflight(
                  { expected: command.expected, action: command.action },
                  f.caller,
                )
              : f.admission.submit(command, f.caller);
          await entered.promise;
          expect(f.admission.accounting).toEqual({
            count: 1,
            bytes: 4 * LIMITS.controlBytes,
            unresolved: 1,
          });
          await vi.advanceTimersByTimeAsync(LIMITS.recordingStallMs);
          expect((await pending).kind).toBe("error");
          expect(f.admission.accounting.count).toBe(1);
          expect(f.admission.accounting.unresolved).toBe(1);
          expect(f.launches).toHaveLength(0);
          const runId = id();
          f.targets.set(runId, "active");
          // An independent safety path still works even while the old ordinary
          // promise remains unresolved. Its own write may be stalled as well.
          const cancel = f.admission.cancel(
            { commandId: id(), epoch: f.current.epoch, runId },
            f.caller,
          );
          await vi.advanceTimersByTimeAsync(LIMITS.recordingStallMs);
          await cancel;
          expect(f.stops).toEqual([runId]);
          held.resolve();
          await vi.advanceTimersByTimeAsync(0);
          expect(f.admission.accounting).toEqual({
            count: 0,
            bytes: 0,
            unresolved: 0,
          });
          expect(f.launches).toHaveLength(0);
          expect(f.reasons).toHaveLength(1);
        } finally {
          held.resolve();
          vi.useRealTimers();
        }
      },
    );
    it("reserves before decoding and bounds same-attachment tail closures by both slots and bytes", async () => {
      const f = fixture(),
        entered = deferred(),
        held = deferred();
      f.beforeObserve = async () => {
        entered.resolve();
        await held.promise;
      };
      vi.useFakeTimers();
      try {
        const first = f.admission.preflight(
          { expected: f.current, action: f.action() },
          f.caller,
        );
        await entered.promise;
        const pending = [first];
        const bound = Math.min(
          LIMITS.admissionCount,
          LIMITS.admissionBytes / (4 * LIMITS.controlBytes),
        );
        for (let n = 1; n < bound; n++)
          pending.push(
            f.admission.preflight(
              { expected: f.current, action: f.action() },
              f.caller,
            ),
          );
        expect(f.admission.accounting.count).toBe(bound);
        expect(f.admission.accounting.bytes).toBeLessThanOrEqual(
          LIMITS.admissionBytes,
        );
        const get = vi.fn(() => f.current);
        const hostile = {
          get expected() {
            return get();
          },
          action: f.action(),
        };
        for (let n = 0; n < 100; n++) {
          expect(await f.admission.preflight(hostile, f.caller)).toMatchObject({
            kind: "error",
            error: { code: "capacity" },
          });
          expect(await f.admission.submit(hostile, f.caller)).toMatchObject({
            kind: "error",
            error: { code: "capacity" },
          });
        }
        expect(get).not.toHaveBeenCalled();
        expect(f.calls.filter((c) => c === "observe")).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(LIMITS.recordingStallMs);
        expect(
          (await Promise.all(pending)).every((r) => r.kind === "error"),
        ).toBe(true);
        expect(f.admission.accounting.count).toBe(1); // unresolved original, not a reusable slot
        held.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(f.admission.accounting.count).toBe(0);
        expect(f.launches).toEqual([]);
      } finally {
        held.resolve();
        vi.useRealTimers();
      }
    });
    it("saturated Cancel accounting coalesces a synchronous authorized stop, with no async overflow or late replay", async () => {
      const f = fixture(),
        held = deferred<StoredLookup>();
      const lookup = vi.fn(() => held.promise);
      f.persistence.lookup = lookup;
      const runId = id();
      f.targets.set(runId, "active");
      vi.useFakeTimers();
      try {
        const command = { commandId: id(), epoch: f.current.epoch, runId };
        const pending = Array.from({ length: LIMITS.admissionCount }, () =>
          f.admission.cancel(command, f.caller),
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(lookup).toHaveBeenCalledTimes(LIMITS.admissionCount);
        for (let n = 0; n < 100; n++)
          expect(
            await f.admission.cancel({ ...command, commandId: id() }, f.caller),
          ).toMatchObject({ kind: "error", error: { effect: "uncertain" } });
        expect(lookup).toHaveBeenCalledTimes(LIMITS.admissionCount);
        expect(f.admission.accounting).toEqual({
          count: LIMITS.admissionCount,
          bytes: LIMITS.cancelBytes,
          unresolved: LIMITS.admissionCount,
        });
        expect(f.calls.filter((c) => c === "cancel-request")).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(LIMITS.recordingStallMs);
        await Promise.all(pending);
        expect(f.admission.accounting.count).toBe(LIMITS.admissionCount);
        expect(f.calls.filter((c) => c === "cancel-request")).toHaveLength(1);
        held.resolve({ status: "absent", committedSeq: "0" });
        await vi.advanceTimersByTimeAsync(0);
        expect(f.rows.size).toBe(0);
        expect(f.launches).toHaveLength(0);
        expect(f.admission.accounting.count).toBe(0);
      } finally {
        held.resolve({ status: "inconclusive" });
        vi.useRealTimers();
      }
    });
    it("quota safety-stop still rejects rotated/foreign authority without any stop or write", async () => {
      const f = fixture(),
        held = deferred<StoredLookup>();
      f.persistence.lookup = () => held.promise;
      const runId = id();
      f.targets.set(runId, "active");
      vi.useFakeTimers();
      try {
        const input = { commandId: id(), epoch: f.current.epoch, runId };
        const pending = Array.from({ length: LIMITS.admissionCount }, () =>
          f.admission.cancel(input, f.caller),
        );
        await vi.advanceTimersByTimeAsync(0);
        f.current.accessGeneration++;
        expect(await f.admission.cancel(input, f.caller)).toMatchObject({
          kind: "error",
          error: { code: "stale" },
        });
        await vi.advanceTimersByTimeAsync(LIMITS.recordingStallMs);
        await Promise.all(pending);
        expect(f.stops).toEqual([]);
        expect(f.rows.size).toBe(0);
      } finally {
        held.resolve({ status: "inconclusive" });
        vi.useRealTimers();
      }
    });
  });

  function finalRecording(
    childRunId: string,
    selected = { messageId: id(), detailId: id() },
  ): contract.FinalRecording {
    return {
      status: "committed",
      selected,
      detail: {
        childRunId,
        detailId: selected.detailId,
        content: ref("final-text"),
        committedSeq: "4",
      },
    };
  }
  function requiredChild(
    assignmentId = "inspect",
  ): contract.RequiredChildSettlement {
    const childRunId = id();
    return {
      assignmentId,
      childRunId,
      native: native(),
      recording: finalRecording(childRunId),
      settlementSeq: "5",
    };
  }
  function recordOwner(
    kind: contract.RecordOwner["entity"]["kind"] = "message",
  ): contract.RecordOwner {
    const taskId = id(),
      runId = kind === "task" ? null : id();
    const childRunId = ["message", "tool", "child"].includes(kind)
      ? id()
      : null;
    return {
      taskId,
      runId,
      childRunId,
      entity: {
        kind,
        version: 1,
        id:
          kind === "task"
            ? taskId
            : kind === "run"
              ? runId!
              : kind === "child"
                ? childRunId!
                : id(),
      },
    };
  }
  const unavailableSource: contract.SourceIdentity = {
    disposition: "unavailable",
    value: null,
  };
  const checkNative = (): contract.CheckNativeSettlement => ({
    outcome: "completed",
    closure: "direct-child-closed",
    exitCode: 0,
    signal: null,
    durationMs: 3,
    stdin: "not-required",
  });

  describe("shared producer/store semantic vectors (portable only)", () => {
    it("parent completion means the exact frozen required set, not another native process or a successful subset", () => {
      for (const required of [
        [requiredChild()],
        [requiredChild(), requiredChild("review")],
      ]) {
        const parent = run();
        parent.admission.assignments = required.map(
          ({ assignmentId, childRunId }) => ({ assignmentId, childRunId }),
        );
        parent.lifecycle = "settled";
        parent.outcome = "completed";
        parent.settlement = { kind: "parent", outcome: "completed", required };
        expect(contract.decodeRunProjection(parent).settlement).toEqual(
          parent.settlement,
        );
        expect(() =>
          contract.decodeRunProjection({
            ...parent,
            settlement: { ...parent.settlement, required: [] },
          }),
        ).toThrow();
        expect(() =>
          contract.decodeRunProjection({
            ...parent,
            settlement: {
              kind: "sdk",
              native: native(),
              recording: required[0].recording,
              settlementSeq: "5",
            },
          }),
        ).toThrow();
        for (const bad of [
          { ...required[0], native: { ...native(), outcome: "failed" } },
          {
            ...required[0],
            native: { ...native(), outcome: "unknown", closure: "unconfirmed" },
          },
          { ...required[0], native: null },
          { ...required[0], settlementSeq: null },
          {
            ...required[0],
            recording: {
              status: "uncertain",
              selected: required[0].recording.selected,
            },
          },
        ])
          expect(() =>
            contract.decodeRunProjection({
              ...parent,
              settlement: {
                ...parent.settlement,
                required: [bad, ...required.slice(1)],
              },
            }),
          ).toThrow();
        if (required.length > 1)
          expect(() =>
            contract.decodeRunProjection({
              ...parent,
              settlement: {
                ...parent.settlement,
                required: required.slice(0, 1),
              },
            }),
          ).toThrow();
      }
    });
    it("keeps stdin-less check native zero, stale obligations and incomplete recording separate from SDK success", () => {
      expect(contract.decodeCheckNativeSettlement(checkNative()).exitCode).toBe(
        0,
      );
      expect(() => decodeNativeSettlement(checkNative())).toThrow();
      expect(() =>
        contract.decodeCheckNativeSettlement({
          ...checkNative(),
          final: "valid",
        }),
      ).toThrow();
      const before = { identity: hash, complete: true, checkoutGeneration: 1 };
      const fact: contract.OwnerFact = {
        kind: "check-settled",
        checkId: id(),
        native: checkNative(),
        status: "stale",
        before,
        after: { ...before, identity: "b".repeat(64) },
        output: ref("check"),
        coverage,
      };
      expect(contract.decodeOwnerFact(fact)).toEqual(fact);
      expect(() =>
        contract.decodeOwnerFact({ ...fact, status: "passed" }),
      ).toThrow();
      const s = contract.decodeRunSettlement({
        kind: "check",
        native: checkNative(),
        capture: { ...coverage, observed: "incomplete" },
        settlementSeq: null,
      });
      expect(contract.settlementOutcome(s)).toBe("failed");
      expect(s).toMatchObject({
        native: { exitCode: 0, outcome: "completed" },
      });
      const obligations = {
        taskId: id(),
        revision: 1,
        definitions: [
          {
            selection: {
              kind: "configured",
              name: "Unit",
              command: "true",
              timeoutMs: 1000,
            },
            status: "not-run",
            checkId: null,
          },
        ],
      };
      expect(
        contract.decodeCheckObligations(obligations).definitions[0].status,
      ).toBe("not-run");
      expect(() =>
        contract.decodeCheckObligations({
          ...obligations,
          definitions: [{ ...obligations.definitions[0], status: "passed" }],
        }),
      ).toThrow();
    });
    it("represents interleaved/reused/redacted source IDs, partial declarations, real starts and orphan results without guessed joins", () => {
      const messageId = id(),
        secondMessage = id(),
        firstCall = id(),
        secondCall = id(),
        orphan = id(),
        blockId = id(),
        childRunId = id();
      const source: contract.SourceIdentity = {
        disposition: "observed",
        value: "reused",
      };
      const declaration = { messageId, blockId },
        finalDetailId = id();
      const events: contract.CaptureEvent[] = [
        { kind: "ready", requestProtocol: 2 },
        {
          kind: "message-start",
          messageId,
          role: "assistant",
          source: unavailableSource,
          resultCallId: null,
        },
        {
          kind: "call-declaration",
          callId: firstCall,
          declaration,
          index: 0,
          source,
          name: "read",
          argsDetailId: null,
          stage: "partial",
        },
        {
          kind: "message-start",
          messageId: secondMessage,
          role: "assistant",
          source: unavailableSource,
          resultCallId: null,
        },
        {
          kind: "call-declaration",
          callId: secondCall,
          declaration: { messageId: secondMessage, blockId: id() },
          index: 0,
          source,
          name: "read",
          argsDetailId: id(),
          stage: "final",
        },
        {
          kind: "tool-start",
          callId: firstCall,
          declaration,
          source: { disposition: "redacted", value: null },
          name: "read",
          argsDetailId: id(),
        },
        {
          kind: "tool-update",
          callId: firstCall,
          detailId: id(),
          semantics: "snapshot",
        },
        {
          kind: "tool-end",
          callId: orphan,
          declaration: null,
          source,
          name: "read",
          resultDetailId: id(),
          association: "ambiguous",
          startObserved: false,
          isError: true,
        },
        {
          kind: "tool-end",
          callId: firstCall,
          declaration,
          source,
          name: "read",
          resultDetailId: id(),
          association: "declared",
          startObserved: true,
          isError: true,
        },
        {
          kind: "message-start",
          messageId: id(),
          role: "tool-result",
          source,
          resultCallId: firstCall,
        },
        {
          kind: "message-end",
          messageId: secondMessage,
          finalDetailId: null,
          finalBlockCount: 1,
          stopReason: "aborted",
        },
        {
          kind: "message-end",
          messageId,
          finalDetailId,
          finalBlockCount: 2,
          stopReason: "stop",
        },
      ];
      const decoded = events.map(
        (event, n) =>
          decodeCaptureFrame({
            protocol: 2,
            childRunId,
            workerSeq: n + 1,
            observedMs: n,
            event,
          }).event,
      );
      expect(decoded[5]).toMatchObject({
        declaration: { messageId },
        callId: firstCall,
      }); // not nearest second message
      expect(
        decoded.filter((e) => e.kind === "tool-start").map((e) => e.callId),
      ).toEqual([firstCall]); // no fabricated second/orphan start
      expect(decoded[7]).toMatchObject({
        association: "ambiguous",
        startObserved: false,
      });
      expect(() =>
        contract.decodeCaptureEvent({ ...events[6], semantics: "delta" }),
      ).toThrow();
      expect(() =>
        contract.decodeCaptureEvent({ ...events[7], startObserved: true }),
      ).toThrow();
      expect(() =>
        contract.decodeSourceIdentity({
          disposition: "redacted",
          value: "still-present",
        }),
      ).toThrow();
    });
    it("gives every actual context/text/JSON/media block an explicit ownership and stage, without hidden bodies", () => {
      const messageId = id(),
        callId = id(),
        blockId = id();
      const descriptors: contract.DetailDescriptor[] = [
        {
          owner: { kind: "context", component: "effective-system" },
          field: "context",
          encoding: "utf8",
        },
        {
          owner: { kind: "handoff", dependencyIndex: 0, source: ref() },
          field: "context",
          encoding: "utf8",
        },
        {
          owner: {
            kind: "message",
            messageId,
            blockId,
            index: 0,
            stage: "stream",
          },
          field: "message",
          encoding: "utf8",
        },
        {
          owner: {
            kind: "message",
            messageId,
            blockId,
            index: 0,
            stage: "final",
          },
          field: "message",
          encoding: "utf8",
        },
        {
          owner: { kind: "message-final", messageId },
          field: "final-text",
          encoding: "utf8",
        },
        {
          owner: {
            kind: "tool",
            callId,
            blockId: id(),
            index: 0,
            stage: "arguments-final",
          },
          field: "tool-args",
          encoding: "canonical-json",
        },
        {
          owner: {
            kind: "tool",
            callId,
            blockId: id(),
            index: 0,
            stage: "update-snapshot",
          },
          field: "tool-update",
          encoding: "canonical-json",
        },
      ];
      for (const descriptor of descriptors)
        expect(contract.decodeDetailDescriptor(descriptor)).toEqual(descriptor);
      expect(() =>
        contract.decodeDetailDescriptor({
          ...descriptors[5],
          encoding: "utf8",
        }),
      ).toThrow();
      expect(() =>
        contract.decodeDetailDescriptor({
          ...descriptors[2],
          field: "final-text",
        }),
      ).toThrow();
      expect(
        contract.decodeDetailDescriptor({
          owner: {
            kind: "tool",
            callId,
            blockId: id(),
            index: 0,
            stage: "arguments-partial",
          },
          field: "tool-args",
          encoding: "utf8",
        }).encoding,
      ).toBe("utf8");
      const image = {
        owner: {
          kind: "message",
          messageId,
          blockId: id(),
          index: 1,
          stage: "final",
        },
        sourceType: "image",
        mimeType: "image/png",
        reason: "binary",
      };
      expect(contract.decodeOmittedBlock(image)).toEqual(image);
      expect(() =>
        contract.decodeOmittedBlock({ ...image, data: "base64-body" }),
      ).toThrow();
      expect(() =>
        contract.decodeOmittedBlock({
          ...image,
          sourceType: "hidden-thinking",
        }),
      ).toThrow();
      expect(
        contract.decodeOmittedBlock({
          ...image,
          sourceType: "hidden-thinking",
          mimeType: null,
          reason: "hidden-thinking",
        }).owner,
      ).toEqual(image.owner);
    });
    it("maps zero/many sanitized chunks to source ranges and independent committed identities, never wire offsets", () => {
      const link: contract.RecordingLink = {
        epoch: id(),
        taskId: id(),
        runId: id(),
        childRunId: id(),
      };
      const detailId = id(),
        selected = { messageId: id(), detailId },
        source = { first: 5, last: 6, firstObservedMs: 10, lastObservedMs: 11 };
      const batch: contract.PublicRecordingInput = {
        link,
        source,
        events: [
          {
            source,
            event: {
              kind: "stored-chunk",
              detailId,
              text: "[redacted]".repeat(800),
            },
          },
          { source, event: { kind: "stored-chunk", detailId, text: "tail" } },
          {
            source,
            event: {
              kind: "stored-end",
              detailId,
              coverage: { ...coverage, redacted: true },
            },
          },
        ],
      };
      expect(
        contract.decodeRecordingInput({ ...batch, events: [] }).events,
      ).toEqual([]);
      expect(contract.decodeRecordingInput(batch).events).toHaveLength(3);
      expect(
        contract.decodeRecordingInput(batch).events[0].source,
      ).toMatchObject({ firstObservedMs: 10, lastObservedMs: 11 });
      expect(() =>
        contract.decodeSourceRange({
          first: 5,
          last: 5,
          firstObservedMs: 1,
          lastObservedMs: 2,
        }),
      ).toThrow();
      expect(() =>
        contract.decodeRecordingInput({
          ...batch,
          events: [
            {
              source,
              event: { kind: "detail-chunk", detailId, offset: 0, text: "raw" },
            },
          ],
        }),
      ).toThrow();
      expect(() =>
        contract.decodeRecordingInput({
          ...batch,
          events: [
            {
              source: {
                first: 4,
                last: 6,
                firstObservedMs: 10,
                lastObservedMs: 11,
              },
              event: batch.events[0].event,
            },
          ],
        }),
      ).toThrow();
      const recording = finalRecording(link.childRunId, selected);
      if (recording.status !== "committed") throw new Error("fixture");
      const committed = contract.decodeCommittedBatch({
        committedSeq: "7",
        details: [recording.detail],
        ownerDetails: [],
        coverage,
      });
      expect(committed.details[0].detailId).toBe(detailId);
      expect(committed.details[0].content.recordId).not.toBe(detailId);
      const completion = {
        childRunId: link.childRunId,
        native: native(),
        selected,
        recording,
      };
      expect(contract.decodeWorkerCompletion(completion)).toEqual(completion);
      for (const status of ["pending", "uncertain", "refused"] as const) {
        const recording =
          status === "refused"
            ? { status, selected, error: publicError("recording-exhausted") }
            : { status, selected };
        expect(
          contract.decodeWorkerCompletion({ ...completion, recording }).native
            .exitCode,
        ).toBe(0);
        expect(
          contract.settlementOutcome(
            contract.decodeRunSettlement({
              kind: "sdk",
              native: native(),
              recording,
              settlementSeq: null,
            }),
          ),
        ).toBe("failed");
      }
      expect(() =>
        contract.decodeWorkerCompletion({
          ...completion,
          selected: { ...selected, detailId: id() },
        }),
      ).toThrow();
      expect(() =>
        contract.decodeWorkerCompletion({
          ...completion,
          recording: {
            ...recording,
            detail: { ...recording.detail, content: ref("message") },
          },
        }),
      ).toThrow();
    });
    it("accounts prefix retention, expansion, one-shot write lifetime and reserved control headroom", () => {
      const pool = new contract.CaptureBudgetPool();
      const prefix = pool.reserve({
        sourceFrames: 0,
        retainedBytes: 32,
        outputBytes: 0,
        outputChunks: 0,
        lane: "data",
      });
      const input: contract.PublicRecordingInput = {
        link: { epoch: id(), taskId: id(), runId: id(), childRunId: id() },
        source: { first: 1, last: 2, firstObservedMs: 0, lastObservedMs: 2 },
        events: [],
      };
      const lease = pool.reserve({
        sourceFrames: 2,
        retainedBytes: 64,
        outputBytes: 512,
        outputChunks: 1,
        lane: "data",
      });
      lease.grow({
        sourceFrames: 0,
        retainedBytes: 0,
        outputBytes: 512,
        outputChunks: 2,
        lane: "data",
      });
      lease.grow({
        sourceFrames: 0,
        retainedBytes: 0,
        outputBytes: 64,
        outputChunks: 0,
        lane: "data",
      });
      const detailId = id();
      input.events = [0, 1].map(() => ({
        source: input.source,
        event: { kind: "stored-chunk", detailId, text: "[redacted]" },
      }));
      expect(lease.beginWorker(input).events).toHaveLength(2);
      expect(() => lease.beginWorker(input)).toThrow("conflict");
      expect(() => lease.release()).toThrow("conflict"); // reporting timeout is NOT write settlement
      expect(pool.accounting.leases).toBe(2);
      prefix.release(); // only after bounded prefix transfer above
      lease.settled();
      expect(pool.accounting.leases).toBe(0);
      expect(() => lease.settled()).toThrow("conflict");
      const full = pool.reserve({
        sourceFrames: 1,
        retainedBytes: LIMITS.ownerQueueBytes - LIMITS.ownerControlBytes,
        outputBytes: 0,
        outputChunks: 0,
        lane: "data",
      });
      expect(() =>
        pool.reserve({
          sourceFrames: 1,
          retainedBytes: 1,
          outputBytes: 0,
          outputChunks: 0,
          lane: "data",
        }),
      ).toThrow("capacity");
      const stop = pool.reserve({
        sourceFrames: 1,
        retainedBytes: 0,
        outputBytes: 1024,
        outputChunks: 1,
        lane: "control",
      });
      expect(
        stop.beginWorker({
          ...input,
          events: [
            {
              source: input.source,
              event: { kind: "worker-failure", code: "capture" },
            },
          ],
        }).events,
      ).toHaveLength(1);
      stop.settled();
      full.release();
      expect(() =>
        pool.reserve({
          sourceFrames: LIMITS.ownerQueueFrames - LIMITS.ownerControlFrames,
          retainedBytes: 1,
          outputBytes: 1,
          outputChunks: 1,
          lane: "data",
        }),
      ).toThrow("capacity");
      const slots = Array.from(
        { length: LIMITS.ownerQueueFrames - LIMITS.ownerControlFrames },
        () =>
          pool.reserve({
            sourceFrames: 0,
            retainedBytes: 1,
            outputBytes: 0,
            outputChunks: 0,
            lane: "data",
          }),
      );
      expect(() =>
        pool.reserve({
          sourceFrames: 0,
          retainedBytes: 1,
          outputBytes: 0,
          outputChunks: 0,
          lane: "data",
        }),
      ).toThrow("capacity");
      slots.forEach((l) => {
        l.release();
      });
      expect(pool.accounting.bytes).toBe(0);
    });
    it("owner checks/changes/review/publication share one closed journal without fictitious child identities", () => {
      const taskId = id(),
        runId = id(),
        operationId = id(),
        observation = {
          identity: hash,
          complete: false,
          checkoutGeneration: 2,
        };
      const link: contract.OwnerLink = {
        epoch: id(),
        operationId,
        taskId,
        runId,
      };
      const publicationId = id(),
        checkId = id();
      const facts: contract.OwnerFact[] = [
        { kind: "gate", lane: "check", state: "held", checkoutGeneration: 2 },
        {
          kind: "check-start",
          checkId,
          selection: {
            kind: "configured",
            name: "Unit",
            command: "true",
            timeoutMs: 1000,
          },
          cwdId: id(),
          cwdLabel: "/fixture ",
          checkEnvGeneration: 1,
          before: observation,
        },
        {
          kind: "check-settled",
          checkId,
          native: checkNative(),
          status: "passed",
          before: observation,
          after: observation,
          output: ref("check"),
          coverage,
        },
        {
          kind: "changes",
          observationId: id(),
          stage: "after",
          observation,
          content: ref("changes"),
        },
        {
          kind: "review",
          reviewId: id(),
          runId,
          checksRevision: 1,
          changesIdentity: hash,
          acceptIssues: true,
          outcome: "reviewed-with-issues",
          content: ref("review"),
        },
        {
          kind: "publication-intent",
          publicationId,
          expectedRevision: 1,
          expectedIdentity: hash,
          nextRevision: 2,
          nextIdentity: "b".repeat(64),
        },
        {
          kind: "publication-settled",
          publicationId,
          status: "conflict",
          observed: { revision: 1, identity: "c".repeat(64) },
        },
      ];
      const decoded = contract.decodeOwnerRecordingInput({
        observedMs: 10,
        link,
        events: facts.map((fact) => ({ kind: "fact", fact })),
      });
      expect(decoded.events).toHaveLength(7);
      expect(decoded.link).not.toHaveProperty("childRunId");
      expect(() =>
        contract.decodeOwnerRecordingInput({
          observedMs: 10,
          link: { ...link, childRunId: id() },
          events: [],
        }),
      ).toThrow();
      expect(() =>
        contract.decodeOwnerFact({ ...facts[5], expectedIdentity: null }),
      ).toThrow();
      expect(() =>
        contract.decodeOwnerFact({ ...facts[5], nextRevision: 3 }),
      ).toThrow();
      expect(() =>
        contract.decodeOwnerFact({
          ...facts[6],
          status: "published",
          observed: null,
        }),
      ).toThrow();
      expect(() =>
        contract.decodeOwnerFact({ ...facts[2], native: native() }),
      ).toThrow();
      expect(() =>
        contract.decodeOwnerRecordingInput({
          observedMs: 10,
          link: { ...link, runId: null },
          events: [{ kind: "fact", fact: facts[0] }],
        }),
      ).toThrow();
      // Task-only human-readable content has its own owner mapping in same batch result.
      const owner = {
        taskId,
        runId: null,
        childRunId: null,
        entity: { kind: "task", id: taskId, version: 1 },
      };
      const detailId = id();
      expect(
        contract.decodeOwnerRecordingInput({
          observedMs: 10,
          link: { ...link, runId: null },
          events: [
            {
              kind: "content-begin",
              detailId,
              owner,
              field: "plan",
              encoding: "utf8",
            },
            { kind: "content-chunk", detailId, text: "Plan" },
            { kind: "content-end", detailId, coverage },
          ],
        }).events,
      ).toHaveLength(3);
      expect(
        contract.decodeCommittedBatch({
          committedSeq: "4",
          details: [],
          ownerDetails: [
            { operationId, detailId, content: ref("plan"), committedSeq: "4" },
          ],
          coverage,
        }).ownerDetails[0].operationId,
      ).toBe(operationId);
    });
  });

  describe("bootstrap/history/export/live parity contracts (memory fixtures only)", () => {
    it("bootstraps create without inventing a task snapshot and returns the reserved task identity, not publication success", async () => {
      const f = fixture();
      f.current.task = null;
      const workspace: contract.WorkspaceBootstrap = {
        workspaceId: f.current.workspaceId,
        storeId: id(),
        epoch: f.current.epoch,
        committedSeq: "0",
        rootLabel: "/fixture",
        context: { status: "available", version: f.current },
        models: [f.current.model],
      };
      expect(
        contract.decodeWorkspaceBootstrap(workspace).context,
      ).toMatchObject({
        status: "available",
        version: { task: null },
      });
      const session: contract.SessionBootstrap = {
        protocol: 1,
        storeId: workspace.storeId,
        epoch: workspace.epoch,
        accessGeneration: 1,
        authority: "browser",
        csrf: id(),
        capabilities: { actions: true, manualChecks: false, history: true },
      };
      expect(contract.decodeSessionBootstrap(session)).toEqual(session);
      expect(() =>
        contract.decodeSessionBootstrap({
          ...session,
          capabilities: { ...session.capabilities, manualChecks: true },
        }),
      ).toThrow();
      expect(() =>
        contract.decodeSessionBootstrap({
          ...session,
          localCapability: "secret",
        }),
      ).toThrow();
      const command = await f.prepare({
        kind: "create",
        taskKind: "research",
        goal: "Inspect",
      });
      const accepted = unwrap(await f.admission.submit(command, f.caller));
      expect(accepted.created).toEqual({
        kind: "task",
        taskId: f.launches[0].createdTaskId,
        state: "reserved",
      });
      expect(accepted.publication).toBe("pending");
      expect(() =>
        contract.decodeReceipt({
          ...accepted,
          settlement: {
            kind: "sdk",
            native: native(),
            recording: finalRecording(id()),
            settlementSeq: "5",
          },
        }),
      ).toThrow();
      expect(
        unwrap(await f.admission.submit(command, f.caller)).created,
      ).toEqual(accepted.created);
      expect(f.launches).toHaveLength(1);
      expect(() =>
        contract.decodeStoredCommand({
          ...f.rows.get(command.commandId),
          receipt: { ...accepted, created: null },
        }),
      ).toThrow();
    });
    it("retains immutable older run/model/graph identity when current control context is unavailable or changed", () => {
      const current = snapshot(),
        first = current.runs[0],
        second = structuredClone(first);
      second.runId = id();
      second.admission.operationId = id();
      second.admission.commandId = id();
      second.admission.context.epoch = id();
      second.admission.context.model.model = "new-selection";
      second.admission.context.task!.graphRevision = 2;
      second.admission.context.task!.graphIdentity = "b".repeat(64);
      second.admission.graph = {
        recordId: id(),
        revision: 2,
        sha256: "b".repeat(64),
      };
      second.admission.assignments = [
        { assignmentId: "new-assignment", childRunId: id() },
      ];
      current.runs.push(second);
      current.context = {
        status: "unavailable",
        workspaceId: first.admission.context.workspaceId,
        taskId: first.taskId,
        error: publicError("corrupt-selected"),
      };
      const decoded = decodeSnapshot(current);
      expect(decoded.runs.map((r) => r.admission.graph!.revision)).toEqual([
        1, 2,
      ]);
      expect(decoded.context.status).toBe("unavailable");
      const tracker = new ProjectionTracker(),
        generation = tracker.install(current, 0, tracker.beginSnapshot())!;
      const version = {
        ...first.admission.context,
        epoch: current.epoch,
        controlRev: 5,
      };
      expect(
        tracker.receive(
          {
            kind: "update",
            storeId: current.storeId,
            epoch: current.epoch,
            scope: current.scope,
            previousSeq: "1",
            committedSeq: "7",
            runs: [],
            removed: [],
            context: { status: "available", version },
          },
          generation,
          1,
        ),
      ).toBe("applied");
      expect(
        tracker.state!.snapshot.runs.map((r) => r.admission.graph!.revision),
      ).toEqual([1, 2]);
      expect(() =>
        decodeSnapshot({
          ...current,
          context: { ...current.context, taskId: id() },
        }),
      ).toThrow();
    });
    it("applies all sibling rows at one committed watermark atomically; filtered sequences need not be numerically contiguous", () => {
      const initial = snapshot(),
        parent = initial.runs[0];
      parent.admission.assignments.push({
        assignmentId: "review",
        childRunId: id(),
      });
      const children = parent.admission.assignments.map((a) => ({
        ...structuredClone(parent),
        childRunId: a.childRunId,
        assignmentId: a.assignmentId,
      }));
      initial.runs.push(...children);
      const tracker = new ProjectionTracker(),
        generation = tracker.install(initial, 0, tracker.beginSnapshot())!;
      const changed = initial.runs.map((r) => ({ ...r, lifecycle: "closing" }));
      const update = {
        kind: "update",
        storeId: initial.storeId,
        epoch: initial.epoch,
        scope: initial.scope,
        previousSeq: "1",
        committedSeq: "12",
        runs: changed,
        removed: [],
        context: initial.context,
      };
      expect(tracker.receive(update, generation, 1)).toBe("applied");
      expect(tracker.state!.snapshot.runs.map((r) => r.lifecycle)).toEqual([
        "closing",
        "closing",
        "closing",
      ]);
      expect(tracker.receive(update, generation, 2)).toBe("duplicate");
      const bad = {
        ...update,
        previousSeq: "12",
        committedSeq: "13",
        runs: [
          { ...changed[0], lifecycle: "running" },
          { ...changed[1], assignmentId: "review" },
        ],
      };
      expect(tracker.receive(bad, generation, 3)).toBe("resync");
      expect(tracker.state!.snapshot.runs.map((r) => r.lifecycle)).toEqual([
        "closing",
        "closing",
        "closing",
      ]);
      expect(tracker.state!.snapshot.committedSeq).toBe("12");
    });
    it("keeps a bounded active/recent horizon and independently pages 204 historical rows without embedding the archive", () => {
      const initial = snapshot(),
        c = initial.runs[0].admission.context;
      const rows = Array.from({ length: 204 }, () =>
        run(c.task!.id, structuredClone(c)),
      );
      expect(() => decodeSnapshot({ ...initial, runs: rows })).toThrow();
      expect(
        decodeSnapshot({ ...initial, runs: rows.slice(0, 50) }).horizon
          .historicalRuns.reader,
      ).toBe("runs");
      let request: contract.ListRequest = {
        ...initial.horizon.historicalRuns,
        snapshotSeq: "17",
      };
      const retrieved: contract.HistoryRecord[] = [];
      for (let offset = 0; offset < rows.length; offset += 50) {
        const selected = rows.slice(offset, offset + 50);
        const next =
          offset + 50 < rows.length
            ? {
                ...request,
                after: {
                  recordId: selected.at(-1)!.runId,
                  version: 1,
                  offset: 0,
                },
              }
            : null;
        const page = contract.decodeHistoryPage({
          request,
          records: selected.map((projection) => ({ kind: "run", projection })),
          next,
          coverage,
        });
        retrieved.push(...page.records);
        if (next) request = next;
      }
      expect(retrieved).toHaveLength(204);
      expect(() =>
        contract.decodeHistoryPage({
          request,
          records: [],
          next: request,
          coverage,
        }),
      ).toThrow();
      expect(() =>
        contract.decodeHistoryPage({
          request,
          records: [],
          next: {
            ...request,
            after: { recordId: id(), version: 1, offset: 0 },
            snapshotSeq: "18",
          },
          coverage,
        }),
      ).toThrow();
      expect(() =>
        contract.decodeListRequest({ ...request, snapshotSeq: null }),
      ).toThrow();
      const first = { ...request, after: null, snapshotSeq: null };
      expect(
        contract.historyReplyMatches(
          first,
          contract.decodeHistoryPage({
            request: { ...first, snapshotSeq: "17" },
            records: [],
            next: null,
            coverage,
          }),
        ),
      ).toBe(true);
      expect(
        contract.historyReplyMatches(
          { ...first, snapshotSeq: "16" },
          contract.decodeHistoryPage({
            request: { ...first, snapshotSeq: "17" },
            records: [],
            next: null,
            coverage,
          }),
        ),
      ).toBe(false);
    });
    it("literal search hit ownership opens the exact message/tool occurrence and source-independent detail cursor", () => {
      const owner = recordOwner(),
        content = ref("final-text", 4),
        cursor: ReadCursor = {
          storeId: id(),
          scope: { kind: "task", id: owner.taskId },
          query: "é",
          snapshotSeq: "20",
          recordId: content.recordId,
          recordVersion: 1,
          field: "final-text",
          offset: 2,
        };
      owner.entity.version = 4;
      const page = decodeSearchPage({
        cursor,
        hits: [
          { owner, content, cursor, range: { start: 2, end: 4 }, preview: "é" },
        ],
        next: null,
        coverage,
      });
      expect(page.hits[0].owner.runId).toBe(owner.runId);
      const request: contract.EntityReadRequest = {
        storeId: cursor.storeId,
        scope: cursor.scope,
        snapshotSeq: cursor.snapshotSeq,
        kind: "message",
        id: owner.entity.id,
        version: owner.entity.version,
      };
      const record: contract.HistoryRecord = {
        kind: "message",
        owner,
        version: owner.entity.version,
        role: "assistant",
        source: unavailableSource,
        resultCallId: null,
        state: "final",
        finalBlockCount: 1,
        finalText: content,
      };
      expect(
        contract.decodeEntityPage({ request, record }).record.owner.entity.id,
      ).toBe(owner.entity.id);
      expect(
        decodeDetailPage({
          cursor: page.hits[0].cursor,
          content,
          range: { start: 2, end: 4 },
          text: "é",
          next: null,
          coverage,
        }).text,
      ).toBe("é");
      expect(() =>
        contract.decodeEntityPage({
          request: { ...request, id: id() },
          record,
        }),
      ).toThrow();
      expect(() =>
        decodeSearchPage({
          ...page,
          hits: [{ ...page.hits[0], owner: { ...owner, taskId: id() } }],
        }),
      ).toThrow();
      const toolOwner = recordOwner("tool");
      const unexecuted: contract.HistoryRecord = {
        kind: "tool",
        owner: toolOwner,
        version: 1,
        source: unavailableSource,
        name: "read",
        declaration: { messageId: id(), blockId: id() },
        declarationStage: "partial",
        startObserved: false,
        result: null,
      };
      expect(contract.decodeHistoryRecord(unexecuted)).toEqual(unexecuted);
      const orphan = {
        ...unexecuted,
        declaration: null,
        declarationStage: null,
        result: {
          kind: "tool-end",
          callId: toolOwner.entity.id,
          declaration: null,
          source: unavailableSource,
          name: "read",
          resultDetailId: id(),
          association: "orphan",
          startObserved: false,
          isError: true,
        },
      };
      expect(contract.decodeHistoryRecord(orphan)).toEqual(orphan);
    });
    it.each(["ndjson", "markdown"] as const)(
      "streams %s with exact framing/counts/watermark and requires a trailer; digest remains explicitly unverified",
      (format) => {
        const owner = recordOwner(),
          request: contract.ExportRequest = {
            storeId: id(),
            scope: { kind: "run", id: owner.runId! },
            snapshotSeq: "10",
            format,
          },
          exportId = id();
        const manifest: contract.ExportFrame = {
          exportId,
          ordinal: 1,
          event: {
            kind: "manifest",
            schema: contract.EXPORT_SCHEMA,
            request,
            coverage,
            serviceProtocol: 1,
            workerProtocol: 2,
            provenance: {
              exporterBuildSha256: hash,
              capturePolicy: "public-text-tools/2",
            },
          },
        };
        const data: contract.ExportFrame = {
          exportId,
          ordinal: 2,
          event:
            format === "markdown"
              ? { kind: "markdown", text: "# Observed result\n\néé\n" }
              : {
                  kind: "detail",
                  owner,
                  content: ref("message", 4),
                  range: { start: 0, end: 4 },
                  text: "éé",
                  coverage,
                },
        };
        const bytes = contract.utf8Bytes(
          contract.encodeExportFrame(manifest, format) +
            contract.encodeExportFrame(data, format),
        );
        const tracker = new contract.ExportTracker(request);
        expect(tracker.receive(manifest)).toEqual(manifest);
        tracker.receive(data);
        expect(tracker.completion).toBe("missing-trailer");
        const trailer: contract.ExportFrame = {
          exportId,
          ordinal: 3,
          event: {
            kind: "trailer",
            complete: true,
            frames: 2,
            encodedBytes: bytes,
            sha256: hash,
            committedSeq: "10",
            coverage,
          },
        };
        expect(() =>
          tracker.receive({
            ...trailer,
            event: { ...trailer.event, encodedBytes: bytes - 1 },
          }),
        ).toThrow();
        tracker.receive(trailer);
        expect(tracker.completion).toBe("complete-unverified-digest");
        expect(() => tracker.receive({ ...data, ordinal: 4 })).toThrow();
        const wrong = new contract.ExportTracker(request);
        expect(() =>
          wrong.receive({
            ...manifest,
            event: {
              ...manifest.event,
              request: { ...request, snapshotSeq: "11" },
            },
          }),
        ).toThrow();
      },
    );
    it("client export cancellation/revocation never yields a fabricated trailer or invokes mutation", async () => {
      const controller = new AbortController(),
        request: contract.ExportRequest = {
          storeId: id(),
          scope: { kind: "task", id: id() },
          snapshotSeq: "2",
          format: "ndjson",
        };
      const mutation = vi.fn();
      const base = readonlyTransport();
      const client = new ServiceClient({
        ...base,
        command: mutation,
        export: async function* () {
          yield {
            exportId: id(),
            ordinal: 1,
            event: {
              kind: "manifest",
              schema: contract.EXPORT_SCHEMA,
              request,
              coverage,
              serviceProtocol: 1,
              workerProtocol: 2,
              provenance: {
                exporterBuildSha256: hash,
                capturePolicy: "public-text-tools/2",
              },
            },
          };
          controller.abort();
          throw new Error("SECRET transport revoked");
        },
      });
      const seen: contract.ExportFrame[] = [];
      await expect(
        (async () => {
          for await (const frame of client.export(request, controller.signal))
            seen.push(frame);
        })(),
      ).rejects.toThrow("unavailable");
      expect(seen).toHaveLength(1);
      expect(seen.some((f) => f.event.kind === "trailer")).toBe(false);
      expect(mutation).not.toHaveBeenCalled();
    });
    it("named read methods enforce page/entity correlation and never silently rebase or retry", async () => {
      const initial = snapshot(),
        request = { ...initial.horizon.historicalRuns, snapshotSeq: null };
      const { reader: _reader, ...input } = request;
      const response = {
        request: { ...request, snapshotSeq: "1" },
        records: [],
        next: null,
        coverage,
      };
      const reads = vi.fn(async () => ({ kind: "ok", value: response }));
      const client = new ServiceClient({ ...readonlyTransport(), runs: reads });
      expect((await client.runs(input)).kind).toBe("ok");
      expect((await client.runs({ ...input, snapshotSeq: "2" })).kind).toBe(
        "error",
      );
      expect(reads).toHaveBeenCalledTimes(2); // only the two explicit user reads
      response.request.reader = "tools";
      expect((await client.runs(input)).kind).toBe("error");
    });
  });
  function readonlyTransport(): ServiceTransport {
    const nope = async () => {
      throw new Error("not supplied");
    };
    return {
      session: nope,
      workspace: nope,
      tasks: nope,
      runs: nope,
      messages: nope,
      tools: nope,
      contents: nope,
      events: nope,
      checks: nope,
      changes: nope,
      reviews: nope,
      graph: nope,
      entity: nope,
      checkObligations: nope,
      snapshot: nope,
      detail: nope,
      search: nope,
      receipt: nope,
      preflight: nope,
      command: nope,
      cancel: nope,
      export: () => ({
        [Symbol.asyncIterator]() {
          return { next: nope };
        },
      }),
    };
  }

  it("admission reporting deadline is timer-bound even if the wall clock moves backwards", async () => {
    const f = fixture(),
      held = deferred(),
      entered = deferred();
    f.beforeObserve = async () => {
      entered.resolve();
      await held.promise;
    };
    vi.useFakeTimers();
    try {
      const pending = f.admission.preflight(
        { expected: f.current, action: f.action() },
        f.caller,
      );
      await entered.promise;
      vi.setSystemTime(Date.now() - 100_000);
      await vi.advanceTimersByTimeAsync(LIMITS.recordingStallMs);
      expect((await pending).kind).toBe("error");
      expect(f.admission.accounting.unresolved).toBe(1);
      held.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.admission.accounting.count).toBe(0);
      expect(f.launches).toHaveLength(0);
    } finally {
      held.resolve();
      vi.useRealTimers();
    }
  });

  // Follow-up review: exercise the original consumer counterexamples, not real
  // HTTP/auth, SDK correlation, native process closure or filesystem durability.
  describe("revision review response consistency", () => {
    it("named mutation replies must satisfy the same stored-command identity contract as admission", async () => {
      const c = context();
      const malformed = receipt();
      const transport = readonlyTransport();
      transport.command = async () => ({ kind: "ok", value: malformed });
      const client = new ServiceClient(transport);
      const base = { commandId: malformed.commandId, grant: id(), expected: c };
      const create = {
        ...base,
        expected: { ...c, task: null },
        action: {
          kind: "create" as const,
          taskKind: "research" as const,
          goal: "Read",
        },
      };
      malformed.runId = null;
      expect(await client.create(create)).toMatchObject({
        kind: "error",
        error: { effect: "uncertain" },
      });
      malformed.created = { kind: "task", taskId: id(), state: "reserved" };
      expect(unwrap(await client.create(create)).created).toEqual(
        malformed.created,
      );
      const start = {
        ...base,
        action: { kind: "start" as const, taskId: c.task!.id },
      };
      malformed.created = null;
      expect(await client.start(start)).toMatchObject({
        kind: "error",
        error: { effect: "uncertain" },
      });
      malformed.runId = id();
      expect(unwrap(await client.start(start)).runId).toBe(malformed.runId);
      const check = {
        ...base,
        action: {
          kind: "check" as const,
          taskId: c.task!.id,
          check: {
            kind: "configured" as const,
            name: "Unit",
            command: "true",
            timeoutMs: 1000,
          },
        },
      };
      malformed.execution = "completed";
      malformed.settlement = {
        kind: "parent",
        outcome: "completed",
        required: [requiredChild()],
      };
      expect(await client.check(check)).toMatchObject({
        kind: "error",
        error: { effect: "uncertain" },
      });
      malformed.settlement = {
        kind: "check",
        native: checkNative(),
        capture: coverage,
        settlementSeq: "1",
      };
      expect(unwrap(await client.check(check)).settlement?.kind).toBe("check");
      malformed.created = { kind: "task", taskId: id(), state: "reserved" };
      transport.cancel = async () => ({ kind: "ok", value: malformed });
      expect(
        await client.cancel({
          commandId: base.commandId,
          runId: malformed.runId,
          epoch: c.epoch,
        }),
      ).toMatchObject({
        kind: "error",
        error: { effect: "uncertain" },
      });
    });
    it("an SDK projection cannot replace the exact committed final result with another detail", () => {
      const parent = run(),
        childRunId = parent.admission.assignments[0].childRunId,
        recording = finalRecording(childRunId);
      if (recording.status !== "committed") throw new Error("fixture");
      const child: RunProjection = {
        ...parent,
        childRunId,
        assignmentId: "inspect",
        lifecycle: "settled",
        outcome: "completed",
        settlement: {
          kind: "sdk",
          native: native(),
          recording,
          settlementSeq: "5",
        },
        result: recording.detail.content,
      };
      expect(decodeRunProjection(child)).toEqual(child);
      for (const result of [
        ref("final-text"),
        { ...child.result, version: 2 },
        ref("message"),
      ])
        expect(() => decodeRunProjection({ ...child, result })).toThrow();
      // Failure still preserves an already committed selected result and native zero.
      expect(
        decodeRunProjection({
          ...child,
          outcome: "failed",
          settlement: {
            ...child.settlement,
            native: { ...native(), outcome: "failed", cleanup: "failed" },
          },
        }).result,
      ).toEqual(child.result);
    });
  });

  it.each(["run", "child"] as const)(
    "%s-scoped snapshots and updates cannot attach another task's current control context",
    (kind) => {
      const s = snapshot(),
        parent = s.runs[0];
      if (kind === "child") {
        parent.childRunId = parent.admission.assignments[0].childRunId;
        parent.assignmentId = parent.admission.assignments[0].assignmentId;
      }
      s.scope = { kind, id: parent.childRunId ?? parent.runId };
      s.horizon.historicalRuns.scope = s.scope;
      expect(decodeSnapshot(s)).toEqual(s);
      const unavailable = {
        status: "unavailable" as const,
        workspaceId: parent.admission.context.workspaceId,
        taskId: parent.taskId,
        error: publicError("corrupt-selected"),
      };
      expect(decodeSnapshot({ ...s, context: unavailable }).runs).toEqual(
        s.runs,
      );
      for (const taskId of [id(), null]) {
        const context = { ...unavailable, taskId };
        expect(() => decodeSnapshot({ ...s, context })).toThrow();
        expect(() =>
          contract.decodeLiveEvent({
            kind: "update",
            storeId: s.storeId,
            epoch: s.epoch,
            scope: s.scope,
            previousSeq: "1",
            committedSeq: "2",
            runs: s.runs,
            removed: [],
            context,
          }),
        ).toThrow();
      }
    },
  );

  it.each(["same", "different"] as const)(
    "bounds %s-ID submit queues behind a stalled original lookup without late commits",
    async (ids) => {
      const f = fixture(),
        command = await f.prepare(),
        held = deferred<StoredLookup>();
      const lookup = vi.fn(() => held.promise);
      f.persistence.lookup = lookup;
      vi.useFakeTimers();
      try {
        const count = Math.min(
          LIMITS.admissionCount,
          LIMITS.admissionBytes / (4 * LIMITS.controlBytes),
        );
        const pending = Array.from({ length: count }, () =>
          f.admission.submit(
            {
              ...command,
              commandId: ids === "same" ? command.commandId : id(),
            },
            f.caller,
          ),
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(f.admission.accounting.count).toBe(count);
        expect(await f.admission.submit(command, f.caller)).toMatchObject({
          kind: "error",
          error: { code: "capacity" },
        });
        await vi.advanceTimersByTimeAsync(LIMITS.recordingStallMs);
        expect(
          (await Promise.all(pending)).every((reply) => reply.kind === "error"),
        ).toBe(true);
        // Timer/microtask ordering may start other already-reserved readonly
        // lookups before their own timer fires. Every original stays charged;
        // the requirement is finite retention and no late commit/activation.
        const originals = lookup.mock.calls.length;
        expect(originals).toBeGreaterThanOrEqual(1);
        expect(originals).toBeLessThanOrEqual(count);
        expect(f.admission.accounting).toEqual({
          count: originals,
          bytes: originals * 4 * LIMITS.controlBytes,
          unresolved: originals,
        });
        held.resolve({ status: "absent", committedSeq: "0" });
        await vi.advanceTimersByTimeAsync(0);
        expect(f.admission.accounting.count).toBe(0);
        expect(lookup).toHaveBeenCalledTimes(originals);
        expect(f.rows.size).toBe(0);
        expect(f.launches).toHaveLength(0);
      } finally {
        held.resolve({ status: "inconclusive" });
        vi.useRealTimers();
      }
    },
  );

  it.each(["eof", "trailing-frame", "abort"] as const)(
    "export retains a received trailer until original %s without publishing false completion",
    async (ending) => {
      const controller = new AbortController(),
        held = deferred(),
        reached = deferred();
      const request: contract.ExportRequest = {
        storeId: id(),
        scope: { kind: "task", id: id() },
        snapshotSeq: "1",
        format: "ndjson",
      };
      const manifest: contract.ExportFrame = {
        exportId: id(),
        ordinal: 1,
        event: {
          kind: "manifest",
          schema: contract.EXPORT_SCHEMA,
          request,
          coverage,
          serviceProtocol: 1,
          workerProtocol: 2,
          provenance: {
            exporterBuildSha256: hash,
            capturePolicy: "public-text-tools/2",
          },
        },
      };
      const trailer: contract.ExportFrame = {
        exportId: manifest.exportId,
        ordinal: 2,
        event: {
          kind: "trailer",
          complete: true,
          frames: 1,
          encodedBytes: contract.utf8Bytes(
            contract.encodeExportFrame(manifest, request.format),
          ),
          sha256: hash,
          committedSeq: "1",
          coverage,
        },
      };
      const client = new ServiceClient({
        ...readonlyTransport(),
        export: async function* () {
          yield manifest;
          yield trailer;
          reached.resolve();
          await held.promise;
          if (ending === "trailing-frame") yield { ...manifest, ordinal: 3 };
        },
      });
      const stream = client.export(request, controller.signal);
      expect((await stream.next()).value).toEqual(manifest);
      let settled = false;
      const pending = stream.next();
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await reached.promise;
      expect(settled).toBe(false);
      if (ending === "abort") controller.abort();
      held.resolve();
      if (ending === "eof") {
        expect((await pending).value).toEqual(trailer);
        expect((await stream.next()).done).toBe(true);
      } else await expect(pending).rejects.toThrow("unavailable");
    },
  );

  it("in-flight conflicting IDs cannot borrow saturated Cancel safety authority (injected ports)", async () => {
    const f = fixture(),
      held = deferred<StoredLookup>();
    const runId = id(),
      otherRun = id();
    f.targets.set(runId, "active");
    f.targets.set(otherRun, "active");
    f.persistence.lookup = () => held.promise;
    vi.useFakeTimers();
    try {
      const command = { commandId: id(), epoch: f.current.epoch, runId };
      const pending = Array.from({ length: LIMITS.admissionCount }, () =>
        f.admission.cancel(command, f.caller),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(
        await f.admission.cancel({ ...command, runId: otherRun }, f.caller),
      ).toMatchObject({
        kind: "error",
        error: { code: "conflict", effect: "none" },
      });
      const priorId = id();
      f.persistence.reservedIdentity = (selected) =>
        selected === priorId
          ? { kind: "cancel", epoch: f.current.epoch, runId }
          : null;
      expect(
        await f.admission.cancel(
          { ...command, commandId: priorId, runId: otherRun },
          f.caller,
        ),
      ).toMatchObject({
        kind: "error",
        error: { code: "conflict", effect: "none" },
      });
      expect(f.stops).toEqual([]);
      held.resolve({ status: "inconclusive" });
      await Promise.all(pending);
      expect(f.stops).not.toContain(otherRun);
    } finally {
      held.resolve({ status: "inconclusive" });
      vi.useRealTimers();
    }
  });
});
