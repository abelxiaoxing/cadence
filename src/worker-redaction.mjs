import {
  ContractError,
  canonicalJson,
  LIMITS,
  utf8Bytes,
} from "./worker-public.mjs";

const marker = "[redacted]";
const sensitive =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token|credentials|headers|env)$/i;
/** Own data only. Deliberately never reads a getter, toJSON, exception or prototype method. */
export function own(value, name) {
  if (!value || typeof value !== "object") throw new ContractError();
  const d = Object.getOwnPropertyDescriptor(value, name);
  if (!d) return undefined;
  if (!("value" in d)) throw new ContractError();
  return d.value;
}
export function ownArray(value, maximum = LIMITS.dataFrames) {
  if (!Array.isArray(value)) throw new ContractError();
  const length = own(value, "length");
  if (!Number.isSafeInteger(length) || length > maximum)
    throw new ContractError("oversize");
  return Array.from({ length }, (_, index) => own(value, String(index)));
}
function sourceBytes(value) {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else if (code >= 0xd800 && code <= 0xdfff) throw new ContractError();
    else bytes += 3;
  }
  return bytes;
}
/** Charge before cloning. Used at synchronous source ingress as well as public tool values. */
export function measureData(value, maximum = LIMITS.workerQueueBytes) {
  let bytes = 0;
  let nodes = 0;
  const seen = new Set();
  function visit(v, depth) {
    if (++nodes > LIMITS.dataFrames || depth > 64)
      throw new ContractError("oversize");
    if (typeof v === "string") bytes += sourceBytes(v) * 6 + 2;
    else if (v === null || typeof v === "boolean") bytes += 5;
    else if (typeof v === "number" && Number.isFinite(v)) bytes += 32;
    else if (v && typeof v === "object") {
      if (
        seen.has(v) ||
        ![Object.prototype, Array.prototype, null].includes(
          Object.getPrototypeOf(v),
        )
      )
        throw new ContractError();
      seen.add(v);
      bytes += 2;
      const names = Reflect.ownKeys(v);
      if (names.length > LIMITS.dataFrames) throw new ContractError("oversize");
      for (const key of names) {
        if (Array.isArray(v) && key === "length") continue;
        if (typeof key !== "string") throw new ContractError();
        bytes += sourceBytes(key) * 6 + 4;
        visit(own(v, key), depth + 1);
      }
      seen.delete(v);
    } else throw new ContractError();
    if (bytes > maximum) throw new ContractError("oversize");
  }
  visit(value, 0);
  return bytes;
}

/** Streaming text sanitizer: literal prefixes, ANSI sequences and heuristic value
 * states survive chunk boundaries. No truncation-to-success; bounded ambiguous
 * URL authorities refuse. This is not universal business-secret detection. */
export class TextSanitizer {
  constructor(secrets = []) {
    if (
      secrets.some((s) => typeof s !== "string") ||
      secrets.reduce((n, s) => n + utf8Bytes(s), 0) >
        LIMITS.workerRequestBytes * 2
    )
      throw new ContractError("oversize");
    this.secrets = [];
    this.addSecrets(secrets);
    this.pending = "";
    this.heuristic = "";
    this.escape = "";
    this.skipping = false;
    this.redacted = false;
    this.ended = false;
  }
  /** Owner-only updates. Preserve all stream state and prior literals; bound the
   * union before retaining any new entries. Never evict a retired secret. */
  addSecrets(secrets) {
    if (this.ended || !Array.isArray(secrets)) throw new ContractError();
    let incoming = 0;
    for (const s of secrets) {
      if (typeof s !== "string") throw new ContractError();
      incoming += utf8Bytes(s);
      if (incoming > LIMITS.workerRequestBytes * 2)
        throw new ContractError("oversize");
    }
    let bytes = this.secrets.reduce((n, s) => n + utf8Bytes(s), 0);
    const added = new Set();
    for (const s of secrets) {
      if (!s || this.secrets.includes(s) || added.has(s)) continue;
      bytes += utf8Bytes(s);
      if (bytes > LIMITS.workerRequestBytes * 2)
        throw new ContractError("oversize");
      added.add(s);
    }
    this.secrets = this.secrets
      .concat([...added])
      .sort((a, b) => b.length - a.length);
  }
  get retainedBytes() {
    return utf8Bytes(this.pending + this.heuristic + this.escape);
  }
  write(input, final = false) {
    if (this.ended || typeof input !== "string") throw new ContractError();
    let plain = "";
    for (const ch of input) {
      if (this.escape) {
        this.escape += ch;
        if (this.escape.length > 8192) throw new ContractError("oversize");
        if (
          (this.escape.startsWith("\x1b[") &&
            this.escape.length > 2 &&
            /[@-~]/.test(ch)) ||
          (this.escape.startsWith("\x1b]") &&
            (ch === "\x07" || this.escape.endsWith("\x1b\\"))) ||
          (this.escape.length === 2 && !"[]".includes(ch))
        )
          this.escape = "";
        this.redacted = true;
      } else if (ch === "\x1b") this.escape = ch;
      else if (
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strip terminal controls before literal matching
        /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(ch)
      )
        this.redacted = true;
      else plain += ch;
    }
    this.pending += plain;
    let literal = "";
    let at = 0;
    while (at < this.pending.length) {
      const rest = this.pending.slice(at);
      // A longer literal prefix takes precedence over a shorter full match.
      if (
        !final &&
        this.secrets.some((s) => s.length > rest.length && s.startsWith(rest))
      )
        break;
      const match = this.secrets.find((s) => rest.startsWith(s));
      if (match) {
        literal += marker;
        at += match.length;
        this.redacted = true;
      } else {
        const code = this.pending.charCodeAt(at);
        if (
          !final &&
          at + 1 === this.pending.length &&
          code >= 0xd800 &&
          code <= 0xdbff
        )
          break;
        const cp = this.pending.codePointAt(at);
        if (cp >= 0xd800 && cp <= 0xdfff) throw new ContractError();
        literal += String.fromCodePoint(cp);
        at += cp > 0xffff ? 2 : 1;
      }
    }
    this.pending = this.pending.slice(at);
    this.heuristic += literal;
    let output = "";
    while (this.heuristic) {
      if (this.skipping) {
        const end = this.heuristic.search(/[\s,;"'<>]/);
        if (end < 0) {
          this.heuristic = "";
          break;
        }
        this.heuristic = this.heuristic.slice(end);
        this.skipping = false;
      }
      const match =
        /\b(?:Bearer\s+|(?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|passwd|secret|token|authorization)\s*[:=]\s*)/i.exec(
          this.heuristic,
        );
      const url = /https?:\/\//i.exec(this.heuristic);
      if (url && (!match || url.index < match.index)) {
        output += this.heuristic.slice(0, url.index);
        this.heuristic = this.heuristic.slice(url.index);
        const start = url[0].length;
        const end = this.heuristic.slice(start).search(/[/\s?#"'<>]/);
        if (end < 0 && !final) {
          if (utf8Bytes(this.heuristic) > 8192)
            throw new ContractError("oversize");
          break;
        }
        const size = end < 0 ? this.heuristic.length : start + end;
        const authority = this.heuristic.slice(start, size);
        const pos = authority.lastIndexOf("@");
        output +=
          this.heuristic.slice(0, start) +
          (pos < 0 ? authority : `${marker}@${authority.slice(pos + 1)}`);
        this.redacted ||= pos >= 0;
        this.heuristic = this.heuristic.slice(size);
      } else if (match) {
        output += this.heuristic.slice(0, match.index) + match[0] + marker;
        this.heuristic = this.heuristic.slice(match.index + match[0].length);
        this.skipping = true;
        this.redacted = true;
      } else {
        // Finite heuristic names plus delimiters. Potentially unbounded whitespace
        // after a candidate is held/refused, never released as an exposed value.
        const candidate =
          /(?:Bearer|api[-_]?key|access[-_]?token|refresh[-_]?token|password|passwd|secret|token|authorization)\s*$/i.exec(
            this.heuristic,
          );
        const keep = final
          ? 0
          : Math.max(
              64,
              candidate ? this.heuristic.length - candidate.index : 0,
            );
        if (keep > 8192) throw new ContractError("oversize");
        let take = Math.max(0, this.heuristic.length - keep);
        // The held heuristic suffix is measured in JS code units, but each
        // emitted field/chunk must remain scalar UTF-8. Retain the whole pair
        // when the suffix boundary would bisect a supplementary character.
        const before = this.heuristic.charCodeAt(take - 1);
        if (before >= 0xd800 && before <= 0xdbff) take--;
        output += this.heuristic.slice(0, take);
        this.heuristic = this.heuristic.slice(take);
        break;
      }
    }
    if (final) {
      this.ended = true;
      this.escape = "";
    }
    return output;
  }
  end() {
    return this.write("", true);
  }
}
export function sanitizeText(value, secrets = []) {
  const sanitizer = new TextSanitizer(secrets);
  return sanitizer.write(value, true);
}
/** Bounded own-data structural projection. Sensitive fields are never traversed.
 * Only tool ordinary data may enter here; SDK/provider envelopes must be selected
 * by the capture adapter instead of passed wholesale. */
export function sanitizeData(value, secrets = []) {
  measureData(value);
  function visit(v) {
    if (typeof v === "string") return sanitizeText(v, secrets);
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return ownArray(v).map(visit);
    const result = Object.create(null);
    for (const key of Object.keys(v).sort()) {
      const safeKey = sanitizeText(key, secrets);
      if (Object.hasOwn(result, safeKey)) throw new ContractError();
      result[safeKey] = sensitive.test(key) ? marker : visit(own(v, key));
    }
    return result;
  }
  return canonicalJson(visit(value), LIMITS.workerQueueBytes);
}

/** Streaming JSON projection. Escapes are decoded before literal matching,
 * sensitive values (including subtrees) are replaced without buffering them.
 * Partial mode is only for genuinely unfinished SDK argument declarations. */
export class DetailSanitizer {
  constructor(encoding, secrets = [], partial = false) {
    this.encoding = encoding;
    this.secrets = secrets;
    this.partial = partial;
    this.limited = false;
    this.text = new TextSanitizer(secrets);
    this.stack = [];
    this.root = "value";
    this.inString = false;
    this.escape = "";
    this.key = "";
    this.keyMode = false;
    this.suppressed = false;
    this.token = "";
    this.redacted = false;
  }
  get retainedBytes() {
    return (
      this.text.retainedBytes +
      utf8Bytes(this.escape + this.key + this.token) +
      this.stack.reduce(
        (sum, entry) =>
          sum +
          utf8Bytes(entry.lastKey ?? "") +
          utf8Bytes(entry.lastOutputKey ?? ""),
        0,
      )
    );
  }
  write(input, final = false) {
    if (this.limited) return "";
    try {
      return this.project(input, final);
    } catch (error) {
      if (
        !this.partial ||
        (error instanceof ContractError && error.code === "oversize")
      )
        throw error;
      // Malformed partial argument syntax is an observation, not executable
      // canonical JSON. Preserve the safe prefix and explicitly omit the
      // undecodable suffix; never guess a key/value boundary or leak escapes.
      this.limited = true;
      this.redacted = true;
      return "[redacted: unsupported partial arguments]";
    }
  }
  project(input, final = false) {
    if (this.encoding === "utf8") {
      const output = this.text.write(input, final);
      this.redacted = this.text.redacted;
      return output;
    }
    let output = "";
    const encoded = (s) => JSON.stringify(s).slice(1, -1);
    const top = () => this.stack.at(-1);
    const done = () => {
      if (top()) {
        top().expect = "comma";
        top().sensitive = false;
        top().count++;
      } else this.root = "done";
    };
    const begin = () => {
      const parent = top();
      if ((parent?.expect ?? this.root) !== "value") throw new ContractError();
      const hide = !!parent?.hide || !!parent?.sensitive;
      if (parent?.sensitive && !parent.hide) {
        output += JSON.stringify(marker);
        this.redacted = true;
      }
      return hide;
    };
    const primitive = () => {
      if (
        !/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$/.test(
          this.token,
        )
      ) {
        if (!this.partial) throw new ContractError();
        // An invalid unquoted token may contain escaped secrets outside JSON
        // strings. Do not pretend it is ordinary final data or decode guesses.
        if (!this.suppressed) output += marker;
        this.redacted = true;
        this.limited = true;
        this.token = "";
        done();
        return;
      }
      const value = JSON.parse(this.token);
      if (typeof value === "number" && !Number.isFinite(value))
        throw new ContractError();
      if (!this.suppressed) output += this.token;
      this.token = "";
      done();
    };
    for (const ch of input) {
      if (this.inString) {
        let decoded = ch;
        if (this.escape) {
          this.escape += ch;
          if (
            this.escape === "\\u" ||
            (this.escape.startsWith("\\u") && this.escape.length < 6)
          )
            continue;
          decoded = JSON.parse(`"${this.escape}"`);
          this.escape = "";
        } else if (ch === "\\") {
          this.escape = ch;
          continue;
        } else if (ch === '"') {
          if (this.keyMode) {
            const parent = top();
            if (
              !this.partial &&
              parent.lastKey !== undefined &&
              this.key <= parent.lastKey
            )
              throw new ContractError();
            parent.lastKey = this.key;
            parent.sensitive = sensitive.test(this.key);
            parent.expect = "colon";
            if (!parent.hide) {
              const safeKey = sanitizeText(this.key, this.secrets);
              if (
                !this.partial &&
                parent.lastOutputKey !== undefined &&
                safeKey <= parent.lastOutputKey
              )
                throw new ContractError();
              parent.lastOutputKey = safeKey;
              this.redacted ||= safeKey !== this.key;
              output += JSON.stringify(safeKey);
            }
            this.key = "";
          } else {
            if (!this.suppressed) output += `${encoded(this.text.end())}"`;
            this.redacted ||= this.text.redacted;
            done();
          }
          this.inString = false;
          continue;
        }
        if (this.keyMode) {
          this.key += decoded;
          if (utf8Bytes(this.key) > 8192) throw new ContractError("oversize");
        } else if (!this.suppressed)
          output += encoded(this.text.write(decoded));
        continue;
      }
      if (this.token && /[\s,\]}]/.test(ch)) primitive();
      if (this.token) {
        this.token += ch;
        if (this.token.length > 128) throw new ContractError("oversize");
        continue;
      }
      if (/\s/.test(ch)) continue;
      const parent = top();
      if (ch === '"') {
        this.keyMode = parent?.kind === "object" && parent.expect === "key";
        this.suppressed = this.keyMode ? parent.hide : begin();
        this.inString = true;
        this.text = new TextSanitizer(this.secrets);
        if (!this.keyMode && !this.suppressed) output += '"';
      } else if (ch === "{" || ch === "[") {
        const hide = begin();
        if (!hide) output += ch;
        if (this.stack.length >= 64) throw new ContractError("oversize");
        this.stack.push({
          kind: ch === "{" ? "object" : "array",
          expect: ch === "{" ? "key" : "value",
          hide,
          sensitive: false,
          count: 0,
          lastKey: undefined,
          lastOutputKey: undefined,
        });
      } else if (ch === "}" || ch === "]") {
        if (!parent || (ch === "}") !== (parent.kind === "object"))
          throw new ContractError();
        if (
          parent.expect !== "comma" &&
          !(
            parent.count === 0 &&
            parent.expect === (parent.kind === "object" ? "key" : "value")
          )
        )
          throw new ContractError();
        if (!parent.hide) output += ch;
        this.stack.pop();
        done();
      } else if (ch === ":") {
        if (parent?.expect !== "colon") throw new ContractError();
        parent.expect = "value";
        if (!parent.hide) output += ch;
      } else if (ch === ",") {
        if (parent?.expect !== "comma") throw new ContractError();
        parent.expect = parent.kind === "object" ? "key" : "value";
        parent.count = Math.max(1, parent.count);
        if (!parent.hide) output += ch;
      } else {
        this.suppressed = begin();
        this.token = ch;
      }
    }
    if (final) {
      if (this.token) primitive();
      if (this.partial) {
        // This field is UTF-8 partial source, not canonical final arguments.
        // Retain unfinished strings/keys without manufacturing closing syntax.
        if (this.inString && !this.suppressed) {
          output += this.keyMode
            ? JSON.stringify(sanitizeText(this.key, this.secrets)).slice(0, -1)
            : encoded(this.text.end());
        }
        if (this.escape) {
          output += marker;
          this.redacted = true;
          this.limited = true;
        }
      } else if (
        this.inString ||
        this.escape ||
        this.stack.length ||
        this.root !== "done"
      )
        throw new ContractError();
      this.redacted ||= this.text.redacted;
    }
    return output;
  }
  end() {
    return this.write("", true);
  }
}

/** Canonical ordinary JSON without materializing a whole large tool body.
 * The caller holds the TextSanitizer prefix/expansion allowance. Traversal tables,
 * sanitized keys and source/output slices are charged BEFORE copying, and held
 * across each yield (including the consumer's original awaited writes). Iterator
 * close releases only these no-longer-used copies, never an emitter write lease. */
export function* sanitizedJsonChunks(value, secrets, reserve) {
  measureData(value, LIMITS.detailBytes * 8);
  function* visit(v) {
    if (typeof v === "string") {
      yield '"';
      const sanitizer = new TextSanitizer(secrets);
      for (let at = 0; at < v.length; at += 1024) {
        // At most three UTF-8 bytes per UTF-16 unit, with conservative literal
        // replacement/JSON escaping expansion. Reserve before slice/projection.
        const slice = reserve(Math.min(1024, v.length - at) * 36 + 64);
        try {
          const clean = sanitizer.write(v.slice(at, at + 1024));
          yield JSON.stringify(clean).slice(1, -1);
        } finally {
          slice.release();
        }
      }
      // Remaining known-literal/heuristic prefixes and their expansion remain
      // covered by the caller's prefix lease until this final yield settles.
      yield JSON.stringify(sanitizer.end()).slice(1, -1);
      yield '"';
    } else if (v === null || typeof v !== "object") yield JSON.stringify(v);
    else if (Array.isArray(v)) {
      yield "[";
      const length = own(v, "length");
      for (let index = 0; index < length; index++) {
        if (index) yield ",";
        yield* visit(own(v, String(index)));
      }
      yield "]";
    } else {
      const table = reserve(64);
      let previous;
      try {
        // No Object.keys/sort copy before reservation. These are validated own
        // data objects; key references and their UTF-16 storage are conservative
        // traversal charges, not a claim about all SDK/V8 memory.
        const keys = [];
        for (const key in v) {
          if (!Object.hasOwn(v, key)) continue;
          const bytes = sourceBytes(key);
          // Same completed-key bound as the owner/partial lexical projection.
          if (bytes > 8192) throw new ContractError("oversize");
          table.grow(bytes * 2 + 16);
          keys.push(key);
        }
        keys.sort();
        yield "{";
        let lastKey;
        for (let index = 0; index < keys.length; index++) {
          const key = keys[index];
          // Whole-key sanitization, escaped output and retained comparison key.
          // Keep the old comparison lease until the replacement is allocated.
          const current = reserve(sourceBytes(key) * 24 + 64);
          try {
            const safe = sanitizeText(key, secrets);
            if (lastKey !== undefined && safe <= lastKey)
              throw new ContractError();
            lastKey = safe;
            previous?.release();
            previous = current;
            if (index) yield ",";
            yield `${JSON.stringify(safe)}:`;
            if (sensitive.test(key)) yield JSON.stringify(marker);
            else yield* visit(own(v, key));
          } finally {
            if (previous !== current) current.release();
          }
        }
        yield "}";
      } finally {
        previous?.release();
        table.release();
      }
    }
  }
  yield* visit(value);
}
