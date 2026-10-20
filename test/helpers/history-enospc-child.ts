/** Isolated namespace-only native filesystem qualification, NOT an admitted run.
 * The 256MiB admission floor stays enabled: this exercises HistoryFiles' actual
 * regular-file/append failure boundary directly on a bounded 16MiB tmpfs. */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statfsSync } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { HistoryFiles } from "../../src/history/files.ts";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { historyFixture } from "./history-fixture.ts";

const digest = (b: string | Buffer) =>
  createHash("sha256").update(b).digest("hex");
if (process.argv[2] === "read") {
  const files = HistoryFiles.open(
    new ServiceCoordination("/tmp/fixture/project", "/tmp/fixture/state"),
  );
  if (!files) throw Error("missing fixture");
  const state = files.inspect();
  process.stdout.write(
    JSON.stringify({ seq: state.committedSeq, tail: state.tail }),
  );
} else {
  const f = historyFixture({}, "/tmp/fixture");
  const floor = await f.writer.commit(f.intent);
  if (floor.status !== "uncertain" || !f.writer.quarantined)
    throw Error("floor bypassed");
  // Fresh lower-level fixture files, no accepted command/effect or resource-default override.
  const initial = await f.files.append(f.lease, f.files.inspect(), [
    {
      kind: "record",
      seq: "1",
      id: randomUUID(),
      value: { kind: "owner-epoch", epoch: f.link.epoch },
    },
  ]);
  const path = f.files.segmentPath(initial.segment),
    prefix = readFileSync(path),
    lock = readFileSync(f.c.store.lockPath);
  const text = "sanitized ordinary fixture text\n"
    .repeat(8192)
    .slice(0, 256 * 1024);
  let artifactCode: unknown = null,
    parts = 0;
  for (; parts < 80; parts++) {
    try {
      f.files.writeArtifact(
        f.lease,
        {
          runId: f.link.runId,
          artifactId: f.link.childRunId,
          part: parts,
          bytes: Buffer.byteLength(text),
          sha256: digest(text),
        },
        text,
      );
    } catch (error) {
      artifactCode =
        error && typeof error === "object" && "code" in error
          ? error.code
          : null;
      break;
    }
  }
  if (artifactCode !== "ENOSPC") throw Error("native artifact ENOSPC absent");
  let opened = 0,
    closed = 0,
    writeCode: unknown = null;
  const originalOpen = fs.open;
  fs.open = async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args),
      close = handle.close.bind(handle),
      write = handle.writeFile.bind(handle);
    opened++;
    handle.close = async () => {
      await close();
      closed++;
    };
    handle.writeFile = async (...args: Parameters<typeof handle.writeFile>) => {
      try {
        await write(...args);
      } catch (error) {
        writeCode =
          error && typeof error === "object" && "code" in error
            ? error.code
            : null;
        throw error;
      }
    };
    return handle;
  };
  syncBuiltinESMExports();
  let appendCode: unknown = null;
  try {
    await f.files.append(
      f.lease,
      initial,
      Array.from({ length: 100 }, (_, i) => ({
        kind: "record" as const,
        seq: String(i + 2),
        id: randomUUID(),
        value: { kind: "owner-epoch" as const, epoch: f.link.epoch },
      })),
    );
  } catch (error) {
    appendCode =
      error && typeof error === "object" && "code" in error ? error.code : null;
  }
  if (
    appendCode !== "ENOSPC" ||
    writeCode !== "ENOSPC" ||
    opened !== 1 ||
    closed !== 1
  )
    throw Error("native append/handle facts absent");
  if (
    !readFileSync(path).subarray(0, prefix.length).equals(prefix) ||
    !readFileSync(f.c.store.lockPath).equals(lock)
  )
    throw Error("prior bytes changed");
  const read = spawnSync(process.execPath, [process.argv[1], "read"], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (read.status !== 0 || read.signal !== null || read.stderr)
    throw Error("original cold read failed");
  const cold = JSON.parse(read.stdout);
  if (cold.seq !== "1" || !cold.tail) throw Error("cold prefix not preserved");
  process.stdout.write(
    JSON.stringify({
      native: true,
      node: process.version,
      platform: process.platform,
      sizeBytes: Number(
        statfsSync("/tmp", { bigint: true }).blocks *
          statfsSync("/tmp", { bigint: true }).bsize,
      ),
      admissionFloorRefused: true,
      parts,
      artifactCode,
      appendCode,
      writeCode,
      opened,
      closed,
      prefixPreserved: true,
      locksPreserved: true,
      coldRead: {
        ...cold,
        exitCode: read.status,
        signal: read.signal,
        stderr: read.stderr,
      },
    }),
  );
}
