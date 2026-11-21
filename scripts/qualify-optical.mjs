// Optional local observation; not a verify/package/release stage.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { readableWorkflowPlan } from "../src/service/contracts/workflow.ts";
import { browser } from "./optical-fixtures/browser.mjs";
import {
  bindReadingCode,
  copyButton,
  foldButton,
  block as readingBlock,
  toggleReadingCode,
} from "./optical-fixtures/code-block.mjs";
import {
  observeComposerFlow,
  observeComposerGrip,
  observeUnknownMode,
} from "./optical-fixtures/composer-observations.mjs";
import {
  observeCardMaterial,
  observeChatMaterials,
  observeDesign,
  observeOpenMaterial,
  observeRetainedCopy,
} from "./optical-fixtures/detail-observations.mjs";
import { observeGestures } from "./optical-fixtures/drawer-gestures.mjs";
import { opticalGroups } from "./optical-fixtures/groups.mjs";
import {
  bindToolWheel,
  contrastPixels,
  controlGeometry,
  dimensions,
  frameWindow,
  glyphSample,
  latestInkTarget,
  questionMarkSample,
  readingPosition,
  revealedCopySample,
  stableFrames,
  textSamples,
} from "./optical-fixtures/measure.mjs";
import {
  observeDisabledModels,
  observePanelTabs,
  observeSelectedRows,
} from "./optical-fixtures/panel-observations.mjs";
import {
  observeFolderAction,
  observeLockedLevels,
  observeRecentFolders,
  painted,
} from "./optical-fixtures/picker-observations.mjs";
import {
  leading,
  observeFieldFind,
  observeLiveFocus,
} from "./optical-fixtures/reader-observations.mjs";
import {
  cwd,
  feed,
  fieldTask,
  firstAttempt,
  fullArtifact,
  pendingInputs,
  project,
  readRecord,
  shellCommand,
  task,
  undeliveredInput,
  writeContent,
} from "./optical-fixtures/records.mjs";
import {
  observeArtifactFind,
  observeFieldBoundaries,
  observeSearch,
} from "./optical-fixtures/search-observations.mjs";
import { fixture } from "./optical-fixtures/site.mjs";
import { openTool } from "./optical-fixtures/tool-card.mjs";
import {
  observeLiveAgent,
  observeValidation,
} from "./optical-fixtures/workflow-observations.mjs";
import { observeQuietWorkspace } from "./quiet-workspace-observation.mjs";
import { observeTranscriptPolish } from "./transcript-polish-observation.mjs";
import { assertVerificationTemp } from "./verification-temp.mjs";

const args = process.argv.slice(2);
const conversationObservers = {
  "quiet-workspace": observeQuietWorkspace,
  "transcript-polish": observeTranscriptPolish,
};
const coreGroups = opticalGroups([]);
const views = coreGroups.filter((name) => /^(dark|light):\d+$/.test(name));
const conversationGroups = Object.keys(conversationObservers).flatMap(
  (family) => views.map((view) => `${family}:${view}`),
);
function selectedGroups(args) {
  if (!args.length) return [...coreGroups, ...conversationGroups];
  if (args.length === 1 && args[0].startsWith("--group=")) {
    const name = args[0].slice("--group=".length);
    if (Object.hasOwn(conversationObservers, name))
      return views.map((view) => `${name}:${view}`);
    if (conversationGroups.includes(name)) return [name];
  }
  return opticalGroups(args);
}
const groups = selectedGroups(args);
const root = resolve(import.meta.dirname, "..");
assertVerificationTemp(root);
const reportDir = await mkdtemp(join(process.env.TMPDIR, "optical-evidence-"));
const rows = [],
  problems = [],
  performanceRows = [];
const report = {
  coverage: args.length ? "targeted" : "full",
  groups,
  candidate: null,
  unexpectedRequests: { readonly: [], currentContext: [] },
  hitTests: [],
  controls: [],
  attempts: [],
  palettes: [],
  copies: [],
  copyIndicators: [],
  readingStates: [],
  cardMaterials: [],
  wingMaterials: [],
  surfaceContrast: [],
  toolCards: [],
  inputWindows: [],
  toolWheels: [],
  latestPaint: [],
  codeDisclosures: [],
  drawerGestures: [],
  directoryReads: [],
  pickerStates: [],
  leading: [],
  fieldFind: [],
  searchNavigation: [],
  panelTabs: [],
  selectedRows: [],
  workflowRows: [],
  agentScroll: [],
  quietWorkspace: [],
  entryShelves: [],
  transcriptPolish: [],
  filePreviewReads: [],
  rowDrawers: [],
  unknownMode: [],
  composerFlow: [],
  composerGrip: [],
  disabledModels: [],
  artifactFind: [],
  controlFocus: [],
  branch: execFileSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  head: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  rows,
  performance: performanceRows,
  problems,
};
console.log(`Optical ${report.coverage} observation: ${reportDir}`);
async function observeGroup({ b, site, currentSite, problems }, group, work) {
  const start = Date.now();
  const count = () =>
    problems.length + site.failures.length + currentSite.failures.length;
  const before = count();
  const record = async (status) => {
    const entry = {
      group,
      status,
      elapsedMs: Date.now() - start,
      head: report.head,
      build: report.candidate.buildId,
      coverage: report.coverage,
    };
    await appendFile(
      join(reportDir, "progress.ndjson"),
      `${JSON.stringify(entry)}\n`,
    );
    console.log(`${group}: ${status} (${entry.elapsedMs}ms)`);
  };
  await record("started");
  let restoreWindow;
  try {
    if (
      group.startsWith("transcript-polish:") ||
      (views.includes(group) && group.endsWith(":1440"))
    ) {
      // Device emulation alone can deliver a trusted wheel to a DOM target
      // outside the native input surface without scrolling the compositor.
      const { windowId, bounds } = await b.send("Browser.getWindowForTarget");
      const resize = (width, height) =>
        b.send("Browser.setWindowBounds", {
          windowId,
          bounds: { width, height },
        });
      restoreWindow = () => resize(bounds.width, bounds.height);
      await resize(
        Math.max(bounds.width, Number(group.split(":").at(-1)) + 32),
        Math.max(bounds.height, 1024),
      );
      const sized = await b.send("Browser.getWindowBounds", { windowId });
      report.inputWindows.push({
        group,
        windowId,
        before: bounds,
        after: sized.bounds,
      });
    }
    await work();
  } catch (error) {
    await record("failed");
    throw error;
  } finally {
    await restoreWindow?.();
  }
  await record(count() === before ? "completed" : "failed");
}
const q = JSON.stringify;
async function measureGroups(groups, lane, origin, currentOrigin) {
  const { b, site, currentSite, problems } = lane;
  const observe = (group, work) => observeGroup(lane, group, work);
  report.browser ??= b.version.product;
  assert.equal(report.browser, b.version.product);
  const { evaluate: ev, send } = b;
  const run = (fn, ...args) => ev(`(${fn})(${args.map(q).join(",")})`);
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.opticalProbe={stableFrames:${stableFrames},glyphSample:${glyphSample}};`,
  });
  const wait = async (expr) => {
    for (let i = 0; i < 70; i++) {
      try {
        if (await ev(`Boolean(${expr})`)) return;
      } catch {}
      await sleep(75);
    }
    throw Error(`Not observed: ${expr}`);
  };
  const go = async (path, selector, base = origin) => {
    await send("Page.navigate", { url: "about:blank" });
    await wait(
      `location.href === 'about:blank' && document.readyState === 'complete'`,
    );
    await send("Page.navigate", { url: base + path });
    await wait(`document.querySelector(${q(selector)})`);
  };
  const currentGo = (path, selector) => go(path, selector, currentOrigin);
  const inCurrentSession =
    (observe) =>
    (probe, ...args) =>
      observe({ ...probe, go: currentGo }, ...args);
  const chat = (id) => `/app?project=${project}#chat=${id}`;
  const viewport = (width, height = width > 900 ? 900 : 820) =>
    send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  const layout = async (
    width,
    theme,
    motion = "no-preference",
    forced = "none",
  ) => {
    await viewport(width);
    await send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: theme },
        { name: "prefers-reduced-motion", value: motion },
        { name: "forced-colors", value: forced },
      ],
    });
  };
  const scrollTo = async (s) => {
    await wait(`document.querySelector(${q(s)})`);
    await ev(
      `document.querySelector(${q(s)}).scrollIntoView({block:'center',inline:'nearest'})`,
    );
    await sleep(80);
  };
  const clickPoint = async (selector, { x, y }) => {
    report.hitTests.push({
      width,
      theme,
      selector,
      x: Math.round(x),
      y: Math.round(y),
    });
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        clickCount: 1,
      });
  };
  const click = async (s, exact) => {
    const point = await run(
      (s, text) => {
        const el = [...document.querySelectorAll(s)].find(
          (e) => !text || e.textContent.trim() === text,
        );
        if (!el) throw Error("Missing " + s);
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        const rect = el.getBoundingClientRect(),
          x = rect.left + rect.width / 2,
          y = rect.top + rect.height / 2;
        if (!el.contains(document.elementFromPoint(x, y)))
          throw Error(`Unreachable ${s} at ${x},${y}`);
        return { x, y };
      },
      s,
      exact ?? "",
    );
    await clickPoint(s, point);
    await sleep(80);
  };
  const press = async (key, code, modifiers = 0) => {
    for (const type of ["keyDown", "keyUp"])
      await send("Input.dispatchKeyEvent", {
        type,
        key,
        code: key === " " ? "Space" : key,
        windowsVirtualKeyCode: code,
        modifiers,
      });
  };
  const observeButton = async (role, selector, expected, scroll = true) => {
    await wait(`document.querySelector(${q(selector)})`);
    const geometry = await run(controlGeometry, selector, scroll);
    const row = {
      width,
      theme,
      role,
      selector,
      ...geometry,
      keyboardFocus: null,
    };
    report.controls.push(row);
    if (expected) assert.equal(row.name, expected);
    const { rect, visible } = row;
    if (
      !(rect.width && rect.height) ||
      visible.width < rect.width - 0.01 ||
      visible.height < rect.height - 0.01
    )
      problems.push({ width, theme, role, clipped: true });
    if (row.disabled) return row;
    if (Object.values(row.hit).some((p) => !p.hit))
      problems.push({ width, theme, role, obstructed: true });
    // Start just before the button, never focus the target programmatically.
    // Tab must actually land on the enabled control. Do not activate an action.
    await run((s) => {
      const target = document.querySelector(s);
      const prev = [
        ...document.querySelectorAll(
          "button,input,textarea,select,a[href],summary,[tabindex]",
        ),
      ].findLast(
        (e) =>
          e.compareDocumentPosition(target) &
            Node.DOCUMENT_POSITION_FOLLOWING &&
          !e.matches(":disabled") &&
          !e.closest("[inert]") &&
          e.tabIndex >= 0 &&
          e.checkVisibility(),
      );
      prev?.focus({ preventScroll: true });
    }, selector);
    for (let i = 0; i < 12; i++) {
      await press("Tab", 9);
      if (
        await ev(
          `document.activeElement.matches(${q(selector)}) && document.activeElement.matches(':focus-visible')`,
        )
      ) {
        row.keyboardFocus = true;
        break;
      }
    }
    if (!row.keyboardFocus) {
      row.keyboardFocus = false;
      problems.push({ width, theme, role, keyboardFocus: false });
    }
    return row;
  };
  // A fresh, write-only receiver in the fixture document. No clipboard read,
  // browser permission or platform clipboard participates in the assertion.
  const observeCopy = async (source, selector, label, expected, facts = {}) => {
    await ev(
      `if (!opticalProbe.received) Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{opticalProbe.received.push(text)}}}); opticalProbe.received=[]`,
    );
    const copy = await observeButton(`${source} copy`, selector, label);
    assert.equal(copy.keyboardFocus, true);
    await press(" ", 32);
    await wait("opticalProbe.received.length > 0");
    assert.deepEqual(await ev("opticalProbe.received"), [expected]);
    report.copies.push({
      width,
      theme,
      source,
      characters: expected.length,
      exact: true,
      ...facts,
    });
  };
  let width, theme;
  const observeLeading = async (surface, selector, expectedText) => {
    const sample = await leading({ run, scrollTo }, selector);
    if (expectedText !== undefined) assert.equal(sample.text, expectedText);
    report.leading.push({
      width,
      theme,
      surface,
      ...sample,
    });
  };
  const expand = async (id, tool, path, position) => {
    const row = { width, theme, id, tool, path, position };
    report.toolCards.push(row);
    await openTool({ ev, run, send, wait, site, row, route: chat(id) });
    return row;
  };
  const copyIndicators = async (selector) => {
    // Measure the quiet rest state, then the actual revealed stroke and Tab ring.
    await ev("document.activeElement.blur()");
    const { hit } = await run(controlGeometry, selector);
    const opacity = `Number(getComputedStyle(document.querySelector(${q(selector)})).opacity)`;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    const mouse = await ev(
      `matchMedia('(hover: hover) and (pointer: fine)').matches`,
    );
    await wait(mouse ? `${opacity} < 0.6` : `${opacity} === 1`);
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: hit.center.x,
      y: hit.center.y,
    });
    await wait(`${opacity} === 1`);
    const point = await run(revealedCopySample, selector);
    const capture = async (point) => {
      assert.ok(point, `Missing ${selector} indicator sample`);
      const png = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      const observed = await run(contrastPixels, png.data, [point]);
      report.copyIndicators.push({ width, theme, selector, ...observed.worst });
      assert.deepEqual(observed.failures, []);
    };
    await capture(point);
    assert.deepEqual(await run(revealedCopySample, selector), point);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    const control = await observeButton("copy indicator focus", selector);
    assert.equal(control.keyboardFocus, true);
    const focusPoint = (await run(textSamples)).find(
      (p) => p.name === "BUTTON focus",
    );
    await capture(focusPoint);
    assert.ok(await ev(`document.activeElement.matches(${q(selector)})`));
  };
  const capture = async (scene, locate, takeFrame) => {
    // Sample indicators on the unmodified page. On a separate capture,
    // temporarily remove glyph ink only to read the material under text.
    for (let attempt = 0; attempt < 4; attempt++) {
      await ev(
        "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
      );
      const points = await locate();
      if (!points.length) return null;
      const png = takeFrame
        ? await takeFrame(points)
        : (
            await send("Page.captureScreenshot", {
              format: "png",
              captureBeyondViewport: false,
            })
          ).data;
      const after = await locate();
      if (takeFrame)
        assert.deepEqual(
          after,
          points,
          `Page samples moved across ${scene} frame`,
        );
      if (JSON.stringify(points) !== JSON.stringify(after)) {
        if (scene === "design") {
          const file = `design-${theme}-${width}-unstable.png`;
          await writeFile(join(reportDir, file), Buffer.from(png, "base64"), {
            flag: "wx",
          });
          assert.deepEqual(
            after,
            points,
            `Design samples changed across ${file}`,
          );
        }
        continue;
      }
      return run(contrastPixels, png, points);
    }
    throw Error(`Unstable screenshot geometry: ${scene}`);
  };
  const textContrast = async (scene, selector, takeFrame) => {
    await ev(`document.body.style.webkitTextFillColor='transparent'`);
    try {
      return await capture(
        scene,
        async () =>
          (await run(textSamples, selector ?? null)).filter((p) => !p.ink),
        takeFrame,
      );
    } finally {
      await ev(`document.body.style.removeProperty('-webkit-text-fill-color')`);
    }
  };
  // Keep the full page audit, but bind its Latest label to one DOM button
  // and one pair of viewport PNGs. Never retry a frame for better paint.
  const toolOutputContrast = async () => {
    const selector = ".chat-messages-wrap > .scroll-bottom";
    await run((s) => {
      opticalProbe.latest = document.querySelector(s);
    }, selector);
    const locate = () => run(latestInkTarget, selector);
    const row = { width, theme, scene: "tool output", frames: [] };
    report.latestPaint.push(row);
    const frame = async (state) => {
      const entry = {
        state,
        file: `tool-output-${theme}-${width}-${state}.png`,
        before: await locate(),
      };
      row.frames.push(entry);
      const png = await screenshot(entry.file);
      entry.after = await locate();
      assert.deepEqual(entry.after, entry.before, `Moved across ${entry.file}`);
      assert.deepEqual(entry.before, row.frames[0].before);
      assert.ok(entry.before.hits.every((p) => p.button));
      return png;
    };
    const inkPng = await frame("original");
    const { point, rect } = row.frames[0].before;
    const marks = { backing: [point.x, point.y] };
    // The dark face must actually be present against the light reading shelf,
    // not just a reachable DOM button or white ink on unrelated dark content.
    const face = {
      name: "Latest face on shelf",
      ink: marks.backing,
      x: Math.ceil(rect.right) + 24,
      y: point.y,
      min: 3,
      record: true,
    };
    const original = await run(
      contrastPixels,
      inkPng,
      [{ ...point, record: true }, face],
      marks,
    );
    row.original = original;
    const stem = original.readings[0].paintedGlyph;
    if (stem) marks.stem = [stem.x, stem.y];
    let barePng;
    const page = await textContrast(row.scene, null, async (points) => {
      assert.ok(
        points.some((p) => p.name === point.name),
        "Latest missing from whole-page audit",
      );
      barePng = await frame("no-glyphs");
      return barePng;
    });
    // Contrast of the actual stem with the under-text pixel at the same
    // coordinate, in addition to the original adjacent button backing.
    row.bare = await run(
      contrastPixels,
      barePng,
      stem
        ? [
            {
              ...point,
              glyph: undefined,
              x: stem.x,
              y: stem.y,
              fg: `rgb(${stem.rgb.join(",")})`,
            },
          ]
        : [],
      marks,
    );
    for (const { frame } of [original, row.bare]) {
      assert.deepEqual(frame.bitmap, frame.viewport);
      assert.equal(frame.dpr, 1);
    }
    if (
      original.failures.length ||
      !stem ||
      stem.ratio < point.min ||
      row.bare.failures.length ||
      !original.frame.pixels.backing.rgb.every(
        (c, i) => Math.abs(c - row.bare.frame.pixels.backing.rgb[i]) <= 1,
      )
    )
      problems.push({
        width,
        theme,
        scene: row.scene,
        latest: "Missing glyph, backing or contrast in paired captures",
      });
    return page;
  };
  const audit = async (scene, selectors, { textRoot, ...facts } = {}) => {
    if (scene !== "design") await sleep(250);
    const geometry = await run(dimensions, selectors);
    assert.ok(
      selectors.every((s) => geometry[s]?.box[0] > 0),
      `Missing layout in ${scene}: ${selectors.filter((s) => !geometry[s]?.box[0])}`,
    );
    const indicators = await capture(scene, async () =>
      (await run(textSamples)).filter((p) => p.ink),
    );
    const contrast =
      scene === "tool output" && width === 1440 && theme === "light"
        ? await toolOutputContrast()
        : await textContrast(scene, textRoot);
    if (indicators?.failures.length)
      problems.push({ width, theme, scene, indicators: indicators.failures });
    assert.ok(contrast.samples, `no visible text sampled for ${scene}`);
    rows.push({
      width,
      theme,
      scene,
      geometry,
      worst: contrast.worst,
      indicator: indicators?.worst,
      samples: contrast.samples,
      ...(textRoot && { textRoot }),
      ...facts,
      ...(scene === "requested edit" ? { words: contrast.words } : {}),
    });
    if (scene === "requested edit") {
      for (const mark of ["char-add", "char-del"]) {
        const sample = contrast.words[mark];
        const word = mark === "char-add" ? "opal" : "silver";
        if (
          !sample ||
          sample.name !== `SPAN.${mark}: ${word}` ||
          sample.ratio < 4.5
        )
          problems.push({
            width,
            theme,
            scene,
            mark,
            sample: sample ?? "missing",
          });
      }
    }
    if (contrast.failures.length)
      problems.push({ width, theme, scene, contrast: contrast.failures });
    for (const [s, g] of Object.entries(geometry)) {
      if (
        g.xy[0] < -1 ||
        g.xy[0] + g.box[0] > width + 1 ||
        (!s.endsWith(" pre") && g.scroll[0] > g.client[0] + 2)
      )
        problems.push({ width, theme, scene, overflow: s, g });
    }
  };
  // Leave end-follow by real reader input before positioning a taller card's
  // individual controls. Never correct a position during its measurement.
  const wheelAway = async () => {
    const point = await run(() => {
      const pane = document.querySelector(".chat-messages");
      const r = pane.getBoundingClientRect(),
        x = r.left + 12,
        y = r.top + r.height / 2;
      if (!pane.contains(document.elementFromPoint(x, y)))
        throw Error("Transcript wheel target obstructed");
      return { x, y };
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      ...point,
      deltaX: 0,
      deltaY: -180,
    });
    await wait(
      `(() => {const p=document.querySelector('.chat-messages');return p.scrollHeight-p.clientHeight-p.scrollTop>80 && document.querySelector('.scroll-bottom')})()`,
    );
    // The first crossing of 80px may still be mid-wheel. Observe the final
    // offset before issuing a separate positioning operation, never after it.
    await run(() => {
      const pane = document.querySelector(".chat-messages");
      return opticalProbe.stableFrames(
        () => pane.scrollTop,
        "transcript wheel",
      );
    });
    return point;
  };
  const parkPointer = () =>
    send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
  const screenshot = async (name) => {
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(join(reportDir, name), Buffer.from(data, "base64"), {
      flag: "wx",
    });
    return data;
  };
  const picker = async (scene, observe, ...args) => {
    const row = { width, theme, scene, frames: [] };
    report.pickerStates.push(row);
    try {
      await observe(
        {
          width,
          theme,
          run,
          go,
          chat,
          click,
          wait,
          send,
          parkPointer,
          press,
          screenshot,
        },
        row,
        ...args,
      );
    } catch (error) {
      row.failure = String(error);
      row.failureFrame = `${scene}-${theme}-${width}-failed.png`;
      await screenshot(row.failureFrame);
      problems.push({ width, theme, scene, failure: row.failure });
    }
  };
  const recordState = (state, selector, observed, detail) => {
    assert.ok(observed?.samples, `No ${state} sample: ${selector}`);
    const row = {
      width,
      theme,
      state,
      selector,
      hit: true,
      ...detail,
      ...observed,
    };
    report.readingStates.push(row);
    if (observed.failures.length) problems.push(row);
  };
  const observeLink = async (surface, selector, label) => {
    const link = `${selector}:not(:hover,:focus)`;
    await parkPointer();
    await scrollTo(link);
    const decoration = await run((s) => {
      const a = document.querySelector(s),
        style = getComputedStyle(a);
      if (
        !(
          a.previousSibling?.textContent.trim() &&
          a.nextSibling?.textContent.trim()
        )
      )
        throw Error("Not an inline prose link");
      return {
        label: a.textContent,
        line: style.textDecorationLine,
        color: style.textDecorationColor,
        ink: style.color,
        thickness: style.textDecorationThickness,
        style: style.textDecorationStyle,
      };
    }, link);
    assert.equal(decoration.label, label);
    assert.equal(decoration.style, "solid");
    assert.equal(decoration.line, "underline");
    assert.equal(decoration.color, decoration.ink);
    assert.ok(
      decoration.thickness === "auto" || parseFloat(decoration.thickness) > 0,
    );
    recordState(
      "resting link",
      link,
      await textContrast("resting link", link),
      { surface, hovered: false, focused: false, decoration },
    );
  };
  const observeDirectory = async () => {
    const target = ".cwd-footer .cwd-target code";
    const at = (path) =>
      `document.querySelector(${q(target)})?.textContent===${q(path)}`;
    await wait(at(cwd));
    const next = `${cwd}/facets`;
    const release = site.holdDirectory(next);
    await click(".cwd-picker-list > button", "facets");
    await parkPointer();
    const list = '.cwd-picker-list[aria-busy="true"]';
    await wait(
      `document.querySelector('${list} > [role="status"]')?.textContent==='Reading folder…'`,
    );
    assert.ok(
      await ev(
        `${at(cwd)} && document.querySelector('.cwd-footer button:disabled:not([aria-busy])')?.textContent === 'Use this folder'`,
      ),
    );
    const reading = {
      width,
      theme,
      from: cwd,
      requested: next,
      openDisabled: true,
      options: [],
    };
    report.directoryReads.push(reading);
    for (const [s, label] of [
      ["button:first-of-type", "Parent folder"],
      ["button:last-of-type", "facets"],
    ]) {
      const option = `${list} > ${s}:enabled:not(:hover)`;
      await scrollTo(option);
      assert.equal(
        await ev(`document.querySelector(${q(option)}).textContent`),
        label,
      );
      const observed = await textContrast(
        `pending directory: ${label}`,
        option,
      );
      assert.ok(observed?.samples, `No visible pending ${label}`);
      assert.ok(observed.worst.name.endsWith(`: ${label}`));
      reading.options.push({ label, selector: option, ...observed });
      assert.deepEqual(observed.failures, []);
    }
    release();
    await wait(
      `${at(next)} && document.querySelector('.cwd-footer button:enabled') && document.querySelector('.cwd-picker-list:not([aria-busy]) button span')?.textContent==='quartz'`,
    );
    reading.arrived = await ev(
      `document.querySelector(${q(target)}).textContent`,
    );
  };
  const observeQuestions = async () => {
    const rail = ".qn-rail";
    await go(chat("questions"), rail);
    const error = '.msg-text .md .katex-error[title*="KaTeX parse error"]';
    await scrollTo(error);
    const row = { scene: "formula-error", frames: [] };
    await painted({ run, screenshot, width, theme }, row, "text", async () => ({
      points: [
        {
          ...(await run(glyphSample, error, "\\frac", null, "p")),
          record: true,
        },
      ],
    }));
    recordState(
      "incomplete formula",
      error,
      await textContrast(row.scene, error),
      row,
    );
    await observeLink(
      "chat",
      '.msg-text p > a[href="#specimen-notes"]',
      "specimen notes",
    );
    if (width <= 900) {
      assert.equal(
        await ev(
          `getComputedStyle(document.querySelector('.qn-rail')).display`,
        ),
        "none",
      );
      report.readingStates.push({
        width,
        theme,
        state: "compact questions",
        selector: rail,
        hidden: true,
      });
      return;
    }
    await wait(
      `document.querySelectorAll('.qn-bar').length===2 && document.querySelector('.qn-bar.active')`,
    );
    const point = await run(questionMarkSample);
    const short = ".qn-bar:not(.active,[aria-current])";
    recordState(
      "resting question",
      short,
      await capture(short, async () => [await run(questionMarkSample)]),
      { hovered: false, focusWithin: false, point },
    );
    const current = '.qn-bar.active[aria-current="true"]';
    const control = await observeButton("question navigation", current);
    assert.equal(control.keyboardFocus, true);
    const focus = async (key, selector) => {
      const observed = await capture(key, async () => {
        assert.ok(
          await ev(
            `document.activeElement.matches(${q(`${selector}:focus-visible`)})`,
          ),
        );
        return (await run(textSamples)).filter(
          (p) => p.name === "BUTTON focus",
        );
      });
      recordState(key, selector, observed, { focusVisible: true });
    };
    await focus("Tab question", current);
    const first = await ev(`document.activeElement.dataset.question==='0'`);
    await press(first ? "ArrowDown" : "ArrowUp", first ? 40 : 38);
    await focus(first ? "ArrowDown question" : "ArrowUp question", short);
  };
  for (const group of groups) {
    await observe(group, async () => {
      if (group === "reading") return reading();
      if (group === "forced-colors") return forcedColors();
      const [scheme, size] = group.split(":").slice(-2);
      theme = scheme;
      width = Number(size);
      const observer = conversationObservers[group.split(":")[0]];
      if (observer) {
        // Retire the previous view and its polling document before installing
        // a different specimen's Fetch handlers. Its responses must not cross
        // the navigation boundary and acquire the next view's request IDs.
        await send("Page.navigate", { url: "about:blank" });
        await wait(
          `location.href === 'about:blank' && document.readyState === 'complete'`,
        );
        // Couple the entry and reading observations at the first receipt, not
        // just two unrelated pages. Sample the same editor's compositor shots.
        const stages = new Set();
        const entryShot = async (file) => {
          const image = await screenshot(file);
          if (stages.size === 2) return image;
          const frame = await run(() => {
            const workspace = document.querySelector(
              ".chat-workspace:not([hidden])",
            );
            const pane = workspace.querySelector(".chat-messages");
            const style = getComputedStyle(pane, "::after");
            return {
              entry: workspace.dataset.entry,
              generated: style.content !== "none" && style.content !== "normal",
              shelfHeight: parseFloat(style.height) || 0,
              pointer: style.pointerEvents,
              paneBottom: pane.getBoundingClientRect().bottom,
              dockTop: workspace
                .querySelector(".composer-dock")
                .getBoundingClientRect().top,
              gap: pane.scrollHeight - pane.clientHeight - pane.scrollTop,
            };
          });
          if (
            ["new", "received"].includes(frame.entry) &&
            !stages.has(frame.entry)
          ) {
            report.entryShelves.push({ width, theme, file, ...frame });
            stages.add(frame.entry);
            if (frame.entry === "new")
              assert.ok(!frame.generated && frame.paneBottom < frame.dockTop);
            else
              assert.ok(
                frame.generated &&
                  frame.shelfHeight > 0 &&
                  frame.pointer === "none" &&
                  Math.abs(frame.paneBottom - frame.dockTop) <= 1 &&
                  Math.abs(frame.gap) <= 1,
              );
          }
          return image;
        };
        await observer({
          b,
          site,
          origin,
          width,
          theme,
          go,
          layout,
          chat,
          wait,
          run,
          ev,
          click,
          send,
          press,
          clickPoint,
          observeButton,
          screenshot:
            observer === observeQuietWorkspace ? entryShot : screenshot,
          rows:
            observer === observeQuietWorkspace
              ? report.quietWorkspace
              : report.transcriptPolish,
        });
        if (observer === observeQuietWorkspace)
          assert.deepEqual([...stages], ["new", "received"]);
        return;
      }
      await layout(width, theme);
      if (group.startsWith("agent-scroll:")) {
        await observeLiveAgent({
          width,
          theme,
          site,
          go,
          chat,
          wait,
          run,
          ev,
          click,
          send,
          press,
          clickPoint,
          observeButton,
          rows: report.agentScroll,
        });
        await ev(`localStorage.removeItem('cadence-last-project')`);
        return;
      }
      await go("/login", "input[type=password]");
      assert.equal(
        await ev(`matchMedia('(prefers-color-scheme: dark)').matches`),
        theme === "dark",
      );
      await audit("password", ["main", "#key", "button"]);
      await go("/login?error", "[role=alert]");
      await audit("retry", ["main", ".notice", "#key", "button"]);
      await go("/app", ".welcome-action:not(:disabled)");
      await audit("folder Hero", [
        ".layout",
        ".main",
        ".chat-messages",
        ".chat-composer",
        ".composer-toolbar",
        ".welcome-action",
      ]);
      assert.ok(
        await ev(`document.querySelector('[aria-label="Send"]').disabled`),
      );
      const panelTabs = (context, group, labels) =>
        observePanelTabs(
          {
            run,
            click,
            parkPointer,
            capture,
            press,
            send,
            width,
            theme,
            rows: report.panelTabs,
            problems,
          },
          context,
          group,
          labels,
        );
      await click(".inspector-toggle");
      await panelTabs("folder", "Workspace panels", ["Files"]);
      await click(".panel-collapse-btn");
      await click(".welcome-action");
      await wait(`document.querySelector('.cwd-filter')`);
      await audit("directory chooser", [
        "dialog",
        ".cwd-filter",
        ".cwd-picker-list",
        "dialog footer",
      ]);
      await picker("folder-first", observeRecentFolders, false);
      await observeDirectory();
      await picker("select-folder-action", observeFolderAction, site, false);
      await press("Escape", 27);
      assert.ok(
        await ev(`document.querySelector('[aria-label="Send"]').disabled`),
      );
      await picker("open-folder-action", observeFolderAction, site, true);
      await go(
        chat("empty"),
        ".chat-workspace[data-entry='new'] .model-trigger.empty",
      );
      if (width <= 900) {
        await click(".navigation-toggle");
        await wait(
          `document.querySelector('.drawer-left.open:not([inert])')?.contains(document.activeElement)`,
        );
        await audit("navigation", [".drawer-left", ".lp-panel"]);
        await press("Escape", 27);
        await wait(
          `document.activeElement.matches('.navigation-toggle[aria-expanded="false"]')`,
        );
      }
      await audit("project Hero", [
        ".main",
        ".chat-composer",
        ".composer-toolbar",
        ".conversation-header",
      ]);
      await picker("project-folders", observeRecentFolders, true);
      await press("Escape", 27);
      await click(".more-menu summary");
      await audit("menu", [".more-menu-items"]);
      await picker("more-material", observeOpenMaterial, ".more-menu-items");
      await click('.more-menu-items [aria-label="Cadence service"]');
      await wait(`document.querySelector('dialog[open]')`);
      await audit("service", ["dialog", "dialog header", "dialog footer"]);
      await press("Escape", 27);
      const models = (actions) =>
        picker(actions ? "models-current" : "models-readonly", () =>
          observeDisabledModels({
            run,
            wait,
            press,
            scrollTo,
            capture,
            width,
            theme,
            rows: report.disabledModels,
            actions,
          }),
        );
      // The same catalog, first with no action context and then on an
      // independent viewer. Never choose a model or mutate either viewer.
      await wait(
        `document.querySelector(".chat-workspace[data-entry='new'] .model-trigger.empty")`,
      );
      await click(".model-trigger");
      await models(false);
      await currentGo(
        chat("empty"),
        ".chat-workspace[data-entry='new'] .model-trigger.empty",
      );
      await click(".model-trigger");
      await models(true);
      await audit("models", [".model-popover", ".model-popover-notes"]);
      await press("Escape", 27);
      await go(chat("empty"), ".chat-workspace[data-entry='new']");
      await click(".chat-composer textarea");
      await send("Input.insertText", { text: "@" });
      await wait(`document.querySelector('.mention-item')`);
      await audit("path suggestions", [
        ".mention-menu",
        ".mention-list",
        ".mention-item",
      ]);
      await picker("mention-material", observeOpenMaterial, ".mention-menu");
      await press("Escape", 27);
      await press("Backspace", 8);
      await click(".inspector-toggle");
      await wait(
        `document.querySelector('.drawer-right:not([inert]) .file-main')`,
      );
      await audit("files", [".drawer-right", ".files-panel", ".file-main"]);
      await panelTabs("chat", "Workspace panels", ["Files", "Branches"]);
      await click('.rp-tabs[aria-label="Workspace panels"] button', "Files");
      await click(".file-main", "material.ts");
      await wait(`document.querySelector('.file-preview .codeblock')`);
      await audit("file preview", [
        ".drawer-right",
        ".file-preview",
        ".code-caption",
        ".file-preview pre",
      ]);
      if (width <= 900) {
        await press("Escape", 27);
        await observeGestures({
          run,
          send,
          width,
          theme,
          rows: report.drawerGestures,
        });
      } else await click(".inspector-toggle");
      // The shell stays mounted for the empty → first unsaved attempt switch.
      await wait(`document.querySelector('.chat-welcome')`);
      await ev(`location.hash='chat=attempt'`);
      await wait(
        `document.querySelector('.chat-attempt-text')?.innerText===${q(firstAttempt.text)}`,
      );
      const attempt = await ev(
        `({ hero:!!document.querySelector('.chat-welcome'), body:document.querySelector('.chat-attempt').innerText })`,
      );
      report.attempts.push({ width, theme, ...attempt });
      assert.ok(
        !attempt.hero &&
          attempt.body.includes(firstAttempt.text) &&
          attempt.body.includes(firstAttempt.status),
      );
      await audit("unsaved attempt", [".chat-attempt", ".chat-attempt-text"]);
      await observeLeading(
        "unsaved attempt",
        ".chat-attempt > p.chat-attempt-text",
        firstAttempt.text,
      );
      await go(chat("pending"), ".chat-waiting");
      for (const input of pendingInputs)
        await observeLeading(
          `pending ${input.mode}`,
          `.chat-waiting.${input.mode} > p.chat-attempt-text`,
          input.text,
        );
      await go(chat("undelivered"), ".chat-undelivered");
      await observeLeading(
        "undelivered",
        ".chat-undelivered > p.chat-attempt-text",
        undeliveredInput.text,
      );
      if (width > 900)
        await observeLiveFocus({
          go: currentGo,
          chat,
          click,
          wait,
          press,
          ev,
          send,
          run,
          capture,
          rows: report.controlFocus,
          width,
          theme,
        });
      await picker("locked-thinking", inCurrentSession(observeLockedLevels));
      await observeQuestions();
      await observeLeading(
        "chat",
        '.msg-text .md p:has(a[href="#specimen-notes"])',
      );
      await go(chat("reading"), ".chat-turn");
      await observeComposerGrip({
        width,
        theme,
        route: chat("reading"),
        send,
        run,
        parkPointer,
        screenshot,
        rows: report.composerGrip,
      });
      await bindReadingCode(run, chat("reading"));
      await wait("opticalProbe.code.state().bottom < 2");
      const readingPre = `${readingBlock} pre`;
      assert.ok(
        await ev(
          `(() => { const p=document.querySelector(${q(readingPre)});return p.scrollWidth>p.clientWidth })()`,
        ),
      );
      await audit("reading", [
        ".chat-messages",
        ".chat-turn",
        `${readingBlock} .code-caption`,
        readingPre,
        ".composer-toolbar",
      ]);
      // Both caption controls are already visible at the natural end. Tab and
      // measure there; centering a visible control creates another scroll.
      for (const [role, selector, name] of [
        ["code fold", foldButton, "ts"],
        ["code copy", copyButton, "Copy displayed text"],
      ]) {
        const tabbed = await observeButton(role, selector, name, false);
        assert.equal(tabbed.keyboardFocus, true);
      }
      try {
        for (const position of ["bottom", "keyboard", "away"]) {
          if (position === "keyboard") {
            // The last pointer activation focused the disclosure. Tab through
            // Copy and back, then activate using the native button keyboard path.
            await press("Tab", 9);
            assert.ok(
              await ev(`document.activeElement.matches(${q(copyButton)})`),
            );
            await press("Tab", 9, 8);
          } else if (position === "away") await wheelAway();
          for (const hidden of [true, false]) {
            const row = {
              width,
              theme,
              route: chat("reading"),
              position,
              keyboard: position === "keyboard",
              hidden,
            };
            report.codeDisclosures.push(row);
            await toggleReadingCode({ ev, run, clickPoint, press, wait }, row);
          }
        }
      } finally {
        await ev("opticalProbe.code.dispose()");
      }
      await expand("reading", "read", "material.ts");
      await scrollTo(".toolcall-output .toolcall-output-label");
      await audit("tool output", [
        ".chat-turn",
        ".toolcall-output",
        ".toolcall-output .toolcall-output-label",
        ".toolcall-output pre",
      ]);
      await observeButton("tool output copy", ".toolcall-output .output-copy");
      await scrollTo(".chat-image-open");
      await click(".chat-image-open");
      await audit("lightbox", [
        ".img-lightbox",
        ".img-lightbox-panel",
        ".img-lightbox-toolbar",
      ]);
      await picker(
        "lightbox-material",
        observeOpenMaterial,
        ".img-lightbox-panel",
      );
      await press("Escape", 27);
      for (const position of ["bottom", "away"]) {
        await go(chat("expand"), ".toolcall-head");
        await wait(
          `(()=>{const e=document.querySelector('.chat-messages');return e.scrollTop>0 && e.scrollHeight-e.clientHeight-e.scrollTop<3})()`,
        );
        if (position === "away") {
          const { hit } = await run(
            controlGeometry,
            ".toolcall-head .chead-main",
            false,
          );
          assert.ok(hit.center.hit);
          const wheel = {
            width,
            theme,
            point: hit.center,
            before: await run(readingPosition),
          };
          report.toolWheels.push(wheel);
          wheel.viewport = await run(bindToolWheel, hit.center);
          assert.deepEqual(wheel.viewport, [width, width > 900 ? 900 : 820, 1]);
          await send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: hit.center.x,
            y: hit.center.y,
            deltaX: 0,
            deltaY: -144,
          });
          try {
            await wait(`document.querySelector('.scroll-bottom')`);
          } finally {
            wheel.after = await ev(
              `opticalProbe.stableFrames(${readingPosition}, 'tool wheel')`,
            );
            Object.assign(wheel, await ev("opticalProbe.wheel()"));
          }
          assert.ok(
            wheel.event?.trusted &&
              wheel.event.x === Math.floor(hit.center.x) &&
              wheel.event.y === Math.floor(hit.center.y) &&
              !wheel.event.prevented &&
              wheel.event.deltaY === -144,
            "No trusted -144 wheel at the hit-tested head center",
          );
          assert.ok(
            wheel.after.bottom > 80,
            "Real wheel did not leave end-follow",
          );
        }
        const row = await expand("expand", "read", "material.ts", position);
        if (position === "away") {
          assert.ok(
            await ev(
              `opticalProbe.wheelHead === document.querySelector('[data-optical-tool] .chead-main')`,
            ),
          );
          await click(".scroll-bottom");
          await wait(`!document.querySelector('.scroll-bottom')`);
          const position = () =>
            ev(`opticalProbe.stableFrames(${readingPosition}, 'Latest')`);
          row.latest = await position();
          assert.ok(row.latest.bottom < 3, "Latest did not reach the end");
          // A jump to the old end is not proof of resumed follow. Change the
          // real viewport, not the transcript or its scrollTop, and check again.
          await viewport(width, (width > 900 ? 900 : 820) - 96);
          row.afterResize = await position();
          assert.ok(row.afterResize.clientHeight < row.latest.clientHeight);
          assert.ok(
            row.afterResize.bottom < 3,
            "Latest did not resume following",
          );
          await viewport(width);
        }
      }
      await go(chat("edit"), ".toolcall-head");
      if (width === 1440) {
        await copyIndicators(".toolcall-head .chead-copy");
        await copyIndicators(".msg-assistant .msg-meta .msg-action");
      }
      await expand("edit", "edit", "material.ts");
      await scrollTo("[data-optical-tool] .file-diff-body .char-add");
      await audit("requested edit", [
        ".file-diff-body",
        ".char-add",
        ".char-del",
      ]);
      await go(chat("bash"), ".toolcall-head");
      await expand("bash", "bash", "specimen summary");
      assert.equal(
        await ev(
          `document.querySelector('[data-optical-tool] .termline code').textContent`,
        ),
        shellCommand,
      );
      await observeCopy(
        "full command",
        "[data-optical-tool] .toolcall-args .output-copy",
        "Copy command",
        shellCommand,
      );
      await go(chat("write"), ".toolcall-head");
      await expand("write", "write", "requested.txt");
      await wait(`document.querySelector('.write-copy')`);
      assert.equal(
        await ev(`document.querySelectorAll('.diff-line-row.add').length`),
        400,
      );
      await observeCopy(
        "requested write",
        ".file-diff-toolbar .write-copy",
        undefined,
        writeContent,
        { shownLines: 400 },
      );
      // Wheel the actual transcript away before the design read opens its
      // modal. Clicking an offscreen opener would scroll the transcript back.
      const designRead = currentSite.holdRead({
        kind: "cadence-conversation",
        id: "design",
      });
      await currentGo(chat("design"), ".chat-turn");
      const design = await designRead();
      try {
        await wheelAway();
      } finally {
        design.respond(false);
      }
      await wait(
        `document.querySelector("dialog[open] .design-track input:checked")`,
      );
      await picker("other-idea", observeDesign, {
        audit,
        observeButton,
      });
      await press("Escape", 27);
      const trigger = ".conversation-header .current-plan-trigger";
      await click(trigger, "View current plan");
      const plan = ".current-plan-panel [data-plan-proposal]";
      await audit("plan", [plan, `${plan} > header`, `${plan} > .plan-scope`]);
      const notes = `${plan} > section .md p`;
      await observeLink(
        "plan",
        `${notes} > a[href="#plan-notes"]`,
        "plan notes",
      );
      await observeLeading("plan", `${notes}:has(a[href="#plan-notes"])`);
      const agreement = `${plan} > details`;
      await click(`${agreement} > summary`);
      // The disclosed agreement is exact text, not a second Markdown card.
      const exact = readableWorkflowPlan(
        readRecord({ kind: "cadence-conversation", id: "design" }).state
          .proposal.plan,
      );
      report.leading.push({
        width,
        theme,
        surface: "open agreement",
        ...(await leading(
          { run, scrollTo },
          `${agreement}[open] > pre`,
          exact,
        )),
      });
      await click(`${agreement} > summary`);
      const planButton = `${plan} > button.primary`;
      await wait(
        `document.querySelector(${q(`${planButton}:enabled`)})?.textContent==='Implement this plan'`,
      );
      await observeButton("implement plan", planButton, "Implement this plan");
      await click(trigger, "Hide current plan");
      await scrollTo(".workflow-line-open");
      await click(".workflow-line-open");
      await wait(`document.querySelector('.workflow-board')`);
      const cardProbe = {
        run,
        send,
        scrollTo,
        parkPointer,
        screenshot,
        width,
        theme,
        rows: report.cardMaterials,
      };
      await observeCardMaterial(
        cardProbe,
        ".workflow-card",
        "article.workflow-card > header > strong",
      );
      await scrollTo(".workflow-board");
      await audit("assignments", [
        ".workflow-card",
        ".workflow-board",
        ".workflow-task",
      ]);
      await currentGo(
        chat("confirm"),
        ".chat-workspace:has(.chat-turn) .current-plan-trigger",
      );
      await click(trigger, "View current plan");
      await wait(
        `document.querySelector(${q(`${planButton}:enabled`)})?.textContent==='Confirm implementation'`,
      );
      await observeButton(
        "confirm implementation",
        planButton,
        "Confirm implementation",
      );
      await click(trigger, "Hide current plan");
      await click(".workflow-line-open");
      await scrollTo(".workflow-card summary .workflow-status.unknown");
      for (const parent of ["header", "summary"])
        assert.equal(
          await ev(
            `document.querySelector('.workflow-card ${parent} .workflow-status')?.textContent`,
          ),
          "unknown",
        );
      await audit("unknown workflow", [
        ".workflow-card > header .workflow-status",
        ".workflow-card summary .workflow-status",
      ]);
      await go(
        `/app?project=${project}#task=${fieldTask}`,
        ".message-field .md p",
      );
      await observeLeading(
        "history message",
        ".message-field [data-retained-field] .md p",
      );
      await observeFieldFind({
        go,
        click,
        wait,
        press,
        ev,
        send,
        run,
        rows: report.fieldFind,
        width,
        theme,
      });
      const searchProbe = {
        go,
        click,
        wait,
        press,
        ev,
        send,
        run,
        width,
        theme,
      };
      await observeFieldBoundaries({ ...searchProbe, rows: report.fieldFind });
      await observeSearch({
        ...searchProbe,
        capture,
        rows: report.searchNavigation,
      });
      await go(`/app?project=${project}#task=${task}`, ".view-menu");
      await click(".view-menu summary");
      await click(".view-menu-items button", "timeline");
      await wait(`document.querySelector('.rtr-chip.rtr-tc-read')`);
      await click(".view-menu summary");
      await picker("view-material", observeOpenMaterial, ".view-menu-items");
      await press("Escape", 27);
      await observeCardMaterial(cardProbe, ".rtr");
      await scrollTo(".rtr-list");
      await audit("history", [
        ".workspace-content",
        ".rtr",
        ".rtr-list",
        ".rtr-detail",
      ]);
      await click(".act-fit");
      await wait(`document.querySelectorAll('.vis-item.vis-range').length===4`);
      const palette = await ev(
        `(()=>{const items=[...document.querySelectorAll('.vis-item.vis-range')].sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);return [...document.querySelectorAll('.rtr-row')].map((row,i)=>({event:row.querySelector('.tt').textContent, tool:row.querySelector('.rtr-chip').textContent,chip:getComputedStyle(row.querySelector('.rtr-chip')).color,lane:getComputedStyle(items[i]).backgroundColor}))})()`,
      );
      report.palettes.push({ width, theme, palette });
      assert.deepEqual(
        palette.map((r) => r.tool),
        ["read", "read", "read", "write"],
      );
      assert.ok(palette.every((r) => r.chip === r.lane));
      assert.equal(palette[0].chip, palette[1].chip);
      assert.equal(palette[1].chip, palette[2].chip);
      assert.notEqual(palette[2].chip, palette[3].chip);
      if (
        !(await ev(
          `document.querySelector('.inspector-toggle').getAttribute('aria-expanded')==='true'`,
        ))
      )
        await click(".inspector-toggle");
      await sleep(250); // The opener slides the target in; hit-test after its transition.
      await panelTabs("history", "Workspace panels", [
        "Files",
        "History details",
      ]);
      await panelTabs("history", "Inspector", [
        "contents",
        "checks",
        "changes",
        "reviews",
      ]);
      await click('.rp-tabs[aria-label="Inspector"] button', "changes");
      await wait(`document.querySelector('.scm-file button')`);
      await observeCardMaterial(cardProbe, ".scm-file");
      await click(".scm-file button");
      await wait(`document.querySelector('.fp-preview')`);
      // Observe the actual selection before any glyph-suppressed page audit.
      const line = ".fp-code .fp-line:nth-child(2)";
      await click(`${line} > .fp-num`, "2");
      await parkPointer();
      const selected = `${line}.sel:not(:hover) > .fp-num`;
      await wait(`document.querySelector(${q(selected)})`);
      await sleep(180); // Let the button's background transition finish.
      recordState(
        "selected line number",
        selected,
        await capture(selected, async () => [
          await run(glyphSample, selected, "2"),
        ]),
        { line: 2, selected: true, hovered: false },
      );
      await click(".fp-foot button", "Clear selection");
      await scrollTo(".fp-head");
      await audit("artifact", [
        ".drawer-right",
        ".inspector-body",
        ".fp-head",
        ".fp-code",
      ]);
      const previewMode = (mode) =>
        run((value) => {
          const select = document.querySelector(".fp-head select");
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }, mode);
      await previewMode("markdown");
      await observeLink(
        "artifact",
        '.fp-markdown-zoom > .md p > a[href="#artifact-notes"]',
        "artifact notes",
      );
      await observeLeading(
        "artifact preview",
        '.fp-markdown-zoom > .md p:has(a[href="#artifact-notes"])',
      );
      await previewMode("diff");
      await scrollTo(".scm-diff-line.add");
      await audit("diff", [
        ".fp-preview",
        ".scm-diff-pre",
        ".scm-diff-line.add",
        ".scm-diff-line.del",
      ]);
      await observeCopy(
        "paged artifact",
        ".scm-body .field-details button",
        "Copy full retained field",
        fullArtifact,
      );
      await previewMode("raw");
      await observeArtifactFind({
        click,
        wait,
        press,
        ev,
        run,
        send,
        width,
        theme,
        rows: report.artifactFind,
      });
      if (width <= 900) await press("Escape", 27);
      else await click(".inspector-toggle");
      await observeUnknownMode({
        width,
        theme,
        go,
        chat,
        wait,
        screenshot,
        run,
        rows: report.unknownMode,
        problems,
      });
      await site.withHistoryRoster(() =>
        observeSelectedRows({
          width,
          theme,
          go,
          chat,
          site,
          clickPoint,
          drawers: report.rowDrawers,
          wait,
          ev,
          run,
          parkPointer,
          press,
          send,
          capture,
          rows: report.selectedRows,
          workflowRows: report.workflowRows,
          readStep: (subagent) =>
            observeRetainedCopy(
              { run, click, wait, observeCopy, site },
              subagent,
            ),
          filePreviewReads: report.filePreviewReads,
          observeButton,
        }),
      );
      if (width > 900)
        await observeComposerFlow({
          width,
          theme,
          go,
          chat,
          layout,
          click,
          press,
          send,
          wait,
          run,
          rows: report.composerFlow,
        });
      // A separate conversation, after the original keyboard/scroll sequences.
      await observeChatMaterials(
        {
          ...cardProbe,
          go,
          chat,
          click,
          press,
          wait,
          observeButton,
          textContrast,
        },
        report,
      );
      await picker(
        "plan-validation",
        inCurrentSession(observeValidation),
        currentSite,
      );
    });
  }
  async function reading() {
    width = 1440;
    theme = "dark";
    await layout(width, theme);
    // Summarize main-thread Paint events while the trace streams; never save a
    // raw trace. A shared layer is not evidence every glyph in it was repainted.
    let paints = [],
      traceEnd;
    b.on("Tracing.dataCollected", ({ value }) => {
      for (const e of value)
        if (e.name === "Paint" && e.ph === "X")
          paints.push(e.args?.data?.nodeId ?? 0);
    });
    b.on("Tracing.tracingComplete", () => traceEnd?.());
    for (const scenario of ["idle", "scroll", "increment"]) {
      feed.increment = 0;
      const stream = scenario === "increment";
      await go(
        chat(scenario === "idle" ? "empty" : stream ? "stream" : "reading"),
        scenario === "idle" ? ".chat-welcome" : ".chat-turn",
      );
      await sleep(250);
      const roll = stream ? setInterval(() => feed.increment++, 520) : null;
      paints = [];
      await send("Tracing.start", {
        categories: "devtools.timeline",
        transferMode: "ReportEvents",
      });
      let stats;
      try {
        stats = await run(frameWindow, 2600, scenario === "scroll");
      } finally {
        clearInterval(roll);
      }
      const complete = new Promise((r) => {
        traceEnd = r;
      });
      await send("Tracing.end");
      await complete;
      const paint = new Map();
      for (const node of paints) {
        paint.set(node, (paint.get(node) ?? 0) + 1);
      }
      const attribution = {};
      for (const [id, count] of paint) {
        let name = "unattributed";
        if (id) {
          const { node } = await send("DOM.describeNode", {
            backendNodeId: id,
          }).catch(() => ({ node: null }));
          name = node?.nodeName ?? name;
          if (node?.attributes) {
            const i = node.attributes.indexOf("class");
            if (i >= 0) name += "." + node.attributes[i + 1];
          }
        }
        attribution[name] = (attribution[name] ?? 0) + count;
      }
      performanceRows.push({ scenario, ...stats, paint: attribution });
      if (stream) {
        assert.ok(
          await ev(
            `document.querySelector('.chat-turn').innerText.includes('Sample 2.')`,
          ),
        );
        assert.ok(
          await ev(
            `(()=>{const e=document.querySelector('.chat-messages');return e.scrollHeight-e.clientHeight-e.scrollTop<3})()`,
          ),
        );
      }
    }
    const top = await ev(
      `(()=>{const e=document.querySelector('.chat-messages');e.scrollTop=150;return e.scrollTop})()`,
    );
    feed.increment += 6;
    await sleep(1350);
    assert.equal(
      await ev(`document.querySelector('.chat-messages').scrollTop`),
      top,
    );
    await click(".scroll-bottom");
    await wait(
      `(()=>{const e=document.querySelector('.chat-messages');return e.scrollHeight-e.clientHeight-e.scrollTop<3})()`,
    );
    report.scrollFollow =
      "followed increments; retained up-scroll after growth; Latest returned to end";
  }
  async function forcedColors() {
    width = 320;
    theme = "light";
    await layout(width, theme, "reduce", "active");
    await go("/login?error", "#key");
    assert.ok(await ev(`matchMedia('(forced-colors: active)').matches`));
    await audit("forced-colors password", [
      "main",
      "input[type=password]",
      "button",
    ]);
  }
}

async function runLane(groups) {
  const site = fixture(root);
  const currentSite = fixture(root, { actions: true });
  const localProblems = [];
  let b;
  try {
    report.candidate ??= site.build;
    assert.deepEqual(site.build, report.candidate);
    assert.deepEqual(currentSite.build, report.candidate);
    const origin = await site.open();
    const currentOrigin = await currentSite.open();
    b = await browser(process.env.TMPDIR);
    await measureGroups(
      groups,
      { b, site, currentSite, problems: localProblems },
      origin,
      currentOrigin,
    );
  } finally {
    try {
      await b?.close();
    } finally {
      await Promise.all([site.close(), currentSite.close()]);
      report.unexpectedRequests.readonly.push(...site.failures);
      report.unexpectedRequests.currentContext.push(...currentSite.failures);
      problems.push(
        ...localProblems,
        ...site.failures,
        ...currentSite.failures,
      );
    }
  }
}

// Each theme exercises the same slow, real polling transitions. Isolate their
// profiles and fixture origins rather than accelerating timers, dropping views
// or extending the observation deadline. Keep the full timing matrix serial.
const lanes =
  args[0] === "--group=quiet-workspace"
    ? ["dark", "light"].map((theme) =>
        groups.filter((g) => g.split(":")[1] === theme),
      )
    : [groups];
for (const result of await Promise.allSettled(lanes.map(runLane))) {
  if (result.status === "rejected") problems.push(String(result.reason));
}
await writeFile(
  join(reportDir, "summary.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    reportDir,
    coverage: report.coverage,
    build: report.candidate?.buildId,
    scenes: rows.length,
    conversationViews:
      report.quietWorkspace.length + report.transcriptPolish.length,
    problems: problems.length,
    last: problems.slice(-1),
  }),
);
if (problems.length) process.exitCode = 1;
