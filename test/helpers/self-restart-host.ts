/** A real source host whose owner faults at runtime. Its lifetime only
 * reports what the production lifetime would do, then exits. */
import { createServiceHost as createHost } from "../../src/service/host.ts";
import type { HostInput } from "../../src/service/runtime.ts";
import { runProcess } from "../../src/subagent-process.ts";
import { root, sourceContract } from "./source-build.ts";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input) as HostInput;
const report = (value: unknown) =>
  process.stdout.write(`${JSON.stringify(value)}\n`);
const host = await createHost(
  request,
  {
    contractHash: sourceContract,
    deferRuntime: true,
    webDirectory: `${root}/web/dist`,
  },
  {
    successor: (selected) => report({ successor: selected.workspace }),
    exit: (code) => {
      report({ exit: code });
      process.exit(code);
    },
  },
);
let pid = 0;
// A worker the owner launched (not tracked as accepted work): the fault must
// still stop it, from the process ledger.
void runProcess({
  command: process.execPath,
  args: ["-e", "setInterval(() => {}, 1000)"],
  cwd: request.workspace,
  timeoutMs: 600_000,
  signal: new AbortController().signal,
  onLifecycle: () => {},
});
await new Promise((resolve) => setTimeout(resolve, 300));
const ledger = host.coordination.files.read(
  `${host.coordination.files.namespace}/process-ledger-v1/${host.owner.lease.registration.epoch}.json`,
  65536,
);
pid = ledger ? JSON.parse(ledger.bytes.toString()).workers[0]?.pid : 0;
report({ ready: host.owner.lease.registration.epoch, worker: pid });
host.owner.quarantine();
