import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { networkKeys } from "../src/sdk-network.ts";
import { AuthNetwork } from "../src/service/auth-network.ts";
import { hostEnvironment } from "../src/service/runtime.ts";

const api = vi.hoisted(() => ({
  made: 0,
  sets: 0,
  closes: 0,
  current: null as unknown,
  fail: "",
  options: null as unknown,
}));
vi.mock("undici", () => ({
  EnvHttpProxyAgent: class {
    constructor(options: unknown) {
      api.made++;
      api.options = options;
    }
    close() {
      api.closes++;
      return api.fail === "close"
        ? Promise.reject(Object.create(null))
        : Promise.resolve();
    }
  },
  setGlobalDispatcher: (value: unknown) => {
    api.sets++;
    if (api.fail === "set") throw Object.create(null);
    api.current = value;
  },
  getGlobalDispatcher: () => (api.fail === "identity" ? null : api.current),
}));
const route = "http://127.0.0.1:12345";
let flags: string[];
beforeEach(() => {
  for (const key of networkKeys) vi.stubEnv(key, undefined);
  flags = [...process.execArgv];
  Object.assign(api, {
    made: 0,
    sets: 0,
    closes: 0,
    current: null,
    fail: "",
    options: null,
  });
});
afterEach(() => {
  process.execArgv.splice(0, process.execArgv.length, ...flags);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function configured() {
  vi.stubEnv("HTTP_PROXY", route);
  vi.stubEnv("HTTPS_PROXY", route);
  vi.stubEnv("NODE_USE_ENV_PROXY", "1");
  process.execArgv.push("--use-env-proxy");
}
it("DIRECT unchanged: no public dispatcher allocation/set/close; access/control removed, ordinary environment retained", async () => {
  const env = hostEnvironment({
    PATH: "ordinary",
    ORDINARY_CREDENTIAL: "launch-key",
    CADENCE_WEB_TOKEN: "private",
    PI_SESSION_ID: "private",
  });
  expect(env).toEqual({
    PATH: "ordinary",
    ORDINARY_CREDENTIAL: "launch-key",
    PI_OFFLINE: "1",
    NO_COLOR: "1",
  });
  const network = new AuthNetwork();
  await network.initialize();
  network.assert({});
  await network.close();
  expect([api.made, api.sets, api.closes]).toEqual([0, 0, 0]);
});
it("same parser canonicalizes matching mixed-case routing before process startup, without promoting scoped or access material", () => {
  const env = hostEnvironment({
    http_proxy: route,
    HTTPS_PROXY: route,
    HOME: "fabricated-home",
    CADENCE_WEB_TOKEN: "private",
  });
  expect(env).toEqual({
    HTTP_PROXY: route,
    HTTPS_PROXY: route,
    NODE_USE_ENV_PROXY: "1",
    HOME: "fabricated-home",
    PI_OFFLINE: "1",
    NO_COLOR: "1",
  });
});
it.each([
  { HTTP_PROXY: route },
  { HTTP_PROXY: route, HTTPS_PROXY: `${route}/different` },
  { HTTP_PROXY: route, HTTPS_PROXY: route, http_proxy: "" },
  { HTTP_PROXY: route, HTTPS_PROXY: route, NO_PROXY: "" },
  { HTTP_PROXY: route, HTTPS_PROXY: route, ALL_PROXY: "" },
  { HTTP_PROXY: route, HTTPS_PROXY: route, NODE_OPTIONS: "" },
  {
    HTTP_PROXY: "http://user:password@127.0.0.1",
    HTTPS_PROXY: "http://user:password@127.0.0.1",
  },
  {
    HTTP_PROXY: "http://%31%32%37.0.0.1",
    HTTPS_PROXY: "http://%31%32%37.0.0.1",
  },
  { NODE_USE_ENV_PROXY: "1" },
  { NODE_OPTIONS: "" },
])("host rejects unsupported selected facts %# without fallback", (env) => {
  expect(() => hostEnvironment(env)).toThrow("unsupported-context");
  expect(api.made).toBe(0);
});
it("own-data only; absent differs from undefined/accessor and no getter is invoked", () => {
  let reads = 0;
  const env = Object.defineProperty({}, "HTTP_PROXY", {
    get: () => {
      reads++;
      return route;
    },
    enumerable: true,
  });
  expect(() => hostEnvironment(env)).toThrow();
  expect(() => hostEnvironment({ HTTP_PROXY: undefined })).toThrow();
  expect(reads).toBe(0);
});
it("missing actual native capability refuses instead of version guessing or installing", () => {
  // Node's public Set is frozen. Inject the capability property, not its body.
  const descriptor = Object.getOwnPropertyDescriptor(
    process,
    "allowedNodeEnvironmentFlags",
  );
  if (!descriptor) throw Error("fixture capability descriptor");
  Object.defineProperty(process, "allowedNodeEnvironmentFlags", {
    configurable: true,
    value: { has: () => false },
  });
  try {
    expect(() =>
      hostEnvironment({ HTTP_PROXY: route, HTTPS_PROXY: route }),
    ).toThrow("unsupported-context");
    expect(hostEnvironment({ HOME: "ordinary" }).HOME).toBe("ordinary");
  } finally {
    Object.defineProperty(process, "allowedNodeEnvironmentFlags", descriptor);
  }
});
it("process startup attestation required; mutable environment cannot enable late proxy setup", () => {
  vi.stubEnv("HTTP_PROXY", route);
  vi.stubEnv("HTTPS_PROXY", route);
  expect(() => new AuthNetwork()).toThrow("unsupported-context");
  vi.stubEnv("NODE_USE_ENV_PROXY", "1");
  expect(() => new AuthNetwork()).toThrow("unsupported-context");
});
it("public resource mocks: exact projection, one owned dispatcher, scoped equality and freshness", async () => {
  configured();
  const network = new AuthNetwork();
  await network.initialize();
  network.assert({ http_proxy: route, NODE_USE_ENV_PROXY: "1" });
  expect(api.options).toEqual({
    httpProxy: route,
    httpsProxy: route,
    noProxy: "",
  });
  expect(() => network.assert({ NO_PROXY: "" })).toThrow();
  expect(() => network.assert({ HTTPS_PROXY: "http://127.0.0.1:2" })).toThrow();
  vi.stubEnv("HTTP_PROXY", "http://127.0.0.1:2");
  expect(() => network.assert({})).toThrow("stale");
  expect(network.literals).toEqual([route]);
  const original = network.close();
  expect(network.close()).toBe(original);
  await original;
  expect([api.made, api.sets, api.closes]).toEqual([1, 1, 1]);
});
it.each(["set", "identity"])(
  "public resource mock %s failure retains allocation for original cleanup; no direct fallback",
  async (failure) => {
    configured();
    api.fail = failure;
    const network = new AuthNetwork();
    await expect(network.initialize()).rejects.toThrow("unsupported-context");
    expect(() => network.assert({})).toThrow();
    await network.close();
    expect([api.made, api.sets, api.closes]).toEqual([1, 1, 1]);
  },
);
it("owned dispatcher close rejection stays rejection, not clean Stop", async () => {
  configured();
  const network = new AuthNetwork();
  await network.initialize();
  api.fail = "close";
  await expect(network.close()).rejects.toBeDefined();
  expect(api.closes).toBe(1);
});
