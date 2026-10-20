import { createHash, randomUUID } from "node:crypto";
import { CaptureState } from "../../src/worker-capture.mjs";
import type { CaptureEvent } from "../../src/worker-public.mjs";

/** Independently constructed strict v2 wire fixtures, not a production parser or
 * a v1 fallback. The original native/protocol tests consume these exact bytes. */
export function v2Frames(
  text = "Done",
  childRunId = randomUUID(),
  toolName?: string,
): string {
  const events: CaptureEvent[] = [{ kind: "ready", requestProtocol: 2 }];
  const source = { disposition: "unavailable", value: null } as const;
  const coverage = {
    observed: "complete",
    source: "complete",
    redacted: false,
    omissions: [],
  } as const;
  const detail = (
    descriptor: Extract<CaptureEvent, { kind: "detail-begin" }>["descriptor"],
    body: string,
  ) => {
    const detailId = randomUUID();
    events.push({ kind: "detail-begin", detailId, descriptor });
    let offset = 0;
    for (let at = 0; at < body.length; at += 1024) {
      const part = body.slice(at, at + 1024);
      events.push({ kind: "detail-chunk", detailId, offset, text: part });
      offset += Buffer.byteLength(part);
    }
    events.push({
      kind: "detail-end",
      detailId,
      bytes: offset,
      sha256: createHash("sha256").update(body).digest("hex"),
      coverage: { ...coverage, omissions: [] },
    });
    return detailId;
  };
  for (const component of [
    "request-context",
    "request-prompt",
    "request-instructions",
    "role",
    "effective-system",
  ] as const)
    detail(
      {
        owner: { kind: "context", component },
        field: "context",
        encoding: "utf8",
      },
      "",
    );
  if (toolName) {
    const callId = randomUUID();
    events.push({
      kind: "tool-start",
      callId,
      source,
      name: toolName,
      declaration: null,
      argsDetailId: null,
    });
    const resultDetailId = detail(
      {
        owner: {
          kind: "tool",
          callId,
          blockId: randomUUID(),
          index: 0,
          stage: "result",
        },
        field: "tool-result",
        encoding: "utf8",
      },
      "result",
    );
    events.push({
      kind: "tool-end",
      callId,
      source,
      name: toolName,
      declaration: null,
      resultDetailId,
      association: "execution-only",
      startObserved: true,
      isError: false,
    });
  }
  const messageId = randomUUID(),
    blockId = randomUUID();
  events.push({
    kind: "message-start",
    messageId,
    role: "assistant",
    source,
    resultCallId: null,
  });
  const block = detail(
    {
      owner: { kind: "message", messageId, blockId, index: 0, stage: "final" },
      field: "message",
      encoding: "utf8",
    },
    text,
  );
  events.push({ kind: "message-text", messageId, blockId, detailId: block });
  const detailId = detail(
    {
      owner: { kind: "message-final", messageId },
      field: "final-text",
      encoding: "utf8",
    },
    text,
  );
  events.push(
    {
      kind: "message-end",
      messageId,
      finalDetailId: detailId,
      finalBlockCount: 1,
      stopReason: "stop",
    },
    { kind: "final", messageId, detailId, stopReason: "stop" },
  );
  return events
    .map(
      (event, index) =>
        `${JSON.stringify({ protocol: 2, childRunId, workerSeq: index + 1, observedMs: index, event })}\n`,
    )
    .join("");
}
/** Assertions may project the old ready/tool/final vocabulary, but every source
 * byte is first checked by the v2 state/hash/association machine. Raw canary and
 * original close assertions continue to use the actual unprojected streams. */
export function captureSummary(raw: string): string {
  if (!raw) return "";
  const lines = raw.trimEnd().split("\n");
  const state = new CaptureState(JSON.parse(lines[0]).childRunId);
  const result: unknown[] = [];
  for (const line of lines) {
    const { event } = state.accept(
      JSON.parse(line),
      Buffer.byteLength(line) + 1,
    );
    if (event.kind === "ready") result.push({ type: "ready" });
    if (event.kind === "tool-start")
      result.push({ type: "tool", name: event.name });
    if (event.kind === "final")
      result.push({ type: "final", text: state.preview, stopReason: "stop" });
  }
  return result.map((v) => `${JSON.stringify(v)}\n`).join("");
}
