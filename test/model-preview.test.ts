// Controlled registry, real isolated source files. No owner, provider or SDK worker.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import { beforeEach, expect, it, vi } from "vitest";
import { CadencePreferences } from "../src/cadence-preferences.ts";
import {
  decodeModelCatalog,
  decodeModelPreview,
} from "../src/service/contracts/models.ts";
import { readModelPreview } from "../src/service/model-preview.ts";

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  model: {
    provider: "fixture",
    id: "m",
    api: "openai-completions",
    input: ["text", "image"],
  },
  error: undefined as string | undefined,
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: sdk.create },
}));
vi.mock("@earendil-works/pi-ai", () => ({
  InMemoryModelsStore: class {},
  getSupportedThinkingLevels: () => ["off", "high"],
}));
const choice = {
  provider: "fixture",
  model: "m",
  api: "openai-completions",
  thinking: "high",
} as const;
const secret = "fabricated-preview-key-29181";
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "cadence-model-preview-test-"));
  const agentDir = join(home, "agent"),
    cwd = join(home, "project");
  mkdirSync(agentDir);
  mkdirSync(cwd);
  const auth = join(agentDir, "auth.json"),
    models = join(agentDir, "models.json");
  writeFileSync(
    auth,
    JSON.stringify({ fixture: { type: "api_key", key: secret } }),
  );
  writeFileSync(
    models,
    JSON.stringify({
      providers: {
        fixture: {
          api: "openai-completions",
          baseUrl: "http://127.0.0.1:9",
          models: [{ id: "m" }],
        },
      },
    }),
  );
  return { input: { home, cwd, agentDir, environment: {} }, auth, models };
}
function bytes(dir: string): unknown {
  return readdirSync(dir, { withFileTypes: true }).map((entry) => [
    entry.name,
    entry.isDirectory()
      ? bytes(join(dir, entry.name))
      : readFileSync(join(dir, entry.name), "utf8"),
  ]);
}
beforeEach(() => {
  sdk.error = undefined;
  sdk.model.id = "m";
  sdk.create.mockReset().mockImplementation(async () => ({
    getError: () => sdk.error,
    getRegisteredNativeProvider: () => undefined,
    getRegisteredProviderConfig: () => undefined,
    getModels: () => [sdk.model],
    getModel: () => sdk.model,
    getProvider: () => ({ auth: { apiKey: {} } }),
  }));
});
it("reads selectable models and a default before first startup without touching any files or returning owner authority", async () => {
  const f = fixture();
  new CadencePreferences(f.input.agentDir).save(choice);
  const before = bytes(f.input.home);
  const catalog = await readModelPreview(f.input);
  expect(catalog).toMatchObject({
    status: "complete",
    remembered: choice,
    withheld: 0,
    entries: [{ model: "m", images: true, eligibility: "candidate" }],
  });
  expect(catalog.entries[0].thinking).toEqual([
    { level: "off", selectable: true },
    { level: "high", selectable: true },
  ]);
  expect(bytes(f.input.home)).toEqual(before);
  expect(JSON.stringify(catalog)).not.toContain(secret);
  expect(() => decodeModelCatalog(catalog)).toThrow();
  for (const key of ["version", "selected", "sourceSelectionId", "apiKey"])
    expect(() =>
      decodeModelPreview({ ...catalog, [key]: "not-authority" }),
    ).toThrow();
});
it("constructs only an offline model registry with a readonly snapshot store", async () => {
  const f = fixture();
  await readModelPreview(f.input);
  const options = sdk.create.mock.calls[0][0] as CreateModelRuntimeOptions;
  expect(options).toMatchObject({
    modelsPath: f.models,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  expect(options.authPath).toBeUndefined();
  const credentials = options.credentials!;
  expect(await credentials.list()).toEqual([
    { providerId: "fixture", type: "api_key" },
  ]);
  const value = await credentials.read("fixture");
  expect(value).toEqual({ type: "api_key", key: secret });
  if (value?.type === "api_key") value.key = "mutated";
  expect(await credentials.read("fixture")).toEqual({
    type: "api_key",
    key: secret,
  });
  expect(await credentials.read("unknown")).toBeUndefined();
  const mutate = vi.fn();
  await expect(credentials.modify("fixture", mutate)).rejects.toThrow(
    "forbidden",
  );
  await expect(credentials.delete("fixture")).rejects.toThrow("forbidden");
  expect(mutate).not.toHaveBeenCalled();
});
it.each(["auth", "models"] as const)(
  "refuses %s changed during registry construction without an old or substituted list",
  async (file) => {
    const f = fixture();
    const original = sdk.create.getMockImplementation()!;
    sdk.create.mockImplementation(async () => {
      const runtime = await original();
      writeFileSync(
        f[file],
        file === "auth"
          ? JSON.stringify({
              fixture: { type: "api_key", key: "changed-key-long" },
            })
          : JSON.stringify({ providers: {} }),
      );
      return runtime;
    });
    await expect(readModelPreview(f.input)).rejects.toThrow("stale");
  },
);
it("refuses commands/corrupt sources before loading Pi and never repairs them", async () => {
  const f = fixture();
  writeFileSync(
    f.models,
    JSON.stringify({ providers: { fixture: { apiKey: "!do-not-run" } } }),
  );
  const before = bytes(f.input.home);
  await expect(readModelPreview(f.input)).rejects.toThrow();
  expect(sdk.create).not.toHaveBeenCalled();
  expect(bytes(f.input.home)).toEqual(before);
});
it("withholds credential-bearing identifiers using the same projection as execution", async () => {
  const f = fixture();
  sdk.model.id = secret;
  const catalog = await readModelPreview(f.input);
  expect(catalog).toEqual({
    status: "complete",
    entries: [],
    withheld: 1,
    remembered: null,
  });
  expect(JSON.stringify(catalog)).not.toContain(secret);
});
it("reports missing credentials honestly without making a provider request", async () => {
  const f = fixture();
  writeFileSync(f.auth, "{}");
  const catalog = await readModelPreview(f.input);
  expect(catalog.entries[0].eligibility).toBe("auth-unavailable");
  expect(catalog.entries[0].thinking.every((level) => !level.selectable)).toBe(
    true,
  );
});
