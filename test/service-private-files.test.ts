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
import {
  DirectoryWalks,
  PrivateFiles,
  REGISTRY_BYTES,
} from "../src/service/private-files.ts";
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
  // The former per-segment rewalk with two observations per component.
  const repeated = Array.from(
    { length: k + 1 },
    (_, n) => 2 * (d + n) + 1,
  ).reduce((a, b) => a + b, 0);
  // One no-follow observation per component, root included.
  expect(directory.stats).toBe(1 + d + k);
  expect(directory.stats).toBeLessThan(repeated);
  expect(directory.namespaceStats).toBe(1);
  // Creation walks the namespace once, then checks each private segment once.
  reset(f.namespace);
  expect(f.files.directory(f.directory, true)).toBe(true);
  const create = { stats: io.stats, namespaceStats: io.selectedStats };
  expect(create.stats).toBe(d + 1 + k);
  expect(create.stats).toBeLessThan(repeated);
  expect(create.namespaceStats).toBe(2);
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
  // One no-follow open: the bytes come from the identity-checked descriptor.
  expect(io.opens).toBe(1);
  expect(io.closes).toBe(1);
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
  "unsafe %s mode observed during the walk is not hidden by the readonly inspection hook",
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
      // Change the mode just before the component's single observation.
      io.after = (op, path) => {
        if (!injected && op === "stat" && path === dirname(selected)) {
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
      expect(io.selectedStats).toBe(1);
      expect(existsSync(join(f.directory, "absent"))).toBe(false);
      // The unmodified creation path must still refuse before any effect.
      expect(() =>
        f.files.create(join(f.directory, "absent", "file"), "no"),
      ).toThrow();
      expect(existsSync(join(f.directory, "absent"))).toBe(false);
    }
  },
);

it("readonly inspection never receives an observed non-directory", () => {
  const f = fixture();
  reset(f.directory);
  let inspected = false;
  let injected = false;
  // Replace the component just before its single observation.
  io.after = (op, path) => {
    if (!injected && op === "stat" && path === dirname(f.directory)) {
      injected = true;
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
  expect(injected).toBe(true);
  expect(inspected).toBe(false);
  expect(io.selectedStats).toBe(1);
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

it.each(["open", "read"])(
  "selected disappearance after %s refuses rather than returning absence",
  (stage) => {
    const f = fixture();
    reset();
    let injected = false;
    io.after = (op, path) => {
      if (
        !injected &&
        (stage === "read" ? op === "read" : op === "open" && path === f.path)
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

it.each(["open", "after-read", "final-stat"])(
  "growth/shrink/replacement/mode changes at %s still refuse (injected real filesystem boundary)",
  (stage) => {
    for (const change of ["grow", "shrink", "replace", "mode"] as const) {
      if (change === "mode" && process.platform === "win32") continue;
      const f = fixture();
      reset();
      let injected = false;
      io.after = (op, path) => {
        if (injected) return;
        // The descriptor's second fstat is the final descriptor check.
        const selected =
          stage === "final-stat"
            ? op === "fstat" && io.fstats === 2
            : stage === "after-read"
              ? op === "read"
              : op === "open" && path === f.path;
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
  "an ancestor swapped for a link after the selected-file open never yields other bytes",
  () => {
    // A link to another directory with other content: the final path
    // identity check refuses.
    {
      const f = fixture();
      const attacker = join(f.root, "attacker");
      mkdirSync(attacker, { mode: 0o700 });
      writeFileSync(join(attacker, "selected.json"), "attacker bytes\n", {
        mode: 0o600,
      });
      reset();
      io.after = (op, path) => {
        if (op === "open" && path === f.path && io.opens === 1) {
          renameSync(f.directory, `${f.directory}.preserved`);
          symlinkSync(attacker, f.directory, "junction");
        }
      };
      expect(() => f.files.read(f.path)).toThrow();
      io.after = undefined;
      expect(io.opens).toBe(1);
      expect(io.closes).toBe(1);
    }
    // A link back to the same directory: the bytes come only from the
    // descriptor validated before the swap, and the next walk rejects the link.
    {
      const f = fixture();
      reset();
      io.after = (op, path) => {
        if (op === "open" && path === f.path && io.opens === 1) {
          renameSync(f.directory, `${f.directory}.preserved`);
          symlinkSync(`${f.directory}.preserved`, f.directory, "junction");
        }
      };
      expect(f.files.read(f.path)?.bytes.toString()).toBe(f.body);
      io.after = undefined;
      expect(io.opens).toBe(io.closes);
      expect(() => f.files.read(f.path)).toThrow();
    }
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

it("one synchronous operation re-observes only a walked directory, not its ancestors", () => {
  const f = fixture();
  const second = join(f.directory, "second.json");
  writeFileSync(second, "second bytes\n", { mode: 0o600 });
  const walks = new DirectoryWalks();
  reset(f.directory);
  expect(f.files.read(f.path, undefined, walks)?.bytes.toString()).toBe(f.body);
  // The first read walks root and every component once, then the file.
  expect(io.stats).toBe(1 + depth(f.directory) + 2);
  reset(f.directory);
  expect(f.files.read(second, undefined, walks)?.bytes.toString()).toBe(
    "second bytes\n",
  );
  // The directory itself once, then the file's selection and final stats.
  expect(io.selectedStats).toBe(1);
  expect(io.stats).toBe(3);
  expect(io.opens).toBe(1);
  expect(io.closes).toBe(1);
  // Without walks every call still walks in full.
  reset();
  expect(f.files.read(second)?.bytes.toString()).toBe("second bytes\n");
  expect(io.stats).toBe(1 + depth(f.directory) + 2);
});

it.each(["ancestor", "leaf"])(
  "a walked %s substituted for other content refuses inside the same operation",
  (location) => {
    const f = fixture();
    const walks = new DirectoryWalks();
    expect(f.files.read(f.path, undefined, walks)?.bytes.toString()).toBe(
      f.body,
    );
    const selected =
      location === "ancestor" ? dirname(f.directory) : f.directory;
    // Another directory tree with other bytes at the same relative path.
    const attacker = join(f.root, "attacker");
    const copy = join(attacker, relative(selected, f.path));
    mkdirSync(dirname(copy), { recursive: true, mode: 0o700 });
    writeFileSync(copy, "attacker bytes\n", { mode: 0o600 });
    renameSync(selected, `${selected}.preserved`);
    symlinkSync(attacker, selected, "junction");
    expect(() => f.files.read(f.path, undefined, walks)).toThrow();
    expect(() => f.files.directory(f.directory, false, walks)).toThrow();
    expect(readFileSync(copy, "utf8")).toBe("attacker bytes\n");
  },
);

it("an ancestor linked back to the same directory yields only genuine bytes, and the next operation refuses", () => {
  const f = fixture();
  const walks = new DirectoryWalks();
  expect(f.files.read(f.path, undefined, walks)?.bytes.toString()).toBe(f.body);
  const ancestor = dirname(f.directory);
  renameSync(ancestor, `${ancestor}.preserved`);
  symlinkSync(`${ancestor}.preserved`, ancestor, "junction");
  // Same resolved directory identity: the walked directory's own bytes.
  expect(f.files.read(f.path, undefined, walks)?.bytes.toString()).toBe(f.body);
  expect(() => f.files.read(f.path, undefined, new DirectoryWalks())).toThrow();
  expect(() => f.files.read(f.path)).toThrow();
});

it("a walked directory that disappears is absent again, not reused", () => {
  const f = fixture();
  const walks = new DirectoryWalks();
  expect(f.files.read(f.path, undefined, walks)).toBeDefined();
  renameSync(f.directory, `${f.directory}.preserved`);
  expect(f.files.read(f.path, undefined, walks)).toBeUndefined();
  expect(f.files.directory(f.directory, false, walks)).toBe(false);
});

it("an await closes the walks: the next read walks every ancestor again", async () => {
  const f = fixture();
  const walks = new DirectoryWalks();
  expect(f.files.read(f.path, undefined, walks)).toBeDefined();
  await Promise.resolve();
  reset();
  expect(f.files.read(f.path, undefined, walks)).toBeDefined();
  expect(io.stats).toBe(1 + depth(f.directory) + 2);
  // A later macrotask job: still stale, and a scope made there starts empty.
  const later = new DirectoryWalks();
  expect(f.files.read(f.path, undefined, later)).toBeDefined();
  await new Promise((resolve) => setImmediate(resolve));
  reset();
  expect(f.files.read(f.path, undefined, later)).toBeDefined();
  expect(io.stats).toBe(1 + depth(f.directory) + 2);
  reset();
  const fresh = new DirectoryWalks();
  expect(f.files.read(f.path, undefined, fresh)).toBeDefined();
  expect(io.stats).toBe(1 + depth(f.directory) + 2);
  if (process.platform === "win32") return;
  chmodSync(f.namespace, 0o755);
  expect(() => f.files.read(f.path, undefined, walks)).toThrow();
  expect(() => f.files.read(f.path, undefined, later)).toThrow();
});

it("inside one operation the walked directory's own mode is rechecked; an ancestor's is seen by the next operation", () => {
  if (process.platform === "win32") return;
  {
    const f = fixture();
    const walks = new DirectoryWalks();
    expect(f.files.read(f.path, undefined, walks)).toBeDefined();
    chmodSync(f.directory, 0o755);
    expect(() => f.files.read(f.path, undefined, walks)).toThrow();
  }
  {
    const f = fixture();
    const walks = new DirectoryWalks();
    expect(f.files.read(f.path, undefined, walks)).toBeDefined();
    chmodSync(f.namespace, 0o755);
    expect(f.files.read(f.path, undefined, walks)?.bytes.toString()).toBe(
      f.body,
    );
    expect(() =>
      f.files.read(f.path, undefined, new DirectoryWalks()),
    ).toThrow();
    expect(() => f.files.read(f.path)).toThrow();
  }
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

it("empty selected file still has a one-byte growth sentinel after the descriptor fstat", () => {
  const f = fixture("");
  reset();
  let injected = false;
  // Grow after the descriptor stat was selected, before allocation/read. The
  // one sentinel byte must catch it even when the selected file was empty.
  io.after = (op) => {
    if (op === "fstat" && io.fstats === 1 && !injected) {
      injected = true;
      writeFileSync(f.path, "x");
    }
  };
  expect(() => f.files.read(f.path, REGISTRY_BYTES)).toThrow();
  io.after = undefined;
  expect(injected).toBe(true);
  expect(io.opens).toBe(1);
  expect(io.closes).toBe(1);
  expect(readFileSync(f.path, "utf8")).toBe("x");
});

it.each(["stat", "open"])(
  "selected file symlink substitution after %s cannot be followed",
  (stage) => {
    const f = fixture();
    reset(f.path);
    let injected = false;
    // After the selection stat the no-follow open refuses; after the open the
    // final path identity check sees the link.
    io.after = (op, path) => {
      if (
        !injected &&
        path === f.path &&
        (stage === "stat"
          ? op === "stat" && io.selectedStats === 1
          : op === "open")
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
