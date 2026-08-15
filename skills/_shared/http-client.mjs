const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000];
const MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return Math.min(Math.max(Number(value) * 1000, 0), MAX_RETRY_DELAY_MS);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - now, 0), MAX_RETRY_DELAY_MS);
}

function sanitizedError({ operation, url, status, cause }) {
  const endpoint = (() => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return "invalid endpoint";
    }
  })();
  const statusText = status ? ` (HTTP ${status})` : "";
  const causeText = cause instanceof SyntaxError ? ": malformed JSON" : "";
  return new Error(
    `${operation} failed at ${endpoint}${statusText}${causeText}`,
  );
}

export async function requestJson({
  operation,
  url,
  method = "GET",
  headers = {},
  body,
  fetchImpl = fetch,
  sleep = defaultSleep,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("request timeout")),
      timeoutMs,
    );
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (cause) {
      clearTimeout(timeout);
      if (attempt + 1 >= MAX_ATTEMPTS) {
        throw sanitizedError({ operation, url, cause });
      }
      await sleep(DEFAULT_RETRY_DELAYS_MS[attempt]);
      continue;
    }
    clearTimeout(timeout);

    if (!response.ok) {
      if (
        !RETRYABLE_STATUS.has(response.status) ||
        attempt + 1 >= MAX_ATTEMPTS
      ) {
        throw sanitizedError({ operation, url, status: response.status });
      }
      const retryAfter = retryAfterMs(response.headers.get("retry-after"));
      await sleep(retryAfter ?? DEFAULT_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    try {
      return await response.json();
    } catch (cause) {
      throw sanitizedError({ operation, url, status: response.status, cause });
    }
  }

  throw sanitizedError({ operation, url });
}
