/** Private, fixed-purpose child input; no command, tool or execution authority. */
import { isAbsolute } from "node:path";
import {
  ContractError,
  canonicalJson,
  closed,
  list,
  literal,
  text,
} from "./contracts/core.ts";

export const PREVIEW_INPUT_BYTES = 1024 * 1024;
/** Includes startup/import time, not renewed by output. */
export const PREVIEW_TIMEOUT_MS = 15_000;
/** Different sources may read concurrently; same-source requests share one original. */
export const PREVIEW_PROCESSES = 2;
export interface ModelPreviewInput {
  kind: "cadence-model-preview/1";
  agentDir: string;
  home: string;
  cwd: string;
  secrets: string[];
}
export function decodeModelPreviewInput(value: unknown): ModelPreviewInput {
  canonicalJson(value, PREVIEW_INPUT_BYTES);
  const o = closed(value, ["kind", "agentDir", "home", "cwd", "secrets"]);
  const path = (v: unknown) => {
    const p = text(v, 4096, true);
    if (!isAbsolute(p)) throw new ContractError("invalid");
    return p;
  };
  return {
    kind: literal(o.kind, "cadence-model-preview/1"),
    agentDir: path(o.agentDir),
    home: path(o.home),
    cwd: path(o.cwd),
    secrets: list(o.secrets, 4096, (v) => text(v, PREVIEW_INPUT_BYTES, true)),
  };
}
