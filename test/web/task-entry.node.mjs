import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { approvePlan, beginTask } from "../../web/src/client/task-entry.ts";

function fixture() {
  const context = {
    epoch: randomUUID(),
    workspaceId: randomUUID(),
    cwdId: randomUUID(),
    accessGeneration: 1,
    configRev: 1,
    controlRev: 1,
    model: {
      sourceSelectionId: randomUUID(),
      provider: "fixture",
      model: "model",
      api: "openai-completions",
      thinking: "off",
    },
    checkEnvGeneration: 1,
    checkoutGeneration: 0,
    observation: { identity: "a".repeat(64), complete: true },
    task: null,
  };
  const taskId = randomUUID();
  const taskContext = {
    ...context,
    task: { id: taskId, kind: "code", revision: 1, identity: "b".repeat(64) },
  };
  const calls = [],
    observations = [];
  const abort = new AbortController();
  let published = false;
  const receipt = (command, extra = {}) => ({
    commandId: command.commandId,
    operationId: randomUUID(),
    runId: null,
    admission: "accepted",
    committedSeq: "2",
    execution: null,
    settlement: null,
    created: null,
    publication: "published",
    ...extra,
  });
  const client = {
    preflight: async (version, action) => {
      calls.push(`preflight:${action.kind}`);
      return {
        kind: "ok",
        value: {
          grant: "fixture",
          expiresAt: new Date(Date.now() + 120000).toISOString(),
          preview: { version, action, readablePlan: "", graph: null },
        },
      };
    },
    create: async (command) => {
      calls.push("create");
      assert.equal(command.action.taskKind, "code");
      published = true;
      return {
        kind: "ok",
        value: receipt(command, {
          created: { kind: "task", taskId, state: "published" },
        }),
      };
    },
    current: async () => {
      calls.push("current");
      assert.ok(published);
      return {
        kind: "ok",
        value: { context: { status: "available", version: taskContext } },
      };
    },
    generatePlan: async (command) => {
      calls.push("generate-plan");
      return {
        kind: "ok",
        value: receipt(command, {
          runId: randomUUID(),
          publication: "pending",
        }),
      };
    },
    receipt: async () => {
      throw new Error("Unexpected receipt read");
    },
    start: async (command) => {
      calls.push("start");
      return { kind: "ok", value: receipt(command, { runId: randomUUID() }) };
    },
  };
  const input = {
    client,
    context,
    storeId: randomUUID(),
    goal: "Inspect the code",
    signal: abort.signal,
    observe: (value) => observations.push(value),
  };
  return {
    client,
    input,
    calls,
    observations,
    abort,
    taskContext,
    receipt,
    taskId,
  };
}

test("one explicit send creates a code task and starts readonly analysis, never editing", async () => {
  const f = fixture();
  assert.equal(await beginTask(f.input), f.taskId);
  assert.deepEqual(f.calls, [
    "preflight:create",
    "create",
    "current",
    "preflight:generate-plan",
    "generate-plan",
  ]);
  assert.equal(f.observations.filter((value) => value.receipt).length, 2);
});

test("pending creation is observed by its original ID before analysis", async () => {
  const f = fixture(),
    create = f.client.create;
  let accepted;
  f.client.create = async (command) => {
    const reply = await create(command);
    accepted = reply.value;
    return {
      kind: "ok",
      value: {
        ...accepted,
        publication: "pending",
        created: { ...accepted.created, state: "reserved" },
      },
    };
  };
  f.client.receipt = async (id) => {
    assert.equal(id, accepted.commandId);
    f.calls.push("receipt");
    return { status: "found", receipt: accepted };
  };
  await beginTask(f.input);
  assert.deepEqual(f.calls, [
    "preflight:create",
    "create",
    "receipt",
    "current",
    "preflight:generate-plan",
    "generate-plan",
  ]);
});

test("fenced inconclusive receipt reads are observed again, never resubmitted", async () => {
  const f = fixture(),
    create = f.client.create;
  let accepted;
  f.client.create = async (command) => {
    const reply = await create(command);
    accepted = reply.value;
    return {
      kind: "ok",
      value: {
        ...accepted,
        publication: "pending",
        created: { ...accepted.created, state: "reserved" },
      },
    };
  };
  let reads = 0;
  f.client.receipt = async () => {
    f.calls.push("receipt");
    return ++reads < 3
      ? {
          status: "inconclusive",
          error: { code: "receipt-inconclusive", effect: "uncertain" },
        }
      : { status: "found", receipt: accepted };
  };
  await beginTask(f.input);
  assert.deepEqual(f.calls, [
    "preflight:create",
    "create",
    "receipt",
    "receipt",
    "receipt",
    "current",
    "preflight:generate-plan",
    "generate-plan",
  ]);
});

test("an absent receipt stops the sequence without another command", async () => {
  const f = fixture(),
    create = f.client.create;
  f.client.create = async (command) => {
    const reply = await create(command);
    return { kind: "ok", value: { ...reply.value, publication: "pending" } };
  };
  f.client.receipt = async () => {
    f.calls.push("receipt");
    return { status: "absent", committedSeq: "1" };
  };
  await assert.rejects(beginTask(f.input), /receipt-inconclusive/);
  assert.deepEqual(f.calls, ["preflight:create", "create", "receipt"]);
});

test("lost create response retains the command identity and never retries or starts", async () => {
  const f = fixture();
  f.client.create = async () => {
    f.calls.push("create");
    throw new Error("lost");
  };
  await assert.rejects(beginTask(f.input));
  assert.deepEqual(f.calls, ["preflight:create", "create"]);
  assert.ok(f.observations[0].commandId);
});

test("departure after creation prevents follow-up analysis without canceling accepted work", async () => {
  const f = fixture(),
    create = f.client.create;
  f.client.create = async (command) => {
    const reply = await create(command);
    f.abort.abort();
    return reply;
  };
  await assert.rejects(beginTask(f.input));
  assert.deepEqual(f.calls, ["preflight:create", "create"]);
});

test("a changed model after create cannot inherit the original Send consent", async () => {
  const f = fixture();
  f.taskContext.model = { ...f.taskContext.model, model: "other" };
  await assert.rejects(beginTask(f.input), /stale/);
  assert.ok(!f.calls.includes("generate-plan"));
});

test("unpublished creation stops rather than guessing a task is ready", async () => {
  const f = fixture();
  f.client.create = async (command) => ({
    kind: "ok",
    value: f.receipt(command, {
      publication: "uncertain",
      created: { kind: "task", taskId: f.taskId, state: "reserved" },
    }),
  });
  await assert.rejects(beginTask(f.input));
  assert.ok(!f.calls.includes("current"));
});

test("a refused readonly preflight leaves the created task observable and never edits", async () => {
  const f = fixture(),
    preflight = f.client.preflight;
  f.client.preflight = async (context, action) =>
    action.kind === "generate-plan"
      ? { kind: "error", error: { code: "conflict", effect: "none" } }
      : preflight(context, action);
  await assert.rejects(beginTask(f.input), /conflict/);
  assert.ok(f.observations.some((value) => value.receipt?.created));
  assert.ok(!f.calls.includes("start"));
});

function approvalFixture() {
  const f = fixture();
  const graph = { taskId: f.taskId, revision: 1, assignments: [] };
  const prepared = {
    commandId: randomUUID(),
    submitted: false,
    preflight: {
      grant: "save",
      expiresAt: new Date(Date.now() + 120000).toISOString(),
      preview: {
        version: f.taskContext,
        action: {
          kind: "save-plan",
          taskId: f.taskId,
          plan: "Approved plan",
          graph,
        },
      },
    },
  };
  f.client.savePlan = async (command) => {
    f.calls.push("save-plan");
    return { kind: "ok", value: f.receipt(command) };
  };
  f.client.current = async () => ({
    kind: "ok",
    value: {
      context: {
        status: "available",
        version: {
          ...f.taskContext,
          controlRev: 2,
          task: { ...f.taskContext.task, revision: 2 },
        },
      },
    },
  });
  const preflight = f.client.preflight;
  f.client.preflight = async (context, action) => {
    const reply = await preflight(context, action);
    reply.value.preview.graph = graph;
    reply.value.preview.readablePlan = "Approved plan";
    return reply;
  };
  return { ...f, prepared, graph };
}

test("departure after Save cannot start implementation", async () => {
  const f = approvalFixture(),
    save = f.client.savePlan;
  f.client.savePlan = async (command) => {
    const reply = await save(command);
    f.abort.abort();
    return reply;
  };
  await assert.rejects(approvePlan({ ...f.input, prepared: f.prepared }));
  assert.deepEqual(f.calls, ["save-plan"]);
});

test("expired approval cannot save or start", async () => {
  const f = approvalFixture();
  f.prepared.preflight.expiresAt = new Date(0).toISOString();
  await assert.rejects(
    approvePlan({ ...f.input, prepared: f.prepared }),
    /expired/,
  );
  assert.deepEqual(f.calls, []);
});

test("reusing a submitted approval cannot save or start twice", async () => {
  const f = approvalFixture();
  await approvePlan({ ...f.input, prepared: f.prepared });
  await assert.rejects(
    approvePlan({ ...f.input, prepared: f.prepared }),
    /Already submitted/,
  );
  assert.equal(f.calls.filter((call) => call === "start").length, 1);
});

test("lost Start reply never repeats implementation", async () => {
  const f = approvalFixture();
  f.client.start = async () => {
    f.calls.push("start");
    throw new Error("lost");
  };
  await assert.rejects(approvePlan({ ...f.input, prepared: f.prepared }));
  assert.equal(f.calls.filter((call) => call === "start").length, 1);
  assert.ok(f.observations.at(-1).commandId);
});

test("one plan confirmation saves and starts the exact approved graph", async () => {
  const f = approvalFixture();
  await approvePlan({ ...f.input, prepared: f.prepared });
  assert.deepEqual(f.calls, ["save-plan", "preflight:start", "start"]);
});

test("a different saved graph cannot be started under the approved plan", async () => {
  const f = approvalFixture(),
    preflight = f.client.preflight;
  f.client.preflight = async (...args) => {
    const reply = await preflight(...args);
    reply.value.preview.graph = { ...f.graph, revision: 2 };
    return reply;
  };
  await assert.rejects(
    approvePlan({ ...f.input, prepared: f.prepared }),
    /stale/,
  );
  assert.ok(!f.calls.includes("start"));
});

test("changed checkout observation after Save requires new approval", async () => {
  const f = approvalFixture(),
    current = f.client.current;
  f.client.current = async () => {
    const reply = await current();
    reply.value.context.version.observation = {
      identity: "c".repeat(64),
      complete: true,
    };
    return reply;
  };
  await assert.rejects(
    approvePlan({ ...f.input, prepared: f.prepared }),
    /stale/,
  );
  assert.ok(!f.calls.includes("start"));
});
