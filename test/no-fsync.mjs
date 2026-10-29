// Test workers only: fsync becomes a no-op. Crash tests kill processes, whose
// written bytes stay in the page cache; no test simulates power loss, so a real
// disk flush only adds wait. Native children (owners, CLIs) still flush.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

fs.fsyncSync = () => {};
fs.fdatasyncSync = () => {};
fs.fsync = (_fd, callback) => process.nextTick(callback, null);
fs.fdatasync = (_fd, callback) => process.nextTick(callback, null);
const handle = await fs.promises.open(new URL(import.meta.url), "r");
const prototype = Object.getPrototypeOf(handle);
await handle.close();
prototype.sync = async () => {};
prototype.datasync = async () => {};
syncBuiltinESMExports();
