// Internal ordinary-Node host. Startup secrets arrive only on anonymous stdin.

import { createGateway } from "./service/gateway.ts";
import { createServiceHost } from "./service/host.ts";
import {
  hostEnvironment,
  STARTUP_INPUT_BYTES,
  startupReport,
} from "./service/runtime.ts";
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
  const host =
    input.kind === "workbench"
      ? await createGateway(
          input,
          new URL("./service-host.mjs", import.meta.url),
        )
      : await createServiceHost(input);
  process.stdout.write(
    `${JSON.stringify({ status: "ready", epoch: "epoch" in host ? host.epoch : host.owner.lease.registration.epoch })}\n`,
  );
} catch (error) {
  // The readiness channel carries the fixed code and stage, never error text.
  process.stdout.write(`${JSON.stringify(startupReport(error))}\n`);
  process.stderr.write('{"error":"service-host-refused"}\n');
  process.exitCode = 1;
}
