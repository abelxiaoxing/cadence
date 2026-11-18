import assert from "node:assert/strict";
import { controlGeometry, readingPosition } from "./measure.mjs";

// Retain the actual card, rather than re-querying whichever .chead-main is
// first after the input. The marker is only in the disposable probe document.
const card = "[data-optical-tool]";
const button = `${card} .chead-main`;
function locate(route, name, path) {
  if (location.pathname + location.search + location.hash !== route)
    throw Error(`Wrong fixture route (expected ${route})`);
  const matches = [
    ...document.querySelectorAll(".chat-messages .toolcall"),
  ].filter(
    (el) =>
      el.querySelector(".toolcall-name")?.textContent === name &&
      el.querySelector(".toolcall-path")?.getAttribute("title") === path,
  );
  if (matches.length !== 1)
    throw Error(`${matches.length} matching cards: ${name} ${path}`);
  const el = matches[0];
  el.dataset.opticalTool = "";
  const head = el.querySelector(".chead-main");
  const events = [];
  for (const type of ["pointerdown", "click"])
    document.addEventListener(
      type,
      (e) => {
        events.push({
          type,
          tag: e.target.localName,
          classes: e.target.getAttribute("class"),
          onHead: head.contains(e.target),
          trusted: e.isTrusted,
        });
      },
      { once: true, capture: true },
    );
  opticalProbe.tool = () => ({
    events,
    expanded: head.isConnected
      ? head.getAttribute("aria-expanded")
      : "detached",
    turn: el.closest("[data-lazy-id]")?.dataset.lazyId,
    body: el.querySelector(".banner-notice")
      ? "error"
      : el.querySelector(".file-diff-card")
        ? "mutation"
        : el.querySelector(".toolcall-output pre")
          ? "output"
          : el.querySelector(".toolcall-body")
            ? "waiting"
            : "absent",
  });
}

// One real activation. A server response alone does not prove the lazy
// detail reached the view, and finding a rendered word alone doesn't prove
// that it came from the requested conversation-step.
export async function openTool({ ev, run, send, wait, site, row, route }) {
  const start = site.stepReads.length;
  const position = () =>
    ev(`opticalProbe.stableFrames(${readingPosition}, 'transcript')`);
  try {
    await run(locate, route, row.tool, row.path);
    const geometry = await run(controlGeometry, button, !row.position);
    row.before = await ev("opticalProbe.tool()");
    row.hit = geometry.hit;
    assert.equal(row.before.expanded, "false");
    assert.ok(row.before.turn);
    assert.ok(
      Object.values(geometry.hit).every((p) => p.hit),
      `Unreachable ${button}`,
    );
    if (row.position) {
      row.folded = await position();
      assert.ok(
        row.folded.anchor,
        "Missing visible reading anchor before expansion",
      );
      if (row.position === "bottom") assert.ok(row.folded.bottom < 3);
      else {
        assert.ok(row.folded.bottom > 80);
        assert.ok(
          row.folded.anchor.y < row.folded.headY,
          "Tool is not below reading anchor",
        );
      }
    }
    const { x, y } = geometry.hit.center;
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        clickCount: 1,
      });
    await wait(`opticalProbe.tool().expanded === 'true'`);
    await wait(
      `document.querySelector('${card} .toolcall-output pre')?.textContent.length > 0`,
    );
    const after = await ev("opticalProbe.tool()");
    assert.deepEqual(
      after.events.map((e) => [e.type, e.trusted && e.onHead]),
      [
        ["pointerdown", true],
        ["click", true],
      ],
    );
    assert.equal(after.expanded, "true");
    assert.ok(
      site.stepReads
        .slice(start)
        .some(
          (r) =>
            r.id === row.id &&
            r.turnId === row.before.turn &&
            r.step === 2 &&
            r.part === 0 &&
            r.result === row.tool,
        ),
      "No completed matching lazy read",
    );
    if (row.tool === "edit") {
      row.words = await ev(
        `Object.fromEntries([['.char-add','opal'],['.char-del','silver']].map(([s,word]) => [word, document.querySelector('${card} .file-diff-body ' + s)?.textContent === word]))`,
      );
      assert.deepEqual(row.words, { opal: true, silver: true });
    }
    if (row.position) {
      row.opened = await position();
      assert.ok(
        row.opened.scrollHeight > row.folded.scrollHeight,
        "No content growth",
      );
      assert.ok(
        row.opened.anchor,
        "Missing visible reading anchor after expansion",
      );
      if (row.position === "bottom")
        assert.ok(row.opened.bottom < 3, "Expansion lost bottom follow");
      else {
        assert.ok(
          Math.abs(row.opened.scrollTop - row.folded.scrollTop) < 1,
          "Expansion moved scrollTop",
        );
        assert.deepEqual(
          row.opened.anchor,
          row.folded.anchor,
          "Expansion moved reading anchor",
        );
      }
    }
  } finally {
    row.after = await ev("opticalProbe.tool?.() ?? null");
    row.reads = site.stepReads.slice(start);
  }
}
