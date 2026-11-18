// Browser-side probes; evaluate their bodies in the canonical page, never in
// a replacement HTML layout. A page screenshot is sampled, not saved to disk.
export function textSamples(selector) {
  const roots = selector
    ? document.querySelectorAll(selector)
    : [document.body];
  if (roots.length !== 1)
    throw Error(`Expected one visible text target: ${selector}`);
  const result = [],
    walker = document.createTreeWalker(roots[0], NodeFilter.SHOW_TEXT);
  const sample = (el, rects, name, pseudo) => {
    if (
      !el ||
      el.closest('[aria-hidden="true"],.visually-hidden,.sr-only,[inert]') ||
      el.matches(":disabled") ||
      el.closest("button:disabled")
    )
      return;
    const style = getComputedStyle(el, pseudo);
    let alpha = Number(style.opacity);
    for (let p = pseudo ? el : el.parentElement; p; p = p.parentElement)
      alpha *= Number(getComputedStyle(p).opacity);
    if (alpha < 0.01 || style.visibility !== "visible") return;
    for (const rect of rects) {
      if (rect.width <= 1 || rect.height <= 1) continue;
      for (const fraction of [0.18, 0.5, 0.82]) {
        const x = Math.floor(rect.left + rect.width * fraction),
          y = Math.floor(rect.top + rect.height * 0.5);
        if (document.elementFromPoint(x, y) !== el) continue;
        result.push({
          x,
          y,
          alpha,
          fg: style.color,
          min:
            !selector &&
            (parseFloat(style.fontSize) >= 24 ||
              (parseFloat(style.fontSize) >= 18.66 &&
                Number(style.fontWeight) >= 700))
              ? 3
              : 4.5,
          name,
        });
      }
    }
  };
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || el.tagName === "OPTION") continue;
    const range = new Range();
    range.selectNodeContents(n);
    sample(
      el,
      range.getClientRects(),
      `${el.tagName}.${el.className}: ${n.textContent.trim().slice(0, 30)}`,
    );
  }
  if (selector) return result;
  for (const el of document.querySelectorAll(
    "input[placeholder],textarea[placeholder]",
  ))
    if (!el.value)
      sample(
        el,
        [el.getBoundingClientRect()],
        el.tagName + " placeholder",
        "::placeholder",
      );
  // Sample the solid indicator and its immediately adjacent material from
  // the same compositor capture. Never infer focus solely from a CSS token.
  const active = document.activeElement;
  if (active?.matches(":focus-visible")) {
    const indicator = active.matches(".chat-composer textarea")
      ? active.closest(".chat-composer")
      : active;
    const css = getComputedStyle(indicator),
      r = indicator.getBoundingClientRect(),
      w = parseFloat(css.outlineWidth),
      o = parseFloat(css.outlineOffset) || 0;
    if (
      css.outlineStyle !== "none" &&
      w >= 2 &&
      r.left > o + w + 3 &&
      indicator.contains(
        document.elementFromPoint(r.left + 4, r.top + r.height / 2),
      )
    ) {
      const y = Math.floor(r.top + r.height * 0.5);
      result.push({
        name: `${active.tagName} focus`,
        ink: [Math.floor(r.left - o - w / 2), y],
        x: Math.floor(r.left - o - w - 2),
        y,
        min: 3,
      });
    }
  }
  const dot = document.querySelector(".status-conn .status-dot");
  if (dot) {
    const r = dot.getBoundingClientRect(),
      y = Math.floor(r.top + r.height / 2),
      x = Math.floor(r.left + r.width / 2);
    if (document.elementFromPoint(x, y) === dot)
      result.push({
        name: "Connection dot",
        ink: [x, y],
        x: Math.floor(r.left - 2),
        y,
        min: 3,
      });
  }
  return result;
}
// Keep the actual label painted. Its adjacent backing is inside the same
// button; verify glyph ink in the Range as well as DOM hit-test geometry.
export function glyphSample(selector, text, backingFraction) {
  const label = document.querySelector(selector),
    button = label?.closest("button"),
    node =
      label &&
      [...label.childNodes].find(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent === text,
      );
  if (!button || !node) throw Error(`Missing ${selector} text node: ${text}`);
  const range = new Range();
  range.selectNodeContents(node); // Exclude the adjacent switch graphic.
  const r = range.getBoundingClientRect();
  const y = Math.floor(r.top + r.height / 2);
  const [bx, by] =
    backingFraction === undefined
      ? [Math.floor(r.left - 2), y]
      : [Math.floor(r.left + r.width * backingFraction), Math.floor(r.top - 2)];
  const backing = document.elementFromPoint(bx, by);
  if (
    !button.contains(backing) ||
    (backingFraction !== undefined && backing !== button) ||
    !r.width ||
    !r.height ||
    ![r.left + 1, r.left + r.width / 2, r.right - 1].every(
      (x) => document.elementFromPoint(x, y) === label,
    )
  )
    throw Error(`Hidden label: ${text}`);
  let alpha = 1;
  for (let p = label; p; p = p.parentElement)
    alpha *= Number(getComputedStyle(p).opacity);
  return {
    x: bx,
    y: by,
    glyph: [r.left, r.top, r.right, r.bottom],
    name: `${label.tagName}.${label.className}: ${text}`,
    fg: getComputedStyle(label).color,
    alpha,
    min: 4.5,
  };
}
// The short rule is the entire affordance at rest. Read its center and the
// material just above it in the *same unmodified frame* (not CSS colors).
export function questionMarkSample() {
  const rail = document.querySelector(".qn-rail:not(:hover,:focus-within)");
  const current = rail?.querySelector('.qn-bar.active[aria-current="true"]');
  const short = rail?.querySelector(".qn-bar:not(.active,[aria-current])");
  if (!short || !current)
    throw Error("Missing resting current/noncurrent question pair");
  const r = short.getBoundingClientRect();
  const currentWidth = current.getBoundingClientRect().width;
  const x = Math.floor(r.left + r.width / 2),
    y = Math.floor(r.top + r.height / 2);
  if (
    !(
      currentWidth > r.width &&
      r.width > 0 &&
      short === document.elementFromPoint(x, y)
    ) ||
    getComputedStyle(short.querySelector(".qn-bar-text")).visibility !==
      "hidden"
  )
    throw Error("Question mark is not visible at rest");
  return {
    name: short.getAttribute("aria-label"),
    ink: [x, y],
    x,
    y: Math.floor(r.top - 2),
    min: 3,
    currentWidth,
    shortWidth: r.width,
  };
}
export async function contrastPixels(png, points) {
  const blob = new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], {
      type: "image/png",
    }),
    bitmap = await createImageBitmap(blob),
    ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", {
      willReadFrequently: true,
    });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height),
    scale = img.width / innerWidth;
  const lum = ([r, g, b]) => {
    const v = [r, g, b]
      .map((c) => c / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const canvas = new OffscreenCanvas(1, 1).getContext("2d", {
    willReadFrequently: true,
  });
  let worst = null;
  const failures = new Map();
  const words = {};
  const surfaces = {};
  for (const p of points) {
    const offset =
      (Math.floor(p.y * scale) * img.width + Math.floor(p.x * scale)) * 4;
    let bg = [...img.data.slice(offset, offset + 3)];
    // Forced-colors may paint glyph ink even with transparent text-fill. The
    // native form uses flat system surfaces here: sample the modal pixel of a
    // small neighborhood, not an anti-aliased glyph at a single coordinate.
    if (matchMedia("(forced-colors: active)").matches) {
      const counts = new Map();
      for (let dy = -7; dy <= 7; dy++)
        for (let dx = -7; dx <= 7; dx++) {
          const i = offset + 4 * (dy * img.width + dx);
          const key = img.data.slice(i, i + 3).join(",");
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      bg = [...counts]
        .sort((a, b) => b[1] - a[1])[0][0]
        .split(",")
        .map(Number);
    }
    if (p.ink) {
      const i =
        (Math.floor(p.ink[1] * scale) * img.width +
          Math.floor(p.ink[0] * scale)) *
        4;
      const pixel = img.data.slice(i, i + 3);
      if (p.expectedInk) {
        canvas.fillStyle = p.expectedInk;
        canvas.fillRect(0, 0, 1, 1);
        const expected = canvas.getImageData(0, 0, 1, 1).data;
        if (
          pixel.length !== 3 ||
          pixel.some((v, c) => Math.abs(v - expected[c]) > 3)
        )
          throw Error(
            `Missing painted ${p.name}: ${pixel} instead of ${p.expectedInk}`,
          );
      }
      p.fg = `rgb(${pixel.join(",")})`;
      p.alpha = 1;
    }
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = p.fg;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data,
      alpha = (p.alpha * a) / 255;
    const fg = [r, g, b].map((c, i) => c * alpha + bg[i] * (1 - alpha));
    let paintedGlyph;
    if (p.glyph) {
      const [left, top, right, bottom] = p.glyph.map((n) => n * scale);
      const distance = (pixel, color) =>
        color.reduce((d, c, i) => d + Math.abs(c - img.data[pixel + i]), 0);
      for (let y = Math.ceil(top); y < Math.floor(bottom) && !paintedGlyph; y++)
        for (let x = Math.ceil(left); x < Math.floor(right); x++) {
          const pixel = 4 * (y * img.width + x);
          if (distance(pixel, fg) < distance(pixel, bg)) {
            paintedGlyph = { x, y, rgb: [...img.data.slice(pixel, pixel + 3)] };
            break;
          }
        }
      if (!paintedGlyph) throw Error(`No visible glyph in capture: ${p.name}`);
    }
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a),
      ratio = (hi + 0.05) / (lo + 0.05);
    const observed = {
      ratio: +ratio.toFixed(3),
      bg,
      fg: p.fg,
      alpha,
      effectiveFg: fg,
      ...(paintedGlyph && {
        glyph: p.glyph,
        paintedGlyph,
        backingPoint: [p.x, p.y],
      }),
      name: p.name,
      min: p.min,
    };
    if (
      p.surface &&
      (!surfaces[p.surface] || ratio < surfaces[p.surface].ratio)
    )
      surfaces[p.surface] = observed;
    for (const mark of ["char-add", "char-del"])
      if (
        p.name.startsWith(`SPAN.${mark}:`) &&
        (!words[mark] || ratio < words[mark].ratio)
      )
        words[mark] = observed;
    if (!worst || ratio < worst.ratio) worst = observed;
    if (
      ratio < p.min &&
      (!failures.has(p.name) || failures.get(p.name).ratio > ratio)
    )
      failures.set(p.name, observed);
  }
  return {
    samples: points.length,
    worst,
    words,
    ...(Object.keys(surfaces).length ? { surfaces } : {}),
    failures: [...failures.values()],
  };
}
export function dimensions(selectors) {
  const geom = (el) => {
    const r = el.getBoundingClientRect();
    return {
      xy: [r.left, r.top].map(Math.round),
      box: [r.width, r.height].map(Math.round),
      client: [el.clientWidth, el.clientHeight],
      scroll: [el.scrollWidth, el.scrollHeight],
    };
  };
  return Object.fromEntries(
    ["html", ...selectors]
      .map((s) => [s, document.querySelector(s)])
      .filter(([, e]) => e)
      .map(([s, e]) => [s, geom(e)]),
  );
}
export async function frameWindow(ms, scroll) {
  const el = document.querySelector(".chat-messages"),
    intervals = [];
  let last = 0;
  const start = performance.now(),
    draws = window.opticalProbe.draws;
  await new Promise((resolve) => {
    const frame = (t) => {
      if (last) intervals.push(t - last);
      last = t;
      if (scroll && el)
        el.scrollTop =
          (0.5 + 0.35 * Math.sin((t - start) / 420)) *
          (el.scrollHeight - el.clientHeight);
      if (t - start >= ms) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  intervals.sort((a, b) => a - b);
  return {
    n: intervals.length,
    p50: intervals[Math.floor(intervals.length * 0.5)],
    p95: intervals[Math.floor(intervals.length * 0.95)],
    over50: intervals.filter((x) => x > 50).length / intervals.length,
    draws: window.opticalProbe.draws - draws,
  };
}

// Scroll the control itself (including its nested scrollers). Measure the
// border box, not just a center hit or the dimensions of its enclosing card.
export async function controlGeometry(selector, scroll = true) {
  const el = document.querySelector(selector);
  if (
    !(
      el instanceof HTMLButtonElement ||
      el?.matches('.resize-handle[type="range"], .rp-tab[aria-current="true"]')
    )
  )
    throw Error(`Missing control: ${selector}`);
  if (scroll)
    el.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
  const box = (left, top, right, bottom) => ({
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  });
  const measure = () => {
    const r = el.getBoundingClientRect();
    const viewport = box(0, 0, innerWidth, innerHeight);
    let left = Math.max(r.left, 0),
      top = Math.max(r.top, 0),
      right = Math.min(r.right, innerWidth),
      bottom = Math.min(r.bottom, innerHeight);
    const clips = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const css = getComputedStyle(p),
        x = css.overflowX !== "visible",
        y = css.overflowY !== "visible";
      if (!x && !y) continue;
      const rect = p.getBoundingClientRect(),
        px = rect.left + p.clientLeft,
        py = rect.top + p.clientTop;
      const clip = box(px, py, px + p.clientWidth, py + p.clientHeight);
      if (x) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (y) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      clips.push({
        ancestor: `${p.tagName}.${p.className}`,
        x,
        y,
        clip,
        intersection: box(left, top, right, bottom),
      });
    }
    const midX = r.left + r.width / 2,
      midY = r.top + r.height / 2;
    const hit = Object.fromEntries(
      Object.entries({
        center: [midX, midY],
        left: [r.left + 1, midY],
        right: [r.right - 1, midY],
        top: [midX, r.top + 1],
        bottom: [midX, r.bottom - 1],
      }).map(([side, [x, y]]) => [
        side,
        { x, y, hit: el.contains(document.elementFromPoint(x, y)) },
      ]),
    );
    return {
      name:
        el.getAttribute("aria-label") ||
        [...el.childNodes]
          .filter(
            (n) =>
              !(
                n instanceof Element && n.getAttribute("aria-hidden") === "true"
              ),
          )
          .map((n) => n.textContent)
          .join("")
          .trim(),
      disabled: el.matches(":disabled"),
      rect: box(r.left, r.top, r.right, r.bottom),
      viewport,
      clips,
      visible: box(left, top, right, bottom),
      hit,
    };
  };
  return opticalProbe.stableFrames(measure, selector);
}

export async function stableFrames(measure, label) {
  let last,
    steady = 0;
  for (let i = 0; i < 90; i++) {
    await new Promise(requestAnimationFrame);
    const reading = measure(),
      json = JSON.stringify(reading);
    if (json === last) {
      if (++steady === 3) return reading;
    } else steady = 0;
    last = json;
  }
  throw Error(`Unstable layout: ${label}`);
}

// A fixed transcript, so a rendered block's ordinal identifies it through the
// expansion. No scrolling, focusing, or DOM mutation during either reading.
export function readingPosition() {
  const pane = document.querySelector(".chat-messages");
  const bounds = pane.getBoundingClientRect();
  const blocks = [
    ...pane.querySelectorAll(
      ".md p,.md h3,.code-caption,.toolcall-output-label,.toolcall-output pre",
    ),
  ];
  const index = blocks.findIndex((el) => {
    const r = el.getBoundingClientRect();
    return (
      r.top >= bounds.top &&
      r.bottom <= bounds.bottom &&
      r.height > 0 &&
      el.contains(document.elementFromPoint(r.left + 2, r.top + r.height / 2))
    );
  });
  const anchor = blocks[index];
  const head = pane.querySelector(".toolcall-head").getBoundingClientRect();
  const { scrollTop, clientHeight, scrollHeight } = pane;
  return {
    scrollTop,
    clientHeight,
    scrollHeight,
    bottom: scrollHeight - clientHeight - scrollTop,
    anchor: anchor && {
      index,
      tag: anchor.tagName,
      y: anchor.getBoundingClientRect().top - bounds.top,
    },
    headY: head.top - bounds.top,
  };
}

// Sample the center of the copy glyph's straight rectangular stroke, not its
// anti-aliased corners. The pixel immediately inside the rect is its material.
export function restingCopySample(selector) {
  const button = document.querySelector(selector);
  const card = button.closest(".toolcall,.msg-text");
  if (card.matches(":hover,:focus-within") || button.matches(":hover,:focus"))
    throw Error(`Not at rest: ${selector}`);
  const rect = button.querySelector("svg rect");
  const box = rect.getBBox();
  const point = new DOMPoint(box.x, box.y + box.height / 2).matrixTransform(
    rect.getScreenCTM(),
  );
  const x = Math.floor(point.x),
    y = Math.floor(point.y);
  if (!button.contains(document.elementFromPoint(x, y)))
    throw Error(`Hidden glyph: ${selector}`);
  return {
    name: `${selector} resting stroke`,
    ink: [x, y],
    x: x + 2,
    y,
    min: 3,
  };
}
