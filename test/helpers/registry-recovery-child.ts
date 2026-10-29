import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { encoded } from "../../src/service/private-files.ts";

const [root, state, mode] = process.argv.slice(2);
if (!root || !state) throw new Error("fixture arguments");
const c = new ServiceCoordination(root, state);
if (mode === "partial") {
  c.acquire(
    {
      schema: "cadence-service-owner-config/1",
      endpoint: "http://127.0.0.1:17423",
      policyIdentity: "a".repeat(64),
    },
    undefined,
    () => process.exit(77),
  );
} else if (mode === "interrupt" || mode === "resolve") {
  const expected = c.inspectRegistryRecovery();
  if (mode === "interrupt") c.files.remove = () => process.exit(77);
  // Fixture-only authority; product CLI requires genuine native confirmations.
  console.log(JSON.stringify(c.resolveRegistryRecovery(expected, () => {})));
} else {
  if (mode === "reserved")
    c.acquire({
      schema: "cadence-service-owner-config/1",
      endpoint: "http://127.0.0.1:17423",
      policyIdentity: "a".repeat(64),
    });
  c.files.create(
    join(c.registryDirectory, "registry.lock"),
    encoded({
      schema: "cadence-service-registry-lock/1",
      token: randomUUID(),
      pid: process.pid,
      host: hostname(),
    }),
  );
  process.exit(77);
}
