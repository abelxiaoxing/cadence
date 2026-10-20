import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HistoryReader } from "../../src/history/reader.ts";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { hash } from "../../src/service/private-files.ts";
import { ContractError, decodeCursor } from "../../src/service-contract.ts";

const directory = process.argv[2];
const reader = HistoryReader.open(
  new ServiceCoordination(join(directory, "project"), join(directory, "state")),
);
const cursor = decodeCursor(
  JSON.parse(readFileSync(join(directory, "cold-cursor.json"), "utf8")),
);
const started = performance.now();
try {
  if (!reader) throw new Error("absent");
  const result = await reader.detail(cursor);
  console.log(
    JSON.stringify({
      status: "read",
      bytes: Buffer.byteLength(result.text),
      sha256: hash(result.text),
      elapsedMs: performance.now() - started,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      status: error instanceof ContractError ? error.code : "failed",
      elapsedMs: performance.now() - started,
    }),
  );
  process.exitCode = 1;
}
