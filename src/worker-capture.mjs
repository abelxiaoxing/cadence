import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  advanceCapture,
  ContractError,
  canonicalJson,
  decodeId,
  decodeSourceIdentity,
  LIMITS,
  parseWireJson,
  utf8Bytes,
} from "./worker-public.mjs";
import {
  DetailSanitizer,
  own,
  ownArray,
  sanitizedJsonChunks,
  sanitizeText,
  TextSanitizer,
} from "./worker-redaction.mjs";

export const completeCoverage = () => ({
  observed: "complete",
  source: "complete",
  redacted: false,
  omissions: [],
});
export const controlEvent = (kind) =>
  ["ready", "capture-status", "worker-failure", "final"].includes(kind);
export function* chunks(text) {
  // At most 8KiB decoded, including four-byte Unicode; never split surrogates.
  for (let at = 0; at < text.length; ) {
    let end = Math.min(at + 2048, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    yield text.slice(at, end);
    at = end;
  }
}
function requireFact(condition) {
  if (!condition) throw new ContractError();
}
/** Stateful original-wire validator. The emitter and native owner use this same
 * implementation. Hashes are checked before any owner transformation. */
export class CaptureState {
  constructor(childRunId, request) {
    this.position = {
      childRunId: decodeId(childRunId),
      workerSeq: 0,
      observedMs: 0,
      final: false,
    };
    this.details = new Map();
    this.messages = new Map();
    this.calls = new Map();
    this.blocks = new Map();
    this.dataFrames = 0;
    this.controlFrames = 0;
    this.bytes = 0;
    this.coverage = completeCoverage();
    this.selected = null;
    this.failed = false;
    this.request = request;
    this.contexts = new Set();
    this.handoffs = new Set();
  }
  accept(input, encodedBytes) {
    const { frame, position } = advanceCapture(this.position, input);
    const e = frame.event;
    const control = controlEvent(e.kind);
    this.bytes += encodedBytes ?? utf8Bytes(canonicalJson(frame)) + 1;
    if (
      ++this[control ? "controlFrames" : "dataFrames"] >
        (control ? LIMITS.controlFrames : LIMITS.dataFrames) ||
      this.bytes >
        LIMITS.childProtocolBytes - (control ? 0 : LIMITS.ownerControlBytes)
    )
      throw new ContractError("oversize");
    const message = (id) => {
      const m = this.messages.get(id);
      requireFact(m);
      return m;
    };
    const detail = (id, field, ownerId) => {
      const d = this.details.get(id);
      requireFact(d?.ended && d.descriptor.field === field);
      if (ownerId)
        requireFact(
          (d.descriptor.owner.messageId ?? d.descriptor.owner.callId) ===
            ownerId,
        );
      return d;
    };
    const owner = (o) => {
      if (o.kind === "message" || o.kind === "message-final")
        requireFact(!message(o.messageId).ended);
      // Execution args may precede their tool-start; validate at the reference.
      if (o.blockId) {
        const previous = this.blocks.get(o.blockId);
        const key = canonicalJson(o);
        requireFact(previous === undefined || previous === key);
        this.blocks.set(o.blockId, key);
      }
    };
    switch (e.kind) {
      case "ready":
        break;
      case "message-start":
        requireFact(!this.messages.has(e.messageId));
        if (e.resultCallId !== null)
          requireFact(this.calls.get(e.resultCallId)?.ended);
        this.messages.set(e.messageId, {
          role: e.role,
          ended: false,
          final: null,
          stopReason: null,
          finalIndices: new Set(),
          finalHash: createHash("sha256"),
          finalBytes: 0,
          finalIndex: -1,
        });
        break;
      case "detail-begin":
        requireFact(!this.details.has(e.detailId));
        owner(e.descriptor.owner);
        if (e.descriptor.owner.kind === "context") {
          requireFact(!this.contexts.has(e.descriptor.owner.component));
          this.contexts.add(e.descriptor.owner.component);
        }
        if (e.descriptor.owner.kind === "handoff") {
          const o = e.descriptor.owner;
          requireFact(!this.handoffs.has(o.dependencyIndex));
          if (this.request)
            requireFact(
              this.request.handoff.inputs.some(
                (input) =>
                  input.dependencyIndex === o.dependencyIndex &&
                  canonicalJson(input.result) === canonicalJson(o.source),
              ),
            );
          this.handoffs.add(o.dependencyIndex);
        }
        if (
          e.descriptor.owner.kind === "message" &&
          e.descriptor.owner.stage === "final"
        ) {
          const m = message(e.descriptor.owner.messageId);
          requireFact(
            e.descriptor.owner.index > m.finalIndex &&
              !m.finalIndices.has(e.descriptor.owner.index),
          );
          m.finalIndex = e.descriptor.owner.index;
          m.finalIndices.add(e.descriptor.owner.index);
        }
        this.details.set(e.detailId, {
          descriptor: e.descriptor,
          hash: createHash("sha256"),
          bytes: 0,
          ended: false,
          preview: "",
        });
        break;
      case "detail-chunk": {
        const d = this.details.get(e.detailId);
        requireFact(d && !d.ended && e.offset === d.bytes);
        d.bytes += utf8Bytes(e.text);
        d.hash.update(e.text);
        if (
          d.descriptor.owner.kind === "message" &&
          d.descriptor.owner.stage === "final"
        ) {
          const m = message(d.descriptor.owner.messageId);
          m.finalHash.update(e.text);
          m.finalBytes += utf8Bytes(e.text);
        }
        if (d.descriptor.field === "final-text" && utf8Bytes(d.preview) < 16384)
          d.preview += e.text.slice(0, 16384 - utf8Bytes(d.preview));
        break;
      }
      case "detail-end": {
        const d = this.details.get(e.detailId);
        requireFact(
          d &&
            !d.ended &&
            d.bytes === e.bytes &&
            d.hash.digest("hex") === e.sha256,
        );
        if (d.descriptor.owner.kind === "message-final") {
          const m = message(d.descriptor.owner.messageId);
          requireFact(
            m.finalBytes === e.bytes &&
              m.finalHash.copy().digest("hex") === e.sha256,
          );
        }
        d.hash = null;
        d.ended = true;
        this.mergeCoverage(e.coverage);
        break;
      }
      case "message-text": {
        const d = this.details.get(e.detailId);
        const o = d?.descriptor.owner;
        requireFact(
          !message(e.messageId).ended &&
            d &&
            o.kind === "message" &&
            o.messageId === e.messageId &&
            o.blockId === e.blockId,
        );
        break;
      }
      case "call-declaration": {
        const m = message(e.declaration.messageId);
        requireFact(!m.ended && m.role === "assistant");
        const old = this.calls.get(e.callId);
        requireFact(
          !old ||
            (!old.started &&
              !old.ended &&
              old.stage === "partial" &&
              canonicalJson(old.declaration) === canonicalJson(e.declaration)),
        );
        if (e.argsDetailId)
          requireFact(
            detail(e.argsDetailId, "tool-args", e.callId).descriptor.owner
              .stage ===
              (e.stage === "partial" ? "arguments-partial" : "arguments-final"),
          );
        if (e.stage === "final") {
          requireFact(!m.finalIndices.has(e.index));
          m.finalIndices.add(e.index);
        }
        this.calls.set(e.callId, { ...e, started: false, ended: false });
        break;
      }
      case "tool-start": {
        const old = this.calls.get(e.callId);
        requireFact(
          !old ||
            (!old.started &&
              !old.ended &&
              canonicalJson(old.declaration) === canonicalJson(e.declaration) &&
              canonicalJson(old.source) === canonicalJson(e.source) &&
              old.name === e.name),
        );
        requireFact(old || e.declaration === null);
        if (e.argsDetailId)
          requireFact(
            detail(e.argsDetailId, "tool-args", e.callId).descriptor.owner
              .stage === "execution-arguments",
          );
        this.calls.set(e.callId, { ...old, ...e, started: true, ended: false });
        break;
      }
      case "tool-update":
        requireFact(
          this.calls.get(e.callId)?.started && !this.calls.get(e.callId)?.ended,
        );
        requireFact(
          detail(e.detailId, "tool-update", e.callId).descriptor.owner.stage ===
            "update-snapshot",
        );
        break;
      case "tool-end": {
        const c = this.calls.get(e.callId);
        requireFact(!c?.ended && e.startObserved === !!c?.started);
        if (e.declaration)
          requireFact(
            c && canonicalJson(c.declaration) === canonicalJson(e.declaration),
          );
        if (c)
          requireFact(
            c.name === e.name &&
              canonicalJson(c.source) === canonicalJson(e.source),
          );
        requireFact(
          detail(e.resultDetailId, "tool-result", e.callId).descriptor.owner
            .stage === "result",
        );
        this.calls.set(e.callId, {
          ...c,
          ...e,
          started: e.startObserved,
          ended: true,
        });
        break;
      }
      case "message-end": {
        const m = message(e.messageId);
        requireFact(!m.ended);
        if (e.finalDetailId) {
          const d = detail(e.finalDetailId, "final-text", e.messageId);
          requireFact(
            m.role === "assistant" &&
              d.descriptor.owner.kind === "message-final",
          );
        }
        for (const d of this.details.values())
          if (d.descriptor.owner.messageId === e.messageId) {
            requireFact(d.ended);
            if (d.descriptor.owner.stage === "final")
              requireFact(d.descriptor.owner.index < e.finalBlockCount);
          }
        requireFact(
          m.finalIndices.size === e.finalBlockCount &&
            [...m.finalIndices].every((i) => i < e.finalBlockCount),
        );
        m.ended = true;
        m.final = e.finalDetailId;
        m.stopReason = e.stopReason;
        break;
      }
      case "omitted-block":
        owner(e.block.owner);
        if (
          e.block.owner.kind === "message" &&
          e.block.owner.stage === "final"
        ) {
          const m = message(e.block.owner.messageId);
          requireFact(!m.finalIndices.has(e.block.owner.index));
          m.finalIndices.add(e.block.owner.index);
        }
        this.mergeCoverage({
          observed: "complete",
          source: "limited",
          redacted: false,
          omissions: [e.block.reason],
        });
        break;
      case "capture-status":
        this.mergeCoverage(e.coverage);
        break;
      case "worker-failure":
        this.failed = true;
        break;
      case "final": {
        if (this.request)
          requireFact(
            [
              "request-context",
              "request-prompt",
              "request-instructions",
              "role",
              "effective-system",
            ].every((name) => this.contexts.has(name)) &&
              this.handoffs.size === this.request.handoff.inputs.length,
          );
        const m = message(e.messageId);
        requireFact(
          !this.failed &&
            m.ended &&
            m.role === "assistant" &&
            m.stopReason === "stop" &&
            m.final === e.detailId &&
            this.coverage.observed === "complete",
        );
        requireFact(
          [...this.details.values()].every((d) => d.ended) &&
            [...this.messages.values()].every((v) => v.ended) &&
            [...this.calls.values()].every((c) => !c.started || c.ended),
        );
        detail(e.detailId, "final-text", e.messageId);
        this.selected = { messageId: e.messageId, detailId: e.detailId };
        break;
      }
    }
    this.position = position;
    return frame;
  }
  mergeCoverage(c) {
    this.coverage.observed =
      c.observed === "incomplete" ? "incomplete" : this.coverage.observed;
    if (c.source !== "complete") this.coverage.source = c.source;
    this.coverage.redacted ||= c.redacted;
    this.coverage.omissions = [
      ...new Set([...this.coverage.omissions, ...c.omissions]),
    ];
  }
  get preview() {
    return this.selected
      ? this.details.get(this.selected.detailId).preview
      : "";
  }
}
/** One worker-owned accounting domain for output, source update copies and
 * sanitizer retention. A reporting timeout never releases a live write lease. */
export class CaptureQueue {
  constructor() {
    this.bytes = 0;
    this.frames = 0;
    this.dataBytes = 0;
    this.dataFrames = 0;
  }
  reserveSource() {
    const bytes = Math.min(
      LIMITS.workerQueueBytes - this.bytes,
      LIMITS.workerQueueBytes - LIMITS.ownerControlBytes - this.dataBytes,
    );
    if (bytes <= 0) throw new ContractError("capacity");
    return { bytes, lease: this.reserve(bytes) };
  }
  reserve(bytes, lane = "data") {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      this.bytes + bytes > LIMITS.workerQueueBytes ||
      this.frames + 1 > LIMITS.workerQueueFrames ||
      (lane === "data" &&
        (this.dataBytes + bytes >
          LIMITS.workerQueueBytes - LIMITS.ownerControlBytes ||
          this.dataFrames + 1 >
            LIMITS.workerQueueFrames - LIMITS.controlFrames))
    )
      throw new ContractError("capacity");
    this.bytes += bytes;
    this.frames++;
    if (lane === "data") {
      this.dataBytes += bytes;
      this.dataFrames++;
    }
    let held = bytes,
      live = true;
    return {
      get bytes() {
        return held;
      },
      grow: (size) => {
        if (
          !live ||
          !Number.isSafeInteger(size) ||
          size < 0 ||
          this.bytes + size > LIMITS.workerQueueBytes ||
          (lane === "data" &&
            this.dataBytes + size >
              LIMITS.workerQueueBytes - LIMITS.ownerControlBytes)
        )
          throw new ContractError("capacity");
        held += size;
        this.bytes += size;
        if (lane === "data") this.dataBytes += size;
      },
      shrink: (size) => {
        if (!live || size < 0 || size > held) throw new ContractError();
        this.bytes -= held - size;
        if (lane === "data") this.dataBytes -= held - size;
        held = size;
      },
      release: () => {
        if (!live) throw new ContractError();
        live = false;
        this.bytes -= held;
        this.frames--;
        if (lane === "data") {
          this.dataBytes -= held;
          this.dataFrames--;
        }
      },
    };
  }
}
/** Callback-backed writes retain their original charge until settlement. */
export class CaptureEmitter {
  constructor(childRunId, output, onFailure, request) {
    this.state = new CaptureState(childRunId, request);
    this.output = output;
    this.onFailure = onFailure;
    this.started = performance.now();
    this.pending = new Set();
    this.queuedBytes = 0;
    this.broken = false;
    this.queue = new CaptureQueue();
  }
  emit(event) {
    const lease = this.queue.reserve(
      LIMITS.frameBytes * 3,
      controlEvent(event.kind) ? "control" : "data",
    );
    let line, bytes;
    try {
      const frame = {
        protocol: 2,
        childRunId: this.state.position.childRunId,
        workerSeq: this.state.position.workerSeq + 1,
        observedMs: Math.floor(performance.now() - this.started),
        event,
      };
      line = `${canonicalJson(frame, LIMITS.frameBytes - 1)}\n`;
      bytes = utf8Bytes(line);
      this.state.accept(frame, bytes);
      lease.shrink(bytes);
      this.queuedBytes += bytes;
    } catch (error) {
      lease.release();
      throw error;
    }
    let timer;
    const original = new Promise((resolve, reject) => {
      this.output.write(line, (error) =>
        error ? reject(new ContractError("unavailable")) : resolve(),
      );
    });
    this.pending.add(original);
    const settled = original.then(
      () => {
        clearTimeout(timer);
        this.queuedBytes -= bytes;
        lease.release();
        this.pending.delete(original);
      },
      () => {
        clearTimeout(timer);
        this.queuedBytes -= bytes;
        lease.release();
        this.pending.delete(original);
        this.broken = true;
        this.onFailure();
      },
    );
    // Reporting timeout never refunds an outstanding original write.
    const wait = Promise.race([
      original,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          this.onFailure();
          reject(new ContractError("recording-exhausted"));
        }, LIMITS.recordingStallMs);
      }),
    ]);
    wait.catch(() => {});
    settled.catch(() => {});
    return wait;
  }
  async drain() {
    await Promise.allSettled([...this.pending]);
  }
}
function source(value, secrets) {
  if (value === undefined || value === null)
    return { disposition: "unavailable", value: null };
  if (typeof value !== "string") throw new ContractError();
  try {
    if (sanitizeText(value, secrets) !== value) throw new ContractError();
    return decodeSourceIdentity({ disposition: "observed", value });
  } catch {
    return { disposition: "redacted", value: null };
  }
}
/** Actual awaited core-agent event adapter. Core emits one message occurrence
 * at a time; concurrent open occurrences refuse, never join by a nearest ID.
 * Tool joins require a unique raw ID AND name among genuine declarations/starts. */
export class SdkCapture {
  constructor(emitter, secrets = []) {
    this.emitter = emitter;
    this.secrets = secrets;
    this.current = null;
    this.calls = [];
    this.selected = null;
    this.events = 0;
    this.updates = new WeakMap();
  }
  emit(e) {
    return this.emitter.emit(e);
  }
  prefix() {
    const literals = this.secrets.reduce((n, value) => n + utf8Bytes(value), 0);
    // Text/known-literal prefix and bounded UTF-8/escaping expansion. Canonical
    // traversal keys and slices acquire their own incremental leases below;
    // a tiny overlapping update must not prepay a hypothetical 1MiB key stack.
    return this.emitter.queue.reserve(literals * 4 + 65536);
  }
  dispose() {
    for (const stream of this.current?.streams.values() ?? [])
      if (stream.lease) {
        stream.lease.release();
        stream.lease = null;
      }
  }
  async detail(descriptor, input, coverage = completeCoverage()) {
    if (
      (typeof input === "string"
        ? Buffer.byteLength(input)
        : Array.isArray(input)
          ? input.reduce((n, s) => n + Buffer.byteLength(s), 0)
          : 0) > LIMITS.detailBytes
    )
      throw new ContractError("oversize");
    const lease = this.prefix(descriptor.encoding);
    try {
      const id = randomUUID();
      await this.emit({ kind: "detail-begin", detailId: id, descriptor });
      let sanitizer = new TextSanitizer(this.secrets);
      let redacted = false;
      let bytes = 0;
      const hash = createHash("sha256");
      const append = async (value) => {
        for (const part of chunks(value)) {
          if (bytes + utf8Bytes(part) > LIMITS.detailBytes)
            throw new ContractError("oversize");
          await this.emit({
            kind: "detail-chunk",
            detailId: id,
            offset: bytes,
            text: part,
          });
          bytes += utf8Bytes(part);
          hash.update(part);
        }
      };
      // Canonical JSON was structurally sanitized before serialization. Re-sanitizing
      // serialized escapes as text would corrupt JSON and miss decoded literals.
      for (const value of typeof input === "string" ? [input] : input) {
        if (typeof value !== "string") throw new ContractError();
        for (const part of chunks(value))
          await append(
            descriptor.encoding === "canonical-json"
              ? part
              : sanitizer.write(part),
          );
        // Final selection concatenates the finalized FIELD projections, not a
        // second cross-field sanitization that can change their hashes/bytes.
        if (descriptor.owner.kind === "message-final") {
          await append(sanitizer.end());
          redacted ||= sanitizer.redacted;
          sanitizer = new TextSanitizer(this.secrets);
        }
      }
      if (descriptor.encoding === "utf8") await append(sanitizer.end());
      coverage = {
        ...coverage,
        redacted: coverage.redacted || sanitizer.redacted || redacted,
      };
      await this.emit({
        kind: "detail-end",
        detailId: id,
        bytes,
        sha256: hash.digest("hex"),
        coverage,
      });
      return id;
    } finally {
      lease.release();
    }
  }
  async openStream(descriptor) {
    // Partial JSON carries bounded incremental lexical state, not a prepaid
    // megabyte for every (often tiny) simultaneously open declaration.
    const lease = this.prefix(descriptor.encoding);
    try {
      const stream = {
        lease,
        id: randomUUID(),
        descriptor,
        sanitizer:
          descriptor.owner.stage === "arguments-partial"
            ? new DetailSanitizer("canonical-json", this.secrets, true)
            : new TextSanitizer(this.secrets),
        bytes: 0,
        hash: createHash("sha256"),
      };
      await this.emit({
        kind: "detail-begin",
        detailId: stream.id,
        descriptor,
      });
      return stream;
    } catch (error) {
      lease.release();
      throw error;
    }
  }
  async streamWrite(stream, value, final = false) {
    if (
      typeof value !== "string" ||
      Buffer.byteLength(value) + stream.bytes > LIMITS.detailBytes
    )
      throw new ContractError("oversize");
    for (const input of final ? [value] : chunks(value)) {
      // Source/expansion charge precedes projection. Transfer any growing
      // lexical retention before releasing this source reservation.
      const sourceLease = this.emitter.queue.reserve(utf8Bytes(input) * 12);
      try {
        const clean = stream.sanitizer.write(input, final);
        const extra = stream.sanitizer.retainedBytes - stream.lease.bytes;
        if (extra > 0) stream.lease.grow(extra);
        for (const part of chunks(clean)) {
          await this.emit({
            kind: "detail-chunk",
            detailId: stream.id,
            offset: stream.bytes,
            text: part,
          });
          stream.bytes += utf8Bytes(part);
          stream.hash.update(part);
        }
      } finally {
        sourceLease.release();
      }
    }
    if (final) {
      try {
        await this.emit({
          kind: "detail-end",
          detailId: stream.id,
          bytes: stream.bytes,
          sha256: stream.hash.digest("hex"),
          coverage: {
            ...completeCoverage(),
            redacted: stream.sanitizer.redacted,
            source: stream.sanitizer.limited ? "limited" : "complete",
            omissions: stream.sanitizer.limited ? ["unsupported"] : [],
          },
        });
      } finally {
        stream.lease.release();
        stream.lease = null;
      }
    }
  }
  async context(request, system) {
    for (const [component, value] of [
      ["request-context", request.context],
      ["request-prompt", request.prompt],
      ["request-instructions", request.instructions],
      ["role", canonicalJson(request.role)],
      ["effective-system", system],
    ])
      await this.detail(
        {
          owner: { kind: "context", component },
          field: "context",
          encoding: "utf8",
        },
        value,
      );
    for (const input of request.handoff.inputs)
      await this.detail(
        {
          owner: {
            kind: "handoff",
            dependencyIndex: input.dependencyIndex,
            source: input.result,
          },
          field: "context",
          encoding: "utf8",
        },
        input.text,
        input.coverage,
      );
  }
  toolOwner(call, stage, index = 0) {
    return {
      kind: "tool",
      callId: call.id,
      blockId: randomUUID(),
      index,
      stage,
    };
  }
  async args(call, value, stage) {
    return this.detail(
      {
        owner: this.toolOwner(call, stage),
        field: "tool-args",
        encoding: "canonical-json",
      },
      sanitizedJsonChunks(value, this.secrets, (bytes) =>
        this.emitter.queue.reserve(bytes),
      ),
      { ...completeCoverage(), redacted: true },
    );
  }
  matches(raw, name, predicate) {
    return this.calls.filter(
      (c) =>
        typeof raw === "string" &&
        raw.length > 0 &&
        c.raw === raw &&
        c.rawName === name &&
        predicate(c),
    );
  }
  newCall(raw, name, declaration = null) {
    if (typeof name !== "string" || !name.trim() || utf8Bytes(name) > 128)
      throw new ContractError();
    const call = {
      id: randomUUID(),
      raw,
      rawName: name,
      name: sanitizeText(name, this.secrets) || "redacted",
      source: source(raw, this.secrets),
      declaration,
      started: false,
      ended: false,
      resultLinked: false,
    };
    this.calls.push(call);
    return call;
  }
  async blocks(message, content, stage) {
    const blocks =
      typeof content === "string"
        ? [{ type: "text", text: content }]
        : ownArray(content);
    const texts = [];
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      const type = own(block, "type");
      const blockId = randomUUID();
      const owner = {
        kind: "message",
        messageId: message.id,
        blockId,
        index,
        stage,
      };
      if (type === "text") {
        const value = own(block, "text");
        if (typeof value !== "string") throw new ContractError();
        const detailId = await this.detail(
          { owner, field: "message", encoding: "utf8" },
          value,
        );
        await this.emit({
          kind: "message-text",
          messageId: message.id,
          blockId,
          detailId,
        });
        texts.push(value);
      } else if (type === "toolCall" && message.role === "assistant") {
        const raw = own(block, "id"),
          name = own(block, "name");
        const partial = message.declarations.get(index);
        const call =
          partial ??
          this.newCall(raw, name, { messageId: message.id, blockId });
        if (partial) {
          if (typeof name !== "string" || !name.trim() || utf8Bytes(name) > 128)
            throw new ContractError();
          call.raw = raw;
          call.rawName = name;
          call.name = sanitizeText(name, this.secrets) || "redacted";
          call.source = source(raw, this.secrets);
        }
        const argsDetailId = await this.args(
          call,
          own(block, "arguments"),
          "arguments-final",
        );
        await this.emit({
          kind: "call-declaration",
          callId: call.id,
          declaration: call.declaration,
          index,
          source: call.source,
          name: call.name,
          argsDetailId,
          stage: "final",
        });
      } else {
        const reason =
          type === "thinking"
            ? "hidden-thinking"
            : ["image", "audio", "binary"].includes(type)
              ? "binary"
              : "unsupported";
        let mimeType =
          reason === "hidden-thinking" ? null : own(block, "mimeType");
        if (
          typeof mimeType !== "string" ||
          !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType) ||
          sanitizeText(mimeType, this.secrets) !== mimeType
        )
          mimeType = null;
        await this.emit({
          kind: "omitted-block",
          block: {
            owner,
            sourceType:
              reason === "hidden-thinking"
                ? reason
                : reason === "unsupported"
                  ? reason
                  : type,
            mimeType: reason === "hidden-thinking" ? null : mimeType,
            reason,
          },
        });
      }
    }
    return { texts, count: blocks.length };
  }
  async toolResult(call, result, stage) {
    // Explicit public content projection; never copy arbitrary details/envelopes.
    const content = ownArray(own(result, "content"));
    const values = [];
    for (let index = 0; index < content.length; index++) {
      const block = content[index];
      const type = own(block, "type");
      if (type === "text")
        values.push({ type: "text", text: own(block, "text") });
      else
        await this.emit({
          kind: "omitted-block",
          block: {
            owner: this.toolOwner(call, stage, index),
            sourceType: type === "thinking" ? "hidden-thinking" : "binary",
            mimeType: null,
            reason: type === "thinking" ? "hidden-thinking" : "binary",
          },
        });
    }
    const details = own(result, "details");
    const limited =
      details &&
      (own(details, "truncation") !== undefined ||
        own(details, "fullOutputPath") !== undefined);
    const coverage = {
      ...completeCoverage(),
      redacted: true,
      source: limited ? "limited" : "complete",
      omissions: limited ? ["source-limit"] : [],
    };
    const detailId = await this.detail(
      {
        owner: this.toolOwner(call, stage),
        field: stage === "result" ? "tool-result" : "tool-update",
        encoding: "canonical-json",
      },
      sanitizedJsonChunks(
        details === undefined
          ? { content: values }
          : { content: values, details },
        this.secrets,
        (bytes) => this.emitter.queue.reserve(bytes),
      ),
      coverage,
    );
    return detailId;
  }
  async event(event) {
    if (++this.events > LIMITS.sdkEvents) throw new ContractError("oversize");
    const type = own(event, "type");
    if (typeof type !== "string") throw new ContractError();
    switch (type) {
      case "message_start": {
        requireFact(this.current === null);
        const message = own(event, "message");
        const rawRole = own(message, "role");
        const role = rawRole === "toolResult" ? "tool-result" : rawRole;
        requireFact(["user", "assistant", "tool-result"].includes(role));
        const matches =
          role === "tool-result"
            ? this.matches(
                own(message, "toolCallId"),
                own(message, "toolName"),
                (c) => c.ended && !c.resultLinked,
              )
            : [];
        const call = matches.length === 1 ? matches[0] : null;
        if (call) call.resultLinked = true;
        this.current = {
          id: randomUUID(),
          role,
          streams: new Map(),
          declarations: new Map(),
        };
        await this.emit({
          kind: "message-start",
          messageId: this.current.id,
          role,
          source: source(own(message, "responseId"), this.secrets),
          resultCallId: call?.id ?? null,
        });
        break;
      }
      case "message_update": {
        const m = this.current;
        requireFact(m?.role === "assistant");
        const update = own(event, "assistantMessageEvent"),
          type = own(update, "type");
        const index = own(update, "contentIndex");
        if (["text_delta", "toolcall_start", "toolcall_delta"].includes(type))
          requireFact(
            Number.isSafeInteger(index) &&
              index >= 0 &&
              index <= LIMITS.dataFrames,
          );
        if (type === "text_delta") {
          let stream = m.streams.get(index);
          if (!stream) {
            const blockId = randomUUID();
            stream = await this.openStream({
              owner: {
                kind: "message",
                messageId: m.id,
                blockId,
                index,
                stage: "stream",
              },
              field: "message",
              encoding: "utf8",
            });
            m.streams.set(index, stream);
            await this.emit({
              kind: "message-text",
              messageId: m.id,
              blockId,
              detailId: stream.id,
            });
          }
          await this.streamWrite(stream, own(update, "delta"));
        } else if (type === "toolcall_start" || type === "toolcall_delta") {
          const partial = own(update, "partial");
          const block = ownArray(own(partial, "content"))[index];
          if (!m.declarations.has(index)) {
            const call = this.newCall(own(block, "id"), own(block, "name"), {
              messageId: m.id,
              blockId: randomUUID(),
            });
            m.declarations.set(index, call);
            await this.emit({
              kind: "call-declaration",
              callId: call.id,
              declaration: call.declaration,
              index,
              source: call.source,
              name: call.name,
              argsDetailId: null,
              stage: "partial",
            });
          }
          if (type === "toolcall_delta") {
            const call = m.declarations.get(index);
            let stream = m.streams.get(`args-${index}`);
            if (!stream) {
              stream = await this.openStream({
                owner: this.toolOwner(call, "arguments-partial", index),
                field: "tool-args",
                encoding: "utf8",
              });
              m.streams.set(`args-${index}`, stream);
            }
            await this.streamWrite(stream, own(update, "delta"));
          }
        }
        break;
      }
      case "message_end": {
        const m = this.current;
        requireFact(m);
        const message = own(event, "message");
        requireFact(
          (own(message, "role") === "toolResult"
            ? "tool-result"
            : own(message, "role")) === m.role,
        );
        for (const stream of m.streams.values())
          await this.streamWrite(stream, "", true);
        const { texts, count } = await this.blocks(
          m,
          own(message, "content"),
          "final",
        );
        const finalDetailId =
          m.role === "assistant"
            ? await this.detail(
                {
                  owner: { kind: "message-final", messageId: m.id },
                  field: "final-text",
                  encoding: "utf8",
                },
                texts,
              )
            : null;
        const reason = own(message, "stopReason");
        const stopReason = [
          "stop",
          "length",
          "toolUse",
          "error",
          "aborted",
        ].includes(reason)
          ? reason
          : "unknown";
        await this.emit({
          kind: "message-end",
          messageId: m.id,
          finalDetailId,
          finalBlockCount: count,
          stopReason,
        });
        if (m.role === "assistant")
          this.selected =
            stopReason === "stop"
              ? { messageId: m.id, detailId: finalDetailId }
              : null;
        this.current = null;
        break;
      }
      case "tool_execution_start": {
        const raw = own(event, "toolCallId"),
          name = own(event, "toolName");
        const matches = this.matches(raw, name, (c) => !c.started && !c.ended);
        const call =
          matches.length === 1 ? matches[0] : this.newCall(raw, name);
        const argsDetailId = await this.args(
          call,
          own(event, "args"),
          "execution-arguments",
        );
        call.started = true;
        await this.emit({
          kind: "tool-start",
          callId: call.id,
          declaration: call.declaration,
          source: call.source,
          name: call.name,
          argsDetailId,
        });
        break;
      }
      case "tool_execution_update": {
        const matches = this.matches(
          own(event, "toolCallId"),
          own(event, "toolName"),
          (c) => c.started && !c.ended,
        );
        requireFact(matches.length === 1);
        const call = matches[0];
        const detailId = await this.toolResult(
          call,
          own(event, "partialResult"),
          "update-snapshot",
        );
        await this.emit({
          kind: "tool-update",
          callId: call.id,
          detailId,
          semantics: "snapshot",
        });
        break;
      }
      case "tool_execution_end": {
        const raw = own(event, "toolCallId"),
          name = own(event, "toolName");
        const matches = this.matches(raw, name, (c) => c.started && !c.ended);
        const call =
          matches.length === 1 ? matches[0] : this.newCall(raw, name);
        const resultDetailId = await this.toolResult(
          call,
          own(event, "result"),
          "result",
        );
        const isError = own(event, "isError");
        requireFact(typeof isError === "boolean");
        call.ended = true;
        await this.emit({
          kind: "tool-end",
          callId: call.id,
          declaration: call.declaration,
          source: call.source,
          name: call.name,
          resultDetailId,
          isError,
          association:
            matches.length === 0
              ? "orphan"
              : matches.length > 1
                ? "ambiguous"
                : call.declaration
                  ? "declared"
                  : "execution-only",
          startObserved: call.started,
        });
        break;
      }
      case "agent_start":
      case "agent_end":
      case "turn_start":
      case "turn_end":
        break;
      default:
        throw new ContractError();
    }
  }
  async final() {
    requireFact(this.selected && !this.current);
    await this.emit({
      kind: "capture-status",
      coverage: this.emitter.state.coverage,
    });
    await this.emit({ kind: "final", ...this.selected, stopReason: "stop" });
  }
}
export function parseCaptureLine(line) {
  return parseWireJson(line, LIMITS.frameBytes);
}
