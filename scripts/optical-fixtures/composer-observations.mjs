import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { contrastPixels, controlGeometry } from "./measure.mjs";
import { flowCase } from "./records.mjs";
import { degradedMode } from "./site.mjs";

// Read each geometry in one browser evaluation. The notice's solid leading
// rule is outside the compositor layer under test; its top edge distinguishes the
// compact footer reflow without choosing coordinates by the label's pixels.
function modeFrame(selector, label, notice) {
  const button = document.querySelector(selector);
  const alert = [
    ...document.querySelectorAll('.chat-messages [role="alert"]'),
  ].find((el) => el.textContent === notice);
  const n = alert.getBoundingClientRect(),
    c = button.closest(".chat-composer").getBoundingClientRect(),
    x = Math.floor(c.left + c.width / 2),
    y = Math.floor(c.top),
    rule = Math.floor(n.left + 1);
  return {
    document: performance.timeOrigin,
    route: location.pathname + location.search + location.hash,
    heading: document.querySelector(".conversation-heading h2").textContent,
    notice: alert.textContent,
    name: button.getAttribute("aria-label"),
    title: button.title,
    disabled: button.disabled,
    button: button.getBoundingClientRect().toJSON(),
    capsule: c.toJSON(),
    noticeBorder: getComputedStyle(alert).borderLeftColor,
    landmarks: {
      noticeTop: [rule, Math.ceil(n.top) + 2],
      aboveNotice: [rule, Math.floor(n.top) - 2],
      capsuleTop: [x, y],
      outside: [x, y - 2],
      inside: [x, y + 4],
    },
    points: [0.1, 0.5, 0.9].map((f) => ({
      ...opticalProbe.glyphSample(selector, label, f),
      record: true,
    })),
  };
}

export async function observeUnknownMode({
  go,
  chat,
  wait,
  screenshot,
  run,
  rows,
  problems,
  width,
  theme,
}) {
  const label = "Cadence state unavailable";
  const selector = `.chat-composer button.mode-toggle.unknown:disabled[aria-label="${label}"][title="${label}"]`;
  const route = chat(degradedMode.id),
    heading = `Optical · ${degradedMode.id}`;
  const base = {
    width,
    theme,
    scene: "unknownMode",
    ...degradedMode,
    selector,
  };
  let phase = "navigation";
  try {
    await wait(
      `document.querySelector('.inspector-toggle[aria-expanded="false"]') && document.querySelector('.drawer-right[inert]:not(.open)')`,
    );
    // Unknown is also the initial state. Require this route's degraded read.
    await go(route, ".chat-workspace > .conversation-header");
    await wait(
      `location.pathname + location.search + location.hash === ${JSON.stringify(route)} && document.querySelector('.conversation-heading h2')?.textContent === ${JSON.stringify(heading)} && [...document.querySelectorAll('.chat-messages [role="alert"]')].some(el => el.textContent === ${JSON.stringify(degradedMode.notice)}) && document.querySelector(${JSON.stringify(selector)})`,
    );
  } catch (error) {
    const failure = { ...base, phase, error: String(error) };
    rows.push(failure);
    problems.push(failure);
    return;
  }
  const locate = () => run(modeFrame, selector, label, degradedMode.notice);
  for (phase of ["ready", "stable"]) {
    const row = { ...base, phase };
    rows.push(row);
    try {
      if (phase === "stable") {
        await sleep(300);
        await run(controlGeometry, selector, false);
      }
      const before = await locate();
      row.png = `unknown-${theme}-${width}-${phase}.png`;
      const png = await screenshot(row.png);
      const after = await locate();
      assert.equal(after.document, before.document);
      const candidates =
        JSON.stringify(before) === JSON.stringify(after)
          ? [before]
          : [before, after];
      row.bindings = [];
      const observations = [];
      // Only one PNG. If the layout moved during its capture, bind by the
      // notice edge, NEVER retry or pick the better-looking label.
      for (const { points, landmarks, ...geometry } of candidates) {
        assert.equal(geometry.route, route);
        assert.equal(geometry.heading, heading);
        assert.equal(geometry.notice, degradedMode.notice);
        assert.equal(geometry.disabled, true);
        assert.equal(geometry.name, label);
        assert.equal(geometry.title, label);
        const observed = await run(contrastPixels, png, points, landmarks);
        const { bitmap, viewport, dpr, pixels } = observed.frame;
        assert.deepEqual(bitmap, [width, width > 900 ? 900 : 820]);
        assert.deepEqual(bitmap, viewport);
        assert.equal(dpr, 1);
        const isRule = (p) =>
          `rgb(${p.rgb.join(", ")})` === geometry.noticeBorder;
        const matchesNotice =
          isRule(pixels.noticeTop) && !isRule(pixels.aboveNotice);
        const { frame, ...sample } = observed;
        row.bindings.push({ geometry, frame, matchesNotice });
        observations.push(sample);
      }
      const matches = row.bindings.filter((g) => g.matchesNotice);
      assert.equal(matches.length, 1, "No unique presented notice geometry");
      row.bound = row.bindings.indexOf(matches[0]);
      Object.assign(row, observations[row.bound]);
      const { samples, readings, failures } = row;
      assert.equal(samples, 3);
      assert.equal(readings?.length, 3);
      for (const r of readings) {
        assert.ok(r.paintedGlyph, "Missing painted mode label");
        assert.ok(
          r.paintedGlyph.ratio >= r.min,
          `Painted mode label: ${r.paintedGlyph.ratio}:1`,
        );
        assert.equal(r.alpha, 1);
      }
      assert.deepEqual(failures, []);
    } catch (error) {
      row.error = String(error);
      problems.push({ ...base, phase, error: row.error });
    }
  }
}

// Drive head/turn polls, not the DOM attribute under test. Notice identifies
// the delivered turn version even when two successive expectations are off.
export async function observeComposerFlow({
  go,
  chat,
  layout,
  click,
  press,
  send,
  wait,
  run,
  rows,
  theme,
  width,
}) {
  const input = ".chat-composer textarea",
    draft = "Keep this unsent draft.";
  const phase = (name) => {
    flowCase.phase = name;
    flowCase.sequence++;
  };
  flowCase.startedAt = Date.now() - 75_000;
  phase("thinking");
  await go(chat("optical-flow"), ".chat-composer[data-flow]");
  await click(input);
  await send("Input.insertText", { text: draft });
  const record = async (stage, motion = "no-preference") => {
    await wait(
      `document.querySelector('.chat-turn-notice')?.textContent === 'Observation: ${flowCase.phase}'`,
    );
    await wait(
      `!!document.querySelector('.chat-messages .banner-notice') === ${flowCase.failTurn}`,
    );
    const observed = await run(() => {
      const form = document.querySelector(".chat-composer"),
        body = document.querySelector(".msg-assistant .md p"),
        range = new Range();
      range.selectNodeContents(body);
      const r = range.getBoundingClientRect(),
        css = getComputedStyle(form, "::before");
      const footer = document.querySelector(".statusbar-left");
      return {
        observedAt: Date.now(),
        working:
          footer.querySelector(".working .bar-item-text")?.textContent ?? null,
        duration:
          footer.querySelector(".bar-item-duration")?.textContent ?? null,
        unavailable: [...footer.querySelectorAll('[role="status"]')].some(
          (el) => el.textContent === "Conversation activity unavailable.",
        ),
        flow: form.hasAttribute("data-flow"),
        animation: css.animationName,
        runningAnimations: form
          .getAnimations({ subtree: true })
          .filter(
            (a) =>
              a.animationName === "prism-flow" && a.playState === "running",
          ).length,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        draft: form.querySelector("textarea").value,
        body: body.textContent,
        readable: body.contains(
          document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
        ),
        error:
          document.querySelector(".chat-messages .banner-notice")
            ?.textContent ?? null,
      };
    });
    const flow =
        !flowCase.failTurn && ["thinking", "tool"].includes(flowCase.phase),
      animate = flow && motion !== "reduce";
    rows.push({
      width,
      theme,
      stage,
      startedAt: flowCase.startedAt,
      ...observed,
    });
    const running = !flowCase.failTurn && flowCase.phase !== "settled";
    assert.equal(observed.unavailable, flowCase.failTurn, stage);
    assert.equal(observed.working, running ? "Working" : null, stage);
    if (running && flowCase.startedAt) {
      assert.match(observed.duration, /^\d+:\d{2}$/);
      const [mm, ss] = observed.duration.split(":").map(Number);
      const seconds = Math.floor(
        (observed.observedAt - flowCase.startedAt) / 1000,
      );
      assert.ok(
        [seconds, seconds - 1].includes(mm * 60 + ss),
        `Wrong elapsed time: ${stage}`,
      );
    } else assert.equal(observed.duration, null, stage);
    assert.equal(observed.flow, flow, stage);
    assert.equal(observed.animation, animate ? "prism-flow" : "none", stage);
    assert.equal(observed.runningAnimations, animate ? 1 : 0, stage);
    assert.equal(observed.reduced, motion === "reduce");
    assert.equal(observed.draft, draft);
    assert.ok(
      observed.readable && observed.body === "Retained optical specimen.",
    );
    if (flowCase.failTurn) assert.match(observed.error, /stale/);
  };
  await record("live thinking");
  flowCase.failTurn = true;
  await record("failed read; retained thinking turn");
  flowCase.failTurn = false;
  phase("tool");
  await record("successful re-observation");
  await layout(width, theme, "reduce");
  await record("live tool with reduced motion", "reduce");
  await layout(width, theme);
  await record("restored motion");
  for (const name of ["waiting", "text", "thinking", "settled"]) {
    phase(name);
    await record(name);
  }
  await click(input);
  await press("a", 65, 2);
  await press("Backspace", 8);
}
