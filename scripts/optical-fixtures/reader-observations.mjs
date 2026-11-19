import assert from "node:assert/strict";
import { controlGeometry } from "./measure.mjs";
import { fieldRoute } from "./records.mjs";

// Use a rendered prose paragraph, not its Markdown wrapper (or a hidden copy
// of the agreement). The scroll is only for typography sampling, never find.
export async function leading({ run, scrollTo }, selector, plainText = null) {
  await scrollTo(selector);
  const sample = await run(
    (s, plain) => {
      const p = document.querySelector(s);
      const node = plain === null ? p : p?.firstChild;
      if (
        plain !== null &&
        !(
          node?.nodeType === Node.TEXT_NODE &&
          node.textContent === plain &&
          node.parentElement === p
        )
      )
        throw Error(`Missing recorded text: ${s}`);
      if ((plain === null && p?.tagName !== "P") || !p.textContent.trim())
        throw Error(`Missing prose: ${s}`);
      const range = new Range();
      range.selectNodeContents(node);
      if (
        ![...range.getClientRects()].some(
          (r) =>
            r.width &&
            r.height &&
            p.contains(
              document.elementFromPoint(
                r.left + r.width / 2,
                r.top + r.height / 2,
              ),
            ),
        )
      )
        throw Error(`Hidden prose: ${s}`);
      const css = getComputedStyle(p),
        lineHeight = parseFloat(css.lineHeight),
        fontSize = parseFloat(css.fontSize);
      return {
        text: p.textContent.trim().slice(0, 48),
        lineHeight,
        fontSize,
        ratio: lineHeight / fontSize,
      };
    },
    selector,
    plainText,
  );
  assert.ok(
    Math.abs(sample.lineHeight - 1.65 * sample.fontSize) <= 1 / 64,
    `Wrong leading ${selector}: ${sample.ratio}`,
  );
  return { selector, ...sample };
}

function focusPixels(selector) {
  const el = document.activeElement;
  if (!el.matches(`${selector}:focus-visible`))
    throw Error(`Not Tab-focused: ${selector}`);
  const r = el.getBoundingClientRect(),
    css = getComputedStyle(el);
  const points = [];
  const add = (name, ix, iy, x, y) => {
    const ink = [Math.floor(ix), Math.floor(iy)];
    if (!el.contains(document.elementFromPoint(...ink)))
      throw Error(`Clipped ${name} ink: ${selector}`);
    points.push({ name, ink, x: Math.floor(x), y: Math.floor(y), min: 3 });
  };
  if (el.type === "range") {
    const w = parseFloat(css.borderLeftWidth);
    if (css.borderLeftStyle !== "solid" || w < 2)
      throw Error("Missing sash line");
    for (const f of [0.1, 0.5, 0.9]) {
      const ix = r.left + w / 2,
        y = r.top + r.height * f;
      add(`sash ${f} outside`, ix, y, r.left - 2, y);
      add(`sash ${f} inside`, ix, y, r.left + w + 1, y);
    }
  } else {
    const w = parseFloat(css.outlineWidth),
      inset = -parseFloat(css.outlineOffset);
    if (css.outlineStyle !== "solid" || w < 2 || inset <= w)
      throw Error("Missing inset ring");
    const d = inset - w / 2,
      x = r.left + r.width / 2,
      y = r.top + r.height / 2;
    add("ring top", x, r.top + d, x, r.top + inset + 1);
    add("ring bottom", x, r.bottom - d, x, r.bottom - inset - 1);
    add("ring left", r.left + d, y, r.left + inset + 1, y);
    add("ring right", r.right - d, y, r.right - inset - 1, y);
  }
  return points;
}

export async function observeLiveFocus({
  go,
  ev,
  chat,
  click,
  send,
  press,
  run,
  capture,
  wait,
  rows,
  width,
  theme,
}) {
  await go(chat("live-input"), '[aria-label="Stop response"]');
  const draft = "Unsent focus specimen.";
  for (const opener of ["navigation-toggle", "inspector-toggle"]) {
    if (
      await ev(
        `document.querySelector('.${opener}').getAttribute('aria-expanded')==='false'`,
      )
    )
      await click(`.${opener}`);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
  const tab = async (selector, limit) => {
    for (let i = 0; i < limit; ++i) {
      await press("Tab", 9);
      if (
        await ev(
          `document.activeElement.matches(${JSON.stringify(`${selector}:focus-visible`)})`,
        )
      ) {
        const geometry = await run(controlGeometry, selector, false);
        const points = await run(focusPixels, selector);
        const observed = await capture(selector, () =>
          run(focusPixels, selector),
        );
        assert.equal(observed?.samples, points.length);
        rows.push({ theme, width, selector, points, ...geometry, ...observed });
        assert.ok(
          geometry.visible.width >= geometry.rect.width - 0.01 &&
            geometry.visible.height >= geometry.rect.height - 0.01,
          `Clipped control ${selector}`,
        );
        assert.ok(Object.values(geometry.hit).every((p) => p.hit));
        assert.deepEqual(observed.failures, []);
        return;
      }
    }
    throw Error(`Tab did not reach ${selector}`);
  };
  for (const side of ["left", "right"])
    await tab(`.resize-handle[aria-label="Resize ${side} pane"]`, 150);
  const input = ".chat-composer textarea";
  assert.ok(
    await ev(
      `!document.querySelector('.composer-split') && !document.querySelector('${input}').value`,
    ),
  );
  await click(input);
  await send("Input.insertText", { text: draft });
  await wait(
    `document.querySelector('.composer-split .composer-queue:enabled')`,
  );
  await tab(".composer-queue", 15);
  await tab(".composer-steer", 1);
  assert.ok(
    await ev(
      `document.querySelector('${input}').value===${JSON.stringify(draft)} && !!document.querySelector('[aria-label="Stop response"]:enabled')`,
    ),
  );
  await click(input);
  await press("a", 65, 2);
  await press("Backspace", 8);
  await wait(`!document.querySelector('.composer-split')`);
  await click(".inspector-toggle");
}

// Check the actual CSS Highlight Range after navigation, with no test-side
// scrolling. Intersect every clipping scrollport, including the code line
// and outer tab, and hit-test text at the resulting on-screen coordinates.
function activeGeometry(query, containing) {
  const field = document.querySelector(".tab-body [data-retained-field]");
  const ranges = [...(CSS.highlights.get("cadence-page-active") ?? [])];
  const r = ranges[0];
  if (
    ranges.length !== 1 ||
    !field.contains(r.commonAncestorContainer) ||
    r.toString() !== query ||
    !r.startContainer.textContent.slice(r.startOffset).startsWith(containing)
  )
    throw Error(`Wrong active range: ${containing}`);
  const rect = r.getBoundingClientRect(),
    el = r.startContainer.parentElement;
  let left = 0,
    top = 0,
    right = innerWidth,
    bottom = innerHeight;
  const scrollports = [];
  for (let p = el; p; p = p.parentElement) {
    const css = getComputedStyle(p),
      b = p.getBoundingClientRect();
    if (css.overflowX !== "visible") {
      left = Math.max(left, b.left + p.clientLeft);
      right = Math.min(right, b.left + p.clientLeft + p.clientWidth);
    }
    if (css.overflowY !== "visible") {
      top = Math.max(top, b.top + p.clientTop);
      bottom = Math.min(bottom, b.top + p.clientTop + p.clientHeight);
    }
    if (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth)
      scrollports.push({
        name: `${p.tagName}.${p.className}`,
        scrollLeft: p.scrollLeft,
        scrollTop: p.scrollTop,
      });
  }
  if (
    !rect.width ||
    !rect.height ||
    rect.left < left - 0.5 ||
    rect.right > right + 0.5 ||
    rect.top < top - 0.5 ||
    rect.bottom > bottom + 0.5 ||
    !el.contains(
      document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      ),
    )
  )
    throw Error(
      `Active text clipped: ${JSON.stringify({ containing, rect, left, top, right, bottom })}`,
    );
  if (el.closest("code") && !(el.closest("pre").scrollLeft > 0))
    throw Error("Long code not scrolled horizontally");
  return {
    query,
    containing,
    rect: rect.toJSON(),
    clip: { left, top, right, bottom },
    scrollports,
  };
}
export async function observeFieldFind({
  go,
  click,
  wait,
  press,
  ev,
  send,
  run,
  rows,
  width,
  theme,
}) {
  const pane = ".tab-body .detail-pane",
    bar = `${pane} .search-bar`,
    input = `${bar} input`;
  const mode = `${pane} .field-details button`;
  await go(fieldRoute, input);
  await click(mode, "Markdown page");
  const block = `${pane} .md > .codeblock`,
    other = `${block}:first-of-type`,
    target = `${block}:last-of-type`;
  const fold = async (selector) => {
    await click(`${selector} button[aria-expanded="true"]`);
    await wait(
      `document.querySelector(${JSON.stringify(`${selector} pre[hidden]`)})`,
    );
  };
  await fold(other);
  await fold(target);
  const observe = async (action, query, containing) => {
    assert.ok(
      await ev(
        `!!document.querySelector(${JSON.stringify(`${other} pre[hidden]`)})`,
      ),
      "Revealed unrelated code block",
    );
    rows.push({
      width,
      theme,
      action,
      ...(await run(activeGeometry, query, containing)),
    });
  };
  const unique = "FacetSpotZircon",
    prefix = "FacetSpot";
  await click(input);
  await send("Input.insertText", { text: unique.toLowerCase() });
  assert.ok(
    await ev(
      `document.querySelector('${bar} button').disabled && !CSS.highlights.has('cadence-page')`,
    ),
  );
  await press("a", 65, 2);
  await send("Input.insertText", { text: unique });
  await click(`${bar} button`, "Next match");
  await observe("Next: folded before query", unique, unique);
  await click(input);
  await press("a", 65, 2);
  await send("Input.insertText", { text: prefix });
  const activeClear = "!CSS.highlights.has('cadence-page-active')";
  await wait(`CSS.highlights.get('cadence-page')?.size===3 && ${activeClear}`);
  await fold(target);
  await click(input);
  await press("Enter", 13);
  await observe("Enter: folded after query", prefix, unique);
  await click(input);
  await press("Enter", 13, 8);
  await observe("Shift+Enter: reverse", prefix, "FacetSpot overview");
  await click(`${bar} button`, "Previous match");
  await observe("Previous: wrap", prefix, "FacetSpot appendix");
  await fold(target);
  await click(`${bar} button`, "Previous match");
  await observe("Previous: folded after query", prefix, unique);
  await click(mode, "Raw page");
  await wait(
    `document.querySelector('${pane} .detail-text') && ${activeClear}`,
  );
  await click(`${bar} button`, "Next match");
  rows.push({
    width,
    theme,
    action: "Raw page: forward",
    ...(await run(activeGeometry, prefix, unique)),
  });
  await click(`${pane} > .toolbar button`, "Next field page");
  await wait(
    `document.querySelector('${pane} .detail-text')?.textContent==='Second retained page.' && ${activeClear} && !CSS.highlights.has('cadence-page')`,
  );
  await click(`${pane} > .toolbar button`, "Previous");
  await wait(`CSS.highlights.get('cadence-page')?.size===3 && ${activeClear}`);
  await click(`${bar} button`, "Next match");
  await run(activeGeometry, prefix, unique);
  await click(".view-menu summary");
  await click(".view-menu-items button", "context");
  await wait(
    `!document.querySelector('${input}') && ${activeClear} && !CSS.highlights.has('cadence-page')`,
  );
  rows.push({
    width,
    theme,
    action: "Reset",
    unmounted: true,
    queryChanged: true,
    modeChanged: true,
    pageChanged: true,
  });
}
