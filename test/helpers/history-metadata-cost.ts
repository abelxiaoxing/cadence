/** Fixture-only aggregate counters. No payloads, identities or per-call logs.
 * Wrappers call each original once, retain its receiver/return/throw, and never
 * await, cache, refund or replace native IO or a read-budget decision. */
import { createHash, Hash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { HistoryReadBudget } from "../../src/history/files.ts";
import { IndexTree } from "../../src/history/index-tree.ts";
import { HistoryNavigation } from "../../src/history/navigation.ts";
import { HistoryProjection } from "../../src/history/projection.ts";
import { RetainedTraversal } from "../../src/history/retained-traversal.ts";
import { ResumableSha256 } from "../../src/history/sha256-state.ts";
import { SourceRows } from "../../src/history/source-row.ts";
import { ForwardValidator } from "../../src/history/validator.ts";
import { OwnerLease } from "../../src/service/coordination.ts";

import {
  active,
  type Counts,
  metadataCount,
  setActive,
} from "./history-metadata-counters.ts";
export function metadataCost() {
  const directory = mkdtempSync(join(tmpdir(), "metadata-cost-"));
  const phases: { name: string; ms: number; counts: Counts }[] = [];
  const trees: { files: number; bytes: number; sha256: string }[] = [];
  const restores: (() => void)[] = [];
  let name = "setup",
    started = performance.now();
  setActive({});
  const wrap = (object: object, key: string, label: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (typeof descriptor?.value !== "function")
      throw Error("fixture observation method");
    const original = descriptor.value;
    Object.defineProperty(object, key, {
      ...descriptor,
      value: function (this: unknown, ...args: unknown[]) {
        metadataCount(label);
        if (label === "budget.reserve")
          return Reflect.apply(original, this, args);
        const started = performance.now();
        try {
          return Reflect.apply(original, this, args);
        } finally {
          metadataCount(`${label}.ms`, performance.now() - started);
        }
      },
    });
    restores.push(() => Object.defineProperty(object, key, descriptor));
  };
  for (const [object, keys, prefix] of [
    [
      HistoryNavigation.prototype,
      ["prepare", "publish", "batch", "next", "snapshot", "entityBatches"],
      "navigation",
    ],
    [HistoryProjection.prototype, ["entityAt"], "target"],
    [ForwardValidator.prototype, ["next", "batch", "revalidate"], "validator"],
    [RetainedTraversal.prototype, ["prepare", "next"], "traversal"],
    [SourceRows.prototype, ["read", "assertCurrent"], "sources"],
    [IndexTree.prototype, ["head", "update"], "tree"],
    [OwnerLease.prototype, ["assert"], "lease"],
    [ResumableSha256.prototype, ["update"], "shaCheckpoint"],
    [HistoryReadBudget.prototype, ["reserve"], "budget"],
  ] as const)
    for (const key of keys) wrap(object, key, `${prefix}.${key}`);
  const parse = JSON.parse;
  JSON.parse = function (this: unknown, ...args: Parameters<typeof parse>) {
    metadataCount("parse.calls");
    // Observe strings only; native parse owns coercion and its exact failures.
    // Do not invoke a caller's toString twice just to count diagnostic bytes.
    metadataCount(
      "parse.bytes",
      typeof args[0] === "string" ? Buffer.byteLength(args[0]) : 0,
    );
    return Reflect.apply(parse, this, args);
  };
  restores.push(() => {
    JSON.parse = parse;
  });
  const update = Hash.prototype.update;
  Hash.prototype.update = function (...args: unknown[]) {
    const [data, encoding] = args;
    metadataCount("hash.calls");
    metadataCount(
      "hash.bytes",
      typeof data === "string"
        ? Buffer.byteLength(
            data,
            typeof encoding === "string" && Buffer.isEncoding(encoding)
              ? encoding
              : "utf8",
          )
        : ArrayBuffer.isView(data)
          ? data.byteLength
          : 0,
    );
    return Reflect.apply(update, this, args);
  };
  restores.push(() => {
    Hash.prototype.update = update;
  });
  const finish = () => {
    phases.push({
      name,
      ms: performance.now() - started,
      counts: active ?? {},
    });
    setActive(undefined);
    writeFileSync(
      join(directory, "phases.json"),
      JSON.stringify(
        { schema: "cadence-w3-metadata-cost/1", phases, trees },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  };
  return {
    tree(entries: [string, string][], root: string) {
      if (trees.length >= 2) throw Error("fixture tree receipt bound");
      const hash = createHash("sha256");
      let bytes = 0;
      for (const [path, hex] of entries) {
        const content = Buffer.from(hex, "hex");
        hash.update(JSON.stringify(relative(root, path))).update(content);
        bytes += content.length;
      }
      trees.push({ files: entries.length, bytes, sha256: hash.digest("hex") });
    },
    phase(next: string) {
      finish();
      name = next;
      started = performance.now();
      setActive({});
    },
    close() {
      finish();
      for (const restore of restores.reverse()) restore();
    },
  };
}
