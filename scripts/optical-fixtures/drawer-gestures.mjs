import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

// Read used geometry and the painted scrim's computed opacity, not just the
// custom properties/inline styles the app wrote. A closed parked pane has no box.
function sample(side) {
  const pane = document.querySelector(`.panel-drawer.drawer-${side}`);
  const scrim = document.querySelector(".drawer-backdrop.persistent");
  const toggle = document.querySelector(
    side === "left" ? ".navigation-toggle" : ".inspector-toggle",
  );
  return opticalProbe.stableFrames(() => {
    const rect = pane.getBoundingClientRect();
    return {
      width: rect.width,
      left: rect.left,
      offset: new DOMMatrixReadOnly(
        getComputedStyle(pane).transform === "none"
          ? undefined
          : getComputedStyle(pane).transform,
      ).m41,
      opacity: Number(getComputedStyle(scrim).opacity),
      dragging: pane.matches(".drawer-dragging"),
      inline: !!(pane.style.transform || scrim.style.opacity),
      open: pane.matches(".open"),
      expanded: toggle.getAttribute("aria-expanded"),
      inert: pane.inert,
    };
  }, `${side} drawer`);
}

export async function observeGestures({ run, send, width, theme, rows }) {
  await send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  try {
    for (const side of ["left", "right"]) {
      const left = side === "left";
      const expectedWidth = left
        ? Math.min(300, width * 0.86)
        : Math.min(380, width * 0.92);
      const checkRest = (state, open) => {
        assert.equal(state.open, open);
        assert.equal(state.expanded, String(open));
        assert.equal(state.inert, !open);
        assert.equal(state.opacity, Number(open));
        assert.equal(state.dragging || state.inline, false);
        assert.ok(Math.abs(state.width - (open ? expectedWidth : 0)) < 0.02);
        if (open) assert.equal(state.offset, 0);
      };
      const drag = async (pull, wasOpen, cancel, expectOpen) => {
        checkRest(await run(sample, side), wasOpen);
        const start = left !== wasOpen ? 24 : width - 24;
        const y = await run((x) => {
          const root = document.querySelector(".layout");
          const r = root.getBoundingClientRect();
          const y = Math.floor(r.top + r.height / 2);
          if (!root.contains(document.elementFromPoint(x, y)))
            throw Error("Unreachable touch origin");
          return y;
        }, start);
        const touch = (type, x) =>
          send("Input.dispatchTouchEvent", {
            type,
            touchPoints: x === undefined ? [] : [{ x, y, id: 1 }],
          });
        await touch("touchStart", start);
        const t = performance.now();
        await touch(
          "touchMove",
          start + (left ? 1 : -1) * Math.trunc(pull / 2),
        );
        // Deliberately exceed the 320ms flick window, not a race with a render.
        await sleep(350);
        await touch("touchMove", start + (left ? pull : -pull));
        const held = await run(sample, side);
        assert.equal(held.dragging, true);
        assert.equal(held.open, wasOpen);
        assert.ok(Math.abs(held.width - expectedWidth) < 0.02);
        const travel = held.width * 1.05;
        const progress = (wasOpen ? 1 : 0) + pull / travel;
        const offset = (left ? -1 : 1) * (1 - progress) * travel;
        assert.ok(
          Math.abs(held.offset - offset) < 0.03,
          `Wrong ${side} translation: ${JSON.stringify(held)}`,
        );
        assert.ok(
          Math.abs(held.left - ((left ? 0 : width - held.width) + offset)) <
            0.05,
        );
        assert.ok(
          Math.abs(held.opacity - progress) < 0.001,
          `Wrong ${side} scrim: ${held.opacity} vs ${progress}`,
        );
        const durationMs = Math.round(performance.now() - t);
        assert.ok(durationMs > 320);
        await touch(cancel ? "touchCancel" : "touchEnd");
        const after = await run(sample, side);
        rows.push({
          width,
          theme,
          side,
          start,
          y,
          pull,
          durationMs,
          wasOpen,
          cancel,
          held,
          after,
        });
        checkRest(after, expectOpen);
      };
      // Beyond the left commit point at 390px (126px), below the right one.
      if (!left && width === 390) await drag(138, false, false, false);
      await drag(168, false, true, false);
      await drag(168, false, false, true);
      await drag(-245, true, false, false);
    }
  } finally {
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
}
