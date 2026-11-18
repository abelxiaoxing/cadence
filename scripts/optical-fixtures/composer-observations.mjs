import assert from "node:assert/strict";
import { glyphSample } from "./measure.mjs";
import { flowCase } from "./records.mjs";
import { degradedMode } from "./site.mjs";

export async function observeUnknownMode({
  go,
  chat,
  wait,
  capture,
  run,
  rows,
  width,
  theme,
}) {
  const label = "Cadence state unavailable";
  const selector = `.chat-composer .mode-toggle.unknown:disabled[aria-label="${label}"][title="${label}"]`;
  // Unknown is also the initial state. Wait for the notice from this exact
  // degraded read, not just the class or the hint (hidden on compact screens).
  await go(chat(degradedMode.id), ".chat-workspace > .conversation-header");
  await wait(
    `document.querySelector('.conversation-heading h2')?.textContent === 'Optical · ${degradedMode.id}' && [...document.querySelectorAll('.chat-messages [role="alert"]')].some(el => el.textContent === ${JSON.stringify(degradedMode.notice)}) && document.querySelector(${JSON.stringify(selector)})`,
  );
  const observed = await capture(label, () =>
    Promise.all(
      [0.1, 0.5, 0.9].map((f) => run(glyphSample, selector, label, f)),
    ),
  );
  rows.push({ width, theme, ...degradedMode, selector, ...observed });
  assert.equal(observed?.samples, 3);
  assert.ok(observed.worst.paintedGlyph);
  assert.equal(observed.worst.alpha, 1);
  assert.deepEqual(observed.failures, []);
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
      return {
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
    rows.push({ width, theme, stage, ...observed });
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
