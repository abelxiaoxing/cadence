// Optional local observation; not a verify/package/release stage.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { browser } from "./optical-fixtures/browser.mjs";
import {
  observeComposerFlow,
  observeComposerGrip,
  observeUnknownMode,
} from "./optical-fixtures/composer-observations.mjs";
import {
  observeOpenMaterial,
  observeOtherIdea,
  observeRetainedCopy,
} from "./optical-fixtures/detail-observations.mjs";
import { observeGestures } from "./optical-fixtures/drawer-gestures.mjs";
import {
  contrastPixels,
  controlGeometry,
  dimensions,
  frameWindow,
  glyphSample,
  questionMarkSample,
  readingPosition,
  restingCopySample,
  stableFrames,
  textSamples,
} from "./optical-fixtures/measure.mjs";
import {
  observeDisabledModels,
  observePanelTabs,
  observeSelectedRows,
} from "./optical-fixtures/panel-observations.mjs";
import {
  observeLockedLevels,
  observeRecentFolders,
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
  project,
  shellCommand,
  task,
  writeContent,
} from "./optical-fixtures/records.mjs";
import {
  observeArtifactFind,
  observeFieldBoundaries,
  observeSearch,
} from "./optical-fixtures/search-observations.mjs";
import { fixture } from "./optical-fixtures/site.mjs";
import { openTool } from "./optical-fixtures/tool-card.mjs";
import { assertVerificationTemp } from "./verification-temp.mjs";

const root = resolve(import.meta.dirname, "..");
assertVerificationTemp(root);
const reportDir = await mkdtemp(join(process.env.TMPDIR, "optical-evidence-"));
const site = fixture(root),
  origin = await site.open(),
  rows = [],
  problems = [],
  performanceRows = [];
const report = {
  candidate: site.build,
  hitTests: [],
  controls: [],
  attempts: [],
  palettes: [],
  copies: [],
  copyIndicators: [],
  readingStates: [],
  toolCards: [],
  drawerGestures: [],
  directoryReads: [],
  pickerStates: [],
  leading: [],
  fieldFind: [],
  searchNavigation: [],
  panelTabs: [],
  selectedRows: [],
  workflowRows: [],
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
const q = JSON.stringify;
let b;
const limited = [];
try {
  b = await browser(process.env.TMPDIR);
  report.browser = b.version.product;
  const { evaluate: ev, send } = b;
  const run = (fn, ...args) => ev(`(${fn})(${args.map(q).join(",")})`);
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.opticalProbe={draws:0,stableFrames:${stableFrames},glyphSample:${glyphSample}};const draw=WebGLRenderingContext.prototype.drawArrays;WebGLRenderingContext.prototype.drawArrays=function(...args){if(this.canvas.closest('.optical-field'))opticalProbe.draws++;return draw.apply(this,args);};`,
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
  const go = async (path, selector) => {
    await send("Page.navigate", { url: "about:blank" });
    await send("Page.navigate", { url: origin + path });
    await wait(`document.querySelector(${q(selector)})`);
  };
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
  const observeButton = async (role, selector, expected) => {
    await wait(`document.querySelector(${q(selector)})`);
    const geometry = await run(controlGeometry, selector);
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
  const observeLeading = async (surface, selector) => {
    report.leading.push({
      width,
      theme,
      surface,
      ...(await leading({ run, scrollTo }, selector)),
    });
  };
  const expand = async (id, tool, path, position) => {
    const row = { width, theme, id, tool, path, position };
    report.toolCards.push(row);
    await openTool({ ev, run, send, wait, site, row, route: chat(id) });
    return row;
  };
  const copyIndicators = async (selector) => {
    // No hover/focus reveal: move the real pointer outside the card, and
    // sample before Tab reaches the control. Require both screenshot samples.
    await run(controlGeometry, selector);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    const point = await run(restingCopySample, selector);
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
    assert.deepEqual(await run(restingCopySample, selector), point);
    const control = await observeButton("copy indicator focus", selector);
    assert.equal(control.keyboardFocus, true);
    const focusPoint = (await run(textSamples)).find(
      (p) => p.name === "BUTTON focus",
    );
    await capture(focusPoint);
    assert.ok(await ev(`document.activeElement.matches(${q(selector)})`));
  };
  const capture = async (scene, locate) => {
    // Sample indicators on the unmodified page. On a separate capture,
    // temporarily remove glyph ink only to read the material under text.
    for (let attempt = 0; attempt < 4; attempt++) {
      await ev(
        "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
      );
      const points = await locate();
      if (!points.length) return null;
      const png = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      if (JSON.stringify(points) !== JSON.stringify(await locate())) continue;
      return run(contrastPixels, png.data, points);
    }
    throw Error(`Unstable screenshot geometry: ${scene}`);
  };
  const textContrast = async (scene, selector) => {
    await ev(`document.body.style.webkitTextFillColor='transparent'`);
    try {
      return await capture(scene, async () =>
        (await run(textSamples, selector ?? null)).filter((p) => !p.ink),
      );
    } finally {
      await ev(`document.body.style.removeProperty('-webkit-text-fill-color')`);
    }
  };
  const audit = async (scene, selectors) => {
    await sleep(250);
    const geometry = await run(dimensions, selectors);
    assert.ok(
      selectors.every((s) => geometry[s]?.box[0] > 0),
      `Missing layout in ${scene}: ${selectors.filter((s) => !geometry[s]?.box[0])}`,
    );
    const indicators = await capture(scene, async () =>
      (await run(textSamples)).filter((p) => p.ink),
    );
    const contrast = await textContrast(scene);
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
          parkPointer,
          press,
          screenshot,
        },
        row,
        ...args,
      );
    } catch (error) {
      row.failure = String(error);
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
        `${at(cwd)} && !!document.querySelector('.cwd-footer button:disabled')`,
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
  for (theme of ["dark", "light"])
    for (width of [320, 390, 1440]) {
      await layout(width, theme);
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
      await press("Escape", 27);
      assert.ok(
        await ev(`document.querySelector('[aria-label="Send"]').disabled`),
      );
      await go(chat("empty"), ".conversation-header");
      await wait(`document.querySelector('.optical-field[data-scene="hero"]')`);
      if (width <= 900) {
        await click(".navigation-toggle");
        await audit("navigation", [".drawer-left", ".lp-panel"]);
        await press("Escape", 27);
        assert.ok(
          await ev(`document.activeElement.matches('.navigation-toggle')`),
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
      await click(".model-trigger");
      await observeDisabledModels({
        run,
        wait,
        press,
        scrollTo,
        capture,
        width,
        theme,
        rows: report.disabledModels,
      });
      await audit("models", [".model-popover", ".model-popover-notes"]);
      await press("Escape", 27);
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
      await wait(
        `!document.querySelector('.chat-welcome') && document.querySelector('.optical-field').dataset.scene==='reading' && +getComputedStyle(document.querySelector('.optical-field')).opacity<=.08`,
      );
      const { draws } = await run(frameWindow, 1250, false);
      const attempt = await ev(
        `({ opacity:+getComputedStyle(document.querySelector('.optical-field')).opacity, hero:!!document.querySelector('.chat-welcome'), body:document.querySelector('.chat-attempt').innerText })`,
      );
      report.attempts.push({ width, theme, draws, ...attempt });
      assert.equal(draws, 0);
      assert.ok(
        !attempt.hero &&
          attempt.opacity <= 0.08 &&
          attempt.body.includes(firstAttempt.text) &&
          attempt.body.includes(firstAttempt.status),
      );
      await audit("unsaved attempt", [".chat-attempt", ".chat-attempt-text"]);
      if (width > 900)
        await observeLiveFocus({
          go,
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
      await picker("locked-thinking", observeLockedLevels);
      await observeQuestions();
      await observeLeading(
        "chat",
        '.msg-text .md p:has(a[href="#specimen-notes"])',
      );
      await go(chat("reading"), ".chat-turn");
      await wait(
        `+getComputedStyle(document.querySelector('.optical-field')).opacity<=.08`,
      );
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
      await scrollTo(".code-caption");
      assert.ok(
        await ev(
          `(()=>{const p=document.querySelector('.codeblock pre');return p.scrollWidth>p.clientWidth})()`,
        ),
      );
      await audit("reading", [
        ".chat-messages",
        ".chat-turn",
        ".code-caption",
        ".codeblock pre",
        ".composer-toolbar",
      ]);
      await observeButton("code fold", ".code-caption button:first-child");
      await observeButton("code copy", ".code-caption .output-copy");
      await click(".code-caption button:first-child");
      assert.ok(await ev(`document.querySelector('.codeblock pre').hidden`));
      await click(".code-caption button:first-child");
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
          await send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: hit.center.x,
            y: hit.center.y,
            deltaX: 0,
            deltaY: -144,
          });
          await wait(`document.querySelector('.scroll-bottom')`);
        }
        const row = await expand("expand", "read", "material.ts", position);
        if (position === "away") {
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
        await copyIndicators(".msg-part:last-child .msg-text-copy");
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
      await go(chat("design"), ".design-track input:checked");
      await scrollTo(".design-track");
      await audit("design", [
        ".chat-messages",
        ".design-card",
        ".design-track",
        ".design-track label",
      ]);
      await picker("other-idea", observeOtherIdea);
      await observeButton(
        "submit design",
        ".design-card > button:last-child",
        "Submit design and use recommendations for unanswered questions",
      );
      await scrollTo(".plan-context");
      await audit("plan", [
        ".workflow-plan:not(.design-card)",
        ".plan-context",
      ]);
      await observeLink(
        "plan",
        '.workflow-plan:not(.design-card) > .md p > a[href="#plan-notes"]',
        "plan notes",
      );
      const plan = ".workflow-plan:not(.design-card)";
      await observeLeading(
        "plan",
        `${plan} > .md p:has(a[href="#plan-notes"])`,
      );
      const agreement = `${plan} > details`;
      await click(`${agreement} > summary`, "Complete delivery agreement");
      // Opening the agreement grows the transcript. Explicitly leave end
      // follow before positioning a paragraph for the typography sample.
      const readingEdge = await ev(
        `(()=>{const pane=document.querySelector('.chat-messages'),r=pane.getBoundingClientRect(),x=r.left+12,y=r.top+r.height/2;if(!pane.contains(document.elementFromPoint(x,y))) throw Error('Transcript wheel target obstructed');return {x,y}})()`,
      );
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        ...readingEdge,
        deltaX: 0,
        deltaY: -180,
      });
      await wait(`document.querySelector('.scroll-bottom')`);
      await observeLeading(
        "open agreement",
        `${agreement}[open] > .md p:has(a[href="#plan-notes"])`,
      );
      await click(`${agreement} > summary`, "Complete delivery agreement");
      const planButton = ".workflow-plan:not(.design-card) > button.primary";
      await wait(
        `document.querySelector(${q(planButton)})?.textContent==='Implement this plan'`,
      );
      await observeButton("implement plan", planButton, "Implement this plan");
      await scrollTo(".workflow-line-open");
      await click(".workflow-line-open");
      await wait(`document.querySelector('.workflow-board')`);
      await scrollTo(".workflow-board");
      await audit("assignments", [
        ".workflow-card",
        ".workflow-board",
        ".workflow-task",
      ]);
      await go(chat("confirm"), ".workflow-plan");
      await wait(
        `document.querySelector(${q(planButton)})?.textContent==='Confirm implementation'`,
      );
      await observeButton(
        "confirm implementation",
        planButton,
        "Confirm implementation",
      );
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
      await observeSelectedRows({
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
      });
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
      // Start the next folder-first observation in this disposable origin only.
      await ev(`localStorage.removeItem('cadence-last-project')`);
    }
  width = 1440;
  theme = "dark";
  await layout(width, theme);
  await go("/app", ".welcome-action:not(:disabled)");
  const gpu = await ev(
    `(()=>{const c=document.querySelector('.optical-field canvas'),gl=c.getContext('webgl');if(!gl)return null;const ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],dpr:devicePixelRatio};})()`,
  );
  report.gpu = gpu;
  if (!gpu)
    limited.push(
      "WebGL creation failed; animation/draw comparison unavailable.",
    );
  const ambient = async (on) => {
    await click(".more-menu summary");
    if (
      await ev(
        `document.querySelector('.more-menu-items [aria-pressed]').getAttribute('aria-pressed')!==${q(String(on))}`,
      )
    )
      await click(".more-menu-items [aria-pressed]");
    await press("Escape", 27);
    await sleep(500);
  };
  const checkClock = async (active) => {
    const sample = await run(frameWindow, 1250, false);
    if (gpu && active)
      assert.ok(
        sample.draws > 0 && sample.draws <= 31,
        `Unexpected visible draws ${sample.draws}`,
      );
    else assert.equal(sample.draws, 0);
    return sample.draws;
  };
  report.heroDraws = await checkClock(true);
  if (gpu) {
    const available = await ev(
      `(()=>{const gl=document.querySelector('.optical-field canvas').getContext('webgl');const ext=gl.getExtension('WEBGL_lose_context');if(!ext)return false;window.opticalProbe.restore=()=>ext.restoreContext();ext.loseContext();return true})()`,
    );
    if (available) {
      await sleep(100);
      report.lostDraws = await checkClock(false);
      await ev(`opticalProbe.restore()`);
      await sleep(100);
      report.restoredDraws = await checkClock(true);
    } else limited.push("Browser did not expose context-loss extension.");
  }

  await layout(width, theme, "reduce");
  report.reducedDraws = await checkClock(false);
  await layout(width, theme);
  report.afterReducedDraws = await checkClock(true);
  await ambient(false);
  report.disabledDraws = await checkClock(false);
  await ambient(true);
  report.afterDisabledDraws = await checkClock(true);
  // A real background target, not a synthetic visibilitychange dispatch.
  await send("Page.bringToFront");
  // Open from the measured page: an unrelated CDP target in a separate
  // window can be active without hiding this one. No profile is reused.
  await send("Runtime.evaluate", {
    expression: "void window.open('about:blank', '_blank')",
    userGesture: true,
  });
  const { targetInfos } = await b.call("Target.getTargets");
  const other = targetInfos.find(
    (t) => t.type === "page" && t.openerId === b.targetId,
  );
  if (other) {
    const { sessionId } = await b.call("Target.attachToTarget", {
      targetId: other.targetId,
      flatten: true,
    });
    await b.call("Page.bringToFront", {}, sessionId);
    for (let i = 0; i < 50 && !(await ev("document.hidden")); i++)
      await sleep(100);
    if (await ev("document.hidden")) {
      const initial = await ev("opticalProbe.draws");
      await sleep(1000);
      assert.ok(await ev("document.hidden"));
      assert.equal(await ev("opticalProbe.draws"), initial);
      report.hiddenDraws = 0;
    }
    await b.call("Target.closeTarget", { targetId: other.targetId });
    await send("Page.bringToFront");
    if (report.hiddenDraws === 0) {
      await wait("!document.hidden");
      report.afterHiddenDraws = await checkClock(true);
    }
  }
  if (report.hiddenDraws !== 0)
    limited.push(
      "The browser did not open and foreground a sibling tab that hid this document; background draw count unmeasured.",
    );
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
  for (const scenario of ["idle", "scroll", "increment"])
    for (const on of [true, false, false, true]) {
      feed.increment = 0;
      const stream = scenario === "increment";
      await go(
        chat(scenario === "idle" ? "empty" : stream ? "stream" : "reading"),
        scenario === "idle" ? ".chat-welcome" : ".chat-turn",
      );
      await ambient(on);
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
      performanceRows.push({ scenario, on, ...stats, paint: attribution });
      if (scenario !== "idle" || !on) assert.equal(stats.draws, 0);
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
} catch (error) {
  problems.push(String(error));
} finally {
  await b?.close();
  await site.close();
}
problems.push(...site.failures);
report.unavailable = limited;
await writeFile(
  join(reportDir, "summary.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    reportDir,
    build: report.candidate.buildId,
    scenes: rows.length,
    problems: problems.length,
    last: problems.slice(-1),
    unavailable: limited,
  }),
);
if (problems.length || limited.length) process.exitCode = 1;
