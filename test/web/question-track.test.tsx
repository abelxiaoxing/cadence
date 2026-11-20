import { afterEach, expect, it, vi } from "vitest";
import { observeQuestionTrack } from "../../web/src/components/workspace/QuestionRail";

afterEach(() => vi.unstubAllGlobals());

// Controlled dimensions, not a claim about a particular platform scrollbar.
it("tracks the gutter and available rail height without moving the transcript", () => {
  let resize = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const transcript = { offsetWidth: 600, clientWidth: 600, scrollTop: 180 };
  const rail = {
    parentElement: {
      querySelector: (selector: string) =>
        selector === ".chat-messages" ? transcript : null,
    },
    clientHeight: 410,
    style: { setProperty: vi.fn() },
  };
  const height = vi.fn();
  const stop = observeQuestionTrack(rail as unknown as HTMLElement, height);
  expect(observe).toHaveBeenCalledWith(rail);
  expect(observe).toHaveBeenCalledWith(transcript);
  expect(height).toHaveBeenLastCalledWith(410);
  expect(rail.style.setProperty).toHaveBeenLastCalledWith(
    "--qn-scrollbar",
    "0px",
  );

  // A classic scrollbar appears after more pages load. A later resize can
  // change both sampling capacity and the width reserved for the thumb.
  transcript.clientWidth = 592;
  resize();
  expect(rail.style.setProperty).toHaveBeenLastCalledWith(
    "--qn-scrollbar",
    "8px",
  );
  transcript.clientWidth = 580;
  rail.clientHeight = 260;
  resize();
  expect(rail.style.setProperty).toHaveBeenLastCalledWith(
    "--qn-scrollbar",
    "20px",
  );
  expect(height).toHaveBeenLastCalledWith(260);
  expect(transcript.scrollTop).toBe(180);
  stop?.();
  expect(disconnect).toHaveBeenCalledOnce();
});
