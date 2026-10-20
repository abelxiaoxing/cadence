// Fixture-only startup scheduling delay. Actual host/factory, no fake readiness.
import { createServiceHost } from "./source-host.ts";

let input = "";
for await (const chunk of process.stdin) input += chunk;
process.stdout.on("error", () => {});
await new Promise((resolve) => setTimeout(resolve, 11000));
const host = await createServiceHost(JSON.parse(input));
process.stdout.write(
  `${JSON.stringify({ status: "ready", epoch: host.owner.lease.registration.epoch })}\n`,
);
