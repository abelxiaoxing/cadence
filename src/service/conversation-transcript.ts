/** Immutable transcript pages plus a bounded, replaceable latest-turn projection.
 * Page/count bounds govern one read, never the amount of retained conversation. */
import { ContractError, canonicalJson, LIMITS } from "./contracts/core.ts";
import type { ChatItem, ChatTurn } from "./contracts/workbench.ts";

export const TRANSCRIPT_PAGE_BYTES = 384 * 1024;
const PREVIEW_BYTES = 300 * 1024;
// At most six JSON bytes per UTF-16 code unit; two fields still fit one page.
const FIELD_CHARS = 16 * 1024;
const PREVIEW_MARK =
  "\n[Preview only; the rest appears once this step completes.]";
function part(value: string, offset: number, chars = FIELD_CHARS): string {
  let end = Math.min(value.length, offset + chars);
  if (end < value.length && /[\uD800-\uDBFF]/u.test(value[end - 1])) end--;
  return value.slice(offset, end);
}
type Field = "text" | "args" | "name";
/** A field just set: its encoded size and at least its first characters a
 * preview can show, so a long growing stream is never rescanned or copied. */
export interface FieldUpdate {
  bytes: number;
  head: string;
}
/** The characters of a growing text a preview can show, extended by `added`. */
export function previewHead(head: string, added: string): string {
  return head.length > FIELD_CHARS
    ? head
    : head + added.slice(0, FIELD_CHARS + 1 - head.length);
}
export interface TranscriptPage {
  turnId: string;
  page: number;
  items: ChatItem[];
}
export class ConversationTranscript {
  private readonly state = { pages: 0 };
  private readonly workingSizes = new Map<string, number>();
  /** Encoded bytes of each unfinished item's fields, so a stream is not rescanned. */
  private readonly fieldBytes = new Map<string, Record<Field, number>>();
  private workingBytes = 0;
  private readonly sizes = new Map<string, number>();
  private bytes = 4096;
  private readonly pending = new Map<string, ChatItem>();
  constructor(
    private readonly turn: ChatTurn,
    private readonly write: (page: TranscriptPage) => void,
  ) {
    turn.transcript = this.state;
    for (const item of [...turn.items]) {
      this.archive(item);
      this.preview(item);
    }
  }
  item(id: string, role: ChatItem["role"]): ChatItem {
    let item = this.pending.get(id);
    if (!item) {
      // Concurrent unfinished items are a working-set bound, not retained history.
      if (this.pending.size >= 256) throw new ContractError("capacity");
      item = { id, role, text: "", name: "", args: "", error: false };
      this.pending.set(id, item);
      this.preview(item);
    }
    return item;
  }
  find(id: string): ChatItem | undefined {
    return this.pending.get(id);
  }
  preview(
    item: ChatItem,
    known: Partial<Record<Field, FieldUpdate>> = {},
  ): void {
    if (this.pending.has(item.id)) {
      const cached = this.fieldBytes.get(item.id);
      const bytes = (field: Field) =>
        known[field]?.bytes ??
        cached?.[field] ??
        Buffer.byteLength(item[field]);
      const fields = {
        text: bytes("text"),
        args: bytes("args"),
        name: bytes("name"),
      };
      this.fieldBytes.set(item.id, fields);
      const size = fields.text + fields.args + fields.name;
      this.workingBytes += size - (this.workingSizes.get(item.id) ?? 0);
      this.workingSizes.set(item.id, size);
      if (this.workingBytes > 2 * LIMITS.detailBytes)
        throw new ContractError("capacity");
    }
    const clip = (field: "text" | "args") => {
      const value = item[field];
      const prefix = part(known[field]?.head ?? value, 0);
      return prefix.length < value.length ? prefix + PREVIEW_MARK : value;
    };
    const preview = { ...item, text: clip("text"), args: clip("args") };
    const size = Buffer.byteLength(canonicalJson(preview, PREVIEW_BYTES));
    this.bytes += size - (this.sizes.get(item.id) ?? 0);
    this.sizes.set(item.id, size);
    const at = this.turn.items.findIndex((i) => i.id === item.id);
    if (at < 0) this.turn.items.push(preview);
    else this.turn.items[at] = preview;
    while (this.bytes > PREVIEW_BYTES || this.turn.items.length > 128) {
      // Keep the user's request and newest observation. Removed observations
      // are available in immutable pages (or remain in pending).
      if (this.turn.items.length <= 2) throw new ContractError("oversize");
      const [removed] = this.turn.items.splice(
        this.turn.items[0].role === "user" ? 1 : 0,
        1,
      );
      this.bytes -= this.sizes.get(removed.id) ?? 0;
      this.sizes.delete(removed.id);
    }
  }

  complete(id: string): void {
    const item = this.pending.get(id);
    if (!item) return;
    this.preview(item);
    this.archive(item);
    this.pending.delete(id);
    this.fieldBytes.delete(id);
    this.workingBytes -= this.workingSizes.get(id) ?? 0;
    this.workingSizes.delete(id);
  }
  finish(): void {
    for (const id of this.pending.keys()) this.complete(id);
  }
  private archive(item: ChatItem): void {
    let text = 0,
      args = 0;
    do {
      // Fill a real page rather than writing one tiny file per preview slice.
      // Start with a large text slice, then account for UTF-8 and JSON escaping;
      // arguments retain their wire field bound and surrogate pairs stay whole.
      let chars = 128 * 1024;
      const fragment = { ...item, text: "", args: part(item.args, args) };
      for (;;) {
        fragment.text = part(item.text, text, chars);
        try {
          if (Buffer.byteLength(fragment.text) > 256 * 1024)
            throw new ContractError("oversize");
          canonicalJson(fragment, TRANSCRIPT_PAGE_BYTES - 4096);
          break;
        } catch (error) {
          if (
            !(error instanceof ContractError) ||
            error.code !== "oversize" ||
            chars <= FIELD_CHARS
          )
            throw error;
          chars /= 2;
        }
      }
      const page = this.state.pages;
      if (!Number.isSafeInteger(page + 1)) throw new ContractError("capacity");
      this.write({ turnId: this.turn.id, page, items: [fragment] });
      // Publish a page only after its original durable write succeeded.
      this.state.pages = page + 1;
      text += fragment.text.length;
      args += fragment.args.length;
    } while (text < item.text.length || args < item.args.length);
  }
}
