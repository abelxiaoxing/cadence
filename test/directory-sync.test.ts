import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../src/artifact-store.ts";
import { WorkspaceStore } from "../src/workspace-store.ts";

vi.mock("node:fs", async (original) => {
  const actual = await original<typeof fs>();
  return {
    ...actual,
    fsyncSync: vi.fn(actual.fsyncSync),
    openSync: vi.fn(actual.openSync),
    closeSync: vi.fn(actual.closeSync),
  };
});
const roots: string[] = [];
const stores: Array<{ close(): void }> = [];
beforeEach(async () => {
  const actual = await vi.importActual<typeof fs>("node:fs");
  vi.mocked(fs.fsyncSync).mockReset().mockImplementation(actual.fsyncSync);
  vi.mocked(fs.openSync).mockReset().mockImplementation(actual.openSync);
  vi.mocked(fs.closeSync).mockReset().mockImplementation(actual.closeSync);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function root() {
  const value = fs.mkdtempSync(path.join(tmpdir(), "cadence-sync-"));
  roots.push(value);
  return value;
}
function failure(code = "EPERM", syscall = "fsync") {
  return Object.assign(
    new Error(`${code}: operation not permitted, ${syscall}`),
    { code, syscall },
  );
}
async function injectDirectoryFailure(platform: string, code = "EPERM") {
  vi.stubGlobal(
    "process",
    Object.create(process, { platform: { value: platform } }),
  );
  const actual = await vi.importActual<typeof fs>("node:fs");
  vi.mocked(fs.fsyncSync).mockImplementation((fd) => {
    if (fs.fstatSync(fd).isDirectory()) throw failure(code);
    actual.fsyncSync(fd);
  });
}

describe("directory durability compatibility", () => {
  it("publishes and reopens verified artifacts and workspace revisions with Windows directory EPERM", async () => {
    await injectDirectoryFailure("win32");
    const base = root();
    const artifacts = new ArtifactStore(path.join(base, "artifacts"));
    const bytes = Buffer.from("retained evidence\n");
    const identity = artifacts.put(bytes);
    expect(artifacts.retain(identity.hash)).toBe(1);
    const workspaces = new WorkspaceStore(
      path.join(base, "workspaces"),
      artifacts,
    );
    // An empty baseline avoids Git/platform emulation in this syscall regression.
    const { execFileSync } = await import("node:child_process");
    const consumer = root();
    execFileSync("git", ["init", "-q", consumer]);
    const baseline = workspaces.captureBaseline({ consumerRoot: consumer });
    const revision = workspaces.createRevision({
      parentRevisionId: baseline.revisionId,
      changes: { "a.txt": bytes },
    });
    const reopened = new ArtifactStore(path.join(base, "artifacts"));
    expect(reopened.read(identity.hash)).toEqual(bytes);
    expect(reopened.referenceCount(identity.hash)).toBeGreaterThanOrEqual(1);
    expect(
      new WorkspaceStore(path.join(base, "workspaces"), reopened).getRevision(
        revision.revisionId,
      ),
    ).toEqual(revision);
    expect(fs.fsyncSync).toHaveBeenCalled();
  });

  it.each([
    ["linux", "EPERM"],
    ["darwin", "EPERM"],
    ["win32", "EIO"],
    ["win32", "EACCES"],
  ])("propagates directory %s/%s", async (platform, code) => {
    await injectDirectoryFailure(platform, code);
    const artifacts = new ArtifactStore(path.join(root(), "artifacts"));
    expect(() => artifacts.put(Buffer.from("evidence"))).toThrow(code);
  });

  it("never treats a Windows regular-file fsync EPERM as unsupported", async () => {
    await injectDirectoryFailure("win32");
    vi.mocked(fs.fsyncSync).mockImplementation(() => {
      throw failure();
    });
    const artifacts = new ArtifactStore(path.join(root(), "artifacts"));
    expect(() => artifacts.put(Buffer.from("evidence"))).toThrow("EPERM");
  });
});

describe("narrow directory barrier boundary", () => {
  it("reports unsupported only for a Windows directory fsync and always closes", async () => {
    await injectDirectoryFailure("win32");
    const { syncDirectory } = await import("../src/directory-sync.ts");
    expect(syncDirectory(root())).toBe("unsupported-directory-barrier");
    const descriptor = vi.mocked(fs.fsyncSync).mock.lastCall?.[0];
    expect(fs.closeSync).toHaveBeenCalledWith(descriptor);
  });

  it("propagates directory open EPERM rather than hiding an access failure", async () => {
    await injectDirectoryFailure("win32");
    const { syncDirectory } = await import("../src/directory-sync.ts");
    vi.mocked(fs.openSync).mockImplementation(() => {
      throw failure("EPERM", "open");
    });
    expect(() => syncDirectory(root())).toThrow("EPERM");
  });

  it("propagates close errors even after unsupported directory fsync", async () => {
    await injectDirectoryFailure("win32");
    const actual = await vi.importActual<typeof fs>("node:fs");
    vi.mocked(fs.closeSync).mockImplementation((fd) => {
      actual.closeSync(fd);
      throw failure("EIO", "close");
    });
    const { syncDirectory } = await import("../src/directory-sync.ts");
    expect(() => syncDirectory(root())).toThrow("EIO");
  });

  it("does not suppress EPERM from another syscall or from a regular descriptor", async () => {
    await injectDirectoryFailure("win32");
    const { syncDirectory } = await import("../src/directory-sync.ts");
    vi.mocked(fs.fsyncSync).mockImplementation(() => {
      throw failure("EPERM", "other");
    });
    expect(() => syncDirectory(root())).toThrow("EPERM");
    vi.mocked(fs.fsyncSync).mockImplementation(() => {
      throw failure();
    });
    const target = path.join(root(), "regular");
    fs.writeFileSync(target, "bytes");
    expect(() => syncDirectory(target)).toThrow("EPERM");
  });

  it("uses native file flush/publication and directory capability on the actual platform", async () => {
    const actual = await vi.importActual<typeof fs>("node:fs");
    vi.mocked(fs.fsyncSync).mockImplementation(actual.fsyncSync);
    vi.mocked(fs.openSync).mockImplementation(actual.openSync);
    vi.mocked(fs.closeSync).mockImplementation(actual.closeSync);
    const { syncDirectory } = await import("../src/directory-sync.ts");
    const base = root();
    const artifacts = new ArtifactStore(path.join(base, "artifacts"));
    const bytes = Buffer.from("native retained evidence");
    const identity = artifacts.put(bytes);
    expect(
      new ArtifactStore(path.join(base, "artifacts")).read(identity.hash),
    ).toEqual(bytes);
    expect(syncDirectory(base)).toBe(
      process.platform === "win32" ? "unsupported-directory-barrier" : "synced",
    );
  });
});

describe("apply journal retains transaction safety", () => {
  it.each(["windows-unsupported", "directory-eio", "file-eperm"])(
    "recovers after %s without losing rollback evidence",
    async (fault) => {
      const { execFileSync } = await import("node:child_process");
      const { ApplyTransaction, verifyCumulativeRevision } = await import(
        "../src/apply-transaction.ts"
      );
      const consumerRoot = root();
      execFileSync("git", ["init", "-q", consumerRoot]);
      fs.writeFileSync(path.join(consumerRoot, "a.txt"), "before\n");
      execFileSync("git", ["-C", consumerRoot, "add", "a.txt"]);
      const base = root();
      const artifacts = new ArtifactStore(path.join(base, "artifacts"));
      const workspaces = new WorkspaceStore(
        path.join(base, "workspaces"),
        artifacts,
      );
      const baseline = workspaces.captureBaseline({ consumerRoot });
      const final = workspaces.createRevision({
        parentRevisionId: baseline.revisionId,
        changes: { "a.txt": Buffer.from("after\n") },
      });
      const verification = await verifyCumulativeRevision({
        workspaceStore: workspaces,
        revisionId: final.revisionId,
        verificationId: "fixture-verifier",
        execute: async () => ({
          ok: true,
          exitCode: 0,
          classification: "expected-green",
        }),
      });
      if (!verification.ok) throw new Error("fixture-verification-failed");
      await injectDirectoryFailure("win32");
      const actual = await vi.importActual<typeof fs>("node:fs");
      let injected = false;
      const options = {
        root: path.join(base, "transactions"),
        artifacts,
        workspaces,
      };
      const transaction = new ApplyTransaction({
        ...options,
        hooks: {
          beforeFileMutation: () => {
            if (fault === "windows-unsupported") return;
            vi.mocked(fs.fsyncSync).mockImplementation((fd) => {
              const directory = fs.fstatSync(fd).isDirectory();
              if (!injected && directory === (fault === "directory-eio")) {
                injected = true;
                throw failure(directory ? "EIO" : "EPERM");
              }
              if (directory) throw failure();
              actual.fsyncSync(fd);
            });
          },
          afterFileMutationBeforeSave: () => {
            if (fault === "windows-unsupported")
              throw new Error("process-stop-after-publication");
          },
        },
      });
      stores.push(transaction);
      await transaction.prepare({
        transactionId: "tx-sync",
        consumerRoot,
        baselineRevisionId: baseline.revisionId,
        finalRevisionId: final.revisionId,
        boundPaths: ["a.txt"],
        verificationFact: verification.fact,
      });
      await expect(transaction.apply("tx-sync")).rejects.toThrow(
        fault === "windows-unsupported"
          ? "process-stop-after-publication"
          : fault === "directory-eio"
            ? "EIO"
            : "EPERM",
      );
      expect(transaction.status("tx-sync")).toMatchObject({
        rollbackRetained: true,
      });
      if (fault === "windows-unsupported")
        expect(fs.readFileSync(path.join(consumerRoot, "a.txt"), "utf8")).toBe(
          "after\n",
        );
      else {
        // The CAS claim is durably journaled before replacement publication.
        expect(fs.existsSync(path.join(consumerRoot, "a.txt"))).toBe(false);
        const claim = fs
          .readdirSync(consumerRoot)
          .find((name) => name.endsWith(".apply-claim"));
        expect(claim).toBeDefined();
        expect(
          fs.readFileSync(path.join(consumerRoot, claim as string), "utf8"),
        ).toBe("before\n");
      }
      await injectDirectoryFailure("win32");
      transaction.close();
      const reopened = new ApplyTransaction(options);
      stores.push(reopened);
      await expect(reopened.recover("tx-sync")).resolves.toMatchObject({
        ok: true,
        state: "completed",
      });
      expect(fs.readFileSync(path.join(consumerRoot, "a.txt"), "utf8")).toBe(
        "after\n",
      );
      expect(reopened.status("tx-sync")).toMatchObject({
        rollbackRetained: false,
      });
      await expect(reopened.recover("tx-sync")).resolves.toMatchObject({
        ok: true,
        replayed: true,
      });
    },
  );
});
