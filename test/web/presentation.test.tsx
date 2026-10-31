/* Adapted conv-groups/message-delta/copy/search test intents from pinned pi-web-ui
 * e8bab487af208bc9a1ab60a821652323f598127f, MIT (c) 2026 xing-shuyin.
 * Pure/React SSR only: no DOM, focus, CSP, browser, or execution qualification. */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceClient } from "../../src/service-client.ts";
import {
  type DetailPage,
  dependency,
  type HistoryReadResult,
  type ListRequest,
} from "../../src/service-contract.ts";
import { dependency as workerDependency } from "../../src/worker-public.mjs";
import { appendDetailPage } from "../../web/src/client/message-delta";
import { mergeObservation } from "../../web/src/client/receipts";
import { ViewLifetime } from "../../web/src/client/view-lifetime";
import { ReceiptPanel } from "../../web/src/components/actions/ReceiptPanel";
import { PageControls } from "../../web/src/components/history/PageControls";
import { DiffView } from "../../web/src/components/review/DiffView";
import { Markdown, safeLink } from "../../web/src/components/rich/Markdown";
import { requestDownload } from "../../web/src/history/download-export";
import { historyUrl } from "../../web/src/history/history-url";
import { readFullText, readPage } from "../../web/src/history/readers";
import { searchRequest } from "../../web/src/history/search-request";
import {
  buildNavigationRows,
  type NavigationNode,
} from "../../web/src/navigation/assignment-rows";
import { content, coverage, cursor, id, receipt, transport } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());
const node = (
  id: string,
  parentId: string | null = null,
  extra: Partial<NavigationNode> = {},
): NavigationNode => ({
  id,
  parentId,
  label: id,
  active: false,
  failed: false,
  unknown: false,
  ...extra,
});
it("adapts nested tree/collapse; unknown and failed stay independent of active", () => {
  const nodes = [
    node("p"),
    node("c", "p"),
    node("g", "c", { unknown: true, failed: true }),
    node("orphan", "absent"),
  ];
  expect(buildNavigationRows(nodes).map((r) => [r.c.id, r.depth])).toEqual([
    ["p", 0],
    ["c", 1],
    ["g", 2],
    ["orphan", 0],
  ]);
  const rows = buildNavigationRows(nodes, new Set(["p"]));
  expect(rows.map((r) => r.c.id)).toEqual(["p", "orphan"]);
  expect(rows[0]).toMatchObject({
    descendantCount: 2,
    hasFailure: true,
    hasUnknown: true,
    hasActive: false,
  });
});
it("exports exactly the existing dependency decoder", () =>
  expect(dependency).toBe(workerDependency));
it("refuses unsafe links, images and HTML styles but retains code and math", () => {
  for (const rawHtml of [false, true]) {
    const html = renderToStaticMarkup(
      <Markdown
        rawHtml={rawHtml}
        text={
          '<script>alert(1)</script><img src="https://evil.test/x" onerror="alert(2)"><span style="background:url(https://evil.test/y)">text</span>\n\n![secret](https://evil.test/image)\n\n[bad](javascript:alert(1))\n\n```js\nconst x = "<evil>";\n```\n\n$x^2$'
        }
      />,
    );
    expect(html).not.toMatch(
      /<script|<img|onerror=|background:url|href="javascript/,
    );
    expect(html).toContain("Image omitted");
    expect(html).toContain("&lt;evil&gt;");
    expect(html).toContain("katex");
  }
  for (const link of [
    "javascript:evil()",
    "https://user:secret@host/",
    "https://host/?token=secret",
    "#bad\n",
  ])
    expect(safeLink(link)).toBeUndefined();
  expect(safeLink("https://example.test/help")).toBe(
    "https://example.test/help",
  );
});
it("renders escaped readonly diff with header/add/delete classes", () => {
  const html = renderToStaticMarkup(
    <DiffView text={"diff --git a/x b/x\n@@ -1 +1 @@\n-<script>\n+safe"} />,
  );
  expect(html).toContain("scm-diff-line hdr");
  expect(html).toContain("scm-diff-line add");
  expect(html).toContain("scm-diff-line del");
  expect(html).not.toContain("<script>");
});
it("late pending lookup never replaces newer committed receipt or another ID", () => {
  const pending = receipt(),
    final = { ...pending, committedSeq: "9", publication: "conflict" as const };
  const previous = { commandId: final.commandId, receipt: final };
  expect(
    mergeObservation(previous, {
      commandId: pending.commandId,
      lookup: { status: "found", receipt: pending },
    }).receipt,
  ).toEqual(final);
  expect(
    mergeObservation(previous, { commandId: id(), receipt: pending }),
  ).toBe(previous);
  expect(previous.receipt).toEqual(final);
  const html = renderToStaticMarkup(
    <ReceiptPanel
      client={new ServiceClient(transport())}
      value={previous}
      onChange={() => {}}
    />,
  );
  expect(html).toContain("conflict");
  expect(html).toContain("not settled");
});
it("dismissal, selection, context and departure invalidate late view callbacks only", () => {
  const life = new ViewLifetime();
  life.select("task-A/attachment-1");
  const ticket = life.ticket();
  life.select("task-A/attachment-1");
  expect(life.current(ticket)).toBe(true);
  life.depart();
  expect(life.current(ticket)).toBe(false);
  const next = life.ticket();
  life.select("task-A/attachment-2");
  expect(life.current(next)).toBe(false);
  const another = life.ticket();
  life.select("task-B/attachment-2");
  expect(life.current(another)).toBe(false);
});
describe("durable reader adaptation", () => {
  it("enforces exact 1024 UTF-8 query bytes without clipping or carrying search proof", () => {
    const seed = cursor();
    expect(searchRequest(seed, "🚀".repeat(256)).query).toHaveLength(512);
    expect(() => searchRequest(seed, `${"🚀".repeat(256)}a`)).toThrow(
      "not clipped",
    );
    expect(() => searchRequest(seed, "é".repeat(513))).toThrow();
    expect(
      searchRequest({ ...seed, navigation: "unused" }, "needle").navigation,
    ).toBeUndefined();
  });
  it.each(["progress", "snapshot"] as const)(
    "renders %s as unfinished proof, not empty completion",
    (kind) => {
      const request: ListRequest = {
        storeId: id(),
        scope: { kind: "task", id: id() },
        snapshotSeq: kind === "snapshot" ? null : "1",
        reader: "messages",
        after: null,
        limit: 50,
      };
      const page: HistoryReadResult = {
        kind,
        request,
        next: { ...request, snapshotSeq: "1", navigation: "proof" },
        coverage,
      };
      const html = renderToStaticMarkup(
        <PageControls
          pager={{
            page,
            busy: false,
            error: undefined,
            canPrevious: false,
            previous() {},
            more() {},
            refresh() {},
          }}
        />,
      );
      expect(html).toContain("No data page yet");
      expect(html).not.toContain("End of this retained snapshot");
    },
  );
  it("immutable text append preserves prior bytes and rejects noncontiguous version/hash", () => {
    const ref = content("final-text", 5),
      seed = {
        ...cursor(),
        recordId: ref.recordId,
        recordVersion: 1,
        field: ref.field,
      };
    const page: DetailPage = {
      cursor: seed,
      content: ref,
      range: { start: 0, end: 4 },
      text: "🚀",
      next: { ...seed, offset: 4 },
      coverage,
    };
    const first = appendDetailPage(null, page);
    const second = appendDetailPage(first, {
      ...page,
      range: { start: 4, end: 5 },
      text: "!",
      next: null,
    });
    expect(first.chunks).toEqual(["🚀"]);
    expect(second.chunks.join("")).toBe("🚀!");
    expect(() =>
      appendDetailPage(first, { ...page, content: { ...ref, version: 2 } }),
    ).toThrow();
  });
  it("full-field copy yields through progress and receives the original read AbortSignal", async () => {
    const ref = content("final-text", 4),
      seed = {
        ...cursor(),
        recordId: ref.recordId,
        recordVersion: 1,
        field: ref.field,
      };
    const abort = new AbortController();
    const detail = vi.fn(async (input, signal) => {
      expect(signal).toBe(abort.signal);
      return {
        kind: "ok",
        value: {
          cursor: input,
          content: ref,
          range: { start: 0, end: 4 },
          text: "🚀",
          next: null,
          coverage,
        },
      };
    });
    const client = new ServiceClient(transport({ detail }));
    expect(await readFullText(client, seed, abort.signal)).toEqual({
      text: "🚀",
      recordingComplete: true,
    });
    abort.abort();
    await expect(readFullText(client, seed, abort.signal)).rejects.toThrow(
      "canceled",
    );
    expect(detail).toHaveBeenCalledTimes(1);
  });
  it("native Markdown download uses download, never protocol export or giant Blob", () => {
    const link = {
      href: "",
      download: "",
      referrerPolicy: "",
      click: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      createElement: () => link,
      body: { appendChild: vi.fn() },
    });
    const seed = cursor();
    requestDownload({
      storeId: seed.storeId,
      scope: seed.scope,
      snapshotSeq: seed.snapshotSeq,
      format: "markdown",
    });
    expect(link.href).toContain("/download?");
    expect(link.href).not.toContain("token");
    expect(link.download).toMatch(/\.md$/);
    expect(link.click).toHaveBeenCalledOnce();
  });
  it("exact-hit deep link keeps UTF-8 offset/version but strips navigation proof", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://example.test", pathname: "/app" },
    });
    const ref = content(),
      seed = {
        ...cursor(),
        recordId: ref.recordId,
        recordVersion: 1,
        field: ref.field,
        offset: 4,
        navigation: "private-proof",
      };
    const value = historyUrl(id(), seed);
    expect(value).not.toContain("private-proof");
    expect(decodeURIComponent(value)).toContain('"offset":4');
  });
});

// Exercise every named reader through the real shared correlation/union decoder.
it.each([
  "tasks",
  "runs",
  "messages",
  "tools",
  "contents",
  "events",
  "checks",
  "changes",
  "reviews",
] as const)(
  "%s reader preserves data/progress/snapshot and exact continuation",
  async (reader) => {
    for (const kind of ["data", "progress", "snapshot"] as const) {
      const request: ListRequest = {
        reader,
        storeId: id(),
        scope: { kind: reader === "tasks" ? "workspace" : "task", id: id() },
        snapshotSeq: kind === "snapshot" ? null : "1",
        after: null,
        limit: 50,
      };
      const value =
        kind === "data"
          ? { request, records: [], next: null, coverage }
          : {
              kind,
              request,
              next: {
                ...request,
                snapshotSeq: "1",
                navigation: "fixture-proof",
              },
              coverage,
            };
      const read = vi.fn(async () => ({ kind: "ok", value }));
      const reply = await readPage(
        new ServiceClient(transport({ [reader]: read })),
        request,
      );
      expect(reply).toEqual({ kind: "ok", value });
      expect(read).toHaveBeenCalledOnce();
    }
  },
);
it("full copy follows actual progress and Unicode pages without losing source/recording incompleteness", async () => {
  const ref = content("final-text", 6),
    seed = {
      ...cursor(),
      recordId: ref.recordId,
      recordVersion: 1,
      field: ref.field,
    };
  const read = vi.fn(async (at) => ({
    kind: "ok",
    value: !at.navigation
      ? {
          kind: "progress",
          cursor: at,
          next: { ...at, navigation: "proof" },
          coverage,
        }
      : {
          cursor: at,
          content: ref,
          range: at.offset === 0 ? { start: 0, end: 2 } : { start: 2, end: 6 },
          text: at.offset === 0 ? "é" : "🚀",
          next: at.offset === 0 ? { ...at, offset: 2 } : null,
          coverage: {
            ...coverage,
            observed: "incomplete",
            source: "limited",
            omissions: ["source-limit"],
          },
        },
  }));
  expect(
    await readFullText(
      new ServiceClient(transport({ detail: read })),
      seed,
      new AbortController().signal,
    ),
  ).toEqual({ text: "é🚀", recordingComplete: false });
  expect(read).toHaveBeenCalledTimes(3);
});
it("higher sequence cannot substitute a created task or erase already committed receipt facts", () => {
  const current = {
    ...receipt(),
    runId: null,
    committedSeq: "9",
    created: {
      kind: "task" as const,
      taskId: id(),
      state: "published" as const,
    },
    publication: "published" as const,
  };
  for (const candidate of [
    {
      ...current,
      committedSeq: "10",
      created: { ...current.created, taskId: id() },
    },
    {
      ...current,
      committedSeq: "10",
      created: { ...current.created, state: "reserved" as const },
      publication: "pending" as const,
    },
    {
      ...current,
      committedSeq: "10",
      admission: "refused" as const,
      created: null,
    },
  ]) {
    const merged = mergeObservation(
      { commandId: current.commandId, receipt: current },
      {
        commandId: current.commandId,
        lookup: { status: "found", receipt: candidate },
      },
    );
    expect(merged.receipt).toEqual(current);
    expect(merged.error).toContain("Conflicting receipt");
  }
  const settled = { ...receipt(), execution: "failed" as const };
  expect(
    mergeObservation(
      { commandId: settled.commandId, receipt: settled },
      {
        commandId: settled.commandId,
        receipt: { ...settled, committedSeq: "10", execution: null },
      },
    ).receipt,
  ).toEqual(settled);
});
