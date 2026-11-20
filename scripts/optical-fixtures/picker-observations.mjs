import assert from "node:assert/strict";
import { contrastPixels, controlGeometry, glyphSample } from "./measure.mjs";
import { cwd, lockedReply, recentFolder } from "./records.mjs";

// One unmodified viewport PNG per state. Never discard an inconvenient frame:
// a change across the capture or missing paint is a failure, not a retry.
export async function painted(probe, row, state, locate) {
  const { run, screenshot, width, theme } = probe;
  const before = await locate();
  const file = `${row.scene}-${theme}-${width}-${state}.png`;
  const frame = { state, file, ...before };
  row.frames.push(frame);
  const png = await screenshot(file);
  assert.deepEqual(
    await locate(),
    before,
    `Layout/state changed across ${file}`,
  );
  assert.ok(before.points.length, `Missing targets in ${file}`);
  const sample = await run(contrastPixels, png, before.points, {});
  frame.sample = sample;
  assert.deepEqual(sample.frame.bitmap, sample.frame.viewport);
  assert.equal(sample.frame.dpr, 1);
  assert.equal(sample.readings.length, before.points.length);
  const ratios = sample.readings.map((p) =>
    p.glyph ? p.paintedGlyph?.ratio : p.ratio,
  );
  assert.ok(ratios.every(Number.isFinite), `Missing painted glyph in ${file}`);
  frame.worstPaintedRatio = Math.min(...ratios);
  assert.deepEqual(sample.failures, []);
  for (const [i, p] of sample.readings.entries())
    assert.ok(ratios[i] >= p.min, `${file}: ${p.name} ${ratios[i]} < ${p.min}`);
}

// In the selected project we deliberately browse the other recent path first.
// Neither the breadcrumb nor the folder about to open is the current project.
function recentPixels(paths, project, focused) {
  const group = "dialog[open] .cwd-recent-list > button";
  const rows = [...document.querySelectorAll(group)];
  const dialog = rows[0]?.closest("dialog");
  const browsing = dialog?.querySelector(".cwd-target code")?.textContent;
  if (
    rows.length !== paths.length ||
    browsing !== (project ? paths[1] : paths[0])
  )
    throw Error(
      `Missing recent folder pair or wrong browsing target: ${browsing}`,
    );
  const points = [];
  const folders = rows.map((el, index) => {
    const path = paths[index],
      selected = project && index === 0;
    const marker = getComputedStyle(el, "::before");
    const visibleMark =
      marker.content !== "none" && marker.borderInlineStartStyle === "solid";
    const current = el.getAttribute("aria-current");
    const hasFocus = el === document.activeElement;
    if (
      el.textContent !== path ||
      el.disabled ||
      current !== (selected ? "true" : null) ||
      visibleMark !== selected ||
      el.matches(":hover") ||
      hasFocus !== (focused === index)
    )
      throw Error(
        `Wrong recent folder state: ${path}, current=${current}, focus=${hasFocus}, mark=${visibleMark}`,
      );
    const rect = el.getBoundingClientRect();
    const icon = el.querySelector("svg")?.getBoundingClientRect();
    const at = (x, y) => document.elementFromPoint(x, y);
    const point = (name, x, y, ink, color) => ({
      name,
      x,
      y,
      ink,
      expectedInk: color,
      min: 3,
      record: true,
    });
    if (selected) {
      const left = rect.left + el.clientLeft + parseFloat(marker.left),
        right = left + parseFloat(marker.borderLeftWidth),
        top = rect.top + el.clientTop + parseFloat(marker.top),
        bottom = top + parseFloat(marker.height),
        x = Math.floor((left + right) / 2),
        face = Math.ceil(right),
        card = Math.floor(rect.left - 3),
        section = el.closest(".cwd-recent"),
        panel = Math.floor(section.getBoundingClientRect().left - 3);
      if (!(right - left >= 3 && bottom - top >= 6 && icon?.left > right))
        throw Error(`Empty or overlapping folder mark: ${path}`);
      for (const y of [
        Math.ceil(top),
        Math.floor((top + bottom) / 2),
        Math.floor(bottom) - 1,
      ]) {
        // Cover the edges as well as the center: clipping one column of the
        // 3px mark must not pass on the strength of its middle column.
        for (const [name, sx, surface, inkX] of [
          ["row", face, el, Math.floor(right) - 1],
          ["card", card, section, x],
          ["dialog", panel, dialog, Math.ceil(left)],
        ]) {
          if (at(inkX, y) !== el || at(sx, y) !== surface)
            throw Error(`Clipped ${name} or folder mark at ${inkX},${y}`);
          points.push(
            point(
              `${path} mark on ${name}`,
              sx,
              y,
              [inkX, y],
              marker.borderLeftColor,
            ),
          );
        }
      }
    }
    if (hasFocus) {
      const css = getComputedStyle(el),
        w = parseFloat(css.outlineWidth),
        offset = parseFloat(css.outlineOffset);
      const x = Math.floor(rect.left + rect.width / 2),
        y = Math.floor(rect.top - offset - w / 2),
        backing = Math.ceil(rect.top - offset + 2);
      if (
        !el.matches(":focus-visible") ||
        css.outlineStyle !== "solid" ||
        w < 2 ||
        at(x, y) !== el ||
        at(x, backing) !== el
      )
        throw Error(`Missing recent folder focus: ${path}`);
      points.push(
        point(`${path} keyboard outline`, x, backing, [x, y], css.outlineColor),
      );
    }
    const glyph = opticalProbe.glyphSample(
      `${group}:nth-child(${index + 1}) span`,
      path,
    );
    points.push({ ...glyph, record: true });
    return {
      path,
      current,
      marked: visibleMark,
      disabled: el.disabled,
      hasFocus,
      rect: rect.toJSON(),
      icon: icon.toJSON(),
    };
  });
  return { browsing, folders, points };
}

export async function observeRecentFolders(probe, row, project) {
  const { run, click, wait, parkPointer, press } = probe;
  if (project) {
    await click(`.statusbar .status-cwd[title="${cwd}"]`);
    await wait(
      `document.querySelector('.cwd-target code')?.textContent === ${JSON.stringify(cwd)}`,
    );
    await click(".cwd-picker-list button", "facets");
    await wait(
      `document.querySelector('.cwd-target code')?.textContent === ${JSON.stringify(recentFolder)}`,
    );
  }
  await parkPointer();
  // Start before the rows, not on either target. Do not open a recent folder.
  await run(() => document.querySelector("dialog[open] .dialog-close").focus());
  const capture = (state, focused) =>
    painted(probe, row, state, () =>
      run(recentPixels, [cwd, recentFolder], project, focused),
    );
  for (const i of [0, 1]) {
    await press("Tab", 9);
    await capture(`tab-${i}`, i);
  }
  await press("Tab", 9);
  assert.ok(
    await run(() =>
      document.activeElement.matches(".cwd-crumbs button:focus-visible"),
    ),
  );
  await capture("rest", -1);
}

// Both buttons first observe the typed path. Refuse that read after sampling:
// neither selecting a project nor opening an owner is part of this fixture.
export async function observeFolderAction(probe, row, site, owner) {
  const { go, click, wait, run, send, parkPointer } = probe;
  if (owner) {
    site.nextEntryIsOwner();
    const trigger = `.statusbar .status-cwd[title="${cwd}"]`;
    await go(
      "/app#chat=empty",
      ".chat-workspace[data-entry='new'] .model-trigger.empty",
    );
    await click(trigger);
  }
  const button = "dialog[open] .cwd-footer button";
  const ready = owner ? "Open this folder" : "Use this folder";
  const busy = owner ? "Opening folder…" : "Selecting folder…";
  const path = `${recentFolder}/quartz`;
  await wait(
    `document.querySelector('${button}:enabled')?.textContent === '${ready}'`,
  );
  const from = await run(
    () => document.querySelector(".cwd-target code").textContent,
  );
  assert.notEqual(from, path);
  await click('dialog[open] [aria-label="Edit path"]');
  await send("Input.insertText", { text: path });
  await wait(
    `document.querySelector('.cwd-input input')?.value === ${JSON.stringify(path)} && document.querySelector('.cwd-target code')?.textContent === ${JSON.stringify(path)}`,
  );
  const route = owner ? "/api/v1/workbench/read" : "/workbench/v1/directories";
  const release = site.holdDirectory(path, route);
  await click(`${button}:enabled`, ready);
  try {
    await wait(
      `document.querySelector('${button}:disabled[aria-busy="true"]')?.textContent === '${busy}'`,
    );
    await parkPointer();
    await painted(probe, row, "busy", async () => {
      const geometry = await run(controlGeometry, button, false);
      assert.equal(geometry.name, busy);
      assert.equal(geometry.disabled, true);
      assert.deepEqual(geometry.rect, geometry.visible);
      assert.ok(Object.values(geometry.hit).every(({ hit }) => hit));
      return {
        from,
        path,
        route,
        ...geometry,
        points: [{ ...(await run(glyphSample, button, busy)), record: true }],
      };
    });
  } finally {
    release({ fail: true });
  }
  const error = "This folder does not exist. Check the path.";
  await wait(
    `document.querySelector('dialog[open] [role="alert"]')?.textContent === '${error}' && document.querySelector('${button}:enabled:not([aria-busy])')?.textContent === '${ready}'`,
  );
  row.afterReadFailure = { error, label: ready, disabled: false };
}

function thinkingPixels() {
  const popover = document.querySelector(".model-popover");
  const note = "Switch models after the current reply finishes.";
  const labels = ["Low", "Medium", "High"];
  const options = [...popover.querySelectorAll(".model-thinking button")];
  const trigger = document.querySelector(".model-trigger");
  const model = trigger.querySelector(".model-trigger-text").textContent;
  const level = trigger.querySelector(".model-trigger-level").textContent;
  if (
    options.length !== labels.length ||
    trigger.title !== note ||
    model !== "optical" ||
    level !== "Thinking · Medium" ||
    !document.querySelector('[aria-label="Stop response"]:enabled') ||
    !popover.querySelector('.model-option[aria-selected="true"]:disabled') ||
    popover.querySelector(".model-option:enabled")
  )
    throw Error("Wrong installed model or missing live reply lock");
  const points = [
    {
      ...opticalProbe.glyphSample(
        ".model-popover-notes p:first-child",
        note,
        null,
        ".model-popover-notes",
      ),
      record: true,
    },
  ];
  const levels = options.map((el, i) => {
    const label = labels[i],
      pressed = el.getAttribute("aria-pressed"),
      selected = label === "Medium";
    if (
      !el.disabled ||
      pressed !== String(selected) ||
      el.textContent !== label ||
      el.matches(":focus,:hover")
    )
      throw Error(
        `Wrong locked level: ${label}, pressed=${pressed}, disabled=${el.disabled}`,
      );
    const selector = `.model-thinking button[aria-label="Thinking level: ${label}"]`;
    points.push({ ...opticalProbe.glyphSample(selector, label), record: true });
    const rect = el.getBoundingClientRect(),
      clip = popover.getBoundingClientRect();
    if (
      rect.left < Math.max(0, clip.left) ||
      rect.right > Math.min(innerWidth, clip.right) ||
      rect.top < Math.max(0, clip.top) ||
      rect.bottom > Math.min(innerHeight, clip.bottom)
    )
      throw Error(`Clipped thinking level: ${label}`);
    if (selected) {
      const css = getComputedStyle(el),
        w = parseFloat(css.borderTopWidth);
      const x = Math.floor(rect.left + rect.width / 2),
        y = Math.floor(rect.top + w / 2),
        inside = Math.ceil(rect.top + w + 1),
        outside = Math.floor(rect.top - 2);
      const at = (y) => document.elementFromPoint(x, y);
      if (
        css.borderTopStyle !== "solid" ||
        w < 1 ||
        at(y) !== el ||
        at(inside) !== el ||
        at(outside) !== el.parentElement
      )
        throw Error("Clipped selected thinking border/backing");
      for (const [side, by] of [
        ["button", inside],
        ["menu", outside],
      ])
        points.push({
          name: `${label} border on ${side}`,
          ink: [x, y],
          expectedInk: css.borderTopColor,
          x,
          y: by,
          min: 3,
          record: true,
        });
    }
    return { label, pressed, disabled: el.disabled, rect: rect.toJSON() };
  });
  return { model, level, lockNotice: note, levels, points };
}

export async function observeLockedLevels(probe, row) {
  const { go, chat, click, parkPointer, wait, run, press } = probe;
  const trigger =
    '.chat-composer:has([aria-label="Stop response"]:enabled) .model-trigger[title="Switch models after the current reply finishes."]';
  // Opening observes a fresh catalog. The pre-open label may still be a preview
  // while the project attaches; it is not evidence of an installed choice.
  await go(chat(lockedReply), trigger);
  await click(trigger);
  await wait(
    `document.querySelector('.model-thinking button[aria-pressed="true"]:disabled')`,
  );
  await parkPointer();
  await painted(probe, row, "rest", () => run(thinkingPixels));
  const search = ".model-search input",
    stop = '[aria-label="Stop response"]';
  const active = (s) => run((s) => document.activeElement.matches(s), s);
  assert.ok(await active(search));
  await press("Tab", 9);
  assert.ok(
    await active(`${stop}:focus-visible`),
    "Tab did not skip the locked levels",
  );
  await press("Tab", 9, 8);
  assert.ok(await active(`${search}:focus-visible`));
  row.focusOrder = [search, stop, search];
}
