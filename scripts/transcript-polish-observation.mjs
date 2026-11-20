// Optional optical fixture, not a release check. Register one call per
// transcript-polish:<theme>:<width> in qualify-optical. Only the synthetic
// GETs below differ from the shared site; no actions, owner or provider.
import assert from "node:assert/strict";
import { STEP_READ } from "../src/service/contracts/workbench.ts";
import {
  contrastPixels,
  controlGeometry,
  glyphSample,
} from "./optical-fixtures/measure.mjs";
import {
  epoch,
  liveDock,
  project,
  readRecord,
} from "./optical-fixtures/records.mjs";

const traceId = "polish-trace";
const bookId = "polish-reading";
const pausedId = "polish-paused";
const windowId = "polish-window";
const longBookId = "polish-long-index";
const transcriptIds = [traceId, bookId, pausedId, windowId, longBookId];
const agentChatId = "live-dock";
const finalLine = "The last sentence is readable.";
const pages = Array.from({ length: 8 }, (_, i) => ({
  id: `question-${i}`,
  entry: `answer-${i}`,
  text: `Material question ${i + 1}?`,
}));
const paths = Array.from({ length: 15 }, (_, i) =>
  i === 0
    ? `materials/${"alabaster/".repeat(48)}quartz.ts`
    : i === 1
      ? ""
      : `panel-${i}.ts`,
);
const dense = "Alabaster quartz field notes. Silver chalk and opal. ".repeat(
  120,
);
const step = (id, role, fields) => ({
  id,
  role,
  renderId: id,
  name: "",
  target: "",
  text: "",
  clipped: false,
  error: false,
  parts: 0,
  state: "completed",
  ...fields,
});
const tool = (target, i, state = "completed") =>
  step(`call-${i}`, "tool", { name: "read", parts: 1, state, target });
function traceSteps(revision) {
  const results = paths.map((p, i) => tool(p, i));
  results.splice(
    7,
    0,
    step("unavailable-thought", "thinking", { state: "unavailable" }),
  );
  return [
    step("trace-question", "user", { text: "Compare the recorded materials." }),
    ...results,
    tool("joining.ts", 15, revision ? "completed" : "running"),
    tool("failed.ts", 16, "failed"),
    tool("unknown.ts", 17, "unavailable"),
    tool("waiting.ts", 18, "pending"),
    tool("active.ts", 19, "running"),
    step("first-prose", "assistant", { text: "Findings begin here." }),
    tool("one.ts", 20),
    tool("two.ts", 21),
    step("final-prose", "assistant", {
      text: `Recorded material.\n\n${(`${"Quartz and silver. ".repeat(35)}\n\n`).repeat(5 + revision)}Revision ${revision}.`,
      state: "streaming",
    }),
  ];
}

function pausedSteps(settled, growing = false) {
  return [
    step("trace-question", "user", { text: "Look at the first two results." }),
    tool("visible-first.ts", 0),
    tool("visible-second.ts", 1),
    tool("third.ts", 2, settled ? "completed" : "running"),
    step("long-answer", "assistant", { text: dense }),
    tool("offscreen.ts", 3),
    tool("also-offscreen.ts", 4, settled ? "completed" : "running"),
    step("last-answer", "assistant", {
      text: growing
        ? `Finished.\n\n${dense}\n\nFollowing again.`
        : settled
          ? "Finished."
          : "More to come.",
    }),
  ];
}

/** Only synthetic, bounded public read results. Other requests (including
 * model/context) keep the shared fixture behavior. No action interceptor. */
function readFixture(
  q,
  {
    revision,
    settled,
    growing,
    agentPhase,
    windowGrown,
    windowFork,
    turnReads,
  },
) {
  const { id, kind } = q;
  if (
    kind === "workflow-transcript" &&
    id === liveDock.id &&
    q.stepId === liveDock.steps[0].id
  )
    return {
      kind,
      runId: id,
      stepId: q.stepId,
      turn: {
        id: liveDock.steps[0].childRunId,
        epoch,
        status: "running",
        notice: "",
        omitted: { thinking: false, media: false, other: false },
        items: pausedSteps(agentPhase >= 1, agentPhase >= 2).map(
          ({ id, renderId, role, name, text, state, target, error }) => ({
            id,
            renderId,
            role,
            name,
            state,
            error,
            text:
              role === "tool" && state === "completed"
                ? "Retained result."
                : text,
            args: target ? JSON.stringify({ path: target }) : "",
          }),
        ),
      },
    };
  if (!transcriptIds.includes(id)) return null;
  if (id === pausedId && kind === "cadence-conversation") {
    const { proposal } = readRecord({ id: "design", kind }).state;
    return {
      kind,
      state: {
        id,
        enabled: true,
        revision: 1,
        head: null,
        runs: [],
        proposal: {
          ...proposal,
          model: {
            ...proposal.model,
            conversation: { ...proposal.model.conversation, id },
          },
        },
      },
    };
  }
  const live = id === traceId || id === pausedId;
  const book =
    id === longBookId
      ? Array.from({ length: 120 }, (_, i) => ({
          id: `long-${i}`,
          entry: `long-answer-${i}`,
          text: `Indexed question ${i + 1}`,
        }))
      : id === windowId
        ? [pages[0], ...(windowGrown ? [pages[windowFork ? 2 : 1]] : [])]
        : pages;
  const leaf = live ? "trace-leaf" : book.at(-1).entry;
  const status =
    live || (id === windowId && !windowFork) ? "running" : "completed";
  if (kind === "conversation")
    return {
      kind,
      summary: {
        id,
        title: live ? "Mixed recorded steps" : "Reading specimen",
        leaf,
        status,
        origin: "webui",
        updatedAt: 1,
      },
      leaf,
      continues: !(id === windowId && windowFork && q.known === pages[1].entry),
      turns: live ? 1 : book.length,
      branches: 1,
      runs: [],
      attempt: null,
    };
  if (kind === "conversation-tree")
    return {
      kind,
      conversationId: id,
      nodes: live
        ? []
        : book.map(({ id, text }, i) => ({
            id,
            text,
            parent: pages[i - 1]?.id ?? null,
            leaf,
            current: true,
            at: i + 1,
          })),
      truncated: false,
    };
  if (kind === "conversation-turn") {
    const page = live ? { id: "trace-question", entry: null } : book[q.ordinal];
    const turnStatus =
      id === windowId && windowGrown && q.ordinal === 0 ? "completed" : status;
    const steps = live
      ? id === pausedId
        ? pausedSteps(settled, growing)
        : traceSteps(revision)
      : id === windowId && q.ordinal === 0
        ? [
            step(page.id, "user", {
              renderId: "stable-window-turn",
              text: page.text,
            }),
            ...["first", "second", "third"].map((name, i) =>
              tool(`${name}.ts`, i),
            ),
            step("prose", "assistant", { text: "Between groups." }),
            tool("other-one.ts", 4),
            tool("other-two.ts", 5),
            step("closing", "assistant", {
              text: "End of this trace.",
              state: windowGrown ? "completed" : "streaming",
            }),
          ]
        : [
            step(page.id, "user", { text: page.text }),
            step(page.entry, "assistant", {
              text:
                id === windowId
                  ? Array.from(
                      { length: 160 },
                      (_, i) => `More observations from layer ${i}.`,
                    ).join("\n\n")
                  : q.ordinal >= book.length - 2
                    ? `${dense}\n\n${finalLine}`
                    : `Answer ${q.ordinal + 1}.`,
            }),
          ];
    if (!live && id !== windowId) turnReads.push(q.ordinal);
    const end = q.before ?? steps.length,
      start = Math.max(0, end - STEP_READ);
    return {
      kind,
      conversationId: id,
      leaf,
      ordinal: q.ordinal,
      start,
      steps: steps.slice(start, end),
      turn: {
        id: page.id,
        entry: page.entry,
        status: turnStatus,
        at: q.ordinal + 1,
        steps: steps.length,
        stable: turnStatus === "running" ? 0 : steps.length,
        omitted: { thinking: false, media: false, other: false },
        notice: "",
      },
    };
  }
  if (kind === "conversation-step") {
    assert.ok(live, `Unexpected ${kind} for ${id}`);
    const s = (
      id === pausedId ? pausedSteps(settled, growing) : traceSteps(revision)
    )[q.step];
    assert.ok(
      Number.isInteger(q.step) &&
        s?.role === "tool" &&
        q.turnId === "trace-question" &&
        q.part === 0 &&
        q.leaf === leaf,
    );
    return {
      kind,
      conversationId: id,
      leaf,
      turnId: q.turnId,
      step: q.step,
      part: q.part,
      item: {
        id: s.id,
        renderId: s.renderId,
        role: s.role,
        name: s.name,
        error: s.state === "failed",
        text: `Recorded ${s.target}`,
        args: JSON.stringify({ path: s.target }),
      },
    };
  }
  return null;
}

// Count attempts in the browser, not completed HTTP responses: closing a
// disclosure may cancel its detail read before it reaches the fixture site.
async function withReads({ b, site, origin }, source, work) {
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const route = `${origin}/projects/${project}/api/v1/workbench/read`;
  await b.send("Network.enable");
  b.on("Network.requestWillBeSent", ({ request }) => {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin + url.pathname !== route) return;
    try {
      const q = JSON.parse(url.searchParams.get("request"));
      if (
        q.kind === "conversation-step" &&
        (transcriptIds.includes(q.id) || q.id === agentChatId)
      )
        source.detailReads.push(q);
    } catch (error) {
      site.failures.push(`Invalid observed project read: ${error}`);
    }
  });
  try {
    await site.withProjectRead((q) => readFixture(q, source), work);
  } finally {
    try {
      await b.send("Network.disable");
    } finally {
      b.on("Network.requestWillBeSent", null);
    }
  }
  assert.deepEqual(source.detailReads, [], "Unexpected step detail request");
}

const group = ".trace-summary:first-child .chead-main";
const firstTool =
  ".toolcall:has(.toolcall-path[title^='materials/']) .chead-main";
const shortTool = ".toolcall:has(.toolcall-path[title='panel-2.ts'])";
const lastTurn = `[data-lazy-id="${pages.at(-1).id}"]`;
const densePara = `${lastTurn} .msg-assistant .md p:first-child`;
const latest = ".chat-messages-wrap > .scroll-bottom";

function scrollPosition(selector = ".chat-messages") {
  const pane = document.querySelector(selector);
  return opticalProbe.stableFrames(() => {
    const { scrollTop: top, scrollHeight: height, clientHeight: view } = pane;
    return { top, height, view, gap: height - view - top };
  }, "transcript reading position");
}
function entries(root = "body") {
  return [
    ...document
      .querySelector(root)
      .querySelectorAll(".msg-assistant .msg-body > *"),
  ].map((el) => {
    const label = el.querySelector(".trace-group-head .chead-title");
    if (label) return label.textContent;
    const card = el.querySelector(".toolcall");
    if (card)
      return `${card.className} | ${card.querySelector(".toolcall-path")?.title ?? ""}`;
    if (el.querySelector(".thinking")) {
      if (el.querySelector("button,[aria-expanded]"))
        throw Error("Empty thinking has a disclosure");
      return el.textContent;
    }
    return el.querySelector("p")?.textContent;
  });
}
function arrows() {
  const body = document
    .querySelector(".msg-assistant .msg-body")
    .getBoundingClientRect();
  return [
    ...document.querySelectorAll(".msg-assistant .chead-main[aria-expanded]"),
  ].map((button) => {
    const head = button.parentElement.getBoundingClientRect();
    const row = button.getBoundingClientRect();
    const icon = button
      .querySelector(".chead-toggle > svg")
      .getBoundingClientRect();
    const path = button.querySelector(".toolcall-path");
    return {
      label: button.querySelector(".chead-title").textContent,
      path: path?.title,
      ellipsized: path && path.scrollWidth > path.clientWidth,
      head: [head.left, head.right],
      body: [body.left, body.right],
      button: [row.left, row.right],
      icon: [icon.left, icon.top, icon.right, icon.bottom],
    };
  });
}
const shotName = (row, scene) =>
  `transcript-${row.theme}-${row.width}-${scene}.png`;
async function observeTrace(ctx, row, source) {
  const {
    go,
    chat,
    run,
    wait,
    ev,
    press,
    clickPoint,
    observeButton,
    screenshot,
  } = ctx;

  await go(chat(traceId), group);
  row.folded = await run(entries);
  const exceptions = [
    "toolcall run | joining.ts",
    "toolcall err | failed.ts",
    "toolcall idle | unknown.ts",
    "toolcall run | waiting.ts",
    "toolcall run | active.ts",
  ];
  const collapsed = "15 steps completed · Show steps";
  assert.deepEqual(row.folded, [
    collapsed,
    ...exceptions,
    "Findings begin here.",
    "2 steps completed · Show steps",
    "Recorded material.",
  ]);
  const hit = await run(controlGeometry, group);
  assert.ok(hit.hit.center.hit);
  await clickPoint(group, hit.hit.center);
  await wait(`document.querySelector(${JSON.stringify(firstTool)})`);
  row.expanded = await run(entries);
  const original = paths.map((p) => `toolcall ok | ${p}`);
  original.splice(7, 0, "Thinking content unavailable");
  assert.deepEqual(row.expanded, [
    "15 steps completed · Hide steps",
    ...original,
    ...row.folded.slice(1),
  ]);
  // Collapse and reopen with the same native button, then focus a member.
  assert.ok(await ev(`document.activeElement.matches('${group}')`));
  await press(" ", 32);
  await wait(`document.querySelector('${group}').ariaExpanded==='false'`);
  await press(" ", 32);
  await wait(`document.querySelector('${group}').ariaExpanded==='true'`);
  await press("Tab", 9);
  assert.ok(
    await ev(
      `document.activeElement.matches(${JSON.stringify(`${firstTool}:focus-visible`)})`,
    ),
  );
  source.revision = 1;
  await wait(
    `document.querySelector('${group}').textContent.includes('16 steps completed · Hide steps')`,
  );
  assert.ok(
    await ev(`document.activeElement.matches(${JSON.stringify(firstTool)})`),
    "Focused trace member was displaced by a new result",
  );
  assert.deepEqual(
    source.detailReads,
    [],
    "Expanding a trace fetched step bodies",
  );
  row.arrows = await run(arrows);
  const xs = row.arrows.map(({ icon }) => icon[2]);
  row.arrowSpread = Math.max(...xs) - Math.min(...xs);
  assert.ok(row.arrowSpread <= 1, `Chevron spread ${row.arrowSpread}px`);
  for (const { head, body, button, icon } of row.arrows) {
    assert.ok(
      Math.abs(head[0] - body[0]) <= 1 &&
        Math.abs(head[1] - body[1]) <= 1 &&
        button[0] - head[0] <= 12 &&
        head[1] - button[1] <= 12 &&
        icon[2] - icon[0] > 0 &&
        button[1] >= icon[2] &&
        button[1] - icon[2] < 20,
      "Disclosure does not fill its reading column",
    );
  }
  assert.equal(row.arrows.find((r) => r.path === paths[0])?.ellipsized, true);
  // Actual visible text and adjacent backing, not a CSS-token comparison.
  await run(controlGeometry, `${shortTool} .chead-main`);
  const points = await Promise.all(
    [
      [".toolcall-name", "read"],
      [".toolcall-path", "panel-2.ts"],
    ].map(([s, text]) => run(glyphSample, `${shortTool} ${s}`, text, null)),
  );
  const image = shotName(row, "tool-labels");
  row.labels = await run(
    contrastPixels,
    await screenshot(image),
    points.map((p) => ({ ...p, record: true })),
  );
  assert.deepEqual(row.labels.failures, []);
  assert.ok(row.labels.readings.every((p) => p.paintedGlyph?.ratio >= 4.5));
  row.labelImage = image;
  // No scroll correction across the changed tail. Also prove Latest resumes
  // follow rather than merely jumping to the bottom once.
  const before = await run(scrollPosition);
  assert.ok(before.gap > 80);
  source.revision++;
  await wait(
    `document.querySelector('.msg-assistant .msg-part:last-child').textContent.includes('Revision 2.')`,
  );
  const after = await run(scrollPosition);
  assert.ok(
    after.height > before.height && Math.abs(after.top - before.top) <= 1,
  );
  const back = await observeButton(
    "Latest after trace growth",
    latest,
    "Latest messages",
    false,
  );
  assert.ok(back.keyboardFocus && Object.values(back.hit).every((p) => p.hit));
  await press(" ", 32);
  await wait(`!document.querySelector('${latest}')`);
  const following = await run(scrollPosition);
  source.revision++;
  await wait(
    `document.querySelector('.msg-assistant .msg-part:last-child').textContent.includes('Revision 3.')`,
  );
  const followed = await run(scrollPosition);
  row.scroll = { before, after, following, followed };
  assert.ok(
    following.gap <= 1 &&
      followed.height > following.height &&
      followed.gap <= 1,
  );
}

// First crossing of the folding threshold, without focusing or opening a row.
// Sample inside the selected pane: AgentView leaves the main chat mounted.
async function observeThreshold(ctx, pane, latestButton, settle, peek) {
  const { run, send, wait } = ctx;
  const frame = () =>
    run(
      (selector) =>
        opticalProbe.stableFrames(() => {
          const pane = document.querySelector(selector),
            bounds = pane.getBoundingClientRect();
          const rows = ["visible-first.ts", "visible-second.ts"].map((path) => {
            const e = pane.querySelector(`.toolcall-path[title="${path}"]`),
              r = e?.getBoundingClientRect();
            return (
              r && {
                id: e.closest(".trace-entry").dataset.readingStep,
                rect: [r.left, r.top, r.right, r.bottom],
                hit: e.contains(
                  document.elementFromPoint(r.left + 1, r.top + r.height / 2),
                ),
              }
            );
          });
          return {
            rows,
            top: pane.scrollTop,
            x: bounds.left + 12,
            y: bounds.top + 60,
            paneTop: bounds.top,
            focused: !!document.activeElement?.closest(".trace-entry"),
          };
        }, "unfocused visible results"),
      pane,
    );
  const start = await frame();
  assert.ok(start.top > 100 && start.rows.every((r) => !r.hit));
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: start.x,
    y: start.y,
    deltaX: 0,
    deltaY: Math.round(start.rows[0].rect[1] - start.paneTop - 50),
  });
  await wait(`document.querySelector('${latestButton}')`);
  const before = await frame();
  assert.ok(!before.focused && before.rows.every((r) => r.hit));
  assert.deepEqual(
    before.rows.map((r) => r.id),
    ["call-0", "call-1"],
  );
  const offscreen = await run((selector) => {
    const pane = document.querySelector(selector);
    return ["offscreen.ts", "also-offscreen.ts"].map(
      (path) =>
        pane
          .querySelector(`.toolcall-path[title="${path}"]`)
          .getBoundingClientRect().top - pane.getBoundingClientRect().bottom,
    );
  }, pane);
  assert.ok(offscreen.every((offset) => offset > 0));
  settle();
  await wait(
    `document.querySelector('${pane} .msg-assistant').innerText.includes('Finished.') && document.querySelector('${pane} .toolcall.ok .toolcall-path[title="third.ts"]')`,
  );
  const after = await frame();
  assert.deepEqual(after, before);
  const summaries = (await run(entries, pane)).filter((text) =>
    text?.includes("steps completed"),
  );
  assert.deepEqual(summaries, ["2 steps completed · Show steps"]);
  const result = { start, before, after, offscreen, summaries };
  if (peek) {
    await peek();
    result.afterPlan = await frame();
    assert.deepEqual(result.afterPlan, before);
    assert.ok(await ctx.ev(`!!document.querySelector('${latestButton}')`));
  }
  return result;
}

async function observePausedTrace(ctx, row, source) {
  await ctx.go(ctx.chat(pausedId), '.toolcall-path[title="visible-first.ts"]');
  row.unfocusedReading = await observeThreshold(
    ctx,
    ".chat-messages",
    latest,
    () => {
      source.settled = true;
    },
    async () => {
      const trigger = ".current-plan-trigger";
      await ctx.click(trigger);
      await ctx.wait(
        `document.querySelector('.current-plan-panel .workflow-plan')`,
      );
      await ctx.click(trigger);
      await ctx.wait(`!document.querySelector('.current-plan-panel')`);
    },
  );
  const beforeGrowth = await ctx.run(scrollPosition);
  source.growing = true;
  await ctx.wait(
    `document.querySelector('.msg-assistant').innerText.includes('Following again.')`,
  );
  const afterGrowth = await ctx.run(scrollPosition);
  assert.ok(
    afterGrowth.height > beforeGrowth.height &&
      afterGrowth.top === beforeGrowth.top,
  );
  Object.assign(row.unfocusedReading, { beforeGrowth, afterGrowth });
  assert.deepEqual(source.detailReads, []);
}

async function observeAgentThreshold(ctx, row, source) {
  const { go, chat, click, clickPoint, ev, wait, run } = ctx;
  const dock = `.agent-dock-run[aria-label="${liveDock.goal}"] > .agent-dock-row`;
  await go(chat(agentChatId), dock);
  if (
    await ev(
      `document.querySelector('.navigation-toggle').ariaExpanded === 'false'`,
    )
  )
    await click(".navigation-toggle");
  const entry = await run(controlGeometry, dock, false);
  assert.ok(entry.hit.center.hit);
  await clickPoint(dock, entry.hit.center);
  const pane = ".workflow-agent .chat-messages",
    latestButton = ".workflow-agent .scroll-bottom";
  await wait(
    `document.querySelector('${pane} .toolcall-path[title="visible-first.ts"]')`,
  );
  row.agentReading = await observeThreshold(ctx, pane, latestButton, () => {
    source.agentPhase = 1;
  });
  await click(latestButton);
  await wait(`!document.querySelector('${latestButton}')`);
  const following = await run(scrollPosition, pane);
  source.agentPhase = 2;
  await wait(
    `document.querySelector('${pane} .msg-assistant').innerText.includes('Following again.')`,
  );
  const followed = await run(scrollPosition, pane);
  assert.ok(
    following.gap <= 1 &&
      followed.height > following.height &&
      followed.gap <= 1,
  );
  Object.assign(row.agentReading, { following, followed });
}

async function observeWindowedTrace(ctx, row, source) {
  const { go, chat, click, ev, wait, run } = ctx;
  const turn = `[data-lazy-id="${pages[0].id}"]`,
    head = `${turn} .trace-summary:first-child .chead-main`;
  await go(chat(windowId), head);
  const folded = await run(entries, turn);
  assert.deepEqual(folded, [
    "3 steps completed · Show steps",
    "Between groups.",
    "2 steps completed · Show steps",
    "End of this trace.",
  ]);
  await click(head);
  const expanded = await run(entries, turn);
  assert.deepEqual(expanded, [
    "3 steps completed · Hide steps",
    ...["first", "second", "third"].map((n) => `toolcall ok | ${n}.ts`),
    ...folded.slice(1),
  ]);
  source.windowGrown = true;
  const placeholder = `${turn}.msg-lazy-ph`;
  await wait(
    `document.querySelector('${placeholder}') && document.querySelector('[data-lazy-id="${pages[1].id}"] .md')`,
  );
  const unmounted = await run((s) => {
    const e = document.querySelector(s),
      r = e.getBoundingClientRect();
    return {
      id: e.dataset.lazyId,
      cls: e.className,
      children: e.childElementCount,
      rect: [r.top, r.bottom],
      scrollTop: e.closest(".chat-messages").scrollTop,
    };
  }, placeholder);
  assert.ok(
    unmounted.children === 0 &&
      unmounted.rect[1] < 0 &&
      unmounted.scrollTop > 2400,
  );
  if (row.width > 900) await click('.qn-bar[data-question="0"]');
  else {
    // The phone hides the question rail. Its Branches drawer can navigate
    // to a message on this very same branch without changing sessions.
    if (
      await ev(
        `document.querySelector('.inspector-toggle').ariaExpanded === 'false'`,
      )
    )
      await click(".inspector-toggle");
    // The drawer can still be sliding after the opener's click. Target the
    // settled tab, not the coordinates it briefly travels through.
    const tab =
      '.drawer-right.open .rp-tabs[aria-label="Workspace panels"] .rp-tab:nth-child(2)';
    const geometry = await run(controlGeometry, tab, false);
    assert.equal(geometry.name, "Branches");
    assert.ok(geometry.hit.center.hit);
    await ctx.clickPoint(tab, geometry.hit.center);
    const choice = `.branch-row[title="${pages[0].text}"]`;
    await wait(`document.querySelector('${choice}')`);
    await click(choice);
  }
  await wait(`document.querySelector('${turn}.msg-flash .msg-user')`);
  const restored = await run(entries, turn);
  assert.deepEqual(restored, expanded);
  assert.deepEqual(source.detailReads, []);
  await click(head);
  assert.deepEqual(await run(entries, turn), folded);
  // A non-continuing head replaces the latest branch while sharing the
  // first turn (same read/render IDs). Do not lend it that branch's choice.
  await click(head);
  assert.deepEqual(await run(entries, turn), expanded);
  source.windowFork = true;
  await wait(
    `document.querySelector('[data-lazy-id="${pages[2].id}"]') && document.querySelector('${head}').ariaExpanded === 'false'`,
  );
  const forked = await run(entries, turn);
  assert.deepEqual(forked, folded);
  assert.deepEqual(source.detailReads, []);
  row.windowedTrace = {
    folded,
    forked,
    expanded,
    unmounted,
    restored,
    detailReads: [...source.detailReads],
  };
}

function railFrame() {
  const nav = document.querySelector(".qn-rail"),
    pane = document.querySelector(".chat-messages");
  const n = nav.getBoundingClientRect(),
    p = pane.getBoundingClientRect();
  if (!n.width) return { hidden: getComputedStyle(nav).display === "none" };
  const current = nav.querySelector('.qn-bar[aria-current="true"]');
  const tick = nav.querySelector(".qn-bar:not([aria-current])");
  const r = tick.getBoundingClientRect(),
    c = current.getBoundingClientRect();
  const gutter = pane.offsetWidth - pane.clientWidth;
  const edge = { x: p.right - Math.max(1, gutter / 2), y: r.top + 1 };
  const thumbAtEnd = {
    x: edge.x,
    y: p.bottom - Math.min(30, pane.clientHeight ** 2 / pane.scrollHeight / 2),
  };
  return {
    track: [n.left, n.right],
    pane: [p.left, p.right],
    gutter,
    edge,
    thumbAtEnd,
    edgeClear: pane.contains(document.elementFromPoint(edge.x, edge.y)),
    mark: [r.left, r.right],
    current: [c.left, c.right],
    opacity: Number(getComputedStyle(tick).opacity),
    labelVisible: tick
      .querySelector(".qn-bar-text")
      .checkVisibility({ visibilityProperty: true, opacityProperty: true }),
    active: current.dataset.question,
    hover: nav.matches(":hover"),
    focus: nav.matches(":focus-within"),
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
  };
}
async function observeRail(ctx, row, turnReads) {
  const { run, ev, send, press, wait, chat, go } = ctx;
  await go(chat(bookId), `${lastTurn} .md p:last-child`);
  await wait(`document.querySelector('.qn-rail')`);
  const move = (x, y) =>
    send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await move(1, 1);
  if (row.width <= 900) {
    row.rail = await run(railFrame);
    assert.deepEqual(row.rail, { hidden: true });
    return;
  }
  await wait(`document.querySelector('.qn-bar[aria-current="true"]')`);
  const rest = await run(railFrame);
  row.rail = { rest };
  assert.ok(
    !rest.labelVisible &&
      !rest.hover &&
      !rest.focus &&
      rest.current[1] - rest.current[0] > rest.mark[1] - rest.mark[0],
  );
  assert.ok(
    rest.edgeClear &&
      rest.track[1] <= rest.pane[1] - rest.gutter &&
      rest.pane[1] - rest.gutter - rest.track[1] <= 16 &&
      rest.mark[1] <= rest.track[1] &&
      rest.mark[0] >= rest.track[0],
  );
  await move(rest.x, rest.y);
  await wait(
    `document.querySelector('.qn-rail:hover') && Number(getComputedStyle(document.querySelector('.qn-bar-text')).opacity)===1`,
  );
  row.rail.hover = await run(railFrame);
  assert.ok(
    row.rail.hover.labelVisible &&
      row.rail.hover.opacity > rest.opacity &&
      row.rail.hover.edgeClear,
  );
  // Wheel on a mark and in the actual gap, not on surrounding prose. No
  // wheel should activate a question or load a jump target.
  row.rail.wheel = [];
  for (const [target, y] of [
    [".qn-bar", rest.y],
    [".qn-rail", rest.y + 15],
  ]) {
    await move(rest.x, y);
    assert.ok(
      await ev(
        `document.elementFromPoint(${rest.x},${y}).matches(${JSON.stringify(target)})`,
      ),
    );
    const before = await run(scrollPosition);
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: rest.x,
      y,
      deltaY: -170,
      deltaX: 0,
    });
    await wait(
      `document.querySelector('.chat-messages').scrollTop<${before.top - 1}`,
    );
    const after = await run(scrollPosition);
    assert.ok(!(await ev(`document.querySelector('.msg-flash') !== null`)));
    row.rail.wheel.push({ target, y, before, after });
  }
  await ctx.click(latest);
  await wait(`!document.querySelector('${latest}')`);
  await move(1, 1);
  // Drag the real scrollbar thumb off its bottom stop. Geometry alone would
  // miss an enlarged pseudo-element stealing the mouse outside the rail.
  const start = await run(scrollPosition);
  const { x, y } = rest.thumbAtEnd;
  assert.ok(start.gap <= 1 && rest.gutter > 0);
  await move(x, y);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y: y - 65,
    button: "left",
    buttons: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y: y - 65,
    button: "left",
    clickCount: 1,
  });
  await wait(`document.querySelector('${latest}')`);
  row.rail.drag = { start, end: await run(scrollPosition) };
  assert.ok(row.rail.drag.end.top < start.top);
  await ev(`document.querySelector('${latest}').focus({preventScroll:true})`);
  await press("Tab", 9);
  await wait(
    `document.activeElement.matches('.qn-bar:focus-visible') && Number(getComputedStyle(document.querySelector('.qn-bar-text')).opacity)===1`,
  );
  row.rail.focus = await run(railFrame);
  assert.ok(
    row.rail.focus.focus &&
      row.rail.focus.labelVisible &&
      !row.rail.focus.hover,
  );
  await press("End", 35);
  await press("ArrowUp", 38);
  assert.equal(
    await ev("document.activeElement.dataset.question"),
    String(pages.length - 2),
  );
  await press("Home", 36);
  assert.equal(await ev("document.activeElement.dataset.question"), "0");
  row.rail.readsBeforeJump = [...turnReads];
  assert.ok(
    !turnReads.includes(0) &&
      !(await ev(`document.querySelector('[data-lazy-id="${pages[0].id}"]')`)),
    "Oldest turn must be genuinely unloaded",
  );
  await press(" ", 32);
  const dest = `[data-lazy-id="${pages[0].id}"]`;
  await wait(
    `document.querySelector('${dest}.msg-flash .msg-user') && document.querySelector('.qn-bar[data-question="0"][aria-current="true"]')`,
  );
  row.rail.destination = await run((s) => {
    const el = document.querySelector(`${s} .msg-user .md p`),
      r = el.getBoundingClientRect();
    return {
      text: el.textContent,
      y: r.y,
      visible: el.contains(
        document.elementFromPoint(r.left + 1, r.top + r.height / 2),
      ),
    };
  }, dest);
  assert.ok(
    turnReads.includes(0) &&
      row.rail.destination.visible &&
      row.rail.destination.text === pages[0].text,
  );
  row.rail.readsAfterJump = [...turnReads];
  // A pointer still activates a mark, independently of its wheel handling.
  await ctx.click('.qn-bar[data-question="1"]');
  await wait(
    `document.querySelector('[data-lazy-id="${pages[1].id}"].msg-flash')`,
  );
  await ctx.click(latest);
}

// The paragraph is much taller than the viewport. Its actual glyph line boxes
// continue through and past the capsule and editor, even where clipped. Count
// those lines separately from their measured contribution to the final frame.
function maskFrame(selector) {
  const paragraph = document.querySelector(selector);
  const range = new Range();
  range.selectNodeContents(paragraph);
  const lines = [...range.getClientRects()];
  const rect = (s) => {
    const { left, top, right, bottom } = document
      .querySelector(s)
      .getBoundingClientRect();
    return { left, top, right, bottom };
  };
  const capsule = rect(".scroll-bottom"),
    dock = rect(".composer-dock"),
    workspace = rect(".chat-workspace"),
    pane = rect(".chat-messages"),
    col = paragraph.getBoundingClientRect();
  const y = (capsule.top + capsule.bottom) / 2;
  const x = col.left + 2;
  return {
    capsule,
    dock,
    workspace,
    pane,
    editor: rect(".chat-composer textarea"),
    col: [Math.ceil(col.left), Math.floor(col.right)],
    view: [innerWidth, innerHeight],
    scroll: document.querySelector(".chat-messages").scrollTop,
    atCapsule: lines.filter(
      (r) => r.top < capsule.bottom && r.bottom > capsule.top,
    ).length,
    atDock: lines.filter((r) => r.top < dock.bottom && r.bottom > dock.top)
      .length,
    hitThrough: {
      x,
      y,
      paragraph: paragraph.contains(document.elementFromPoint(x, y)),
    },
  };
}
async function compareInk(ink, blank, frame) {
  const pixels = async (png) => {
    const bitmap = await createImageBitmap(
      new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], {
        type: "image/png",
      }),
    );
    if (
      bitmap.width !== innerWidth ||
      bitmap.height !== innerHeight ||
      devicePixelRatio !== 1
    )
      throw Error("Expected unscaled viewport screenshots");
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext(
      "2d",
    );
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return ctx.getImageData(0, 0, innerWidth, innerHeight).data;
  };
  const [a, b] = await Promise.all([pixels(ink), pixels(blank)]);
  const diff = (left, right, top, bottom) => {
    let changed = 0,
      maxDelta = 0,
      lastY = null;
    for (
      let y = Math.max(0, Math.ceil(top));
      y < Math.min(innerHeight, Math.floor(bottom));
      y++
    )
      for (
        let x = Math.max(0, Math.ceil(left));
        x < Math.min(innerWidth, Math.floor(right));
        x++
      ) {
        const i = 4 * (y * innerWidth + x),
          delta = Math.max(
            Math.abs(a[i] - b[i]),
            Math.abs(a[i + 1] - b[i + 1]),
            Math.abs(a[i + 2] - b[i + 2]),
          );
        if (delta) {
          changed++;
          maxDelta = Math.max(maxDelta, delta);
          lastY = y;
        }
      }
    return { box: [left, top, right, bottom], changed, maxDelta, lastY };
  };
  const [l, r] = frame.col,
    { top, bottom } = frame.dock,
    edge = Math.floor(frame.capsule.top) - 1;
  return {
    visible: diff(l, r, frame.pane.top, edge - 90),
    transition: diff(l, r, edge - 90, edge),
    protected: diff(l, r, edge, top),
    editor: diff(l, r, top, bottom),
    below: diff(l, r, bottom, frame.workspace.bottom),
  };
}
async function observeMask(ctx, row, mode) {
  const { run, screenshot } = ctx;
  const geometry = () => run(maskFrame, densePara);
  const before = await geometry();
  assert.ok(
    before.atCapsule && before.atDock && before.hitThrough.paragraph,
    `No transcript behind protected region: ${JSON.stringify(before)}`,
  );
  const on = shotName(row, `${mode}-ink`),
    off = shotName(row, `${mode}-no-ink`);
  const ink = await screenshot(on);
  // Inline property on this specific ordinary prose paragraph, no synthetic
  // overlay, no scroll, no hiding layout boxes or changing text/line breaks.
  const prior = await run((s) => {
    const el = document.querySelector(s);
    const prior = el.style.webkitTextFillColor;
    el.style.webkitTextFillColor = "transparent";
    return prior;
  }, densePara);
  try {
    const noInk = await screenshot(off);
    assert.deepEqual(await geometry(), before, "Measurement moved the layout");
    const result = await run(compareInk, ink, noInk, before);
    row.masks.push({ mode, on, off, before, result });
    assert.ok(
      result.visible.changed > 100 && result.visible.maxDelta > 24,
      "No positive glyph witness above the scrim",
    );
    for (const region of ["protected", "editor", "below"])
      assert.equal(
        result[region].changed,
        0,
        `${mode} glyph contribution in ${region}: ${JSON.stringify(result[region])}`,
      );
  } finally {
    await run(
      (s, value) => {
        document.querySelector(s).style.webkitTextFillColor = value;
      },
      densePara,
      prior,
    );
  }
  return before;
}
async function observeReading(ctx, row, turnReads) {
  const { run, ev, wait, send, press, observeButton } = ctx;
  await observeRail(ctx, row, turnReads);
  // The range is the real keyboard-operable composer grip. Home selects
  // automatic and leaves the observer independent of the previous view.
  const grip = ".chat-composer .composer-resize";
  const focusGrip = () =>
    ev(`document.querySelector('${grip}').focus({preventScroll:true})`);
  await focusGrip();
  await press("Home", 36);
  await ev("document.activeElement.blur()");
  const start = await run(scrollPosition);
  assert.ok(start.gap <= 1);
  // A previous pointer jump must not hover the pill as it reappears and
  // put its border transition in only one of the two screenshot frames.
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
  const wheel = await run(() => {
    const p = document.querySelector(".chat-messages").getBoundingClientRect();
    return { x: p.left + 20, y: p.top + p.height / 2 };
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    ...wheel,
    deltaY: -810,
    deltaX: 0,
  });
  await wait(`document.querySelector('${latest}')`);
  const up = await run(scrollPosition);
  assert.ok(up.gap > 80);
  row.masks = [];
  const auto = await observeMask(ctx, row, "auto");
  // The opaque shelf must not become the wheel target either. Scroll from
  // the very point whose glyph contribution was just measured as zero.
  const { x: wx, y: wy } = auto.hitThrough;
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: wx,
    y: wy,
    deltaX: 0,
    deltaY: -100,
  });
  await wait(
    `document.querySelector('.chat-messages').scrollTop<${up.top - 1}`,
  );
  const reading = await run(scrollPosition);
  await focusGrip();
  for (let i = 0; i < 4; i++) await press("ArrowUp", 38);
  await ev("document.activeElement.blur()");
  const resized = await run(scrollPosition);
  assert.ok(
    Math.abs(reading.top - resized.top) <= 1,
    "Growing editor displaced paused reading position",
  );
  const tall = await observeMask(ctx, row, "tall");
  assert.ok(
    tall.editor.bottom - tall.editor.top >
      auto.editor.bottom - auto.editor.top + 20 &&
      tall.capsule.top < auto.capsule.top - 20,
  );
  const { x, y } = tall.hitThrough;
  // Drag from the protected area beside the capsule across actual text.
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: x + 32,
    y: y - 28,
    button: "left",
    buttons: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: x + 32,
    y: y - 28,
    button: "left",
    clickCount: 1,
  });
  row.selection = await ev(`getSelection().toString().slice(0,80)`);
  assert.ok(row.selection.length > 2);
  await ev("getSelection().removeAllRanges()");
  const button = await observeButton(
    "Latest above composer",
    latest,
    "Latest messages",
    false,
  );
  assert.ok(
    button.keyboardFocus && Object.values(button.hit).every((p) => p.hit),
  );
  const label = await run(glyphSample, latest, "Latest messages", null);
  const ring = await run(() => {
    const el = document.activeElement,
      r = el.getBoundingClientRect(),
      css = getComputedStyle(el);
    const w = parseFloat(css.outlineWidth),
      offset = parseFloat(css.outlineOffset);
    if (
      !el.matches(".scroll-bottom:focus-visible") ||
      css.outlineStyle !== "solid" ||
      w < 2
    )
      throw Error("No visible Latest focus ring");
    const x = Math.floor(r.left + r.width / 2);
    return {
      name: "Latest focus",
      ink: [x, Math.floor(r.top - offset - w / 2)],
      x,
      y: Math.floor(r.top - offset + 1),
      min: 3,
      record: true,
    };
  });
  row.latestImage = shotName(row, "latest-focus");
  row.latestContrast = await run(
    contrastPixels,
    await ctx.screenshot(row.latestImage),
    [{ ...label, record: true }, ring],
  );
  assert.deepEqual(row.latestContrast.failures, []);
  assert.ok(row.latestContrast.readings[0].paintedGlyph?.ratio >= 4.5);
  await press(" ", 32);
  await wait(`!document.querySelector('${latest}')`);
  const end = await run(scrollPosition);
  row.ending = await run((s) => {
    const el = document.querySelector(`${s} .msg-assistant .md p:last-child`);
    const range = new Range();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect(),
      x = r.left + r.width / 2,
      y = r.top + r.height / 2;
    return {
      text: el.textContent,
      top: r.top,
      bottom: r.bottom,
      pane: document.querySelector(".chat-messages").getBoundingClientRect()
        .bottom,
      editor: document.querySelector(".composer-dock").getBoundingClientRect()
        .top,
      hit: el.contains(document.elementFromPoint(x, y)),
    };
  }, lastTurn);
  assert.ok(
    end.gap <= 1 &&
      row.ending.text === finalLine &&
      row.ending.hit &&
      row.ending.bottom <= Math.min(row.ending.pane, row.ending.editor),
  );
  const finalText = `${lastTurn} .msg-assistant .md p:last-child`;
  const finalSample = await run(
    glyphSample,
    finalText,
    finalLine,
    null,
    ".chat-messages",
  );
  row.finalImage = shotName(row, "last-line");
  row.finalContrast = await run(
    contrastPixels,
    await ctx.screenshot(row.finalImage),
    [finalSample],
  );
  assert.ok(
    row.finalContrast.worst?.paintedGlyph?.ratio >= 4.5,
    "Last sentence is not readable above the shelf",
  );
  row.reading = { start, up, reading, resized, end };
  await focusGrip();
  await press("Home", 36);
}

async function observeLongIndex(ctx, row) {
  const { go, chat, ev, send, run, wait } = ctx;
  await go(chat(longBookId), ".qn-rail.many .qn-bar");
  const where = (selector) =>
    run((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, selector);
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...(await where(".qn-bar")),
  });
  await wait(
    `getComputedStyle(document.querySelector('.qn-list')).opacity==='1'`,
  );
  const point = await where(".qn-list"),
    before = await run(scrollPosition);
  const listTop = () => ev(`document.querySelector('.qn-list').scrollTop`);
  const from = await listTop();
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    ...point,
    deltaX: 0,
    deltaY: from > 200 ? -140 : 140,
  });
  await wait(`document.querySelector('.qn-list').scrollTop!==${from}`);
  assert.deepEqual(await run(scrollPosition), before);
  row.longIndex = { from, to: await listTop(), point };
}

export async function observeTranscriptPolish(ctx) {
  const { width, theme, layout, ev, rows } = ctx;
  const motion = width === 390 ? "reduce" : "no-preference";
  const row = { width, theme, motion, detailReads: [] };
  rows.push(row);
  const source = {
    revision: 0,
    settled: false,
    agentPhase: 0,
    windowGrown: false,
    windowFork: false,
    turnReads: [],
    detailReads: row.detailReads,
  };
  try {
    await withReads(ctx, source, async () => {
      await layout(width, theme, motion);
      await observeTrace(ctx, row, source);
      assert.ok(
        await ev(
          `matchMedia('(prefers-color-scheme: ${theme})').matches && matchMedia('(prefers-reduced-motion: ${motion})').matches && innerWidth===${width}`,
        ),
      );
      await observePausedTrace(ctx, row, source);
      await observeAgentThreshold(ctx, row, source);
      await observeWindowedTrace(ctx, row, source);
      await observeReading(ctx, row, source.turnReads);
      if (width > 900) await observeLongIndex(ctx, row);
    });
  } finally {
    await layout(width, theme);
  }
}
