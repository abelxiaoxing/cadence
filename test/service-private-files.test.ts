import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PrivateFiles, REGISTRY_BYTES } from "../src/service/private-files.ts";
import { readBounded, safeDirectory } from "../src/task-store.ts";

// Fixed counters only: never retain buffer arguments, Stats, call traces or
// promises. Hooks below inject synchronous filesystem races in isolated fixtures.
const io = vi.hoisted(() => ({
  selected: "",
  stats: 0,
  selectedStats: 0,
  opens: 0,
  fstats: 0,
  reads: 0,
  closes: 0,
  after: undefined as undefined | ((op: string, path?: unknown) => void),
}));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    lstatSync: (...args: unknown[]) => {
      const result = Reflect.apply(fs.lstatSync, fs, args);
      io.stats++;
      if (args[0] === io.selected) io.selectedStats++;
      io.after?.("stat", args[0]);
      return result;
    },
    openSync: (...args: unknown[]) => {
      const result = Reflect.apply(fs.openSync, fs, args);
      io.opens++;
      io.after?.("open", args[0]);
      return result;
    },
    fstatSync: (...args: unknown[]) => {
      const result = Reflect.apply(fs.fstatSync, fs, args);
      io.fstats++;
      io.after?.("fstat");
      return result;
    },
    readSync: (...args: unknown[]) => {
      const result = Reflect.apply(fs.readSync, fs, args);
      io.reads++;
      io.after?.("read");
      return result;
    },
    closeSync: (...args: unknown[]) => {
      const result = Reflect.apply(fs.closeSync, fs, args);
      io.closes++;
      return result;
    },
  };
});
afterEach(() => {
  io.after = undefined;
  vi.restoreAllMocks();
});
function reset(selected = "") {
  io.selected = selected;
  io.stats = io.selectedStats = io.opens = io.fstats = io.reads = io.closes = 0;
}
function fixture(body = "selected bytes\n") {
  const root = mkdtempSync(join(tmpdir(), "cadence-private-files-"));
  const namespace = join(root, "private"),
    directory = join(namespace, "checkout", "service", "history", "records");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "selected.json");
  writeFileSync(path, body, { mode: 0o600 });
  return {
    root,
    namespace,
    directory,
    path,
    files: new PrivateFiles(namespace),
    body,
  };
}
const depth = (path: string) => {
  const full = resolve(path);
  return full.slice(parse(full).root.length).split(sep).filter(Boolean).length;
};

it("bounded real-file work measurement: one readonly walk and exact-size allocation", () => {
  const f = fixture();
  reset(f.namespace);
  expect(f.files.directory(f.directory)).toBe(true);
  const directory = { stats: io.stats, namespaceStats: io.selectedStats };
  const d = depth(f.namespace),
    k = depth(f.directory) - d;
  const repeated = Array.from(
    { length: k + 1 },
    (_, n) => 2 * (d + n) + 1,
  ).reduce((a, b) => a + b, 0);
  expect(directory.stats).toBe(1 + 2 * (d + k));
  expect(directory.stats).toBeLessThan(repeated);
  expect(directory.namespaceStats).toBe(2);
  // The create branch still repeats the original per-component validation,
  // even when every directory already exists. It is not this readonly hook.
  reset(f.namespace);
  expect(f.files.directory(f.directory, true)).toBe(true);
  const create = { stats: io.stats, namespaceStats: io.selectedStats };
  expect(create.stats).toBe(repeated);
  expect(create.namespaceStats).toBe(2 * (k + 1) + 1);
  const alloc = Buffer.alloc;
  let allocations = 0,
    allocatedBytes = 0;
  Buffer.alloc = function (...args: Parameters<typeof alloc>) {
    allocations++;
    allocatedBytes += args[0];
    return Reflect.apply(alloc, this, args);
  };
  reset();
  let snapshot: ReturnType<PrivateFiles["read"]>;
  try {
    snapshot = f.files.read(f.path, REGISTRY_BYTES);
  } finally {
    Buffer.alloc = alloc;
  }
  expect(snapshot?.bytes.toString()).toBe(f.body);
  expect(allocations).toBe(1);
  expect(allocatedBytes).toBe(Buffer.byteLength(f.body) + 1);
  expect(io.opens).toBe(2);
  expect(io.closes).toBe(2);
  writeFileSync(
    join(f.root, "work.json"),
    JSON.stringify({
      schema: "private-read-cost/1",
      namespaceDepth: d,
      selectedDepth: d + k,
      directory,
      create,
      read: {
        stats: io.stats,
        opens: io.opens,
        reads: io.reads,
        closes: io.closes,
        allocations,
        allocatedBytes,
        selectedBytes: Buffer.byteLength(f.body),
        independentMaximum: REGISTRY_BYTES,
      },
    }),
    { mode: 0o600 },
  );
});

it.each([0, 1, 31, 32])(
  "exact selected size %i keeps bytes, hash and stamp across independent reads",
  (size) => {
    const f = fixture("x".repeat(size));
    const before = lstatSync(f.path),
      a = f.files.read(f.path, 32),
      b = f.files.read(f.path, 32);
    expect(a).toEqual(b);
    expect(a?.bytes).toEqual(readFileSync(f.path));
    expect(a?.identity).toBe(createHash("sha256").update(f.body).digest("hex"));
    expect(a?.stamp).toBe(
      [
        before.dev,
        before.ino,
        before.size,
        before.mode,
        before.uid,
        before.nlink,
        before.ctimeMs,
        before.mtimeMs,
      ].join(":"),
    );
    const after = lstatSync(f.path);
    for (const key of [
      "dev",
      "ino",
      "size",
      "mode",
      "uid",
      "nlink",
      "ctimeMs",
      "mtimeMs",
    ] as const)
      expect(after[key]).toBe(before[key]);
  },
);

it("independent caller maximum still refuses max+1 before allocating or opening", () => {
  const f = fixture("x".repeat(33));
  reset();
  expect(() => f.files.read(f.path, 32)).toThrow();
  expect(io.opens).toBe(0);
  expect(readFileSync(f.path, "utf8")).toBe(f.body);
  expect(f.files.read(f.path, 33)?.bytes.length).toBe(33);
});

it("absence stays absent without creating a missing namespace or parent", () => {
  const f = fixture();
  const namespace = join(f.root, "missing");
  const files = new PrivateFiles(namespace);
  expect(files.directory(join(namespace, "child"))).toBe(false);
  expect(files.read(join(namespace, "child", "file"))).toBeUndefined();
  expect(existsSync(namespace)).toBe(false);
  expect(f.files.read(join(f.directory, "absent"))).toBeUndefined();
});

it.each(["namespace", "ancestor", "leaf"])(
  "unsafe %s mode cannot hide behind a missing descendant or create one",
  (location) => {
    if (process.platform === "win32") return;
    const f = fixture();
    const selected =
      location === "namespace"
        ? f.namespace
        : location === "ancestor"
          ? dirname(f.directory)
          : f.directory;
    chmodSync(selected, 0o755);
    const child = join(f.directory, "missing", "deep");
    expect(() => f.files.directory(child)).toThrow();
    expect(() => f.files.read(join(child, "file"))).toThrow();
    expect(() => f.files.directory(child, true)).toThrow();
    expect(() => f.files.create(join(child, "file"), "no")).toThrow();
    expect(existsSync(join(f.directory, "missing"))).toBe(false);
  },
);

it.each(["namespace", "ancestor", "leaf"])(
  "later observed unsafe %s mode is not hidden by the readonly inspection hook",
  (location) => {
    if (process.platform === "win32") return;
    for (const missing of [false, true]) {
      const f = fixture();
      const selected =
        location === "namespace"
          ? f.namespace
          : location === "ancestor"
            ? dirname(f.directory)
            : f.directory;
      reset(selected);
      let injected = false;
      io.after = (op, path) => {
        if (!injected && op === "stat" && path === selected) {
          injected = true;
          chmodSync(selected, 0o755);
        }
      };
      const target = missing
        ? join(f.directory, "absent", "child")
        : f.directory;
      expect(() => f.files.directory(target)).toThrow();
      io.after = undefined;
      expect(injected).toBe(true);
      expect(io.selectedStats).toBe(2);
      expect(existsSync(join(f.directory, "absent"))).toBe(false);
      // The unmodified creation path must still refuse before any effect.
      expect(() =>
        f.files.create(join(f.directory, "absent", "file"), "no"),
      ).toThrow();
      expect(existsSync(join(f.directory, "absent"))).toBe(false);
    }
  },
);

it("readonly inspection never receives a later observed non-directory", () => {
  const f = fixture();
  reset(f.directory);
  let inspected = false;
  io.after = (op, path) => {
    if (op === "stat" && path === f.directory && io.selectedStats === 1) {
      renameSync(f.directory, `${f.directory}.preserved`);
      writeFileSync(f.directory, "not a directory", { mode: 0o600 });
    }
  };
  expect(() =>
    safeDirectory(f.directory, false, (path) => {
      if (path === f.directory) inspected = true;
    }),
  ).toThrow();
  io.after = undefined;
  expect(inspected).toBe(false);
  expect(io.selectedStats).toBe(2);
  expect(readFileSync(f.directory, "utf8")).toBe("not a directory");
});

it("zero independent maximum accepts only an unchanged empty file", () => {
  const f = fixture("");
  expect(f.files.read(f.path, 0)?.bytes.length).toBe(0);
  writeFileSync(f.path, "x");
  reset();
  expect(() => f.files.read(f.path, 0)).toThrow();
  expect(io.opens).toBe(0);
});

it.each(["outer-open", "inner-open"])(
  "selected disappearance after %s refuses rather than returning absence",
  (stage) => {
    const f = fixture();
    reset();
    let injected = false;
    io.after = (op, path) => {
      if (
        !injected &&
        op === "open" &&
        path === f.path &&
        io.opens === (stage === "outer-open" ? 1 : 2)
      ) {
        injected = true;
        renameSync(f.path, `${f.path}.preserved`);
      }
    };
    expect(() => f.files.read(f.path)).toThrow();
    io.after = undefined;
    expect(injected).toBe(true);
    expect(io.opens).toBe(io.closes);
    expect(readFileSync(`${f.path}.preserved`, "utf8")).toBe(f.body);
    expect(f.files.read(f.path)).toBeUndefined();
  },
);

it("segment-aware namespace rejects sibling prefixes and escapes before descendant creation", () => {
  const f = fixture();
  for (const outside of [
    join(f.root, "private-sibling", "child"),
    join(f.namespace, "..", "other", "child"),
    f.root,
  ]) {
    expect(() => f.files.directory(outside)).toThrow();
    expect(() => f.files.directory(outside, true)).toThrow();
  }
  expect(existsSync(join(f.root, "private-sibling"))).toBe(false);
  expect(existsSync(join(f.root, "other"))).toBe(false);
  expect(f.files.directory(join(f.namespace, "checkout", ".."))).toBe(true);
});

it.each(["ambient", "namespace", "ancestor", "leaf"])(
  "%s directory link refuses without touching its target",
  (location) => {
    const f = fixture();
    const selected =
      location === "ambient"
        ? f.root
        : location === "namespace"
          ? f.namespace
          : location === "ancestor"
            ? dirname(f.directory)
            : f.directory;
    renameSync(selected, `${selected}-original`);
    symlinkSync(`${selected}-original`, selected, "junction");
    const missing = join(f.directory, "never-created");
    expect(() => f.files.directory(missing)).toThrow();
    expect(() => f.files.directory(missing, true)).toThrow();
    expect(existsSync(missing)).toBe(false);
  },
);

it.each(["symlink", "hardlink", "directory", "mode"])(
  "unsafe selected file %s refuses and preserves it",
  (kind) => {
    if (kind === "mode" && process.platform === "win32") return;
    const f = fixture();
    if (kind === "hardlink") linkSync(f.path, `${f.path}.link`);
    else if (kind === "mode") chmodSync(f.path, 0o644);
    else {
      renameSync(f.path, `${f.path}.original`);
      if (kind === "symlink") symlinkSync(`${f.path}.original`, f.path);
      else mkdirSync(f.path, { mode: 0o700 });
    }
    const before = lstatSync(f.path);
    expect(() => f.files.read(f.path)).toThrow();
    expect(lstatSync(f.path)).toEqual(before);
  },
);

it.each(["outer-open", "inner-open", "after-read", "final-stat"])(
  "growth/shrink/replacement/mode changes at %s still refuse (injected real filesystem boundary)",
  (stage) => {
    for (const change of ["grow", "shrink", "replace", "mode"] as const) {
      if (change === "mode" && process.platform === "win32") continue;
      const f = fixture();
      reset();
      let injected = false;
      io.after = (op, path) => {
        if (injected) return;
        const selected =
          stage === "final-stat"
            ? op === "fstat" && io.fstats === 3
            : stage === "after-read"
              ? op === "read"
              : op === "open" &&
                path === f.path &&
                io.opens === (stage === "outer-open" ? 1 : 2);
        if (!selected) return;
        injected = true;
        if (change === "grow") writeFileSync(f.path, `${f.body}grew`);
        if (change === "shrink") writeFileSync(f.path, "");
        if (change === "mode") chmodSync(f.path, 0o644);
        if (change === "replace") {
          renameSync(f.path, `${f.path}.preserved`);
          writeFileSync(f.path, f.body, { mode: 0o600 });
        }
      };
      expect(() => f.files.read(f.path, REGISTRY_BYTES)).toThrow();
      io.after = undefined;
      expect(injected).toBe(true);
      expect(io.opens).toBe(io.closes);
    }
  },
);

// Windows refuses to rename a directory holding an open file, so this ancestor
// swap after the selected-file open cannot occur there.
it.skipIf(process.platform === "win32")(
  "inner bounded reader independently rewalks ancestors after outer selected-file open",
  () => {
    const f = fixture();
    reset();
    io.after = (op, path) => {
      if (op === "open" && path === f.path && io.opens === 1) {
        renameSync(f.directory, `${f.directory}.preserved`);
        symlinkSync(`${f.directory}.preserved`, f.directory, "junction");
      }
    };
    expect(() => f.files.read(f.path)).toThrow();
    io.after = undefined;
    expect(io.opens).toBe(1);
    expect(io.closes).toBe(1);
  },
);

it("default safeDirectory/readBounded retain legacy mode policy and stepwise creation", () => {
  const f = fixture();
  chmodSync(f.namespace, 0o755);
  const child = join(f.namespace, "legacy", "nested");
  expect(safeDirectory(child)).toBe(false);
  expect(safeDirectory(child, true)).toBe(true);
  expect(readBounded(f.path, Buffer.byteLength(f.body))?.toString()).toBe(
    f.body,
  );
  expect(() => readBounded(f.path, Buffer.byteLength(f.body) - 1)).toThrow();
});

it("readonly inspection visits root and each existing ancestor in order, before absence", () => {
  const f = fixture();
  const inspected: string[] = [];
  expect(
    safeDirectory(join(f.directory, "absent", "child"), false, (path, st) => {
      expect(st.isDirectory()).toBe(true);
      expect(st.isSymbolicLink()).toBe(false);
      expect(inspected.length).toBeLessThan(32);
      inspected.push(path);
    }),
  ).toBe(false);
  const expected = [f.directory];
  while (dirname(expected[0]) !== expected[0])
    expected.unshift(dirname(expected[0]));
  expect(inspected).toEqual(expected);
  expect(existsSync(join(f.directory, "absent"))).toBe(false);
  const fault = Object.assign(new Error("inspection refused"), {
    code: "ENOENT",
  });
  expect(() =>
    safeDirectory(f.directory, false, () => {
      throw fault;
    }),
  ).toThrow(fault);
});

it("root/normalized/relative namespaces retain their actual boundary", () => {
  const f = fixture();
  expect(
    new PrivateFiles(join(f.namespace, "checkout", "..")).directory(
      f.directory,
    ),
  ).toBe(true);
  expect(
    new PrivateFiles(relative(process.cwd(), f.namespace)).directory(
      f.directory,
    ),
  ).toBe(true);
  // Root has no path component: it must still be inspected, not skipped by the hook.
  const root = parse(f.directory).root;
  let inspected = 0;
  expect(
    safeDirectory(root, false, (path) => {
      expect(path).toBe(root);
      inspected++;
    }),
  ).toBe(true);
  expect(inspected).toBe(1);
  if (process.platform !== "win32")
    expect(() => new PrivateFiles(root).directory(f.directory)).toThrow();
});

it("changed private modes are rechecked on the next call and after an await (no cache)", async () => {
  if (process.platform === "win32") return;
  const f = fixture();
  expect(f.files.read(f.path)?.bytes.toString()).toBe(f.body);
  await Promise.resolve();
  chmodSync(f.namespace, 0o755);
  expect(() => f.files.read(f.path)).toThrow();
  expect(() => f.files.directory(f.directory)).toThrow();
});

it("foreign ownership refuses (injected uid observation, not a foreign-user execution)", () => {
  if (process.platform === "win32" || !process.getuid) return;
  const f = fixture();
  const uid = process.getuid();
  const spy = vi.spyOn(process, "getuid").mockReturnValue(uid + 1);
  try {
    expect(() => f.files.directory(f.directory)).toThrow();
    expect(() =>
      f.files.directory(join(f.directory, "absent"), true),
    ).toThrow();
    expect(existsSync(join(f.directory, "absent"))).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

it.each(["file", "dangling-link"])(
  "existing %s parent is unsafe rather than absent and cannot create descendants",
  (kind) => {
    const f = fixture();
    const parent = join(f.namespace, "unsafe");
    if (kind === "file")
      writeFileSync(parent, "not a directory", { mode: 0o600 });
    else symlinkSync(join(f.root, "missing-target"), parent, "junction");
    expect(() => f.files.directory(join(parent, "child"))).toThrow();
    expect(() => f.files.directory(join(parent, "child"), true)).toThrow();
    expect(existsSync(join(f.root, "missing-target"))).toBe(false);
  },
);

it("empty selected file still has a one-byte growth sentinel after inner fstat", () => {
  const f = fixture("");
  reset();
  let injected = false;
  // Grow after the inner stat was selected, before allocation/read. The one
  // sentinel byte must catch it even when the selected file was empty.
  io.after = (op) => {
    if (op === "fstat" && io.fstats === 2 && !injected) {
      injected = true;
      writeFileSync(f.path, "x");
    }
  };
  expect(() => f.files.read(f.path, REGISTRY_BYTES)).toThrow();
  io.after = undefined;
  expect(injected).toBe(true);
  expect(io.opens).toBe(2);
  expect(io.closes).toBe(2);
  expect(readFileSync(f.path, "utf8")).toBe("x");
});

it.each([1, 2])(
  "selected file symlink substitution after stat %i cannot be followed",
  (ordinal) => {
    const f = fixture();
    reset(f.path);
    let injected = false;
    io.after = (op, path) => {
      if (
        !injected &&
        op === "stat" &&
        path === f.path &&
        io.selectedStats === ordinal
      ) {
        injected = true;
        renameSync(f.path, `${f.path}.preserved`);
        symlinkSync(`${f.path}.preserved`, f.path);
      }
    };
    expect(() => f.files.read(f.path)).toThrow();
    io.after = undefined;
    expect(injected).toBe(true);
    expect(io.opens).toBe(io.closes);
    expect(lstatSync(f.path).isSymbolicLink()).toBe(true);
    expect(readFileSync(`${f.path}.preserved`, "utf8")).toBe(f.body);
  },
);
