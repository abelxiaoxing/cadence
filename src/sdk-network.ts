/** Shared SDK startup route policy. Selection does not install a dispatcher. */
import { object } from "./data-shapes.ts";

export function safeChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // No ambient provider credentials, NODE_OPTIONS, session/control IDs or SDK discovery configuration.
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "TMP",
    "TEMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "PATHEXT",
    // The SDK's Windows bash tool finds Git Bash under these system paths.
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
  ])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  return {
    ...env,
    CADENCE_SUBAGENT_CHILD: "1",
    PI_OFFLINE: "1",
    NO_COLOR: "1",
  };
}
// SDK-only route facts. Never clone the ambient environment or invoke route getters.
export const networkKeys = [
  "http_proxy",
  "https_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "NODE_USE_ENV_PROXY",
  "NODE_OPTIONS",
] as const;
type NetworkKey = (typeof networkKeys)[number];
type NetworkFact = Readonly<{
  present: boolean;
  value?: string;
  writable?: boolean;
  enumerable?: boolean;
  configurable?: boolean;
}>;
export type NetworkSnapshot = Readonly<Record<NetworkKey, NetworkFact>>;
export function networkSnapshot(source: unknown): NetworkSnapshot {
  if (source !== undefined && !object(source))
    throw new Error("Unsupported network");
  const facts = {} as Record<NetworkKey, NetworkFact>;
  for (const key of networkKeys) {
    const descriptor =
      source === undefined
        ? undefined
        : Object.getOwnPropertyDescriptor(source, key);
    facts[key] =
      descriptor === undefined
        ? { present: false }
        : {
            present: true,
            value:
              "value" in descriptor && typeof descriptor.value === "string"
                ? descriptor.value
                : undefined,
            writable: descriptor.writable,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable,
          };
  }
  return facts;
}
export function scopedNetwork(request: object): NetworkSnapshot {
  const auth = Object.getOwnPropertyDescriptor(request, "auth");
  if (!auth || !("value" in auth) || !object(auth.value))
    throw new Error("Unsupported network");
  const env = Object.getOwnPropertyDescriptor(auth.value, "env");
  if (env && !("value" in env)) throw new Error("Unsupported network");
  return networkSnapshot(env?.value);
}
export function sameNetwork(
  a: NetworkSnapshot,
  b: NetworkSnapshot,
  descriptors = true,
): boolean {
  return networkKeys.every(
    (key) =>
      a[key].present === b[key].present &&
      a[key].value === b[key].value &&
      (!descriptors ||
        (a[key].writable === b[key].writable &&
          a[key].enumerable === b[key].enumerable &&
          a[key].configurable === b[key].configurable)),
  );
}
function safeProxyURL(value: string): boolean {
  if (
    Buffer.byteLength(value) > 4096 ||
    /[\s\p{Cc}\p{Cf}\p{Cs}\\@?#]/u.test(value)
  )
    return false;
  // Percent-bearing authorities are unsupported: never decode into normalized validity.
  // Check raw authority/path too: URL normalization must not hide a path or empty port.
  const raw =
    /^(https?):\/\/(\[[0-9a-fA-F:.]+\]|[^/:%]+)(?::([0-9]+))?(\/?)$/i.exec(
      value,
    );
  if (
    !raw ||
    (raw[3] !== undefined && (Number(raw[3]) < 1 || Number(raw[3]) > 65535))
  )
    return false;
  try {
    const url = new URL(value);
    return (
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === "" || url.pathname === "/")
    );
  } catch {
    return false; // Never project parser exceptions or the deployment-sensitive route.
  }
}
export function sdkNetworkEnvironment(
  ambient: NetworkSnapshot,
  scoped: NetworkSnapshot,
): {
  env: NodeJS.ProcessEnv;
  redactionLiterals: string[];
} {
  const unsupported = (): never => {
    throw new Error("Unsupported network");
  };
  const configured = networkKeys.some(
    (key) => key !== "NODE_OPTIONS" && ambient[key].present,
  );
  let route: string | undefined;
  if (configured) {
    for (const key of [
      "ALL_PROXY",
      "all_proxy",
      "NO_PROXY",
      "no_proxy",
      "NODE_OPTIONS",
    ] as const)
      if (ambient[key].present) unsupported();
    const scheme = (lower: NetworkKey, upper: NetworkKey): string => {
      const a = ambient[lower];
      const b = ambient[upper];
      if (
        (!a.present && !b.present) ||
        (a.present && !a.value) ||
        (b.present && !b.value) ||
        (a.present && b.present && a.value !== b.value)
      )
        return unsupported();
      return (a.present ? a.value : b.value) ?? unsupported();
    };
    route = scheme("http_proxy", "HTTP_PROXY");
    if (
      route !== scheme("https_proxy", "HTTPS_PROXY") ||
      !safeProxyURL(route) ||
      (ambient.NODE_USE_ENV_PROXY.present &&
        ambient.NODE_USE_ENV_PROXY.value !== "1")
    )
      unsupported();
    // Public native capability, not a numeric version/model/endpoint predicate.
    const node = Object.getOwnPropertyDescriptor(process.versions, "node");
    if (
      !node ||
      !("value" in node) ||
      typeof node.value !== "string" ||
      !node.value ||
      Object.hasOwn(process.versions, "bun") ||
      process.allowedNodeEnvironmentFlags.has("--use-env-proxy") !== true
    )
      unsupported();
  }
  for (const key of networkKeys) {
    const fact = scoped[key];
    if (!fact.present) continue;
    if (
      !route ||
      (
        [
          "ALL_PROXY",
          "all_proxy",
          "NO_PROXY",
          "no_proxy",
          "NODE_OPTIONS",
        ] as readonly string[]
      ).includes(key) ||
      fact.value !== (key === "NODE_USE_ENV_PROXY" ? "1" : route)
    )
      unsupported();
  }
  const env = safeChildEnv();
  if (route)
    Object.assign(env, {
      HTTP_PROXY: route,
      HTTPS_PROXY: route,
      NODE_USE_ENV_PROXY: "1",
    });
  return { env, redactionLiterals: route ? [route] : [] };
}
