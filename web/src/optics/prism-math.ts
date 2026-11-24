/* Pure 3D optical geometry, quaternion trackball physics, refracted facet beam
 * projection and UI glass rim intersection math for the desktop new-conversation
 * Optical Prism Stage. Zero DOM or WebGL dependencies so every invariant is
 * directly unit-testable. */

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];
/** Column-major 3×3 rotation matrix suitable for WebGL uniformMatrix3fv. */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const PHI = (1 + Math.sqrt(5)) / 2;
const INV_PHI = 1 / PHI;
const INV_SQRT3 = 1 / Math.sqrt(3);

/** The 10 antipodal unit face normals of a regular 20-face icosahedron
 * (dual to the 20 dodecahedron vertices). Shared identically with the GLSL
 * raytracer so crystal facets, full-page caustic beams and UI rim glints lock
 * to the exact same 3D orientation. */
export const ICO_NORMALS: readonly Vec3[] = [
  [INV_SQRT3, INV_SQRT3, INV_SQRT3],
  [INV_SQRT3, INV_SQRT3, -INV_SQRT3],
  [INV_SQRT3, -INV_SQRT3, INV_SQRT3],
  [-INV_SQRT3, INV_SQRT3, INV_SQRT3],
  [0, INV_PHI * INV_SQRT3, PHI * INV_SQRT3],
  [0, -INV_PHI * INV_SQRT3, PHI * INV_SQRT3],
  [PHI * INV_SQRT3, 0, INV_PHI * INV_SQRT3],
  [-PHI * INV_SQRT3, 0, INV_PHI * INV_SQRT3],
  [INV_PHI * INV_SQRT3, PHI * INV_SQRT3, 0],
  [-INV_PHI * INV_SQRT3, PHI * INV_SQRT3, 0],
];

/** Key studio light direction (upper-left-front) used for refracted caustic
 * fan projection and crystal softbox lighting. */
export const KEY_LIGHT: Vec3 = normalize3([-0.34, 0.48, 0.81]);

/** Secondary cool studio fill direction (upper-right-front). */
export const FILL_LIGHT: Vec3 = normalize3([0.46, 0.28, 0.84]);

export interface PrismMotionState {
  /** Base 3D orientation quaternion [x, y, z, w]. */
  quat: [number, number, number, number];
  /** User-imparted rotational velocity (rad/s) around world X, Y, Z axes. */
  spinVel: [number, number, number];
  /** Spring-damped pointer tilt [pitchX, yawY] (rad). */
  tilt: [number, number];
  /** Spring velocity for pointer tilt [vx, vy] (rad/s). */
  tiltVel: [number, number];
  /** Normalized pointer offset [-1, 1] relative to crystal center. */
  pointer: [number, number];
  /** Whether the pointer is currently inside the window. */
  pointerActive: boolean;
  /** Whether the user is actively dragging the crystal. */
  dragging: boolean;
  /** Accumulated monotonic time (seconds) for gentle harmonic precession. */
  elapsed: number;
  /** Smoothed dark-mode factor (0 = Alabaster light, 1 = Obsidian dark). */
  dark: number;
  /** Smoothed composer focus/typing softening factor (0..1). */
  focusDim: number;
  /** Smoothed Cadence mode optical accent factor (0..1). */
  cadence: number;
  /** Smoothed entrance reveal factor (0..1). */
  reveal: number;
  /** Smoothed hover elevation over the crystal hit area (0..1). */
  hover: number;
}

export interface PrismMotionTargets {
  dark: number;
  focusDim: number;
  cadence: number;
  hover: number;
}

export interface RefractedBeam {
  /** Unit 2D screen direction (WebGL coordinates: +x right, +y up). */
  dx: number;
  dy: number;
  /** Smooth C-infinity continuous beam intensity (0..1). */
  intensity: number;
  /** Angular half-spread in radians. */
  spread: number;
}

export interface RectBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GlassRimHighlights {
  /** Horizontal percentage (0..100) along composer top rim. */
  composerX: number;
  /** Opacity/intensity (0..1) on composer top rim. */
  composerPower: number;
  /** Vertical percentage (0..100) along left sidebar right inner rim. */
  leftY: number;
  /** Opacity/intensity (0..1) on left sidebar inner rim. */
  leftPower: number;
  /** Vertical percentage (0..100) along right sidebar left inner rim. */
  rightY: number;
  /** Opacity/intensity (0..1) on right sidebar inner rim. */
  rightPower: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function normalizeQuat(
  q: readonly [number, number, number, number],
): [number, number, number, number] {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatFromAxisAngle(
  ax: number,
  ay: number,
  az: number,
  angle: number,
): [number, number, number, number] {
  const len = Math.hypot(ax, ay, az);
  if (len < 1e-8 || Math.abs(angle) < 1e-10) return [0, 0, 0, 1];
  const half = angle * 0.5;
  const s = Math.sin(half) / len;
  return [ax * s, ay * s, az * s, Math.cos(half)];
}

export function multiplyQuat(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Convert unit quaternion to column-major 3×3 rotation matrix. */
export function mat3FromQuat(q: Quat): Mat3 {
  const [x, y, z, w] = q;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    1 - 2 * (yy + zz),
    2 * (xy + wz),
    2 * (xz - wy),
    2 * (xy - wz),
    1 - 2 * (xx + zz),
    2 * (yz + wx),
    2 * (xz + wy),
    2 * (yz - wx),
    1 - 2 * (xx + yy),
  ];
}

/** Multiply two column-major 3×3 matrices (a * b). */
export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[3] * b[1] + a[6] * b[2],
    a[1] * b[0] + a[4] * b[1] + a[7] * b[2],
    a[2] * b[0] + a[5] * b[1] + a[8] * b[2],
    a[0] * b[3] + a[3] * b[4] + a[6] * b[5],
    a[1] * b[3] + a[4] * b[4] + a[7] * b[5],
    a[2] * b[3] + a[5] * b[4] + a[8] * b[5],
    a[0] * b[6] + a[3] * b[7] + a[6] * b[8],
    a[1] * b[6] + a[4] * b[7] + a[7] * b[8],
    a[2] * b[6] + a[5] * b[7] + a[8] * b[8],
  ];
}

/** Rotate a 3D vector by column-major 3×3 matrix M (M * v). */
export function transformVec3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

/** Build an initial sculptural pose where a crisp triangular facet faces slightly
 * forward-upward so the crystal immediately catches light on first paint. */
export function createPrismMotionState(
  initialDark = false,
  initialCadence = false,
): PrismMotionState {
  const qYaw = quatFromAxisAngle(0, 1, 0, 0.42);
  const qPitch = quatFromAxisAngle(1, 0, 0, -0.31);
  const qRoll = quatFromAxisAngle(0, 0, 1, 0.16);
  const quat = normalizeQuat(multiplyQuat(qRoll, multiplyQuat(qPitch, qYaw)));
  return {
    quat,
    spinVel: [0, 0, 0],
    tilt: [0, 0],
    tiltVel: [0, 0],
    pointer: [0, 0],
    pointerActive: false,
    dragging: false,
    elapsed: 0,
    dark: initialDark ? 1 : 0,
    focusDim: 0,
    cadence: initialCadence ? 1 : 0,
    reveal: 0,
    hover: 0,
  };
}

/** Apply an immediate trackball drag delta (in CSS pixels) while dragging the
 * crystal directly, and update smoothed release angular velocity. */
export function applyCrystalDrag(
  state: PrismMotionState,
  dxPx: number,
  dyPx: number,
  dtSec: number,
): void {
  const scale = 0.0115;
  const rotY = dxPx * scale;
  const rotX = dyPx * scale;
  const deltaQ = multiplyQuat(
    quatFromAxisAngle(0, 1, 0, rotY),
    quatFromAxisAngle(1, 0, 0, rotX),
  );
  state.quat = normalizeQuat(multiplyQuat(deltaQ, state.quat));
  const safeDt = clamp(dtSec, 0.004, 0.06);
  const instX = clamp(rotX / safeDt, -6.5, 6.5);
  const instY = clamp(rotY / safeDt, -6.5, 6.5);
  state.spinVel[0] = state.spinVel[0] * 0.45 + instX * 0.55;
  state.spinVel[1] = state.spinVel[1] * 0.45 + instY * 0.55;
  state.spinVel[2] = state.spinVel[2] * 0.7;
}

/** Apply a crisp, playful spin impulse (e.g. quick tap/click on crystal). */
export function applyCrystalTapImpulse(state: PrismMotionState): void {
  state.spinVel[0] = clamp(state.spinVel[0] + 0.52, -6.5, 6.5);
  state.spinVel[1] = clamp(state.spinVel[1] + 2.15, -6.5, 6.5);
  state.spinVel[2] = clamp(state.spinVel[2] + 0.25, -6.5, 6.5);
}

/** Inject a gentle momentum nudge from global mouse movement across the window. */
export function applyPointerMove(
  state: PrismMotionState,
  normX: number,
  normY: number,
): void {
  const nx = clamp(normX, -1.25, 1.25);
  const ny = clamp(normY, -1.25, 1.25);
  if (state.pointerActive && !state.dragging) {
    const dvx = nx - state.pointer[0];
    const dvy = ny - state.pointer[1];
    state.tiltVel[0] = clamp(state.tiltVel[0] + dvy * 1.4, -3.5, 3.5);
    state.tiltVel[1] = clamp(state.tiltVel[1] + dvx * 1.65, -3.5, 3.5);
    // Subtle rotational momentum transfer so brisk sweeps spin the light beams.
    state.spinVel[1] = clamp(state.spinVel[1] + dvx * 0.42, -3.2, 3.2);
    state.spinVel[0] = clamp(state.spinVel[0] + dvy * 0.3, -3.2, 3.2);
  }
  state.pointer[0] = nx;
  state.pointer[1] = ny;
  state.pointerActive = true;
}

/** Advance crystal rotation, spring-damped pointer steering, drag coasting and
 * smooth theme/focus transitions by `dtSec` seconds. */
export function stepPrismMotion(
  state: PrismMotionState,
  dtSec: number,
  targets: PrismMotionTargets,
): Mat3 {
  const dt = clamp(dtSec, 0, 0.05);
  state.elapsed += dt;

  // Smooth exponential transitions for theme, typing softening, Cadence accent & reveal.
  const easeFast = 1 - Math.exp(-dt * 8.5);
  const easeMed = 1 - Math.exp(-dt * 5.2);
  const easeReveal = 1 - Math.exp(-dt * 4.4);
  state.dark += (targets.dark - state.dark) * easeFast;
  state.focusDim += (targets.focusDim - state.focusDim) * easeMed;
  state.cadence += (targets.cadence - state.cadence) * easeMed;
  state.hover += (targets.hover - state.hover) * easeFast;
  state.reveal = Math.min(1, state.reveal + (1 - state.reveal) * easeReveal);

  // Serene continuous dual-axis 3D precession (slightly calmer while typing).
  if (!state.dragging) {
    const pace = 1 - state.focusDim * 0.16;
    const t = state.elapsed;
    const baseWx = (0.105 + 0.045 * Math.sin(t * 0.37)) * pace;
    const baseWy = (0.285 + 0.035 * Math.cos(t * 0.23)) * pace;
    const baseWz = 0.052 * Math.sin(t * 0.19 + 0.9) * pace;

    const wx = baseWx + state.spinVel[0];
    const wy = baseWy + state.spinVel[1];
    const wz = baseWz + state.spinVel[2];
    const speed = Math.hypot(wx, wy, wz);
    if (speed > 1e-6 && dt > 0) {
      const dq = quatFromAxisAngle(wx, wy, wz, speed * dt);
      state.quat = normalizeQuat(multiplyQuat(dq, state.quat));
    }

    // Viscous coasting decay for flick/sweep spin velocity.
    const decay = Math.exp(-dt * 1.85);
    state.spinVel[0] *= decay;
    state.spinVel[1] *= decay;
    state.spinVel[2] *= decay;
    if (Math.abs(state.spinVel[0]) < 1e-4) state.spinVel[0] = 0;
    if (Math.abs(state.spinVel[1]) < 1e-4) state.spinVel[1] = 0;
    if (Math.abs(state.spinVel[2]) < 1e-4) state.spinVel[2] = 0;
  }

  // Critically-damped spring steering from global pointer position.
  const hoverGain = 1 + state.hover * 0.22;
  const targetTiltX =
    state.pointerActive && !state.dragging
      ? clamp(state.pointer[1], -1, 1) * 0.34 * hoverGain
      : 0;
  const targetTiltY =
    state.pointerActive && !state.dragging
      ? clamp(state.pointer[0], -1, 1) * 0.42 * hoverGain
      : 0;
  const stiffness = 26;
  const damping = 9.4;
  for (let axis = 0; axis < 2; axis++) {
    const target = axis === 0 ? targetTiltX : targetTiltY;
    const disp = state.tilt[axis] - target;
    const acc = -stiffness * disp - damping * state.tiltVel[axis];
    state.tiltVel[axis] += acc * dt;
    state.tilt[axis] += state.tiltVel[axis] * dt;
  }

  return computePrismRotationMatrix(state);
}

/** Compose the final column-major 3×3 orientation matrix from base quaternion
 * and spring-damped pointer tilt. */
export function computePrismRotationMatrix(state: PrismMotionState): Mat3 {
  const base = mat3FromQuat(state.quat);
  const cx = Math.cos(state.tilt[0]);
  const sx = Math.sin(state.tilt[0]);
  const cy = Math.cos(state.tilt[1]);
  const sy = Math.sin(state.tilt[1]);
  const rx: Mat3 = [1, 0, 0, 0, cx, sx, 0, -sx, cx];
  const ry: Mat3 = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  return multiplyMat3(ry, multiplyMat3(rx, base));
}

/** Compute the 10 smooth, C-infinity continuous refracted caustic light fans
 * emitted by the 10 antipodal icosahedron facet pairs for the current 3D
 * orientation. Alternating pairs emit primary refracted exit fans (opposite
 * the incoming key light, sweeping downward-right & across the UI) and
 * reflected/dispersed upper fans so the whole stage stays balanced and alive
 * across all 360 degrees. Used identically by the WebGL2 light field AND the
 * UI glass rim highlight projector. */
export function projectRefractedBeams(rot: Mat3, cadence = 0): RefractedBeam[] {
  const beams: RefractedBeam[] = new Array(ICO_NORMALS.length);
  for (let i = 0; i < ICO_NORMALS.length; i++) {
    const n = transformVec3(rot, ICO_NORMALS[i]);
    const keyAlign = dot3(n, KEY_LIGHT);
    // Half the antipodal pairs represent refracted exit facets (transmitting
    // light through the crystal to the far side), half represent primary
    // grazing reflection/dispersion facets — giving authentic asymmetric
    // opposing caustic fans like a real cut prism in sunlight.
    const transmit = i % 2 === 0 ? -1 : 1;
    const sign = (keyAlign >= 0 ? 1 : -1) * transmit;
    const nx = n[0] * sign;
    const ny = n[1] * sign;
    const nz = n[2] * sign;

    const litKey = Math.abs(keyAlign);
    const litFill = Math.abs(dot3(n, FILL_LIGHT));

    // Snell-bent 2D projection direction.
    const bend = transmit < 0 ? 0.32 : -0.18;
    const rx = nx * 1.15 - KEY_LIGHT[0] * bend;
    const ry = ny * 1.15 - KEY_LIGHT[1] * bend;
    const xyLen = Math.hypot(rx, ry);
    const dx = xyLen > 1e-5 ? rx / xyLen : 1;
    const dy = xyLen > 1e-5 ? ry / xyLen : 0;

    // Smooth continuous visibility envelope (zero abrupt switching).
    const radialReach = smoothstep(0.18, 0.85, xyLen);
    const grazingBand = 1 - 0.52 * smoothstep(0.62, 0.98, Math.abs(nz));
    const lightCatch =
      smoothstep(0.1, 0.82, litKey) * 0.72 +
      smoothstep(0.18, 0.88, litFill) * 0.36;
    const primaryBoost = i < 6 ? 1.0 : 0.72;
    const intensity = clamp(
      radialReach *
        grazingBand *
        lightCatch *
        primaryBoost *
        (0.95 + cadence * 0.14),
      0,
      1,
    );

    // Rich architectural caustic fan width (broad silk fan + crisp inner rays).
    const spread = 0.18 + 0.16 * (1 - radialReach) + 0.05 * Math.abs(nz);
    beams[i] = { dx, dy, intensity, spread };
  }
  return beams;
}

/** Pack the 10 refracted beams into a Float32Array(40) for `uniform vec4 uBeams[10]`. */
export function packBeamsUniform(
  beams: readonly RefractedBeam[],
  out: Float32Array,
): Float32Array {
  for (let i = 0; i < 10; i++) {
    const b = beams[i];
    const base = i * 4;
    if (b) {
      out[base] = b.dx;
      out[base + 1] = b.dy;
      out[base + 2] = b.intensity;
      out[base + 3] = b.spread;
    } else {
      out[base] = 1;
      out[base + 1] = 0;
      out[base + 2] = 0;
      out[base + 3] = 0.2;
    }
  }
  return out;
}

/** Intersect the live refracted crystal beams with the desktop UI glass edges
 * (composer top border, left sidebar right inner border, right sidebar left
 * inner border) in CSS pixel coordinates (origin top-left, +y downward). */
export function projectGlassRimHighlights(
  beams: readonly RefractedBeam[],
  crystalCenterCss: Vec2,
  targets: {
    composer: RectBox | null;
    leftSidebar: RectBox | null;
    rightSidebar: RectBox | null;
  },
  intensityScale = 1,
): GlassRimHighlights {
  const [cx, cy] = crystalCenterCss;
  const scale = clamp(intensityScale, 0, 1.5);

  let composerWeightSum = 0;
  let composerPosSum = 0;
  let composerPeak = 0;

  let leftWeightSum = 0;
  let leftPosSum = 0;
  let leftPeak = 0;

  let rightWeightSum = 0;
  let rightPosSum = 0;
  let rightPeak = 0;

  for (const beam of beams) {
    if (beam.intensity <= 0.01) continue;
    // Convert WebGL (+y up) direction to DOM CSS (+y down) direction.
    const bx = beam.dx;
    const by = -beam.dy;

    // 1. Composer top glass rim: horizontal line y = composer.top
    if (targets.composer && targets.composer.width > 0 && by > 0.12) {
      const dyToRim = targets.composer.top - cy;
      if (dyToRim > 8) {
        const t = dyToRim / by;
        const hitX = cx + bx * t;
        const u = (hitX - targets.composer.left) / targets.composer.width;
        if (u > -0.25 && u < 1.25) {
          const edgeFade =
            smoothstep(-0.25, 0.08, u) * smoothstep(1.25, 0.92, u);
          const distAtten = 1 / (1 + t * 0.0014);
          const w = beam.intensity * edgeFade * distAtten * by;
          composerWeightSum += w;
          composerPosSum += clamp(u, 0.04, 0.96) * w;
          if (w > composerPeak) composerPeak = w;
        }
      }
    }

    // 2. Left sidebar inner right glass rim: vertical line x = left.left + left.width
    if (targets.leftSidebar && targets.leftSidebar.height > 0 && bx < -0.15) {
      const rimX = targets.leftSidebar.left + targets.leftSidebar.width;
      const dxToRim = rimX - cx;
      if (dxToRim < -8) {
        const t = dxToRim / bx;
        const hitY = cy + by * t;
        const v = (hitY - targets.leftSidebar.top) / targets.leftSidebar.height;
        if (v > -0.2 && v < 1.2) {
          const edgeFade = smoothstep(-0.2, 0.08, v) * smoothstep(1.2, 0.92, v);
          const distAtten = 1 / (1 + t * 0.0011);
          const w = beam.intensity * edgeFade * distAtten * -bx;
          leftWeightSum += w;
          leftPosSum += clamp(v, 0.06, 0.94) * w;
          if (w > leftPeak) leftPeak = w;
        }
      }
    }

    // 3. Right sidebar inner left glass rim: vertical line x = right.left
    if (targets.rightSidebar && targets.rightSidebar.height > 0 && bx > 0.15) {
      const dxToRim = targets.rightSidebar.left - cx;
      if (dxToRim > 8) {
        const t = dxToRim / bx;
        const hitY = cy + by * t;
        const v =
          (hitY - targets.rightSidebar.top) / targets.rightSidebar.height;
        if (v > -0.2 && v < 1.2) {
          const edgeFade = smoothstep(-0.2, 0.08, v) * smoothstep(1.2, 0.92, v);
          const distAtten = 1 / (1 + t * 0.0011);
          const w = beam.intensity * edgeFade * distAtten * bx;
          rightWeightSum += w;
          rightPosSum += clamp(v, 0.06, 0.94) * w;
          if (w > rightPeak) rightPeak = w;
        }
      }
    }
  }

  return {
    composerX:
      composerWeightSum > 1e-4
        ? (composerPosSum / composerWeightSum) * 100
        : 50,
    composerPower: clamp(
      (composerPeak * 0.9 + composerWeightSum * 0.35) * scale,
      0,
      1,
    ),
    leftY: leftWeightSum > 1e-4 ? (leftPosSum / leftWeightSum) * 100 : 44,
    leftPower: clamp((leftPeak * 0.95 + leftWeightSum * 0.38) * scale, 0, 1),
    rightY: rightWeightSum > 1e-4 ? (rightPosSum / rightWeightSum) * 100 : 44,
    rightPower: clamp((rightPeak * 0.95 + rightWeightSum * 0.38) * scale, 0, 1),
  };
}
