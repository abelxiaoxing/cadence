/** Ordinary Node restart/read fixture. Bundled locally by the test, never shipped. */
import { readFileSync } from "node:fs";
import { HistoryProjection } from "../../src/history/projection.ts";
import { HistoryReader } from "../../src/history/reader.ts";
import { searchHistory } from "../../src/history/search.ts";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { decodeListRequest, publicError } from "../../src/service-contract.ts";

const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const reader = HistoryReader.open(
  new ServiceCoordination(input.root, input.state),
);
if (!reader) throw Error("Fixture history absent");
const projection = new HistoryProjection(reader, {
  session: () => ({
    protocol: 1,
    storeId: reader.storeId,
    epoch: input.epoch,
    authority: "local",
    accessGeneration: 1,
    csrf: null,
    capabilities: { actions: false, manualChecks: false, history: true },
  }),
  workspace: () => {
    throw Error("Unexpected workspace access");
  },
  context: (taskId) => ({
    status: "unavailable",
    workspaceId: reader.files.format.workspaceId,
    taskId,
    error: publicError("unavailable"),
  }),
  checks: () => ({ revision: 1, selections: [] }),
  legacyTasks: () => input.legacy ?? [],
});
const result =
  input.mode === "entity"
    ? await projection.entity(input.request)
    : input.mode === "list"
      ? await projection[decodeListRequest(input.request).reader](input.request)
      : input.mode === "detail"
        ? await reader.readDetail(input.cursor)
        : input.mode === "graph"
          ? await reader.graph(input.request)
          : await searchHistory(reader, input.cursor);
process.stdout.write(JSON.stringify(result));
