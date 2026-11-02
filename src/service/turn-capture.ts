/** A workflow subagent's turn retained from its worker's capture frames, with
 * the same split-secret sanitizer as task capture. The whole turn is one
 * bounded record; exceeding it throws so the caller can mark the transcript. */
import type { CaptureFrame, DetailDescriptor } from "../worker-public.mjs";
import { DetailSanitizer, sanitizeText } from "../worker-redaction.mjs";
import { ContractError, canonicalJson } from "./contracts/core.ts";
import type { ChatItem, ChatTurn } from "./contracts/workbench.ts";

const TURN_BYTES = 384 * 1024;
const OMITTED_FLAG = {
  "hidden-thinking": "thinking",
  binary: "media",
  unsupported: "other",
} as const satisfies Record<string, keyof ChatTurn["omitted"]>;

export class TurnCapture {
  // Encoded sizes are kept beside each growing text: rescanning a long stream
  // on every chunk made capture quadratic and stalled the owner's reads.
  private readonly details = new Map<
    string,
    {
      descriptor: DetailDescriptor;
      sanitizer: DetailSanitizer;
      text: string;
      bytes: number;
    }
  >();
  private readonly messageText = new Map<
    string,
    { messageId: string; text: string; bytes: number }
  >();
  constructor(
    private readonly turn: ChatTurn,
    private readonly save: () => void,
    private readonly secrets: () => readonly string[],
  ) {}
  private item(id: string, role: ChatItem["role"]): ChatItem {
    let item = this.turn.items.find((i) => i.id === id);
    if (!item) {
      if (this.turn.items.length >= 256) throw new ContractError("capacity");
      item = { id, role, text: "", name: "", args: "", error: false };
      this.turn.items.push(item);
      try {
        canonicalJson(this.turn, TURN_BYTES - 2048);
      } catch (error) {
        this.turn.items.pop();
        this.turn.notice = "Conversation capture limit exceeded.";
        throw error;
      }
    }
    return item;
  }
  private update(
    item: ChatItem,
    field: "text" | "name" | "args",
    value: string,
    maximum: number,
    bytes = Buffer.byteLength(value),
  ): void {
    const before = item[field];
    try {
      if (bytes > maximum) throw new ContractError("capacity");
      item[field] = value;
      canonicalJson(this.turn, TURN_BYTES - 2048);
    } catch (error) {
      item[field] = before;
      this.turn.notice = "Conversation capture limit exceeded.";
      throw error;
    }
  }
  accept(frame: CaptureFrame): void {
    const e = frame.event;
    if (e.kind === "detail-begin") {
      if (
        e.descriptor.owner.kind === "context" ||
        e.descriptor.owner.kind === "handoff"
      )
        return;
      if (this.details.size >= 64) throw new ContractError("capacity");
      this.details.set(e.detailId, {
        descriptor: e.descriptor,
        sanitizer: new DetailSanitizer(e.descriptor.encoding, this.secrets()),
        text: "",
        bytes: 0,
      });
    } else if (e.kind === "detail-chunk" || e.kind === "detail-end") {
      const d = this.details.get(e.detailId);
      if (!d) return;
      const added =
        e.kind === "detail-chunk"
          ? d.sanitizer.write(e.text)
          : d.sanitizer.end();
      d.text += added;
      d.bytes += Buffer.byteLength(added);
      if (d.bytes > 256 * 1024) throw new ContractError("capacity");
      const o = d.descriptor.owner;
      if (o.kind === "message") {
        const role = this.turn.items.find((i) => i.id === o.messageId)?.role;
        if (role === "assistant" && o.stage === "stream") {
          this.messageText.set(o.blockId, {
            messageId: o.messageId,
            text: d.text,
            bytes: d.bytes,
          });
          const blocks = [...this.messageText.values()].filter(
            (block) => block.messageId === o.messageId,
          );
          this.update(
            this.item(o.messageId, "assistant"),
            "text",
            blocks.map((block) => block.text).join(""),
            256 * 1024,
            blocks.reduce((size, block) => size + block.bytes, 0),
          );
        }
      } else if (o.kind === "message-final") {
        const item = this.turn.items.find((i) => i.id === o.messageId);
        if (item?.role === "assistant")
          this.update(item, "text", d.text, 256 * 1024, d.bytes);
      } else if (o.kind === "tool") {
        const item = this.item(o.callId, "tool");
        if (o.stage === "execution-arguments" || o.stage === "arguments-final")
          this.update(item, "args", d.text, 64 * 1024, d.bytes);
        if (o.stage === "result" || o.stage === "update-snapshot")
          this.update(item, "text", d.text, 256 * 1024, d.bytes);
      }
      if (e.kind === "detail-end") this.details.delete(e.detailId);
    } else if (e.kind === "message-start" && e.role === "assistant") {
      this.item(e.messageId, "assistant");
    } else if (e.kind === "tool-start" || e.kind === "tool-end") {
      const item = this.item(e.callId, "tool");
      this.update(item, "name", sanitizeText(e.name, this.secrets()), 128);
      if (e.kind === "tool-end") item.error = e.isError;
    } else if (e.kind === "worker-failure")
      this.turn.notice = `worker-failure: ${e.code}`;
    else if (
      e.kind === "omitted-block" &&
      e.block.owner.kind !== "context" &&
      e.block.owner.kind !== "handoff"
    )
      // A flag, not a notice line: it must never displace a failure reason.
      this.turn.omitted[OMITTED_FLAG[e.block.reason]] = true;
    if (
      [...this.details.values()].reduce(
        (size, detail) => size + detail.bytes + detail.sanitizer.retainedBytes,
        0,
      ) > TURN_BYTES
    )
      throw new ContractError("capacity");
    canonicalJson(this.turn, TURN_BYTES);
    if (e.kind === "message-end")
      for (const [id, block] of this.messageText)
        if (block.messageId === e.messageId) this.messageText.delete(id);
    if (e.kind === "message-end" || e.kind === "tool-end") this.save();
  }
}
