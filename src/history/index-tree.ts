/** Small immutable radix index. The journal anchors its root; leaves only route
 * retained reads. Neither the tree nor any checkpoint authorizes effects. */
import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { OwnerLease } from "../service/coordination.ts";
import { hash } from "../service/private-files.ts";
import {
  ContractError,
  canonicalJson,
  decodeId,
  decodeSequence,
} from "../service-contract.ts";
import { closed, decodeHash } from "../worker-public.mjs";
import type { HistoryFiles, HistoryReadBudget } from "./files.ts";
import { readRange } from "./read-io.ts";
export interface IndexHead {
  seq: string;
  hash: string;
}
interface Leaf {
  kind: "leaf";
  entries: Record<string, IndexHead>;
}
interface Branch {
  kind: "branch";
  children: Record<string, string>;
}
type Node = Leaf | Branch;
const MAX_NODE = 16 * 1024;
export const ACTIVE_KEY = "active";
export function chainHash(
  seq: string,
  previous: string | null,
  previousHash: string | null,
): string {
  return hash(canonicalJson({ seq, previous, previousHash }));
}
function decodeNode(value: unknown): Node {
  if (!value || typeof value !== "object" || !("kind" in value))
    throw new ContractError("receipt-inconclusive");
  if (value.kind === "leaf") {
    const o = closed(value, ["kind", "entries"]);
    if (!o.entries || typeof o.entries !== "object" || Array.isArray(o.entries))
      throw new ContractError("receipt-inconclusive");
    const entries: Record<string, IndexHead> = {};
    for (const [id, v] of Object.entries(o.entries)) {
      if (id !== ACTIVE_KEY)
        decodeId(id.startsWith("roster:") ? id.slice(7) : id);
      const h = closed(v, ["seq", "hash"]);
      entries[id] = { seq: decodeSequence(h.seq), hash: decodeHash(h.hash) };
    }
    if (Object.keys(entries).length > 32)
      throw new ContractError("receipt-inconclusive");
    return { kind: "leaf", entries };
  }
  const o = closed(value, ["kind", "children"]);
  if (
    o.kind !== "branch" ||
    !o.children ||
    typeof o.children !== "object" ||
    Array.isArray(o.children)
  )
    throw new ContractError("receipt-inconclusive");
  const children: Record<string, string> = {};
  for (const [key, v] of Object.entries(o.children)) {
    if (!/^[0-9a-f]$/.test(key))
      throw new ContractError("receipt-inconclusive");
    children[key] = decodeHash(v);
  }
  return { kind: "branch", children };
}
export class IndexTree {
  private cache = new Map<string, { node: Node; budget?: HistoryReadBudget }>();
  constructor(readonly files: HistoryFiles) {}
  private path(id: string): string {
    return join(
      this.files.directory,
      "indexes",
      "nodes",
      id.slice(0, 2),
      `${id}.json`,
    );
  }
  private load(
    id: string,
    budget?: HistoryReadBudget,
    unit?: Map<string, Node>,
  ): Node {
    decodeHash(id);
    // Writer head discovery is one synchronous immutable-root read unit. The
    // bounded memo is discarded before update/effects, never reused at the next
    // append or installed as authority. Every miss still checks original bytes.
    const remembered = unit?.get(id);
    if (remembered) return remembered;
    const old = this.cache.get(id);
    // A call has no intervening await between these immutable metadata lookups.
    // Across calls, actual bytes are reread and hashed, not just their timestamps.
    if (budget && old?.budget === budget) return old.node;
    try {
      let bytes: Buffer;
      if (budget) {
        const path = this.path(id);
        budget.reserve(0);
        const selected = lstatSync(path).size;
        if (selected > MAX_NODE)
          throw new ContractError("receipt-inconclusive");
        bytes = readRange(this.files, path, 0, selected, budget);
      } else {
        const file = this.files.files.read(this.path(id), MAX_NODE);
        if (!file) throw new ContractError("receipt-inconclusive");
        bytes = file.bytes;
      }
      if (hash(bytes) !== id) throw new ContractError("receipt-inconclusive");
      const node = decodeNode(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
      if (this.cache.size >= 128) {
        const first = this.cache.keys().next().value;
        if (first) this.cache.delete(first);
      }
      this.cache.set(id, { node, budget });
      if (unit) {
        if (unit.size >= 128) {
          const first = unit.keys().next().value;
          if (first) unit.delete(first);
        }
        unit.set(id, node);
      }
      return node;
    } catch {
      throw new ContractError("receipt-inconclusive");
    }
  }
  head(
    root: string | null,
    id: string,
    budget?: HistoryReadBudget,
  ): IndexHead | undefined {
    return this.find(root, id, budget);
  }
  private find(
    root: string | null,
    id: string,
    budget?: HistoryReadBudget,
    unit?: Map<string, Node>,
  ): IndexHead | undefined {
    if (id !== ACTIVE_KEY)
      decodeId(id.startsWith("roster:") ? id.slice(7) : id);
    let selected = root,
      depth = 0;
    const key = hash(id);
    while (selected) {
      if (depth > 64) throw new ContractError("receipt-inconclusive");
      const node = this.load(selected, budget, unit);
      if (node.kind === "leaf") return node.entries[id];
      selected = node.children[key[depth++]] ?? null;
    }
  }
  heads(root: string | null, ids: readonly string[]): Map<string, IndexHead> {
    const unit = new Map<string, Node>(),
      heads = new Map<string, IndexHead>();
    for (const id of ids) {
      const head = this.find(root, id, undefined, unit);
      if (head) heads.set(id, head);
    }
    return heads;
  }
  update(
    lease: OwnerLease,
    root: string | null,
    updates: Map<string, IndexHead>,
    charge: (bytes: number) => void,
  ): string | null {
    if (!updates.size) return root;
    const put = (node: Node): string => {
      const body = canonicalJson(node, MAX_NODE),
        id = hash(body),
        path = this.path(id);
      lease.assert();
      const previous = this.files.files.read(path, MAX_NODE);
      if (previous) {
        if (previous.identity !== id)
          throw new ContractError("corrupt-selected");
        return id;
      }
      charge(Buffer.byteLength(body));
      this.files.files.create(path, body, Buffer.byteLength(body));
      return id;
    };
    const write = (
      old: string | null,
      changes: Map<string, IndexHead>,
      depth: number,
    ): string => {
      if (depth > 64) throw new ContractError("capacity");
      const node: Node = old ? this.load(old) : { kind: "leaf", entries: {} };
      if (node.kind === "leaf") {
        const entries = { ...node.entries, ...Object.fromEntries(changes) };
        if (Object.keys(entries).length <= 32)
          return put({ kind: "leaf", entries });
        const groups = new Map<string, Map<string, IndexHead>>();
        for (const [id, value] of Object.entries(entries)) {
          const digit = hash(id)[depth];
          if (!digit) throw new ContractError("capacity");
          const group = groups.get(digit) ?? new Map();
          group.set(id, value);
          groups.set(digit, group);
        }
        return put({
          kind: "branch",
          children: Object.fromEntries(
            [...groups].map(([digit, group]) => [
              digit,
              write(null, group, depth + 1),
            ]),
          ),
        });
      }
      const children = { ...node.children },
        groups = new Map<string, Map<string, IndexHead>>();
      for (const [id, value] of changes) {
        const digit = hash(id)[depth];
        if (!digit) throw new ContractError("capacity");
        const group = groups.get(digit) ?? new Map();
        group.set(id, value);
        groups.set(digit, group);
      }
      for (const [digit, group] of groups)
        children[digit] = write(children[digit] ?? null, group, depth + 1);
      return put({ kind: "branch", children });
    };
    return write(root, updates, 0);
  }
}
