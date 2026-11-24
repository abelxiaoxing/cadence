// Unit and SSR tests for the desktop new-conversation Optical Prism Stage:
// polyhedron geometry, quaternion trackball physics, C-infinity continuous
// refracted beam projection, UI glass rim intersection math, and SSR fallback.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatWelcome } from "../../web/src/components/workspace/ChatWelcome";
import {
  applyCrystalDrag,
  applyCrystalTapImpulse,
  applyPointerMove,
  computePrismRotationMatrix,
  createPrismMotionState,
  dot3,
  ICO_NORMALS,
  packBeamsUniform,
  projectGlassRimHighlights,
  projectRefractedBeams,
  stepPrismMotion,
} from "../../web/src/optics/prism-math";
import {
  PRISM_FRAGMENT_SHADER,
  PRISM_VERTEX_SHADER,
} from "../../web/src/optics/prism-shader";

describe("Optical Prism Stage geometry and physics", () => {
  it("defines 10 exact unit antipodal face normals for a regular 20-face icosahedron", () => {
    expect(ICO_NORMALS).toHaveLength(10);
    for (const n of ICO_NORMALS) {
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 10);
    }
    // Check an exact icosahedron vertex v = (0, phi, 1): 5 adjacent face planes
    // must attain the exact same maximal dot product phi^2 / sqrt(3).
    const phi = (1 + Math.sqrt(5)) / 2;
    const expected = (phi * phi) / Math.sqrt(3);
    const v = [0, phi, 1] as const;
    const projections = ICO_NORMALS.map((n) => Math.abs(dot3(n, v)));
    const maxHits = projections.filter((p) => Math.abs(p - expected) < 1e-9);
    expect(maxHits).toHaveLength(5);
    expect(Math.max(...projections)).toBeCloseTo(expected, 10);
  });

  it("rotates continuously by default, keeps unit quaternions, and calms slightly when typing", () => {
    const idle = createPrismMotionState(false, false);
    const typing = createPrismMotionState(false, false);
    const q0 = [...idle.quat];

    for (let i = 0; i < 60; i++) {
      stepPrismMotion(idle, 1 / 60, {
        dark: 0,
        focusDim: 0,
        cadence: 0,
        hover: 0,
      });
      stepPrismMotion(typing, 1 / 60, {
        dark: 0,
        focusDim: 1,
        cadence: 0,
        hover: 0,
      });
    }

    const qLen = Math.hypot(...idle.quat);
    expect(qLen).toBeCloseTo(1, 6);
    // Orientation advances noticeably over 1 second of default rotation.
    const dotIdle =
      idle.quat[0] * q0[0] +
      idle.quat[1] * q0[1] +
      idle.quat[2] * q0[2] +
      idle.quat[3] * q0[3];
    const dotTyping =
      typing.quat[0] * q0[0] +
      typing.quat[1] * q0[1] +
      typing.quat[2] * q0[2] +
      typing.quat[3] * q0[3];
    expect(Math.abs(dotIdle)).toBeLessThan(0.99);
    // Typing softens beam luminance and reduces rotational angle traveled.
    expect(typing.focusDim).toBeGreaterThan(0.95);
    expect(Math.abs(dotTyping)).toBeGreaterThan(Math.abs(dotIdle));
    expect(idle.reveal).toBeGreaterThan(0.95);
  });

  it("steers smoothly with spring damping on pointer move and rebounds on pointer leave", () => {
    const state = createPrismMotionState(false, false);
    applyPointerMove(state, 0.85, -0.5);
    for (let i = 0; i < 45; i++) {
      stepPrismMotion(state, 1 / 60, {
        dark: 0,
        focusDim: 0,
        cadence: 0,
        hover: 0,
      });
    }
    expect(state.tilt[1]).toBeGreaterThan(0.2);
    expect(state.tilt[0]).toBeLessThan(-0.1);

    // Leaving the window smoothly returns tilt near neutral.
    state.pointerActive = false;
    for (let i = 0; i < 120; i++) {
      stepPrismMotion(state, 1 / 60, {
        dark: 0,
        focusDim: 0,
        cadence: 0,
        hover: 0,
      });
    }
    expect(Math.abs(state.tilt[0])).toBeLessThan(0.02);
    expect(Math.abs(state.tilt[1])).toBeLessThan(0.02);
  });

  it("supports direct 360-degree drag, tap impulse, and viscous coasting decay", () => {
    const state = createPrismMotionState(true, true);
    state.dragging = true;
    applyCrystalDrag(state, 48, -18, 0.016);
    expect(Math.abs(state.spinVel[1])).toBeGreaterThan(1);
    expect(Math.hypot(...state.quat)).toBeCloseTo(1, 6);

    state.dragging = false;
    const peakSpin = Math.hypot(...state.spinVel);
    for (let i = 0; i < 90; i++) {
      stepPrismMotion(state, 1 / 60, {
        dark: 1,
        focusDim: 0,
        cadence: 1,
        hover: 0,
      });
    }
    expect(Math.hypot(...state.spinVel)).toBeLessThan(peakSpin * 0.12);

    applyCrystalTapImpulse(state);
    expect(state.spinVel[1]).toBeGreaterThan(1.5);
  });

  it("projects 10 smooth unit-vector refracted beams and packs uniforms cleanly", () => {
    const state = createPrismMotionState(false, false);
    let prev = projectRefractedBeams(computePrismRotationMatrix(state), 0);
    expect(prev).toHaveLength(10);

    for (let step = 0; step < 30; step++) {
      const rot = stepPrismMotion(state, 1 / 60, {
        dark: 0,
        focusDim: 0,
        cadence: 0,
        hover: 0,
      });
      const next = projectRefractedBeams(rot, state.cadence);
      for (let i = 0; i < 10; i++) {
        expect(Math.hypot(next[i].dx, next[i].dy)).toBeCloseTo(1, 6);
        expect(next[i].intensity).toBeGreaterThanOrEqual(0);
        expect(next[i].intensity).toBeLessThanOrEqual(1);
        // No abrupt intensity jumps between consecutive 60fps frames.
        expect(Math.abs(next[i].intensity - prev[i].intensity)).toBeLessThan(
          0.08,
        );
      }
      prev = next;
    }

    const packed = packBeamsUniform(prev, new Float32Array(40));
    expect(packed).toHaveLength(40);
    expect(packed.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("projects refracted beams accurately onto composer top and sidebar inner glass rims", () => {
    // 3 explicit test beams in WebGL (+y up) coords:
    // 1) Downward-right toward composer top rim (+x=0.35, +y=-0.936 -> DOM by=+0.936)
    // 2) Leftward toward left sidebar inner edge (-x=-0.98, +y=0.2 -> DOM by=-0.2)
    // 3) Rightward toward right sidebar inner edge (+x=0.98, +y=-0.2 -> DOM by=+0.2)
    const beams = [
      { dx: 0.35, dy: -0.9367, intensity: 0.9, spread: 0.14 },
      { dx: -0.98, dy: 0.199, intensity: 0.85, spread: 0.14 },
      { dx: 0.98, dy: -0.199, intensity: 0.85, spread: 0.14 },
    ];
    const rims = projectGlassRimHighlights(
      beams,
      [720, 320],
      {
        composer: { left: 420, top: 520, width: 600, height: 110 },
        leftSidebar: { left: 10, top: 48, width: 250, height: 800 },
        rightSidebar: { left: 1180, top: 48, width: 250, height: 800 },
      },
      1,
    );
    // Downward-right beam hits right of composer center (> 50%).
    expect(rims.composerX).toBeGreaterThan(55);
    expect(rims.composerX).toBeLessThan(80);
    expect(rims.composerPower).toBeGreaterThan(0.4);
    // Left beam angled slightly upward hits above crystal center (< 35% down sidebar).
    expect(rims.leftY).toBeGreaterThan(10);
    expect(rims.leftY).toBeLessThan(35);
    expect(rims.leftPower).toBeGreaterThan(0.4);
    // Right beam angled slightly downward hits below crystal center (> 40% down sidebar).
    expect(rims.rightY).toBeGreaterThan(40);
    expect(rims.rightY).toBeLessThan(70);
    expect(rims.rightPower).toBeGreaterThan(0.4);

    // Collapsed sidebars emit zero rim intensity.
    const noPanels = projectGlassRimHighlights(
      beams,
      [720, 320],
      { composer: null, leftSidebar: null, rightSidebar: null },
      1,
    );
    expect(noPanels.composerPower).toBe(0);
    expect(noPanels.leftPower).toBe(0);
    expect(noPanels.rightPower).toBe(0);
  });

  it("ships valid GLSL ES 3.00 shader sources with 10-normal prism and spectral dispersion", () => {
    expect(PRISM_VERTEX_SHADER).toContain("#version 300 es");
    expect(PRISM_FRAGMENT_SHADER).toContain("#version 300 es");
    expect(PRISM_FRAGMENT_SHADER).toContain("uniform vec4 uBeams[10]");
    expect(PRISM_FRAGMENT_SHADER).toContain("const vec3 ICO_N[10]");
    expect(PRISM_FRAGMENT_SHADER).toContain("const vec3 SPECTRA[5]");
    expect(PRISM_FRAGMENT_SHADER).toContain("hitInnerCore");
    // Guard against GLSL ES 3.00 strictness pitfalls in shader code (ignoring comments):
    // no pow(..., 2.0) on signed values (NaN on real GPUs) and explicit float() cast on int modulo.
    const glslCode = PRISM_FRAGMENT_SHADER.replace(/\/\/[^\n]*/g, "");
    expect(glslCode).not.toMatch(/pow\([^)]*,\s*2\.0\)/);
    expect(glslCode).not.toMatch(
      /(?<!float)\(\(i\s*%\s*\d+\)[^)]*\)\s*\*\s*\d+\./,
    );
    expect(glslCode).not.toContain("uResolution");
    expect(glslCode).not.toContain("uTime");
  });

  it("keeps desktop inspector-overlay positioning intact in prism-stage.css", () => {
    const css = readFileSync(
      new URL("../../web/src/optics/prism-stage.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain(":not(.inspector-overlay)");
    expect(css).not.toContain("--prism-rim-halo");
  });
});

describe("ChatWelcome PrismStage SSR fallback", () => {
  it("renders static Crystal fallback without canvas, button or heading during SSR", () => {
    const html = renderToStaticMarkup(
      <ChatWelcome prism={{ active: true, cadence: false }} />,
    );
    expect(html).toContain("chat-welcome");
    expect(html).toContain('class="empty-logo prism-crystal-slot"');
    expect(html).toContain("<svg");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<h2");
  });

  it("keeps compact empty-logo when prism is omitted (mobile and folder setup)", () => {
    const html = renderToStaticMarkup(<ChatWelcome hint="Folder setup." />);
    expect(html).toContain('class="empty-logo"');
    expect(html).not.toContain("prism-crystal-slot");
    expect(html).toContain("Folder setup.");
  });
});
