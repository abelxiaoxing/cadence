/* Native WebGL2 GLSL 300 es Optical Prism Stage shaders.
 * Renders a single unified full-viewport optical scene:
 *  - Exact analytic ray-convex-polyhedron refraction for a 20-face regular
 *    icosahedron with a nested faceted inner crystal core, 3-wavelength Cauchy
 *    chromatic dispersion, total internal reflection bounces, and hairline
 *    chamfered dihedral bevel highlights.
 *  - Full-viewport layered architectural caustic light fans emerging from the
 *    rotated crystal facets with subtle real optical prism micro-rainbow
 *    chromatic dispersion, calibrated distinctly for Mineral Alabaster (light)
 *    and Obsidian Optical (dark). Zero external libraries or textures. */

export const PRISM_VERTEX_SHADER = `#version 300 es
precision highp float;

void main() {
  vec2 pos = vec2(
    (gl_VertexID == 1) ? 3.0 : -1.0,
    (gl_VertexID == 2) ? 3.0 : -1.0
  );
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

export const PRISM_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uCenter;
uniform float uRadius;
uniform mat3 uRot;
uniform vec4 uBeams[10];
uniform float uDark;
uniform float uFocusDim;
uniform float uCadence;
uniform float uReveal;
uniform float uHover;

out vec4 fragColor;

const float INV_S3 = 0.57735026919;
const float PHI_S3 = 0.93417235896;     // phi / sqrt(3)
const float INV_PHI_S3 = 0.35682208977; // (1/phi) / sqrt(3)

// 10 antipodal unit face normals of a regular 20-face icosahedron (inradius 1.0).
const vec3 ICO_N[10] = vec3[10](
  vec3( INV_S3,  INV_S3,  INV_S3),
  vec3( INV_S3,  INV_S3, -INV_S3),
  vec3( INV_S3, -INV_S3,  INV_S3),
  vec3(-INV_S3,  INV_S3,  INV_S3),
  vec3( 0.0,  INV_PHI_S3,  PHI_S3),
  vec3( 0.0, -INV_PHI_S3,  PHI_S3),
  vec3( PHI_S3,  0.0,  INV_PHI_S3),
  vec3(-PHI_S3,  0.0,  INV_PHI_S3),
  vec3( INV_PHI_S3,  PHI_S3,  0.0),
  vec3(-INV_PHI_S3,  PHI_S3,  0.0)
);

// 4 antipodal face normals of an inner nested regular octahedron core.
const vec3 CORE_N[4] = vec3[4](
  vec3( INV_S3,  INV_S3,  INV_S3),
  vec3( INV_S3,  INV_S3, -INV_S3),
  vec3( INV_S3, -INV_S3,  INV_S3),
  vec3(-INV_S3,  INV_S3,  INV_S3)
);

// Pre-normalized unit studio light vectors (strict GLSL ES 3.00 const safety).
const vec3 KEY_LIGHT  = vec3(-0.339522,  0.479325,  0.808861);
const vec3 FILL_LIGHT = vec3( 0.460977,  0.280595,  0.841784);
const vec3 RIM_LIGHT  = vec3( 0.180491, -0.621691, -0.762073);

// Safe squaring helper: GLSL ES pow(x, 2.0) is undefined (NaN) for x < 0.
float sq(float x) {
  return x * x;
}

struct PolyHit {
  bool hit;
  float tEnter;
  float tExit;
  vec3 nEnter;
  vec3 nExit;
  int faceEnter;
  int faceExit;
};

// Exact analytic ray intersection with unit-inradius regular icosahedron.
PolyHit hitIcosahedron(vec3 ro, vec3 rd) {
  float tMin = -1e5;
  float tMax = 1e5;
  vec3 nMin = vec3(0.0);
  vec3 nMax = vec3(0.0);
  int fMin = -1;
  int fMax = -1;

  for (int i = 0; i < 10; i++) {
    vec3 n = ICO_N[i];
    float o = dot(ro, n);
    float d = dot(rd, n);
    if (abs(d) < 1e-6) {
      if (abs(o) > 1.0) {
        return PolyHit(false, 0.0, 0.0, vec3(0.0), vec3(0.0), -1, -1);
      }
      continue;
    }
    float invD = 1.0 / d;
    float t1 = (-1.0 - o) * invD;
    float t2 = ( 1.0 - o) * invD;
    float sNear = d > 0.0 ? -1.0 : 1.0;
    float tNear = min(t1, t2);
    float tFar  = max(t1, t2);
    if (tNear > tMin) {
      tMin = tNear;
      nMin = n * sNear;
      fMin = i;
    }
    if (tFar < tMax) {
      tMax = tFar;
      nMax = n * (-sNear);
      fMax = i;
    }
    if (tMin > tMax) {
      return PolyHit(false, 0.0, 0.0, vec3(0.0), vec3(0.0), -1, -1);
    }
  }
  return PolyHit(tMax > 0.0 && tMin < tMax, tMin, tMax, nMin, nMax, fMin, fMax);
}

// Distance from a surface point on the icosahedron to the nearest dihedral ridge.
float icosahedronEdgeDist(vec3 p, int excludeFace) {
  float minGap = 1.0;
  for (int i = 0; i < 10; i++) {
    if (i == excludeFace) continue;
    float gap = 1.0 - abs(dot(p, ICO_N[i]));
    minGap = min(minGap, gap);
  }
  return max(minGap, 0.0);
}

// Exact analytic intersection with a nested rotated inner crystal core
// (radius 0.56) that creates layered jewel chambers inside the outer prism.
struct CoreHit {
  bool hit;
  float tEnter;
  vec3 nEnter;
  float edgeDist;
};

CoreHit hitInnerCore(vec3 ro, vec3 rd) {
  // Exact orthonormal rotation (Ry(0.39) * Rx(-0.26) * Rz(0.23)).
  const mat3 coreTilt = mat3(
     0.878271,  0.220315, -0.424384,
    -0.306024,  0.940941, -0.144840,
     0.367410,  0.257081,  0.893823
  );
  vec3 r = coreTilt * ro;
  vec3 d = coreTilt * rd;
  float rad = 0.56;
  float tMin = -1e5;
  float tMax = 1e5;
  vec3 nMin = vec3(0.0);
  int fMin = -1;

  for (int i = 0; i < 4; i++) {
    vec3 n = CORE_N[i];
    float o = dot(r, n);
    float dv = dot(d, n);
    if (abs(dv) < 1e-6) {
      if (abs(o) > rad) return CoreHit(false, 0.0, vec3(0.0), 1.0);
      continue;
    }
    float invD = 1.0 / dv;
    float t1 = (-rad - o) * invD;
    float t2 = ( rad - o) * invD;
    float sNear = dv > 0.0 ? -1.0 : 1.0;
    float tNear = min(t1, t2);
    float tFar  = max(t1, t2);
    if (tNear > tMin) {
      tMin = tNear;
      nMin = n * sNear;
      fMin = i;
    }
    if (tFar < tMax) tMax = tFar;
    if (tMin > tMax) return CoreHit(false, 0.0, vec3(0.0), 1.0);
  }

  if (tMin <= 0.002 || tMin >= tMax) {
    return CoreHit(false, 0.0, vec3(0.0), 1.0);
  }
  vec3 hitP = r + d * tMin;
  float minGap = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i == fMin) continue;
    minGap = min(minGap, rad - abs(dot(hitP, CORE_N[i])));
  }
  vec3 worldN = transpose(coreTilt) * nMin;
  return CoreHit(true, tMin, normalize(worldN), max(minGap, 0.0));
}

// High-contrast architectural optical studio environment map: crisp softbox
// planes + clean sapphire-slate contrast ribbons so every flat crystal facet
// reads as flawless sculpted crown glass in both Alabaster and Obsidian themes.
vec3 sampleStudioEnv(vec3 dir, float dark, float cadence) {
  vec3 d = normalize(dir);
  float y = d.y;

  // --- Mineral Alabaster studio (Style 1 crystal look) ---
  vec3 lightZenith  = vec3(0.995, 0.998, 1.00);
  vec3 lightSilver  = mix(vec3(0.84, 0.89, 0.97), vec3(0.76, 0.84, 0.98), cadence);
  vec3 lightCobalt  = mix(vec3(0.09, 0.19, 0.45), vec3(0.08, 0.22, 0.58), cadence);
  vec3 lightFloor   = vec3(0.95, 0.97, 1.00);

  float horizonBand = exp(-sq((y + 0.08) / 0.24));
  float sapphireCard = smoothstep(0.32, 0.62, d.x * 0.64 - y * 0.56 - d.z * 0.52);
  float sapphireCardB = smoothstep(0.45, 0.78, -d.x * 0.58 - y * 0.62 + d.z * 0.32);

  vec3 envLight = mix(lightFloor, lightZenith, smoothstep(-0.32, 0.45, y));
  envLight = mix(envLight, lightSilver, horizonBand * 0.55);
  envLight = mix(envLight, lightCobalt, clamp(sapphireCard * 0.86 + sapphireCardB * 0.62, 0.0, 0.92));

  float keyBox = smoothstep(0.62, 0.76, dot(d, KEY_LIGHT));
  float fillBox = smoothstep(0.72, 0.86, dot(d, FILL_LIGHT));
  float rimStrip = exp(-sq((dot(d, RIM_LIGHT) - 0.80) / 0.14));
  envLight += vec3(1.18, 1.22, 1.28) * keyBox;
  envLight += vec3(0.65, 0.74, 0.92) * fillBox;
  envLight += vec3(0.48, 0.64, 0.98) * rimStrip * 0.45;

  // --- Obsidian Optical studio (Style 3 crystal look, eye-comfortable dark ceiling) ---
  vec3 darkBase = vec3(0.018, 0.026, 0.050);
  vec3 darkCobalt = mix(vec3(0.11, 0.21, 0.46), vec3(0.14, 0.27, 0.60), cadence);
  vec3 darkIce = vec3(0.58, 0.72, 0.94);

  float darkRibbon = smoothstep(0.18, 0.62, d.x * 0.55 + y * 0.65 + d.z * 0.45);
  float darkCounter = smoothstep(0.35, 0.74, -d.x * 0.62 + y * 0.45 - d.z * 0.40);
  vec3 envDark = darkBase + darkCobalt * (0.34 * horizonBand + 0.56 * darkRibbon + 0.34 * darkCounter);
  envDark += vec3(1.08, 1.18, 1.38) * keyBox;
  envDark += vec3(0.62, 0.78, 1.15) * fillBox;
  envDark += darkIce * rimStrip * 0.68;

  return mix(envLight, envDark, dark);
}

// Trace a single spectral wavelength through the crystal with real Snell
// refraction, subtle nested core reflection, and up to 2 internal TIR bounces.
float traceChannel(
  vec3 rdLocal,
  vec3 pEnter,
  vec3 nEnter,
  float ior,
  int channel,
  float dark,
  float cadence
) {
  vec3 dIn = refract(rdLocal, nEnter, 1.0 / ior);
  if (length(dIn) < 0.001) {
    vec3 reflWorld = uRot * reflect(rdLocal, nEnter);
    vec3 col = sampleStudioEnv(reflWorld, dark, cadence);
    return channel == 0 ? col.r : (channel == 1 ? col.g : col.b);
  }
  dIn = normalize(dIn);

  vec3 pos = pEnter + dIn * 0.002;
  float totalPath = 0.0;
  float accum = 0.0;
  float energy = 1.0;

  // Check nested inner faceted crystal core for clean internal glass depth.
  CoreHit core = hitInnerCore(pos, dIn);
  if (core.hit) {
    float ndv = clamp(abs(dot(dIn, core.nEnter)), 0.0, 1.0);
    float coreFresnel = 0.07 + 0.34 * pow(max(1.0 - ndv, 0.0001), 3.0);
    vec3 coreReflWorld = uRot * reflect(dIn, core.nEnter);
    vec3 coreEnv = sampleStudioEnv(coreReflWorld, dark, cadence);
    float coreEdge = smoothstep(0.020, 0.0015, core.edgeDist);
    vec3 coreTint = mix(
      vec3(0.88, 0.93, 1.04),
      vec3(0.76, 0.90, 1.16),
      dark
    );
    vec3 coreContrib = coreEnv * coreTint * coreFresnel +
      mix(vec3(0.75, 0.84, 1.02), vec3(0.76, 0.86, 1.08), dark) * coreEdge * mix(0.16, 0.20, dark);
    accum += energy * (channel == 0 ? coreContrib.r : (channel == 1 ? coreContrib.g : coreContrib.b));

    vec3 bent = refract(dIn, core.nEnter, 1.0 / 1.06);
    if (length(bent) > 0.001) {
      dIn = normalize(bent);
    }
    energy *= (1.0 - coreFresnel * 0.52);
  }

  // Up to 2 internal bounces (exit transmission + total internal reflection).
  for (int bounce = 0; bounce < 2; bounce++) {
    PolyHit inside = hitIcosahedron(pos, dIn);
    if (!inside.hit || inside.tExit <= 0.001) break;
    vec3 pExit = pos + dIn * inside.tExit;
    totalPath += inside.tExit;

    vec3 absorb = mix(
      mix(vec3(0.16, 0.10, 0.025), vec3(0.24, 0.12, 0.02), cadence),
      mix(vec3(0.22, 0.12, 0.025), vec3(0.28, 0.14, 0.02), cadence),
      dark
    );
    float absCh = channel == 0 ? absorb.r : (channel == 1 ? absorb.g : absorb.b);
    float transmittance = exp(-totalPath * absCh);

    float backEdge = smoothstep(0.022, 0.0015, icosahedronEdgeDist(pExit, inside.faceExit));
    float backGlow = backEdge * mix(0.09, 0.14, dark) * transmittance;
    accum += energy * backGlow * (channel == 2 ? 1.08 : (channel == 1 ? 1.0 : 0.92));

    vec3 outN = inside.nExit;
    vec3 dExit = refract(dIn, -outN, ior);
    if (length(dExit) > 0.001) {
      float cosOut = clamp(abs(dot(dIn, outN)), 0.0, 1.0);
      float fresnelExit = 0.055 + 0.62 * pow(max(1.0 - cosOut, 0.0001), 3.8);
      vec3 envExit = sampleStudioEnv(uRot * normalize(dExit), dark, cadence);
      float chVal = channel == 0 ? envExit.r : (channel == 1 ? envExit.g : envExit.b);
      accum += energy * transmittance * (1.0 - fresnelExit) * chVal;

      energy *= fresnelExit * transmittance;
      dIn = normalize(reflect(dIn, outN));
      pos = pExit + dIn * 0.002;
    } else {
      dIn = normalize(reflect(dIn, outN));
      pos = pExit + dIn * 0.002;
      energy *= transmittance * 0.92;
    }
  }

  if (energy > 0.02) {
    vec3 tail = sampleStudioEnv(uRot * dIn, dark, cadence);
    float tailVal = channel == 0 ? tail.r : (channel == 1 ? tail.g : tail.b);
    accum += energy * tailVal * 0.7;
  }

  return accum;
}

// Evaluate one supersampled ray against the 3D crystal; returns rgb + alpha.
vec4 sampleCrystalRay(vec2 px, float dark, float cadence) {
  vec2 uv = (px - uCenter) / uRadius;
  const float camZ = 5.4;
  vec3 roWorld = vec3(0.0, 0.0, camZ);
  vec3 rdWorld = normalize(vec3(uv * 1.18, -camZ));

  mat3 invRot = transpose(uRot);
  vec3 ro = invRot * roWorld;
  vec3 rd = invRot * rdWorld;

  PolyHit hit = hitIcosahedron(ro, rd);
  if (!hit.hit || hit.tEnter <= 0.0) {
    return vec4(0.0);
  }

  vec3 pEnter = ro + rd * hit.tEnter;
  vec3 nEnter = normalize(hit.nEnter);
  vec3 nWorld = normalize(uRot * nEnter);
  vec3 vWorld = -rdWorld;

  float dispSpread = 0.017 + 0.008 * cadence + 0.005 * uHover;
  float iorG = 1.545;
  float iorR = iorG - dispSpread;
  float iorB = iorG + dispSpread * 1.12;

  vec3 refracted;
  refracted.r = traceChannel(rd, pEnter, nEnter, iorR, 0, dark, cadence);
  refracted.g = traceChannel(rd, pEnter, nEnter, iorG, 1, dark, cadence);
  refracted.b = traceChannel(rd, pEnter, nEnter, iorB, 2, dark, cadence);
  float refLuma = dot(refracted, vec3(0.299, 0.587, 0.114));
  refracted = mix(refracted, vec3(refLuma), 0.16);

  float ndv = clamp(dot(nWorld, vWorld), 0.0, 1.0);
  float oneMinusNdv = max(1.0 - ndv, 0.0001);
  float fresnel = 0.05 + 0.95 * pow(oneMinusNdv, 4.0);
  vec3 reflDir = reflect(rdWorld, nWorld);
  vec3 reflCol = sampleStudioEnv(reflDir, dark, cadence);

  vec3 halfKey = normalize(KEY_LIGHT + vWorld);
  vec3 halfFill = normalize(FILL_LIGHT + vWorld);
  float ndhKey = max(dot(nWorld, halfKey), 0.0001);
  float ndhFill = max(dot(nWorld, halfFill), 0.0001);
  float specKey = pow(ndhKey, 84.0);
  float specFill = pow(ndhFill, 48.0);

  // Hairline chamfered diamond bevel catchlights along dihedral edges.
  float edgeDist = icosahedronEdgeDist(pEnter, hit.faceEnter);
  float edgeHair = smoothstep(0.022, 0.001, edgeDist);
  float edgeSheen = smoothstep(0.055, 0.003, edgeDist);
  float dirCatch = 0.18 + 0.82 * pow(ndhKey, 2.2) + 0.38 * pow(oneMinusNdv, 1.6);

  vec3 coolBevel = vec3(0.84, 0.94, 1.08);
  vec3 warmBevel = vec3(1.05, 0.97, 0.90);
  vec3 bevelCol = mix(coolBevel, warmBevel, smoothstep(-0.3, 0.7, -nWorld.x * 0.65 + nWorld.y * 0.45));

  vec3 col = mix(refracted, reflCol, fresnel * mix(0.64, 0.76, dark));
  col += vec3(1.15, 1.18, 1.24) * specKey * mix(0.85, 0.60, dark);
  col += vec3(0.74, 0.86, 1.12) * specFill * mix(0.28, 0.28, dark);
  col += bevelCol * edgeHair * dirCatch * mix(0.62, 0.54, dark);
  col += mix(vec3(0.70, 0.82, 0.98), vec3(0.42, 0.62, 0.96), dark) * edgeSheen * oneMinusNdv * mix(0.16, 0.12, dark);

  float rimEdge = pow(oneMinusNdv, 3.0);
  vec3 lightRimTint = mix(vec3(0.46, 0.60, 0.84), vec3(0.36, 0.54, 0.88), cadence);
  col = mix(col, min(col, lightRimTint * 1.14), (1.0 - dark) * rimEdge * 0.34);

  // Soft-shoulder roll-off keeps dark-mode crystal highlights refined and never glaring.
  col = col / (1.0 + col * mix(0.14, 0.44, dark));
  col *= mix(1.0, 0.84, dark);
  col = clamp(col, 0.0, 1.0);
  return vec4(col, 1.0);
}

// Render the full-viewport architectural caustic light fans with subtle real
// optical prism micro-rainbow chromatic dispersion (NO concentric circles/rings).
vec3 evalOpticalStage(vec2 px, float dark, float focusDim, float cadence, float reveal) {
  vec2 rel = (px - uCenter) / uRadius;
  float rCenter = length(rel);

  const float SHIFTS[5] = float[5](-1.38, -0.68, 0.0, 0.68, 1.38);
  const vec3 SPECTRA[5] = vec3[5](
    vec3(1.00, 0.72, 0.64),  // pale rose-champagne edge
    vec3(1.00, 0.94, 0.74),  // warm sunlit ivory-gold
    vec3(0.97, 0.99, 1.00),  // pure luminous white core
    vec3(0.60, 0.91, 1.00),  // glacial sky-cyan
    vec3(0.62, 0.66, 1.00)   // refined periwinkle-violet edge
  );

  float stageEnergy = reveal * (1.0 - focusDim * 0.18) * (1.0 + uHover * 0.08);

  vec3 spectralSum = vec3(0.0);
  float coreLumSum = 0.0;
  float curtainSum = 0.0;

  for (int i = 0; i < 10; i++) {
    vec4 b = uBeams[i];
    float weight = b.z;
    if (weight < 0.015) continue;

    vec2 bDir = b.xy;
    vec2 perp = vec2(-bDir.y, bDir.x);
    float facetSide = float((i % 3) - 1) * 0.34;
    vec2 bRel = rel - (bDir * 0.32 + perp * facetSide);
    float r = length(bRel);
    vec2 dirN = r > 1e-4 ? bRel / r : bDir;

    float fwd = dot(dirN, bDir);
    if (fwd <= -0.18) continue;

    float fwdMask = smoothstep(-0.08, 0.32, fwd);
    float nearRamp = smoothstep(0.35, 1.25, rCenter);
    float farFade = exp(-0.056 * max(r - 0.8, 0.0));
    float env = weight * fwdMask * nearRamp * farFade;

    float crossVal = dirN.x * bDir.y - dirN.y * bDir.x;
    float ang = atan(crossVal, max(fwd, 1e-4));

    float effSpread = b.w * (0.78 + 0.075 * min(r, 11.0));
    float dispSign = (i % 2 == 0) ? 1.0 : -1.0;
    float disp = (0.044 + 0.012 * min(r, 8.0)) * dispSign * (0.85 + 0.32 * weight) * (0.94 + 0.22 * cadence);

    // Wide architectural volumetric light curtain (tighter on dark so Obsidian stays velvety).
    float wideCurtain = exp(-sq(ang / (effSpread * mix(1.95, 1.48, dark))));
    curtainSum += wideCurtain * env;

    // Layered pure-white optical caustic shafts & silky internal sub-filaments.
    float shaftMain = exp(-sq(ang / (effSpread * 0.58)));
    float ribA = 0.42 * exp(-sq((ang - effSpread * 0.46) / (effSpread * 0.20)));
    float ribB = 0.36 * exp(-sq((ang + effSpread * 0.40) / (effSpread * 0.18)));
    float ribC = 0.22 * exp(-sq((ang - dispSign * effSpread * 0.88) / (effSpread * 0.22)));
    coreLumSum += (shaftMain * 0.84 + wideCurtain * 0.34 + ribA + ribB + ribC) * env;

    // 5-band real optical prism chromatic dispersion along shaft & ribbon flanks.
    for (int s = 0; s < 5; s++) {
      float a = ang - SHIFTS[s] * disp;
      float bandMain = exp(-sq(a / (effSpread * 0.66)));
      float bandWing = 0.50 * exp(-sq(a / (effSpread * 1.48)));
      float bandRib  = 0.32 * exp(-sq((a - dispSign * effSpread * 0.44) / (effSpread * 0.19)));
      spectralSum += SPECTRA[s] * ((bandMain + bandWing + bandRib) * 0.19 * env);
    }
  }

  spectralSum *= stageEnergy;
  coreLumSum *= stageEnergy;
  curtainSum *= stageEnergy;

  // --- LIGHT MODE (Mineral Alabaster · Style 1 gallery caustic light field) ---
  vec3 alabaster = vec3(0.9686, 0.9765, 0.9882); // #f7f9fc
  float ambientSculpt = (0.34 + 0.66 * exp(-0.022 * rCenter * rCenter)) * reveal;
  float shadowPocket = clamp(1.0 - smoothstep(0.05, 0.95, coreLumSum * 0.62), 0.0, 1.0);
  vec3 coolStone = vec3(0.865, 0.896, 0.946);
  vec3 lightCanvas = mix(alabaster, coolStone, ambientSculpt * shadowPocket * 0.40);

  vec2 shadowRel = rel - vec2(0.08, -0.34);
  float shadowD = length(shadowRel * vec2(0.84, 1.22));
  float dropShadow = exp(-shadowD * shadowD * 0.58) * 0.16 * reveal;
  float underCaustic = exp(-sq(length((rel - vec2(0.04, -0.44)) * vec2(0.95, 1.35))) * 1.4) * 0.20 * reveal;
  lightCanvas = mix(lightCanvas, vec3(0.72, 0.78, 0.89), dropShadow);
  lightCanvas = mix(lightCanvas, vec3(1.00, 1.00, 1.00), underCaustic * 0.72);

  float specAvg = (spectralSum.r + spectralSum.g + spectralSum.b) * 0.333333;
  vec3 chroma = spectralSum - vec3(specAvg);

  float whiteLift = smoothstep(0.04, 1.18, coreLumSum * 0.70 + curtainSum * 0.24);
  lightCanvas = mix(lightCanvas, vec3(1.00, 1.00, 1.00), whiteLift * 0.92);
  lightCanvas += chroma * (1.22 + 0.20 * cadence);
  float nearHaloL = exp(-sq(max(rCenter - 1.02, 0.0)) * 2.0) * 0.14 * stageEnergy;
  lightCanvas = mix(lightCanvas, vec3(1.0), nearHaloL);
  lightCanvas = clamp(lightCanvas, 0.0, 1.0);

  // --- DARK MODE (Obsidian Optical · calm, low-glare volumetric beams) ---
  vec3 obsidian = vec3(0.0314, 0.0392, 0.0588); // #080a0f
  float darkGlow = exp(-0.16 * rCenter) * 0.085 * stageEnergy;
  vec3 darkAtmos = mix(vec3(0.09, 0.18, 0.40), vec3(0.12, 0.24, 0.54), cadence);
  vec3 darkCanvas = obsidian + darkAtmos * darkGlow;

  vec3 beamCool = mix(vec3(0.38, 0.54, 0.88), vec3(0.40, 0.60, 0.98), cadence);
  float shaftCore = pow(max(clamp(coreLumSum * 0.36, 0.0, 1.15), 0.0001), 1.75) * 0.19;
  vec3 darkBeam =
    beamCool * (curtainSum * 0.062 + coreLumSum * 0.125) +
    vec3(0.84, 0.90, 0.98) * shaftCore +
    spectralSum * 0.105 +
    max(chroma, vec3(-0.04)) * 0.56;
  float nearHaloD = exp(-sq(max(rCenter - 0.94, 0.0)) * 2.6) * 0.12 * stageEnergy;
  vec3 darkDelta = darkBeam + mix(vec3(0.26, 0.44, 0.86), vec3(0.34, 0.54, 0.98), cadence) * nearHaloD;
  // Soft-shoulder ceiling caps overlapping beam peaks comfortably below glare.
  darkCanvas += darkDelta / (1.0 + max(darkDelta, vec3(0.0)) * 1.45);
  darkCanvas = clamp(darkCanvas, 0.0, 1.0);

  return mix(lightCanvas, darkCanvas, dark);
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec3 bg = evalOpticalStage(px, uDark, uFocusDim, uCadence, uReveal);

  vec2 rel = (px - uCenter) / uRadius;
  if (dot(rel, rel) < 1.44 && uReveal > 0.001) {
    const vec2 OFF[4] = vec2[4](
      vec2(-0.375, -0.125),
      vec2( 0.125, -0.375),
      vec2( 0.375,  0.125),
      vec2(-0.125,  0.375)
    );
    vec3 crystalAcc = vec3(0.0);
    float covAcc = 0.0;
    for (int s = 0; s < 4; s++) {
      vec4 sampleVal = sampleCrystalRay(px + OFF[s], uDark, uCadence);
      crystalAcc += sampleVal.rgb * sampleVal.a;
      covAcc += sampleVal.a;
    }
    if (covAcc > 0.0) {
      vec3 crystalRgb = crystalAcc / covAcc;
      float alpha = (covAcc * 0.25) * smoothstep(0.0, 0.85, uReveal);
      bg = mix(bg, crystalRgb, alpha);
    }
  }

  // Static Interleaved Gradient Noise dither prevents 8-bit banding without temporal drift.
  float ign = fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
  float dither = (ign - 0.5) / 255.0;
  fragColor = vec4(clamp(bg + dither, 0.0, 1.0), 1.0);
}
`;

export interface PrismFrameUniforms {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  radius: number;
  rot: Float32Array;
  beams: Float32Array;
  dark: number;
  focusDim: number;
  cadence: number;
  reveal: number;
  hover: number;
}

export interface PrismRenderer {
  draw(u: PrismFrameUniforms): void;
  dispose(): void;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    if (log && typeof console !== "undefined")
      console.warn("Cadence PrismStage shader compile failed:", log);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Compile and bind the WebGL2 optical prism shader program on `canvas`.
 * Uses alpha:true so an unrendered canvas never flashes opaque black, and
 * returns null cleanly if WebGL2 or shader compilation is unavailable. */
export function createPrismRenderer(
  canvas: HTMLCanvasElement,
): PrismRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "default",
  });
  if (!gl) return null;

  const vs = compileShader(gl, gl.VERTEX_SHADER, PRISM_VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, PRISM_FRAGMENT_SHADER);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  const uCenter = gl.getUniformLocation(program, "uCenter");
  const uRadius = gl.getUniformLocation(program, "uRadius");
  const uRot = gl.getUniformLocation(program, "uRot");
  const uBeams = gl.getUniformLocation(program, "uBeams[0]");
  const uDark = gl.getUniformLocation(program, "uDark");
  const uFocusDim = gl.getUniformLocation(program, "uFocusDim");
  const uCadence = gl.getUniformLocation(program, "uCadence");
  const uReveal = gl.getUniformLocation(program, "uReveal");
  const uHover = gl.getUniformLocation(program, "uHover");

  return {
    draw(u) {
      gl.viewport(0, 0, u.width, u.height);
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL2RenderingContext.useProgram is not a React hook.
      gl.useProgram(program);
      gl.uniform2f(uCenter, u.centerX, u.centerY);
      gl.uniform1f(uRadius, u.radius);
      gl.uniformMatrix3fv(uRot, false, u.rot);
      gl.uniform4fv(uBeams, u.beams);
      gl.uniform1f(uDark, u.dark);
      gl.uniform1f(uFocusDim, u.focusDim);
      gl.uniform1f(uCadence, u.cadence);
      gl.uniform1f(uReveal, u.reveal);
      gl.uniform1f(uHover, u.hover);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL2RenderingContext.useProgram is not a React hook.
      gl.useProgram(null);
      gl.deleteProgram(program);
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
