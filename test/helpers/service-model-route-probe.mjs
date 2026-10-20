// Capability probe only: stock public SDK, fabricated files, no dispatcher change.
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const dir = process.argv.at(-1);
const guardCase = process.argv[2];
if (guardCase.startsWith("guard-denied-")) {
  let denied = false;
  try {
    if (guardCase === "guard-denied-read")
      readFileSync(join(dir, "..", "outside-fixture-auth.json"));
    else net.connect({ host: "127.0.0.1", port: 0 });
  } catch {
    denied = true;
  }
  // Parent requires the guard's exit91 (not an ENOENT or connection refusal).
  process.stdout.write(`${JSON.stringify({ denied })}\n`);
} else {
  let resolved = false;
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
      modelsStore: new InMemoryModelsStore(),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const model = runtime.getModel("fixture", "fixed");
    if (!model || runtime.getError()) throw new Error("fixture");
    const auth = await runtime.getAuth(model, {
      signal: new AbortController().signal,
      minOAuthValidityMs: 121000,
    });
    resolved = auth?.auth.apiKey === "fabricated-probe-access";
  } catch {
    /* A fixed502 is a routing observation, not successful inference. */
  }
  process.stdout.write(
    `${JSON.stringify({ resolved, startupCapability: process.allowedNodeEnvironmentFlags.has("--use-env-proxy"), node: process.versions.node })}\n`,
  );
}
