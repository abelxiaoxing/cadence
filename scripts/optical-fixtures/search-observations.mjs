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

// Enter through Changes → Inspect full retained field. Deliberately keep the
// same query in the mounted search input while replacing the preview's body.
export async function observeArtifactFind({
  click,
  wait,
  press,
  ev,
  run,
  send,
  width,
  theme,
  rows,
}) {
  const pane = ".inspector-body .detail-pane",
    bar = `${pane} .search-bar`,
    input = `${bar} input`;
  const type = async (query) => {
    await click(input);
    await press("a", 65, 2);
    await send("Input.insertText", { text: query });
    await wait(`document.activeElement.value===${JSON.stringify(query)}`);
  };
  const select = async (view) => {
    const s = `${pane} .fp-head select`;
    await run((s) => document.querySelector(s).focus(), s);
    const [key, code] = {
      raw: ["Home", 36],
      markdown: ["ArrowDown", 40],
      diff: ["End", 35],
    }[view];
    // Markdown follows raw in this native select; no synthetic change event.
    await press(key, code);
    await wait(`document.querySelector('${s}').value==='${view}'`);
  };
  const check = async (query, target, active = false) => {
    const row = await run(
      (pane, query, target) => {
        const el = document.querySelector(pane),
          bar = el.querySelector(".search-bar");
        const ranges = [...(CSS.highlights.get("cadence-page") ?? [])];
        const current = [...(CSS.highlights.get("cadence-page-active") ?? [])];
        const r = current[0],
          rr = r?.getBoundingClientRect();
        return {
          query: bar.querySelector("input").value,
          view: el.querySelector(".fp-head select").value,
          count: bar.querySelector("span").textContent.split(";")[0],
          disabled: [...bar.querySelectorAll("button")].map((b) => b.disabled),
          matches: ranges.map((r) => ({
            text: r.toString(),
            tag: r.startContainer.parentElement.tagName,
            body: r.startContainer.textContent,
            correct:
              target &&
              r.startContainer.isConnected &&
              !!r.startContainer.parentElement.closest(target) &&
              el.contains(r.commonAncestorContainer),
          })),
          active: current.length,
          activeHit:
            !!rr &&
            current.length === 1 &&
            ranges.includes(r) &&
            r.toString() === query &&
            r.startContainer.parentElement.contains(
              document.elementFromPoint(
                rr.x + rr.width / 2,
                rr.y + rr.height / 2,
              ),
            ),
        };
      },
      pane,
      query,
      target,
    );
    rows.push({ width, theme, ...row });
    assert.equal(row.query, query);
    assert.equal(row.count, target ? "1/1" : "0/0");
    assert.deepEqual(row.disabled, [!target, !target]);
    assert.equal(row.matches.length, target ? 1 : 0);
    assert.ok(row.matches.every((m) => m.correct && m.text === query));
    assert.equal(row.active, active ? 1 : 0);
    assert.equal(row.activeHit, active);
  };
  const zero = async (word, chrome) => {
    assert.ok(
      await run(
        (s, word) =>
          [...document.querySelectorAll(s)].some((e) =>
            e.textContent.includes(word),
          ),
        `${pane} ${chrome}`,
        word,
      ),
      `Missing chrome specimen: ${word}`,
    );
    await type(word);
    await check(word, null);
  };
  const navigate = async (word, target) => {
    await check(word, target);
    await click(`${bar} button`, "Next match");
    await check(word, target, true);
  };
  await click(`${pane} .fp-num`, "2");
  for (const [q, s] of [
    ["filesystem read", ".fp-notice"],
    ["Raw text / lines", ".fp-head option"],
    ["Zoom +", ".fp-head button"],
    ["2", ".fp-num"],
    ["Clear selection", ".fp-foot"],
  ])
    await zero(q, s);
  const common = "Captured";
  await type(common);
  const raw = ".fp-code-text",
    diff = ".scm-diff-line";
  // Exact selected body, not merely some descendant of the preview wrapper.
  await navigate(common, raw);
  await select("markdown");
  await wait(`document.querySelector('${pane} .fp-toc')`);
  assert.ok(
    await ev(
      `document.querySelector('${pane} .fp-toc').textContent.includes('Captured')`,
    ),
  );
  await navigate(common, ".fp-markdown-zoom h2");
  await select("diff");
  await navigate(common, diff);
  await click(`${pane} > .toolbar button`, "Next field page");
  await wait(
    `document.querySelector('${pane} .scm-diff-line')?.textContent.includes('next field page')`,
  );
  await navigate(common, `${diff}.add`);
  await click(`${pane} > .toolbar button`, "Previous");
  await wait(`document.querySelector('${pane} .scm-diff-line.hdr')`);
  await navigate(common, diff);
  await select("raw");
  await navigate(common, raw);
  await select("markdown");
  await zero("Image omitted", ".omission");
  await zero("link unavailable", ".fp-markdown-zoom");
  await type("facet 7");
  await navigate("facet 7", ".fp-markdown-zoom p > span:not(.omission)");
  await click('.rp-tabs[aria-label="Inspector"] button', "checks");
  await wait(
    `!document.querySelector('${input}') && !CSS.highlights.has('cadence-page') && !CSS.highlights.has('cadence-page-active')`,
  );
  rows.push({ width, theme, unmounted: true });
}
