/** Deterministic workflow inspection, independent of model availability and mode. */
import { type NativeViews, pretty, value } from "./native-history.ts";
import type { WorkbenchResult } from "./service/contracts/workbench.ts";
import type { ServiceClient } from "./service-client.ts";
import { ContractError } from "./service-contract.ts";

export async function workflowDetails(
  client: ServiceClient,
  ui: NativeViews,
  id: string,
): Promise<void> {
  for (;;) {
    const view = value(
      await client.workbenchRead({ kind: "workflow", id }, ui.signal),
    );
    ui.current();
    if (
      view.kind !== "workflow" ||
      view.response.type !== "run" ||
      view.response.run.id !== id
    )
      throw new ContractError("invalid");
    const run = view.response.run;
    await ui.show(
      `${run.goal}\n${run.id} • ${run.status} / ${run.phase}\n${run.notice}\nMerged commit: ${run.mergedCommit ?? "none"}\nAutomatic Agent review is not human review. Step summaries are previews; select a step for its retained result.\n${pretty(run.steps)}`,
    );
    const labels = run.steps.map(
      (s, i) => `${i + 1}. ${s.kind} • ${s.id} • ${s.status}`,
    );
    const selected = await ui.select("Workflow details • readonly", [
      ...labels,
      "Refresh",
      "Return",
    ]);
    if (selected === "Refresh") continue;
    if (!selected || !labels.includes(selected)) return;
    const step = run.steps[labels.indexOf(selected)];
    const choice = await ui.select("Retained step evidence", [
      "Full result",
      ...(step.childRunId ? ["Subagent transcript"] : []),
      "Return",
    ]);
    if (choice === "Full result") {
      const result = value(
        await client.workbenchRead(
          { kind: "workflow-detail", id, stepId: step.id },
          ui.signal,
        ),
      );
      ui.current();
      if (result.kind !== "file" || result.path !== `workflow/${id}/${step.id}`)
        throw new ContractError("invalid");
      await ui.show(
        `${result.limited ? "Limited retained result" : "Retained result"}\n${result.text}`,
      );
    } else if (choice === "Subagent transcript") {
      const result = value(
        await client.workbenchRead(
          { kind: "workflow-transcript", id, stepId: step.id },
          ui.signal,
        ),
      );
      ui.current();
      if (
        result.kind !== "workflow-transcript" ||
        result.runId !== id ||
        result.stepId !== step.id
      )
        throw new ContractError("invalid");
      const turn = result.turn;
      await ui.show(
        turn
          ? `${turn.status}\n${turn.notice}\nOmitted content: ${pretty(turn.omitted)}\n${turn.items.map((item) => `${item.role} ${item.name}${item.error ? " (error)" : ""}\n${item.args}\n${item.text}`).join("\n\n")}`
          : "Transcript unavailable; no outcome inferred.",
      );
    }
  }
}
export async function workflowHistory(
  client: ServiceClient,
  ui: NativeViews,
): Promise<void> {
  let after: string | null = null;
  let scan: string | undefined;
  const previous: (string | null)[] = [];
  for (;;) {
    const page: WorkbenchResult = value(
      await client.workbenchRead(
        { kind: "workflow-history", after, ...(scan ? { scan } : {}) },
        ui.signal,
      ),
    );
    ui.current();
    if (page.kind === "workflow-history-progress") {
      if (page.after !== after) throw new ContractError("invalid");
      const choice = await ui.select(
        "Scanning workflow IDs • no complete page yet",
        ["Continue scanning", "Return"],
      );
      if (choice !== "Continue scanning") return;
      scan = page.scan;
      continue;
    }
    if (page.kind !== "workflow-history") throw new ContractError("invalid");
    scan = undefined;
    const labels = page.entries.map(
      (e, i) =>
        `${i + 1}. ${e.run?.goal ?? e.id} • ${e.run?.status ?? "unavailable"}`,
    );
    const selected = await ui.select(
      "Workflow history • ID order; listing may change, selected IDs never rebase",
      [
        ...labels,
        ...(page.next ? ["Next page"] : []),
        ...(previous.length ? ["Previous page"] : []),
        "Return",
      ],
    );
    if (selected === "Next page" && page.next) {
      previous.push(after);
      after = page.next;
    } else if (selected === "Previous page") after = previous.pop() ?? null;
    else if (selected && labels.includes(selected)) {
      const entry = page.entries[labels.indexOf(selected)];
      if (entry.run) await workflowDetails(client, ui, entry.id);
      else
        await ui.show(
          `Workflow ${entry.id} is unreadable. Retained bytes are untouched; no outcome inferred.`,
        );
    } else return;
  }
}
