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
