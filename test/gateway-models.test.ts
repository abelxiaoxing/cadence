import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { readGatewayModels } from "../src/service/gateway-models.ts";
import { readHostConfig } from "../src/service/runtime.ts";

const readModelPreview = vi.fn(async () => ({
  status: "complete" as const,
  entries: [],
  withheld: 0,
  remembered: null,
}));
vi.mock("../src/service/runtime.ts", () => ({
  readHostConfig: vi.fn(() => undefined),
}));
afterEach(() => vi.clearAllMocks());
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "cadence-gateway-models-"));
  const cwd = join(dir, "project"),
    stateHome = join(dir, "state"),
    agentDir = join(dir, "agent");
  for (const path of [cwd, stateHome, agentDir]) mkdirSync(path);
  writeFileSync(join(agentDir, "auth.json"), "{}");
  return {
    dir,
    cwd,
    input: { stateHome, agentDir },
    project: {
      id: "a".repeat(64),
      path: cwd,
      cwd,
      epoch: null,
      status: "not-started" as const,
    },
  };
}
it("the project-less picker reads the workbench account's sources without inventing a workspace", async () => {
  const f = fixture();
  await readGatewayModels(
    undefined,
    f.input,
    ["fixture-access-token"],
    readModelPreview,
  );
  expect(readModelPreview).toHaveBeenCalledWith(
    expect.objectContaining({
      agentDir: f.input.agentDir,
      cwd: homedir(),
      secrets: ["fixture-access-token"],
    }),
  );
  expect(readdirSync(f.input.stateHome)).toEqual([]);
  expect(readHostConfig).not.toHaveBeenCalled();
});
it("the preview's context windows reach the picker as the child projected them", async () => {
  const f = fixture();
  const entry = {
    provider: "fixture",
    model: "fixed",
    api: "openai-completions" as const,
    thinking: [{ level: "off" as const, selectable: true }],
    images: false,
    contextWindow: 200000,
    eligibility: "candidate" as const,
  };
  const read = async () => ({
    status: "complete" as const,
    entries: [entry],
    withheld: 0,
    remembered: null,
  });
  expect(
    (await readGatewayModels(undefined, f.input, [], read)).entries,
  ).toEqual([entry]);
});
it("a never-started selected folder neither creates private state nor installs a preference", async () => {
  const f = fixture();
  await readGatewayModels(f.project, f.input, [], readModelPreview);
  expect(readModelPreview).toHaveBeenCalledWith(
    expect.objectContaining({ agentDir: f.input.agentDir, cwd: f.cwd }),
  );
  expect(readdirSync(f.cwd)).toEqual([]);
  expect(readdirSync(f.input.stateHome)).toEqual([]);
});
it("an existing project uses its own saved agent directory and refuses source changes while awaiting discovery", async () => {
  const f = fixture();
  const config = { agentDir: join(f.dir, "other-agent") } as NonNullable<
    ReturnType<typeof readHostConfig>
  >;
  mkdirSync(config.agentDir);
  writeFileSync(join(config.agentDir, "auth.json"), "{}");
  vi.mocked(readHostConfig)
    .mockReturnValueOnce(config)
    .mockReturnValueOnce(config);
  await readGatewayModels(f.project, f.input, [], readModelPreview);
  expect(readModelPreview).toHaveBeenLastCalledWith(
    expect.objectContaining({ agentDir: config.agentDir }),
  );
  vi.mocked(readHostConfig)
    .mockReturnValueOnce(config)
    .mockReturnValueOnce({ ...config, agentDir: f.input.agentDir });
  await expect(
    readGatewayModels(f.project, f.input, [], readModelPreview),
  ).rejects.toThrow("stale");
});
it("half-written selected configuration is refused in place, never replaced with the gateway's defaults", async () => {
  const f = fixture();
  const c = new ServiceCoordination(f.cwd, f.input.stateHome);
  c.files.create(c.path("host-config.json"), "{broken");
  await expect(
    readGatewayModels(f.project, f.input, [], readModelPreview),
  ).rejects.toThrow("corrupt-selected");
  expect(readModelPreview).not.toHaveBeenCalled();
  expect(c.files.read(c.path("host-config.json"))?.bytes.toString()).toBe(
    "{broken",
  );
});

it("source changes after a child projection but before native close refuse the whole discovery", async () => {
  const f = fixture();
  const read = async () => {
    writeFileSync(
      join(f.input.agentDir, "auth.json"),
      JSON.stringify({
        fixture: { type: "api_key", key: "changed-fixture-secret" },
      }),
    );
    return {
      status: "complete" as const,
      entries: [],
      withheld: 0,
      remembered: null,
    };
  };
  await expect(readGatewayModels(f.project, f.input, [], read)).rejects.toThrow(
    "stale",
  );
  expect(readdirSync(f.input.stateHome)).toEqual([]);
});
