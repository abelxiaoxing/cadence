import { abortScope } from "../../../src/abort-scope.ts";
import { decodeReply } from "../../../src/service-contract.ts";
import { readJson } from "./service";

const deadlineMs = 10000;
export const observationRetryMs = 5000;
export function refusedAccess(code?: string) {
  return code === "unauthenticated" || code === "forbidden";
}
export class ObservationRefusal extends Error {
  constructor(
    readonly status: number,
    code: string,
  ) {
    super(code);
  }
}

/** One readonly attempt, including bounded body consumption and wire decoding.
 * Abort fetch AND end the caller's wait: a late response cannot extend the
 * deadline, run the decoder or schedule anything in its former lifetime. */
export async function observationRead<T>(
  path: string,
  signal: AbortSignal,
  decode: (value: unknown, response: Response) => T,
): Promise<T> {
  if (signal.aborted) throw signal.reason;
  const end = performance.now() + deadlineMs;
  const attempt = abortScope([signal], deadlineMs);
  const retired = () => (signal.aborted ? signal.reason : new Error("timeout"));
  let stop!: () => void;
  const retirement = new Promise<never>((_, reject) => {
    stop = () => reject(retired());
    attempt.signal.addEventListener("abort", stop, { once: true });
  });
  const check = () => {
    if (attempt.signal.aborted || performance.now() >= end) throw retired();
  };
  const read = async () => {
    const response = await fetch(path, {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal: attempt.signal,
    });
    check();
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => {});
      throw new ObservationRefusal(
        response.status,
        response.status === 401 ? "unauthenticated" : "forbidden",
      );
    }
    const value = await readJson(response);
    check();
    if (!response.ok) {
      // Only a recognized wire refusal may identify a direct legacy owner.
      const reply = decodeReply(value, () => undefined);
      throw new ObservationRefusal(
        response.status,
        reply.kind === "error" ? reply.error.code : "unavailable",
      );
    }
    const result = decode(value, response);
    check();
    return result;
  };
  try {
    return await Promise.race([retirement, read()]);
  } finally {
    attempt.signal.removeEventListener("abort", stop);
    attempt.dispose();
  }
}
