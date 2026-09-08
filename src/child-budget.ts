import type { ChildFailure } from "./contracts.ts";

/** Conservative admission estimate, not a tokenizer or a claim about provider billing. */
export function childContextBudget(model: {
  contextWindow?: number;
  maxTokens?: number;
}): number {
  if (
    !Number.isFinite(model.contextWindow) ||
    !model.contextWindow ||
    model.contextWindow < 1
  )
    return 4 * 1024 * 1024;
  const reserve = Math.min(
    model.maxTokens ?? 8192,
    Math.floor(model.contextWindow / 2),
  );
  return Math.min(
    4 * 1024 * 1024,
    Math.max(1024, Math.floor((model.contextWindow - reserve - 1024) * 2)),
  );
}

export function classifyProviderFailure(error: unknown): ChildFailure {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  if (
    /context.{0,30}(?:length|window|limit|exceed)|too many tokens|input.{0,20}too long/iu.test(
      text,
    )
  )
    return { kind: "execution-limit", code: "child-context-limit" };
  if (
    /\b(?:401|403)\b|invalid.{0,10}api.?key|unauthorized|authentication/iu.test(
      text,
    )
  )
    return {
      kind: "environment",
      code: "child-provider-authentication-failed",
      stage: "child-provider-stream",
    };
  if (/\b429\b|rate.?limit|too many requests/iu.test(text))
    return {
      kind: "transport",
      code: "child-provider-rate-limited",
      stage: "child-provider-stream",
    };
  return {
    kind: "transport",
    code: "child-provider-stream-error",
    stage: "child-provider-stream",
  };
}
