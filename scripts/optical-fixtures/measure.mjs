// Browser-side probes; evaluate their bodies in the canonical page, never in
// a replacement HTML layout. A page screenshot is sampled, not saved to disk.
export function textSamples() {
  const result = [],
    walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
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
            parseFloat(style.fontSize) >= 24 ||
            (parseFloat(style.fontSize) >= 18.66 &&
              Number(style.fontWeight) >= 700)
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
      p.fg = `rgb(${img.data.slice(i, i + 3).join(",")})`;
      p.alpha = 1;
    }
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = p.fg;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data,
      alpha = (p.alpha * a) / 255;
    const fg = [r, g, b].map((c, i) => c * alpha + bg[i] * (1 - alpha));
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a),
      ratio = (hi + 0.05) / (lo + 0.05);
    const observed = {
      ratio: +ratio.toFixed(3),
      bg,
      fg: p.fg,
      name: p.name,
      min: p.min,
    };
    if (!worst || ratio < worst.ratio) worst = observed;
    if (
      ratio < p.min &&
      (!failures.has(p.name) || failures.get(p.name).ratio > ratio)
    )
      failures.set(p.name, observed);
  }
  return { samples: points.length, worst, failures: [...failures.values()] };
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
