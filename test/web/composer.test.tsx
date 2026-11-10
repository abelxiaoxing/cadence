// The composer's local helpers and its SSR: prompt recall, the caret's visual
// line, the `@` path token and the remembered height. No DOM, layout or owner.
// Adapted from pi-web-ui tests/unit/{prompt-history,caret-visual-line,
// at-mention}.test.ts @ b627452c; MIT (c) 2026 xing-shuyin.
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../../src/service/contracts/workbench.ts";
import { ServiceClient } from "../../src/service-client.ts";
import {
  ChatComposer,
  type ChatComposerProps,
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  composerHeightCap,
  readComposerHeight,
} from "../../web/src/components/workspace/ChatComposer";
import {
  applyMention,
  matchAtToken,
  mentionEntries,
  mentionQuery,
  mentionReadable,
} from "../../web/src/composer/at-mention";
import {
  caretRowFlags,
  caretVisualLineFlags,
  logicalLineFlags,
} from "../../web/src/composer/caret-visual-line";
import {
  appendHistory,
  HISTORY_IDLE,
  loadPromptHistory,
  normalizeHistory,
  PROMPT_HISTORY_MAX,
  pushPromptHistory,
  stepHistory,
} from "../../web/src/composer/prompt-history";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { transport } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("prompt history", () => {
  it("keeps only non-empty strings, trimmed", () => {
    for (const raw of [null, undefined, "x", { a: 1 }])
      expect(normalizeHistory(raw)).toEqual([]);
    expect(
      normalizeHistory(["  hello  ", "   ", 42, null, "world", ""]),
    ).toEqual(["hello", "world"]);
  });
  it("appends without mutating, skips blanks and an immediate repeat, and drops the oldest past the bound", () => {
    const h = ["a", "b"];
    expect(appendHistory(h, "   ")).toBe(h);
    expect(appendHistory(h, "")).toBe(h);
    expect(appendHistory(h, "b")).toBe(h);
    expect(appendHistory(h, " b ")).toBe(h);
    expect(appendHistory(h, "c")).toEqual(["a", "b", "c"]);
    expect(h).toEqual(["a", "b"]);
    expect(appendHistory(["1", "2", "3"], "4", 3)).toEqual(["2", "3", "4"]);
    let cur: string[] = [];
    for (let i = 0; i < PROMPT_HISTORY_MAX + 5; i++)
      cur = appendHistory(cur, `m${i}`);
    expect(cur).toHaveLength(PROMPT_HISTORY_MAX);
    expect(cur[0]).toBe("m5");
    expect(cur.at(-1)).toBe(`m${PROMPT_HISTORY_MAX + 4}`);
  });
  it("walks older and newer, keeps the draft it left and brings it back", () => {
    const history = ["first", "second", "third"];
    // Down from the draft goes nowhere; Up keeps the draft and shows the newest.
    expect(stepHistory(history, HISTORY_IDLE, "newer", "draft")).toBeNull();
    const up1 = stepHistory(history, HISTORY_IDLE, "older", "my draft");
    expect(up1).toEqual({
      cursor: { index: 2, draft: "my draft" },
      text: "third",
    });
    const up2 = stepHistory(history, up1?.cursor ?? HISTORY_IDLE, "older", "");
    const up3 = stepHistory(history, up2?.cursor ?? HISTORY_IDLE, "older", "");
    expect([up2?.text, up3?.text]).toEqual(["second", "first"]);
    // The oldest entry is the end of the way up.
    expect(
      stepHistory(history, up3?.cursor ?? HISTORY_IDLE, "older", ""),
    ).toBeNull();
    const down1 = stepHistory(
      history,
      up2?.cursor ?? HISTORY_IDLE,
      "newer",
      "",
    );
    expect(down1?.text).toBe("third");
    // Past the newest entry the draft that was left comes back.
    expect(
      stepHistory(history, down1?.cursor ?? HISTORY_IDLE, "newer", "third"),
    ).toEqual({ cursor: HISTORY_IDLE, text: "my draft" });
    expect(stepHistory([], HISTORY_IDLE, "older", "draft")).toBeNull();
  });
  it("is kept per checkout in the tab's storage and survives blocked or corrupt storage", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    pushPromptHistory("checkout:/a", "  first prompt ");
    pushPromptHistory("checkout:/a", "first prompt");
    pushPromptHistory("checkout:/a", "second");
    pushPromptHistory("checkout:/b", "elsewhere");
    expect(loadPromptHistory("checkout:/a")).toEqual([
      "first prompt",
      "second",
    ]);
    expect(loadPromptHistory("checkout:/b")).toEqual(["elsewhere"]);
    expect([...values.keys()]).toEqual([
      "cadence:prompt-history:checkout:/a",
      "cadence:prompt-history:checkout:/b",
    ]);
    values.set("cadence:prompt-history:checkout:/a", "{not json");
    expect(loadPromptHistory("checkout:/a")).toEqual([]);
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });
    expect(loadPromptHistory("checkout:/a")).toEqual([]);
    expect(() =>
      pushPromptHistory("checkout:/a", "kept in no store"),
    ).not.toThrow();
  });
});

describe("the caret's visual line", () => {
  it("names the first and last visual row from the measured offsets", () => {
    expect(caretRowFlags(0, 46)).toEqual({ first: true, last: false });
    expect(caretRowFlags(46, 46)).toEqual({ first: false, last: true });
    expect(caretRowFlags(0, 0)).toEqual({ first: true, last: true });
    expect(caretRowFlags(23, 69)).toEqual({ first: false, last: false });
    // One pixel of rounding is the same row; a whole row is not.
    expect(caretRowFlags(0, 1).last).toBe(true);
    expect(caretRowFlags(0, 23).last).toBe(false);
  });
  it("falls back to logical lines", () => {
    expect(logicalLineFlags("no newline at all", 5)).toEqual({
      first: true,
      last: true,
    });
    expect(logicalLineFlags("aaa\nbbb", 1)).toEqual({
      first: true,
      last: false,
    });
    expect(logicalLineFlags("aaa\nbbb", 5)).toEqual({
      first: false,
      last: true,
    });
    expect(logicalLineFlags("aaa\nbbb\nccc", 5)).toEqual({
      first: false,
      last: false,
    });
    expect(logicalLineFlags("", 0)).toEqual({ first: true, last: true });
  });
  it("without layout it never allows more than the logical line does, and a selection allows nothing", () => {
    const area = (value: string, start = value.length, end = start) =>
      ({
        value,
        selectionStart: start,
        selectionEnd: end,
      }) as HTMLTextAreaElement;
    // No document here: a wrapped long line is one logical line.
    expect(caretVisualLineFlags(area("long ".repeat(200)))).toEqual({
      first: true,
      last: true,
    });
    expect(caretVisualLineFlags(area("a\nb\nc", 2))).toEqual({
      first: false,
      last: false,
    });
    expect(caretVisualLineFlags(area("a\nb", 0, 2))).toEqual({
      first: false,
      last: false,
    });
    expect(caretVisualLineFlags(area(""))).toEqual({ first: true, last: true });
  });
});

const entry = (path: string, directory = false): FileEntry => ({
  name: path.split(/[\\/]/).at(-1) ?? path,
  path,
  directory,
});

describe("the @ path token", () => {
  it("is an @ that starts a word, up to the caret, without whitespace", () => {
    expect(matchAtToken("@", 1)).toEqual({ start: 0, query: "" });
    expect(matchAtToken("see @src/co", 11)).toEqual({
      start: 4,
      query: "src/co",
    });
    // Only what is before the caret counts.
    expect(matchAtToken("see @src/co and more", 8)).toEqual({
      start: 4,
      query: "src",
    });
    expect(matchAtToken("（@文件", 4)).toEqual({ start: 1, query: "文件" });
    // An address, a finished reference and a second @ are not tokens.
    expect(matchAtToken("mail a@b.c", 10)).toBeNull();
    expect(matchAtToken("@src/a.ts then", 14)).toBeNull();
    expect(matchAtToken("@@x", 3)).toBeNull();
    expect(matchAtToken("no token", 8)).toBeNull();
    // A caret outside the text is clamped, never read past either end.
    expect(matchAtToken("@a", 99)).toEqual({ start: 0, query: "a" });
    expect(matchAtToken("@a", -5)).toBeNull();
    expect(matchAtToken("@a", Number.NaN)).toBeNull();
  });
  it("splits into the folder to list and the name typed in it", () => {
    expect(mentionQuery("")).toEqual({ folder: "", name: "" });
    expect(mentionQuery("rea")).toEqual({ folder: "", name: "rea" });
    expect(mentionQuery("src/")).toEqual({ folder: "src", name: "" });
    expect(mentionQuery("src/web/Ap")).toEqual({
      folder: "src/web",
      name: "Ap",
    });
    expect(mentionQuery("src\\web\\Ap")).toEqual({
      folder: "src\\web",
      name: "Ap",
    });
    // A folder the read's request could not carry is not asked for.
    expect(mentionReadable("")).toBe(true);
    expect(mentionReadable("src/web")).toBe(true);
    expect(mentionReadable("x".repeat(1025))).toBe(false);
    expect(mentionReadable("a\0b")).toBe(false);
    expect(mentionReadable("a\ud800b")).toBe(false);
    expect(mentionReadable("文件夹/😀")).toBe(true);
  });
  it("narrows the listed entries: prefix matches first, case ignored, bounded", () => {
    const listed = [
      entry("docs", true),
      entry("README.md"),
      entry("src", true),
      entry("thread.ts"),
    ];
    expect(mentionEntries(listed, "")).toEqual(listed);
    expect(mentionEntries(listed, "re").map((e) => e.name)).toEqual([
      "README.md",
      "thread.ts",
    ]);
    expect(mentionEntries(listed, "zzz")).toEqual([]);
    expect(mentionEntries(listed, "", 2)).toHaveLength(2);
  });
  it("inserts a path, never contents: a file ends the reference, a folder keeps completing", () => {
    const text = "see @sr and more";
    const token = matchAtToken(text, 7);
    if (!token) throw new Error("token");
    expect(applyMention(text, token, 7, entry("src", true))).toEqual({
      text: "see @src/ and more",
      cursor: 9,
    });
    // The same text the Files pane's reference action inserts, then a space
    // (not doubled when one already follows).
    expect(applyMention(text, token, 7, entry("src/App.tsx"))).toEqual({
      text: "see @src/App.tsx and more",
      cursor: 17,
    });
    const end = "@src/A";
    const last = matchAtToken(end, 6);
    if (!last) throw new Error("token");
    expect(applyMention(end, last, 6, entry("src/App.tsx"))).toEqual({
      text: "@src/App.tsx ",
      cursor: 13,
    });
    // The listing's own separator is kept.
    expect(applyMention(end, last, 6, entry("src\\web", true)).text).toBe(
      "@src\\web\\",
    );
  });
});

it("a remembered height is a bounded manual height, anything else is automatic", () => {
  expect(readComposerHeight(null)).toBeNull();
  expect(readComposerHeight("")).toBeNull();
  expect(readComposerHeight("tall")).toBeNull();
  expect(readComposerHeight(String(COMPOSER_MIN_HEIGHT))).toBeNull();
  expect(readComposerHeight("180.4")).toBe(180);
  expect(readComposerHeight("9000")).toBe(COMPOSER_MAX_HEIGHT);
  // Never more than about two fifths of a short window, nor less than a few lines.
  expect(composerHeightCap(0)).toBe(COMPOSER_MAX_HEIGHT);
  expect(composerHeightCap(2000)).toBe(COMPOSER_MAX_HEIGHT);
  expect(composerHeightCap(600)).toBe(252);
  expect(composerHeightCap(200)).toBe(160);
});

const props = (fields: Partial<ChatComposerProps> = {}): ChatComposerProps => ({
  inputRef: createRef<HTMLTextAreaElement>(),
  draft: "",
  onDraft() {},
  locked: false,
  images: [],
  imageKey: () => undefined,
  imagesLocked: false,
  onAddImages() {},
  onRemoveImage() {},
  cadence: {
    active: false,
    armed: false,
    known: true,
    disabled: false,
    onClick() {},
  },
  model: {
    availability: { status: "unavailable" },
    read: {
      loading: false,
      isCurrent: () => true,
      reread() {},
      accept: () => false,
    },
    locked: false,
    open: false,
    onOpenChange() {},
    onChanged() {},
  } as unknown as ChatComposerProps["model"],
  hint: "",
  running: false,
  canStop: false,
  onStop() {},
  canSend: false,
  onSend() {},
  historyScope: "checkout",
  files: { client: new ServiceClient(transport()) },
  ...fields,
});
const composer = (fields?: Partial<ChatComposerProps>) =>
  renderToStaticMarkup(
    <LocaleProvider initial="en">
      <ChatComposer {...props(fields)} />
    </LocaleProvider>,
  );

it("the composer is one form: a height handle, the draft, and Send or Stop as the last control", () => {
  const html = composer({ draft: "a draft", canSend: true });
  expect(html).toMatch(/^<form class="chat-composer">/);
  expect(html).toMatch(/<textarea[^>]*aria-label="Message"[^>]*>a draft</);
  // The handle is a range input, so the keyboard can use it.
  expect(html).toMatch(
    /<input type="range" class="composer-resize"[^>]*aria-valuetext="Automatic"/,
  );
  expect(html).toMatch(/type="submit" class="primary"><svg/);
  expect(html).not.toContain("Stop response");
  // Nothing is listed before an `@` is typed in a focused text area.
  expect(html).not.toContain('role="listbox"');
  expect(html).not.toContain("aria-controls");
  const locked = composer({ draft: "sent", locked: true, canSend: false });
  expect(locked).toMatch(/<textarea disabled=""/);
  expect(locked).toMatch(/type="submit" class="primary" disabled=""/);
  // A live reply: Stop takes Send's place and never submits the form.
  const live = composer({ running: true, canStop: true });
  expect(live).toMatch(
    /<button type="button" class="danger"[^>]*aria-label="Stop response"/,
  );
  expect(live).not.toContain('type="submit"');
});

it("the composer states what the next message continues and why Send waits, above the draft", () => {
  const html = composer({
    anchor: <div className="composer-anchor">Rewriting a message</div>,
    status: "Sending…",
  });
  expect(html).toMatch(
    /class="composer-anchor">Rewriting a message<\/div><p class="composer-status" role="status">Sending…<\/p><textarea/,
  );
});
