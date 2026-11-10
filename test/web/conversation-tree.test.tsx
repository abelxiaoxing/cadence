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
  messageVersions,
  questionOrdinal,
  treeRows,
} from "../../web/src/client/conversation-tree";
import {
  BranchesPanel,
  type BranchesView,
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

it("the Branches tab lists the tree with rails, marks the branch shown and names each row's actions", () => {
  const html = panel(view());
  expect(html.match(/class="branch-item/g)).toHaveLength(7);
  // The branch shown is marked on the row itself, not only by a colour.
  expect(html.match(/class="branch-item current"/g)).toHaveLength(4);
  expect(html.match(/aria-current="true"/g)).toHaveLength(4);
  // One rail per fork level: b, c, d and b2 one, c2 and c3 two.
  expect(html.match(/class="branch-rail"/g)).toHaveLength(8);
  expect(html).toContain('aria-label="Edit and resend: message b2"');
  expect(html).toContain('aria-label="Continue from here: message d"');
  expect(html).not.toContain("Show the latest");
  expect(html).not.toContain("disabled");
  // Nothing may move the anchor while a reply is queued or running; reading
  // another branch stays possible.
  const busy = panel(view({ canAct: false }));
  expect(busy.match(/class="branch-act"[^>]*disabled=""/g)).toHaveLength(14);
  expect(busy).not.toMatch(/class="branch-row"[^>]*disabled/);
  // A chosen branch says so and offers the way back.
  expect(panel(view({ pinned: true }))).toMatch(
    /A chosen branch is shown, not the latest\..*Show the latest/,
  );
  const zh = panel(view({ pinned: true }), "zh");
  expect(zh).toContain("查看最新");
  expect(zh).toContain('aria-label="编辑并重新发送：message b2"');
});

it("the Branches tab states reading, failure, an empty session and a clipped tree instead of an empty success", () => {
  expect(panel(undefined)).toContain("Reading…");
  expect(panel(view({ tree: undefined }))).toContain("Reading…");
  const failed = panel(view({ tree: undefined, error: "unavailable" }));
  expect(failed).toContain('role="alert"');
  expect(failed).not.toContain("Reading…");
  // A failed re-read keeps the tree already shown.
  expect(panel(view({ error: "unavailable" }))).toContain("message b2");
  expect(
    panel(view({ tree: { leaf: null, nodes: [], truncated: false } })),
  ).toContain("No messages yet.");
  expect(
    panel(view({ tree: { leaf: "end-d", nodes: forked, truncated: true } })),
  ).toContain("Only the newest messages are listed.");
});
