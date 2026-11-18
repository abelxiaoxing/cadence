import assert from "node:assert/strict";
import { controlGeometry } from "./measure.mjs";
import { fieldRoute, literalRoute, searchSpecimen } from "./records.mjs";

// These queries all start in the actual input. Never focus an option or scroll
// a result in the probe: the application must keep its own active row visible.
export async function observeSearch({
  go,
  click,
  press,
  send,
  ev,
  run,
  wait,
  capture,
  width,
  theme,
  rows,
}) {
  const opener = ".search-toggle:not(:disabled)",
    input = '.gs-input-row input[role="combobox"]',
    option = '.gs-results [role="option"][aria-selected="true"]';
  await go(fieldRoute, opener);
  await click(opener);
  const focused = `document.activeElement.matches('${input}')`;
  await wait(focused);
  await press("Escape", 27);
  await wait(`document.activeElement.matches('${opener}')`);
  await click(opener);
  await wait(focused);
  const active = (preview) =>
    `document.querySelector('${option} .gs-item-sub')?.textContent === ${JSON.stringify(preview)} && ${focused}`;
  await send("Input.insertText", { text: "Recorded" });
  await wait(active("Recorded layer 1."));
  const previous = await ev(
    `document.activeElement.getAttribute('aria-activedescendant')`,
  );
  await press("Tab", 9);
  assert.ok(
    await ev(`document.activeElement.matches('.gs-results > button:enabled')`),
  );
  await press(" ", 32);
  await wait(active("Recorded layer 25."));
  assert.ok(
    await ev(
      `!document.getElementById(${JSON.stringify(previous)}) && document.activeElement.getAttribute('aria-activedescendant')===document.querySelector('${option}').id`,
    ),
  );
  await send("Input.insertText", { text: " layer" });
  await wait(
    `${focused} && !document.activeElement.hasAttribute('aria-activedescendant')`,
  );
  const query = "Recorded layer",
    hits = searchSpecimen(query);
  await wait(active(hits[0].preview));
  const state = () =>
    run(
      (input, option) => {
        const caret = document.querySelector(input),
          row = document.querySelector(option),
          list = document.getElementById(caret.getAttribute("aria-controls"));
        const pane = list.closest(".gs-results");
        const options = [...list.children];
        if (
          document.activeElement !== caret ||
          caret.getAttribute("aria-expanded") !== "true" ||
          list.role !== "listbox" ||
          options.length !== 24 ||
          !options.every((e) => e.role === "option") ||
          list.querySelectorAll('[aria-selected="true"]').length !== 1 ||
          row.id !== caret.getAttribute("aria-activedescendant")
        )
          throw Error("Invalid active history hit");
        return {
          id: row.id,
          index: options.indexOf(row),
          preview: row.querySelector(".gs-item-sub").textContent,
          top: pane.scrollTop,
          outer: pane.closest("dialog").scrollTop,
          page: scrollY,
        };
      },
      input,
      option,
    );
  const indicator = () =>
    run((s) => {
      const el = document.querySelector(s),
        r = el.getBoundingClientRect(),
        css = getComputedStyle(el);
      if (
        css.borderLeftStyle !== "solid" ||
        parseFloat(css.borderLeftWidth) < 2 ||
        el.matches(":hover")
      )
        throw Error("Missing resting selection stroke");
      const y = Math.floor(r.top + r.height / 2),
        ink = [Math.floor(r.left + 1.5), y];
      return [
        ["dialog", r.left - 2],
        ["option", r.left + 5],
      ].map(([name, x]) => ({ name, x: Math.floor(x), y, ink, min: 3 }));
    }, option);
  const record = async (action, i) => {
    const selection = await state();
    assert.equal(selection.index, i);
    assert.equal(selection.preview, hits[i].preview);
    const geometry = await run(controlGeometry, option, false);
    assert.ok(
      geometry.visible.width >= geometry.rect.width - 0.01 &&
        geometry.visible.height >= geometry.rect.height - 0.01,
      "Clipped active hit",
    );
    assert.ok(Object.values(geometry.hit).every((p) => p.hit));
    const contrast = {};
    for (const side of ["dialog", "option"]) {
      const sample = await capture(action, async () =>
        (await indicator()).filter((p) => p.name === side),
      );
      assert.equal(sample?.samples, 1);
      assert.deepEqual(sample.failures, []);
      contrast[side] = sample.worst;
    }
    rows.push({ width, theme, action, selection, geometry, contrast });
    return selection;
  };
  const first = await record("initial", 0);
  const step = async (i, down) => {
    await press(down ? "ArrowDown" : "ArrowUp", down ? 40 : 38);
    await wait(active(hits[i].preview));
  };
  // Measure before pressing any arrow: the destination really was offscreen.
  const distant = 16;
  const before = await run((i) => {
    const row = document.querySelectorAll('.gs-results [role="option"]')[i];
    return (
      row.getBoundingClientRect().top >=
      row.closest(".gs-results").getBoundingClientRect().bottom
    );
  }, distant);
  assert.equal(before, true);
  await step(1, true);
  assert.equal(
    (await state()).top,
    first.top,
    "Moved result pane for an already visible hit",
  );
  for (let i = 2; i <= distant; i++) await step(i, true);
  const far = await record("below first screen", distant);
  assert.ok(far.top > first.top);
  for (let i = distant - 1; i >= 1; i--) await step(i, false);
  const back = await record("returned", 1);
  assert.ok(back.top < far.top);
  assert.ok(
    [far, back].every((s) => s.outer === first.outer && s.page === first.page),
  );
  const picked = hits[back.index];
  await press("Enter", 13);
  const mark = ".tab-body .detail-text mark";
  await wait(
    `document.querySelector('${mark}')?.textContent===${JSON.stringify(query)} && document.querySelector('${mark}').parentElement.textContent.startsWith(${JSON.stringify(picked.preview)})`,
  );
  const opened = await run(
    (s) => ({
      cursor: JSON.parse(
        new URLSearchParams(location.hash.slice(1)).get("detail"),
      ),
      text: document.querySelector(s).parentElement.textContent,
      range: document.querySelector(".tab-body .field-details > p").textContent,
    }),
    mark,
  );
  assert.deepEqual(opened.cursor, picked.cursor);
  assert.ok(opened.text.startsWith(picked.preview));
  assert.ok(
    opened.range.includes(`[${picked.range.start}, ${picked.range.end})`),
  );
  rows.push({
    width,
    theme,
    action: "Enter",
    active: back.id,
    preview: picked.preview,
    cursor: opened.cursor,
    range: picked.range,
  });
}

// Exercise both localized captions on the same immutable bytes. A later page
// contains the very same words as real prose and folded code, not just chrome.
export async function observeFieldBoundaries({
  go,
  click,
  press,
  send,
  ev,
  run,
  wait,
  width,
  theme,
  rows,
}) {
  const pane = ".tab-body .detail-pane",
    input = `${pane} .search-bar input`,
    mode = `${pane} .field-details button:first-child`;
  for (const [route, real] of [
    [fieldRoute, false],
    [literalRoute, true],
  ]) {
    await go(route, input);
    await click(mode, "Markdown page");
    const fold = `${pane} .code-caption button[aria-expanded]`;
    await click(fold);
    const type = async (word) => {
      await click(input);
      await press("a", 65, 2);
      await send("Input.insertText", { text: word });
      await wait(`document.activeElement.value === ${JSON.stringify(word)}`);
    };
    for (const word of ["Code", "代码"]) {
      if (word === "代码") await click(".chip-lang");
      assert.ok(
        await ev(
          `document.querySelector('${fold}').textContent.includes(${JSON.stringify(word)})`,
        ),
      );
      await type(word);
      const found = await run(
        (pane) => ({
          navigation: [
            ...document.querySelectorAll(`${pane} .search-bar button`),
          ].map((b) => !b.disabled),
          matches: [...(CSS.highlights.get("cadence-page") ?? [])].map((r) => ({
            text: r.toString(),
            tag: r.startContainer.parentElement.tagName,
            folded: !!r.startContainer.parentElement.closest("pre[hidden]"),
          })),
        }),
        pane,
      );
      assert.deepEqual(found.navigation, [real, real]);
      assert.deepEqual(
        found.matches,
        real
          ? [
              { text: word, tag: "P", folded: false },
              { text: word, tag: "CODE", folded: true },
            ]
          : [],
      );
      rows.push({
        width,
        theme,
        action: "field vs generated caption",
        real,
        word,
        ...found,
      });
      if (word === "代码") await click(".chip-lang");
    }
    if (real) {
      await click(fold);
      await type("2"); // Present in the displayed gutter, absent from the code.
      assert.ok(
        await ev(
          `[...document.querySelectorAll('${pane} .code-num')].some(n => n.textContent==='2' && n.checkVisibility())`,
        ),
      );
      assert.ok(
        await ev(
          `!CSS.highlights.has('cadence-page') && document.querySelectorAll('${pane} .search-bar button:disabled').length===2`,
        ),
      );
      await type("1");
      const bound = await ev(
        `(()=>{const ranges=[...(CSS.highlights.get('cadence-page')??[])]; return {count:ranges.length, prose:ranges.every(r=>r.startContainer.parentElement.tagName==='P'), last:ranges.at(-1)?.startContainer.textContent}})()`,
      );
      assert.deepEqual(bound, { count: 1000, prose: true, last: "Final 1." });
      rows.push({
        width,
        theme,
        action: "gutter excluded before visual bound",
        ...bound,
      });
    }
  }
}
