// Ordinary Node host composition with explicitly fabricated history inputs.
// Not an action owner, public task route, or model inference fixture.
import { randomUUID } from "node:crypto";
import type { AdmissionIntent } from "../../src/service/ports.ts";
import type { HostInput } from "../../src/service/runtime.ts";
import type { ContextVersion } from "../../src/service-contract.ts";
import { retainedText } from "./history-read-fixture.ts";
import { createServiceHost } from "./source-host.ts";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input) as HostInput;
const host = await createServiceHost(request);
if (process.argv[2] === "lost-stop") {
  host.http.server.prependListener("request", (req, res) => {
    if (req.url === "/local/v1/admin/stop")
      res.end = (() => {
        res.destroy();
        return res;
      }) as typeof res.end;
  });
  process.stdout.write('{"ready":true}\n');
} else {
  const taskId = randomUUID(),
    runId = randomUUID(),
    childRunId = randomUUID();
  const context: ContextVersion = {
    epoch: host.owner.lease.registration.epoch,
    workspaceId: host.reader.files.format.workspaceId,
    accessGeneration: 1,
    configRev: 1,
    controlRev: 1,
    cwdId: randomUUID(),
    checkEnvGeneration: 1,
    checkoutGeneration: 0,
    observation: { identity: "a".repeat(64), complete: true },
    model: {
      sourceSelectionId: randomUUID(),
      provider: "fixture",
      model: "not-resolved",
      api: "openai-completions",
      thinking: "off",
    },
    task: {
      id: taskId,
      kind: "research",
      revision: 1,
      identity: "a".repeat(64),
      graphRevision: null,
      graphIdentity: null,
    },
  };
  const intent: AdmissionIntent = {
    commandId: randomUUID(),
    operationId: randomUUID(),
    runId,
    createdTaskId: null,
    identity: {
      kind: "action",
      expected: context,
      action: { kind: "generate-plan", taskId },
    },
  };
  const f = {
    dir: request.workspace,
    root: request.workspace,
    c: host.coordination,
    lease: host.owner.lease,
    files: host.reader.files,
    writer: host.writer,
    context,
    intent,
    link: { epoch: context.epoch, taskId, runId, childRunId },
  };
  // No fabricated current context is supplied to the host projection or admission.
  const retained = await retainedText(
    f,
    `${"retained plain context. ".repeat(420000)}HOST-HISTORY-NEEDLE`,
  );
  process.stdout.write(
    `${JSON.stringify({ taskId, storeId: host.reader.storeId, snapshotSeq: host.writer.committedSeq, ...retained })}\n`,
  );
}
