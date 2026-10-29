import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it, vi } from "vitest";
import {
  managementExitCode,
  managementMain,
  observedServerResult,
  stopService,
} from "../src/service/cli.ts";
import { ContractError } from "../src/service/contracts/core.ts";
import {
  inspectGatewayRecovery,
  resolveGatewayRecovery,
} from "../src/service/gateway-recovery.ts";
import {
  decodeGatewayInput,
  GatewayStore,
} from "../src/service/gateway-store.ts";
import { encoded, json } from "../src/service/private-files.ts";
import { storedTree } from "./helpers/history-read-fixture.ts";

let child: string;
beforeAll(() => {
  child = join(
    mkdtempSync(join(tmpdir(), "gateway-recovery-build-")),
    "child.mjs",
  );
  const built = spawnSync(
    "bun",
    [
      "build",
      "./test/helpers/gateway-recovery-child.ts",
      "--target=node",
      "--packages=external",
      `--outfile=${child}`,
    ],
    { encoding: "utf8" },
  );
  expect(built.status, built.stderr).toBe(0);
});
function fixture(mode = "quarantined") {
  const dir = mkdtempSync(join(tmpdir(), "gateway-recovery-"));
  const result = spawnSync(process.execPath, [child, dir, mode], {
    encoding: "utf8",
    timeout: 15000,
  });
  expect(result.status, result.stderr).toBe(77);
  const store = new GatewayStore(join(dir, "server.env"), join(dir, "state"));
  return { dir, store };
}
function cli(f: ReturnType<typeof fixture>, args: string[]) {
  return spawnSync(
    process.execPath,
    [
      "src/service-cli.mjs",
      ...args,
      "--server-config",
      f.store.serverConfig,
      "--state-home",
      f.store.stateHome,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
}
it.each(["quarantined", "alive"])(
  "dead %s workbench recovers only its fence, including deleted associated projects, with no replay",
  (mode) => {
    const f = fixture(mode),
      before = storedTree(f.store.files.namespace);
    rmdirSync(join(f.dir, "project"));
    const expected = inspectGatewayRecovery(f.store);
    expect(expected).toMatchObject({
      scope: "workbench",
      owner: "absent",
      projects: 1,
      openings: 1,
      legacyHost: false,
    });
    expect(storedTree(f.store.files.namespace)).toEqual(before);
    expect(resolveGatewayRecovery(f.store, expected, () => {})).toMatchObject({
      status: "resolved",
      scope: "workbench",
    });
    const after = new Map(storedTree(f.store.files.namespace));
    for (const [path, value] of before)
      if (
        ![f.store.path("gateway.lock"), f.store.path("gateway.json")].includes(
          path,
        )
      )
        expect(after.get(path)).toEqual(value);
    expect(f.store.inspect().status).toBe("stopped");
    expect(f.store.projects()).toHaveLength(1);
    expect(f.store.associatedProjects()).toEqual([]);
    expect(existsSync(join(f.dir, "project"))).toBe(false);
    const input = decodeGatewayInput(
      json(f.store.files.read(f.store.path("input.json"))!),
    );
    const next = f.store.acquire(
      "http://127.0.0.1:17423",
      "fake-gateway-".repeat(4),
      input,
    );
    expect(next.registration.epoch).not.toBe(expected.epoch);
    expect(f.store.associatedProjects()).toEqual([]);
    f.store.release();
  },
);
it.each([
  "live",
  "remote",
  "permission",
  "registration",
  "lock",
  "input",
  "commands",
  "linked",
  "reincarnation",
  "authority",
])("workbench recovery refuses %s without releasing resources", (mode) => {
  const f = fixture();
  if (mode === "remote") {
    const path = f.store.path("gateway.json"),
      row = JSON.parse(readFileSync(path, "utf8"));
    row.host = "foreign-fixture-host";
    writeFileSync(path, encoded(row));
  }
  if (mode === "live") vi.spyOn(process, "kill").mockImplementation(() => true);
  if (mode === "permission")
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error(), { code: "EPERM" });
    });
  try {
    const expected = inspectGatewayRecovery(f.store);
    if (mode === "registration")
      appendFileSync(f.store.path("gateway.json"), " ");
    if (mode === "lock") appendFileSync(f.store.path("gateway.lock"), " ");
    if (mode === "input") appendFileSync(f.store.path("input.json"), " ");
    if (mode === "commands")
      f.store.files.create(
        f.store.path("commands/11111111-1111-4111-8111-111111111111.json"),
        encoded({ path: f.dir, epoch: expected.epoch }),
      );
    if (mode === "linked")
      linkSync(
        f.store.path("gateway.lock"),
        join(f.dir, "preserved-lock-link"),
      );
    if (mode === "reincarnation") {
      const path = f.store.path("gateway.lock"),
        bytes = readFileSync(path);
      renameSync(path, join(f.dir, "preserved-lock"));
      writeFileSync(path, bytes, { mode: 0o600 });
    }
    const before = storedTree(f.store.files.namespace);
    expect(() =>
      resolveGatewayRecovery(f.store, expected, () => {
        if (mode === "authority") throw new Error("expired fixture authority");
      }),
    ).toThrow();
    expect(storedTree(f.store.files.namespace)).toEqual(before);
    expect(existsSync(f.store.path("gateway.lock"))).toBe(true);
  } finally {
    vi.restoreAllMocks();
  }
});
it("legacy host identity is not guessed from absent PID; explicit local host attestation is required", () => {
  const f = fixture("legacy"),
    expected = inspectGatewayRecovery(f.store);
  expect(expected).toMatchObject({
    owner: "ambiguous",
    legacyHost: true,
    process: { host: null },
    resolution: "local-host-confirmation-required",
  });
  const before = storedTree(f.store.files.namespace);
  expect(() => resolveGatewayRecovery(f.store, expected, () => {})).toThrow(
    "quarantine",
  );
  expect(storedTree(f.store.files.namespace)).toEqual(before);
  expect(resolveGatewayRecovery(f.store, expected, () => {}, true).status).toBe(
    "resolved",
  );
});
it.each(["interrupt", "partial-release"])(
  "a real resolver crash at %s keeps evidence and supports fresh confirmation without cleanup",
  (mode) => {
    const f = fixture();
    const original = spawnSync(process.execPath, [child, f.dir, mode], {
      encoding: "utf8",
      timeout: 15000,
    });
    expect(original.status, original.stderr).toBe(77);
    expect(existsSync(f.store.path("gateway.lock"))).toBe(true);
    const expected = inspectGatewayRecovery(f.store);
    expect(expected.previousResolver).toBe("absent");
    expect(resolveGatewayRecovery(f.store, expected, () => {}).status).toBe(
      "resolved",
    );
  },
);
it("a successor lock acquired before registration cannot be recovered using the dead predecessor PID", () => {
  const f = fixture();
  resolveGatewayRecovery(f.store, inspectGatewayRecovery(f.store), () => {});
  const input = decodeGatewayInput(
    json(f.store.files.read(f.store.path("input.json"))!),
  );
  const create = f.store.files.create.bind(f.store.files);
  vi.spyOn(f.store.files, "create").mockImplementation((...args) => {
    const result = create(...args);
    if (args[0] === f.store.path("gateway.lock"))
      throw new Error("fixture interruption before successor registration");
    return result;
  });
  try {
    expect(() =>
      f.store.acquire(
        "http://127.0.0.1:17423",
        "fake-gateway-".repeat(4),
        input,
      ),
    ).toThrow("fixture interruption");
  } finally {
    vi.restoreAllMocks();
  }
  const before = storedTree(f.store.files.namespace);
  expect(() => inspectGatewayRecovery(f.store)).toThrow("corrupt-selected");
  expect(storedTree(f.store.files.namespace)).toEqual(before);
  expect(existsSync(f.store.path("gateway.lock"))).toBe(true);
});
it("concurrent real resolvers cannot both release or touch a successor lock", async () => {
  const f = fixture();
  const children = [0, 1].map(() =>
    spawn(process.execPath, [child, f.dir, "resolve"], { stdio: "ignore" }),
  );
  const results = await Promise.all(children.map((c) => once(c, "close")));
  expect(results.filter(([code]) => code === 0)).toHaveLength(1);
  expect(f.store.inspect().status).toBe("stopped");
});
it.each(["receipt", "registration"])(
  "changed resources after durable %s boundary preserve the workbench fence",
  (boundary) => {
    const f = fixture(),
      expected = inspectGatewayRecovery(f.store);
    const create = f.store.files.create.bind(f.store.files),
      replace = f.store.files.replace.bind(f.store.files);
    const interfere = () => appendFileSync(f.store.path("access.json"), " ");
    if (boundary === "receipt")
      vi.spyOn(f.store.files, "create").mockImplementation((...args) => {
        const result = create(...args);
        if (args[0].includes("recovery-v1")) interfere();
        return result;
      });
    else
      vi.spyOn(f.store.files, "replace").mockImplementation((...args) => {
        const result = replace(...args);
        if (args[0] === f.store.path("gateway.json")) interfere();
        return result;
      });
    try {
      expect(() =>
        resolveGatewayRecovery(f.store, expected, () => {}),
      ).toThrow();
    } finally {
      vi.restoreAllMocks();
    }
    expect(existsSync(f.store.path("gateway.lock"))).toBe(true);
  },
);
it("authority expiring after the flushed receipt cannot release the gateway", () => {
  const f = fixture(),
    expected = inspectGatewayRecovery(f.store);
  let fresh = true;
  const create = f.store.files.create.bind(f.store.files);
  vi.spyOn(f.store.files, "create").mockImplementation((...args) => {
    const result = create(...args);
    if (args[0].includes("recovery-v1")) fresh = false;
    return result;
  });
  try {
    expect(() =>
      resolveGatewayRecovery(f.store, expected, () => {
        if (!fresh) throw new Error("expired fixture confirmation");
      }),
    ).toThrow("expired fixture confirmation");
  } finally {
    vi.restoreAllMocks();
  }
  expect(f.store.read()?.phase).toBe("quarantined");
  expect(existsSync(f.store.path("gateway.lock"))).toBe(true);
});
it.each(["bytes", "incarnation"])(
  "a changed pinned recovery receipt (%s) refuses restart without releasing project fences",
  (mode) => {
    const f = fixture();
    resolveGatewayRecovery(f.store, inspectGatewayRecovery(f.store), () => {});
    const pointer = f.store.read()?.recovery;
    if (!pointer) throw new Error("fixture receipt");
    const path = f.store.path(pointer.receipt);
    if (mode === "bytes") appendFileSync(path, " ");
    else {
      const bytes = readFileSync(path);
      renameSync(path, join(f.dir, "preserved-receipt"));
      writeFileSync(path, bytes, { mode: 0o600 });
    }
    const before = storedTree(f.store.files.namespace);
    const input = decodeGatewayInput(
      json(f.store.files.read(f.store.path("input.json"))!),
    );
    expect(() =>
      f.store.acquire(
        "http://127.0.0.1:17423",
        "fake-gateway-".repeat(4),
        input,
      ),
    ).toThrow();
    expect(storedTree(f.store.files.namespace)).toEqual(before);
  },
);

it("generated CLI inspection is readonly, default recovery is workbench not cwd, and pipes cannot resolve", () => {
  const f = fixture(),
    before = storedTree(f.store.files.namespace);
  for (const prefix of [[], ["workbench"]]) {
    const result = cli(f, [...prefix, "recover", "inspect"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(
      f.store.read()?.capability,
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      scope: "workbench",
      owner: "absent",
    });
    expect(cli(f, [...prefix, "recover", "resolve"]).status).toBe(1);
  }
  expect(storedTree(f.store.files.namespace)).toEqual(before);
  const diagnosis = cli(f, ["workbench", "diagnose"]);
  expect(diagnosis.stderr).toContain("workbench recover inspect");
});
it("recovery refusals have fixed diagnostics without echoing unsafe state bytes", () => {
  const f = fixture();
  writeFileSync(f.store.path("input.json"), "PRIVATE_SENTINEL", {
    mode: 0o600,
  });
  const result = cli(f, ["workbench", "recover", "inspect"]);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    scope: "workbench",
    status: "unavailable",
    resolution: "blocked-preserve-state",
  });
  expect(result.stdout + result.stderr).not.toContain("PRIVATE_SENTINEL");
});
it("a generated foreground workbench quarantine refusal exits 78 without changing retained state", async () => {
  const f = fixture(),
    socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("fixture endpoint");
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  writeFileSync(
    f.store.serverConfig,
    `CADENCE_PORT=${port}\nCADENCE_TOKEN=${"fake-gateway-".repeat(4)}\n`,
    { mode: 0o600 },
  );
  const before = storedTree(f.store.files.namespace);
  const result = cli(f, ["workbench", "start", "--foreground"]);
  expect(result.status, result.stderr).toBe(78);
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: "refused",
    error: "quarantine",
    stage: "service",
  });
  expect(storedTree(f.store.files.namespace)).toEqual(before);
  resolveGatewayRecovery(f.store, inspectGatewayRecovery(f.store), () => {});
  rmdirSync(join(f.dir, "project"));
  const start = cli(f, ["workbench", "start"]);
  try {
    expect(start.status, start.stderr).toBe(0);
    expect(JSON.parse(start.stdout)).toMatchObject({ status: "alive" });
    expect(f.store.projects()).toHaveLength(1);
    expect(f.store.associatedProjects()).toEqual([]);
    expect(existsSync(join(f.dir, "project"))).toBe(false);
  } finally {
    const stop = cli(f, ["workbench", "stop"]);
    writeFileSync(
      join(f.dir, "startup-receipt.json"),
      JSON.stringify({
        start: {
          status: start.status,
          stdout: start.stdout,
          stderr: start.stderr,
        },
        stop: { status: stop.status, stdout: stop.stdout, stderr: stop.stderr },
      }),
      { mode: 0o600 },
    );
    if (start.status === 0) {
      expect(stop.status, stop.stderr).toBe(0);
      expect(JSON.parse(stop.stdout)).toMatchObject({ status: "stopped" });
    }
  }
});

it("only explicit project publication re-associates an exact retained reference after recovery", () => {
  const f = fixture(),
    project = f.store.projects()[0];
  resolveGatewayRecovery(f.store, inspectGatewayRecovery(f.store), () => {});
  const input = decodeGatewayInput(
    json(f.store.files.read(f.store.path("input.json"))!),
  );
  f.store.acquire("http://127.0.0.1:17423", "fake-gateway-".repeat(4), input);
  expect(f.store.associatedProjects()).toEqual([]);
  f.store.saveProject(project);
  expect(f.store.associatedProjects()).toEqual([project]);
  f.store.release();
});

it.each(["same", "successor"])(
  "accepted Stop tolerates an inconclusive registration sample without losing the %s epoch fence",
  async (mode) => {
    const epoch = "11111111-1111-4111-8111-111111111111";
    let requests = 0;
    const server = createHttpServer((_req, res) => {
      requests++;
      res.end(
        JSON.stringify({ kind: "ok", value: { status: "accepted", epoch } }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("fixture endpoint");
    let samples = 0;
    try {
      const result = await stopService({
        localAccess: () => ({
          epoch,
          endpoint: `http://127.0.0.1:${address.port}`,
          capability: "fake-fixture-capability",
        }),
        inspect: () => {
          if (++samples === 1) throw new ContractError("conflict");
          return {
            status: "stopped",
            epoch:
              mode === "same" ? epoch : "22222222-2222-4222-8222-222222222222",
          };
        },
      });
      expect(samples).toBe(2);
      expect(requests).toBe(1);
      expect(result).toEqual({
        status: mode === "same" ? "stopped" : "unconfirmed",
        epoch,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
it("manager-started is not service-ready and deterministic foreground refusals use EX_CONFIG", () => {
  expect(
    observedServerResult({ status: "started", workspace: null }, "quarantined"),
  ).toMatchObject({
    status: "quarantined",
    managerStatus: "started",
    service: "quarantined",
  });
  expect(
    observedServerResult({ status: "started" }, "unavailable").status,
  ).toBe("unconfirmed");
  expect(observedServerResult({ status: "started" }, "alive").status).toBe(
    "started",
  );
  expect(
    managementExitCode(
      { status: "refused", error: "quarantine", stage: "service" },
      true,
    ),
  ).toBe(78);
  expect(managementExitCode({ status: "unconfirmed" }, true)).toBe(1);
});
it.each([
  { error: new Error("unexpected fixture failure"), code: 1 },
  { error: new ContractError("quarantine"), code: 78 },
])(
  "foreground startup preserves the exit class $code for $error",
  async ({ error, code }) => {
    const f = fixture(),
      previousExitCode = process.exitCode;
    vi.spyOn(GatewayStore.prototype, "inspect").mockImplementation(() => {
      throw error;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await managementMain(
        [
          "workbench",
          "start",
          "--foreground",
          "--server-config",
          f.store.serverConfig,
          "--state-home",
          f.store.stateHome,
        ],
        new URL("../src/service-host.mjs", import.meta.url),
      );
      expect(process.exitCode).toBe(code);
      expect(stderr.mock.calls.flat().join("")).not.toContain(error.message);
    } finally {
      process.exitCode = previousExitCode;
      vi.restoreAllMocks();
    }
  },
);
it
  .skipIf(process.platform === "win32")
  .each(["resolve", "legacy", "paste", "cancel"])(
  "generated CLI genuine native TTY %s recovery",
  (mode) => {
    const f = fixture(mode === "legacy" ? "legacy" : "quarantined");
    const config = join(f.dir, "pty.json"),
      receipt = join(f.dir, "pty-receipt.json");
    const home = join(f.dir, "home");
    mkdirSync(home, { mode: 0o700 });
    writeFileSync(
      config,
      JSON.stringify({
        mode: mode === "legacy" ? "resolve" : mode,
        legacyHost: mode === "legacy",
        epoch: f.store.read()?.epoch,
        receipt,
        cwd: f.dir,
        env: { ...process.env, HOME: home, USERPROFILE: home },
        argv: [
          process.execPath,
          join(process.cwd(), "src/service-cli.mjs"),
          "workbench",
          "recover",
          "resolve",
          "--server-config",
          f.store.serverConfig,
          "--state-home",
          f.store.stateHome,
        ],
      }),
      { mode: 0o600 },
    );
    const result = spawnSync(
      "python3",
      ["test/helpers/recovery-pty.py", config],
      { encoding: "utf8", timeout: 90000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual({
      waitpidReturned: true,
      exitCode: ["resolve", "legacy"].includes(mode) ? 0 : 1,
      forced: false,
      fault: null,
    });
    expect(existsSync(f.store.path("gateway.lock"))).toBe(
      !["resolve", "legacy"].includes(mode),
    );
  },
  90000,
);
