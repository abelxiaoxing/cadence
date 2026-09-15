import { isAbsolute, win32 } from "node:path";

export const VERSION = 1;
export function validateRequest(value, platform = process.platform) {
  const fields = [
    "version",
    "executable",
    "argv",
    "cwd",
    "env",
    "timeoutMs",
    "shutdownMs",
    "outputLimit",
  ];
  const text = (s) =>
    typeof s === "string" &&
    !/[\0\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      s,
    ) &&
    s.length <= 16384;
  const absolute = (s) =>
    text(s) &&
    (platform === "win32"
      ? /^[A-Za-z]:\\/.test(s) && win32.isAbsolute(s)
      : isAbsolute(s));
  if (
    !value ||
    Object.keys(value).length !== fields.length ||
    fields.some((k) => !Object.hasOwn(value, k)) ||
    value.version !== VERSION ||
    !absolute(value.executable) ||
    !absolute(value.cwd) ||
    !Array.isArray(value.argv) ||
    value.argv.length > 128 ||
    !value.argv.every(text)
  )
    throw new Error("invalid request fields/paths/argv");
  if (!value.env || Array.isArray(value.env) || typeof value.env !== "object")
    throw new Error("invalid environment");
  const seen = new Set();
  for (const [key, val] of Object.entries(value.env)) {
    const identity = platform === "win32" ? key.toUpperCase() : key;
    if (
      !key ||
      !text(key) ||
      key.includes("=") ||
      !text(val) ||
      seen.has(identity)
    )
      throw new Error("invalid environment keys/values");
    seen.add(identity);
  }
  for (const [key, max] of [
    ["timeoutMs", 60000],
    ["shutdownMs", 10000],
    ["outputLimit", 1048576],
  ])
    if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > max)
      throw new Error(`invalid ${key}`);
  if (Buffer.byteLength(JSON.stringify(value)) > 60000)
    throw new Error("request too large");
  return value;
}

// MS CRT quoting: quote every argument, double backslashes before quotes/end.
export function quoteWindowsArg(value) {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}
export function encodeWindowsRequest(request) {
  validateRequest(request, "win32");
  const command = [request.executable, ...request.argv]
    .map(quoteWindowsArg)
    .join(" ");
  const environment = `${Object.entries(request.env)
    .sort(([a], [b]) => (a.toUpperCase() < b.toUpperCase() ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\0")}\0\0`;
  const parts = [
    `${request.executable}\0`,
    `${command}\0`,
    `${request.cwd}\0`,
    environment,
  ].map((s) => Buffer.from(s, "utf16le"));
  const header = Buffer.alloc(36);
  [
    VERSION,
    request.timeoutMs,
    request.shutdownMs,
    request.outputLimit,
    ...parts.map((p) => p.length),
    0,
  ].forEach((v, i) => {
    header.writeUInt32LE(v, i * 4);
  });
  const wire = Buffer.concat([header, ...parts]);
  if (wire.length > 65536 || command.length >= 32767)
    throw new Error("wire request too large");
  return wire;
}
export function validateObservation(value) {
  if (
    !value ||
    Object.keys(value).sort().join(",") !==
      "descendantsReaped,managedSettled,outcome,reason,rootExited,version" ||
    value.version !== VERSION ||
    !["complete", "failed", "uncertain"].includes(value.outcome) ||
    ![
      "exit",
      "timeout",
      "cancelled",
      "output-limit",
      "launch-failed",
      "helper-failed",
      "termination-unconfirmed",
    ].includes(value.reason) ||
    ["rootExited", "managedSettled", "descendantsReaped"].some(
      (k) => typeof value[k] !== "boolean",
    )
  )
    throw new Error("invalid observation");
  if (
    value.outcome === "complete" &&
    (!value.rootExited ||
      !value.managedSettled ||
      !value.descendantsReaped ||
      value.reason !== "exit")
  )
    throw new Error("incomplete settlement");
  if (value.outcome === "uncertain" && value.managedSettled)
    throw new Error("contradictory settlement");
  return value;
}
