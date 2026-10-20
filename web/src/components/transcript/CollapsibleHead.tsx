/* Adapted from pi-web-ui/web/src/components/CollapsibleHead.tsx @ e8bab487af208bc9a1ab60a821652323f598127f.
 * Copyright (c) 2026 xing-shuyin. MIT; see licenses/pi-web-ui-MIT.txt.
 * Cadence: scoped presentation only; see provenance/webui-reuse.json. */
import type { MouseEventHandler, ReactNode } from "react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";

/**
 * 可折叠区块头的公共壳（issue #476 第 3 节）：role=button + aria-expanded +
 * Enter/Space 键控 + 标准切换按钮 + 图标区 + 标题区。此前这套骨架在
 * ThinkingBlock / ToolCallBlock / Message（attachcard·compaction·skillcard）
 * 逐字内联了五遍，仅 className 前缀不同。视觉完全由既有 .chead* 类承担，
 * 组件不引入任何新样式。
 */
export function CollapsibleHead({
  open,
  onToggle,
  headClassName,
  titleText,
  icon,
  iconClassName,
  titleClassName,
  toggleClassName,
  toggle,
  onHeadContextMenu,
  children,
  after,
}: {
  /** 展开态（驱动 aria-expanded 与默认 chevron 方向；通常是 expanded || forceOpen） */
  open: boolean;
  /** 头壳点击 / Enter / Space / 默认切换按钮共用的翻转回调 */
  onToggle: () => void;
  /** 头壳附加类：thinking-head / toolcall-head / attachcard-head … */
  headClassName: string;
  /** 头壳与默认切换按钮的 title/aria 提示（skillcard 传 location 这类自有语义） */
  titleText: string;
  /** .chead-icon 内容 */
  icon: ReactNode;
  /** .chead-icon 附加类（thinking-icon / toolcall-icon …） */
  iconClassName?: string;
  /** .chead-title 附加类（thinking-label / toolcall-name …） */
  titleClassName?: string;
  /** .chead-toggle 附加类（thinking-toggle 有 .thinking-live 专属规则，必须保留） */
  toggleClassName?: string;
  /** 显式切换控件：attachcard 的条件 chevron、compaction/skillcard 的 span 形态；
   *  传 null 表示本卡不渲染切换控件；不传（undefined）渲染标准 button.chead-toggle */
  toggle?: ReactNode;
  onHeadContextMenu?: MouseEventHandler<HTMLButtonElement>;
  /** .chead-title 内容 */
  children: ReactNode;
  /** .chead-title 之后的头内尾部（status / path / copy 键等），ToolCallBlock 头尾一长串都在这里 */
  after?: ReactNode;
}) {
  return (
    <div className={`chead ${headClassName}`}>
      <button
        type="button"
        className="chead-main"
        aria-expanded={open}
        title={titleText}
        onClick={onToggle}
        onContextMenu={onHeadContextMenu}
      >
        {toggle === undefined ? (
          <span
            className={
              toggleClassName
                ? `chead-toggle ${toggleClassName}`
                : "chead-toggle"
            }
          >
            {open ? <FiChevronDown /> : <FiChevronRight />}
          </span>
        ) : (
          toggle
        )}
        <span
          className={
            iconClassName ? `chead-icon ${iconClassName}` : "chead-icon"
          }
        >
          {icon}
        </span>
        <span
          className={
            titleClassName ? `chead-title ${titleClassName}` : "chead-title"
          }
        >
          {children}
        </span>
      </button>
      {after}
    </div>
  );
}
