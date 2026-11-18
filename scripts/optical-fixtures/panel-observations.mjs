import assert from "node:assert/strict";
import { controlGeometry, glyphSample } from "./measure.mjs";

// The activated page is not necessarily the button under the pointer or the
// keyboard focus. Sample the real underline independently of both states.
function tabPixels(group, label, state, other) {
  const tabs = [...document.querySelectorAll(`${group} > .rp-tab`)];
  const current = tabs.filter((e) =>
    e.matches('[aria-current="true"], [aria-pressed="true"]'),
  );
  const painted = tabs.filter(
    (e) =>
      getComputedStyle(e, "::after").borderBottomStyle === "solid" &&
      getComputedStyle(e, "::after").content !== "none",
  );
  const el = current[0];
  if (
    current.length !== 1 ||
    painted.length !== 1 ||
    painted[0] !== el ||
    el.textContent !== label ||
    el.matches(":hover") ||
    el.matches(":focus") !== (state === "keyboard")
  )
    throw Error(`Wrong ${group} marker: ${label}, ${state}`);
  if (
    state === "other hovered" &&
    !tabs.some((e) => e.textContent === other && e.matches(":hover"))
  )
    throw Error(`Pointer did not hover ${other}`);
  const r = el.getBoundingClientRect(),
    css = getComputedStyle(el),
    stroke = getComputedStyle(el, "::after");
  const bottom =
    r.bottom - parseFloat(css.borderBottomWidth) - parseFloat(stroke.bottom);
  const y = Math.floor(bottom - parseFloat(stroke.borderBottomWidth) / 2);
  const points = [];
  for (const f of [0.25, 0.5, 0.75]) {
    const x = Math.floor(r.left + r.width * f);
    if (!el.contains(document.elementFromPoint(x, y)))
      throw Error(`Clipped current-page marker: ${label}`);
    for (const [material, by] of [
      ["tab", y - 2],
      ["wing", Math.floor(r.bottom + 2)],
    ])
      points.push({
        name: `${label} on ${material}`,
        surface: material,
        ink: [x, y],
        x,
        y: by,
        min: 3,
      });
  }
  if (state === "keyboard") {
    if (!el.matches(":focus-visible") || css.outlineStyle !== "solid")
      throw Error("Missing separate keyboard outline");
    const x = Math.floor(r.left + r.width / 2);
    points.push({
      name: `${label} focus`,
      surface: "focus",
      ink: [x, Math.floor(r.top + 1)],
      x,
      y: Math.floor(r.top + 3),
      min: 3,
    });
  }
  return points;
}

export async function observePanelTabs(
  { run, click, parkPointer, capture, press, send, width, theme, rows },
  context,
  group,
  labels,
) {
  const nav = `.rp-tabs[aria-label="${group}"]`,
    tabs = `${nav} > .rp-tab`;
  assert.deepEqual(
    await run(
      (s) => [...document.querySelectorAll(s)].map((el) => el.textContent),
      tabs,
    ),
    labels,
  );
  const record = async (label, other, state, target) => {
    const geometry = await run(controlGeometry, target, false);
    const { rect, visible, hit } = geometry;
    const clipped =
      visible.width < rect.width - 0.01 ||
      visible.height < rect.height - 0.01 ||
      !Object.values(hit).every((p) => p.hit);
    assert.ok(
      !clipped,
      `Clipped ${context}/${label}/${state}: ${JSON.stringify(geometry)}`,
    );
    const observed = await capture(`${label} ${state}`, () =>
      run(tabPixels, nav, label, state, other),
    );
    assert.equal(observed?.samples, state === "keyboard" ? 7 : 6);
    rows.push({
      width,
      theme,
      context,
      group,
      label,
      other,
      state,
      clipped,
      geometry,
      ...observed,
    });
    assert.deepEqual(observed.failures, []);
    return rect;
  };
  await parkPointer();
  if (labels.length === 1) {
    await record(labels[0], null, "rest", `${tabs}[aria-current="true"]`);
    return;
  }
  for (const [i, label] of labels.entries()) {
    const j = i ? i - 1 : 1,
      other = labels[j],
      target = `${tabs}:nth-child(${i + 1})`;
    await click(tabs, other);
    await parkPointer();
    await press("Tab", 9, i > j ? 0 : 8);
    assert.ok(
      await run(
        (s) =>
          document.activeElement.matches(
            `${s}:focus-visible[aria-pressed="false"]`,
          ),
        target,
      ),
    );
    const before = await run(controlGeometry, target, false);
    await press(" ", 32);
    const rect = await record(label, other, "keyboard", target);
    assert.deepEqual(rect, before.rect, "Selecting moved the tab");
    await press("Tab", 9, i > j ? 8 : 0);
    await record(label, other, "rest", target);
    const { hit } = await run(
      controlGeometry,
      `${tabs}:nth-child(${j + 1})`,
      false,
    );
    assert.ok(hit.center.hit);
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: hit.center.x,
      y: hit.center.y,
    });
    await record(label, other, "other hovered", target);
  }
}

export async function observeDisabledModels({
  run,
  wait,
  scrollTo,
  press,
  capture,
  width,
  theme,
  rows,
}) {
  const model = ".model-option",
    usable = `${model}:enabled`;
  await wait(
    `document.querySelectorAll('${model}:disabled').length === 2 && document.querySelector('${usable}')`,
  );
  for (const [id, reason] of [
    ["quartz", "Credentials unavailable"],
    ["slate", "Not supported"],
  ]) {
    const option = `${model}[title^="fixture/${id}"]:disabled`;
    for (const [part, text] of [
      ["name", id],
      ["note", reason],
    ]) {
      const selector = `${option} .model-option-${part}`;
      await scrollTo(selector);
      const observed = await capture(
        `disabled model ${id} ${part}`,
        async () => [await run(glyphSample, selector, text)],
      );
      assert.ok(
        observed?.samples && observed.worst.name.endsWith(`: ${text}`),
        `No visible disabled ${text}`,
      );
      rows.push({
        width,
        theme,
        id,
        reason,
        part,
        disabled: true,
        selector,
        ...observed,
      });
      assert.deepEqual(observed.failures, []);
    }
  }
  assert.ok(
    await run(() => document.activeElement.matches(".model-search input")),
  );
  await press("Tab", 9);
  assert.ok(await run((s) => document.activeElement.matches(s), usable));
  await press("Tab", 9);
  assert.ok(
    await run(
      (s) =>
        !document.activeElement.matches(s) &&
        document.querySelectorAll(`${s}:disabled`).length === 2,
      model,
    ),
  );
  await press("Tab", 9, 8);
  assert.ok(await run((s) => document.activeElement.matches(s), usable));
}
