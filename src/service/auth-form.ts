import type { IncomingMessage } from "node:http";
import { ContractError, LIMITS } from "../service-contract.ts";
import { sanitizeNextPath } from "./auth.ts";

/** Shared bounded native-form decoder. The caller owns concurrency and closure. */
export async function readLoginForm(
  req: IncomingMessage,
  signal?: AbortSignal,
): Promise<{ password: string; next: string }> {
  if (
    req.headers["content-type"] !== "application/x-www-form-urlencoded" ||
    req.headers["content-encoding"] !== undefined ||
    req.headers["transfer-encoding"] !== undefined
  )
    throw new ContractError("invalid");
  const length = req.headers["content-length"];
  if (
    length !== undefined &&
    (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > LIMITS.controlBytes)
  )
    throw new ContractError("oversize");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    if (signal?.aborted) throw new ContractError("unavailable");
    bytes += chunk.length;
    if (bytes > LIMITS.controlBytes) throw new ContractError("oversize");
    chunks.push(chunk);
  }
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw new ContractError("invalid");
  }
  if (
    form.getAll("password").length !== 1 ||
    form.getAll("next").length > 1 ||
    [...form.keys()].some((key) => key !== "password" && key !== "next")
  )
    throw new ContractError("invalid");
  return {
    password: form.get("password") ?? "",
    next: sanitizeNextPath(form.get("next")),
  };
}

/** Retry carries the safe destination, never the rejected password. */
export function loginRetryPath(next: string): string {
  const target = sanitizeNextPath(next);
  return target === "/app"
    ? "/?auth_error=1"
    : `/?${new URLSearchParams({ auth_error: "1", next: target })}`;
}

export function loginNextPath(url: URL): string {
  return sanitizeNextPath(
    url.pathname === "/" && url.searchParams.has("auth_error")
      ? url.searchParams.get("next")
      : `${url.pathname}${url.search}${url.hash}`,
  );
}
