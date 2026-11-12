import { randomUUID } from "node:crypto";
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
