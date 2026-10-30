import { canonicalJson } from "../../../src/worker-public.mjs";
import type { ContextVersion, Receipt, ServiceClient } from "../types";
import {
  type CommandObservation,
  confirm,
  type PreparedAction,
  prepare,
} from "./actions.ts";

interface Entry {
  client: ServiceClient;
  storeId: string;
  signal: AbortSignal;
  observe(value: CommandObservation): void;
}
type Field = keyof ContextVersion;
function active(signal: AbortSignal) {
  if (signal.aborted) throw new Error("canceled");
}
/** Names of the context fields that differ; a diagnosis, never a retry. */
function drift(a: ContextVersion, b: ContextVersion): Field[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Field[]);
  return [...keys].filter(
    (key) => canonicalJson(a[key] ?? null) !== canonicalJson(b[key] ?? null),
  );
}
function stale(fields: Field[]) {
  return new Error(fields.length ? `stale: ${fields.join(", ")}` : "stale");
}
function bind(a: ContextVersion, b: ContextVersion, free: readonly Field[]) {
  const fields = drift(a, b).filter((key) => !free.includes(key));
  if (fields.length) throw stale(fields);
}
const sameEnvironment = (a: ContextVersion, b: ContextVersion) =>
  bind(a, b, ["task", "controlRev"]);
/** Task Send binds the project, access and model the user saw. The working
 * tree is observed again at Send: ordinary editing moves it, and only plan
 * approval (not readonly creation and analysis) binds it. */
const sameSend = (a: ContextVersion, b: ContextVersion) =>
  bind(a, b, ["task", "controlRev", "observation", "checkoutGeneration"]);
async function workspace(entry: Entry) {
  active(entry.signal);
  const reply = await entry.client.workspace(entry.signal);
  active(entry.signal);
  if (reply.kind === "error") throw new Error(reply.error.code);
  if (reply.value.context.status !== "available")
    throw new Error("unavailable");
  return reply.value.context.version;
}
/** A stale refusal names what moved since `expected`, from one more readonly
 * observation; nothing is retried. */
async function refusal(entry: Entry, expected: ContextVersion, code: string) {
  if (code !== "stale") return new Error(code);
  try {
    return stale(
      drift(
        expected,
        expected.task
          ? await current(entry, expected.task.id)
          : await workspace(entry),
      ),
    );
  } catch {
    return new Error("stale");
  }
}
async function submit(
  entry: Entry,
  prepared: PreparedAction,
): Promise<Receipt> {
  active(entry.signal);
  if (Date.now() >= Date.parse(prepared.preflight.expiresAt))
    throw new Error("expired");
  entry.observe({
    commandId: prepared.commandId,
    error: "Admission pending/unknown — observe this exact receipt.",
  });
  const reply = await confirm(entry.client, prepared);
  if (reply.kind === "error") {
    entry.observe({
      commandId: prepared.commandId,
      error: `${reply.error.code}; effect ${reply.error.effect}`,
    });
    throw await refusal(
      entry,
      prepared.preflight.preview.version,
      reply.error.code,
    );
  }
  entry.observe({ commandId: prepared.commandId, receipt: reply.value });
  active(entry.signal);
  if (reply.value.admission !== "accepted")
    throw new Error(reply.value.admission);
  return reply.value;
}
async function published(entry: Entry, initial: Receipt): Promise<Receipt> {
  let receipt = initial;
  const deadline = Date.now() + 30000;
  while (receipt.publication === "pending" && Date.now() < deadline) {
    active(entry.signal);
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    active(entry.signal);
    const lookup = await entry.client.receipt(receipt.commandId, entry.signal);
    active(entry.signal);
    entry.observe({ commandId: receipt.commandId, lookup });
    if (lookup.status === "absent") throw new Error("receipt-inconclusive");
    // Passive reads stay inconclusive while publication is fenced; observing
    // again is readonly and never repeats the accepted action.
    if (lookup.status === "found") receipt = lookup.receipt;
  }
  if (receipt.admission !== "accepted" || receipt.publication !== "published")
    throw new Error(
      "Publication unconfirmed. Observe the original receipt; do not repeat the action.",
    );
  return receipt;
}
async function current(entry: Entry, taskId: string) {
  active(entry.signal);
  const reply = await entry.client.current(
    { storeId: entry.storeId, taskId },
    entry.signal,
  );
  active(entry.signal);
  if (reply.kind === "error") throw new Error(reply.error.code);
  if (reply.value.context.status !== "available")
    throw new Error("unavailable");
  const context = reply.value.context.version;
  if (context.task?.id !== taskId) throw new Error("stale");
  return context;
}

/** Explicit Send authorizes creation and readonly analysis only, never editing. */
export async function beginTask(
  entry: Entry & { context: ContextVersion; goal: string },
): Promise<string> {
  const sent = await workspace(entry);
  sameSend(entry.context, sent);
  const proposal = await prepare(entry.client, sent, {
    kind: "create",
    taskKind: "code",
    goal: entry.goal,
  });
  if (proposal.kind === "error")
    throw await refusal(entry, sent, proposal.error.code);
  const receipt = await published(entry, await submit(entry, proposal.value));
  if (receipt.created?.state !== "published")
    throw new Error("receipt-inconclusive");
  const taskId = receipt.created.taskId;
  const context = await current(entry, taskId);
  sameSend(sent, context);
  const analysis = await prepare(entry.client, context, {
    kind: "generate-plan",
    taskId,
  });
  if (analysis.kind === "error")
    throw await refusal(entry, context, analysis.error.code);
  await submit(entry, analysis.value);
  return taskId;
}

/** One explicit plan approval covers Save and Start of these exact reviewed bytes. */
export async function approvePlan(
  entry: Entry & { prepared: PreparedAction },
): Promise<void> {
  const { prepared } = entry;
  const preview = prepared.preflight.preview;
  if (preview.action.kind !== "save-plan") throw new Error("invalid");
  await published(entry, await submit(entry, prepared));
  const context = await current(entry, preview.action.taskId);
  sameEnvironment(preview.version, context);
  if (
    context.task?.kind !== preview.version.task?.kind ||
    context.task?.revision !== (preview.version.task?.revision ?? 0) + 1
  )
    throw new Error("stale");
  const start = await prepare(entry.client, context, {
    kind: "start",
    taskId: preview.action.taskId,
  });
  if (start.kind === "error")
    throw await refusal(entry, context, start.error.code);
  if (
    start.value.preflight.preview.readablePlan !== preview.action.plan ||
    canonicalJson(start.value.preflight.preview.graph) !==
      canonicalJson(preview.action.graph)
  )
    throw new Error("stale");
  await submit(entry, start.value);
}
