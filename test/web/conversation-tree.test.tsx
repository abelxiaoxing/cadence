// The session tree's derived views and the anchor a Send continues from: pure
// functions and SSR, not a browser, a reader or an owner.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ChatTreeNode } from "../../src/service/contracts/workbench.ts";
import {
  decodeAnchor,
  editHead,
  offBranch,
  type SendAnchor,
  sendHead,
} from "../../web/src/client/conversation-anchor";
import {
  branchQuestions,
  buildTreeLayout,
  messageVersions,
  questionOrdinal,
  treeRows,
} from "../../web/src/client/conversation-tree";
import {
  BranchesPanel,
  type BranchesView,
  compactTime,
} from "../../web/src/components/workspace/BranchesPanel";
import { LocaleProvider } from "../../web/src/i18n/locale";

const node = (
  id: string,
  parent: string | null,
  current = false,
  leaf = `end-${id}`,
): ChatTreeNode => ({
  id,
  parent,
  text: `message ${id}`,
  at: 0,
  leaf,
  current,
});
// a ── b ── c ── d        (shown)
//      └─── b2 ── c2
//           └──── c3
const forked = [
  node("a", null, true),
  node("b", "a", true),
  node("b2", "a"),
  node("c", "b", true),
  node("c2", "b2"),
  node("c3", "b2"),
  node("d", "c", true),
];

it("a linear run stays flat and each fork indents its branches", () => {
  expect(treeRows(forked).map(({ node, depth }) => [node.id, depth])).toEqual([
    ["a", 0],
    ["b", 1],
    ["c", 1],
    ["d", 1],
    ["b2", 1],
    ["c2", 2],
    ["c3", 2],
  ]);
  // A parent the clipped tree no longer lists makes its child a root.
  expect(
    treeRows([node("x", "gone"), node("y", "x")]).map(({ depth }) => depth),
  ).toEqual([0, 0]);
});

it("a message has versions only where the session forks, in recorded order", () => {
  const versions = messageVersions({ nodes: forked, truncated: false });
  expect(versions.get("b")?.map((n) => n.id)).toEqual(["b", "b2"]);
  expect(versions.get("b2")).toBe(versions.get("b"));
  expect(versions.get("c3")?.map((n) => n.id)).toEqual(["c2", "c3"]);
  for (const single of ["a", "c", "d"])
    expect(versions.has(single)).toBe(false);
  // Several first messages are versions of each other too…
  const roots = [node("r1", null), node("r2", null)];
  expect(messageVersions({ nodes: roots, truncated: false }).size).toBe(2);
  // …but a clipped tree's oldest messages only look like roots.
  expect(messageVersions({ nodes: roots, truncated: true }).size).toBe(0);
  expect(
    messageVersions({ nodes: forked, truncated: true })
      .get("b")
      ?.map((n) => n.id),
  ).toEqual(["b", "b2"]);
});

it("a question's turn is counted back from a shown turn, or from the branch end", () => {
  const questions = branchQuestions(forked);
  expect(questions.map((q) => q.id)).toEqual(["a", "b", "c", "d"]);
  const shown = (ordinal: number, id: string) => ({ ordinal, header: { id } });
  // The two newest turns are shown: the earlier ones precede them.
  const newest = [shown(2, "c"), shown(3, "d")];
  expect(questionOrdinal(questions, "a", newest, 4, false)).toBe(0);
  expect(questionOrdinal(questions, "b", newest, 4, false)).toBe(1);
  expect(questionOrdinal(questions, "d", newest, 4, false)).toBe(3);
  // A leading span without a user message shifts every ordinal by one; the
  // shown turn carries that shift.
  const shifted = [shown(3, "c"), shown(4, "d")];
  expect(questionOrdinal(questions, "a", shifted, 5, false)).toBe(1);
  // A live turn's own message is not listed: the listed ones end before it.
  const live = [shown(3, "d"), shown(4, "command-id")];
  expect(questionOrdinal(questions, "b", live, 5, true)).toBe(1);
  // Only the live turn is shown: counted from the end, less that turn.
  expect(
    questionOrdinal(questions, "c", [shown(4, "command-id")], 5, true),
  ).toBe(2);
  expect(questionOrdinal(questions, "a", [], 4, false)).toBe(0);
  // Not on the branch shown, or a count the list cannot fit: no turn.
  expect(questionOrdinal(questions, "b2", newest, 4, false)).toBeUndefined();
  expect(questionOrdinal(questions, "a", [], 2, false)).toBeUndefined();
});

const turn = (ordinal: number, parent?: string | null, entry = "end") => ({
  ordinal,
  header: {
    id: `turn-${ordinal}`,
    status: "completed" as const,
    notice: "",
    omitted: { thinking: false, media: false, other: false },
    steps: 0,
    stable: 0,
    entry: entry as string | null,
    at: 0,
    ...(parent === undefined ? {} : { parent }),
  },
});

it("a rewrite continues the entry its message continued; an older service leaves only the previous shown turn's end", () => {
  // The service names it, null for the session's first message.
  expect(editHead(turn(3, "abcd1234"), undefined)).toBe("abcd1234");
  expect(editHead(turn(0, null), undefined)).toBeNull();
  // It is not second-guessed by the turn before.
  expect(editHead(turn(3, "abcd1234"), turn(2, undefined, "other"))).toBe(
    "abcd1234",
  );
  // An older service: the previous turn's end stands in where it is shown…
  expect(editHead(turn(3), turn(2, undefined, "prev-end"))).toBe("prev-end");
  // …and nothing does for a first message, a gap or a turn Pi has not ended.
  expect(editHead(turn(0), undefined)).toBeUndefined();
  expect(editHead(turn(3), turn(1, undefined, "far"))).toBeUndefined();
  expect(
    editHead(turn(3), {
      ...turn(2),
      header: { ...turn(2).header, entry: null },
    }),
  ).toBeUndefined();
});

const anchor: SendAnchor = {
  kind: "edit",
  entry: "abcd1234",
  turnId: "turn-3",
  from: 3,
  label: "the message",
  media: false,
  stash: "an earlier draft",
};

it("a Send names the anchor when one is set, else the end of the view", () => {
  expect(sendHead(null, "leaf")).toBe("leaf");
  expect(sendHead(null, null)).toBeNull();
  expect(sendHead(anchor, "leaf")).toBe("abcd1234");
  // The root is a real anchor: a rewritten first message continues nothing.
  expect(sendHead({ entry: null }, "leaf")).toBeNull();
  expect(offBranch(null, 5)).toBe(false);
  expect([2, 3, 4].map((ordinal) => offBranch(anchor, ordinal))).toEqual([
    false,
    true,
    true,
  ]);
});

it("an anchor survives a reload only as exactly what was saved", () => {
  expect(decodeAnchor(JSON.stringify(anchor))).toEqual(anchor);
  expect(
    decodeAnchor(JSON.stringify({ ...anchor, kind: "continue", entry: null })),
  ).toEqual({ ...anchor, kind: "continue", entry: null });
  for (const saved of [
    null,
    "",
    "{",
    "Kept draft",
    JSON.stringify({ ...anchor, kind: "send" }),
    JSON.stringify({ ...anchor, entry: "../etc/passwd" }),
    JSON.stringify({ ...anchor, entry: undefined }),
    JSON.stringify({ ...anchor, from: -1 }),
    JSON.stringify({ ...anchor, from: 1.5 }),
    JSON.stringify({ ...anchor, stash: null }),
    JSON.stringify([anchor]),
  ])
    expect(decodeAnchor(saved), String(saved)).toBeNull();
});

const view = (fields: Partial<BranchesView> = {}): BranchesView => ({
  id: "session",
  tree: { leaf: "end-d", nodes: forked, truncated: false },
  error: undefined,
  loading: false,
  pinned: false,
  canAct: true,
  onShow() {},
  onEdit() {},
  onContinue() {},
  onLatest() {},
  onRefresh() {},
  ...fields,
});
const panel = (shown: BranchesView | undefined, locale: "en" | "zh" = "en") =>
  renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <BranchesPanel view={shown} />
    </LocaleProvider>,
  );

it("buildTreeLayout draws continuous active rails and folds long off-path forks by default", () => {
  // Linear session: no forks, quiet timeline, terminal node marked.
  const linear = [
    node("m1", null, true),
    node("m2", "m1", true),
    node("m3", "m2", true),
  ];
  const linearLayout = buildTreeLayout(linear);
  expect(linearLayout.hasForks).toBe(false);
  expect(linearLayout.currentEndId).toBe("m3");
  expect(
    linearLayout.rows.map((row) => [
      row.node.id,
      row.nodeTop,
      row.nodeBottom,
      row.currentEnd,
      row.collapsible,
    ]),
  ).toEqual([
    ["m1", "none", "current", false, false],
    ["m2", "current", "current", false, false],
    ["m3", "current", "none", true, false],
  ]);

  // Forked session: off-path fork b2 has 2 descendants (c2, c3), so it starts folded.
  const foldedLayout = buildTreeLayout(forked);
  expect(foldedLayout.hasForks).toBe(true);
  expect(foldedLayout.currentEndId).toBe("d");
  expect(foldedLayout.rows.map((row) => row.node.id)).toEqual([
    "a",
    "b",
    "c",
    "d",
    "b2",
  ]);
  expect(foldedLayout.all.map((n) => n.id)).toEqual([
    "a",
    "b",
    "c",
    "d",
    "b2",
    "c2",
    "c3",
  ]);
  const b2Folded = foldedLayout.rows[4];
  expect(b2Folded.collapsible).toBe(true);
  expect(b2Folded.collapsed).toBe(true);
  expect(b2Folded.hiddenCount).toBe(2);
  expect(b2Folded.nodeBottom).toBe("none");

  // Expanding b2 reveals c2 and c3 while keeping b2 collapsible.
  const openedLayout = buildTreeLayout(forked, new Set(["b2"]));
  expect(openedLayout.rows.map((row) => row.node.id)).toEqual([
    "a",
    "b",
    "c",
    "d",
    "b2",
    "c2",
    "c3",
  ]);
  expect(openedLayout.rows[4].collapsed).toBe(false);
  expect(openedLayout.rows[4].nodeBottom).toBe("muted");

  // Short off-path fork (only 1 descendant) stays expanded by default.
  const shortFork = [
    node("a", null, true),
    node("b", "a", true),
    node("b2", "a", false),
    node("c2", "b2", false),
  ];
  expect(buildTreeLayout(shortFork).rows.map((row) => row.node.id)).toEqual([
    "a",
    "b",
    "b2",
    "c2",
  ]);

  // Active path through a LATER sibling keeps the outer guide active past the
  // earlier off-path branch without highlighting the off-path elbow itself.
  const laterCurrent = [
    node("a", null, true),
    node("b", "a", false),
    node("c", "b", false),
    node("d", "c", false),
    node("b2", "a", true),
    node("c2", "b2", true),
  ];
  const continuous = buildTreeLayout(laterCurrent, new Set(["b"]));
  expect(continuous.rows.find((row) => row.node.id === "b")?.lanes).toEqual([
    { kind: "tee", top: "current", bottom: "current", branch: "muted" },
  ]);
  expect(continuous.rows.find((row) => row.node.id === "c")?.lanes).toEqual([
    { kind: "line", tone: "current" },
  ]);
  expect(continuous.rows.find((row) => row.node.id === "d")?.lanes).toEqual([
    { kind: "line", tone: "current" },
  ]);
  expect(continuous.rows.find((row) => row.node.id === "b2")?.lanes).toEqual([
    { kind: "elbow", top: "current", branch: "current" },
  ]);

  // Multiple roots mark subsequent roots cleanly without vertical bleed.
  const rootsLayout = buildTreeLayout([
    node("r1", null, false),
    node("r2", null, true),
  ]);
  expect(rootsLayout.hasForks).toBe(true);
  expect(rootsLayout.rows.map((r) => [r.node.id, r.separateRoot])).toEqual([
    ["r1", false],
    ["r2", true],
  ]);

  // Malformed cycles and deep linear sessions never recurse infinitely or overflow the stack.
  const cyclic = [
    node("a", null, true),
    node("b", "a", true),
    node("b", "b", false),
  ];
  const cyclicLayout = buildTreeLayout(cyclic);
  expect(cyclicLayout.rows.map((r) => r.node.id)).toEqual(["a", "b"]);
  expect(cyclicLayout.rows[1].nodeBottom).toBe("none");

  const deepLinear = Array.from({ length: 1500 }, (_, i) =>
    node(`m${i}`, i === 0 ? null : `m${i - 1}`, true),
  );
  const deepLayout = buildTreeLayout(deepLinear);
  expect(deepLayout.rows).toHaveLength(1500);
  expect(deepLayout.currentEndId).toBe("m1499");
});

it("the Tree tab renders exact rails, folds long off-path forks, hides empty guidance once populated, and names each row's actions", () => {
  const html = panel(view());
  // b2 (2 descendants) starts folded: 5 visible rows (a, b, c, d, b2).
  expect(html.match(/class="branch-item/g)).toHaveLength(5);
  expect(html).toContain('class="branch-rows is-forked"');
  expect(html).toContain('aria-label="Conversation tree"');
  // Guidance text only appears when empty.
  expect(html).not.toContain("/tree in Pi");
  // The active path is marked on every row along it, with a clear end badge.
  expect(html.match(/aria-current="true"/g)).toHaveLength(4);
  expect(html).toContain("current-end");
  expect(html).toContain('class="branch-here">Current<');
  // Collapsed off-path fork exposes an accessible expand control.
  expect(html).toContain('class="branch-fold"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-label="Expand 2 more messages"');
  expect(html).toContain("+2 more");
  // Exact lane geometry replaces flat border rails.
  expect(html).toContain("lane-tee");
  expect(html).toContain("lane-elbow");
  expect(html).toContain('aria-label="Edit and resend: message b2"');
  expect(html).toContain('aria-label="Continue from here: message d"');
  expect(html).not.toContain("Show the latest");
  expect(html).not.toContain("disabled");
  // Nothing may move the anchor while a reply is queued or running; reading
  // another path stays possible.
  const busy = panel(view({ canAct: false }));
  expect(busy.match(/class="branch-act"[^>]*disabled=""/g)).toHaveLength(10);
  expect(busy).not.toMatch(/class="branch-row"[^>]*disabled/);
  // An earlier path says so and offers the way back.
  expect(panel(view({ pinned: true }))).toMatch(
    /Viewing an earlier path, not the latest\..*Show the latest/,
  );
  const zh = panel(view({ pinned: true }), "zh");
  expect(zh).toContain("正在查看历史路线，而非最新对话。");
  expect(zh).toContain("回到最新");
  expect(zh).toContain("当前");
  expect(zh).toContain("+2 条");
  expect(zh).toContain('aria-label="编辑并重新发送：message b2"');
  // Linear sessions render in quiet timeline mode without a fork badge.
  const linearHtml = panel(
    view({
      tree: {
        leaf: "end-b",
        nodes: [node("a", null, true), node("b", "a", true)],
        truncated: false,
      },
    }),
  );
  expect(linearHtml).toContain('class="branch-rows is-linear"');
  expect(linearHtml).not.toContain("branch-here");
});

it("the Tree tab distinguishes a new empty session from an active read, failure, and clipped tree", () => {
  // Unmounted/initializing or actively reading shows Reading….
  expect(panel(undefined)).toContain("Reading…");
  expect(panel(view({ tree: undefined, loading: true }))).toContain("Reading…");
  // A fresh conversation (not loading, no tree yet) renders the empty guidance,
  // never a stuck Reading… state or an unusable filter bar.
  const fresh = panel(view({ tree: undefined, loading: false }));
  expect(fresh).not.toContain("Reading…");
  expect(fresh).toContain("No messages yet");
  expect(fresh).toContain("/tree in Pi");
  expect(fresh).not.toContain("Filter messages…");
  const freshZh = panel(view({ tree: undefined, loading: false }), "zh");
  expect(freshZh).toContain("还没有消息");
  expect(freshZh).toContain("Pi 中的 /tree");
  expect(freshZh).not.toContain("读取中");
  // An explicit empty tree also shows the empty guidance.
  const emptyTree = panel(
    view({ tree: { leaf: null, nodes: [], truncated: false } }),
  );
  expect(emptyTree).toContain("No messages yet");
  expect(emptyTree).toContain("/tree in Pi");
  // Failure states alert instead of reading or empty success.
  const failed = panel(view({ tree: undefined, error: "unavailable" }));
  expect(failed).toContain('role="alert"');
  expect(failed).not.toContain("Reading…");
  expect(failed).not.toContain("No messages yet");
  // A failed re-read keeps the tree already shown.
  expect(panel(view({ error: "unavailable" }))).toContain("message b2");
  expect(
    panel(view({ tree: { leaf: "end-d", nodes: forked, truncated: true } })),
  ).toContain("Only the newest messages are listed.");
});

it("compactTime omits the date for today and formats earlier dates concisely", () => {
  const now = new Date(2026, 10, 23, 23, 45).getTime();
  const earlierToday = new Date(2026, 10, 23, 9, 5).getTime();
  const earlierMonth = new Date(2026, 9, 14, 18, 20).getTime();
  const lastYear = new Date(2025, 4, 2, 11, 0).getTime();
  expect(compactTime(earlierToday, "en", now)).toBe("09:05");
  expect(compactTime(earlierToday, "zh", now)).toBe("09:05");
  expect(compactTime(earlierMonth, "en", now)).toBe("Oct 14");
  expect(compactTime(earlierMonth, "zh", now)).toBe("10/14");
  expect(compactTime(lastYear, "zh", now)).toBe("2025/5/2");
});
