import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { ServiceClient, type ServiceTransport } from "../src/service-client.ts";
import {
  decodeChooseModelRequest,
  decodeModelCandidate,
  decodeModelCatalog,
  decodeModelSelection,
  decodeModelSelector,
  LIMITS,
} from "../src/service-contract.ts";
import {
  httpOutputLimit,
  readRoute,
  wireRequest,
} from "../src/service-wire.ts";

import { sourceBuild } from "./helpers/source-build.ts";
import { windowsSystemEnvironment } from "./helpers/windows-environment.ts";

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
const candidate = {
  provider: "fixture",
  model: "fixed",
  api: "openai-completions",
  thinking: [
    { level: "off", selectable: true },
    { level: "max", selectable: false },
  ],
  eligibility: "candidate",
};
it("uses the same selector codec without allocating or accepting a source selection ID", () => {
  expect(decodeModelSelector(selector)).toEqual(selector);
  expect(
    decodeModelSelection({ sourceSelectionId: version.epoch, ...selector }),
  ).toEqual({ sourceSelectionId: version.epoch, ...selector });
  expect(() =>
    decodeModelSelector({ ...selector, sourceSelectionId: version.epoch }),
  ).toThrow();
  expect(decodeModelSelector({ ...selector, thinking: "max" })).toEqual({
    ...selector,
    thinking: "max",
  });
  expect(() =>
    decodeModelSelector({ ...selector, thinking: "ultra" }),
  ).toThrow();
  expect(() =>
    decodeChooseModelRequest({
      expected: version,
      choice: selector,
      authority: "local",
    }),
  ).toThrow();
});
it.each([
  { ...candidate, baseUrl: "http://private" },
  { ...candidate, thinking: [{ level: "ultra", selectable: true }] },
  {
    ...candidate,
    thinking: [
      { level: "off", selectable: true },
      { level: "off", selectable: false },
    ],
  },
  { ...candidate, eligibility: "unsupported" },
  { ...candidate, api: null },
  { ...candidate, thinking: [] },
])("rejects contradictory/private candidate data %#", (value) => {
  expect(() => decodeModelCandidate(value)).toThrow();
});
it("catalog capacity is explicit, bounded, and never a clipped complete roster", () => {
  const catalog = { version, selected: null, withheld: 0 };
  expect(
    decodeModelCatalog({ ...catalog, status: "capacity", entries: [] }).status,
  ).toBe("capacity");
  expect(() =>
    decodeModelCatalog({
      ...catalog,
      status: "capacity",
      entries: [candidate],
    }),
  ).toThrow();
  expect(() =>
    decodeModelCatalog({
      ...catalog,
      status: "complete",
      entries: [candidate, candidate],
    }),
  ).toThrow();
  expect(() =>
    decodeModelCatalog({
      ...catalog,
      status: "complete",
      entries: Array(201).fill(candidate),
    }),
  ).toThrow();
  expect(httpOutputLimit("models")).toBe(LIMITS.pageBytes);
});
it("counts withheld entries without their identifiers, within the same bound", () => {
  const catalog = { version, selected: null, status: "complete" };
  expect(
    decodeModelCatalog({ ...catalog, entries: [candidate], withheld: 199 })
      .withheld,
  ).toBe(199);
  for (const withheld of [200, -1, 0.5, "1", undefined])
    expect(() =>
      decodeModelCatalog({ ...catalog, entries: [candidate], withheld }),
    ).toThrow();
  expect(() =>
    decodeModelCatalog({
      ...catalog,
      status: "capacity",
      entries: [],
      withheld: 1,
    }),
  ).toThrow();
});
it("uses bodyless authenticated catalog and explicit choice POST, never readonly POST or query authority", () => {
  expect(wireRequest("models", null)).toEqual({
    path: "/api/v1/models",
    method: "GET",
  });
  expect(
    wireRequest("chooseModel", { expected: version, choice: selector }).method,
  ).toBe("POST");
  expect(() => readRoute("/api/v1/model-choice?request=x", "POST")).toThrow();
  expect(() => readRoute("/api/v1/models", "POST")).toThrow();
  expect(() => readRoute("/api/v1/model-choice", "GET")).toThrow();
});
it("client forwards readonly abort and treats a substituted/lost choice as uncertain without replay", async () => {
  let calls = 0;
  const signal = new AbortController().signal;
  const transport = {
    models: async (seen: AbortSignal) => {
      expect(seen).toBe(signal);
      return {
        kind: "ok",
        value: {
          version,
          selected: null,
          status: "complete",
          entries: [candidate],
          withheld: 0,
        },
      };
    },
    chooseModel: async () => {
      calls++;
      return {
        kind: "ok",
        value: {
          version: { ...version, configRev: 2, catalogId: randomUUID() },
          selected: {
            sourceSelectionId: randomUUID(),
            ...selector,
            model: "different",
          },
        },
      };
    },
  } as unknown as ServiceTransport; // Explicit transport fault injection, not an owner.
  const client = new ServiceClient(transport);
  expect((await client.models(signal)).kind).toBe("ok");
  expect(
    await client.chooseModel({ expected: version, choice: selector }),
  ).toMatchObject({ kind: "error", error: { effect: "uncertain" } });
  expect(calls).toBe(1);
});

let bundle: string;
const guard = new URL(
  "./helpers/service-model-context-guard.mjs",
  import.meta.url,
);
beforeAll(() => {
  bundle = mkdtempSync(join(tmpdir(), "cadence-model-choice-bundle-"));
  symlinkSync(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(bundle, "node_modules"),
    "junction",
  );
  cpSync(
    fileURLToPath(new URL("../web/dist", import.meta.url)),
    join(bundle, "web/dist"),
    { recursive: true },
  );
  const build = spawnSync(
    "bun",
    [
      "build",
      fileURLToPath(
        new URL("./helpers/service-model-choice-child.ts", import.meta.url),
      ),
      "--target=node",
      "--packages=external",
      `--define=__CADENCE_TEST_ROOT__=${JSON.stringify(bundle)}`,
      `--define=__CADENCE_TEST_IDENTITIES__=${JSON.stringify(sourceBuild)}`,
      `--outfile=${join(bundle, "choice.mjs")}`,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(build.status, build.stderr).toBe(0);
});
for (const scenario of [
  "catalog",
  "choice",
  "busy",
  "capacity",
  "secret-id",
  "unsafe-id",
  "template-secret-id",
  "scoped-secret-id",
  "template-header-secret-id",
  "literal-capacity",
  "literal-duplicates",
  "no-source",
  "source-change",
  "selected-source-change",
  "final-guards",
  "function-guard",
  "revision-ceiling",
  "rotation",
  "restart-floor",
  "closed-action-owner",
  "stop",
] as const) {
  // Each scenario owns its root and native child, so they run concurrently.
  it.concurrent(`actual isolated SDK/host/HTTP model choice: ${scenario}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "cadence-model-choice-native-"));
    const home = join(root, "home");
    mkdirSync(home, { mode: 0o700 });
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: home,
      APPDATA: home,
      TMPDIR: root,
      TEMP: root,
      TMP: root,
      PI_OFFLINE: "1",
      NO_COLOR: "1",
    };
    Object.assign(env, windowsSystemEnvironment());
    const child = spawn(
      process.execPath,
      ["--import", guard.href, join(bundle, "choice.mjs"), scenario, root],
      { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "",
      forced = false;
    const stop = () => {
      forced = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(stop, 15000);
    child.stdout.on("data", (b) => {
      stdout += b;
      if (stdout.length > 65536) stop();
    });
    child.stderr.on("data", (b) => {
      stderr += b;
      if (stderr.length > 65536) stop();
    });
    const native = await new Promise<{
      code: number | null;
      signal: string | null;
    }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    }).finally(() => clearTimeout(timer));
    writeFileSync(
      join(root, "original-close.json"),
      JSON.stringify({ scenario, native, forced, stdout, stderr }),
    );
    expect(forced, stderr).toBe(false);
    expect(native, stderr).toEqual({ code: 0, signal: null });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      scenario,
      passed: true,
      authCalls: 0,
      availabilityCalls: 0,
    });
    expect(stdout).not.toContain("FAKE_CHOICE_KEY_872146");
    expect(readFileSync(join(root, "receipt.json"), "utf8")).toBe(stdout);
  }, 20000);
}
