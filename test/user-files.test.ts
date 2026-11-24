import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  copyUserEntry,
  createUserEntry,
  deleteUserEntry,
  listUserFiles,
  readUserFile,
  renameUserEntry,
  searchUserFiles,
  UserFileError,
  writeUserFile,
} from "../src/service/user-files.ts";
import { handleUserFilesHttp } from "../src/service/user-files-http.ts";

const temps: string[] = [];
function makeRoot(prefix = "cadence-user-files-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

it("lists all files without hiding dotfiles, symlinks, hardlinks or parent directories outside cwd", () => {
  const outer = makeRoot();
  const project = join(outer, "project");
  mkdirSync(project);
  writeFileSync(join(outer, "sibling.txt"), "outside-cwd");
  writeFileSync(join(project, ".env"), "API_KEY=raw-unredacted-secret");
  mkdirSync(join(project, ".git"));
  writeFileSync(join(project, "real.txt"), "hello");
  linkSync(join(project, "real.txt"), join(project, "hard.txt"));
  symlinkSync(join(outer, "sibling.txt"), join(project, "link.txt"));

  const listing = listUserFiles(project, "");
  expect(listing.path).toBe("");
  expect(listing.parent).toBe(outer.split("\\").join("/"));
  expect(listing.entries.map((e) => e.name)).toEqual([
    ".git",
    ".env",
    "hard.txt",
    "link.txt",
    "real.txt",
  ]);
  expect(listing.entries.find((e) => e.name === "link.txt")?.symlink).toBe(
    true,
  );

  // Free browsing up to parent directory outside cwd
  const parentListing = listUserFiles(project, listing.parent!);
  expect(parentListing.entries.map((e) => e.name)).toContain("sibling.txt");

  // Raw unredacted read of .env and symlink target
  const envFile = readUserFile(project, ".env");
  expect(envFile).toMatchObject({
    kind: "text",
    text: "API_KEY=raw-unredacted-secret",
    editable: true,
  });
  const linked = readUserFile(project, "link.txt");
  expect(linked).toMatchObject({ kind: "text", text: "outside-cwd" });
});

it("creates nested files and folders, refuses silent overwrites, renames, copies, moves and deletes cleanly", () => {
  const project = makeRoot();

  // Nested file creation automatically builds intermediate directories
  const createdFile = createUserEntry(
    project,
    "",
    "utils/date/format.ts",
    "file",
  );
  expect(createdFile.path).toBe("utils/date/format.ts");
  expect(createdFile.name).toBe("format.ts");
  expect(existsSync(join(project, "utils/date/format.ts"))).toBe(true);

  // Nested folder creation inside a target subfolder
  const createdDir = createUserEntry(project, "utils", "extra/nested", "dir");
  expect(createdDir.path).toBe("utils/extra/nested");
  expect(createdDir.directory).toBe(true);

  // Refuses overwriting existing path
  expect(() =>
    createUserEntry(project, "", "utils/date/format.ts", "file"),
  ).toThrow(UserFileError);

  // Write raw text & read back
  writeUserFile(project, "utils/date/format.ts", "export const x = 42;\n");
  expect(readUserFile(project, "utils/date/format.ts")).toMatchObject({
    kind: "text",
    text: "export const x = 42;\n",
  });

  // Rename file
  const renamed = renameUserEntry(project, "utils/date/format.ts", "time.ts");
  expect(renamed.path).toBe("utils/date/time.ts");
  expect(existsSync(join(project, "utils/date/format.ts"))).toBe(false);
  expect(readFileSync(join(project, "utils/date/time.ts"), "utf8")).toBe(
    "export const x = 42;\n",
  );

  // Duplicate auto-dedupes copy names
  const dup1 = copyUserEntry(
    project,
    "utils/date/time.ts",
    "utils/date",
    false,
  );
  const dup2 = copyUserEntry(
    project,
    "utils/date/time.ts",
    "utils/date",
    false,
  );
  expect(dup1.name).toBe("time copy.ts");
  expect(dup2.name).toBe("time copy 2.ts");

  // Move file to another folder
  const moved = copyUserEntry(
    project,
    "utils/date/time copy.ts",
    "utils/extra",
    true,
  );
  expect(moved.path).toBe("utils/extra/time copy.ts");
  expect(existsSync(join(project, "utils/date/time copy.ts"))).toBe(false);

  // Refuse self-recursive copy/move into descendant (both direct and via symlink)
  expect(() => copyUserEntry(project, "utils", "utils/extra", false)).toThrow(
    expect.objectContaining({ code: "self-target" }),
  );
  expect(() => copyUserEntry(project, "utils", "utils/extra", true)).toThrow(
    expect.objectContaining({ code: "self-target" }),
  );
  symlinkSync(join(project, "utils/extra"), join(project, "alias-extra"));
  expect(() => copyUserEntry(project, "utils", "alias-extra", false)).toThrow(
    expect.objectContaining({ code: "self-target" }),
  );
  deleteUserEntry(project, "alias-extra");

  // Renaming over a hardlink with a different filename refuses 409 instead of a POSIX no-op
  writeFileSync(join(project, "hl-a.txt"), "same-inode");
  linkSync(join(project, "hl-a.txt"), join(project, "hl-b.txt"));
  expect(() => renameUserEntry(project, "hl-a.txt", "hl-b.txt")).toThrow(
    expect.objectContaining({ code: "exists" }),
  );
  deleteUserEntry(project, "hl-a.txt");
  deleteUserEntry(project, "hl-b.txt");

  // Delete symlink removes only the link, never the target
  writeFileSync(join(project, "keep.txt"), "safe");
  symlinkSync(join(project, "keep.txt"), join(project, "sym.txt"));
  deleteUserEntry(project, "sym.txt");
  expect(lstatSync(join(project, "keep.txt")).isFile()).toBe(true);
  expect(existsSync(join(project, "sym.txt"))).toBe(false);

  // Delete non-empty directory recursively
  deleteUserEntry(project, "utils");
  expect(existsSync(join(project, "utils"))).toBe(false);

  // Refuse protected root deletion/rename
  expect(() => deleteUserEntry(project, "/")).toThrow(
    expect.objectContaining({ code: "protected" }),
  );
  expect(() => renameUserEntry(project, "/", "oops")).toThrow(
    expect.objectContaining({ code: "protected" }),
  );
});

it("classifies images and binary files and performs recursive search honoring hidden toggle", () => {
  const project = makeRoot();
  mkdirSync(join(project, "assets"));
  mkdirSync(join(project, ".secret"));
  writeFileSync(
    join(project, "assets/logo.png"),
    Buffer.from([137, 80, 78, 71]),
  );
  writeFileSync(join(project, "data.bin"), Buffer.from([0, 1, 2, 255]));
  writeFileSync(join(project, ".secret/token.txt"), "abc");
  writeFileSync(join(project, "assets/token-note.md"), "note");

  expect(readUserFile(project, "assets/logo.png")).toMatchObject({
    kind: "image",
    mimeType: "image/png",
  });
  expect(readUserFile(project, "data.bin")).toMatchObject({
    kind: "binary",
  });

  const withoutHidden = searchUserFiles(project, "token", "", false);
  expect(withoutHidden.results.map((r) => r.path)).toEqual([
    "assets/token-note.md",
  ]);
  expect(withoutHidden.results[0]?.relPath).toBe("assets/token-note.md");
  const withHidden = searchUserFiles(project, "token", "", true);
  expect(withHidden.results.map((r) => r.path).sort()).toEqual([
    ".secret/token.txt",
    "assets/token-note.md",
  ]);

  // Searching from an ancestor outside cwd keeps relPath relative to scope
  // while preserving exact wire paths (relative inside cwd, absolute outside cwd)
  const outer = makeRoot();
  const nestedCwd = join(outer, "app");
  mkdirSync(join(nestedCwd, "src"), { recursive: true });
  writeFileSync(join(nestedCwd, "src/match.ts"), "ok");
  writeFileSync(join(outer, "match-sibling.txt"), "ok");
  const ancestorSearch = searchUserFiles(
    nestedCwd,
    "match",
    outer.split("\\").join("/"),
    false,
  );
  expect(ancestorSearch.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "match.ts",
        path: "src/match.ts",
        relPath: "app/src/match.ts",
        directory: false,
      }),
      expect.objectContaining({
        name: "match-sibling.txt",
        path: `${outer.split("\\").join("/")}/match-sibling.txt`,
        relPath: "match-sibling.txt",
        directory: false,
      }),
    ]),
  );
});

it("serves list, create, write, streaming upload, raw download and delete over HTTP", async () => {
  const project = makeRoot();
  const csrf = "test-csrf-token";
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void handleUserFilesHttp(req, res, url, {
      csrf,
      assertCurrent: () => {},
    });
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    const meta = (await (
      await fetch(`${base}/workbench/v1/files/meta`)
    ).json()) as { kind: string; value: { csrf: string; home: string } };
    expect(meta.kind).toBe("ok");
    expect(meta.value.csrf).toBe(csrf);

    // Create nested file
    const created = (await (
      await fetch(`${base}/workbench/v1/files/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: project,
          dir: "",
          name: "docs/hello.md",
          kind: "file",
        }),
      })
    ).json()) as { kind: string; value: { path: string } };
    expect(created).toMatchObject({
      kind: "ok",
      value: { path: "docs/hello.md" },
    });

    // Write file content
    const written = await fetch(`${base}/workbench/v1/files/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cwd: project,
        path: "docs/hello.md",
        text: "# Hello Cadence\n",
      }),
    });
    expect(written.status).toBe(200);

    // Raw download with Content-Disposition and sandboxed CSP
    const dl = await fetch(
      `${base}/workbench/v1/files/raw?cwd=${encodeURIComponent(project)}&path=${encodeURIComponent("docs/hello.md")}&download=1`,
    );
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toContain("attachment;");
    expect(dl.headers.get("content-security-policy")).toContain("sandbox");
    expect(await dl.text()).toBe("# Hello Cadence\n");

    // Streaming binary upload
    const payload = Buffer.from([1, 2, 3, 4, 5, 6]);
    const up = await fetch(
      `${base}/workbench/v1/files/upload?cwd=${encodeURIComponent(project)}&dir=docs&name=${encodeURIComponent("样本.bin")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: payload,
      },
    );
    expect(up.status).toBe(200);
    expect(readFileSync(join(project, "docs/样本.bin")).equals(payload)).toBe(
      true,
    );

    // Uploading over an existing file refuses 409 without clobbering original bytes
    const conflict = await fetch(
      `${base}/workbench/v1/files/upload?cwd=${encodeURIComponent(project)}&dir=docs&name=${encodeURIComponent("样本.bin")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: Buffer.from([9, 9]),
      },
    );
    expect(conflict.status).toBe(409);
    expect(readFileSync(join(project, "docs/样本.bin")).equals(payload)).toBe(
      true,
    );

    // Oversize Content-Length upload is rejected with 413 and leaves no orphan file
    const oversizeStatus = await new Promise<number>(
      (resolveStatus, reject) => {
        const req = httpRequest(
          `${base}/workbench/v1/files/upload?cwd=${encodeURIComponent(project)}&dir=docs&name=huge.bin`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(512 * 1024 * 1024),
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolveStatus(res.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    expect(oversizeStatus).toBe(413);
    expect(existsSync(join(project, "docs/huge.bin"))).toBe(false);

    // Mid-stream client disconnect cleans up the partial file with no orphan left on disk
    await new Promise<void>((resolveAbort) => {
      const req = httpRequest(
        `${base}/workbench/v1/files/upload?cwd=${encodeURIComponent(project)}&dir=docs&name=partial.bin`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": "4096",
          },
        },
      );
      req.on("error", () => resolveAbort());
      req.write(Buffer.alloc(64, 7));
      setTimeout(() => {
        req.destroy();
        resolveAbort();
      }, 30);
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(existsSync(join(project, "docs/partial.bin"))).toBe(false);
  } finally {
    await new Promise<void>((resolveClose) =>
      server.close(() => resolveClose()),
    );
  }
});
