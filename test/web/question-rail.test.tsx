// The question rail's layout rule and its SSR; no layout, hover or scrolling.
// Adapted from pi-web-ui tests/unit/question-nav.test.ts @ b627452c;
// MIT (c) 2026 xing-shuyin.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionRail } from "../../web/src/components/workspace/QuestionRail";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { questionNavLayout } from "../../web/src/transcript/question-nav";

describe("question navigation layout", () => {
  it("keeps short histories centered with their original spacing", () => {
    expect(questionNavLayout(3, 600, 1)).toEqual({
      indices: [0, 1, 2],
      gap: 27,
      many: false,
    });
  });

  it("bounds long histories at every available height and retains the active question", () => {
    for (const height of [0, 2, 3, 10, 80, 320, 600, 900]) {
      for (const count of [1, 40, 100, 1000]) {
        for (const active of [0, Math.floor(count / 2), count - 1]) {
          const { indices, gap } = questionNavLayout(count, height, active);
          const used =
            indices.length * 3 + Math.max(0, indices.length - 1) * gap;
          expect(used).toBeLessThanOrEqual(height + 0.000001);
          expect(new Set(indices).size).toBe(indices.length);
          expect(indices).toEqual([...indices].sort((a, b) => a - b));
          if (indices.length) expect(indices).toContain(active);
        }
      }
    }
  });

  it("provides the full list when ticks are dense or sampled", () => {
    expect(questionNavLayout(40, 600, 15).many).toBe(true);
    expect(questionNavLayout(1000, 320, 555).many).toBe(true);
    expect(questionNavLayout(1000, 320, 555).indices.length).toBeLessThan(1000);
  });

  it("handles no active question, empty histories and a temporarily hidden rail", () => {
    expect(questionNavLayout(0, 600, -1).indices).toEqual([]);
    expect(questionNavLayout(100, 0, 50).indices).toEqual([]);
    const { indices } = questionNavLayout(100, 80, -1);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(99);
  });
});

it("the rail names every question by number and text, the one being read and the one being fetched", () => {
  const questions = ["first", "second", ""].map((text, index) => ({
    id: `q${index}`,
    text,
  }));
  const html = renderToStaticMarkup(
    <LocaleProvider initial="en">
      <QuestionRail
        questions={questions}
        active={1}
        reading="q0"
        onJump={() => {}}
      />
    </LocaleProvider>,
  );
  expect(html).toMatch(
    /^<nav class="qn-rail many" aria-label="Questions in this conversation"/,
  );
  // Unmeasured (no layout here) the bars wait; the full list carries all three.
  expect(html).not.toContain('class="qn-bar');
  expect(html.match(/class="qn-list-item/g)).toHaveLength(3);
  expect(html).toContain('aria-label="1. first"');
  expect(html).toMatch(
    /class="qn-list-item active" aria-label="2. second" aria-current="true"/,
  );
  expect(html).toMatch(/aria-label="1. first" aria-busy="true"/);
  // A message without text (images only) still has its number.
  expect(html).toContain('<span class="qn-list-text">…</span>');
  // One tab stop at most: list items are reached with the arrow keys.
  expect(html).not.toContain('tabindex="0"');
});
