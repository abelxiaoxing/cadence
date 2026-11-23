/** User-owned model preference, never auth, approval or a reusable source-selection ID. */
import { randomUUID } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { closed } from "./service/contracts/core.ts";
import {
  type FileSnapshot,
  hash,
  METADATA_BYTES,
  PrivateFiles,
  refused,
} from "./service/private-files.ts";
import {
  ContractError,
  canonicalJson,
  decodeModelSelector,
  type ModelSelector,
  parseWireJson,
} from "./service-contract.ts";

/** Pi follows links in its agent directory (dotfile setups link `~/.pi` or
 * `~/.pi/agent`). Resolve the existing part of that directory as Pi does,
 * then keep the no-follow private walk below it: a linked `cadence` directory
 * or `settings.json`, another owner's directory or a hard link stay refused. */
function agentNamespace(agentDir: string): string {
  let at = resolve(agentDir);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(at), ...missing.reverse());
    } catch {
      const parent = dirname(at);
      if (parent === at) return resolve(agentDir);
      missing.push(basename(at));
      at = parent;
    }
  }
}

export class CadencePreferences {
  readonly path: string;
  private readonly files: PrivateFiles;
  constructor(agentDir: string) {
    const namespace = agentNamespace(agentDir);
    this.path = join(namespace, "cadence", "settings.json");
    this.files = new PrivateFiles(namespace, false);
  }
  snapshot(): FileSnapshot | undefined {
    return this.files.read(this.path);
  }
  private decode(saved: FileSnapshot): ModelSelector {
    const o = closed(parseWireJson(saved.bytes.toString("utf8")), [
      "schema",
      "model",
    ]);
    if (o.schema !== "cadence-preferences/1")
      throw new Error("Unsupported Cadence preferences");
    return decodeModelSelector(o.model);
  }
  read(): ModelSelector | null {
    const saved = this.files.read(this.path);
    if (!saved) return null;
    return this.decode(saved);
  }
  private encode(model: ModelSelector): string {
    return canonicalJson({
      schema: "cadence-preferences/1",
      model: decodeModelSelector(model),
    });
  }
  /** Implicit remembering: validate an existing user file, including its
   * schema, before replacing it; never silently replace an unreadable one. */
  save(model: ModelSelector): void {
    const selected = decodeModelSelector(model);
    const previous = this.files.read(this.path);
    if (
      previous &&
      canonicalJson(this.decode(previous)) === canonicalJson(selected)
    )
      return;
    const bytes = this.encode(selected);
    if (previous) this.files.replace(this.path, previous, bytes);
    else this.files.create(this.path, bytes);
  }
  /** Non-blocking best-effort remembering for live service model switches:
   * keeps the exact same safety/schema guards while offloading fsync off the
   * event loop so chooseModel replies return immediately. */
  async saveAsync(model: ModelSelector): Promise<void> {
    if (process.platform === "win32") {
      this.save(model);
      return;
    }
    const selected = decodeModelSelector(model);
    const previous = this.files.read(this.path);
    if (
      previous &&
      canonicalJson(this.decode(previous)) === canonicalJson(selected)
    )
      return;
    const bytes = this.encode(selected);
    if (Buffer.byteLength(bytes) > METADATA_BYTES)
      throw new ContractError("oversize");
    const dir = dirname(this.path);
    this.files.directory(dir, true);
    const target = previous
      ? join(dir, `pending-${randomUUID()}.json`)
      : this.path;
    const fh = await open(target, "wx", 0o600);
    try {
      await fh.writeFile(bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (previous) {
      this.files.assert(this.path, previous);
      await rename(target, this.path);
    }
    const dirHandle = await open(
      dir,
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
    const result = this.files.read(this.path);
    if (!result || result.identity !== hash(bytes)) refused();
  }
  /** An explicit user model selection. It atomically replaces a regular file
   * whose contents are corrupt or unsupported, since the user just chose the
   * replacement; unsafe targets such as links are still refused. */
  choose(model: ModelSelector): void {
    const bytes = this.encode(model);
    const previous = this.files.read(this.path);
    if (previous?.bytes.toString("utf8") === bytes) return;
    if (previous) this.files.replace(this.path, previous, bytes);
    else this.files.create(this.path, bytes);
  }
}
