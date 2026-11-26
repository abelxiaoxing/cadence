import { randomUUID } from "node:crypto";
import { canonicalJson } from "../../src/service/contracts/core.ts";
import type { CaptureFrame } from "../../src/worker-public.mjs";

/** Capture frames as a worker emits them, for owner-side recorder fixtures. */
export const frame = (event: Record<string, unknown>) =>
  ({ event }) as CaptureFrame;
export function message(messageId: string, chunks: string[]): CaptureFrame[] {
  const detailId = randomUUID();
  return [
    frame({ kind: "message-start", messageId, role: "assistant" }),
    frame({
      kind: "detail-begin",
      detailId,
      descriptor: {
        owner: {
          kind: "message",
          messageId,
          blockId: randomUUID(),
          index: 0,
          stage: "stream",
        },
        field: "message",
        encoding: "utf8",
      },
    }),
    ...chunks.map((text) => frame({ kind: "detail-chunk", detailId, text })),
    frame({ kind: "detail-end", detailId }),
    frame({ kind: "message-end", messageId }),
  ];
}
/** A structured submission tool call whose result the owner retains.
 * Current submission tools carry the structured payload in `details`; string
 * payloads exercise the retained `content[0].text` envelope path. */
export function submission(
  tool: string,
  payload: string | Record<string, unknown>,
): CaptureFrame[] {
  const callId = randomUUID(),
    detailId = randomUUID();
  return [
    frame({ kind: "tool-start", callId, name: tool }),
    frame({
      kind: "detail-begin",
      detailId,
      descriptor: {
        owner: { kind: "tool", callId, stage: "result" },
        field: "tool-result",
        encoding: "canonical-json",
      },
    }),
    frame({
      kind: "detail-chunk",
      detailId,
      // The declared encoding is canonical JSON: keys ascending, as the real
      // capture emits it; a plain JSON.stringify order is refused here.
      text: canonicalJson(
        typeof payload === "string"
          ? { content: [{ type: "text", text: payload }] }
          : {
              content: [{ type: "text", text: "Submitted." }],
              details: payload,
            },
      ),
    }),
    frame({ kind: "detail-end", detailId }),
    frame({ kind: "tool-end", callId, name: tool, isError: false }),
  ];
}
