/** Only callers admitted before I/O begins share a scan. A later currentness check
 * must observe bytes after its own admission, not join an older in-flight scan.
 * Last cancellation drains
 * the worker before returning; a cancelled scan never admits a new subscriber. */
export function coalesceVerificationScans<P>(
  scan: (plan: P, signal: AbortSignal) => Promise<string>,
) {
  type Pending = {
    controller: AbortController;
    promise: Promise<string>;
    subscribers: number;
    started: boolean;
  };
  const pending = new Map<string, Pending>();
  return (plan: P, signal?: AbortSignal): Promise<string> => {
    signal?.throwIfAborted();
    const key = JSON.stringify(plan);
    let entry = pending.get(key);
    if (!entry || entry.started || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const created: Pending = {
        controller,
        subscribers: 0,
        started: false,
        promise: Promise.resolve(""),
      };
      created.promise = Promise.resolve()
        .then(() => {
          created.started = true;
          return scan(plan, controller.signal);
        })
        .finally(() => {
          if (pending.get(key) === created) pending.delete(key);
        });
      entry = created;
      pending.set(key, entry);
    }
    const shared = entry;
    shared.subscribers++;
    return new Promise((resolve, reject) => {
      let cancelled = false;
      const abort = () => {
        if (cancelled) return;
        cancelled = true;
        if (--shared.subscribers === 0) shared.controller.abort(signal?.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const settle = (value?: string, error?: unknown) => {
        signal?.removeEventListener("abort", abort);
        if (!cancelled) shared.subscribers--;
        if (cancelled)
          reject(signal?.reason ?? new DOMException("cancelled", "AbortError"));
        else if (error !== undefined) reject(error);
        else if (value !== undefined) resolve(value);
        else reject(new Error("verification-scan-result-unavailable"));
      };
      shared.promise.then(
        (value) => settle(value),
        (error) => settle(undefined, error),
      );
    });
  };
}
