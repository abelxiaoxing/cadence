// Actual stock SDK + production host + real private disk/HTTP. Pending originals
// and historical admission below are explicitly injected, never workflow acceptance.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { OwnerModelChoice } from "../../src/service/model-choice.ts";
import { type HostInput, readHostConfig } from "../../src/service/runtime.ts";
import { ServiceClient } from "../../src/service-client.ts";
import {
  type ChooseModelRequest,
  type ContextVersion,
  ContractError,
  type ModelChoiceState,
  type ModelSelector,
  publicError,
  type Reply,
} from "../../src/service-contract.ts";
import { HttpServiceTransport } from "../../src/service-http-client.ts";
import { createServiceHost } from "./source-host.ts";

const [scenario, root] = process.argv.slice(2);
const workspace = join(root, "workspace"),
  agent = join(root, "agent");
for (const p of [workspace, agent]) mkdirSync(p, { mode: 0o700 });
const key = "FAKE_CHOICE_KEY_872146";
const write = (name: string, value: unknown) =>
  writeFileSync(join(agent, name), JSON.stringify(value), { mode: 0o600 });
write(
  "auth.json",
  scenario === "no-source"
    ? {}
    : {
        fixture: {
          type: "api_key",
          key:
            scenario === "template-secret-id" ? "$CHOICE_FIXTURE_VALUE" : key,
          ...(scenario === "scoped-secret-id"
            ? { env: { ORDINARY: "PRIVATE_SCOPED_84291" } }
            : {}),
          ...(["literal-capacity", "literal-duplicates"].includes(scenario)
            ? {
                env: {
                  FIRST: "A".repeat(131072),
                  SECOND: (scenario === "literal-capacity" ? "B" : "A").repeat(
                    131072,
                  ),
                },
              }
            : {}),
        },
      },
);
process.env.CHOICE_FIXTURE_VALUE = key;
process.env.CHOICE_HEADER = "PRIVATE_HEADER_29481";
const model = { id: "fixed", reasoning: false };
// Each of these IDs would reveal a credential literal (or carries controls):
// only its own entry is withheld, beside the still selectable "fixed".
const withheldId =
  scenario === "secret-id" || scenario === "template-secret-id"
    ? key
    : scenario === "scoped-secret-id"
      ? "PRIVATE_SCOPED_84291"
      : scenario === "template-header-secret-id"
        ? "PRIVATE_HEADER_29481"
        : scenario === "unsafe-id"
          ? "fixed\u001b[31m"
          : undefined;
const models =
  scenario === "capacity"
    ? Array.from({ length: 201 }, (_, i) => ({
        id: `model-${i}`,
        reasoning: false,
      }))
    : withheldId
      ? [model, { ...model, id: withheldId }]
      : [
          model,
          {
            id: "reasoner",
            reasoning: true,
            thinkingLevelMap: { xhigh: "xhigh", max: "max" },
          },
        ];
write("models.json", {
  providers: {
    fixture: {
      baseUrl: "http://127.0.0.1:9/v1",
      api: "openai-completions",
      ...(scenario === "template-header-secret-id"
        ? { headers: { "x-fixture": "$CHOICE_HEADER" } }
        : {}),
      models,
    },
    // The common Ollama placeholder: an apiKey equal to its provider ID.
    ...(scenario === "secret-id"
      ? {
          ollama: {
            baseUrl: "http://127.0.0.1:9/v1",
            api: "openai-completions",
            apiKey: "ollama",
            models: [{ id: "local", reasoning: false }],
          },
        }
      : {}),
  },
});
const authBefore = readFileSync(join(agent, "auth.json"));
let authCalls = 0,
  availabilityCalls = 0,
  constructed = 0;
let actualRuntime: ModelRuntime | undefined;
const create = ModelRuntime.create.bind(ModelRuntime);
ModelRuntime.create = async (options) => {
  constructed++;
  assert.equal(options?.refreshOnCreate, false);
  assert.equal(options?.allowModelNetwork, false);
  const runtime = await create(options);
  actualRuntime = runtime;
  runtime.getAuth = async () => {
    authCalls++;
    throw new Error("unexpected-auth");
  };
  runtime.getAvailable = async () => {
    availabilityCalls++;
    throw new Error("unexpected-availability");
  };
  runtime.checkAuth = async () => {
    availabilityCalls++;
    throw new Error("unexpected-availability");
  };
  return runtime;
};
const input: HostInput = {
  workspace,
  stateHome: join(root, "state"),
  environmentToken: null,
  config: {
    schema: "cadence-service-host/1",
    cwd: workspace,
    agentDir: agent,
    tokenSource: "generated",
    tokenFile: null,
    http: {
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 0,
      proxy: null,
    },
  },
};
let host = await createServiceHost(input);
process.env.CADENCE_FIXTURE_PORTS = new URL(host.endpoint).port;
const makeNative = () =>
  new HttpServiceTransport({
    origin: host.endpoint,
    localCapability: host.coordination.localAccess().capability,
  });
let transport = makeNative(),
  client = new ServiceClient(transport);
const ok = <T>(r: Reply<T>): T => {
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") throw new Error("refused");
  return r.value;
};
const failed = (r: Reply<unknown>, code?: string) => {
  assert.equal(r.kind, "error");
  if (code && r.kind === "error") assert.equal(r.error.code, code);
};
const choice: ModelSelector = {
  provider: "fixture",
  model: scenario === "capacity" ? "model-200" : "fixed",
  api: "openai-completions",
  thinking: "off",
};
// This guarded core fixture deliberately omits the independently compiled client
// build. Production accepting HTTP is covered separately; missing-build mutation
// must refuse before installing any selection.
const chooseCore = (request: ChooseModelRequest): Reply<ModelChoiceState> => {
  try {
    return { kind: "ok", value: host.choice.choose(request) };
  } catch (error) {
    return {
      kind: "error",
      error: publicError(
        error instanceof ContractError ? error.code : "unavailable",
      ),
    };
  }
};
const choose = async (s = choice) =>
  chooseCore({
    expected: ok(await client.models()).version,
    choice: s,
  });
const boot = ok(await client.session());
assert.equal(boot.capabilities.actions, false);
assert.equal(boot.capabilities.history, true);
// Missing client build cannot install any selection through production HTTP.
failed(
  await client.chooseModel({
    expected: host.choice.snapshot().version,
    choice,
  }),
  "unsupported-context",
);
assert.equal(host.choice.snapshot().selected, null);
const configBefore = readFileSync(host.coordination.path("host-config.json"));
const seq = host.writer.committedSeq;
assert.deepEqual(host.models.observe(), []);
assert.throws(
  () =>
    new OwnerModelChoice({
      owner: host.owner,
      models: host.models,
      access: host.access,
    }),
  ContractError,
);
let stopHandled = false;
try {
  if (withheldId) {
    const catalog = ok(await client.models());
    assert.equal(catalog.status, "complete");
    assert.deepEqual(
      catalog.entries.map((e) => [e.provider, e.model, e.eligibility]),
      [["fixture", "fixed", "candidate"]],
    );
    assert.equal(catalog.withheld, scenario === "secret-id" ? 2 : 1);
    for (const hidden of [withheldId, key, "ollama"])
      assert.ok(!JSON.stringify(catalog).includes(hidden));
    for (const refused of [
      { ...choice, model: withheldId },
      ...(scenario === "secret-id"
        ? [{ ...choice, provider: "ollama", model: "local" }]
        : []),
    ])
      failed(
        chooseCore({ expected: catalog.version, choice: refused }),
        "unsupported-context",
      );
    assert.deepEqual(host.models.observe(), []);
    if (scenario === "secret-id") assert.ok(ok(await choose()).selected);
  } else if (scenario === "literal-capacity") {
    failed(await client.models(), "oversize");
    failed(
      chooseCore({ expected: host.choice.snapshot().version, choice }),
      "oversize",
    );
    assert.deepEqual(host.models.observe(), []);
  } else if (scenario === "literal-duplicates") {
    const catalog = ok(await client.models());
    assert.equal(catalog.status, "complete");
    assert.equal(catalog.entries.length, 2);
    assert.ok(ok(await choose()).selected);
  } else if (scenario === "catalog") {
    const catalog = ok(await client.models());
    assert.equal(catalog.selected, null);
    assert.equal(catalog.status, "complete");
    assert.equal(catalog.entries.length, 2);
    assert.deepEqual(catalog.entries[0].thinking, [
      { level: "off", selectable: true },
    ]);
    // The pinned SDK supports max: a model mapping it can be chosen at max.
    assert.ok(
      catalog.entries[1].thinking.some(
        (t) => t.level === "max" && t.selectable,
      ),
    );
    assert.deepEqual(host.models.observe(), []);
    assert.ok(!JSON.stringify(catalog).includes(key));
    assert.ok(!JSON.stringify(catalog).includes("baseUrl"));
    const abort = new AbortController();
    abort.abort();
    failed(await client.models(abort.signal));
    assert.equal(host.writer.committedSeq, seq);
  } else if (scenario === "no-source") {
    assert.ok(
      ok(await client.models()).entries.every(
        (e) => e.eligibility === "auth-unavailable",
      ),
    );
    failed(await choose(), "auth-unavailable");
    assert.deepEqual(host.models.observe(), []);
  } else if (scenario === "capacity") {
    const catalog = ok(await client.models());
    assert.equal(catalog.status, "capacity");
    assert.deepEqual(catalog.entries, []);
    assert.equal(ok(await choose()).selected?.model, "model-200");
  } else if (scenario === "final-guards") {
    const selected = ok(await choose());
    const runtime = actualRuntime;
    assert.ok(runtime);
    const getProvider = runtime.getProvider.bind(runtime);
    for (const fault of ["busy", "access", "source"] as const) {
      const before = host.choice.snapshot();
      let release: (() => void) | undefined;
      let calls = 0;
      runtime.getProvider = (provider) => {
        const result = getProvider(provider);
        if (++calls === 1) {
          if (fault === "busy")
            host.owner.trackAuth(
              new Promise<void>((r) => {
                release = r;
              }),
            );
          else if (fault === "access") host.access.rotate();
          else
            writeFileSync(
              join(agent, "models.json"),
              Buffer.concat([
                readFileSync(join(agent, "models.json")),
                Buffer.from("\n"),
              ]),
            );
        }
        return result;
      };
      try {
        failed(
          chooseCore({
            expected: before.version,
            choice: { ...choice, model: "reasoner", thinking: "xhigh" },
          }),
          fault === "busy" ? "conflict" : "stale",
        );
        assert.equal(calls, 1);
        assert.deepEqual(host.choice.snapshot().selected, selected.selected);
        assert.equal(
          host.choice.snapshot().version.configRev,
          selected.version.configRev,
        );
        assert.equal(
          host.choice.snapshot().version.catalogId,
          selected.version.catalogId,
        );
        assert.deepEqual(host.models.observe(), [selected.selected]);
      } finally {
        runtime.getProvider = getProvider;
        release?.();
        await new Promise<void>((r) => setImmediate(r));
      }
    }
  } else if (scenario === "selected-source-change") {
    const selected = ok(await choose());
    write("auth.json", {
      fixture: { type: "api_key", key: "FAKE_REPLACED_KEY_42821" },
    });
    failed(
      chooseCore({
        expected: selected.version,
        choice: { ...choice, model: "reasoner", thinking: "xhigh" },
      }),
      "stale",
    );
    assert.deepEqual(host.choice.snapshot(), selected);
    assert.deepEqual(host.models.observe(), [selected.selected]);
    writeFileSync(join(agent, "auth.json"), authBefore);
  } else if (scenario === "function-guard") {
    const selected = ok(await choose());
    const selection = selected.selected;
    assert.ok(selection);
    const runtime = actualRuntime;
    assert.ok(runtime);
    const original = runtime.getProvider("fixture");
    assert.ok(original);
    let invoked = 0;
    // Registration starts its own unawaited SDK refresh; capture that genuine
    // promise and let it settle so its getModels calls are not counted below.
    const refresh = runtime.refresh;
    const settling: Promise<unknown>[] = [];
    runtime.refresh = (options) => {
      const pending = refresh.call(runtime, options);
      settling.push(pending);
      return pending;
    };
    try {
      runtime.registerNativeProvider({
        ...original,
        getModels: () => {
          invoked++;
          return original.getModels();
        },
      });
    } finally {
      runtime.refresh = refresh;
    }
    await Promise.allSettled(settling);
    invoked = 0; // Registration's SDK snapshot is setup, not a Cadence read.
    failed(await client.models(), "unsupported-context");
    assert.equal(invoked, 0);
    assert.throws(() => host.models.assertCurrent(selection));
    assert.equal(invoked, 0);
    failed(chooseCore({ expected: selected.version, choice }), "stale");
    assert.equal(invoked, 0);
    assert.deepEqual(host.choice.snapshot(), selected);
  } else if (scenario === "source-change") {
    const old = ok(await client.models());
    writeFileSync(
      join(agent, "models.json"),
      Buffer.concat([
        readFileSync(join(agent, "models.json")),
        Buffer.from("\n"),
      ]),
    );
    failed(await client.models(), "stale");
    failed(chooseCore({ expected: old.version, choice }), "stale");
    assert.deepEqual(host.models.observe(), []);
  } else if (scenario === "choice" || scenario === "rotation") {
    const initial = ok(await client.models());
    const selected = ok(await choose());
    assert.ok(selected.selected);
    const originalSelection = selected.selected;
    assert.equal(selected.version.configRev, initial.version.configRev + 1);
    assert.notEqual(selected.version.catalogId, initial.version.catalogId);
    assert.deepEqual(ok(await choose()), selected);
    const token = host.access.redactionLiterals()[0];
    const entry = await fetch(
      `${host.endpoint}/?token=${encodeURIComponent(token)}`,
      { redirect: "manual" },
    );
    assert.equal(entry.status, 303);
    const cookie = entry.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    await entry.text();
    const attachments: string[] = [];
    const browserTransport = new HttpServiceTransport({
      origin: host.endpoint,
      fetch: async (url, init) => {
        const response = await fetch(url, {
          ...init,
          headers: { ...init?.headers, Cookie: cookie, Origin: host.endpoint },
        });
        const attachment = response.headers.get("x-cadence-attachment");
        if (attachment) attachments.push(attachment);
        return response;
      },
    });
    const browser = new ServiceClient(browserTransport);
    ok(await browser.session());
    if (scenario === "choice") {
      const next = ok(
        chooseCore({
          expected: ok(await browser.models()).version,
          choice: { ...choice, model: "reasoner", thinking: "xhigh" },
        }),
      );
      assert.equal(next.selected?.thinking, "xhigh");
      assert.equal(host.models.observe().length, 1);
      assert.throws(
        () => host.models.assertCurrent(originalSelection),
        ContractError,
      );
      assert.equal(ok(await browser.session()).capabilities.actions, false);
      assert.equal(new Set(attachments).size, 1);
      assert.deepEqual(ok(await client.models()).selected, next.selected);
      for (const field of [
        "epoch",
        "accessGeneration",
        "configRev",
        "catalogId",
      ] as const) {
        const expected = {
          ...next.version,
          [field]:
            field === "configRev" || field === "accessGeneration"
              ? 999
              : randomUUID(),
        };
        failed(chooseCore({ expected, choice }), "stale");
      }
      await browserTransport.detach();
      assert.deepEqual(ok(await client.models()).selected, next.selected);
    } else {
      host.access.rotate();
      failed(await browser.models(), "unauthenticated");
      const current = ok(await client.models());
      assert.equal(
        current.version.accessGeneration,
        selected.version.accessGeneration + 1,
      );
      assert.deepEqual(current.selected, selected.selected);
      failed(chooseCore({ expected: selected.version, choice }), "stale");
      ok(await client.session()); // Explicit refresh after rotation revoked the attachment.
      assert.deepEqual(ok(await choose()).selected, selected.selected);
    }
  } else if (scenario === "busy") {
    const before = ok(await choose());
    for (const kind of ["auth", "work", "storage", "check"] as const) {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      if (kind === "auth") host.owner.trackAuth(gate);
      else if (kind === "work")
        host.owner.trackAccepted(gate.then(() => ({ status: "settled" })));
      else if (kind === "storage")
        host.owner.trackPersistence(gate.then(() => host.writer.flush()));
      else
        host.owner.trackCheck(
          gate.then(() => ({
            outcome: "canceled",
            closure: "not-launched",
            exitCode: null,
            signal: null,
            durationMs: 0,
            stdin: "not-required" as const,
          })),
          () => {},
        );
      failed(
        chooseCore({
          expected: before.version,
          choice: { ...choice, model: "reasoner", thinking: "xhigh" },
        }),
        "conflict",
      );
      assert.deepEqual(host.choice.snapshot(), before);
      release();
      await gate;
      await host.writer.settled();
      // Join all registered original reactions; this is fixture scheduling, not a timeout policy.
      await new Promise((r) => setImmediate(r));
    }
    host.owner.registerRuntime(() => host.gate.closeAdmission(), {
      assertQuiescent: () => host.gate.assertQuiescent(),
    });
    const permit = await host.gate.acquire(
      randomUUID(),
      new AbortController().signal,
    );
    failed(chooseCore({ expected: before.version, choice }), "conflict");
    permit.release();
    assert.deepEqual(ok(await choose()), before);
  } else if (scenario === "closed-action-owner") {
    host.owner.registerRuntime(() => {}); // Deliberately absent configuration participant must refuse.
    failed(await choose(), "unavailable");
    assert.equal(host.choice.snapshot().selected, null);
  } else if (scenario === "stop") {
    const before = ok(await client.models());
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    host.owner.trackAuth(gate);
    const stopping = host.owner.stop();
    assert.throws(
      () => host.choice.choose({ expected: before.version, choice }),
      ContractError,
    );
    release();
    assert.equal((await stopping).state, "stopped");
    stopHandled = true;
  } else if (scenario === "restart-floor" || scenario === "revision-ceiling") {
    const chosen = ok(await choose());
    assert.ok(chosen.selected);
    // Injected accepted metadata identity, real journal/publication/replay. Not HTTP task consent.
    const context: ContextVersion = {
      ...chosen.version,
      configRev:
        scenario === "revision-ceiling" ? Number.MAX_SAFE_INTEGER - 2 : 37,
      controlRev: 1,
      workspaceId: host.reader.files.format.workspaceId,
      cwdId: randomUUID(),
      model: chosen.selected,
      checkEnvGeneration: 1,
      checkoutGeneration: 0,
      observation: { identity: "a".repeat(64), complete: true },
      task: null,
    };
    // catalogId is not a ContextVersion field.
    const { catalogId: _catalogId, ...plain } = context as ContextVersion & {
      catalogId: string;
    };
    host.writer.supplyContext(plain);
    const intent = {
      commandId: randomUUID(),
      operationId: randomUUID(),
      createdTaskId: randomUUID(),
      runId: null,
      identity: {
        kind: "action" as const,
        expected: plain,
        action: {
          kind: "create" as const,
          taskKind: "research" as const,
          goal: "Injected replay floor fixture",
        },
      },
    };
    assert.equal((await host.writer.commit(intent)).status, "committed");
    assert.equal(
      (
        await host.writer.publishTask({
          operationId: intent.operationId,
          cwd: workspace,
        })
      ).status,
      "published",
    );
    await transport.detach();
    assert.equal((await host.owner.stop()).state, "stopped");
    const config = readHostConfig(host.coordination);
    assert.ok(config);
    host = await createServiceHost({ ...input, config });
    process.env.CADENCE_FIXTURE_PORTS = new URL(host.endpoint).port;
    transport = makeNative();
    client = new ServiceClient(transport);
    ok(await client.session());
    const fresh = ok(await client.models());
    assert.equal(fresh.selected, null);
    assert.equal(fresh.version.configRev, 1); // Prior task policy never sets current choice authority.
    assert.deepEqual(host.models.observe(), []);
    failed(chooseCore({ expected: chosen.version, choice }), "stale");
    if (scenario === "revision-ceiling") {
      // Explicit counter-ceiling injection, not authority reconstructed from old task records.
      Object.defineProperty(host.choice, "revision", {
        value: Number.MAX_SAFE_INTEGER - 1,
        writable: true,
      });
    }
    const replacement = ok(await choose());
    assert.notEqual(
      replacement.selected?.sourceSelectionId,
      chosen.selected.sourceSelectionId,
    );
    if (scenario === "revision-ceiling") {
      assert.equal(replacement.version.configRev, Number.MAX_SAFE_INTEGER);
      assert.deepEqual(ok(await choose()), replacement);
      failed(
        chooseCore({
          expected: replacement.version,
          choice: { ...choice, model: "reasoner", thinking: "xhigh" },
        }),
        "capacity",
      );
      assert.deepEqual(host.choice.snapshot(), replacement);
      assert.deepEqual(host.models.observe(), [replacement.selected]);
    }
    assert.equal(constructed, 2);
  } else throw new Error("unknown-scenario");
  assert.ok(readFileSync(join(agent, "auth.json")).equals(authBefore));
  assert.ok(
    readFileSync(host.coordination.path("host-config.json")).equals(
      configBefore,
    ),
  );
  assert.equal(authCalls, 0);
  assert.equal(availabilityCalls, 0);
  if (!stopHandled) {
    await transport.detach();
    assert.equal((await host.owner.stop()).state, "stopped");
    stopHandled = true;
  }
  const receipt = `${JSON.stringify({
    scenario,
    passed: true,
    authCalls,
    availabilityCalls,
    constructed,
    taskAdmission: false,
    evidence:
      "actual SDK/disk/read HTTP; choice private core; busy originals/replay admission injected; production mutation closed",
  })}\n`;
  writeFileSync(join(root, "receipt.json"), receipt);
  process.stdout.write(receipt);
} finally {
  if (!stopHandled) {
    await host.owner.stop();
    host.live.close();
    await host.http.close();
  }
}
