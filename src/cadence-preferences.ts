/** User-owned model preference, never auth, approval or a reusable source-selection ID. */
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { closed } from "./service/contracts/core.ts";
import { PrivateFiles } from "./service/private-files.ts";
import {
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
  read(): ModelSelector | null {
    const saved = this.files.read(this.path);
    if (!saved) return null;
    const o = closed(parseWireJson(saved.bytes.toString("utf8")), [
      "schema",
      "model",
    ]);
    if (o.schema !== "cadence-preferences/1")
      throw new Error("Unsupported Cadence preferences");
    return decodeModelSelector(o.model);
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
    if (previous && canonicalJson(this.read()) === canonicalJson(selected))
      return;
    const bytes = this.encode(selected);
    if (previous) this.files.replace(this.path, previous, bytes);
    else this.files.create(this.path, bytes);
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
