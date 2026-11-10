// The toast queue policy and its browser-local store; no DOM or timers run.
// Adapted from pi-web-ui tests/unit/notice-policy.test.ts @ b627452c;
// MIT (c) 2026 xing-shuyin.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { ToastStack } from "../../web/src/layout/ToastStack";
import {
  currentToasts,
  dismissToast,
  dismissToasts,
  enqueueToast,
  MAX_VISIBLE_TOASTS,
  notify,
  subscribeToasts,
  type Toast,
  toastDurationMs,
} from "../../web/src/layout/toasts";

afterEach(() => {
  for (const toast of currentToasts()) dismissToast(toast.id);
});

it("times out a passing result but never an error", () => {
  expect(toastDurationMs("info")).toBe(2400);
  expect(toastDurationMs("warning")).toBe(4200);
  expect(toastDurationMs("error")).toBeNull();
});

it("deduplicates a repeat and caps the queue, dropping passing results before errors", () => {
  const failed: Toast = { id: 1, level: "error", text: "Copy unavailable" };
  const copied: Toast = { id: 2, level: "info", text: "Link copied." };
  const two = enqueueToast(enqueueToast([], failed), copied);
  expect(two).toEqual([failed, copied]);
  // The same result again takes its earlier place at the end of the queue.
  const repeated = enqueueToast(two, {
    ...copied,
    id: 3,
    text: " Link copied. ",
  });
  expect(repeated.map((toast) => toast.id)).toEqual([1, 3]);
  // The same words at another level are a different result.
  expect(
    enqueueToast(two, { id: 4, level: "warning", text: "Link copied." }),
  ).toHaveLength(3);
  const full = enqueueToast(
    repeated,
    { id: 5, level: "error", text: "Not sent" },
    2,
  );
  expect(full.map((toast) => toast.id)).toEqual([1, 5]);
  // The newest always shows: with only errors left, the oldest gives way.
  const pushed = enqueueToast(full, { id: 6, level: "info", text: "Saved" }, 2);
  expect(pushed.map((toast) => toast.id)).toEqual([5, 6]);
  expect(enqueueToast([], failed)).toHaveLength(1);
  expect(MAX_VISIBLE_TOASTS).toBe(3);
});

it("lets one source replace and withdraw its own toast", () => {
  const other: Toast = { id: 1, level: "info", text: "Link copied." };
  const first: Toast = { id: 2, level: "error", text: "Not sent", key: "chat" };
  const second: Toast = {
    id: 3,
    level: "error",
    text: "Model changed",
    key: "chat",
  };
  expect(enqueueToast(enqueueToast([other], first), second)).toEqual([
    other,
    second,
  ]);
});

it("publishes to subscribers only when the queue changes", () => {
  let published = 0;
  const unsubscribe = subscribeToasts(() => {
    published += 1;
  });
  const id = notify("error", "Not sent", "chat");
  notify("info", "Link copied.");
  expect(published).toBe(2);
  expect(currentToasts().map((toast) => toast.text)).toEqual([
    "Not sent",
    "Link copied.",
  ]);
  dismissToasts("other");
  dismissToast(-1);
  expect(published).toBe(2);
  dismissToasts("chat");
  expect(currentToasts().some((toast) => toast.id === id)).toBe(false);
  expect(published).toBe(3);
  unsubscribe();
  notify("info", "Saved");
  expect(published).toBe(3);
});

it("renders an empty stack on the server whatever the store holds", () => {
  notify("error", "Not sent");
  expect(renderToStaticMarkup(<ToastStack />)).toBe(
    '<div class="notices"></div>',
  );
});
