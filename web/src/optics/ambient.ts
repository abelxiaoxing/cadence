import { createLens } from "./renderer";

/** The effect owns its clock, visibility, palette and GPU lifetime. Reading is
 * static: no shader work at all while text is streaming or being scrolled. */
export function mountAmbient(
  canvas: HTMLCanvasElement,
  create = createLens,
  hero: () => HTMLElement | null = () => null,
) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  let lens: ReturnType<typeof create>,
    timer: number | undefined,
    frame: number | undefined;
  let lost = false,
    failed = false,
    dirty = true,
    last = -Infinity,
    interval = 1000 / 24;
  const stop = () => {
    window.clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    timer = frame = undefined;
  };
  const active = () =>
    !document.hidden &&
    !reduced.matches &&
    !lost &&
    !failed &&
    canvas.dataset.scene === "hero";
  let x = 0,
    y = 0;
  const pointer = (event: PointerEvent) => {
    x = event.clientX / window.innerWidth - 0.5;
    y = 0.5 - event.clientY / window.innerHeight;
  };
  const paint = (time: number) => {
    frame = undefined;
    if (!active()) return;
    if (time - last >= interval) {
      lens ??= create(canvas);
      if (!lens) {
        failed = true;
        return;
      }
      if (dirty) {
        const css = getComputedStyle(canvas);
        lens.configure(css, hero()?.getBoundingClientRect());
        interval =
          1000 /
          Math.min(
            24,
            Math.max(1, Number(css.getPropertyValue("--ambient-fps")) || 24),
          );
        dirty = false;
      }
      lens.draw(time, x, y);
      last = time;
    }
    timer = window.setTimeout(
      () => {
        timer = undefined;
        if (active()) frame = requestAnimationFrame(paint);
      },
      Math.max(1, last + interval - performance.now()),
    );
  };
  const sync = () => {
    stop();
    dirty = true;
    window.removeEventListener("pointermove", pointer);
    if (active()) {
      window.addEventListener("pointermove", pointer, { passive: true });
      frame = requestAnimationFrame(paint);
    }
  };
  const lose = (event: Event) => {
    event.preventDefault();
    lost = true;
    lens = null;
    sync();
  };
  const restore = () => {
    lost = failed = false;
    sync();
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  observer.observe(canvas, {
    attributes: true,
    attributeFilter: ["data-scene"],
  });
  // Opening a desktop wing moves the Hero without a window resize.
  const center = canvas.closest?.(".app")?.querySelector(".main");
  const size = center ? new ResizeObserver(sync) : null;
  if (center) size?.observe(center);
  window.addEventListener("resize", sync);
  document.addEventListener("visibilitychange", sync);
  for (const query of [reduced, scheme]) query.addEventListener("change", sync);
  canvas.addEventListener("webglcontextlost", lose);
  canvas.addEventListener("webglcontextrestored", restore);
  sync();
  return () => {
    stop();
    observer.disconnect();
    size?.disconnect();
    window.removeEventListener("pointermove", pointer);
    window.removeEventListener("resize", sync);
    document.removeEventListener("visibilitychange", sync);
    for (const query of [reduced, scheme])
      query.removeEventListener("change", sync);
    canvas.removeEventListener("webglcontextlost", lose);
    canvas.removeEventListener("webglcontextrestored", restore);
    lens?.dispose();
  };
}
