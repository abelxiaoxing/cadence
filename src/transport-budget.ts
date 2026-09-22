/** Request budgets describe observable model progress, never TCP/TLS events. */
export const REQUEST_BOUNDS = Object.freeze({
  firstProgressMs: 90_000,
  streamIdleMs: 180_000,
  cancellationDrainMs: 250,
});
export type TransportTimeoutCode =
  | "first-progress-timeout"
  | "stream-idle-timeout"
  | "attempt-timeout";
export class TransportTimeout extends Error {
  readonly scope: "request" | "attempt";
  constructor(readonly code: TransportTimeoutCode) {
    super(code);
    this.name = "TransportTimeout";
    this.scope = code === "attempt-timeout" ? "attempt" : "request";
  }
}
export function isTransportTimeoutCode(
  code: string,
): code is TransportTimeoutCode {
  return [
    "first-progress-timeout",
    "stream-idle-timeout",
    "attempt-timeout",
  ].includes(code);
}
export function transportFailureError(code: string): Error {
  return isTransportTimeoutCode(code)
    ? new TransportTimeout(code)
    : new Error("transport-failure");
}

/** Snapshot at the start of each request; Workers cannot override these values. */
export function requestBounds(env: NodeJS.ProcessEnv = process.env) {
  const read = (name: string, fallback: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_200_000)
      throw new Error("request-budget-invalid");
    return value;
  };
  return {
    ...REQUEST_BOUNDS,
    firstProgressMs: read(
      "ABEL_FIRST_PROGRESS_MS",
      REQUEST_BOUNDS.firstProgressMs,
    ),
    streamIdleMs: read("ABEL_STREAM_IDLE_MS", REQUEST_BOUNDS.streamIdleMs),
  };
}
