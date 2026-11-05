import {
  decodeImageBase64,
  IMAGE_LIMITS,
  type InputImage,
  validateImageBytes,
} from "../image-content.mjs";
import { ContractError, canonicalJson } from "./contracts/core.ts";
import type {
  ImageSend,
  WorkbenchCommand,
  WorkbenchResult,
} from "./contracts/workbench.ts";
import type { Caller } from "./ports.ts";

type Upload = Extract<WorkbenchCommand, { kind: "image-upload" }>;
interface Staged {
  binding: string;
  caller: string;
  mimeType: string;
  size: number;
  data: string;
  at: number;
  ready: boolean;
}
const binding = (send: ImageSend) => {
  const { images: _, ...command } = send;
  return canonicalJson(command);
};
const identity = (caller?: Caller) => {
  if (!caller) throw new ContractError("forbidden");
  return canonicalJson(caller);
};
/** Ephemeral uploads only. Pi owns the sole durable image copy.
 * Uploading cannot admit a turn, select a model or enable Cadence. */
export class ConversationImages {
  private readonly staged = new Map<string, Staged>();
  constructor(private readonly now = Date.now) {}
  clear(): void {
    this.staged.clear();
  }
  upload(c: Upload, caller?: Caller): WorkbenchResult {
    const who = identity(caller),
      key = binding(c.send),
      now = this.now();
    for (const [id, value] of this.staged)
      if (now - value.at > IMAGE_LIMITS.idleMs) this.staged.delete(id);
    let row = this.staged.get(c.imageId);
    if (!row) {
      if (c.offset !== 0) throw new ContractError("stale");
      row = {
        binding: key,
        caller: who,
        mimeType: c.mimeType,
        size: c.size,
        data: "",
        at: now,
        ready: false,
      };
    }
    if (
      row.caller !== who ||
      row.binding !== key ||
      row.mimeType !== c.mimeType ||
      row.size !== c.size ||
      row.data.length !== c.offset ||
      row.ready
    )
      throw new ContractError("conflict");
    const total = 4 * Math.ceil(row.size / 3);
    if (
      c.data.length % 4 ||
      c.offset + c.data.length > total ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(c.data) ||
      (c.offset + c.data.length < total && c.data.includes("="))
    )
      throw new ContractError("invalid");
    const data = row.data + c.data;
    if (data.length === total) {
      try {
        const bytes = decodeImageBase64(data);
        if (bytes.length !== row.size) throw new Error("size");
        validateImageBytes(bytes, row.mimeType);
      } catch {
        this.staged.delete(c.imageId);
        throw new ContractError("invalid");
      }
    }
    Object.assign(row, { data, at: now, ready: data.length === total });
    this.staged.set(c.imageId, row);
    return {
      kind: "image-upload",
      commandId: c.commandId,
      imageId: c.imageId,
      offset: data.length,
    };
  }
  /** Called once at admission, after receipt/freshness checks. A live turn owns
   * its immutable bytes thereafter, independently of viewer departure/rotation. */
  claim(send: ImageSend, caller?: Caller): InputImage[] {
    if (!send.images?.length) return [];
    const who = identity(caller),
      key = binding(send);
    if (new Set(send.images).size !== send.images.length)
      throw new ContractError("invalid");
    const images = send.images.map((id): InputImage => {
      const row = this.staged.get(id);
      if (
        !row?.ready ||
        row.caller !== who ||
        row.binding !== key ||
        this.now() - row.at > IMAGE_LIMITS.idleMs
      )
        throw new ContractError("stale");
      return { type: "image", data: row.data, mimeType: row.mimeType };
    });
    for (const id of send.images) this.staged.delete(id);
    return images;
  }
}
