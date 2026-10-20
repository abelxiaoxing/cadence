#!/usr/bin/env node
import { managementMain } from "./service/cli.ts";

await managementMain(
  process.argv.slice(2),
  new URL("./service-host.mjs", import.meta.url),
);
