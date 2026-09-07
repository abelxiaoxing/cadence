import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compileCandidatePatch } from "../src/candidate-patch.ts";
import { diffWritePaths } from "../src/contracts.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `cadence-patch-${label}-`));
  roots.push(root);
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src/value.ts"), "export const value = 1;\n");
  writeFileSync(path.join(root, "obsolete.txt"), "remove me\n");
  return root;
}

describe("trusted candidate patch compilation", () => {
  it.each([
    ["missing", "absent", "old-text-not-found"],
    ["ambiguous", "same", "old-text-ambiguous"],
  ])(
    "provides actionable bounded replacement diagnostics: %s",
    (_label, oldText, reason) => {
      const root = workspace("diagnostics");
      writeFileSync(
        path.join(root, "src/value.ts"),
        "same same PRIVATE SOURCE\n",
      );
      let message = "";
      try {
        compileCandidatePatch({
          root,
          writePaths: ["src/value.ts"],
          deletePaths: [],
          maxBytes: 1024,
          operations: [
            {
              kind: "replace",
              path: "src/value.ts",
              oldText,
              newText: "PRIVATE REPLACEMENT",
            },
          ],
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(reason);
      expect(message).toContain('"operationIndex":0');
      expect(message).toContain('"path":"src/value.ts"');
      expect(message).not.toMatch(/PRIVATE|cadence-patch-/u);
    },
  );

  it("generates one applicable diff from exact replace, create, and delete operations", () => {
    const root = workspace("applicable");
    const diff = compileCandidatePatch({
      root,
      writePaths: ["src/value.ts", "bin/check.sh"],
      deletePaths: ["obsolete.txt"],
      operations: [
        {
          kind: "replace",
          path: "src/value.ts",
          oldText: "value = 1",
          newText: "value = 2",
        },
        {
          kind: "create",
          path: "bin/check.sh",
          content: "#!/bin/sh\necho checked\n",
          mode: "executable",
        },
        { kind: "delete", path: "obsolete.txt" },
      ],
      maxBytes: 1024 * 1024,
    });

    expect(diffWritePaths(diff).paths).toEqual([
      "bin/check.sh",
      "obsolete.txt",
      "src/value.ts",
    ]);
    execFileSync("git", ["apply", "--check", "-"], { cwd: root, input: diff });
    execFileSync("git", ["apply", "-"], { cwd: root, input: diff });
    expect(readFileSync(path.join(root, "src/value.ts"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(readFileSync(path.join(root, "bin/check.sh"), "utf8")).toBe(
      "#!/bin/sh\necho checked\n",
    );
    expect(statSync(path.join(root, "bin/check.sh")).mode & 0o111).not.toBe(0);
    expect(existsSync(path.join(root, "obsolete.txt"))).toBe(false);
  });

  it("rejects ambiguous replacements and paths outside the approved operation set", () => {
    const root = workspace("boundary");
    writeFileSync(path.join(root, "src/value.ts"), "same same\n");
    expect(() =>
      compileCandidatePatch({
        root,
        writePaths: ["src/value.ts"],
        deletePaths: [],
        operations: [
          {
            kind: "replace",
            path: "src/value.ts",
            oldText: "same",
            newText: "changed",
          },
        ],
        maxBytes: 1024 * 1024,
      }),
    ).toThrow(/candidate-patch-replace-invalid/u);
    expect(() =>
      compileCandidatePatch({
        root,
        writePaths: ["src/value.ts"],
        deletePaths: [],
        operations: [
          {
            kind: "create",
            path: "outside.ts",
            content: "export {};\n",
            mode: "regular",
          },
        ],
        maxBytes: 1024 * 1024,
      }),
    ).toThrow(/candidate-patch-create-invalid/u);
  });

  it("rejects symlink traversal before reading or compiling file content", () => {
    const root = workspace("symlink");
    const outside = mkdtempSync(path.join(tmpdir(), "cadence-patch-outside-"));
    roots.push(outside);
    writeFileSync(path.join(outside, "value.ts"), "secret\n");
    symlinkSync(outside, path.join(root, "linked"));
    expect(() =>
      compileCandidatePatch({
        root,
        writePaths: ["linked/value.ts"],
        deletePaths: [],
        operations: [
          {
            kind: "rewrite",
            path: "linked/value.ts",
            content: "changed\n",
          },
        ],
        maxBytes: 1024 * 1024,
      }),
    ).toThrow(/candidate-patch-path-unsafe/u);
  });

  it.each([
    {
      operation: {
        kind: "replace",
        path: "linked/value.ts",
        oldText: "secret",
        newText: "changed",
      },
      code: "candidate-patch-replace-invalid",
    },
    {
      operation: {
        kind: "rewrite",
        path: "linked/value.ts",
        content: "changed\n",
      },
      code: "candidate-patch-rewrite-invalid",
    },
    {
      operation: {
        kind: "create",
        path: "linked/value.ts",
        content: "changed\n",
        mode: "regular",
      },
      code: "candidate-patch-create-invalid",
    },
    {
      operation: { kind: "delete", path: "linked/value.ts" },
      code: "candidate-patch-delete-invalid",
    },
  ] as const)(
    "rejects unauthorized $operation.kind paths before observing source files",
    ({ operation, code }) => {
      const root = workspace(`unauthorized-${operation.kind}`);
      const outside = mkdtempSync(
        path.join(tmpdir(), "cadence-patch-unauthorized-"),
      );
      roots.push(outside);
      writeFileSync(path.join(outside, "value.ts"), "secret\n");
      symlinkSync(outside, path.join(root, "linked"));

      expect(() =>
        compileCandidatePatch({
          root,
          writePaths: ["src/value.ts"],
          deletePaths: ["obsolete.txt"],
          operations: [operation],
          maxBytes: 1024 * 1024,
        }),
      ).toThrow(new RegExp(code, "u"));
    },
  );

  it("keeps a small edit to a large text file below the candidate limit", () => {
    const root = workspace("compact");
    const content = Array.from(
      { length: 20_000 },
      (_, index) => `export const value${index} = ${index};`,
    ).join("\n");
    writeFileSync(path.join(root, "src/value.ts"), `${content}\n`);
    const diff = compileCandidatePatch({
      root,
      writePaths: ["src/value.ts"],
      deletePaths: [],
      operations: [
        {
          kind: "replace",
          path: "src/value.ts",
          oldText: "export const value10000 = 10000;",
          newText: "export const value10000 = 20000;",
        },
      ],
      maxBytes: 1024 * 1024,
    });

    expect(Buffer.byteLength(diff, "utf8")).toBeLessThan(4096);
    execFileSync("git", ["apply", "--check", "-"], { cwd: root, input: diff });
  });

  it("preserves a UTF-8 BOM in an applicable first-line replacement", () => {
    const root = workspace("bom");
    const target = path.join(root, "src/value.ts");
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    writeFileSync(
      target,
      Buffer.concat([bom, Buffer.from("export const value = 1;\n")]),
    );

    const diff = compileCandidatePatch({
      root,
      writePaths: ["src/value.ts"],
      deletePaths: [],
      operations: [
        {
          kind: "replace",
          path: "src/value.ts",
          oldText: "export const value = 1;",
          newText: "export const value = 2;",
        },
      ],
      maxBytes: 1024 * 1024,
    });

    execFileSync("git", ["apply", "--check", "-"], { cwd: root, input: diff });
    execFileSync("git", ["apply", "-"], { cwd: root, input: diff });
    expect(readFileSync(target)).toEqual(
      Buffer.concat([bom, Buffer.from("export const value = 2;\n")]),
    );
  });

  it("rejects operation text that cannot round-trip through UTF-8", () => {
    const root = workspace("invalid-surrogate");
    writeFileSync(
      path.join(root, "src/emoji.ts"),
      "export const emoji = '😀';\n",
    );
    const invalid = "\ud800";
    const cases = [
      {
        operation: {
          kind: "replace",
          path: "src/emoji.ts",
          oldText: invalid,
          newText: "changed",
        },
        writePaths: ["src/emoji.ts"],
        code: "candidate-patch-replace-invalid",
      },
      {
        operation: {
          kind: "replace",
          path: "src/value.ts",
          oldText: "value = 1",
          newText: invalid,
        },
        writePaths: ["src/value.ts"],
        code: "candidate-patch-replace-invalid",
      },
      {
        operation: {
          kind: "rewrite",
          path: "src/value.ts",
          content: invalid,
        },
        writePaths: ["src/value.ts"],
        code: "candidate-patch-rewrite-invalid",
      },
      {
        operation: {
          kind: "create",
          path: "src/new.ts",
          content: invalid,
          mode: "regular",
        },
        writePaths: ["src/new.ts"],
        code: "candidate-patch-create-invalid",
      },
    ] as const;

    for (const { operation, writePaths, code } of cases) {
      expect(() =>
        compileCandidatePatch({
          root,
          writePaths,
          deletePaths: [],
          operations: [operation],
          maxBytes: 1024 * 1024,
        }),
      ).toThrow(new RegExp(code, "u"));
    }
  });

  it("accepts and preserves valid astral Unicode text", () => {
    const root = workspace("valid-astral");
    const diff = compileCandidatePatch({
      root,
      writePaths: ["src/value.ts"],
      deletePaths: [],
      operations: [
        {
          kind: "replace",
          path: "src/value.ts",
          oldText: "value = 1",
          newText: 'value = "😀"',
        },
      ],
      maxBytes: 1024 * 1024,
    });

    execFileSync("git", ["apply", "--check", "-"], { cwd: root, input: diff });
    execFileSync("git", ["apply", "-"], { cwd: root, input: diff });
    expect(readFileSync(path.join(root, "src/value.ts"), "utf8")).toBe(
      'export const value = "😀";\n',
    );
  });

  it("rejects empty-file create/delete and noncanonical diff paths", () => {
    const root = workspace("empty-files");
    writeFileSync(path.join(root, "empty.txt"), "");
    expect(() =>
      compileCandidatePatch({
        root,
        writePaths: ["new-empty.txt"],
        deletePaths: [],
        operations: [
          {
            kind: "create",
            path: "new-empty.txt",
            content: "",
            mode: "regular",
          },
        ],
        maxBytes: 1024 * 1024,
      }),
    ).toThrow(/candidate-patch-create-invalid/u);
    expect(() =>
      compileCandidatePatch({
        root,
        writePaths: [],
        deletePaths: ["empty.txt"],
        operations: [{ kind: "delete", path: "empty.txt" }],
        maxBytes: 1024 * 1024,
      }),
    ).toThrow(/candidate-empty-file-delete-unsupported/u);
    expect(() =>
      compileCandidatePatch({
        root,
        writePaths: [" src/value.ts"],
        deletePaths: [],
        operations: [
          {
            kind: "rewrite",
            path: " src/value.ts",
            content: "changed\n",
          },
        ],
        maxBytes: 1024 * 1024,
      }),
    ).toThrow(/candidate-patch-path-invalid/u);
  });
});
