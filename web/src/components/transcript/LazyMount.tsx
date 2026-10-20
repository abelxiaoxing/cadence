/* Adapted from pi-web-ui/web/src/components/LazyMount.tsx @ e8bab487af208bc9a1ab60a821652323f598127f.
 * Copyright (c) 2026 xing-shuyin. MIT; see licenses/pi-web-ui-MIT.txt.
 * Cadence: scoped presentation only; see provenance/webui-reuse.json. */
import {
  memo,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";

interface LazyMountProps {
  /** 消息 id——占位符带 data-msg-id，问题导航 / 搜索跳转的查询不受影响。 */
  id: string;
  /** false = 渲染固定高度占位符；true = 渲染真实内容。 */
  show: boolean;
  /** 占位高度（上次实测值或角色估算值）。 */
  height: number;
  /** 滚动容器（.messages），用于显示瞬间的 scrollTop 补偿。 */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 真实内容挂载后回报实测高度（父级写入 heights 缓存）。 */
  onMeasured?: (id: string, height: number) => void;
  /** 外层包裹元素 ref 注册（父级 sweep 需要测量所有受管元素）。 */
  lazyRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}

/**
 * 惰性挂载包装：隐藏时渲染一个保留 data-msg-id 的等高占位 div；
 * 显示瞬间实测真实高度并更新缓存。滚动稳定性由容器原生的 overflow-anchor: auto
 * 原生滚动锚定接管，避免 JS 暴力篡改 scrollTop 与浏览器底层锚定打架导致跳跃。
 */
export const LazyMount = memo(function LazyMount({
  id,
  show,
  height,
  containerRef: _containerRef,
  onMeasured,
  lazyRef,
  children,
}: LazyMountProps) {
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!show) return;
    const inner = innerRef.current;
    if (!inner) return;
    const h = inner.offsetHeight;
    if (h > 0) onMeasured?.(id, h);
  }, [show, id, onMeasured]);

  if (!show) {
    return (
      <div
        ref={lazyRef}
        className="msg-lazy-ph"
        data-msg-id={id}
        data-lazy-id={id}
        style={{ height }}
        aria-hidden="true"
      />
    );
  }
  return (
    <div ref={lazyRef} data-lazy-id={id}>
      <div ref={innerRef}>{children}</div>
    </div>
  );
});
