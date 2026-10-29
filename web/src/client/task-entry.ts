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
function active(signal: AbortSignal) {
  if (signal.aborted) throw new Error("canceled");
}
function sameEnvironment(a: ContextVersion, b: ContextVersion) {
  const environment = ({
    task: _task,
    controlRev: _control,
    ...rest
  }: ContextVersion) => rest;
  if (canonicalJson(environment(a)) !== canonicalJson(environment(b)))
    throw new Error("stale");
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
    throw new Error(reply.error.code);
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
    if (lookup.status !== "found") throw new Error("receipt-inconclusive");
    receipt = lookup.receipt;
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
  active(entry.signal);
  const proposal = await prepare(entry.client, entry.context, {
    kind: "create",
    taskKind: "code",
    goal: entry.goal,
  });
  if (proposal.kind === "error") throw new Error(proposal.error.code);
  const receipt = await published(entry, await submit(entry, proposal.value));
  if (receipt.created?.state !== "published")
    throw new Error("receipt-inconclusive");
  const taskId = receipt.created.taskId;
  const context = await current(entry, taskId);
  sameEnvironment(entry.context, context);
  const analysis = await prepare(entry.client, context, {
    kind: "generate-plan",
    taskId,
  });
  if (analysis.kind === "error") throw new Error(analysis.error.code);
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
  if (start.kind === "error") throw new Error(start.error.code);
  if (
    start.value.preflight.preview.readablePlan !== preview.action.plan ||
    canonicalJson(start.value.preflight.preview.graph) !==
      canonicalJson(preview.action.graph)
  )
    throw new Error("stale");
  await submit(entry, start.value);
}
