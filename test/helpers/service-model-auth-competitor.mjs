// A second genuine public SDK client sharing ONLY this fabricated credential path.
import { join } from "node:path";
import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

try {
  const dir = join(process.argv[2], "home", ".pi", "agent");
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: join(dir, "models.json"),
    modelsStore: new InMemoryModelsStore(),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  if (runtime.getError()) throw new Error("configuration");
  const model = runtime.getModel("fixture", "fixed");
  if (!model) throw new Error("model");
  process.stdout.write("auth-requested\n");
  const auth = await runtime.getAuth(model, {
    signal: new AbortController().signal,
    minOAuthValidityMs: 121000,
  });
  if (auth?.auth.apiKey !== "FABRICATED_cadence_secret_DO_NOT_REPORT_873195")
    throw new Error("auth");
  process.stdout.write("coordinated\n");
} catch {
  process.stderr.write("competing-sdk-refused\n");
  process.exitCode = 1;
}
