/* Direct adaptation of the WHOLE pi-web-ui plugins/run-trace/client/entry.mjs
 * @ e8bab487af208bc9a1ab60a821652323f598127f. MIT (c) 2026 xing-shuyin.
 * Cadence: finite read bridge, local pinned vendor only, paged committed facts,
 * explicit ordinal visualization (NOT wall/native timing), no clear or plugin runtime. */
import "./timeline.css";

/**
 * run-trace 客户端视图 v2 —— 类 harness 轨迹分析。
 *
 * 顶部横向泳道时间轴（输入/模型/工具）看全貌，
 * 左列分段列表定位，右列详情做分析（概述/预览/原始内容/来源），
 * 而不只是把对话内容再看一遍。
 *
 * 约定：ESM 默认导出 { mount(container, ctx) → cleanup? }，纯 DOM 无依赖。
 */

const I18N = {
  zh: {
    title: "已记录顺序（非时间轴测量）",
    live: "已提交页面",
    current: "当前",
    search: "搜索分段…",
    fit: "⤢ 适应",
    follow: "◎ 跟随",
    zoomHint: "滚轮缩放 · 拖拽平移 · 点击色块看分析",
    replay: "回放",
    exitReplay: "退出回放",
    play: "播放",
    pause: "暂停",
    speed: "速度",

    empty: "暂无对话",
    emptyHint: "打开一个对话后，这里直接显示它的时间线与分析。",
    selectHint: "点击时间轴色块或左侧分段查看分析。",
    loading: "加载中…",
    noMatch: "没有匹配的分段（检查搜索/筛选）。",
    copy: "复制",
    copied: "已复制",
    lanes: { input: "输入", model: "模型", tools: "工具" },
    filters: { input: "输入", model: "模型", tools: "工具" },
    tabs: {
      overview: "概述",
      preview: "预览",
      raw: "原始内容",
      source: "来源",
    },
    status: { done: "已完成", running: "执行中", error: "失败" },
    f: {
      source: "来源",
      status: "状态",
      dur: "时长",
      len: "长度",
      pos: "位置",
      segs: "分段",
      msgKey: "消息",
      toolCall: "调用",
      conv: "对话",
      time: "时间",
    },
  },
  en: {
    title: "Recorded sequence",
    live: "committed page — not wall time",
    current: "active",
    search: "Filter loaded events…",
    fit: "⤢ Fit",
    follow: "◎ Follow",
    zoomHint: "wheel zoom · drag pan · click a block for analysis",
    replay: "Visual replay",
    exitReplay: "Exit replay",
    play: "Play",
    pause: "Pause",
    speed: "Speed",

    empty: "No recorded scope",
    emptyHint:
      "Select recorded events. More history remains available through the page controls.",
    selectHint: "Click a ruler block or a left segment for analysis.",
    loading: "Loading…",
    noMatch: "No matching segments (check search/filters).",
    copy: "Copy",
    copied: "Copied",
    lanes: { input: "Input", model: "Model", tools: "Tools" },
    filters: { input: "Input", model: "Model", tools: "Tools" },
    tabs: {
      overview: "Overview",
      preview: "Preview",
      raw: "Raw",
      source: "Source",
    },
    status: { done: "Done", running: "Running", error: "Failed" },
    f: {
      source: "Source",
      status: "Status",
      dur: "Duration",
      len: "Length",
      pos: "Position",
      segs: "Segments",
      msgKey: "Message",
      toolCall: "Call",
      conv: "Conversation",
      time: "Time",
    },
  },
};

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function fmtClock(t) {
  return `page event ${Math.floor(t / 1000) + 1}`;
}
function fmtDur(ms) {
  if (ms === undefined || ms === null) return "—";
  const s = Math.max(0, ms) / 1000;
  if (s < 1) return `${Math.round(ms)}ms`;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}
function chipFor(seg, lang) {
  if (seg.kind === "user") return lang === "zh" ? "用户" : "user";
  if (seg.kind === "thinking") return lang === "zh" ? "思考" : "think";
  if (seg.kind === "text") return lang === "zh" ? "回答" : "text";
  if (seg.kind === "file") return lang === "zh" ? "文件" : "file";
  if (seg.kind === "system") return lang === "zh" ? "系统" : "sys";
  if (seg.kind === "result") return lang === "zh" ? "结果" : "done";
  if (seg.kind === "tool") return (seg.meta?.tool ?? "tool").slice(0, 10);
  return seg.kind;
}

/* 工具配色：常用工具固定色（读=青、写=琥珀、bash=紫），其余按名哈希进调色板——同一工具永远同色。 */
const TOOL_PALETTE = [
  "#3b82f6",
  "#22c55e",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#818cf8",
  "#fb7185",
  "#eab308",
  "#14b8a6",
];
const TOOL_FIXED = {
  read: "#2dd4bf",
  get: "#2dd4bf",
  list: "#2dd4bf",
  glob: "#2dd4bf",
  grep: "#2dd4bf",
  search: "#2dd4bf",
  fetch: "#2dd4bf",
  cat: "#2dd4bf",
  show: "#2dd4bf",
  query: "#2dd4bf",
  edit: "#f59e0b",
  write: "#f59e0b",
  patch: "#f59e0b",
  apply: "#f59e0b",
  create: "#f59e0b",
  save: "#f59e0b",
  move: "#f59e0b",
  rename: "#f59e0b",
  bash: "#a78bfa",
};
function toolColor(name) {
  const n = String(name ?? "tool");
  if (TOOL_FIXED[n]) return TOOL_FIXED[n];
  let h = 0;
  for (let i = 0; i < n.length; i++) h = ((h << 5) - h + n.charCodeAt(i)) | 0;
  return TOOL_PALETTE[Math.abs(h) % TOOL_PALETTE.length];
}

/* 模型泳道内部分色：思考=浅天蓝，回答=正蓝（失败仍标红优先）。 */
const MODEL_COLORS = { thinking: "#38bdf8", text: "#3b82f6" };
function laneColor(seg) {
  if (seg.status === "error") return "#f87171";
  if (seg.lane === "tools")
    return toolColor(seg.meta?.tool ?? (seg.kind === "file" ? "file" : "tool"));
  if (seg.lane === "model" && (seg.kind === "thinking" || seg.kind === "text"))
    return MODEL_COLORS[seg.kind];
  return null;
}

export default {
  mount(container, ctx) {
    let lang = "en";
    let disposed = false;
    const t = () => I18N[lang];
    let convs = [];
    let activeId = null;
    let lastActiveId = null; // 上次见到的服务端 active：只在它变化时跟随，避免看历史时被拽走
    let selectedConvId = null;
    const segsCache = new Map(); // convId → light segs
    const detailCache = new Map(); // `${convId}\n${key}` → { detail, seg, analysis }
    const pendingSeg = new Set();
    let selectedKey = null;
    let pendingScroll = null; // selectSeg(scroll:true) 置位，下一帧渲染后把对应行滚进视野
    let detailTab = "overview";
    let search = "";
    const filters = { input: true, model: true, tools: true };
    const replay = {
      on: false,
      idx: 0,
      playing: false,
      speed: 1,
      raf: 0,
      basePos: 0,
      baseClock: 0,
    };
    let raf = 0;
    // vis-timeline 专业时间轴状态（懒加载 vendor，失败回退手写 div）
    let visApi = null;
    let visPromise = null;
    let tl = null;
    let tlItems = null;
    let tlDomEl = null;
    let tlConv = null;
    let vendorFailed = false;
    let redrawRaf = 0;
    let copyTimer = 0;
    let followEnabled = true;
    let suppressSelect = false;
    let tlRO = null;
    let roTimer = 0;

    function ensureVis() {
      if (!visPromise) {
        visPromise = (async () => {
          try {
            const mod = await import("vis-timeline/standalone");
            return { Timeline: mod.Timeline, DataSet: mod.DataSet };
          } catch {
            vendorFailed = true;
            return null;
          }
        })();
        visPromise.then((api) => {
          if (disposed) return;
          visApi = api;
          scheduleRender(false);
        });
      }
    }

    function tlDom() {
      if (!tlDomEl) tlDomEl = document.createElement("div");
      return tlDomEl;
    }

    function destroyTl() {
      hideTip();

      try {
        tl?.destroy();
      } catch {}
      tl = null;
      tlItems = null;
      tlConv = null;
    }

    container.innerHTML = `
<div class="rtr">

	<div class="rtr-hd">
		<h2>🧭 <span class="t-title"></span></h2>
		<span class="rtr-live"></span>
		<span class="sp"></span>
		<input type="search" class="q" />
		<button class="rtr-btn act-replay"></button>
		<button class="rtr-btn act-lang">EN</button>
		<button class="rtr-btn act-search-all">Search retained history</button>
        <button class="rtr-btn on" data-lane="input" aria-pressed="true">Owner/context</button>
        <button class="rtr-btn on" data-lane="model" aria-pressed="true">Messages</button>
        <button class="rtr-btn on" data-lane="tools" aria-pressed="true">Tools</button>
	</div>
	<div class="rtr-convs"></div>
	<div class="rtr-ruler"><div class="rtr-rulerbar"><span class="hint"></span><span class="sp"></span><button class="rtr-btn act-follow"></button><button class="rtr-btn act-fit"></button></div><div class="rtr-legend"></div><div class="rtr-tlbody"></div></div>
	<div class="rtr-replaybar" hidden></div>
	<div class="rtr-bd">
		<div class="rtr-list"></div>
		<div class="rtr-detail"></div>
	</div>
</div>`;

    const $ = (s) => container.querySelector(s);
    const hdTitle = $(".t-title"),
      hdLive = $(".rtr-live"),
      qEl = $(".q");
    const replayBtn = $(".act-replay"),
      langBtn = $(".act-lang"),
      searchAllBtn = $(".act-search-all");
    const convsEl = $(".rtr-convs"),
      rulerEl = $(".rtr-ruler"),
      replayBar = $(".rtr-replaybar");
    const listEl = $(".rtr-list"),
      detailEl = $(".rtr-detail");

    function applyLang() {
      const L = t();
      hdTitle.textContent = L.title;
      hdLive.textContent = `● ${L.live}`;
      qEl.placeholder = L.search;
      qEl.setAttribute("aria-label", L.search);
      replayBtn.textContent = replay.on ? `⏹ ${L.exitReplay}` : `▶ ${L.replay}`;
      replayBtn.classList.toggle("on", replay.on);
      langBtn.textContent = lang === "zh" ? "EN" : "中文";
    }

    function convOf(id) {
      return convs.find((c) => c.id === id);
    }
    function allSegs() {
      return segsCache.get(selectedConvId ?? "") ?? [];
    }
    function visibleSegs() {
      const q = search.trim().toLowerCase();
      return allSegs().filter((s) => {
        if (!filters[s.lane]) return false;
        if (
          q &&
          !`${s.title}\n${s.summary}\n${s.source}\n${s.meta?.tool ?? ""}`
            .toLowerCase()
            .includes(q)
        )
          return false;
        return true;
      });
    }

    function renderConvs() {
      const L = t();
      if (!convs.length) {
        convsEl.innerHTML = `<span style="opacity:.55;font-size:12px">${esc(L.emptyHint)}</span>`;
        return;
      }
      convsEl.innerHTML = convs
        .map(
          (c) =>
            `<button class="rtr-conv${c.id === selectedConvId ? " sel" : ""}" data-id="${esc(c.id)}">${c.id === activeId ? `<span class="cur">●</span> ` : ""}${esc(c.title || L.empty)}${c.isStreaming ? " ⏳" : ""}</button>`,
        )
        .join("");
    }

    function renderRuler() {
      const L = t();
      const hintEl = rulerEl.querySelector(".hint");
      const fitBtn = rulerEl.querySelector(".act-fit");
      const followBtn = rulerEl.querySelector(".act-follow");
      if (hintEl)
        hintEl.textContent = vendorFailed
          ? "Local timeline vendor unavailable — degraded ordinal preview only. Retained list/details remain available."
          : !visApi
            ? "Loading local timeline vendor…"
            : L.zoomHint;
      if (fitBtn) fitBtn.textContent = L.fit;
      if (followBtn) {
        followBtn.textContent = L.follow;
        followBtn.classList.toggle("on", followEnabled);
      }
      const body = rulerEl.querySelector(".rtr-tlbody");
      const all = visibleSegs();
      void ensureVis(); // 后台加载专业时间轴，备好后自动重渲
      // 容器不可见（宽高为 0，如视图切出/面板折叠）时不建轴——vis 会量到 0 高画瘪；
      // 先画手写占位，显现后由 ResizeObserver 触发重建，自愈。
      const sized = !!body && body.clientWidth > 0 && body.clientHeight > 0;
      if (!visApi || !selectedConvId || !all.length || !sized) {
        if (tl) destroyTl();
        if (body) renderRulerFallback(body, all);
        return;
      }
      if (body && body.firstChild !== tlDom()) {
        body.innerHTML = "";
        body.appendChild(tlDom());
      }
      const groups = [
        ...new Map(
          all.map((s) => [
            s.group,
            { id: s.group, content: esc(s.groupLabel) },
          ]),
        ).values(),
      ];
      if (!tl || tlConv !== selectedConvId) {
        destroyTl();
        tlItems = new visApi.DataSet(visItems(all));
        tl = new visApi.Timeline(tlDom(), tlItems, groups, {
          stack: true,
          orientation: "top",
          showMajorLabels: false,
          showCurrentTime: false,
          showMinorLabels: false,
          zoomable: true,
          moveable: true,
          selectable: true,
          multiselect: false,
          zoomMin: 10,
          zoomMax: 1000 * 60 * 60 * 24 * 30,
          margin: { item: 3, axis: 6 },
          tooltip: { followMouse: true, overflowMethod: "cap" },
          height: matchMedia("(max-width: 640px)").matches ? "200px" : "252px",
        });
        tl.on("select", (props) => {
          if (suppressSelect) return;
          const id = props.items?.[0];
          if (id === undefined) {
            // 点空白处：取消选中，回整对话分析。
            if (selectedKey) {
              selectedKey = null;
              scheduleRender(false);
            }
            return;
          }
          selectSeg(String(id), { scroll: true });
        });
        tl.on("rangechange", (props) => {
          // 缩放/平移进行中：按新窗口实时换算保底宽（rAF 节流），块始终贴合刻度。
          scheduleEpsSync();
          if (!props?.byUser) return;
          followEnabled = false;
          rulerEl.querySelector(".act-follow")?.classList.remove("on");
        });
        tl.on("rangechanged", () => {
          hideTip();
          scheduleEpsSync();
          if (replay.on) refreshPlayhead(false);
        });
        tl.on("itemover", (props) => {
          if (props.item !== undefined && props.event)
            showTip(String(props.item), props.event);
        });
        tl.on("itemout", () => hideTip());
        tlConv = selectedConvId;
        followEnabled = true;
        try {
          tl.fit({ animation: false });
        } catch {}
        scheduleEpsSync();
        // 建轴瞬间若布局还在抖动（如刚显现），下一帧重排一次兜底。
        redrawRaf = requestAnimationFrame(() => {
          try {
            if (!disposed && tl && tlConv === selectedConvId) tl.redraw();
          } catch {}
        });
      } else {
        try {
          tl.setGroups(groups);
          tlItems.clear();
          tlItems.add(visItems(all));
        } catch {}
        // 用户手动看历史（跟随关）时不碰窗口——毫秒级缩放也不会被拽回。
        if (followEnabled && !replay.on) {
          const last = all.at(-1);
          if (last) tl.moveTo(last.t, { animation: false });
        }
      }
      try {
        suppressSelect = true;
        tl.setSelection(selectedKey ? [selectedKey] : []);
      } catch {
      } finally {
        suppressSelect = false;
      }
    }

    /** 即时浮层（itemover 当帧展示，无原生 title 的延迟；离开/缩放即藏）。 */
    function showTip(key, ev) {
      const s = allSegs().find((x) => x.key === key);
      if (!s) return;
      let tip = container.querySelector(".rtr-tip");
      if (!tip) {
        tip = document.createElement("div");
        tip.className = "rtr-tip";
        container.appendChild(tip);
      }
      tip.innerHTML = `<div class="tt">${esc(s.title)}</div><div class="tm">${esc(s.source ?? "")}</div><div class="tm">${esc(fmtClock(s.t))}${s.dur !== undefined ? ` · ${esc(fmtDur(s.dur))}` : ""}${s.end > s.t ? ` → ${esc(fmtClock(s.end))}` : ""}</div>`;
      tip.style.display = "block";
      const r = container.getBoundingClientRect();
      const x = Math.min(
        Math.max(8, (ev.clientX ?? 0) - r.left + 14),
        Math.max(8, r.width - 330),
      );
      const y = Math.min(
        Math.max(8, (ev.clientY ?? 0) - r.top + 16),
        Math.max(8, r.height - 90),
      );
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    }

    function hideTip() {
      container.querySelector(".rtr-tip")?.remove();
    }

    /* Ordinal display geometry only; no execution timing inference. */
    const MIN_SLIVER_PX = 2;

    function spanMs(all) {
      if (!all.length) return 1;
      let min = Infinity,
        max = -Infinity;
      for (const s of all) {
        if (s.t < min) min = s.t;
        const e = Math.max(s.end ?? s.t, s.t);
        if (e > max) max = e;
      }
      return Math.max(1, max - min);
    }

    /** 时间轴实际画条目的区域宽度（px）：扣除左侧泳道标签列。 */
    function tlDrawWidth() {
      try {
        const w = tlDom().clientWidth || 800;
        const lab = tlDom().querySelector(".vis-labelset");
        return Math.max(50, w - (lab ? lab.getBoundingClientRect().width : 0));
      } catch {
        return 800;
      }
    }

    /** 当前缩放窗口下 MIN_SLIVER_PX 像素对应的毫秒数（0 = 窗口未知，调用方兜底）。 */
    function currentEps() {
      try {
        if (!tl) return 0;
        const w = tl.getWindow?.();
        if (!w) return 0;
        const a = w.start instanceof Date ? w.start.getTime() : Number(w.start);
        const b = w.end instanceof Date ? w.end.getTime() : Number(w.end);
        const span = Math.max(1, (b || 0) - (a || 0));
        return (span * MIN_SLIVER_PX) / tlDrawWidth();
      } catch {
        return 0;
      }
    }

    /* Ordinal display geometry only; no execution timing inference. */
    function syncDisplayEnds() {
      try {
        if (!tlItems || !tl) return;
        const eps = currentEps();

        // 抖动阀值：小于 0.25px 的差异不值得触发一次 vis 重绘（逐帧调用时能省下大量重排）。
        const thr = Math.max(0.5, eps / 8);
        const upd = [];
        for (const s of visibleSegs()) {
          const startMs = s.t;
          const realEnd = Math.max(s.end ?? startMs, startMs);
          const want = Math.max(realEnd, startMs + eps);
          const cur = tlItems.get(s.key)?.end;
          const curMs =
            cur instanceof Date ? cur.getTime() : Number(cur ?? realEnd);
          if (Math.abs(curMs - want) > thr)
            upd.push({ id: s.key, end: new Date(want) });
        }
        if (upd.length) tlItems.update(upd);
      } catch {
        /* 缩放中间态兜底 */
      }
    }

    let epsRaf = 0;
    function scheduleEpsSync() {
      if (epsRaf) return;
      epsRaf = requestAnimationFrame(() => {
        epsRaf = 0;
        syncDisplayEnds();
      });
    }

    /* Ordinal display geometry only; no execution timing inference. */
    function visItems(all) {
      const eps = currentEps() || Math.max(1, spanMs(all) * 0.0001);

      return all.map((s) => {
        const startMs = s.t;
        const realEnd = Math.max(s.end ?? startMs, startMs);
        // Minimum visible ordinal sliver, never an inferred running duration.
        const endMs = Math.max(realEnd, startMs + eps);
        const err = s.status === "error";
        const cls = `lane-${s.lane}${err ? " st-error" : ""}${s.status === "running" ? " st-running" : ""}`;
        // 按泳道/类型着色（失败仍标红）；内联 style 覆盖泳道底色。
        const color = laneColor(s);
        const style = color
          ? `background-color:${color};border-color:${color};`
          : undefined;
        return {
          id: s.key,
          group: s.group,
          start: new Date(startMs),
          end: new Date(endMs),
          type: "range",
          content: "",
          className: cls,
          ...(style ? { style } : {}),
        };
      });
    }

    /** Explicit degraded ordinal view while the local vendor is unavailable; no CDN. */
    function renderRulerFallback(body, all) {
      const L = t();
      if (tl) destroyTl();
      if (!selectedConvId || !all.length) {
        body.innerHTML = ["input", "model", "tools"]
          .map(
            (ln) =>
              `<div class="rtr-lane"><span class="ln">${esc(L.lanes[ln])}</span><div class="rtr-track"></div></div>`,
          )
          .join("");
        body._vis = null;
        return;
      }
      const minT = Math.min(...all.map((s) => s.t));
      const maxT = Math.max(...all.map((s) => Math.max(s.end ?? s.t, s.t)));
      const span = Math.max(1, maxT - minT);
      const total = vendorFailed
        ? "Degraded: local vendor unavailable; ordinal preview only"
        : "Ordinal preview — not wall/native time";
      // 手写轴同样像素级保底（≈MIN_SLIVER_PX 随容器宽度换算），不歪曲刻度。
      const pxW = body.clientWidth;
      const minSpanMs = pxW > 0 ? span * (MIN_SLIVER_PX / pxW) : 0;
      const lanes = ["input", "model", "tools"];
      body.innerHTML = `
<div class="rtr-axis"><span>${esc(fmtClock(minT))}</span><span>${esc(total)}</span><span>${esc(fmtClock(maxT))}</span></div>
${lanes
  .map((ln) => {
    const blocks = all
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.lane === ln);
    return `<div class="rtr-lane"><span class="ln">${esc(L.lanes[ln])}</span><div class="rtr-track">${blocks
      .map(({ s, i }) => {
        const left = ((s.t - minT) / span) * 100;
        const realEnd = Math.max(s.end ?? s.t, s.t);
        const end = Math.max(realEnd, s.t + minSpanMs);
        const width = ((end - s.t) / span) * 100;
        const color = laneColor(s);
        return `<span class="rtr-blk lane-${ln}${s.status === "error" ? " st-error" : ""}${s.status === "running" ? " st-running" : ""}${s.key === selectedKey ? " sel" : ""}" data-i="${i}" title="${esc(s.title)}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%${color ? `;background-color:${color};border-color:${color}` : ""}"></span>`;
      })
      .join("")}</div></div>`;
  })
  .join("")}`;
      body._vis = all;
    }

    function renderList() {
      const L = t();
      const all = visibleSegs();
      if (!selectedConvId) {
        listEl.innerHTML = `<div class="rtr-empty">${esc(L.selectHint)}</div>`;
        return;
      }
      if (!all.length) {
        listEl.innerHTML = `<div class="rtr-empty">${esc(allSegs().length ? L.noMatch : L.emptyHint)}</div>`;
        return;
      }
      const shown = replay.on ? all.slice(0, replay.idx + 1) : all;
      listEl.innerHTML = shown
        .map((s) => {
          const tc =
            s.status === "error"
              ? null
              : s.kind === "tool"
                ? toolColor(s.meta?.tool ?? "tool")
                : s.kind === "thinking" || s.kind === "text"
                  ? MODEL_COLORS[s.kind]
                  : null;
          return `<button class="rtr-row${s.key === selectedKey ? " sel" : ""}${s.status === "error" ? " err" : ""}" data-key="${esc(s.key)}">
<span class="rtr-chip"${tc ? ` style="border-color:${tc};color:${tc}"` : ""}>${esc(chipFor(s, lang))}</span>
<span class="tt">${esc(s.title)}</span>
<time>${esc(fmtClock(s.t))}${s.dur !== undefined ? ` · ${esc(fmtDur(s.dur))}` : ""}</time>
</button>`;
        })
        .join("");
      renderReplayBar(all);
    }

    /** 工具图例：当前视图出现的工具 × 颜色（与时间轴色块同色）。 */
    function renderLegend() {
      const el = rulerEl.querySelector(".rtr-legend");
      if (!el) return;
      const vis = visibleSegs();
      const seen = new Map();
      if (vis.some((s) => s.kind === "thinking"))
        seen.set(lang === "zh" ? "思考" : "think", MODEL_COLORS.thinking);
      if (vis.some((s) => s.kind === "text"))
        seen.set(lang === "zh" ? "回答" : "text", MODEL_COLORS.text);
      for (const s of vis) {
        if (s.lane !== "tools" || s.status === "error") continue;
        const name = s.meta?.tool ?? (s.kind === "file" ? "file" : null);
        if (!name || seen.has(name)) continue;
        seen.set(name, toolColor(name));
      }
      el.innerHTML = [...seen.entries()]
        .map(
          ([n, c]) =>
            `<span class="lg-item"><i style="background:${c}"></i>${esc(n)}</span>`,
        )
        .join("");
      el.style.display = seen.size ? "" : "none";
    }

    function renderReplayBar(all) {
      const L = t();
      if (!replay.on || !all.length) {
        replayBar.hidden = true;
        replayBar.innerHTML = "";
        return;
      }
      replayBar.hidden = false;
      const maxIdx = Math.max(0, all.length - 1);
      const idx = Math.min(replay.idx, maxIdx);
      replayBar.innerHTML = `
<button class="rtr-btn act-play">${replay.playing ? `⏸ ${esc(L.pause)}` : `▶ ${esc(L.play)}`}</button>
<input type="range" aria-label="Visual replay position" min="0" max="${maxIdx}" value="${idx}" />
<span>${idx + 1}/${all.length}</span>
<label>${esc(L.speed)} <select class="spd">${[0.5, 1, 2, 4].map((x) => `<option value="${x}"${x === replay.speed ? " selected" : ""}>${x}x</option>`).join("")}</select></label>`;
    }

    function kvRow(k, v) {
      return `<dt>${esc(k)}</dt><dd>${v}</dd>`;
    }

    function renderDetail() {
      const L = t(),
        F = L.f;
      const c = convOf(selectedConvId ?? "");
      const seg = allSegs().find((s) => s.key === selectedKey) ?? null;
      const cached = seg
        ? detailCache.get(`${selectedConvId}\n${seg.key}`)
        : null;

      if (!seg || !c) {
        detailEl.innerHTML = `<div class="rtr-empty">${esc(c ? L.selectHint : L.emptyHint)}</div>`;
        return;
      }
      // 有选中 → 四 tab
      const tabs = ["overview", "preview", "raw", "source"]
        .map(
          (k) =>
            `<button class="rtr-dtab${detailTab === k ? " on" : ""}" data-tab="${k}">${esc(L.tabs[k])}</button>`,
        )
        .join("");
      let body = "";
      if (!cached) {
        body = `<div class="rtr-empty"><span class="rtr-spin">⏳</span> ${esc(L.loading)}</div>`;
      } else if (detailTab === "overview") {
        const an = cached.analysis ?? {};
        const st = L.status[seg.status] ?? seg.status;
        body = `<dl class="rtr-kv">
${kvRow("Recorded clock", esc(seg.clock))}${kvRow(F.source, esc(seg.source ?? "—"))}${kvRow(F.status, esc(st))}${kvRow("Native check elapsed (otherwise unavailable)", esc(fmtDur(seg.dur)))}
${kvRow(F.len, esc(seg.meta?.chars ? `${seg.meta.chars} 字` : `${(cached.detail ?? "").length} 字`))}${kvRow(F.pos, esc(an.position ?? "—"))}
</dl>`;
        body += `<div class="rtr-sec">${esc(L.tabs.preview)}</div><pre>${esc((cached.detail ?? "").slice(0, 800))}</pre>`;
      } else if (detailTab === "preview") {
        body = `<pre>${esc((cached.detail ?? "").slice(0, 2000))}</pre>`;
      } else if (detailTab === "raw") {
        body = `<pre>${esc(cached.detail ?? "")}</pre><p>Recorded event metadata; long fields are independently paged.</p><button class="rtr-btn act-open-detail">Inspect retained fields</button><button class="rtr-btn act-copy">📋 ${esc(L.copy)}</button>`;
      } else {
        body = `<dl class="rtr-kv">
${kvRow(F.msgKey, esc(seg.key))}${seg.meta?.toolCallId ? kvRow(F.toolCall, esc(seg.meta.toolCallId)) : ""}

${kvRow(F.conv, esc(`${c.title ?? ""} · ${String(c.id).slice(0, 8)}`))}${kvRow(F.time, esc(fmtClock(seg.t)))}
</dl>`;
      }
      detailEl.innerHTML = `<h3 style="margin:0 0 8px">${esc(seg.title)}</h3><div class="rtr-dtabs">${tabs}</div>${body}`;
    }

    function scheduleRender(stick = true) {
      if (disposed || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const keep =
          stick &&
          !replay.on &&
          listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80;
        const focused = document.activeElement;
        const selector =
          focused && container.contains(focused)
            ? focused.matches(".rtr-row[data-key]")
              ? `.rtr-row[data-key="${CSS.escape(focused.dataset.key)}"]`
              : focused.matches(".rtr-conv[data-id]")
                ? `.rtr-conv[data-id="${CSS.escape(focused.dataset.id)}"]`
                : focused.matches(".rtr-dtab[data-tab]")
                  ? `.rtr-dtab[data-tab="${CSS.escape(focused.dataset.tab)}"]`
                  : focused.matches(".rtr-replaybar input[type=range]")
                    ? ".rtr-replaybar input[type=range]"
                    : focused.matches(".spd")
                      ? ".spd"
                      : focused.matches(".act-play")
                        ? ".act-play"
                        : null
            : null;
        renderConvs();
        renderRuler();
        renderLegend();
        renderList();
        if (pendingScroll) {
          const k = pendingScroll;
          pendingScroll = null;
          const q =
            typeof CSS !== "undefined" && CSS.escape ? CSS.escape(k) : k;
          const row = listEl.querySelector(`[data-key="${q}"]`);
          if (row) row.scrollIntoView({ block: "nearest" });
        }
        renderDetail();
        // Reused string renderers replace buttons. Restore the exact focused
        // control, not whichever event the replay selected in the meantime.
        if (selector && !focused.isConnected)
          container.querySelector(selector)?.focus({ preventScroll: true });
        if (keep) listEl.scrollTop = listEl.scrollHeight;
      });
    }

    function selectConv(id) {
      selectedConvId = id;
      selectedKey = null;
      replay.on = false;
      stopPlay();
      followEnabled = true;
      applyLang();
      if (id && !segsCache.has(id)) ctx.readSegments(id);
      scheduleRender(false);
    }

    function selectSeg(key, opts = {}) {
      hideTip();
      if (key === selectedKey && !opts.force) {
        // 再次点击同一分段：取消选中，回整对话分析。
        selectedKey = null;
        scheduleRender(false);
        return;
      }
      selectedKey = key;
      if (replay.on) {
        const i = visibleSegs().findIndex((s) => s.key === key);
        if (i >= 0) replay.idx = i;
      }
      const ck = `${selectedConvId}\n${key}`;
      if (key && !detailCache.has(ck) && !pendingSeg.has(ck)) {
        pendingSeg.add(ck);
        ctx.readSegment(selectedConvId, key);
      }
      if (opts.scroll) pendingScroll = key;
      scheduleRender();
    }

    // Visualization clock only: one fixed step per recorded fact, never work/idle time.
    const REPLAY_PREFETCH = 12;
    function replayTrack() {
      const all = visibleSegs();
      return {
        segs: all.map((seg, i) => ({ seg, p0: i * 1000, p1: (i + 1) * 1000 })),
        totalLen: all.length * 1000,
      };
    }
    function activeIndexAt(track, pos) {
      let idx = -1;
      for (let i = 0; i < track.segs.length; i++) {
        if (track.segs[i].p0 <= pos) idx = i;
        else break;
      }
      return idx;
    }
    function ordinalAt(track, _pos, idx) {
      return track.segs[Math.max(0, idx)]?.seg.t ?? 0;
    }
    function currentPos(track) {
      if (!replay.playing) return replay.basePos;
      return Math.min(
        track.totalLen,
        replay.basePos + (performance.now() - replay.baseClock) * replay.speed,
      );
    }
    /** 播放头竖线：叠加在 vis 时间轴上方，按当前窗口换算 x。 */
    function playheadShow(realMs) {
      try {
        if (!tl) return;
        let el = tlDom().querySelector(".rtr-playhead");
        if (!el) {
          tlDom().style.position = "relative";
          el = document.createElement("div");
          el.className = "rtr-playhead";
          tlDom().appendChild(el);
        }
        const w = tl.getWindow?.();
        if (!w) return;
        const a = w.start instanceof Date ? w.start.getTime() : Number(w.start);
        const b = w.end instanceof Date ? w.end.getTime() : Number(w.end);
        const span = Math.max(1, (b || 0) - (a || 0));
        const dw = tlDrawWidth();
        const left = (tlDom().clientWidth || dw) - dw; // 左侧标签列宽
        el.style.left = `${left + ((realMs - a) / span) * dw}px`;
        el.style.display = "block";
      } catch {}
    }
    function playheadHide() {
      const el = tlDom().querySelector(".rtr-playhead");
      if (el) el.style.display = "none";
    }
    /** 播放头越出可视窗口时把窗口跟过去（moveTo 保持缩放、仅平移）。 */
    function ensurePlayheadVisible(realMs) {
      try {
        if (!tl) return;
        const w = tl.getWindow?.();
        if (!w) return;
        const a = w.start instanceof Date ? w.start.getTime() : Number(w.start);
        const b = w.end instanceof Date ? w.end.getTime() : Number(w.end);
        const margin = (b - a) * 0.08;
        if (realMs < a + margin || realMs > b - margin)
          tl.moveTo(realMs, { animation: false });
      } catch {}
    }
    /** 按当前播放位置刷新播放头（follow 时越界自动跟随窗口）。 */
    function refreshPlayhead(follow) {
      const tr = replayTrack();
      if (!tr.segs.length) {
        playheadHide();
        return;
      }
      const pos = currentPos(tr);
      const idx = activeIndexAt(tr, pos);
      const rt = ordinalAt(tr, pos, idx);
      playheadShow(rt);
      if (follow) ensurePlayheadVisible(rt);
    }
    function stopPlay() {
      if (replay.playing) {
        // 记住暂停点，下次继续从这走
        const tr = replayTrack();
        if (tr.segs.length) replay.basePos = currentPos(tr);
      }
      replay.playing = false;
      if (replay.raf) cancelAnimationFrame(replay.raf);
      replay.raf = 0;
    }
    function startPlay() {
      stopPlay();
      const tr = replayTrack();
      if (!tr.segs.length) return;
      replay.basePos = Math.max(0, Math.min(tr.totalLen, replay.basePos));
      replay.baseClock = performance.now();
      replay.playing = true;
      replay.raf = requestAnimationFrame(replayTick);
    }
    function replayTick() {
      if (!replay.playing) return;
      const tr = replayTrack();
      if (!tr.segs.length) {
        stopPlay();
        return;
      }
      const pos = currentPos(tr);
      const idx = activeIndexAt(tr, pos);
      if (idx >= 0) {
        replay.idx = idx;
        const key = tr.segs[idx].seg.key;
        if (key !== selectedKey) {
          selectedKey = key;
          pendingScroll = key; // 列表跟随滚动到激活行（推进时底部跟着走）
          scheduleRender();
        }
        // Prefetch only loaded recorded facts for the visualization steps.
        const end = Math.min(tr.segs.length, idx + REPLAY_PREFETCH);
        for (let k = idx; k < end; k++) {
          const kk = tr.segs[k].seg.key;
          const ck = `${selectedConvId}\n${kk}`;
          if (kk && !detailCache.has(ck) && !pendingSeg.has(ck)) {
            pendingSeg.add(ck);
            ctx.readSegment(selectedConvId, kk);
          }
        }
      }
      const rt = ordinalAt(tr, pos, idx);
      playheadShow(rt);
      ensurePlayheadVisible(rt);
      if (pos >= tr.totalLen) {
        // 播完：停在最后一段（播放头保留）。
        stopPlay();
        scheduleRender();
        return;
      }
      replay.raf = requestAnimationFrame(replayTick);
    }

    // ---- 事件 ----
    convsEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (b) selectConv(b.dataset.id);
    });
    rulerEl.addEventListener("click", (e) => {
      if (e.target.closest(".act-follow")) {
        followEnabled = !followEnabled;
        if (followEnabled) {
          const latest = visibleSegs().at(-1);
          if (latest) tl?.moveTo(latest.t, { animation: false });
        }
        e.target.closest(".act-follow").classList.toggle("on", followEnabled);

        return;
      }
      if (e.target.closest(".act-fit")) {
        try {
          tl?.fit({ animation: true });

          // 看全部 = 明确要总览，暂停跟随（再点“跟随”回去）。
          followEnabled = false;
          rulerEl.querySelector(".act-follow")?.classList.remove("on");
        } catch {}
        return;
      }
      if (tl) return; // 专业时间轴自己处理 select
      const body = rulerEl.querySelector(".rtr-tlbody");
      const b = e.target.closest("[data-i]");
      if (b && body?._vis) {
        const s = body._vis[Number(b.dataset.i)];
        if (s) selectSeg(s.key, { scroll: true });
      }
    });
    listEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-key]");
      if (b) selectSeg(b.dataset.key, { scroll: true });
    });
    detailEl.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) {
        detailTab = tab.dataset.tab;
        scheduleRender();
        return;
      }
      if (e.target.closest(".act-open-detail")) {
        ctx.openDetail(selectedConvId, selectedKey);
        return;
      }
      if (e.target.closest(".act-copy")) {
        const cached = detailCache.get(`${selectedConvId}\n${selectedKey}`);
        const txt = cached ? `${cached.seg.title}\n${cached.detail}` : "";
        if (txt) {
          navigator.clipboard?.writeText(txt).then(
            () => {
              if (disposed) return;
              e.target.textContent = `✅ ${t().copied}`;
              copyTimer = setTimeout(scheduleRender, 1200);
            },
            () => {},
          );
        }
      }
    });
    qEl.addEventListener("input", () => {
      search = qEl.value;
      scheduleRender();
    });
    replayBtn.addEventListener("click", () => {
      if (!selectedConvId) return;
      replay.on = !replay.on;
      stopPlay();
      if (replay.on) {
        replay.idx = 0;
        replay.basePos = 0;
        selectedKey = null;
        const tr = replayTrack();
        const first = tr.segs[0];
        if (first) {
          selectedKey = first.seg.key;
          playheadShow(first.seg.t);
          selectSeg(first.seg.key, { force: true });
        }
      } else {
        playheadHide();
        // Exit visual replay and follow the last loaded ordinal again.
        followEnabled = true;
      }
      applyLang();
      scheduleRender(false);
    });
    replayBar.addEventListener("click", (e) => {
      if (e.target.closest(".act-play")) {
        if (replay.playing) stopPlay();
        else startPlay();
        scheduleRender();
      }
    });
    replayBar.addEventListener("input", (e) => {
      if (e.target.matches('input[type="range"]')) {
        stopPlay();
        const tr = replayTrack();
        const i = Number(e.target.value);
        replay.idx = i;
        const it = tr.segs[i];
        replay.basePos = it ? it.p0 : 0;
        selectedKey = it ? it.seg.key : null;
        if (it) playheadShow(it.seg.t);
        scheduleRender();
      }
    });
    replayBar.addEventListener("change", (e) => {
      if (e.target.matches(".spd")) {
        replay.speed = Number(e.target.value);
        if (replay.playing) startPlay();
      }
    });
    langBtn.addEventListener("click", () => {
      lang = lang === "zh" ? "en" : "zh";
      applyLang();
      scheduleRender();
    });
    searchAllBtn.addEventListener("click", () => ctx.searchHistory());
    for (const button of container.querySelectorAll("[data-lane]")) {
      button.addEventListener("click", () => {
        const lane = button.dataset.lane;
        filters[lane] = !filters[lane];
        button.classList.toggle("on", filters[lane]);
        button.setAttribute("aria-pressed", String(filters[lane]));
        scheduleRender(false);
      });
    }

    const off = ctx.onData((p) => {
      if (disposed || !p || typeof p !== "object") return;
      switch (p.kind) {
        case "state": {
          convs = p.conversations; // supplied by the finite typed bridge, not a wire decoder
          const prevActive = lastActiveId;
          activeId = p.activeId ?? null;
          lastActiveId = activeId;
          // active 变化（切对话/新对话/首次加载）→ 跟随到当前对话；
          // active 没变时不动——用户可能正手动看历史，被重复 state 拽走很烦。
          if (
            activeId &&
            activeId !== selectedConvId &&
            (activeId !== prevActive ||
              !convs.some((c) => c.id === selectedConvId))
          ) {
            selectConv(activeId);
            return;
          }
          scheduleRender();
          break;
        }
        case "segs": {
          if (!p.convId || !Array.isArray(p.segs)) break;
          if (p.reset || !segsCache.has(p.convId))
            segsCache.set(p.convId, [...p.segs]);
          else segsCache.get(p.convId).push(...p.segs);
          if (
            p.convId === selectedConvId &&
            !selectedKey &&
            p.segs.length &&
            !replay.on
          ) {
            selectedKey = p.segs[p.segs.length - 1].key;
            selectSeg(selectedKey, { force: true });
            return;
          }
          scheduleRender();
          break;
        }
        case "seg_detail":
          if (p.key) {
            const ck = `${p.convId}\n${p.key}`;
            pendingSeg.delete(ck);
            detailCache.set(ck, {
              detail: String(p.detail ?? ""),
              seg: p.seg,
              analysis: p.analysis,
            });
            if (p.convId === selectedConvId && p.key === selectedKey)
              scheduleRender(false);
          }
          break;
        default:
          break;
      }
    });

    // 容器尺寸变化（视图显隐/侧栏伸缩/窗口缩放）→ 触发重排，隐藏时建的瘪轴自动重建。
    try {
      const roBody = rulerEl.querySelector(".rtr-tlbody");
      if (roBody && typeof ResizeObserver !== "undefined") {
        tlRO = new ResizeObserver(() => {
          if (roTimer) return;
          roTimer = setTimeout(() => {
            roTimer = 0;
            scheduleRender(false);
          }, 150);
        });
        tlRO.observe(roBody);
      }
    } catch {}

    applyLang();
    scheduleRender(false);
    ctx.readState();

    return () => {
      disposed = true;
      stopPlay();

      if (redrawRaf) cancelAnimationFrame(redrawRaf);
      if (copyTimer) clearTimeout(copyTimer);
      if (raf) cancelAnimationFrame(raf);
      if (epsRaf) cancelAnimationFrame(epsRaf);
      if (roTimer) clearTimeout(roTimer);
      try {
        tlRO?.disconnect();
      } catch {}
      tlRO = null;
      destroyTl();
      off();
      container.innerHTML = "";
    };
  },
};
