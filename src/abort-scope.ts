/** A local wait's cancellation lifetime, not ownership of the operation it
 * observes. No static AbortSignal APIs or global polyfill are required. */
export function abortScope(
  sources: readonly (AbortSignal | undefined)[] = [],
  timeoutMs?: number,
): { signal: AbortSignal; dispose(): void } {
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647)
  )
    throw new RangeError("invalid abort timeout");
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    for (const [source, listener] of listeners)
      source.removeEventListener("abort", listener);
    listeners.clear();
  };
  const abort = (reason: unknown) => {
    if (disposed) return;
    dispose();
    controller.abort(reason);
  };
  for (const source of sources) {
    if (!source || listeners.has(source)) continue;
    if (source.aborted) {
      abort(source.reason);
      break;
    }
    const listener = () => abort(source.reason);
    listeners.set(source, listener);
    source.addEventListener("abort", listener, { once: true });
  }
  if (!disposed && timeoutMs !== undefined)
    timer = setTimeout(
      () => abort(new DOMException("The wait timed out", "TimeoutError")),
      timeoutMs,
    );
  // Disposal only releases listeners/timers. It never aborts a source, sends
  // Cancel, or changes the admitted work's lifetime.
  return { signal: controller.signal, dispose };
}
