// Test-only native Node process, bundled from local sources by the test.
// This is not a production service/SDK launcher or an installed fallback.
import { ServiceCoordination } from "../../src/service/coordination.ts";

const [root, stateHome, port] = process.argv.slice(2);
const coordination = new ServiceCoordination(root, stateHome);
let lease;
process.on("message", (message) => {
  if (message === "start") {
    try {
      lease = coordination.acquire({
        schema: "cadence-service-owner-config/1",
        endpoint: `http://127.0.0.1:${port}`,
        policyIdentity: "a".repeat(64),
      });
      process.send({ type: "acquired", epoch: lease.registration.epoch });
    } catch {
      process.send({ type: "refused" });
    }
  } else if (message === "legacy") {
    try {
      const lock = coordination.store.acquire();
      coordination.store.release(lock);
      process.send({ type: "legacy-acquired" });
    } catch {
      process.send({ type: "legacy-refused" });
    }
  } else if (message === "release") {
    try {
      lease?.release();
      process.disconnect();
    } catch {
      process.exitCode = 1;
      process.disconnect();
    }
  } else if (message === "crash") {
    // Deliberate unclean owner departure; never call this a stopped service.
    process.exit(17);
  }
});
process.send({ type: "boot" });
