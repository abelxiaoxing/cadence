/* Adapted from pi-web-ui/web/src/preview-toc.ts @ e8bab487af208bc9a1ab60a821652323f598127f.
 * Copyright (c) 2026 xing-shuyin. MIT; see licenses/pi-web-ui-MIT.txt.
 * Cadence: scoped presentation only; see provenance/webui-reuse.json. */
/**
 * 预览面板「标题导航」的纯函数部分：从标题文本生成稳定锚点 id、按文档顺序去重。
 *
 * 与插件版（`plugins/live-preview/md-toc.mjs`）刻意保持同一套 id 语义 —— 同一个标题在
 * 「/md 整页」与「应用内预览面板」里会得到同一个 id，互相引用锚点时不会错位。
 */

/** 一个标题：层级（1-6）+ 生成的 id + 展示标签。 */
export interface TocHeading {
  level: number;
  id: string;
  label: string;
}

/** 空标签的回落名（标题只有图片/行内标签时）。 */
const FALLBACK_LABEL = "未命名章节";

/**
 * 生成锚点 id：保留 Unicode 字母/数字（中文原样），空白与其它字符压成连字符；空则回落 `section`。
 * 长度截到 80，避免超长中文标题撑爆 URL 片段。
 */
export function slugifyHeading(label: string): string {
  const slug = String(label ?? "")
    .trim()
    .replace(/[\s\u3000]+/g, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "section";
}

/** 按文档顺序给标题分配 id（同 id 依次加 `-2` / `-3`…），并整理展示标签（压缩空白、空则回落）。 */
export function assignHeadingIds(
  headings: readonly { level: number; label: string }[],
): TocHeading[] {
  const used = new Map<string, number>();
  return headings.map(({ level, label }) => {
    const text = String(label ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const base = slugifyHeading(text || FALLBACK_LABEL);
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    return {
      level,
      id: seen === 1 ? base : `${base}-${seen}`,
      label: text || FALLBACK_LABEL,
    };
  });
}

/** 是否值得给这份文档配目录：标题 ≥ 2 个才有意义（1 个标题的目录只是噪音）。 */
export function shouldShowToc(headings: readonly unknown[]): boolean {
  return headings.length >= 2;
}
