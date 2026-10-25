#!/usr/bin/env node
// `cadence-service`, the earlier name of `cadence`. Its own file: `bun pm pack`
// writes a file once per bin name, and the package audit refuses duplicates.
await import("./service-cli.mjs");
