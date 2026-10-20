// Fixture only: exercise the actual 10s manager against delayed real startup.
import { managementMain } from "../../src/service/cli.ts";

await managementMain(
  process.argv.slice(2),
  new URL("./service-host-delayed.mjs", import.meta.url),
);
