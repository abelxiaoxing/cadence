import { afterEach, expect, it, vi } from "vitest";
import {
  ambientPreference,
  saveAmbient,
} from "../../web/src/optics/AmbientShader";
import { mountAmbient } from "../../web/src/optics/ambient";
import { bufferSize } from "../../web/src/optics/renderer";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("bounds both very wide and portrait buffers without multiplying DPR", () => {
  for (const [width, height] of [
    [3840, 2160],
    [390, 844],
    [10000, 1200],
  ]) {
    const [w, h] = bufferSize(width, height, 256000);
    expect(w * h).toBeLessThanOrEqual(256000);
    expect(w).toBeLessThanOrEqual(width / 3);
    expect(h).toBeLessThanOrEqual(height / 3);
  }
});
it("stores only an explicit display preference, tolerating blocked storage", () => {
  const db = new Map();
  vi.stubGlobal("localStorage", {
    setItem: (k: string, v: string) => db.set(k, v),
    getItem: (k: string) => db.get(k),
  });
  expect(ambientPreference()).toBe(true);
  saveAmbient(false);
  expect(ambientPreference()).toBe(false);
  saveAmbient(true);
  expect(ambientPreference()).toBe(true);
  vi.stubGlobal("localStorage", null);
  expect(ambientPreference()).toBe(true);
  expect(() => saveAmbient(false)).not.toThrow();
});
function clock() {
  vi.useFakeTimers();
  const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout }),
    doc = Object.assign(new EventTarget(), {
      hidden: false,
      documentElement: {},
    }),
    q = Object.assign(new EventTarget(), { matches: false });
  const canvas = Object.assign(new EventTarget(), {
    dataset: { scene: "hero" },
  });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("matchMedia", () => q);
  vi.stubGlobal("requestAnimationFrame", (cb: (n: number) => void) =>
    setTimeout(() => cb(performance.now()), 1),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  let resync = () => {};
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(cb: () => void) {
        resync = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => 24 }));
  const lens = { draw: vi.fn(), configure: vi.fn(), dispose: vi.fn() };
  const create = vi.fn(() => lens as typeof lens | null);
  const start = () =>
    mountAmbient(canvas as unknown as HTMLCanvasElement, create);
  return { doc, win, q, canvas, lens, create, start, change: () => resync() };
}
it("stops scheduling on hidden, reading, reduced, context loss and teardown; no catch-up", () => {
  const { doc, win, q, canvas, lens, create, start, change } = clock();
  const dispose = start();
  vi.advanceTimersByTime(1000);
  expect(lens.draw.mock.calls.length).toBeGreaterThan(1);
  expect(lens.draw.mock.calls.length).toBeLessThanOrEqual(24);
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(vi.getTimerCount()).toBe(0);
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  const before = lens.draw.mock.calls.length;
  vi.advanceTimersByTime(1);
  expect(lens.draw.mock.calls.length - before).toBeLessThanOrEqual(1);
  q.matches = true;
  q.dispatchEvent(new Event("change"));
  expect(vi.getTimerCount()).toBe(0);
  q.matches = false;
  q.dispatchEvent(new Event("change"));
  canvas.dispatchEvent(new Event("webglcontextlost"));
  expect(vi.getTimerCount()).toBe(0);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  vi.advanceTimersByTime(60);
  expect(create).toHaveBeenCalledTimes(2);
  canvas.dataset.scene = "reading";
  change();
  expect(vi.getTimerCount()).toBe(0);
  canvas.dataset.scene = "hero";
  change();
  win.dispatchEvent(new Event("resize"));
  vi.advanceTimersByTime(80);
  expect(lens.configure.mock.calls.length).toBeGreaterThan(1);
  dispose();
  expect(lens.dispose).toHaveBeenCalledOnce();
  win.dispatchEvent(new Event("resize"));
  expect(vi.getTimerCount()).toBe(0);
});
it("a missing context leaves a static scene rather than retrying on every frame", () => {
  const { create, start, change } = clock();
  create.mockReturnValue(null);
  const dispose = start();
  vi.advanceTimersByTime(100);
  change();
  expect(create).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  dispose();
});
