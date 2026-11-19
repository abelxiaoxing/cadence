import assert from "node:assert/strict";
import { controlGeometry, glyphSample } from "./measure.mjs";
import { painted } from "./picker-observations.mjs";
import { agentFeed, cwd, liveDock, validatingChat } from "./records.mjs";

export async function observeValidation(probe, row, site) {
  const { go, chat, wait, click, parkPointer, run } = probe;
  const button = ".workflow-plan > button.primary";
  const busy = `${button}:disabled[aria-busy="true"]`;
  const ready = `${button}:enabled:not([aria-busy])`;
  const label = "Validate plan again";
  const readyState = `document.querySelector('${ready}')?.textContent === '${label}'`;
  await go(chat(validatingChat), button);
  await wait(
    `${readyState} && document.querySelector('.model-trigger:not(.remembered)')?.textContent === 'optical · Medium'`,
  );
  const start = site.failures.length;
  const pending = site.holdRead({
    kind: "conversation-models",
    location: { id: validatingChat, cwd },
  });
  await click(ready, label);
  const held = await pending();
  try {
    await wait(
      `document.querySelector('${busy}')?.textContent === 'Validating plan…'`,
    );
    await parkPointer();
    await painted(probe, row, "busy", async () => {
      const geometry = await run(controlGeometry, busy, false);
      assert.equal(geometry.disabled, true);
      assert.equal(geometry.name, "Validating plan…");
      assert.deepEqual(geometry.visible, geometry.rect);
      assert.ok(Object.values(geometry.hit).every(({ hit }) => hit));
      return {
        pendingRead: held.request,
        ...geometry,
        points: [
          { ...(await run(glyphSample, busy, geometry.name)), record: true },
        ],
      };
    });
  } finally {
    held.respond(true);
  }
  const error =
    "Plan validation did not finish (invalid). No implementation was approved; observe the plan before trying again.";
  await wait(
    `${readyState} && [...document.querySelectorAll('.chat-messages [role="alert"]')].some(el => el.textContent === ${JSON.stringify(error)})`,
  );
  row.afterReadFailure = {
    label,
    error,
    unexpectedRequests: site.failures.slice(start),
  };
  assert.deepEqual(row.afterReadFailure.unexpectedRequests, []);
}

// Read geometry and a rendered response witness together. Never position the
// pane for a sample: only the two real wheels and explicit Latest move it.
function position() {
  const pane = document.querySelector(".workflow-agent .chat-messages");
  const read = /^Facet read (\d+)$/.exec(
    pane.querySelector(".chat-turn-notice")?.textContent,
  );
  if (!read) throw Error("Missing live subagent transcript");
  const { scrollTop, clientHeight, scrollHeight } = pane;
  return {
    scrollTop,
    clientHeight,
    scrollHeight,
    gap: scrollHeight - clientHeight - scrollTop,
    completedReads: Number(read[1]),
  };
}

export async function observeLiveAgent({
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
  rows,
}) {
  agentFeed.growth = agentFeed.sequence = 0;
  const dock = `.agent-dock-run[aria-label="${liveDock.goal}"] > .agent-dock-row`;
  await go(chat("live-dock"), dock);
  if (
    await ev(
      `document.querySelector('.navigation-toggle').getAttribute('aria-expanded') === 'false'`,
    )
  )
    await click(".navigation-toggle");
  const entry = await run(controlGeometry, dock, false);
  assert.ok(entry.hit.center.hit);
  await clickPoint(dock, entry.hit.center);
  const pane = ".workflow-agent .chat-messages";
  const latest = ".workflow-agent .scroll-bottom";
  await wait(`document.querySelector('${pane} .chat-turn-notice')`);
  const row = { width, theme, pane, samples: [] };
  rows.push(row);
  const sample = async (stage) => {
    const reading = await ev(
      `opticalProbe.stableFrames(${position},'live subagent')`,
    );
    row.samples.push({ stage, ...reading });
    return reading;
  };
  const wheel = async (deltaY) => {
    const point = await run((s) => {
      const el = document.querySelector(s),
        r = el.getBoundingClientRect();
      // Stay inside the actual headless window as well as the emulated
      // viewport. A wheel over the far desktop center can reach the DOM
      // without scrolling. Use pane padding, clear of the sash and cards.
      const x =
          r.left +
          el.clientLeft +
          parseFloat(getComputedStyle(el).paddingLeft) / 2,
        y = r.top + Math.min(96, r.height / 4);
      if (document.elementFromPoint(x, y) !== el)
        throw Error("Subagent wheel obstructed");
      return { x, y };
    }, pane);
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      ...point,
      deltaX: 0,
      deltaY,
    });
  };
  const request = {
    kind: "workflow-transcript",
    id: liveDock.id,
    stepId: liveDock.steps[0].id,
  };
  const poll = async (stage, growth = 0) => {
    const held = await site.holdRead(request)();
    agentFeed.growth += growth;
    held.respond(false);
    await wait(
      `document.querySelector('${pane} .chat-turn-notice')?.textContent === 'Facet read ${String(agentFeed.sequence).padStart(4, "0")}'`,
    );
    return sample(stage);
  };
  const initial = await sample("initial");
  assert.ok(initial.gap < 1 && initial.scrollTop > 200);
  await wheel(-48);
  await wait(`(${position})().gap >= 47`);
  const near = await sample("wheel -48");
  assert.ok(Math.abs(near.gap - 48) < 1);
  for (let i = 1; i <= 2; ++i) {
    const response = await poll(`unchanged ${i}`);
    assert.equal(response.scrollHeight, near.scrollHeight);
    assert.equal(response.clientHeight, near.clientHeight);
    assert.equal(response.scrollTop, near.scrollTop);
    assert.ok(response.completedReads >= near.completedReads + i);
  }
  const followed = await poll("growth while following", 4);
  assert.ok(followed.scrollHeight > near.scrollHeight && followed.gap < 1);
  await wheel(-128);
  await wait(`document.querySelector('${latest}')`);
  const away = await sample("wheel away");
  assert.ok(away.gap >= 80);
  const head = `${pane} .toolcall .chead-main[aria-expanded="false"]`;
  const { hit } = await run(controlGeometry, head, false);
  assert.ok(hit.center.hit, "Disclosure not visible at the reading offset");
  await clickPoint(head, hit.center);
  await wait(
    `document.querySelector('${pane} .toolcall-output pre')?.textContent.startsWith('Retained layer.')`,
  );
  const expanded = await sample("expanded while away");
  assert.equal(expanded.scrollTop, away.scrollTop);
  assert.ok(expanded.scrollHeight > away.scrollHeight);
  const still = await poll("growth while away", 4);
  assert.ok(still.scrollHeight > expanded.scrollHeight);
  assert.equal(still.scrollTop, away.scrollTop);
  const control = await observeButton(
    "subagent Latest",
    latest,
    "Latest messages",
    false,
  );
  assert.ok(control.keyboardFocus);
  await press(" ", 32);
  await wait(`!document.querySelector('${latest}')`);
  assert.ok((await sample("keyboard Latest")).gap < 1);
  const resumed = await poll("growth after Latest", 4);
  assert.ok(resumed.scrollHeight > still.scrollHeight && resumed.gap < 1);
}
