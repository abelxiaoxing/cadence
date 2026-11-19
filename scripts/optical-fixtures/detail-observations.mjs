import assert from "node:assert/strict";
import { controlGeometry } from "./measure.mjs";
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
export async function observeOtherIdea(probe, row) {
  const { run, wait, parkPointer, press } = probe;
  await wait(
    `document.querySelector('.design-card .design-custom input:enabled:read-write')`,
  );
  // Allow the transcript and plan to finish their initial size/follow work
  // before scrolling this particular input (not just its enclosing card).
  await run(() =>
    opticalProbe.stableFrames(() => {
      const pane = document.querySelector(".chat-messages"),
        input = pane.querySelector(".design-custom input");
      return [
        pane.scrollHeight,
        pane.scrollTop,
        input.getBoundingClientRect().top,
      ];
    }, "design layout"),
  );
  await run(() =>
    document
      .querySelector(".design-custom input")
      .scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await parkPointer();
  await painted(probe, row, "rest", () => run(designPixels, false));
  // Focus the checked radio, not the input. No changes to the draft.
  await run(() =>
    document
      .querySelector(".design-track input:checked")
      .focus({ preventScroll: true }),
  );
  await press("Tab", 9);
  await painted(probe, row, "tab", () => run(designPixels, true));
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
    if (views) glyph('[aria-pressed="true"]', "timeline");
    else if (panel === ".more-menu-items") {
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
  return { rect: rect.toJSON(), material, points };
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
