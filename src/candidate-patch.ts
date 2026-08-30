import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateUnifiedPatch } from "@earendil-works/pi-coding-agent";

import { isValidRelativePath } from "./contracts.ts";
import { observeSafePath } from "./safe-path.ts";

export type CandidatePatchOperation =
  | {
      kind: "replace";
      path: string;
      oldText: string;
      newText: string;
    }
  | { kind: "rewrite"; path: string; content: string }
  | {
      kind: "create";
      path: string;
      content: string;
      mode: "regular" | "executable";
    }
  | { kind: "delete"; path: string };

interface CandidateFileState {
  path: string;
  base: string | null;
  current: string | null;
  mode: "100644" | "100755";
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    [...expected].sort().every((key, index) => actual[index] === key)
  );
}

function safeText(value: unknown, maxBytes: number): value is string {
  if (typeof value !== "string" || value.includes("\0")) return false;
  const encoded = Buffer.from(value, "utf8");
  return encoded.byteLength <= maxBytes && encoded.toString("utf8") === value;
}

function renderFileDiff(state: CandidateFileState): string {
  if (state.base === state.current) return "";
  if (state.base === null && state.current === "") {
    throw new Error("candidate-empty-file-create-unsupported");
  }
  if (state.current === null && state.base === "") {
    throw new Error("candidate-empty-file-delete-unsupported");
  }
  const output: string[] = [`diff --git a/${state.path} b/${state.path}`];
  if (state.base === null) output.push(`new file mode ${state.mode}`);
  if (state.current === null) output.push(`deleted file mode ${state.mode}`);
  const generated = generateUnifiedPatch(
    state.path,
    state.base ?? "",
    state.current ?? "",
    3,
  );
  const generatedHeaders = `--- ${state.path}\n+++ ${state.path}\n`;
  if (!generated.startsWith(generatedHeaders)) {
    throw new Error("candidate-patch-diff-invalid");
  }
  output.push(state.base === null ? "--- /dev/null" : `--- a/${state.path}`);
  output.push(state.current === null ? "+++ /dev/null" : `+++ b/${state.path}`);
  return `${output.join("\n")}\n${generated.slice(generatedHeaders.length)}`;
}

function occurrenceCount(value: string, search: string): number {
  let count = 0;
  let offset = 0;
  for (;;) {
    const found = value.indexOf(search, offset);
    if (found < 0) return count;
    count += 1;
    if (count > 1) return count;
    offset = found + 1;
  }
}

export function compileCandidatePatch(input: {
  root: string;
  writePaths: readonly string[];
  deletePaths: readonly string[];
  operations: readonly CandidatePatchOperation[];
  maxBytes: number;
}): string {
  if (
    !path.isAbsolute(input.root) ||
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes < 1 ||
    !Array.isArray(input.operations) ||
    input.operations.length < 1 ||
    input.operations.length > 128
  ) {
    throw new Error("candidate-patch-invalid");
  }
  const writePaths = new Set(input.writePaths);
  const deletePaths = new Set(input.deletePaths);
  const states = new Map<string, CandidateFileState>();

  const requirePath = (relative: unknown): string => {
    if (
      !isValidRelativePath(relative) ||
      relative === "." ||
      relative.trim() !== relative ||
      /[\r\n\t]/u.test(relative)
    ) {
      throw new Error("candidate-patch-path-invalid");
    }
    return relative;
  };
  const load = (relative: string): CandidateFileState => {
    const existing = states.get(relative);
    if (existing) return existing;
    const observation = observeSafePath(input.root, relative);
    if (observation.kind === "directory" || observation.kind === "unsafe") {
      throw new Error("candidate-patch-path-unsafe");
    }
    let base: string | null = null;
    let mode: CandidateFileState["mode"] = "100644";
    if (observation.kind === "file") {
      const target = path.join(input.root, relative);
      const stat = lstatSync(target);
      if (stat.size > input.maxBytes) {
        throw new Error("candidate-patch-source-too-large");
      }
      const bytes = readFileSync(target);
      try {
        base = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
      } catch {
        throw new Error("candidate-patch-source-invalid");
      }
      if (base.includes("\0")) {
        throw new Error("candidate-patch-source-invalid");
      }
      mode = stat.mode & 0o111 ? "100755" : "100644";
    }
    const state = { path: relative, base, current: base, mode };
    states.set(relative, state);
    return state;
  };

  for (const operation of input.operations) {
    if (
      !operation ||
      typeof operation !== "object" ||
      Array.isArray(operation)
    ) {
      throw new Error("candidate-patch-operation-invalid");
    }
    switch (operation.kind) {
      case "replace": {
        if (
          !exactKeys(operation, ["kind", "path", "oldText", "newText"]) ||
          !safeText(operation.oldText, input.maxBytes) ||
          operation.oldText.length === 0 ||
          !safeText(operation.newText, input.maxBytes)
        ) {
          throw new Error("candidate-patch-replace-invalid");
        }
        const relative = requirePath(operation.path);
        if (!writePaths.has(relative)) {
          throw new Error("candidate-patch-replace-invalid");
        }
        const state = load(relative);
        if (
          state.current === null ||
          occurrenceCount(state.current, operation.oldText) !== 1
        ) {
          throw new Error("candidate-patch-replace-invalid");
        }
        state.current = state.current.replace(
          operation.oldText,
          operation.newText,
        );
        break;
      }
      case "rewrite": {
        if (
          !exactKeys(operation, ["kind", "path", "content"]) ||
          !safeText(operation.content, input.maxBytes)
        ) {
          throw new Error("candidate-patch-rewrite-invalid");
        }
        const relative = requirePath(operation.path);
        if (!writePaths.has(relative)) {
          throw new Error("candidate-patch-rewrite-invalid");
        }
        const state = load(relative);
        if (state.current === null) {
          throw new Error("candidate-patch-rewrite-invalid");
        }
        state.current = operation.content;
        break;
      }
      case "create": {
        if (
          !exactKeys(operation, ["kind", "path", "content", "mode"]) ||
          !safeText(operation.content, input.maxBytes) ||
          operation.content.length === 0 ||
          (operation.mode !== "regular" && operation.mode !== "executable")
        ) {
          throw new Error("candidate-patch-create-invalid");
        }
        const relative = requirePath(operation.path);
        if (!writePaths.has(relative)) {
          throw new Error("candidate-patch-create-invalid");
        }
        const state = load(relative);
        if (state.base !== null || state.current !== null) {
          throw new Error("candidate-patch-create-invalid");
        }
        state.current = operation.content;
        state.mode = operation.mode === "executable" ? "100755" : "100644";
        break;
      }
      case "delete": {
        if (!exactKeys(operation, ["kind", "path"])) {
          throw new Error("candidate-patch-delete-invalid");
        }
        const relative = requirePath(operation.path);
        if (!deletePaths.has(relative)) {
          throw new Error("candidate-patch-delete-invalid");
        }
        const state = load(relative);
        if (state.base === null || state.current === null) {
          throw new Error("candidate-patch-delete-invalid");
        }
        state.current = null;
        break;
      }
      default:
        throw new Error("candidate-patch-operation-invalid");
    }
  }

  const diff = [...states.values()]
    .filter((state) => state.base !== state.current)
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(renderFileDiff)
    .join("");
  if (diff.length === 0) throw new Error("candidate-patch-empty");
  return diff;
}
