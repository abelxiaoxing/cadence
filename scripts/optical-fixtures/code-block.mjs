import assert from "node:assert/strict";
import { controlGeometry } from "./measure.mjs";
import { readingCode, readingTurn } from "./records.mjs";

export const block = "[data-optical-code]";
export const foldButton = `${block} .code-caption button[aria-expanded]`;
export const copyButton = `${block} .code-caption .output-copy`;

// Keep the original references, even if the row disappears. A later block
// with identical text must not satisfy this disclosure's postcondition.
function locate(route, turnId, source) {
  if (location.pathname + location.search + location.hash !== route)
    throw Error(`Not on the reading route: ${route}`);
  const pane = document.querySelector(".chat-messages");
  const matches = [
    ...pane.querySelectorAll(".chat-turn .msg-assistant .codeblock"),
  ].filter(
    (el) =>
      el.closest("[data-lazy-id]")?.dataset.lazyId === turnId &&
      el.querySelector("pre")?.textContent === source &&
      el.querySelector(".code-caption [aria-expanded]")?.lastChild
        .textContent === "ts",
  );
  if (matches.length !== 1) throw Error(`${matches.length} matching ts blocks`);
  const el = matches[0],
    caption = el.querySelector(".code-caption"),
    pre = caption.nextElementSibling,
    button = caption.querySelector("[aria-expanded]");
  if (!pre.matches("pre")) throw Error("Missing adjacent pre");
  el.dataset.opticalCode = "";
  const word = document.createRange();
  word.selectNodeContents(pre.querySelector(".hljs-keyword")); // The opening const.
  const state = () => {
    const r = pre.getBoundingClientRect(),
      ink = word.getBoundingClientRect();
    return {
      turn: el.closest("[data-lazy-id]")?.dataset.lazyId,
      buttonConnected: button.isConnected,
      preConnected: pre.isConnected,
      connected:
        button.isConnected &&
        pre.isConnected &&
        el.isConnected &&
        caption.nextElementSibling === pre &&
        caption.contains(button),
      expanded: button.getAttribute("aria-expanded"),
      hidden: pre.hidden,
      preBox: r.toJSON(),
      visible:
        pre.checkVisibility() &&
        ink.width > 0 &&
        word.commonAncestorContainer.contains(
          document.elementFromPoint(
            ink.left + ink.width / 2,
            ink.top + ink.height / 2,
          ),
        ),
      rect: button.getBoundingClientRect().toJSON(),
      scrollTop: pane.scrollTop,
      bottom: pane.scrollHeight - pane.clientHeight - pane.scrollTop,
      scrollHeight: pane.scrollHeight,
      clientHeight: pane.clientHeight,
    };
  };
  const events = [],
    listeners = new AbortController();
  for (const type of ["pointerdown", "pointerup", "click"])
    document.addEventListener(
      type,
      (e) => {
        events.push({
          type,
          trusted: e.isTrusted,
          onButton: button.contains(e.target),
          target: `${e.target.localName}.${e.target.getAttribute("class") ?? ""}`,
          x: e.clientX,
          y: e.clientY,
          ...state(),
        });
      },
      { capture: true, signal: listeners.signal },
    );
  opticalProbe.code = { state, events, dispose: () => listeners.abort() };
}

export async function bindReadingCode(run, route) {
  await run(locate, route, readingTurn, readingCode);
}

function assertDisclosure(state, hidden) {
  assert.equal(state.connected, true, "Disconnected reading block");
  assert.equal(state.expanded, String(!hidden));
  assert.equal(state.hidden, hidden);
  assert.equal(state.visible, !hidden);
  assert.equal(state.preBox.height === 0, hidden);
}

// Never reposition in the activation path. Capture-phase facts distinguish
// a stale hit from a click handled on a subsequently detached disclosure.
export async function toggleReadingCode(
  { ev, run, press, clickPoint, wait },
  row,
) {
  const { hidden, keyboard } = row;
  const start = await ev("opticalProbe.code.events.length");
  try {
    row.before = await ev("opticalProbe.code.state()");
    row.geometry = await run(controlGeometry, foldButton, false);
    assertDisclosure(row.before, !hidden);
    if (row.position === "bottom") assert.ok(row.before.bottom < 2);
    if (row.position === "away") assert.ok(row.before.bottom > 80);
    const g = row.geometry;
    assert.deepEqual(g.visible, g.rect);
    assert.ok(Object.values(g.hit).every((p) => p.hit));
    if (keyboard) {
      assert.ok(
        await ev(
          `document.activeElement.matches(${JSON.stringify(`${foldButton}:focus-visible`)})`,
        ),
      );
      await press(" ", 32);
    } else await clickPoint(foldButton, g.hit.center);
    await wait(
      `(() => { const s=opticalProbe.code.state(); return s.connected && s.expanded==='${!hidden}' && s.hidden===${hidden} && s.visible===${!hidden} && (s.preBox.height===0)===${hidden}; })()`,
    );
    await ev(
      "opticalProbe.stableFrames(opticalProbe.code.state, 'code disclosure')",
    );
  } finally {
    row.after = await ev("opticalProbe.code.state()");
    row.events = await ev(`opticalProbe.code.events.slice(${start})`);
  }
  assertDisclosure(row.after, hidden);
  assert.deepEqual(
    row.events.map((e) => [e.type, e.trusted && e.onButton]),
    (keyboard ? ["click"] : ["pointerdown", "pointerup", "click"]).map(
      (type) => [type, true],
    ),
  );
}
