import { createContext, memo, useContext, useEffect, useRef } from "react";
import { mountAmbient } from "./ambient";
import "./ambient.css";
export const HeroScene = createContext<
  ((mark: HTMLElement | null) => void) | null
>(null);
export function useHeroScene(visible: boolean) {
  const mark = useRef<HTMLSpanElement>(null);
  const publish = useContext(HeroScene);
  useEffect(() => {
    if (!visible) return;
    publish?.(mark.current);
    return () => publish?.(null);
  }, [publish, visible]);
  return mark;
}
const key = "cadence-ambient-v1";
export function ambientPreference() {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}
export function saveAmbient(enabled: boolean) {
  try {
    localStorage.setItem(key, enabled ? "on" : "off");
  } catch {
    /* session choice remains applied */
  }
}
export const AmbientShader = memo(function AmbientShader({
  enabled,
  hero,
}: {
  enabled: boolean;
  hero: HTMLElement | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mark = useRef(hero);
  mark.current = hero;
  useEffect(() => {
    if (enabled && ref.current)
      return mountAmbient(ref.current, undefined, () => mark.current);
  }, [enabled]);
  return (
    <div
      className="optical-field"
      aria-hidden="true"
      data-enabled={enabled}
      data-scene={hero ? "hero" : "reading"}
    >
      <canvas ref={ref} data-scene={hero ? "hero" : "reading"} />
    </div>
  );
});
