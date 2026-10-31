/** User-owned model preference, never auth, approval or a reusable source-selection ID. */
import { join } from "node:path";
import { closed } from "./service/contracts/core.ts";
import { PrivateFiles } from "./service/private-files.ts";
import {
  canonicalJson,
  decodeModelSelector,
  type ModelSelector,
  parseWireJson,
} from "./service-contract.ts";

export class CadencePreferences {
  readonly path: string;
  private readonly files: PrivateFiles;
  constructor(agentDir: string) {
    this.path = join(agentDir, "cadence", "settings.json");
    this.files = new PrivateFiles(agentDir, false);
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
  save(model: ModelSelector): void {
    const selected = decodeModelSelector(model);
    const previous = this.files.read(this.path);
    // Validate an existing user file, including its schema, before replacing it.
    if (previous && canonicalJson(this.read()) === canonicalJson(selected))
      return;
    const bytes = canonicalJson({
      schema: "cadence-preferences/1",
      model: selected,
    });
    if (previous) this.files.replace(this.path, previous, bytes);
    else this.files.create(this.path, bytes);
  }
}
