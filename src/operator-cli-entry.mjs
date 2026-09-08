import path from "node:path";
import { inspectConsumer, inspectRuns } from "./operator-tools.ts";

const [command = "doctor", root = process.cwd()] = process.argv.slice(2);
try {
  if (!["doctor", "runs"].includes(command))
    throw new Error(
      "Usage: node --experimental-strip-types <cadence>/src/operator-cli.mjs doctor|runs [consumer-root]",
    );
  const result =
    command === "doctor"
      ? inspectConsumer(path.resolve(root))
      : inspectRuns(path.resolve(root));
  console.log(JSON.stringify(result, null, 2));
  if (command === "doctor" && !result.ok) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "operator-command-failed",
    }),
  );
  process.exitCode = 1;
}
