import assert from "node:assert/strict";
import { controlGeometry, textSamples } from "./measure.mjs";
import { painted } from "./picker-observations.mjs";
import { dockResult, dockRun } from "./records.mjs";

function designPixels(focused) {
  const el = document.querySelector(".design-card .design-custom input");
  if (
    !el?.matches(":enabled:read-write") ||
    el.value !== "" ||
    el.matches(":hover") ||
    el.matches(":focus") !== focused
  )
    throw Error(
      "Expected the editable, empty Other idea field, pointer elsewhere",
    );
  const css = getComputedStyle(el),
    r = el.getBoundingClientRect(),
    points = [];
  const at = (x, y) => document.elementFromPoint(x, y);
  if (
    css.borderTopStyle !== "solid" ||
    parseFloat(css.borderTopWidth) < 1 ||
    (focused && (!el.matches(":focus-visible") || css.outlineStyle !== "solid"))
  )
    throw Error("Missing design border or keyboard outline");
  for (const f of [0.25, 0.5, 0.75]) {
    const x = Math.floor(r.left + r.width * f);
    const radius = Math.max(
      parseFloat(css.borderTopLeftRadius),
      parseFloat(css.borderTopRightRadius),
    );
    if (Math.min(x - r.left, r.right - x) <= radius)
      throw Error("Sample in rounded corner");
    const edge = Math.round(r.top),
      outside = edge - 2,
      inside = edge + 3;
    if (
      at(x, edge) !== el ||
      at(x, inside) !== el ||
      at(x, outside) !== el.parentElement
    )
      throw Error(
        `Obscured design border or backing: ${JSON.stringify({ x, edge, rect: r.toJSON(), hit: [outside, edge, inside].map((y) => at(x, y)?.outerHTML.slice(0, 100)) })}`,
      );
    if (!focused) {
      for (const [name, y] of [
        ["card", outside],
        ["fill", inside],
      ])
        points.push({
          name: `Resting border on ${name}`,
          x,
          y,
          ink: [x, edge],
          expectedInk: css.borderTopColor,
          min: 3,
          record: true,
        });
    } else {
      const w = parseFloat(css.outlineWidth),
        offset = parseFloat(css.outlineOffset);
      const y = Math.round(r.top - offset - w / 2),
        by = y - Math.ceil(w / 2) - 1;
      if (
        w < 2 ||
        at(x, y) !== el.parentElement ||
        at(x, by) !== el.parentElement
      )
        throw Error("Missing keyboard outline or adjacent card");
      points.push({
        name: "Other idea keyboard focus",
        x,
        y: by,
        ink: [x, y],
        expectedInk: css.outlineColor,
        min: 3,
        record: true,
      });
    }
  }
  return { rect: r.toJSON(), focused, value: el.value, points };
}
function designPosition(selector) {
  const pane = document.querySelector(".chat-messages"),
    target = pane.querySelector(selector).getBoundingClientRect(),
    rect = pane.getBoundingClientRect(),
    active = document.activeElement;
  const { scrollTop, scrollHeight, clientHeight } = pane;
  const left = rect.left + pane.clientLeft,
    top = rect.top + pane.clientTop;
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    bottom: scrollHeight - clientHeight - scrollTop,
    latest: !!document.querySelector(".scroll-bottom"),
    focus: {
      tag: active.tagName,
      type: active.type,
      name:
        active.getAttribute("aria-label") ||
        (active.matches("button") ? active.textContent : active.className),
    },
    pane: rect.toJSON(),
    rect: target.toJSON(),
    visible:
      target.width > 0 &&
      target.height > 0 &&
      target.left >= Math.max(0, left) &&
      target.right <= Math.min(innerWidth, left + pane.clientWidth) &&
      target.top >= Math.max(0, top) &&
      target.bottom <= Math.min(innerHeight, top + clientHeight),
  };
}

export async function observeDesign(
  probe,
  row,
  { wheelAway, audit, observeButton },
) {
  const { run, wait, parkPointer, press } = probe;
  const options = ".design-card .design-track",
    input = ".design-card .design-custom input",
    submit = ".design-card > button:last-child";
  const position = (selector) => run(designPosition, selector);
  await wait(
    `document.querySelector('${submit}:enabled') && document.querySelector('.plan-context') && (()=>{const p=document.querySelector('.chat-messages');return p.scrollTop>0 && p.scrollHeight-p.clientHeight-p.scrollTop<3})()`,
  );
  row.wheel = { before: await position(options) };
  assert.ok(!row.wheel.before.latest && row.wheel.before.bottom < 3);
  try {
    row.wheel.point = await wheelAway();
  } finally {
    row.wheel.after = await position(options);
  }
  assert.ok(row.wheel.after.latest && row.wheel.after.bottom > 80);
  await parkPointer();
  row.positions = [];
  const place = async (selector) => {
    const entry = { selector, before: await position(selector), captures: [] };
    row.positions.push(entry);
    await run(
      (s) =>
        document.querySelector(s).scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        }),
      selector,
    );
    entry.after = await position(selector);
    assert.ok(entry.after.visible, `Could not position ${selector}`);
    // painted() calls locate on either side of one unmodified viewport PNG.
    // Read only: a lost reading position must fail, not be centered again.
    return async (state, sample) => {
      const sides = [];
      entry.captures.push({ state, sides });
      await painted(probe, row, state, async () => {
        const reading = await position(selector);
        sides.push(reading);
        assert.ok(
          reading.visible && reading.latest,
          `Lost ${selector} while reading`,
        );
        assert.equal(reading.scrollTop, entry.after.scrollTop);
        return { reading, ...(await sample()) };
      });
    };
  };
  const optionFrame = await place(options);
  await optionFrame("options", () =>
    run(() => ({
      points: [
        ["label:has(input:checked)", "Frames"],
        ["label:has(input:not(:checked))", "Everywhere"],
      ].map(([s, name]) => ({
        ...opticalProbe.glyphSample(`.design-track ${s}`, name, null, "label"),
        record: true,
      })),
    })),
  );
  // Under-text contrast on the visible card, paired with the unmodified
  // option frame. A live status-bar reading is not a design answer.
  const { file, sample } = row.frames.at(-1);
  await audit(
    "design",
    [".chat-messages", ".design-card", ".design-track", ".design-track label"],
    { textRoot: ".design-card", options: { file, readings: sample.readings } },
  );
  const inputFrame = await place(input);
  await inputFrame("rest", () => run(designPixels, false));
  // Tab from the checked radio, leaving the draft and its selection intact.
  await run(() =>
    document
      .querySelector(".design-track input:checked")
      .focus({ preventScroll: true }),
  );
  await press("Tab", 9);
  await inputFrame("tab", () => run(designPixels, true));
  const submitFrame = await place(submit);
  const button = await observeButton(
    "submit design",
    submit,
    "Submit design and use recommendations for unanswered questions",
    false,
  );
  assert.equal(button.keyboardFocus, true);
  await submitFrame("submit-tab", async () => {
    const control = await run(controlGeometry, submit, false);
    assert.deepEqual(control.visible, control.rect);
    assert.ok(Object.values(control.hit).every((p) => p.hit));
    const point = (await run(textSamples)).find(
      (p) => p.name === "BUTTON focus",
    );
    assert.ok(
      point &&
        (await run(
          (s) => document.activeElement.matches(`${s}:enabled:focus-visible`),
          submit,
        )),
      "Missing submit Tab focus",
    );
    return { control, points: [{ ...point, record: true }] };
  });
}

// Outer frame and sample ownership on the actual open control, not an empty
// probe swatch. Text/indicator pixels and their backings come from one PNG.
function panelPixels(panel, control) {
  const el = document.querySelector(panel),
    css = getComputedStyle(el),
    mention = panel === ".mention-menu",
    plate = mention ? getComputedStyle(el, "::before") : css,
    list = mention ? el.querySelector(":scope > .mention-list") : null,
    rect = el.getBoundingClientRect();
  const at = (x, y) => document.elementFromPoint(x, y);
  const midX = rect.left + rect.width / 2,
    midY = rect.top + rect.height / 2;
  for (const [x, y] of [
    [rect.left + 1, midY],
    [rect.right - 1, midY],
    [midX, rect.top + 1],
    [midX, rect.bottom - 1],
  ])
    if (!el.contains(at(x, y)))
      throw Error(`Clipped/obstructed ${panel} at ${x},${y}`);
  const material = {
    backgroundColor: plate.backgroundColor,
    backgroundImage: plate.backgroundImage,
    backgroundSize: plate.backgroundSize,
    backdropFilter: plate.backdropFilter,
    boxShadow: css.boxShadow,
    borderTopColor: css.borderTopColor,
    borderRightColor: css.borderRightColor,
    borderBottomColor: css.borderBottomColor,
    borderLeftColor: css.borderLeftColor,
  };
  const alpha = (s) =>
    s.startsWith("rgba(") ? Number(s.slice(s.lastIndexOf(",") + 1, -1)) : 1;
  if (
    alpha(plate.backgroundColor) < 0.95 ||
    !plate.backgroundImage.includes("radial-gradient(") ||
    plate.backgroundSize === "auto" ||
    !/blur\(.+\) saturate\(/.test(plate.backdropFilter) ||
    css.boxShadow === "none" ||
    css.borderTopStyle !== "solid" ||
    ![css.borderRightColor, css.borderBottomColor, css.borderLeftColor].every(
      (c) => alpha(c) < alpha(css.borderTopColor),
    )
  )
    throw Error(`Missing menu material: ${JSON.stringify(material)}`);
  if (
    mention &&
    (plate.content === "none" ||
      plate.pointerEvents !== "none" ||
      plate.display === "none" ||
      plate.visibility !== "visible" ||
      plate.opacity !== "1" ||
      !list)
  )
    throw Error("Missing noninteractive mention plate or scrolling listbox");
  for (const content of [
    mention && el,
    list,
    el.closest("form"),
    el.querySelector("img"),
  ].filter(Boolean))
    if (
      getComputedStyle(content).filter !== "none" ||
      getComputedStyle(content).backdropFilter !== "none"
    )
      throw Error(
        `Filter on foreground: ${content.tagName}.${content.className}`,
      );
  const points = [];
  const glyph = (selector, text, surface = "button") =>
    points.push({
      ...opticalProbe.glyphSample(`${panel} ${selector}`, text, null, surface),
      record: true,
    });
  const button = el.querySelector(control),
    r = button.getBoundingClientRect();
  const views = panel === ".view-menu-items";
  let viewState;
  if (mention) {
    if (
      !document.activeElement.matches("textarea") ||
      !el.matches('[role="listbox"]') ||
      document.activeElement.getAttribute("aria-controls") !== el.id ||
      document.activeElement.getAttribute("aria-activedescendant") !==
        button.id ||
      !button.matches('[role="option"][aria-selected="true"]') ||
      !list.contains(button)
    )
      throw Error("Mention selection left the editor");
    glyph(
      ".mention-menu-folder",
      "Files in the conversation folder",
      ".mention-menu-hint",
    );
    glyph(
      ".mention-menu-hint > span:last-child",
      "Enter inserts the path · Esc closes",
      ".mention-menu-hint",
    );
    glyph('[role="option"][aria-selected="false"] .mention-name', "facets");
    glyph(".active .mention-name", "material.ts");
  } else {
    if (!button.matches(":focus-visible"))
      throw Error(`Missing Tab focus: ${control}`);
    const style = getComputedStyle(button),
      w = parseFloat(style.outlineWidth),
      offset = parseFloat(style.outlineOffset);
    const x = Math.floor(r.left + r.width / 2),
      y = Math.round(r.top - offset - w / 2),
      by = y - Math.ceil(w / 2) - 1;
    if (
      w < 2 ||
      style.outlineStyle !== "solid" ||
      !el.contains(at(x, y)) ||
      !el.contains(at(x, by))
    )
      throw Error(`Missing focus ink/face in ${panel}`);
    points.push({
      name: "Tab focus",
      x,
      y: by,
      ink: [x, y],
      expectedInk: style.outlineColor,
      min: 3,
      record: true,
    });
    if (views) {
      const selected = el.querySelector('[aria-pressed="true"]');
      viewState = {
        selected: selected?.textContent,
        focus: document.activeElement.textContent,
        transitions: selected
          ?.getAnimations()
          .map((a) => a.transitionProperty || a.id),
      };
      if (
        viewState.selected !== "timeline" ||
        viewState.focus !== "tools" ||
        !button.matches('[aria-pressed="false"]') ||
        selected.matches(":focus,:hover") ||
        viewState.transitions.length
      )
        throw Error(
          `Expected static Timeline selection and separate Tools focus: ${JSON.stringify(viewState)}`,
        );
      glyph('[aria-pressed="true"]', "timeline");
    } else if (panel === ".more-menu-items") {
      glyph("[aria-pressed]", "Ambient light");
      const state = button.getAttribute("aria-pressed");
      glyph("[aria-pressed] > span", state === "true" ? "●" : "○");
    } else
      glyph(".img-lightbox-name", "Attached image", ".img-lightbox-toolbar");
  }
  if (mention || views) {
    const selected = el.querySelector(
        '[aria-selected="true"], [aria-pressed="true"]',
      ),
      s = getComputedStyle(selected),
      b = selected.getBoundingClientRect();
    const x = Math.round(b.left) + 1,
      y = Math.floor(b.top + b.height / 2);
    for (const [name, bx, target] of [
      ["row", x + 3, selected],
      ["menu", x - 3, mention ? list : el],
    ]) {
      if (at(x, y) !== selected || at(bx, y) !== target)
        throw Error("Hidden selected row indicator/backing");
      points.push({
        name: `Selected stroke on ${name}`,
        x: bx,
        y,
        ink: [x, y],
        expectedInk: mention ? s.borderLeftColor : s.color,
        min: 3,
        record: true,
      });
    }
  }
  return { rect: rect.toJSON(), material, ...(views && { viewState }), points };
}
// The fixed gutter point already used for stroke/menu contrast must actually
// show the plate, not just offer a high ratio on some unrelated backing. Bound
// its channels over any backdrop, allowing the translucent grain stops.
function checkMentionBacking({ material, sample }) {
  const rgba = (s) => s.match(/[\d.]+/g).map(Number);
  const base = rgba(material.backgroundColor);
  const grain = [...material.backgroundImage.matchAll(/rgba?\([^)]+\)/g)]
    .reverse()
    .map(([s]) => rgba(s));
  const { bg } = sample.readings.find(
    (r) => r.name === "Selected stroke on menu",
  );
  for (const [i, channel] of bg.entries()) {
    const opacity = base[3] ?? 1;
    let lo = base[i] * opacity,
      hi = lo + 255 * (1 - opacity);
    for (const stop of grain) {
      const a = stop[3] ?? 1;
      lo = Math.min(lo, lo * (1 - a) + stop[i] * a);
      hi = Math.max(hi, hi * (1 - a) + stop[i] * a);
    }
    assert.ok(
      channel >= Math.floor(lo) && channel <= Math.ceil(hi),
      `Menu backing ${bg} outside the painted plate range (channel ${i}: ${lo}–${hi})`,
    );
  }
}
export async function observeOpenMaterial(probe, row, panel) {
  const { run, press, parkPointer, wait } = probe;
  const controls = {
    ".mention-menu": ".mention-item.active",
    ".view-menu-items": "button:first-child",
    ".more-menu-items": "button[aria-pressed]",
    ".img-lightbox-panel": 'button[aria-label="Zoom out"]',
  };
  const control = controls[panel];
  await parkPointer();
  if (panel === ".mention-menu") {
    await wait(
      `document.querySelector('.mention-item.active .mention-name')?.textContent==='facets'`,
    );
    await press("ArrowDown", 40);
    await wait(
      `document.querySelector('.mention-item.active .mention-name')?.textContent==='material.ts'`,
    );
    await run(() =>
      Promise.all(
        document
          .querySelector(".mention-item.active")
          .getAnimations()
          .map((a) => a.finished),
      ),
    );
  } else await press("Tab", 9);
  const geometry = await run(controlGeometry, `${panel} ${control}`, false);
  row.control = geometry;
  assert.ok(
    !geometry.disabled && Object.values(geometry.hit).every((p) => p.hit),
  );
  assert.equal(geometry.visible.width, geometry.rect.width);
  assert.equal(geometry.visible.height, geometry.rect.height);
  await painted(probe, row, "keyboard", () => run(panelPixels, panel, control));
  if (panel === ".mention-menu") checkMentionBacking(row.frames.at(-1));
}

// Hit-test the heading, but read the enclosing mounted surface, not a row.
function surfaceMaterial(selector, headingSelector) {
  const heading = document.querySelector(headingSelector),
    card = heading.closest(selector),
    rect = heading.getBoundingClientRect(),
    x = rect.left + rect.width / 2,
    y = rect.top + rect.height / 2;
  if (!heading.contains(document.elementFromPoint(x, y)))
    throw Error(`Obscured ${selector} heading`);
  const css = getComputedStyle(card);
  return {
    heading: heading.textContent,
    point: { x, y },
    rect: card.getBoundingClientRect().toJSON(),
    hovered: card.matches(":hover"),
    fill: css.backgroundColor,
    radius: css.borderRadius,
    grain: css.backgroundImage,
    size: css.backgroundSize,
    position: css.backgroundPosition,
    animations: card.getAnimations().map((a) => a.playState),
    filter: css.backdropFilter,
    shadow: css.boxShadow,
    edges: ["Top", "Right", "Bottom", "Left"].map((side) => ({
      style: css[`border${side}Style`],
      width: css[`border${side}Width`],
      color: css[`border${side}Color`],
    })),
  };
}
// Resolve the tier's tokens in this document's scheme and media query. This
// hidden reference supplies expected values only; it is never a paint sample.
function expectedMaterial(wing) {
  const el = document.createElement("span");
  Object.assign(el.style, {
    display: "none",
    backgroundColor: wing ? "var(--glass-surface)" : "var(--card-bg)",
    backgroundImage: "var(--grain-image)",
    backgroundSize: "var(--grain-size)",
    backdropFilter: wing ? "var(--glass-filter)" : "var(--card-filter)",
    border: `1px solid var(${wing ? "--glass-border" : "--glass-card-border"})`,
    borderTopColor: "var(--glass-border-top)",
    boxShadow: wing
      ? "0 8px 22px var(--shadow-1), inset 0 1px var(--glass-border-top)"
      : "0 10px 30px var(--glass-card-shadow)",
  });
  document.body.append(el);
  try {
    const css = getComputedStyle(el);
    return {
      fill: css.backgroundColor,
      grain: css.backgroundImage,
      size: css.backgroundSize,
      position: css.backgroundPosition,
      filter: css.backdropFilter,
      shadow: css.boxShadow,
      edges: ["Top", "Right", "Bottom", "Left"].map((side) => ({
        style: css[`border${side}Style`],
        width: css[`border${side}Width`],
        color: css[`border${side}Color`],
      })),
    };
  } finally {
    el.remove();
  }
}
const alpha = (s) => Number(s.match(/^rgba\(.*?, ([\d.]+)\)$/)?.[1] ?? 1);
async function checkTier(run, material, wing) {
  for (const [key, expected] of Object.entries(
    await run(expectedMaterial, wing),
  ))
    assert.deepEqual(
      material[key],
      expected,
      `Wrong ${wing ? "wing" : "card"} ${key}`,
    );
}
async function captureSurface(
  { run, screenshot, width, theme, rows },
  selector,
  headingSelector,
  state,
) {
  const read = () => run(surfaceMaterial, selector, headingSelector);
  const material = await read();
  const file = `${selector.slice(1)}-${theme}-${width}-${state}.png`;
  rows.push({
    width,
    theme,
    selector,
    headingSelector,
    state,
    file,
    ...material,
  });
  await screenshot(file);
  assert.deepEqual(await read(), material);
  assert.equal(material.hovered, state === "hover");
  assert.deepEqual(material.animations, []);
  return material;
}
async function observeWingMaterial(probe, selector, headingSelector) {
  await probe.parkPointer();
  await probe.run(async (s) => {
    const el = document.querySelector(s);
    await Promise.all(el.getAnimations().map((a) => a.finished));
    if (
      !el.matches(".panel-drawer.open:not([inert])") ||
      new DOMMatrixReadOnly(getComputedStyle(el).transform).m41 !== 0
    )
      throw Error(`Expected settled open ${s}`);
  }, selector);
  const material = await captureSurface(
    probe,
    selector,
    headingSelector,
    "open",
  );
  assert.ok(
    material.rect.left >= -0.01 && material.rect.right <= probe.width + 0.01,
  );
  assert.ok(alpha(material.fill) > 0 && alpha(material.fill) < 1);
  await checkTier(probe.run, material, true);
}
export async function observeCardMaterial(
  probe,
  selector,
  headingSelector = `${selector} :is(h2,h3)`,
) {
  const { run, send, scrollTo, parkPointer } = probe;
  await scrollTo(headingSelector);
  await parkPointer();
  const capture = async (state) => {
    const material = await captureSurface(
      probe,
      selector,
      headingSelector,
      state,
    );
    assert.ok(alpha(material.fill) >= 0.9);
    if (state === "rest") assert.ok(alpha(material.fill) < 1);
    assert.match(material.radius, /^1[4-6]px$/);
    assert.equal(material.grain.match(/radial-gradient\(/g)?.length, 2);
    assert.match(material.size, /^\d+px \d+px, \d+px \d+px$/);
    assert.match(material.filter, /blur\([\d.]+px\) saturate\(/);
    assert.notEqual(material.shadow, "none");
    const [top, right, bottom, left] = material.edges;
    assert.ok(
      material.edges.every(
        (edge) => edge.style === "solid" && edge.width === "1px",
      ),
    );
    assert.deepEqual(right, bottom);
    assert.deepEqual(right, left);
    assert.ok(alpha(top.color) > alpha(right.color));
    return material;
  };
  const rest = await capture("rest");
  if (selector === ".toolcall" || selector === ".thinking")
    await checkTier(run, rest, false);
  if (selector === ".scm-file") {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...rest.point,
    });
    const hover = await capture("hover");
    assert.notEqual(hover.fill, rest.fill);
    assert.deepEqual(hover, { ...rest, fill: hover.fill, hovered: true });
    await parkPointer();
  }
}

// Focus and ink are pixel observations, separate from the computed material.
async function observeSurfaceContrast(probe, surface, button, label, text) {
  const { run, observeButton, textContrast } = probe;
  const row = {
    scene: `${surface.slice(1)}-contrast`,
    width: probe.width,
    theme: probe.theme,
    frames: [],
  };
  probe.rows.push(row);
  assert.ok((await observeButton(row.scene, button)).keyboardFocus);
  await painted(probe, row, "tab", () =>
    run(
      (surface, button, label, text) => {
        const target = document.activeElement;
        if (!target.matches(button) || !target.matches(":focus-visible"))
          throw Error(`Missing Tab focus on ${button}`);
        const css = getComputedStyle(target),
          r = target.getBoundingClientRect();
        const w = parseFloat(css.outlineWidth),
          o = parseFloat(css.outlineOffset);
        const y = Math.floor(r.top + r.height / 2),
          x = Math.floor(r.right + o + w / 2),
          bx = x + Math.ceil(w / 2) + 1;
        const plate = target.closest(surface);
        if (
          w < 2 ||
          css.outlineStyle !== "solid" ||
          ![x, bx].every((px) =>
            plate.contains(document.elementFromPoint(px, y)),
          )
        )
          throw Error(
            `Missing focus outline or adjacent material in ${surface}`,
          );
        const focusedCard = plate.matches(".toolcall,.thinking");
        const underlay = focusedCard && getComputedStyle(plate, "::before");
        return {
          ...(focusedCard && {
            focusedMaterial: {
              fill: getComputedStyle(plate).backgroundColor,
              grain: getComputedStyle(plate).backgroundImage,
              shellFilter: getComputedStyle(plate).backdropFilter,
              filter: underlay.backdropFilter,
              behind: underlay.zIndex,
              interactive: underlay.pointerEvents,
              content: underlay.content,
            },
          }),
          points: [
            { ...opticalProbe.glyphSample(label, text), record: true },
            {
              name: "Tab focus",
              ink: [x, y],
              x: bx,
              y,
              min: 3,
              expectedInk: css.outlineColor,
              record: true,
            },
          ],
        };
      },
      surface,
      button,
      label,
      text,
    ),
  );
  if (surface === ".toolcall" || surface === ".thinking") {
    const { fill, grain, filter } = await run(expectedMaterial, false);
    assert.deepEqual(row.frames.at(-1).focusedMaterial, {
      fill,
      grain,
      filter,
      shellFilter: "none",
      behind: "-1",
      interactive: "none",
      content: '""',
    });
  }
  row.underText = await textContrast(row.scene, surface);
  assert.ok(row.underText?.samples);
  assert.deepEqual(row.underText.failures, []);
}

export async function observeChatMaterials(probe, report) {
  const { go, chat, click, press, wait, width } = probe;
  const contrast = { ...probe, rows: report.surfaceContrast };
  await go(chat("step-material"), ".chat-turn .thinking-label");
  for (const [selector, text] of [
    [".toolcall", "read"],
    [".thinking", "Thinking"],
  ]) {
    const button = `.chat-turn ${selector} .chead-main[aria-expanded="false"]`;
    const label = `${button} .chead-title`;
    await observeCardMaterial(probe, selector, label);
    await observeSurfaceContrast(contrast, selector, button, label, text);
  }
  if (width > 900) return;
  const section = ".running-conversations .lp-section-heading";
  const tab = ".rp-tabs > button.rp-tab:nth-child(2)";
  for (const [side, toggle, control, heading, text] of [
    [
      "left",
      ".navigation-toggle",
      section,
      `${section} .lp-section-title`,
      "Running work",
    ],
    ["right", ".inspector-toggle", tab, tab, "Branches"],
  ]) {
    const wing = `.drawer-${side}.open`,
      label = `${wing} ${heading}`;
    await click(toggle);
    await wait(`document.querySelector(${JSON.stringify(label)})`);
    await observeWingMaterial(
      { ...probe, rows: report.wingMaterials },
      wing,
      label,
    );
    await observeSurfaceContrast(
      contrast,
      wing,
      `${wing} ${control}`,
      label,
      text,
    );
    await press("Escape", 27);
    await wait(`document.activeElement.matches(${JSON.stringify(toggle)})`);
  }
}

export async function observeRetainedCopy(
  { run, click, wait, observeCopy, site },
  subagent,
) {
  const group = subagent
    ? ".workflow-agent-result"
    : ".workflow-card > details.chat-tool";
  const output = `${group} .retained-result`;
  // The dock fixture is terminal. Each entry's first open reads once; Copy
  // itself must never read, regardless of how often a live view would poll.
  const count = site.detailReads.length;
  if (!subagent) await click(`${group} > summary`);
  assert.equal(await run((s) => !!document.querySelector(s), output), false);
  assert.equal(
    await run((s) => document.querySelector(`${s} .md p`).textContent, group),
    dockRun.steps[0].text,
  );
  await click(`${group} > button`, "Read retained step result");
  await wait(
    `document.querySelector('${output} pre')?.textContent === ${JSON.stringify(dockResult)}`,
  );
  await observeCopy(
    subagent ? "subagent result" : "workflow result",
    `${output} .toolcall-output-label .output-copy`,
    "Copy output",
    dockResult,
    { run: dockRun.id, step: dockRun.steps[0].id },
  );
  assert.deepEqual(site.detailReads.slice(count), [
    { kind: "workflow-detail", id: dockRun.id, stepId: dockRun.steps[0].id },
  ]);
  if (subagent) await click(`${group} > button`, "Read retained step result");
  else await click(`${group} > summary`);
  assert.equal(
    await run(
      (s) => document.querySelector(s)?.checkVisibility() ?? false,
      `${output} button`,
    ),
    false,
  );
}
