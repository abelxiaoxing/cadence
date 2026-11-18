import assert from "node:assert/strict";
import { controlGeometry, glyphSample } from "./measure.mjs";
import { dockRun, fileText } from "./records.mjs";

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
    el.matches(":focus") !== (state === "keyboard") ||
    (other &&
      state !== "keyboard" &&
      document.activeElement.textContent !== other)
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
  const bounds = {
    left: r.left + el.clientLeft + parseFloat(stroke.left),
    right:
      r.right - parseFloat(css.borderRightWidth) - parseFloat(stroke.right),
    top: bottom - parseFloat(stroke.borderBottomWidth),
    bottom,
  };
  const y = Math.floor((bounds.top + bottom) / 2);
  const rail = el.parentElement,
    nav = rail.getBoundingClientRect(),
    wingX = Math.floor(nav.left + 3),
    wingY = Math.floor(nav.bottom + 2);
  if (
    !rail.nextElementSibling?.contains(document.elementFromPoint(wingX, wingY))
  )
    throw Error(`Missing wing below ${group}`);
  const points = [];
  for (const f of [0.25, 0.5, 0.75]) {
    const x = Math.floor(bounds.left + (bounds.right - bounds.left) * f);
    if (!el.contains(document.elementFromPoint(x, y)))
      throw Error(`Clipped current-page marker: ${label}`);
    for (const [material, bx, by] of [
      ["tab", x, y - 2],
      ["rail", x, Math.floor(r.bottom + 2)],
      ["wing", wingX, wingY],
    ])
      points.push({
        name: `${label} on ${material}`,
        surface: material,
        ink: [x, y],
        x: bx,
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
  return {
    bounds,
    tabs: tabs.map((e) => ({
      label: e.textContent,
      current: e.getAttribute("aria-current"),
      pressed: e.getAttribute("aria-pressed"),
      focused: e === document.activeElement,
    })),
    points,
  };
}

export async function observePanelTabs(
  {
    run,
    click,
    parkPointer,
    capture,
    press,
    send,
    width,
    theme,
    rows,
    problems,
  },
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
    let marker;
    const observed = await capture(`${label} ${state}`, async () => {
      const { bounds, tabs, points } = await run(
        tabPixels,
        nav,
        label,
        state,
        other,
      );
      marker = { bounds, tabs };
      const glyph = await run(glyphSample, target, label, null, ".rp-tab");
      return [...points, { ...glyph, surface: "label" }].map((p) => ({
        ...p,
        record: true,
      }));
    });
    assert.equal(observed?.samples, state === "keyboard" ? 11 : 10);
    rows.push({
      width,
      theme,
      context,
      group,
      label,
      other,
      state,
      clipped,
      marker,
      geometry,
      ...observed,
    });
    if (observed.failures.length)
      problems.push({
        width,
        theme,
        context,
        label,
        state,
        failures: observed.failures,
      });
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
    assert.deepEqual(await record(label, other, "rest", target), rect);
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
    assert.deepEqual(await record(label, other, "other hovered", target), rect);
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

// Sample inside the leading rule, not the keyboard outline outside the button.
// Require the three targets (mark, row backing, wing padding) in the same frame.
function rowPixels(kind, target, other, state) {
  const [rowSelector, container] = {
    session: [".conversation-row .session-item", ".lp-section-body"],
    file: [".file-item", ".file-list"],
    workflow: [".agent-dock-run > button", ".agent-dock-body"],
  }[kind];
  const button = document.querySelector(target),
    row = button.closest(rowSelector),
    host = row.closest(container);
  const mark = (el) => getComputedStyle(el, "::before");
  const marked = [...host.querySelectorAll(rowSelector)].filter(
    (el) =>
      mark(el).content !== "none" &&
      mark(el).borderInlineStartStyle === "solid",
  );
  if (
    marked.length !== 1 ||
    marked[0] !== row ||
    host.querySelectorAll('[aria-current="true"]').length !== 1 ||
    !button.matches('[aria-current="true"]') ||
    !row.matches(kind === "file" ? ".selected" : ".active")
  )
    throw Error(`Wrong selected ${kind}: ${target}`);
  const focus = state === "keyboard",
    outline = getComputedStyle(button);
  if (
    row.matches(":hover") ||
    button.matches(":focus-visible") !== focus ||
    (state === "rest" && row.matches(":focus-within")) ||
    (state === "other hovered" &&
      !document.querySelector(other).matches(":hover"))
  )
    throw Error(`Wrong ${target} interaction: ${state}`);
  if (
    focus &&
    (outline.outlineStyle !== "solid" || parseFloat(outline.outlineOffset) < 0)
  )
    throw Error(`No independent outer focus: ${target}`);
  const r = row.getBoundingClientRect(),
    stroke = mark(row),
    w = parseFloat(stroke.borderLeftWidth);
  const left = r.left + row.clientLeft + parseFloat(stroke.left);
  const x = Math.floor(left + w / 2),
    inside = Math.ceil(left + w),
    wing = Math.floor(r.left - 5);
  const top = r.top + row.clientTop + parseFloat(stroke.top),
    h = parseFloat(stroke.height);
  if (!(w >= 2 && h >= 6)) throw Error(`Empty rule: ${target}`);
  const points = [];
  for (const f of [0.1, 0.5, 0.9]) {
    const y = Math.floor(top + h * f);
    const at = (x) => document.elementFromPoint(x, y);
    if (!row.contains(at(x)) || !row.contains(at(inside)) || at(wing) !== host)
      throw Error(`Clipped ${target} marker/backing at ${x},${y}`);
    for (const [surface, sx] of [
      ["row", inside],
      ["wing", wing],
    ])
      points.push({
        name: `${kind} marker on ${surface}`,
        surface,
        ink: [x, y],
        expectedInk: stroke.borderLeftColor,
        x: sx,
        y,
        min: 3,
      });
  }
  if (focus) {
    const width = parseFloat(outline.outlineWidth),
      offset = parseFloat(outline.outlineOffset);
    const ringX = Math.floor(
      button.getBoundingClientRect().left - offset - width / 2,
    );
    if (width < 2 || !(wing < ringX && ringX < r.left && r.left < x))
      throw Error(`Focus and selection are not separate: ${target}`);
    points.push({
      name: `${kind} focus on wing`,
      surface: "focus",
      ink: [ringX, Math.floor(top + h / 2)],
      expectedInk: outline.outlineColor,
      x: wing,
      y: Math.floor(top + h / 2),
      min: 3,
    });
  }
  return points;
}

const projectHeader = ".chat-workspace:not([hidden]) > .conversation-header";
const projectShell = `.app:has(${projectHeader})`;
const sessionRow = (name) =>
  `.conversation-row .session-item[title="Optical · ${name}"]`;
const query = (selector) =>
  `document.querySelector(${JSON.stringify(selector)})`;

// Also useful on a failed readiness check, when a target may be missing or
// parked. Report the element actually at its center, not just a boolean hit.
function drawerSnapshot(selector, header) {
  const control = document.querySelector(selector);
  const r = control?.getBoundingClientRect();
  const hit =
    r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    route: location.pathname + location.search + location.hash,
    folderSetup: !!document.querySelector(".welcome-action"),
    heading: document.querySelector(`${header} h2`)?.textContent ?? null,
    sessions: [
      ...document.querySelectorAll(".conversation-row .session-item"),
    ].map((el) => el.title),
    wings: ["left", "right"].map((side) => {
      const el = document.querySelector(`.drawer-${side}`);
      const toggle = document.querySelector(
        side === "left" ? ".navigation-toggle" : ".inspector-toggle",
      );
      return {
        side,
        expanded: toggle?.getAttribute("aria-expanded"),
        inert: el?.inert,
        open: el?.matches(".open"),
      };
    }),
    selector,
    rect: r?.toJSON() ?? null,
    centerElement: hit && [
      hit.localName,
      hit.getAttribute("class"),
      hit.getAttribute("title"),
    ],
  };
}

export async function observeSelectedRows(probe) {
  const entry = {
    width: probe.width,
    theme: probe.theme,
    target: sessionRow("reading"),
  };
  probe.drawers.push(entry);
  try {
    await selectRows(probe, entry);
  } catch (error) {
    entry.failure = await probe.run(
      drawerSnapshot,
      entry.target,
      projectHeader,
    );
    throw error;
  }
}

const preview = ".file-preview";
const status = `${preview} [role="status"]`;
const code = `${preview} .code-line-body`;
const title = (path) =>
  `${query(`${preview} header span`)}?.textContent === ${JSON.stringify(path)}`;
const body = (path) =>
  `${query(code)}?.textContent === ${JSON.stringify(fileText[path])}`;
const settled = (path) =>
  `${title(path)} && !${query(status)} && ${body(path)}`;

async function pendingPreview(
  { wait, capture, run, observeButton },
  path,
  release,
) {
  let close, contrast;
  try {
    await wait(
      `${title(path)} && ${query(status)}?.textContent === 'Reading…' && !${query(code)}`,
    );
    contrast = await capture(`reading ${path}`, async () => [
      await run(glyphSample, status, "Reading…", 0.5, '[role="status"]'),
    ]);
    assert.equal(contrast.samples, 1);
    assert.deepEqual(contrast.failures, []);
    close = await observeButton(
      "pending preview close",
      `${preview} header button`,
      "Close preview",
    );
    assert.ok(
      close.keyboardFocus && Object.values(close.hit).every((p) => p.hit),
    );
  } finally {
    release();
  }
  await wait(settled(path));
  return {
    path,
    body: fileText[path],
    close: close.rect,
    keyboardClose: true,
    ...contrast,
  };
}

async function selectRows(
  {
    width,
    theme,
    go,
    chat,
    site,
    clickPoint,
    wait,
    ev,
    run,
    parkPointer,
    press,
    send,
    capture,
    rows,
    workflowRows,
    filePreviewReads,
    observeButton,
  },
  entry,
) {
  const release = site.holdWorkbenchEntry();
  try {
    await go(chat("empty"), ".welcome-action:disabled");
    entry.pending = await run(drawerSnapshot, entry.target, projectHeader);
    assert.ok(entry.pending.folderSetup && !entry.pending.heading);
  } finally {
    release();
  }
  await wait(
    `location.pathname + location.search + location.hash === ${JSON.stringify(chat("empty"))} && ${query(`${projectHeader} h2`)}?.textContent === 'New conversation' && ${query(`${projectShell} .chat-welcome`)} && ${query(sessionRow("reading"))} && ${query(sessionRow("design"))}`,
  );
  entry.ready = await run(drawerSnapshot, entry.target, projectHeader);
  const expanded = (toggle) =>
    ev(`${query(toggle)}.getAttribute('aria-expanded') === 'true'`);
  const geometryOf = async (target) => {
    entry.target = target;
    await wait(query(target));
    const geometry = await run(controlGeometry, target, false);
    const { rect, visible, hit } = geometry;
    assert.ok(
      rect.width > 0 &&
        rect.height > 0 &&
        visible.width >= rect.width - 0.01 &&
        visible.height >= rect.height - 0.01 &&
        hit.center.hit,
      `Clipped ${target}: ${JSON.stringify(geometry)}`,
    );
    return geometry;
  };
  const activate = async (target) => {
    const geometry = await geometryOf(target);
    await clickPoint(target, geometry.hit.center);
    return geometry;
  };
  const dock = `.agent-dock-run[aria-label="${dockRun.goal}"]`;
  for (const kind of ["session", "file", "workflow"]) {
    const file = kind === "file",
      workflow = kind === "workflow";
    if (workflow) await go(chat("dock"), `${dock} > .agent-dock-row`);
    const toggle = `${projectShell} > .topbar > .${file ? "inspector" : "navigation"}-toggle`,
      wing = `${projectShell} .drawer-${file ? "right" : "left"}`,
      opened = `${wing}:not([inert])${width <= 900 ? ".open" : ""}`;
    const open = async () => {
      if (!(await expanded(toggle))) await activate(toggle);
      await wait(
        `${query(`${toggle}[aria-expanded="true"]`)} && ${query(opened)}`,
      );
    };
    const wasOpen = await expanded(toggle);
    await open();
    const targets = workflow
      ? [
          [dockRun.goal, `${dock} > .agent-dock-run-head`],
          [dockRun.steps[0].id, `${dock} > .agent-dock-row`],
        ]
      : file
        ? Object.keys(fileText).map((path) => [
            path,
            `.file-main[title="${path}"]`,
          ])
        : ["reading", "design"].map((name) => [name, sessionRow(name)]);
    if (workflow)
      assert.ok(await ev(`!${query(`${dock} > :is(.active,[aria-current])`)}`));
    for (const [i, [name, selector]] of targets.entries()) {
      const target = `${wing} ${selector}`,
        other = `${wing} ${targets[1 - i][1]}`;
      const held = file ? site.holdFile(name) : null;
      const before = await activate(target);
      if (file) {
        const reading = await pendingPreview(
          { wait, capture, run, observeButton },
          name,
          await held(),
        );
        filePreviewReads.push({ width, theme, ...reading });
      } else {
        if (workflow) {
          const view = ".workflow-agent";
          const id = i ? dockRun.steps[0].id : dockRun.id;
          const heading = i ? `research · ${name}` : name;
          const content = i
            ? ".workflow-agent-result .md p"
            : ".workflow-card header strong";
          await wait(
            `${query(`${view} h2[title="${id}"]`)}?.innerText === ${JSON.stringify(heading)} && ${query(`${view} ${content}`)}?.innerText === ${JSON.stringify(i ? dockRun.steps[0].text : name)}`,
          );
        } else
          await wait(
            `document.querySelector('.conversation-heading h2')?.textContent==='Optical · ${name}'`,
          );
        if (width <= 900)
          await wait(
            `${query(`${toggle}[aria-expanded="false"]`)} && ${query(`${wing}[inert]:not(.open)`)}`,
          );
        await open(); // Selecting a conversation, run or child dismisses the compact drawer.
      }
      await parkPointer();
      const record = async (state) => {
        const geometry = await geometryOf(target);
        assert.equal(
          geometry.rect.width,
          before.rect.width,
          "Selection changed row width",
        );
        if (workflow) assert.equal(geometry.rect.height, before.rect.height);
        const observed = await capture(`${target} ${state}`, () =>
          run(rowPixels, kind, target, other, state),
        );
        assert.equal(observed?.samples, state === "keyboard" ? 7 : 6);
        assert.deepEqual(observed.failures, []);
        (workflow ? workflowRows : rows).push({
          width,
          theme,
          kind,
          name,
          state,
          geometry,
          ...observed,
        });
      };
      // A pointer selection may leave focus on the row.
      await run(() => document.activeElement.blur());
      await record("rest");
      const { hit } = await geometryOf(other);
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: hit.center.x,
        y: hit.center.y,
      });
      await record("other hovered");
      await parkPointer();
      await run((s) => document.querySelector(s).focus(), target);
      await press("Tab", 9);
      await press("Tab", 9, 8);
      await record("keyboard");
      if (file) {
        // All four file actions must still be reached in order and hit-test
        // inside the selected row. Do not activate download/reference/copy.
        for (const action of [
          ".download",
          ".ref",
          `[aria-label="Copy name ${name}"]`,
          `[aria-label="Copy path ${name}"]`,
        ]) {
          await press("Tab", 9);
          const s = `.file-item.selected .file-attach${action}`;
          assert.ok(
            await ev(
              `document.activeElement.matches('${s}:enabled:focus-visible')`,
            ),
          );
          const geometry = await geometryOf(s);
          assert.ok(Object.values(geometry.hit).every((p) => p.hit));
        }
      }
    }
    if (file) {
      // The retained body is explicitly refreshing. Leave it pending, then
      // release the obsolete response after the new file has already settled.
      const path = targets[1][0],
        next = targets[0][0];
      const held = site.holdFile(path);
      await activate(`${wing} [aria-label="Refresh files"]`);
      const release = await held();
      try {
        await wait(
          `${title(path)} && ${query(status)}?.textContent === 'Reading…' && ${body(path)}`,
        );
        await activate(`${wing} ${targets[0][1]}`);
        await wait(settled(next));
      } finally {
        release();
      }
      await run(controlGeometry, `${preview} header button`, false);
      assert.ok(await ev(settled(next)));
      filePreviewReads.at(-1).retiredRefresh = { path, current: next };
    }
    if (!wasOpen && (await expanded(toggle))) {
      if (width <= 900) await press("Escape", 27);
      else await activate(toggle);
      await wait(query(`${toggle}[aria-expanded="false"]`));
    }
  }
}
