/* Interactive WebGL2 Optical Prism Stage for desktop empty new conversations.
 * Mounts a single full-viewport GPU shader behind .app's isolated stacking
 * context (z-index: -1) and projects live refracted beams onto the composer
 * and floating sidebar glass rims. Gracefully falls back to <Crystal /> on
 * SSR, mobile viewports, reduced motion, forced colors, or missing WebGL2. */

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crystal } from "./Crystal";
import {
  applyCrystalDrag,
  applyCrystalTapImpulse,
  applyPointerMove,
  createPrismMotionState,
  packBeamsUniform,
  projectGlassRimHighlights,
  projectRefractedBeams,
  type RectBox,
  stepPrismMotion,
} from "./prism-math";
import { createPrismRenderer } from "./prism-shader";
import "./prism-stage.css";

const DESKTOP_QUERY = "(min-width: 901px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const FORCED_COLORS_QUERY = "(forced-colors: active)";
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

const RIM_PROPS = [
  "--prism-composer-x",
  "--prism-composer-p",
  "--prism-left-y",
  "--prism-left-p",
  "--prism-right-y",
  "--prism-right-p",
] as const;

function resolveDarkScheme(): boolean {
  if (typeof document === "undefined") return false;
  const forced = document.documentElement.dataset.theme;
  if (forced === "dark") return true;
  if (forced === "light") return false;
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_SCHEME_QUERY).matches
    : false;
}

function stageEnvironmentEligible(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false;
  return (
    window.matchMedia(DESKTOP_QUERY).matches &&
    !window.matchMedia(REDUCED_MOTION_QUERY).matches &&
    !window.matchMedia(FORCED_COLORS_QUERY).matches
  );
}

function readRect(el: Element | null): RectBox | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function clearAppRimState(app: HTMLElement | null): void {
  if (!app) return;
  delete app.dataset.prismStage;
  for (const prop of RIM_PROPS) app.style.removeProperty(prop);
}

export function PrismStage({
  active,
  cadence = false,
  children,
}: {
  /** True on desktop visible empty new conversations. */
  active: boolean;
  /** True when Cadence mode is active or armed for this conversation. */
  cadence?: boolean;
  /** Optional fallback glyph; defaults to <Crystal />. */
  children?: ReactNode;
}) {
  const slotRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cadenceRef = useRef(cadence);
  cadenceRef.current = cadence;

  const [eligible, setEligible] = useState(false);
  const [appHost, setAppHost] = useState<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [contextGen, setContextGen] = useState(0);

  // Track viewport/motion/forced-colors eligibility live without re-rendering on frames.
  useEffect(() => {
    if (!active || typeof window === "undefined") {
      setEligible(false);
      setAppHost(null);
      setReady(false);
      setFailed(false);
      return;
    }
    const update = () => setEligible(stageEnvironmentEligible());
    update();
    setFailed(false);
    setAppHost(slotRef.current?.closest(".app") as HTMLElement | null);
    if (typeof window.matchMedia !== "function") return;
    const queries = [
      window.matchMedia(DESKTOP_QUERY),
      window.matchMedia(REDUCED_MOTION_QUERY),
      window.matchMedia(FORCED_COLORS_QUERY),
    ];
    for (const mq of queries) mq.addEventListener("change", update);
    return () => {
      for (const mq of queries) mq.removeEventListener("change", update);
    };
  }, [active]);

  // Run WebGL2 render loop, pointer physics, and UI glass rim sync while active & eligible.
  useEffect(() => {
    void contextGen;
    const slot = slotRef.current;
    const canvas = canvasRef.current;
    if (!active || !eligible || failed || !slot || !canvas || !appHost) {
      setReady(false);
      setDragging(false);
      clearAppRimState(appHost);
      return;
    }

    const renderer = createPrismRenderer(canvas);
    if (!renderer) {
      setReady(false);
      setFailed(true);
      clearAppRimState(appHost);
      return;
    }

    // Shader compilation and linking succeeded synchronously; expand the slot
    // before the first animation frame so Frame 1 measures and draws at full size.
    setReady(true);

    let darkTarget = resolveDarkScheme() ? 1 : 0;
    let focusDimTarget = 0;
    let hoverTarget = 0;
    const state = createPrismMotionState(darkTarget > 0.5, cadenceRef.current);
    const rotBuf = new Float32Array(9);
    const beamsBuf = new Float32Array(40);

    // Cached layout geometry (updated via ResizeObserver / window resize, zero per-frame forced layout).
    let vw = window.innerWidth;
    let vh = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let crystalCenter: [number, number] = [vw * 0.5, vh * 0.36];
    let crystalRadius = 82;
    let composerRect: RectBox | null = null;
    let leftRect: RectBox | null = null;
    let rightRect: RectBox | null = null;

    const workspace = slot.closest(".chat-workspace") as HTMLElement | null;
    const layoutEl = appHost.querySelector(".layout");
    const messagesWrapEl = workspace?.querySelector(".chat-messages-wrap");

    const measureLayout = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.max(1, Math.round(vw * dpr));
      const targetH = Math.max(1, Math.round(vh * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const sRect = readRect(slot);
      if (sRect) {
        crystalCenter = [
          sRect.left + sRect.width * 0.5,
          sRect.top + sRect.height * 0.5,
        ];
        crystalRadius = Math.max(
          48,
          Math.min(sRect.width, sRect.height) * 0.49,
        );
      }
      composerRect = readRect(
        workspace?.querySelector(".composer-dock") ?? null,
      );
      const leftEl = appHost.querySelector(".panel-drawer.drawer-left");
      const rightEl = appHost.querySelector(".panel-drawer.drawer-right");
      const rightIsOverlay = appHost.classList.contains("inspector-overlay");
      leftRect =
        leftEl && !leftEl.hasAttribute("inert") ? readRect(leftEl) : null;
      rightRect =
        rightEl && !rightIsOverlay && !rightEl.hasAttribute("inert")
          ? readRect(rightEl)
          : null;
    };

    measureLayout();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measureLayout)
        : null;
    resizeObserver?.observe(appHost);
    if (layoutEl) resizeObserver?.observe(layoutEl);
    if (workspace) resizeObserver?.observe(workspace);
    if (messagesWrapEl) resizeObserver?.observe(messagesWrapEl);
    resizeObserver?.observe(slot);
    const composerEl = workspace?.querySelector(".composer-dock");
    if (composerEl) resizeObserver?.observe(composerEl);
    const leftPanelEl = appHost.querySelector(".panel-drawer.drawer-left");
    if (leftPanelEl) resizeObserver?.observe(leftPanelEl);
    const rightPanelEl = appHost.querySelector(".panel-drawer.drawer-right");
    if (rightPanelEl) resizeObserver?.observe(rightPanelEl);

    const onWindowResize = () => measureLayout();
    window.addEventListener("resize", onWindowResize, { passive: true });

    // Watch theme toggles (:root[data-theme]) and OS prefers-color-scheme live.
    const updateDark = () => {
      darkTarget = resolveDarkScheme() ? 1 : 0;
    };
    const themeObserver = new MutationObserver(updateDark);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const darkMq = window.matchMedia(DARK_SCHEME_QUERY);
    darkMq.addEventListener("change", updateDark);

    // Watch sidebar inert attribute changes (expand/collapse panels) and overlay mode.
    const drawerObserver = new MutationObserver(measureLayout);
    drawerObserver.observe(appHost, {
      attributes: true,
      attributeFilter: ["class"],
    });
    if (leftPanelEl) {
      drawerObserver.observe(leftPanelEl, {
        attributes: true,
        attributeFilter: ["inert", "class"],
      });
    }
    if (rightPanelEl) {
      drawerObserver.observe(rightPanelEl, {
        attributes: true,
        attributeFilter: ["inert", "class"],
      });
    }

    // Softly calm beam luminance while typing/focused inside the composer.
    const syncFocusDim = (event?: Event) => {
      const nextFocus =
        event?.type === "focusout"
          ? ((event as FocusEvent).relatedTarget as Node | null)
          : document.activeElement;
      const inComposer =
        !!workspace &&
        !!nextFocus &&
        workspace.querySelector(".chat-composer")?.contains(nextFocus) === true;
      const textarea = workspace?.querySelector(
        ".chat-composer textarea",
      ) as HTMLTextAreaElement | null;
      const hasDraft = !!textarea && textarea.value.trim().length > 0;
      focusDimTarget = inComposer ? 1 : hasDraft ? 0.55 : 0;
    };
    syncFocusDim();
    workspace?.addEventListener("focusin", syncFocusDim, { passive: true });
    workspace?.addEventListener("focusout", syncFocusDim, { passive: true });
    workspace?.addEventListener("input", syncFocusDim, { passive: true });

    // Global pointer steering + direct 360° crystal drag & flick physics.
    let activePointerId: number | null = null;
    let lastDragX = 0;
    let lastDragY = 0;
    let lastDragAt = 0;
    let dragDistance = 0;

    const resetInteraction = () => {
      state.pointerActive = false;
      hoverTarget = 0;
      if (activePointerId !== null || state.dragging) {
        activePointerId = null;
        state.dragging = false;
        setDragging(false);
      }
    };

    const onWindowPointerMove = (event: PointerEvent) => {
      const spanX = Math.max(vw * 0.45, 240);
      const spanY = Math.max(vh * 0.45, 220);
      applyPointerMove(
        state,
        (event.clientX - crystalCenter[0]) / spanX,
        (event.clientY - crystalCenter[1]) / spanY,
      );
    };
    const onWindowPointerLeave = () => {
      state.pointerActive = false;
      if (activePointerId === null) hoverTarget = 0;
    };

    const onSlotPointerEnter = () => {
      hoverTarget = 1;
    };
    const onSlotPointerLeave = () => {
      if (activePointerId === null) hoverTarget = 0;
    };
    const onSlotPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      activePointerId = event.pointerId;
      state.dragging = true;
      hoverTarget = 1;
      lastDragX = event.clientX;
      lastDragY = event.clientY;
      lastDragAt = performance.now();
      dragDistance = 0;
      setDragging(true);
      try {
        slot.setPointerCapture(event.pointerId);
      } catch {
        /* Synthetic/detached pointer events may skip capture. */
      }
    };
    const onSlotPointerMove = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId || !state.dragging) return;
      const now = performance.now();
      const dx = event.clientX - lastDragX;
      const dy = event.clientY - lastDragY;
      dragDistance += Math.hypot(dx, dy);
      applyCrystalDrag(state, dx, dy, (now - lastDragAt) / 1000);
      lastDragX = event.clientX;
      lastDragY = event.clientY;
      lastDragAt = now;
    };
    const finishDrag = (event: PointerEvent, canceled: boolean) => {
      if (activePointerId !== event.pointerId) return;
      activePointerId = null;
      state.dragging = false;
      setDragging(false);
      // Clear stale flick inertia if the pointer paused before release.
      if (performance.now() - lastDragAt > 100) {
        state.spinVel[0] = 0;
        state.spinVel[1] = 0;
        state.spinVel[2] = 0;
      }
      if (!canceled && dragDistance < 6) applyCrystalTapImpulse(state);
      hoverTarget =
        !canceled &&
        Math.hypot(
          event.clientX - crystalCenter[0],
          event.clientY - crystalCenter[1],
        ) <= crystalRadius
          ? 1
          : 0;
      try {
        if (slot.hasPointerCapture(event.pointerId))
          slot.releasePointerCapture(event.pointerId);
      } catch {
        /* Ignore already-released capture. */
      }
    };
    const onSlotPointerUp = (event: PointerEvent) => finishDrag(event, false);
    const onSlotPointerCancel = (event: PointerEvent) =>
      finishDrag(event, true);

    window.addEventListener("pointermove", onWindowPointerMove, {
      passive: true,
    });
    window.addEventListener("blur", resetInteraction);
    document.documentElement.addEventListener(
      "pointerleave",
      onWindowPointerLeave,
      { passive: true },
    );
    slot.addEventListener("pointerenter", onSlotPointerEnter, {
      passive: true,
    });
    slot.addEventListener("pointerleave", onSlotPointerLeave, {
      passive: true,
    });
    slot.addEventListener("pointerdown", onSlotPointerDown);
    slot.addEventListener("pointermove", onSlotPointerMove);
    slot.addEventListener("pointerup", onSlotPointerUp);
    slot.addEventListener("pointercancel", onSlotPointerCancel);
    slot.addEventListener("lostpointercapture", onSlotPointerCancel);

    // Pause automatically on hidden tabs and handle GPU context loss cleanly.
    let disposed = false;
    let contextLost = false;
    let rafId = 0;
    let lastFrameAt = performance.now();
    let announcedReady = false;
    let lastRimStamp = "";

    const renderFrame = (now: number) => {
      rafId = 0;
      if (disposed || contextLost || document.visibilityState === "hidden")
        return;

      if (!announcedReady) {
        // Measure after React commits data-prism-ready="true" so Frame 1 uses
        // the exact 184px slot center and post-expansion composer geometry.
        measureLayout();
      } else {
        const currentDpr = Math.min(window.devicePixelRatio || 1, 2);
        if (currentDpr !== dpr) measureLayout();
      }

      const dt = Math.max(0, Math.min((now - lastFrameAt) / 1000, 0.05));
      lastFrameAt = now;

      const rot = stepPrismMotion(state, dt, {
        dark: darkTarget,
        focusDim: focusDimTarget,
        cadence: cadenceRef.current ? 1 : 0,
        hover: hoverTarget,
      });
      const beams = projectRefractedBeams(rot, state.cadence);

      for (let i = 0; i < 9; i++) rotBuf[i] = rot[i];
      packBeamsUniform(beams, beamsBuf);

      renderer.draw({
        width: canvas.width,
        height: canvas.height,
        centerX: crystalCenter[0] * dpr,
        centerY: (vh - crystalCenter[1]) * dpr,
        radius: crystalRadius * dpr,
        rot: rotBuf,
        beams: beamsBuf,
        dark: state.dark,
        focusDim: state.focusDim,
        cadence: state.cadence,
        reveal: state.reveal,
        hover: state.hover,
      });

      // Sync projected glass rim highlights to composer & sidebars without layout thrash.
      const rimScale =
        state.reveal * (1 - state.focusDim * 0.22) * (0.76 - state.dark * 0.14);
      const rims = projectGlassRimHighlights(
        beams,
        crystalCenter,
        {
          composer: composerRect,
          leftSidebar: leftRect,
          rightSidebar: rightRect,
        },
        rimScale,
      );
      const cx = rims.composerX.toFixed(1);
      const cp = rims.composerPower.toFixed(2);
      const ly = rims.leftY.toFixed(1);
      const lp = rims.leftPower.toFixed(2);
      const ry = rims.rightY.toFixed(1);
      const rp = rims.rightPower.toFixed(2);
      const stamp = `${cx}|${cp}|${ly}|${lp}|${ry}|${rp}`;
      if (stamp !== lastRimStamp) {
        lastRimStamp = stamp;
        appHost.style.setProperty("--prism-composer-x", `${cx}%`);
        appHost.style.setProperty("--prism-composer-p", cp);
        appHost.style.setProperty("--prism-left-y", `${ly}%`);
        appHost.style.setProperty("--prism-left-p", lp);
        appHost.style.setProperty("--prism-right-y", `${ry}%`);
        appHost.style.setProperty("--prism-right-p", rp);
      }

      if (!announcedReady) {
        announcedReady = true;
        appHost.dataset.prismStage = "active";
      }

      rafId = window.requestAnimationFrame(renderFrame);
    };

    const schedule = () => {
      if (disposed || contextLost || rafId !== 0) return;
      if (document.visibilityState === "hidden") return;
      lastFrameAt = performance.now();
      rafId = window.requestAnimationFrame(renderFrame);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (rafId !== 0) {
          window.cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else {
        measureLayout();
        schedule();
      }
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      resetInteraction();
      clearAppRimState(appHost);
      setReady(false);
    };
    const onContextRestored = () => {
      contextLost = false;
      setContextGen((g) => g + 1);
    };

    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    schedule();

    return () => {
      disposed = true;
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      themeObserver.disconnect();
      drawerObserver.disconnect();
      darkMq.removeEventListener("change", updateDark);
      window.removeEventListener("resize", onWindowResize);
      workspace?.removeEventListener("focusin", syncFocusDim);
      workspace?.removeEventListener("focusout", syncFocusDim);
      workspace?.removeEventListener("input", syncFocusDim);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("blur", resetInteraction);
      document.documentElement.removeEventListener(
        "pointerleave",
        onWindowPointerLeave,
      );
      slot.removeEventListener("pointerenter", onSlotPointerEnter);
      slot.removeEventListener("pointerleave", onSlotPointerLeave);
      slot.removeEventListener("pointerdown", onSlotPointerDown);
      slot.removeEventListener("pointermove", onSlotPointerMove);
      slot.removeEventListener("pointerup", onSlotPointerUp);
      slot.removeEventListener("pointercancel", onSlotPointerCancel);
      slot.removeEventListener("lostpointercapture", onSlotPointerCancel);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      renderer.dispose();
      clearAppRimState(appHost);
      setReady(false);
      setDragging(false);
    };
  }, [active, eligible, failed, appHost, contextGen]);

  const showCanvas = active && eligible && !failed && appHost !== null;

  return (
    <>
      {showCanvas &&
        createPortal(
          <canvas ref={canvasRef} className="prism-stage-canvas" />,
          appHost,
        )}
      <span
        ref={slotRef}
        className={`empty-logo${active ? " prism-crystal-slot" : ""}`}
        aria-hidden="true"
        data-prism-ready={ready ? "true" : undefined}
        data-prism-dragging={dragging ? "true" : undefined}
      >
        {children ?? <Crystal />}
      </span>
    </>
  );
}
