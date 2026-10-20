// Internal ordinary-Node host. Startup secrets arrive only on anonymous stdin.

import { createServiceHost } from "./service/host.ts";
import { hostEnvironment, STARTUP_INPUT_BYTES } from "./service/runtime.ts";
import { parseWireJson } from "./service-contract.ts";

process.stdout.on("error", () => {}); // Initiating management client may detach.
try {
  if (!process.versions.node || process.versions.bun) throw new Error();
  hostEnvironment(process.env); // before the first dynamic SDK import
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > STARTUP_INPUT_BYTES) throw new Error();
    chunks.push(chunk);
  }
  const input = parseWireJson(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    STARTUP_INPUT_BYTES,
  );
  const host = await createServiceHost(input);
  process.stdout.write(
    `${JSON.stringify({ status: "ready", epoch: host.owner.lease.registration.epoch })}\n`,
  );
} catch {
  process.stderr.write('{"error":"service-host-refused"}\n');
  process.exitCode = 1;
}
