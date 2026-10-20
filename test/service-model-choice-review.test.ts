/** Disk/HTTP boundary controls with explicitly injected metadata/ports. No host choice admission. */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { HistoryRecovery } from "../src/history/recovery.ts";
import { RECORD_BYTES } from "../src/history/types.ts";
import { HistoryWriter } from "../src/history/writer.ts";
import { hash } from "../src/service/private-files.ts";
import { inspectRecovery } from "../src/service/recovery.ts";
import { ServiceClient, type ServiceTransport } from "../src/service-client.ts";
import {
  type ChooseModelRequest,
  ContractError,
  canonicalJson,
  decodeModelCatalog,
  LIMITS,
} from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import {
  httpFixture,
  request,
  session,
} from "./helpers/service-http-fixture.ts";

const selector = {
  provider: "fixture",
  model: "fixed",
  api: "openai-completions",
  thinking: "off",
} as const;
const version = {
  epoch: randomUUID(),
  accessGeneration: 1,
  configRev: 1,
  catalogId: randomUUID(),
};
const catalog = { version, selected: null, status: "complete", entries: [] };

it.each(["models", "chooseModel"] as const)(
  "%s rejects raw Reply bytes above 512KiB before normalizing whitespace",
  async (operation) => {
    const value =
      operation === "models"
        ? catalog
        : {
            version: { ...version, configRev: 2, catalogId: randomUUID() },
            selected: { ...selector, sourceSelectionId: randomUUID() },
          };
    const encoded = JSON.stringify({ kind: "ok", value });
    let extra = 0,
      calls = 0;
    const server = createServer((req, res) => {
      req.resume();
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/v1/session") {
        res.setHeader("x-cadence-attachment", randomUUID());
        res.end(
          JSON.stringify({
            kind: "ok",
            value: {
              protocol: 1,
              storeId: randomUUID(),
              epoch: version.epoch,
              accessGeneration: 1,
              authority: "local",
              csrf: null,
              capabilities: {
                history: true,
                actions: false,
                manualChecks: false,
              },
            },
          }),
        );
      } else {
        calls++;
        res.end(
          encoded +
            " ".repeat(LIMITS.pageBytes - Buffer.byteLength(encoded) + extra),
        );
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw Error("fixture address");
    const transport = new HttpServiceTransport({
      origin: `http://127.0.0.1:${address.port}`,
      localCapability: "fabricated-response-fixture",
    });
    const run = () =>
      operation === "models"
        ? transport.models()
        : transport.chooseModel({ expected: version, choice: selector });
    try {
      await transport.session();
      expect(await run()).toMatchObject({ kind: "ok", value });
      extra = 1;
      await expect(run()).rejects.toMatchObject({ code: "oversize" });
      expect(calls).toBe(2); // No retry after rejection.
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  },
);

it("model optional ports refuse and choice shares actual cookie/CSRF/attachment/native ingress", async () => {
  const f = await httpFixture();
  try {
    const browser = await session(f),
      native = await session(f, true);
    const input: ChooseModelRequest = {
      expected: { ...version, epoch: f.epoch },
      choice: selector,
    };
    const post = (
      headers: Record<string, string>,
      body = JSON.stringify(input),
      path = "/api/v1/model-choice",
    ) => request(f.origin, path, { method: "POST", headers, body });
    const absent = await request(f.origin, "/api/v1/models", {
      headers: browser.headers,
    });
    expect(absent.status).toBe(503);
    expect(JSON.parse(absent.text)).toMatchObject({
      kind: "error",
      error: { effect: "none" },
    });
    expect((await post(native.headers)).status).toBe(503);
    let reads = 0,
      installs = 0;
    f.adapters.models = {
      catalog: () => {
        reads++;
        return decodeModelCatalog({ ...catalog, version: input.expected });
      },
    };
    // Explicit injected port: tests routing only, not production model/SDK acceptance.
    f.adapters.modelChoice = {
      choose: (r) => {
        installs++;
        return {
          version: {
            ...r.expected,
            configRev: r.expected.configRev + 1,
            catalogId: randomUUID(),
          },
          selected: { ...r.choice, sourceSelectionId: randomUUID() },
        };
      },
    };
    expect(
      (
        await request(f.origin, "/api/v1/models", {
          headers: { cookie: f.cookie },
        })
      ).status,
    ).toBe(200);
    expect(reads).toBe(1);
    const noCsrf: Record<string, string> = { ...browser.headers };
    delete noCsrf["x-cadence-csrf"];
    const noAttachment: Record<string, string> = { ...browser.headers };
    delete noAttachment["x-cadence-attachment"];
    for (const headers of [
      noCsrf,
      noAttachment,
      { ...browser.headers, origin: "https://foreign.invalid" },
      { ...native.headers, origin: f.origin },
      { ...native.headers, "x-forwarded-for": "127.0.0.1" },
    ]) {
      expect((await post(headers)).status).not.toBe(200);
      expect(installs).toBe(0);
    }
    for (const body of [
      JSON.stringify({ ...input, surface: "terminal" }),
      JSON.stringify({ ...input, choice: { ...selector, thinking: "max" } }),
      '{"expected":null,"expected":null,"choice":null}',
    ]) {
      expect((await post(native.headers, body)).status).not.toBe(200);
      expect(installs).toBe(0);
    }
    expect(
      (
        await post(
          native.headers,
          JSON.stringify(input),
          "/api/v1/model-choice?input=x",
        )
      ).status,
    ).not.toBe(200);
    expect(installs).toBe(0);
    expect((await post(browser.headers)).status).toBe(200);
    expect((await post(native.headers)).status).toBe(200);
    expect(installs).toBe(2);
  } finally {
    await f.server.close();
  }
});

it.each([
  "epoch",
  "accessGeneration",
  "configRev",
  "catalogId",
  "selected",
  "lost",
])(
  "choice %s response fault is uncertain with exactly one dispatch",
  async (fault) => {
    let calls = 0;
    const client = new ServiceClient({
      chooseModel: async () => {
        calls++;
        if (fault === "lost") throw Error("fixture lost response");
        const result = {
          version: { ...version, configRev: 2, catalogId: randomUUID() },
          selected: {
            ...selector,
            model: String(selector.model),
            sourceSelectionId: randomUUID(),
          },
        };
        if (fault === "epoch") result.version.epoch = randomUUID();
        if (fault === "accessGeneration") result.version.accessGeneration++;
        if (fault === "configRev") result.version.configRev++;
        if (fault === "catalogId") result.version.catalogId = version.catalogId;
        if (fault === "selected") result.selected.model = "different";
        return { kind: "ok", value: result };
      },
    } as unknown as ServiceTransport);
    expect(
      await client.chooseModel({ expected: version, choice: selector }),
    ).toMatchObject({ kind: "error", error: { effect: "uncertain" } });
    expect(calls).toBe(1);
  },
);

it("accepted metadata floor survives epochs/recovery without resource policy; corruption refuses without repair", async () => {
  const f = historyFixture();
  const context = { ...f.context, configRev: 81, task: null };
  f.writer.supplyContext(context);
  const intent = {
    commandId: randomUUID(),
    operationId: randomUUID(),
    createdTaskId: randomUUID(),
    runId: null,
    identity: {
      kind: "action" as const,
      expected: context,
      action: {
        kind: "create" as const,
        taskKind: "research" as const,
        goal: "Injected accepted floor, not approval",
      },
    },
  };
  expect((await f.writer.commit(intent)).status).toBe("committed");
  expect(
    (
      await f.writer.publishTask({
        operationId: intent.operationId,
        cwd: f.root,
      })
    ).status,
  ).toBe("published");
  expect(f.writer.configurationRevisionFloor).toBe(81);
  await f.writer.settled();
  // Historical metadata rows need not have resource policy. Rebind the actual
  // raw first-batch checksum, never alter production history or use it as consent.
  const segment = f.files.segmentPath(1);
  const lines = readFileSync(segment, "utf8").trimEnd().split("\n");
  const row = JSON.parse(lines[0]);
  delete row.value.policy;
  lines[0] = canonicalJson(row, RECORD_BYTES);
  const marker = JSON.parse(lines[1]);
  marker.sha256 = hash(`${lines[0]}\n`);
  lines[1] = canonicalJson(marker, RECORD_BYTES);
  writeFileSync(segment, `${lines.join("\n")}\n`);
  const preserved = readFileSync(segment);
  const recovery = new HistoryRecovery(f.c);
  // Injected absent-PID observation AND informed authority. This exercises the
  // real bridge/floor scanner, not native crash or management takeover.
  const probe = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    expect(pid).toBe(process.pid);
    expect(signal).toBe(0);
    throw Object.assign(new Error("fixture absent"), { code: "ESRCH" });
  });
  try {
    const expected = await inspectRecovery(f.c, recovery);
    await recovery.append({
      expected,
      processes: "externally-resolved",
      credentials: "independently-resolved",
      storage: "independently-resolved",
      acknowledgeEscapedProcesses: true,
      assertLocalAuthority: (choice) => {
        expect(choice).toEqual(expected);
      },
    });
  } finally {
    probe.mockRestore();
  }
  expect(readFileSync(segment)).toEqual(preserved);
  f.lease.release();
  const lease = f.c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint: "http://127.0.0.1:17423",
    policyIdentity: "a".repeat(64),
  });
  expect(lease.registration.epoch).not.toBe(context.epoch);
  const replay = new HistoryWriter(lease);
  expect(replay.configurationRevisionFloor).toBe(81);
  expect(replay.currentContext(null)).toBeNull(); // A floor restores no approval/current model.
  const path = f.files.segmentPath(1),
    original = readFileSync(path);
  writeFileSync(path, Buffer.concat([Buffer.from("!"), original.subarray(1)]));
  const corrupt = readFileSync(path);
  expect(() => new HistoryWriter(lease)).toThrow(ContractError);
  expect(readFileSync(path)).toEqual(corrupt);
});
