/** Native local management only. Never imported by HTTP or exposed as a route. */
import { isatty } from "node:tty";
import { HistoryRecovery } from "../history/recovery.ts";
import { ContractError, LIMITS } from "../service-contract.ts";
import { diagnosticText } from "../verification-diagnostics.ts";
import type { ServiceCoordination } from "./coordination.ts";
import {
  inspectRecovery,
  type RecoveryInspection,
  resolveRecovery,
} from "./recovery.ts";

const warning =
  "PID absence is not proof that descendants stopped or credential writes settled. Inspect/stop old processes externally, independently inspect the selected Pi credential store and SDK locks, and inspect retained history/storage. Cadence does not kill, repair, reset, migrate or certify those resources. Unknown historical outcomes remain unknown. A new Start is required.";
function native(): void {
  if (!isatty(0) || !isatty(1) || !process.stdin.isTTY || !process.stdout.isTTY)
    throw new ContractError("forbidden");
}
async function confirm(expected: RecoveryInspection): Promise<() => void> {
  native();
  if (process.stdin.readableLength) throw new ContractError("forbidden");
  const identity = JSON.stringify(expected);
  const deadline = performance.now() + LIMITS.grantMs;
  const prompts = [
    [
      "Confirm old processes stopped externally; acknowledge escaped-descendant uncertainty. Type processes",
      "processes",
    ],
    [
      "Confirm independent credential/refresh/writeback inspection; PID absence does not settle auth. Type credentials",
      "credentials",
    ],
    [
      "Confirm independent storage inspection; preserve damaged bytes and unknown outcomes. Type storage",
      "storage",
    ],
    [
      `Release ONLY the displayed unchanged service-owned fences. Type resolve ${expected.epoch}`,
      `resolve ${expected.epoch}`,
    ],
  ];
  await new Promise<void>((resolve, reject) => {
    let index = 0,
      line = "",
      done = false;
    const raw = process.stdin.isRaw;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.removeListener("data", input);
      process.stdin.removeListener("end", fail);
      process.stdin.removeListener("error", fail);
      process.stdin.setRawMode(raw);
      process.stdin.pause();
      process.stdout.write("\x1b[?2004l\n");
      if (ok) resolve();
      else reject(new ContractError("forbidden"));
    };
    const fail = () => finish(false);
    const show = () => process.stdout.write(`${prompts[index]?.[0]}: `);
    const input = (chunk: Buffer) => {
      if (performance.now() >= deadline || chunk.length > 128) return fail();
      for (let n = 0; n < chunk.length; n++) {
        const byte = chunk[n];
        if (byte === 13 || byte === 10) {
          // A multiline paste/queued second answer cannot authorize another step.
          if (n !== chunk.length - 1 || line !== prompts[index]?.[1])
            return fail();
          line = "";
          process.stdout.write("\n");
          if (++index === prompts.length) return finish(true);
          show();
        } else if (byte === 127) {
          line = line.slice(0, -1);
        } else if (
          byte !== undefined &&
          byte >= 32 &&
          byte <= 126 &&
          line.length < 80
        ) {
          line += String.fromCharCode(byte);
        } else return fail(); // includes Escape/bracketed paste/Ctrl-C and invalid UTF-8
      }
    };
    const timer = setTimeout(fail, LIMITS.grantMs);
    process.stdin.setRawMode(true);
    process.stdout.write("\x1b[?2004h");
    process.stdin
      .on("data", input)
      .once("end", fail)
      .once("error", fail)
      .resume();
    show();
  });
  return () => {
    native();
    if (performance.now() >= deadline || JSON.stringify(expected) !== identity)
      throw new ContractError("stale");
  };
}
export async function localRecovery(
  c: ServiceCoordination,
  operation: "inspect" | "resolve",
): Promise<unknown> {
  if (operation === "resolve") native(); // no filesystem writes on nonterminal invocation
  const history = new HistoryRecovery(c);
  const expected = await inspectRecovery(c, history);
  const registration = c.recoverySnapshot().registration;
  const view = {
    ...expected,
    process: {
      pid: registration.pid,
      host: diagnosticText(registration.host, 255),
    },
    notice: warning,
  };
  if (operation === "inspect") return view;
  process.stdout.write(`${JSON.stringify(view)}\n`);
  if (expected.owner !== "absent") throw new ContractError("quarantine");
  const assertFresh = await confirm(expected);
  return resolveRecovery(
    c,
    {
      expected,
      acknowledgeEscapedProcesses: true,
      processes: "externally-resolved",
      credentials: "independently-resolved",
      storage: "independently-resolved",
      assertLocalAuthority: (choice) => {
        assertFresh();
        if (JSON.stringify(choice) !== JSON.stringify(expected))
          throw new ContractError("stale");
      },
    },
    history,
  );
}
