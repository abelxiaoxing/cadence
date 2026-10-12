import path from "node:path";
import { inspectConsumer, inspectRuns } from "./operator-tools.ts";

try {
  const [command = "doctor", root = process.cwd(), ...extra] =
    process.argv.slice(2);
  if (!["doctor", "runs"].includes(command) || extra.length)
    throw new Error("usage");
  const result =
    command === "doctor"
      ? inspectConsumer(path.resolve(root))
      : inspectRuns(path.resolve(root));
  console.log(JSON.stringify(result, null, 2));
} catch {
  // Do not print arbitrary filesystem/configuration text or credentials.
  console.error(
    JSON.stringify({
      ok: false,
      error: "operator-refused",
      usage: "node <cadence>/src/operator-cli.mjs doctor|runs [workspace]",
    }),
  );
  process.exitCode = 1;
}
