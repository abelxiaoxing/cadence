// Isolated native qualification driver. Only fabricated stores and numeric
// loopback HTTP. SDK uses its genuine public file coordination/refresh paths.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { OwnerModelContext } from "../../src/service/model-context.ts";
import { ServiceOwner } from "../../src/service/owner.ts";
import { ContractError } from "../../src/service-contract.ts";

const [scenario, root] = process.argv.slice(2);
const home = join(root, "home");
const cwd = join(root, "workspace");
const agentDir = join(home, ".pi", "agent");
mkdirSync(cwd, { recursive: true });
mkdirSync(agentDir, { recursive: true, mode: 0o700 });
const authPath = join(agentDir, "auth.json");
const modelsPath = join(agentDir, "models.json");
const canary = "FABRICATED_cadence_secret_DO_NOT_REPORT_873195";
const literalBraces = `\${literal$CADENCE_MISSING}`;
const authData = {
  fixture: { type: "api_key", key: canary },
  unrelated: { type: "api_key", key: "unrelated-fabricated" },
};
const modelData = {
  providers: {
    fixture: {
      baseUrl: "http://127.0.0.1:9/v1",
      api: "openai-completions",
      models: [{ id: "fixed", reasoning: false }],
    },
  },
};
const write = (path, value) =>
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
write(authPath, authData);
write(modelsPath, modelData);
const c = new ServiceCoordination(cwd, join(root, "state"));
const config = {
  schema: "cadence-service-owner-config/1",
  endpoint: "http://127.0.0.1:17423",
  policyIdentity: "a".repeat(64),
};
c.initialize(config);
const lease = c.acquire(config);
const committed = {
  status: "committed",
  batch: {
    committedSeq: "1",
    details: [],
    ownerDetails: [],
    coverage: {
      observed: "complete",
      source: "complete",
      redacted: false,
      omissions: [],
    },
  },
};
// W3 journal callbacks are explicit injections, not actual durable-history evidence.
const records = [];
let allow = true;
let authCalls = 0;
let constructed = 0;
let launches = 0;
let encodeCalls = 0;
let runtime;
let originalSettled = true;
let opaqueReads = 0;
let authGate;
let originalSignal;
let optionsSeen;
let pendingOriginal;
let lateStop;
let preparationHook = async () => committed;
let settlementHook = async () => committed;
const owner = new ServiceOwner(lease, {
  quiesce: () => {
    allow = false;
  },
  flush: async () => committed,
  closeListener: async () => {},
});
const trackAuth = owner.trackAuth.bind(owner);
owner.trackAuth = (original, settlement) => {
  assert.equal(original, pendingOriginal);
  return trackAuth(original, settlement);
};
const accounting = {
  preparation: async (value) => {
    records.push({ type: "preparation", ...value });
    return preparationHook(value);
  },
  settlement: async (value) => {
    assert.equal(originalSettled, true);
    records.push({ type: "settlement", ...value });
    return settlementHook(value);
  },
};
const make = (extra = {}) =>
  new OwnerModelContext({
    home,
    cwd,
    environment: { ...process.env },
    owner,
    accounting,
    ...extra,
  });
const context = make();
const select = (ctx = context, extra = {}) =>
  ctx.select({
    provider: "fixture",
    model: "fixed",
    api: "openai-completions",
    thinking: "off",
    ...extra,
  });
const request = (selection) => ({
  protocol: 2,
  taskId: randomUUID(),
  taskKind: "code",
  runId: randomUUID(),
  childRunId: randomUUID(),
  assignmentId: "one",
  purpose: "research",
  model: selection,
  role: { role: "design-explorer", sha256: "a".repeat(64) },
  context: "Selected fabricated context",
  instructions: "Read only",
  prompt: "Inspect",
  handoff: { graphRevision: 1, inputs: [] },
});
const prepare = (selection, ctx = context, extra = {}) =>
  ctx.prepare({
    request: request(selection),
    operationId: randomUUID(),
    epoch: lease.registration.epoch,
    timeoutMs: scenario === "oauth-budget" ? 1_200_000 : 1000,
    signal: new AbortController().signal,
    current: () => allow,
    ...extra,
  });
const use = (result, inspect = () => {}) => {
  assert.equal(result.status, "prepared");
  return result.prepared.consume(
    (material) => {
      encodeCalls++;
      inspect(material);
      return JSON.stringify(material);
    },
    () => {
      launches++;
      return "encoded-only-not-native-launch";
    },
  );
};
const refused = (result, code) => {
  assert.equal(result.status, "refused");
  if (code) assert.equal(result.error.code, code);
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const waitFor = async (fn) => {
  const end = Date.now() + 8000;
  while (!fn()) {
    if (Date.now() > end) throw new Error("fixture prerequisite timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};
let server;
let contacts = 0;
let releaseResponse;
let competitorRequested = false;
let competing;
let exit;
let stderr = "";

async function sdkObservation() {
  // Transparent public-boundary observation. No SDK private imports or substituted
  // refresh/storage implementation in the stock OAuth/file-coordination cases.
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const create = ModelRuntime.create;
  ModelRuntime.create = async function (options) {
    constructed++;
    optionsSeen = options;
    runtime = await create.call(this, options);
    const getAuth = runtime.getAuth.bind(runtime);
    runtime.getAuth = (model, overrides) => {
      authCalls++;
      assert.equal(records.at(-1).type, "preparation");
      assert.equal(overrides.signal.aborted, false);
      originalSignal = overrides.signal;
      originalSettled = false;
      // Only these named cases inject the public getAuth boundary. All other
      // lanes call the unchanged installed SDK, including its real OAuth I/O.
      pendingOriginal = ["stalled-original", "late-auth-tracking"].includes(
        scenario,
      )
        ? authGate.promise
        : scenario === "opaque-auth"
          ? Promise.resolve(
              Object.defineProperty({}, "auth", {
                enumerable: true,
                get() {
                  opaqueReads++;
                  throw new Error("opaque");
                },
              }),
            )
          : scenario === "opaque-rejection"
            ? Promise.reject(
                new Proxy(
                  {},
                  {
                    get() {
                      opaqueReads++;
                      throw new Error("opaque");
                    },
                  },
                ),
              )
            : scenario === "literal-projection"
              ? Promise.resolve({
                  auth: {
                    apiKey: canary,
                    headers: {
                      Authorization: null,
                      "X-Literal": "!literal-$KEY",
                    },
                    baseUrl: "http://127.0.0.1:9/override",
                  },
                  env: { LITERAL: "!literal-$ENV" },
                })
              : getAuth(model, overrides);
      void pendingOriginal.then(
        () => {
          originalSettled = true;
        },
        () => {
          originalSettled = true;
        },
      );
      if (scenario === "late-auth-tracking") lateStop = owner.stop(10);
      return pendingOriginal;
    };
    return runtime;
  };
}
async function oauthSetup({
  blocked = false,
  validity = 3600,
  fail = false,
} = {}) {
  server = createServer(async (req, res) => {
    contacts++;
    assert.equal(req.url, "/v1/oauth/token");
    assert.equal(req.method, "POST");
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "fabricated-old-refresh");
    assert.equal(form.get("client_id"), "pi-gateway");
    const respond = () => {
      res.writeHead(fail ? 401 : 200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          fail
            ? { error: "invalid_grant", error_description: canary }
            : {
                access_token: canary,
                refresh_token: "fabricated-new-refresh",
                expires_in: validity,
                scope: "gateway offline_access",
              },
        ),
      );
    };
    releaseResponse = respond;
    if (!blocked) respond();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.CADENCE_FIXTURE_PORTS = String(server.address().port);
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  // Stock supported Radius OAuth, statically configured chat adapter metadata.
  // This lane qualifies auth only; no claim of Radius inference compatibility.
  modelData.providers.fixture.baseUrl = endpoint;
  modelData.providers.fixture.oauth = "radius";
  authData.fixture = {
    type: "oauth",
    access: "fabricated-old-access",
    refresh: "fabricated-old-refresh",
    expires: 1,
    scope: "gateway offline_access",
  };
  write(modelsPath, modelData);
  write(authPath, authData);
}
async function stopServer() {
  if (server) {
    const closed = new Promise((r) => server.close(r));
    server.closeIdleConnections();
    await closed;
  }
}

try {
  if (scenario === "passive") {
    const absent = make({ agentDir: join(root, "not-present") });
    const before = readFileSync(authPath);
    assert.deepEqual(absent.observe(), []);
    assert.deepEqual(context.observe(), []);
    assert.equal(existsSync(join(root, "not-present")), false);
    assert.deepEqual(readFileSync(authPath), before);
    assert.equal(existsSync(`${authPath}.lock`), false);
    assert.equal(existsSync(join(agentDir, "models-store.json")), false);
    assert.equal(constructed, 0);
  } else if (scenario.startsWith("bad-")) {
    await sdkObservation();
    const which = scenario.slice(4);
    if (which === "json") writeFileSync(authPath, `{invalid-${canary}`);
    if (which === "auth-type")
      write(authPath, { fixture: { type: "mystery", key: canary } });
    if (which === "compat-boolean") {
      modelData.providers.fixture.compat = { supportsStore: "yes" };
      write(modelsPath, modelData);
    }
    if (which === "compat-enum") {
      modelData.providers.fixture.models[0].compat = {
        maxTokensField: "unknown",
      };
      write(modelsPath, modelData);
    }
    if (which === "compat-routing") {
      modelData.providers.fixture.models[0].compat = {
        openRouterRouting: { order: "not-an-array" },
      };
      write(modelsPath, modelData);
    }
    if (which === "nested-field") {
      modelData.providers.fixture.models[0].compat = { unknownFeature: true };
      write(modelsPath, modelData);
    }
    if (which === "model-field") {
      modelData.providers.fixture.unknown = canary;
      write(modelsPath, modelData);
    }
    if (which === "model-null-header") {
      modelData.providers.fixture.headers = { Authorization: null };
      write(modelsPath, modelData);
    }
    if (which === "command") {
      authData.fixture.key = `!touch ${join(root, "command-ran")}`;
      write(authPath, authData);
    }
    if (which === "model-command") {
      modelData.providers.fixture.headers = {
        Authorization: `!touch ${join(root, "command-ran")}`,
      };
      write(modelsPath, modelData);
    }
    if (which === "env-file") {
      authData.fixture.env = {
        GOOGLE_APPLICATION_CREDENTIALS: join(root, "command-ran"),
      };
      write(authPath, authData);
    }
    if (which === "auth-link") {
      const target = join(root, "auth-target");
      write(target, authData);
      const { unlinkSync } = await import("node:fs");
      unlinkSync(authPath);
      symlinkSync(target, authPath);
    }
    if (which === "model-link") {
      const target = join(root, "model-target");
      write(target, modelData);
      const { unlinkSync } = await import("node:fs");
      unlinkSync(modelsPath);
      symlinkSync(target, modelsPath);
    }
    if (which === "hardlink") linkSync(authPath, join(root, "auth-alias"));
    if (which === "large")
      writeFileSync(modelsPath, " ".repeat(1024 * 1024 + 1));
    if (which === "missing") {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(authPath);
    }
    const before = existsSync(authPath) ? readFileSync(authPath) : null;
    await assert.rejects(context.load(), ContractError);
    assert.equal(existsSync(join(root, "command-ran")), false);
    if (before) assert.deepEqual(readFileSync(authPath), before);
    else assert.equal(existsSync(authPath), false);
    assert.equal(existsSync(`${authPath}.lock`), false);
    assert.equal(records.length, 0);
    assert.equal(constructed, 0);
  } else {
    await sdkObservation();
    // Pi creates its sources with the user's umask; their mode is no premise.
    if (scenario === "umask-modes") {
      chmodSync(agentDir, 0o775);
      chmodSync(authPath, 0o664);
      chmodSync(modelsPath, 0o664);
    }
    const oauth = scenario.startsWith("oauth-");
    if (oauth)
      await oauthSetup({
        blocked: [
          "oauth-cancel",
          "oauth-timeout",
          "oauth-queue",
          "oauth-stop",
          "oauth-competing",
        ].includes(scenario),
        validity: scenario === "oauth-short" ? 60 : 3600,
        fail: scenario === "oauth-failure",
      });
    if (["named-env", "stale-env"].includes(scenario)) {
      authData.fixture.key = "$CADENCE_FIXTURE_KEY";
      modelData.providers.fixture.headers = {
        "X-Provider": "Bearer $CADENCE_FIXTURE_HEADER",
      };
      modelData.providers.fixture.models[0].headers = {
        "x-provider": "$CADENCE_FIXTURE_KEY",
        "X-Model": "$!literal-$$",
      };
      write(authPath, authData);
      write(modelsPath, modelData);
    }
    if (scenario === "valid-compat") {
      modelData.providers.fixture.models[0].compat = {
        supportsStore: false,
        supportsToolSearch: true,
        supportsTemperature: false,
        supportsMidConvoSystemMessages: false,
        maxTokensField: "max_tokens",
        thinkingFormat: "chat-template",
        chatTemplateKwargs: {
          enable_thinking: { $var: "thinking.enabled", omitWhenOff: true },
          scalar: null,
        },
        chatTemplateArgs: {
          effort: { $var: "thinking.effort" },
          number: 2,
          bool: true,
          text: "fixed",
        },
        vercelGatewayRouting: { only: ["one"], order: [] },
        openRouterRouting: {
          allow_fallbacks: false,
          data_collection: "deny",
          order: ["one"],
          sort: { by: "price", partition: null },
          max_price: { prompt: "1", completion: 2 },
          preferred_min_throughput: { p50: 10 },
          preferred_max_latency: 3,
        },
      };
      write(modelsPath, modelData);
    }
    if (scenario === "template-literal-braces") {
      // Installed SDK treats an invalid braced name as ONE literal segment,
      // including any dollar-sign names inside it. No missing-env fallback.
      authData.fixture.key = literalBraces;
      write(authPath, authData);
    }
    if (scenario === "static-jsonc") {
      const body = JSON.stringify(modelData, null, 2).replace(
        '"reasoning": false',
        '"reasoning": false, // harmless comment !command',
      );
      writeFileSync(modelsPath, `\ufeff// selected model config\n${body}`);
    }
    if (scenario === "static-key") {
      delete authData.fixture;
      modelData.providers.fixture.apiKey = "$CADENCE_FIXTURE_KEY";
      write(authPath, authData);
      write(modelsPath, modelData);
    }
    if (scenario === "no-models") {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(modelsPath);
      authData.openai = { type: "api_key", key: canary };
      write(authPath, authData);
    }
    if (scenario === "env-scoped") {
      authData.fixture.env = {
        EXAMPLE_SCOPE: "literal-value",
        HTTP_HEADER: "!literal-$VALUE",
      };
      write(authPath, authData);
    }
    if (scenario === "oauth-queue") {
      modelData.providers.fixture.models.push({
        id: "second",
        reasoning: false,
      });
      write(modelsPath, modelData);
    }
    if (["mapped-thinking", "invalid-thinking-xhigh"].includes(scenario)) {
      modelData.providers.fixture.models[0].reasoning = true;
      if (scenario === "mapped-thinking")
        modelData.providers.fixture.models[0].thinkingLevelMap = {
          off: null,
          xhigh: "xhigh",
        };
      write(modelsPath, modelData);
    }
    if (scenario === "auth-size") {
      authData.fixture.key = "x".repeat(128 * 1024);
      write(authPath, authData);
    }
    if (scenario === "invalid-schema") {
      modelData.providers.fixture.models[0].reasoning = "yes";
      write(modelsPath, modelData);
    }
    if (scenario === "invalid-schema") {
      await assert.rejects(context.load(), ContractError);
      assert.equal(authCalls, 0);
    } else {
      const active =
        scenario === "oauth-timeout"
          ? make({ waitMs: 100 })
          : scenario === "explicit-dir"
            ? make({
                agentDir,
                environment: {
                  ...process.env,
                  PI_CODING_AGENT_DIR: join(root, "missing"),
                },
              })
            : context;
      await active.load();
      assert.equal(optionsSeen.allowModelNetwork, false);
      assert.equal(optionsSeen.refreshOnCreate, false);
      assert.equal(optionsSeen.authPath, authPath);
      assert.ok(optionsSeen.modelsStore);
      assert.equal(authCalls, 0);
      if (scenario === "environment-accessor") {
        let reads = 0;
        assert.throws(
          () =>
            make({
              environment: Object.defineProperty({}, "TOKEN", {
                get() {
                  reads++;
                  return canary;
                },
              }),
            }),
          ContractError,
        );
        assert.equal(reads, 0);
      }
      if (scenario === "one-runtime")
        await assert.rejects(make().load(), ContractError);
      assert.equal(existsSync(join(agentDir, "models-store.json")), false);
      assert.equal(existsSync(join(agentDir, "settings.json")), false);
      if (scenario.startsWith("invalid-") || scenario === "no-source") {
        if (scenario === "invalid-thinking-xhigh")
          assert.throws(
            () => select(active, { thinking: "xhigh" }),
            ContractError,
          );
        if (scenario === "invalid-thinking")
          assert.throws(
            () => select(active, { thinking: "high" }),
            ContractError,
          );
        if (scenario === "invalid-api")
          assert.throws(
            () => select(active, { api: "anthropic-messages" }),
            ContractError,
          );
        if (scenario === "invalid-model")
          assert.throws(
            () => select(active, { model: "absent" }),
            ContractError,
          );
        if (scenario === "invalid-provider")
          assert.throws(
            () => select(active, { provider: "absent" }),
            ContractError,
          );
        if (scenario === "invalid-transport") {
          // Public provider registration injection; unsupported even if same API/model.
          runtime.registerProvider("fixture", {
            api: "openai-completions",
            streamSimple: () => {
              throw new Error(canary);
            },
          });
          assert.throws(() => select(active), ContractError);
        }
        if (scenario === "no-source") {
          delete authData.fixture;
          write(authPath, authData);
          assert.throws(() => select(active), ContractError);
        }
        assert.equal(authCalls, 0);
      } else {
        const selection =
          scenario === "no-models"
            ? select(active, {
                provider: "openai",
                model: "gpt-4o",
                api: "openai-responses",
              })
            : select(
                active,
                scenario === "mapped-thinking" ? { thinking: "xhigh" } : {},
              );
        assert.match(selection.sourceSelectionId, /^[0-9a-f-]{36}$/);
        assert.equal(JSON.stringify(active.observe()).includes(canary), false);
        if (scenario === "stale-key") {
          authData.fixture.key = "changed-fabricated";
          write(authPath, authData);
        }
        if (scenario === "stale-model") {
          modelData.providers.fixture.models[0].maxTokens = 100;
          write(modelsPath, modelData);
        }
        if (scenario === "corrupt-after-load")
          writeFileSync(authPath, `{${canary}`);
        if (scenario === "stale-env")
          process.env.CADENCE_FIXTURE_KEY = "changed-fabricated";
        if (scenario === "proxy") process.env.HTTP_PROXY = "http://127.0.0.1:9";
        if (scenario === "intent-refused")
          preparationHook = async () => ({
            status: "refused",
            error: {
              code: "recording-exhausted",
              effect: "none",
              recovery: "operator",
            },
            durability: "none",
          });
        if (scenario === "changed-intent")
          preparationHook = async () => {
            authData.fixture.key = "changed";
            write(authPath, authData);
            return committed;
          };
        if (scenario === "changed-settlement")
          settlementHook = async () => {
            authData.fixture.key = "changed";
            write(authPath, authData);
            return committed;
          };
        if (scenario === "settlement-reject")
          settlementHook = async () => {
            throw new Error(canary);
          };
        if (scenario === "late-auth-tracking") {
          authGate = deferred();
          const pending = prepare(selection, active);
          await waitFor(() => authCalls === 1);
          await lateStop;
          assert.equal(active.pending, 1);
          assert.equal(owner.state, "quarantined");
          authGate.resolve({ auth: { apiKey: canary } });
          refused(await pending);
          await waitFor(() => active.pending === 0);
          assert.equal(records.length, 2);
          assert.equal(records[1].admissionClosed, true);
        } else if (scenario === "stalled-original") {
          authGate = deferred();
          const controller = new AbortController();
          const pending = prepare(selection, active, {
            signal: controller.signal,
          });
          await waitFor(() => authCalls === 1);
          controller.abort();
          refused(await pending);
          const queuedController = new AbortController();
          const queued = prepare(selection, active, {
            signal: queuedController.signal,
          });
          refused(await prepare(selection, active), "capacity");
          queuedController.abort();
          refused(await queued);
          assert.equal(active.pending, 2);
          assert.equal(records.length, 1);
          assert.equal(originalSignal.aborted, false);
          authGate.resolve({ auth: { apiKey: canary } });
          await waitFor(() => active.pending === 0);
          assert.equal(records.length, 2);
          assert.equal(records[1].admissionClosed, true);
          assert.equal(authCalls, 1);
        } else if (scenario === "cancel-intent") {
          const gate = deferred();
          preparationHook = () => gate.promise;
          const controller = new AbortController();
          const pending = prepare(selection, active, {
            signal: controller.signal,
          });
          await waitFor(() => records.length === 1);
          controller.abort();
          refused(await pending);
          gate.resolve(committed);
          await waitFor(() => active.pending === 0);
          assert.equal(authCalls, 0);
          assert.deepEqual(
            records.map((r) => r.type),
            ["preparation", "settlement"],
          );
          assert.equal(records[1].outcome, "refused");
        } else if (
          [
            "oauth-cancel",
            "oauth-timeout",
            "oauth-queue",
            "oauth-stop",
            "oauth-competing",
          ].includes(scenario)
        ) {
          const controller = new AbortController();
          const pending = prepare(selection, active, {
            signal: controller.signal,
          });
          await waitFor(
            () => contacts === 1 && typeof releaseResponse === "function",
          );
          assert.equal(records.length, 1);
          assert.equal(originalSignal.aborted, false);
          let second;
          if (scenario === "oauth-queue") {
            const competingSelection = select(active, { model: "second" });
            second = prepare(competingSelection, active);
            refused(await prepare(selection, active), "capacity");
            controller.abort();
            refused(await pending);
            assert.equal(active.pending, 2);
            assert.equal(authCalls, 1);
          } else if (scenario === "oauth-stop") {
            const report = await owner.stop(20);
            assert.equal(report.state, "quarantined");
            assert.equal(report.pending.auth, 1);
            assert.equal(report.pending.storage, 1);
          } else if (scenario === "oauth-competing") {
            competing = spawn(
              process.execPath,
              [
                fileURLToPath(
                  new URL(
                    "./service-model-auth-competitor.mjs",
                    import.meta.url,
                  ),
                ),
                root,
              ],
              { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
            );
            competing.stdout.on("data", (value) => {
              if (value.toString().includes("auth-requested"))
                competitorRequested = true;
            });
            competing.stderr.on("data", (v) => {
              stderr += v;
            });
            exit = once(competing, "close");
            await waitFor(() => competitorRequested);
            assert.equal(contacts, 1);
          } else {
            if (scenario === "oauth-cancel") controller.abort();
            const result = await pending;
            refused(result);
            assert.equal(result.error.effect, "uncertain");
            assert.equal(active.pending, 1);
          }
          assert.equal(originalSignal.aborted, false);
          releaseResponse();
          if (scenario === "oauth-competing") {
            use(await pending);
            assert.deepEqual(await exit, [0, null]);
            assert.equal(stderr, "");
          } else if (scenario === "oauth-stop") refused(await pending);
          if (second) use(await second);
          await waitFor(() => active.pending === 0);
          assert.equal(contacts, 1);
          assert.equal(
            records.filter((r) => r.type === "settlement").length,
            second ? 2 : 1,
          );
          if (scenario !== "oauth-competing")
            assert.equal(records[1].admissionClosed, true);
          assert.equal(
            JSON.parse(readFileSync(authPath)).fixture.refresh,
            "fabricated-new-refresh",
          );
          assert.deepEqual(
            JSON.parse(readFileSync(authPath)).unrelated,
            authData.unrelated,
          );
        } else {
          const controller = new AbortController();
          if (scenario === "already-canceled") controller.abort();
          if (scenario === "settlement-pending") {
            const gate = deferred();
            settlementHook = () => gate.promise;
            const pending = prepare(selection, active, {
              signal: controller.signal,
            });
            await waitFor(() => records.length === 2);
            controller.abort();
            refused(await pending);
            const report = await owner.stop(20);
            assert.equal(report.pending.auth, 0);
            assert.equal(report.pending.storage, 1);
            gate.resolve(committed);
            await waitFor(() => active.pending === 0);
          } else {
            const result = await prepare(selection, active, {
              signal: controller.signal,
              current: () => {
                if (scenario === "abort-during-current" && encodeCalls > 0)
                  controller.abort();
                return allow;
              },
              ...(scenario === "wrong-epoch" ? { epoch: randomUUID() } : {}),
            });
            if (
              [
                "stale-key",
                "stale-model",
                "corrupt-after-load",
                "stale-env",
                "proxy",
                "intent-refused",
                "already-canceled",
                "oauth-short",
                "oauth-failure",
                "auth-size",
                "opaque-rejection",
                "opaque-auth",
                "wrong-epoch",
                "changed-intent",
                "changed-settlement",
                "settlement-reject",
              ].includes(scenario)
            ) {
              refused(result);
              if (scenario === "wrong-epoch") {
                assert.equal(authCalls, 0);
                assert.equal(records.length, 0);
              }
              if (
                !oauth &&
                ![
                  "auth-size",
                  "opaque-rejection",
                  "opaque-auth",
                  "wrong-epoch",
                  "changed-settlement",
                  "settlement-reject",
                ].includes(scenario)
              )
                assert.equal(authCalls, 0);
            } else if (scenario === "abort-during-current") {
              assert.throws(() => use(result), ContractError);
              assert.equal(encodeCalls, 1);
              assert.equal(launches, 0);
            } else if (scenario === "oauth-expiry-during-encode") {
              const now = Date.now;
              try {
                assert.throws(
                  () =>
                    use(result, () => {
                      // Public encoder scheduling/clock injection, not elapsed-time evidence.
                      const expires = JSON.parse(readFileSync(authPath)).fixture
                        .expires;
                      Date.now = () => expires;
                    }),
                  ContractError,
                );
                assert.equal(encodeCalls, 1);
                assert.equal(launches, 0);
              } finally {
                Date.now = now;
              }
            } else if (scenario === "cancel-prepared") {
              controller.abort();
              assert.throws(() => use(result), ContractError);
              assert.equal(encodeCalls, 0);
              assert.equal(launches, 0);
            } else if (scenario === "oversize-envelope") {
              assert.equal(result.status, "prepared");
              assert.throws(
                () =>
                  result.prepared.consume(
                    () => "x".repeat(128 * 1024 + 1),
                    () => {
                      launches++;
                    },
                  ),
                ContractError,
              );
              assert.equal(launches, 0);
            } else if (scenario === "changed-during-encode") {
              assert.equal(result.status, "prepared");
              assert.throws(
                () =>
                  result.prepared.consume(
                    (v) => {
                      authData.fixture.key = "changed";
                      write(authPath, authData);
                      return JSON.stringify(v);
                    },
                    () => {
                      launches++;
                    },
                  ),
                ContractError,
              );
              assert.equal(launches, 0);
            } else {
              use(result, (material) => {
                assert.equal(material.auth.ok, true);
                assert.equal(
                  material.auth.apiKey,
                  scenario === "template-literal-braces"
                    ? literalBraces
                    : canary,
                );
                assert.equal(material.model.headers, undefined);
                if (scenario === "valid-compat")
                  assert.equal(
                    JSON.stringify(material.model.compat),
                    JSON.stringify(
                      modelData.providers.fixture.models[0].compat,
                    ),
                  );
                if (scenario === "literal-projection") {
                  assert.equal(material.auth.headers.Authorization, null);
                  assert.equal(
                    material.auth.headers["X-Literal"],
                    "!literal-$KEY",
                  );
                  assert.equal(material.auth.env.LITERAL, "!literal-$ENV");
                  assert.equal(
                    material.model.baseUrl,
                    "http://127.0.0.1:9/override",
                  );
                }
                if (scenario === "named-env") {
                  assert.equal(material.auth.headers["x-provider"], canary);
                  assert.equal(material.auth.headers["X-Model"], "!literal-$");
                  assert.equal(material.auth.headers["X-Provider"], undefined);
                }
                if (scenario === "env-scoped")
                  assert.equal(
                    material.auth.env.HTTP_HEADER,
                    "!literal-$VALUE",
                  );
              });
              assert.equal(JSON.stringify(result).includes(canary), false);
              assert.throws(() => use(result), ContractError);
              if (oauth) {
                assert.equal(contacts, 1);
                assert.equal(
                  JSON.parse(readFileSync(authPath)).fixture.refresh,
                  "fabricated-new-refresh",
                );
                const sameSelection = { ...selection };
                use(await prepare(sameSelection, active));
                assert.equal(contacts, 1); // Normal renewal did not stale selection or refresh twice.
                assert.deepEqual(active.observe(), [selection]);
              }
            }
          }
        }
      }
    }
  }
  assert.equal(opaqueReads, 0);
  assert.equal(JSON.stringify(records).includes(canary), false);
  assert.equal(existsSync(join(root, "command-ran")), false);
  await stopServer();
  await waitFor(() => context.pending === 0);
  // Uncertain cases intentionally preserve fences; tests do not reclaim them.
  const stop = await owner.stop(1000);
  assert.equal(stop.pending.auth, 0);
  assert.equal(stop.pending.storage, 0);
  process.stdout.write(
    `${JSON.stringify({ scenario, passed: true, constructed, authCalls, contacts, encoderUses: launches, nativeWorkerSpawns: 0, records: records.map(({ type, outcome, admissionClosed, validityMs }) => ({ type, outcome, admissionClosed, validityMs })), remainingFiles: readdirSync(agentDir).sort() })}\n`,
  );
} catch {
  // No assertion dumps (which can contain fabricated secrets), provider exceptions
  // or raw configuration in receipts. Parent retains the fixed failing scenario.
  process.stderr.write(`model-context-fixture-failed:${scenario}\n`);
  process.exitCode = 1;
  try {
    releaseResponse?.();
    await stopServer();
  } catch {
    /* no fallback */
  }
}
