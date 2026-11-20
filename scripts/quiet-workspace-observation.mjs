// One optical group per viewport/theme, against the same canonical site and
// disposable CDP target as qualify-optical. No command ever reaches an owner.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { decodeActivityDiscovery } from "../src/service/contracts/activity.ts";
import { decodeWorkbenchResult } from "../src/service/contracts/workbench.ts";
import {
  readableDelivery,
  readableWorkflowPlan,
} from "../src/service/contracts/workflow.ts";
import { publicError } from "../src/worker-public.mjs";
import { PNG } from "../test/helpers/images.ts";
import {
  csrf,
  cwd,
  epoch,
  liveDock,
  lockedReply,
  project,
  readRecord,
  recentFolder,
  storeId,
  task,
} from "./optical-fixtures/records.mjs";

const card = "[data-plan-proposal]",
  trigger = ".conversation-header .current-plan-trigger",
  composer = ".chat-workspace[data-entry] form.chat-composer",
  input = `${composer} textarea`;
const q = JSON.stringify;
const ok = (value) => ({ kind: "ok", value });
const refused = () => ({ kind: "error", error: publicError("invalid") });
const otherProject = "e".repeat(64); // recentFolder in the optical gateway entry
const clock = 1_700_000_000_000;
const background = "quiet-background",
  title = "Quartz study",
  discussion = "Keep the other surface unchanged.",
  phrase = "按计划实施";

/** Only public projections: transcript entry IDs and command IDs have different
 * lifetimes. Continuing discussion changes the head, NOT the active proposal. */
function specimen(id) {
  const location = { id, cwd },
    cat = readRecord({
      kind: "conversation-models",
      location: { id: lockedReply, cwd },
    }).catalog;
  cat.version.conversation = location;
  cat.entries = ["optical", "agate"].map((model) => ({
    ...cat.entries[0],
    model,
    images: true,
  }));
  const modelSelector = () => {
    const { sourceSelectionId: _, ...model } = cat.selected;
    return model;
  };
  const turns = [],
    ids = [randomUUID(), randomUUID(), randomUUID()],
    live = { commandId: randomUUID(), epoch };
  const s = {
    id,
    cat,
    turns,
    runIds: ids,
    live,
    commands: [],
    unexpected: [],
    firstHead: Promise.withResolvers(),
    pending: null,
    waiting: [],
    permit: null,
    revision: 1,
    proposal: null,
    roster: null,
    served: new Set(),
    sessions: new Set(),
    heldKinds: new Set(),
    unknown: false,
    modeReads: 0,
    liveTurnReads: 0,
    makeProposal(stage = "original") {
      const base = readRecord({ kind: "cadence-conversation", id: "design" })
        .state.proposal;
      const branch = "refs/heads/optical/reader",
        head = "d".repeat(40);
      s.proposal = {
        ...base,
        id: randomUUID(),
        model: { ...cat.version },
        digest: { original: "a", replacement: "c", stale: "f" }[stage].repeat(
          64,
        ),
        plan: {
          ...base.plan,
          goal: {
            original: "Add a quartz export",
            replacement: "Add a quartz import instead",
            stale: "Revise the quartz export",
          }[stage],
          design: "Export a plain-text material note.",
          decisions: "Keep the existing JSON output.",
          assumptions: "A local viewer is available.",
        },
        delivery: {
          policy: "task-branch-v1",
          target: {
            checkoutRoot: cwd,
            repository: `${cwd}/.git`,
            repositoryIdentity: "e".repeat(64),
            branch,
            head,
          },
        },
        display: {
          model: `fixture/${cat.selected.model} · ${cat.selected.thinking}`,
          branch,
          baseCommit: head,
          runtime: "Read only retained observations; never replay a command. "
            .repeat(18)
            .trim(),
        },
      };
      if (stage === "stale") {
        // Different rights AND a stale execution binding. Reopening is neither
        // permission to reuse the first plan's terms nor implicit validation.
        s.proposal.plan.delivery = "working-copy";
        delete s.proposal.delivery;
        s.proposal.model.catalogId = randomUUID();
      }
      ++s.revision;
      return s.proposal;
    },
  };
  const state = () => ({
    id,
    enabled: turns.some((t) => t.kind === "cadence-send"),
    revision: s.revision,
    head: turns.at(-1)?.commandId ?? null,
    proposal: s.proposal,
    runs: [],
  });
  const chat = (id, title) => ({
    ...readRecord({ kind: "conversation", id }).summary,
    id,
    title,
  });
  s.read = async (r) => {
    const { kind } = r,
      stage = s.roster;
    if (kind === "conversations")
      return {
        kind,
        entries: r.archived
          ? []
          : [
              chat("quiet-past", "Earlier material"),
              {
                ...chat(background, title),
                ...(stage?.soloReply && !stage.reply
                  ? { status: stage.replyResult }
                  : {}),
              },
            ],
        next: null,
      };
    if (kind === "conversation-active") {
      const entries = !stage?.reply
        ? []
        : [
            {
              ...chat(background, title),
              status: stage.replyResult ?? "running",
              live,
              updatedAt: stage.at,
            },
            {
              ...chat("quiet-archived", "Archived reply"),
              status: "running",
              archived: true,
            },
            {
              ...chat("quiet-unwritten", "Unwritten reply"),
              status: stage.at === clock ? "starting" : "running",
              leaf: null,
              ...(stage.cold ? { live: s.unwrittenLive } : {}),
            },
          ];
      if (stage) s.served.add(`${kind}:${stage.name}`);
      return {
        kind,
        entries: stage?.soloReply ? entries.slice(0, 1) : entries,
      };
    }
    if (kind === "workflow-active") {
      const runs = !stage
        ? []
        : ids.slice(0, stage.count).map((runId, i) => {
            const { execution: _, ...base } = liveDock;
            return {
              ...base,
              id: runId,
              goal: ["Compare facets", "Check notes", "Unlinked specimen"][i],
              phase: stage.phase,
              steps: Array.from(
                { length: 1 + Math.floor((stage.at - clock) / 20_000) },
                (_, n) => {
                  const start = clock + n * 20_000;
                  const end =
                    start + 20_000 <= stage.at ? start + 20_000 : null;
                  return {
                    id: `facet-${n}`,
                    kind: "research",
                    status: end ? "completed" : "running",
                    text: end ? `Checked facet ${n}.` : "",
                    exitCode: end ? 0 : null,
                    truncated: false,
                    timing: {
                      createdAt: start,
                      preparedAt: start,
                      startedAt: start,
                      closedAt: end,
                      settledAt: end,
                      stopRequestedAt: null,
                      stopReason: null,
                    },
                  };
                },
              ),
            };
          });
      if (stage) s.served.add(`${kind}:${stage.name}`);
      return {
        kind,
        runs,
        links: runs.slice(0, 2).map((run) => ({
          runId: run.id,
          conversationId: stage.offPage ? "off-page" : background,
        })),
      };
    }
    if ((r.id ?? r.location?.id) !== id) return;
    if (
      kind === "conversation-models" &&
      s.firstCatalog &&
      !s.catalogRequested
    ) {
      s.catalogRequested = true;
      await s.firstCatalog.promise;
    }
    if (kind === "conversation-models" || kind === "reload-conversation-models")
      return { kind: "conversation-models", catalog: cat };
    if (kind === "conversation-context")
      return {
        kind,
        context: {
          id,
          cwd,
          revision: cat.version.configRev,
          model: modelSelector(),
        },
      };
    if (kind === "cadence-conversation") {
      ++s.modeReads;
      return {
        kind,
        state: {
          ...state(),
          ...(s.unknown
            ? { notice: "Mode observation unavailable for this specimen." }
            : {}),
        },
      };
    }
    const head = readRecord({ kind: "conversation", id: "questions" });
    if (kind === "conversation") {
      s.headRequested = true;
      await s.firstHead.promise;
      const leaf = turns.at(-1)?.entry ?? null;
      return {
        ...head,
        leaf,
        summary: leaf
          ? {
              ...head.summary,
              id,
              leaf,
              title: stage?.soloReply ? title : "Material notes",
              ...(s.replying
                ? { status: "running", live }
                : stage?.replyResult
                  ? { status: stage.replyResult }
                  : {}),
            }
          : null,
        turns: turns.length,
        branches: leaf ? 1 : 0,
        commands: turns.map((t) => t.commandId),
        pending: s.waiting,
        undelivered: s.undelivered ?? [],
      };
    }
    if (kind === "conversation-turn") {
      const page = readRecord({ ...r, id: "questions" }),
        t = turns[r.ordinal];
      page.conversationId = id;
      page.steps[0].text = t.text;
      if (t.images?.length)
        page.steps[0].images = [
          { entry: page.turn.id, index: 0, mimeType: "image/png" },
        ];
      page.steps[1].text = t.answer;
      if (s.replying) {
        ++s.liveTurnReads;
        page.turn.status = "running";
        page.turn.activity = { kind: "tool", sequence: 1, name: "read" };
      } else if (stage?.replyResult) page.turn.status = stage.replyResult;
      return page;
    }
    return undefined;
  };
  s.command = async (c) => {
    const { kind, commandId } = c;
    s.commands.push({ kind, commandId });
    if (
      kind === "conversation-model" &&
      s.permit === kind &&
      c.location.id === id
    ) {
      assert.deepEqual(c.expected, cat.version);
      assert.ok(
        cat.entries.some(
          (e) =>
            e.model === c.choice.model &&
            e.thinking.some(
              (t) => t.level === c.choice.thinking && t.selectable,
            ),
        ),
      );
      cat.version = {
        ...cat.version,
        configRev: cat.version.configRev + 1,
        catalogId: randomUUID(),
      };
      cat.selected = { ...c.choice, sourceSelectionId: commandId };
      s.permit = null;
      return ok({
        kind,
        commandId,
        choice: { version: cat.version, selected: cat.selected },
      });
    }
    if (
      kind === "image-upload" &&
      s.permit === c.send.kind &&
      c.send.conversationId === id &&
      c.offset === 0 &&
      c.data === PNG
    )
      return ok({ kind, commandId, imageId: c.imageId, offset: PNG.length });
    if (
      c.conversationId === id &&
      ((["send", "cadence-send"].includes(kind) && s.permit === kind) ||
        (s.replying &&
          ((kind === "conversation-input" && c.mode === s.permit) ||
            (kind === "conversation-input-cancel" &&
              s.permit === kind &&
              s.waiting.some((w) => w.commandId === c.inputId))) &&
          c.turnId === live.commandId &&
          c.epoch === live.epoch))
    ) {
      s.permit = null;
      const gate = Promise.withResolvers();
      s.pending = { command: c, finish: gate.resolve };
      return await gate.promise;
    }
    if (kind === "cadence-prepare" && s.permit === kind) {
      // Witness a fresh edit's binding without ever issuing a synthetic grant.
      assert.equal(c.conversationId, id);
      assert.equal(c.revision, s.revision);
      assert.equal(c.proposalId, s.proposal.id);
      assert.equal(c.digest, s.proposal.digest);
      Object.assign(s.commands.at(-1), {
        proposalId: c.proposalId,
        digest: c.digest,
        revision: c.revision,
      });
      s.permit = null;
      return refused();
    }
    if (kind === "cadence-revalidate" && s.permit === kind) {
      assert.equal(c.conversationId, id);
      assert.equal(c.head, turns.at(-1).entry);
      assert.equal(c.revision, s.revision);
      assert.equal(c.proposalId, s.proposal.id);
      assert.equal(c.digest, s.proposal.digest);
      assert.deepEqual(c.expected, cat.version);
      s.permit = null;
      s.proposal = {
        ...s.proposal,
        id: commandId,
        revalidatedFrom: c.proposalId,
        model: { ...cat.version },
        observation: "9".repeat(64),
      };
      ++s.revision;
      return ok({ kind: "cadence-revalidated", commandId, state: state() });
    }
    s.unexpected.push(kind);
    return refused();
  };
  return s;
}

/** Intercept the synthetic owner's or gateway's wire at its loopback origin. GETs not
 * under study use the ordinary optical site. It independently rejects writes;
 * even our only allowed Sends and picker changes are in-memory receipts. */
async function intercept({ b, site, origin, wait }, s) {
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  // Each specimen installs a different wire on this origin. Retire the old
  // polling document before enabling Fetch, not just on go() afterwards:
  // its cancelled request IDs do not belong to the next handler.
  await b.send("Page.navigate", { url: "about:blank" });
  await wait(
    `location.href === 'about:blank' && document.readyState === 'complete'`,
  );
  const failures = site.failures.length,
    pending = new Set();
  const handle = async ({ requestId, request }) => {
    const url = new URL(request.url),
      path = s.gateway
        ? url.pathname.replace(/^\/projects\/[a-f0-9]{64}(?=\/api\/v1\/)/, "")
        : url.pathname;
    let body,
      extra = [];
    if (url.origin !== origin) throw Error("Unexpected origin");
    if (
      s.gateway &&
      path === "/workbench/v1/activity" &&
      request.method === "GET"
    ) {
      body = s.roster.discoveryFailed
        ? { kind: "error", error: publicError("unavailable") }
        : decodeActivityDiscovery(s.gateway.observe(s.roster));
      s.served.add(`discovery:${s.roster.name}`);
    } else if (
      s.gateway &&
      path === "/workbench/v1/select" &&
      request.method === "POST"
    ) {
      const selection = JSON.parse(request.postData);
      assert.deepEqual(selection, { epoch, path: s.gateway.select });
      assert.ok([cwd, recentFolder].includes(selection.path));
      s.gateway.select = null;
      s.gateway.selections.push(selection.path);
      const local = selection.path === cwd;
      body = {
        kind: "project",
        project: {
          id: local ? project : otherProject,
          path: selection.path,
          cwd: selection.path,
          epoch: local ? epoch : null,
        },
      };
    } else if (
      s.firstProject &&
      path === `/workbench/v1/projects/${project}` &&
      request.method === "GET"
    ) {
      s.projectRequested = true;
      await s.firstProject.promise; // Continue to the site's associated-project GET.
    } else if (
      s.gateway &&
      path === `/workbench/v1/projects/${otherProject}` &&
      request.method === "GET"
    ) {
      body = {
        kind: "project-observation",
        status: "not-started",
        epoch: null,
        workspaceId: null,
      };
    } else if (
      !s.gateway &&
      request.method === "GET" &&
      path === "/workbench/v1"
    ) {
      // Entry is reread after a model change as well as on cold navigation.
      body = refused();
    } else if (request.method === "GET" && path === "/api/v1/session") {
      const attachment = Object.entries(request.headers).find(
        ([name]) => name.toLowerCase() === "x-cadence-attachment",
      )?.[1];
      assert.ok(attachment);
      s.sessions.add(attachment);
      if (s.holdSession) await s.holdSession.promise;
      extra = [{ name: "x-cadence-attachment", value: attachment }];
      body = ok({
        build: { assets: site.build, contractHash: site.build.contractHash },
        protocol: 1,
        storeId,
        epoch,
        accessGeneration: 1,
        authority: "browser",
        csrf,
        capabilities: { actions: true, manualChecks: false, history: true },
      });
    } else if (
      request.method === "GET" &&
      path === "/api/v1/workspace" &&
      s.firstWorkspace
    ) {
      s.workspaceRequested = true;
      await s.firstWorkspace.promise;
    } else if (request.method === "GET" && path === "/api/v1/workbench/read") {
      const r = JSON.parse(url.searchParams.get("request"));
      if (
        s.holdRosters &&
        ["conversation-active", "workflow-active"].includes(r.kind)
      ) {
        s.heldKinds.add(r.kind);
        await s.holdRosters.promise;
      }
      let v = await s.read(r);
      if (
        s.gateway &&
        r.kind === "conversation" &&
        r.id === background &&
        r.leaf
      ) {
        s.gateway.reads.add(`${url.pathname}:${r.id}:${r.leaf}`);
        v = { ...readRecord(r), leaf: r.leaf };
      }
      if (s.deny && r.kind === "workflow-active") {
        body = { kind: "error", error: publicError("forbidden") };
      } else if (
        (s.failMode && r.kind === "cadence-conversation" && r.id === s.id) ||
        (s.roster?.stale &&
          ["conversation-active", "workflow-active"].includes(r.kind))
      ) {
        body = { kind: "error", error: publicError("unavailable") };
      } else if (v) {
        decodeWorkbenchResult(v);
        body = ok(v);
      }
    } else if (
      request.method === "POST" &&
      path === "/api/v1/workbench/command"
    ) {
      body = await s.command(JSON.parse(request.postData));
      if (body.kind === "ok") decodeWorkbenchResult(body.value);
    } else if (request.method !== "GET" && path !== "/api/v1/detach") {
      s.unexpected.push(`${request.method} ${path}`);
      body = refused();
    }
    if (!body) return b.send("Fetch.continueRequest", { requestId });
    return b.send("Fetch.fulfillRequest", {
      requestId,
      responseCode:
        path === "/workbench/v1"
          ? 400
          : path === "/workbench/v1/activity" && body.kind === "error"
            ? 503
            : 200,
      responseHeaders: [
        { name: "content-type", value: "application/json" },
        { name: "cache-control", value: "no-store" },
        ...extra,
      ],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    });
  };
  b.on("Fetch.requestPaused", (event) => {
    const work = handle(event).catch(async (error) => {
      s.unexpected.push(
        `${s.id}: ${event.request.method} ${event.request.url}: ${error}`,
      );
      await b
        .send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "Failed",
        })
        .catch(() => {});
    });
    pending.add(work);
    work.finally(() => pending.delete(work));
  });
  await b.send("Fetch.enable", {
    patterns: [{ urlPattern: `${origin}/*`, resourceType: "Fetch" }],
  });
  return async () => {
    s.firstProject?.resolve();
    s.firstWorkspace?.resolve();
    s.holdSession?.resolve();
    s.holdRosters?.resolve();
    s.firstHead.resolve();
    s.pending?.finish(refused());
    await Promise.all([...pending]);
    await b.send("Fetch.disable");
    b.on("Fetch.requestPaused", null);
    assert.deepEqual(s.unexpected, []);
    assert.deepEqual(site.failures.slice(failures), []);
  };
}

async function until(check, label) {
  for (let i = 0; i < 110; i++) {
    if (check()) return;
    await sleep(50);
  }
  throw Error(`No fixture observation: ${label}`);
}

// Capture all related geometry in the same stable frames, including hit tests
// of BOTH text labels (a DOM-only or ellipsized label is not visible evidence).
function entryFrame() {
  return opticalProbe.stableFrames(() => {
    const ws = document.querySelector(".chat-workspace:not([hidden])"),
      el = (sel) => ws.querySelector(sel),
      rect = (sel) => el(sel)?.getBoundingClientRect().toJSON();
    const text = (sel) => {
      const e = el(sel),
        range = new Range();
      range.selectNodeContents(e);
      const boxes = [...range.getClientRects()].map((r) => r.toJSON());
      return {
        text: e.innerText,
        boxes,
        visible:
          boxes.length > 0 &&
          boxes.every(
            (r) =>
              r.width > 0 &&
              [r.left + 1, r.right - 1].every((x) =>
                e.contains(document.elementFromPoint(x, r.y + r.height / 2)),
              ),
          ),
      };
    };
    const field = el("textarea"),
      starters = [...ws.querySelectorAll(".entry-starters button")];
    return {
      entry: ws.dataset.entry,
      viewport: [innerWidth, innerHeight],
      dark: matchMedia("(prefers-color-scheme: dark)").matches,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      workspace: ws.getBoundingClientRect().toJSON(),
      header: rect(".conversation-header"),
      welcome: rect(".chat-welcome"),
      logo: rect(".chat-welcome .empty-logo"),
      greeting: rect(".chat-welcome h2"),
      form: rect(".chat-composer"),
      starters: starters.map((e) => e.innerText),
      inputs: ws.querySelectorAll(".chat-composer textarea").length,
      same: field === window.opticalProbe.editor,
      focus: document.activeElement === field,
      draft: field.value,
      images: ws.querySelectorAll(".chat-image-draft").length,
      mode: el(".composer-delivery .mode-toggle").innerText,
      model: text(".model-trigger-text"),
      level: text(".model-trigger-level"),
      placeholder: field.placeholder,
    };
  }, "quiet entry");
}
// Read-only event witness on the public page, including changes that have
// already cleared by the next network sample. Reinstalled after cold reload.
function watchFeedback() {
  const ws = document.querySelector(".chat-workspace"),
    events = [];
  opticalProbe.feedback = events;
  let prior = ws.querySelector(".conversation-feedback")?.textContent ?? "";
  const observer = new MutationObserver(() => {
    const label = ws.querySelector(".conversation-feedback"),
      text = label?.innerText ?? "";
    if (text && text !== prior)
      events.push({
        text,
        rect: label.getBoundingClientRect().toJSON(),
        visible: label.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        }),
        at: performance.now(),
        brandAnimation: getComputedStyle(
          document.querySelector(".brand-logo svg"),
        ).animationName,
      });
    prior = text;
  });
  observer.observe(ws.querySelector(".conversation-header"), {
    subtree: true,
    childList: true,
    characterData: true,
  });
  const started = (event) => {
    if (event.target.matches(".brand-logo svg"))
      events.push({ animation: event.animationName, at: performance.now() });
  };
  ws.ownerDocument.addEventListener("animationstart", started);
  opticalProbe.endFeedback = () => {
    observer.disconnect();
    ws.ownerDocument.removeEventListener("animationstart", started);
  };
}
async function pasteFixtureImage(run) {
  // A fabricated File is pasted through the ordinary paste listener. No
  // filesystem picker, profile or system clipboard is touched.
  await run(
    (sel, png) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File(
          [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
          "facet.png",
          { type: "image/png" },
        ),
      );
      document.querySelector(sel).dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    input,
    PNG,
  );
}

// Direct entry: the first workspace GET (not just the head) is still in
// flight. Drive the mounted editor and its actual paste and receipt paths.
async function observeBootstrap(p, row) {
  const { go, run, ev, click, send, wait, press } = p;
  const s = specimen(`bootstrap-${randomUUID()}`);
  s.failMode = true;
  s.firstWorkspace = Promise.withResolvers();
  s.firstHead.resolve();
  const stop = await intercept(p, s);
  try {
    await go(`/app#chat=${s.id}`, input);
    await until(() => s.workspaceRequested, "held opening workspace");
    await ev(`opticalProbe.editor=document.querySelector(${q(input)});void 0`);
    const text = "Draft before workspace";
    await click(input);
    await send("Input.insertText", { text });
    await pasteFixtureImage(run);
    await wait(`document.querySelector('.chat-image-draft img')`);
    const editor = () =>
      run(
        (sel) => ({
          same:
            document.activeElement === opticalProbe.editor &&
            opticalProbe.editor === document.querySelector(sel),
          draft: opticalProbe.editor.value,
          images: document.querySelectorAll(".chat-image-draft").length,
        }),
        input,
      );
    const held = await editor();
    assert.deepEqual(held, { same: true, draft: text, images: 1 });
    s.firstWorkspace.resolve();
    await wait(
      `document.querySelector('.chat-composer button[type="submit"]:enabled') && document.querySelector('.model-trigger-text')?.innerText==='optical'`,
    );
    assert.deepEqual(await editor(), held);
    assert.deepEqual(s.commands, []);
    await wait(`document.querySelector('.mode-toggle.unknown:disabled')`);
    await run(watchFeedback);
    s.permit = "send";
    await press("Enter", 13);
    await until(() => s.pending, "ordinary Send with failed mode read");
    s.pending.finish(refused());
    s.pending = null;
    await wait(
      `document.querySelector('.chat-composer button[type="submit"]:enabled')`,
    );
    assert.deepEqual(await editor(), held);
    assert.deepEqual(await ev("opticalProbe.feedback"), []);
    s.permit = "send";
    await press("Enter", 13);
    await until(() => s.pending, "bootstrap explicit Send");
    const { command: c, finish } = s.pending;
    assert.equal(c.text, text);
    assert.equal(c.images.length, 1);
    // A valid upload receipt is not a Send receipt, even for this exact ID.
    // Every history read still answers empty until the record is published.
    const beforeReceipt = await run(entryFrame);
    const mismatched = {
      kind: "image-upload",
      commandId: c.commandId,
      imageId: c.images[0],
      offset: PNG.length,
    };
    finish(ok(mismatched));
    s.pending = null;
    await wait(
      `document.querySelector('.chat-messages .banner-notice')?.textContent.includes('Send outcome is unknown') && document.querySelector('.inspector-note code')?.textContent === ${q(c.commandId)}`,
    );
    await press("Enter", 13);
    const uncertain = await run(entryFrame);
    assert.equal(uncertain.entry, "new");
    assert.ok(
      uncertain.same &&
        uncertain.focus &&
        uncertain.images === 1 &&
        uncertain.draft === text,
    );
    assert.equal(uncertain.model.text, beforeReceipt.model.text);
    assert.equal(uncertain.level.text, beforeReceipt.level.text);
    assert.deepEqual(await ev("opticalProbe.feedback"), []);
    const beforeObservation = s.commands.slice();
    assert.deepEqual(
      beforeObservation.map((c) => c.kind),
      ["image-upload", "send", "image-upload", "send"],
    );
    s.turns.push({ ...c, entry: "00000012", answer: "Synthetic reply." });
    s.replying = true;
    // Request the now-available record via the pending ID's own readonly
    // refresh. Activate without moving focus, so a remount/blur on receipt
    // cannot be hidden by returning focus to the editor afterwards.
    await run((id) => {
      const note = [...document.querySelectorAll(".inspector-note")].find(
        (p) => p.querySelector("code")?.textContent === id,
      );
      note.querySelector("button").click();
    }, c.commandId);
    await wait(
      `document.querySelector('.chat-workspace[data-entry="received"]') && opticalProbe.feedback.some(e=>e.text === 'Message received')`,
    );
    const observed = await run(entryFrame);
    assert.ok(
      observed.same && observed.focus && !observed.draft && !observed.images,
    );
    assert.deepEqual(s.commands, beforeObservation);
    assert.equal(
      await ev(
        `!!document.querySelector('.inspector-note code') || document.querySelector('.chat-messages').textContent.includes('Send outcome is unknown')`,
      ),
      false,
    );
    row.uncertainFirst = {
      mismatched,
      command: c,
      beforeReceipt,
      uncertain,
      observed,
      commands: beforeObservation,
    };
    const add = '.chat-composer button[aria-label="Add images"]';
    await wait(
      `document.querySelector('${add}:disabled')?.getAttribute('aria-description')?.includes('reply to finish')`,
    );
    await pasteFixtureImage(run);
    await wait(
      `document.body.innerText.includes('Wait for the current reply to finish before adding images.')`,
    );
    const locked = await editor();
    assert.deepEqual(locked, { same: true, draft: "", images: 0 });
    // The same live turn/tool across every reread. A refused or mismatched
    // reply keeps its text. Only each matched input receipt adds a pulse.
    await wait(`!document.querySelector('.conversation-feedback[data-event]')`);
    const notices = () => ev("opticalProbe.feedback.filter(e=>e.text)");
    const receiptPair = [];
    for (const [mode, outcome] of [
      ["steer", "refused"],
      ["steer", "unconfirmed"],
      ["steer", "accepted"],
      ["queue", "accepted"],
    ]) {
      const text = `${mode}: ${outcome}`;
      await run((sel) => document.querySelector(sel).select(), input);
      await send("Input.insertText", { text });
      s.permit = mode;
      await press("Enter", 13, mode === "queue" ? 1 : 0);
      await until(() => s.pending, `held ${mode}`);
      const { command, finish } = s.pending;
      assert.equal(command.kind, "conversation-input");
      assert.equal(command.text, text);
      assert.equal(command.mode, mode);
      if (mode === "queue") {
        // Finish after the first animation's 680ms, BEFORE its 1400ms
        // message expires. Use the page's actual notice time as the origin.
        const before = await run(async (firstAt) => {
          await new Promise((r) =>
            setTimeout(r, firstAt + 900 - performance.now()),
          );
          return {
            elapsed: performance.now() - firstAt,
            text: document.querySelector(".conversation-feedback").innerText,
            animating: document
              .querySelector(".brand-logo svg")
              .getAnimations()
              .some((a) => a.playState === "running"),
          };
        }, receiptPair[0].notice.at);
        row.beforeSecondReceipt = before;
        assert.equal(before.text, receiptPair[0].notice.text);
        assert.equal(before.animating, false);
      } else {
        assert.equal(
          await ev(
            `document.querySelector('.conversation-feedback').innerText`,
          ),
          "",
        );
      }
      finish(
        outcome === "refused"
          ? refused()
          : ok({
              kind: "accepted",
              commandId:
                outcome === "accepted" ? command.commandId : randomUUID(),
            }),
      );
      s.pending = null;
      await wait(
        `!opticalProbe.editor.readOnly && !opticalProbe.editor.disabled`,
      );
      assert.equal((await editor()).draft, outcome === "accepted" ? "" : text);
      if (outcome === "accepted") {
        const expected =
          mode === "steer" ? "Message received" : "2 messages received";
        await wait(
          `document.querySelector('.conversation-feedback').innerText===${q(expected)}`,
        );
        const notice = (await notices()).at(-1);
        assert.equal(notice.text, expected);
        receiptPair.push({ commandId: command.commandId, mode, notice });
      } else {
        assert.equal((await notices()).length, 1); // Only the initial ordinary Send.
        assert.equal(
          await ev(
            `document.querySelector('.conversation-feedback').innerText`,
          ),
          "",
        );
      }
    }
    assert.notEqual(receiptPair[0].commandId, receiptPair[1].commandId);
    const separation = receiptPair[1].notice.at - receiptPair[0].notice.at;
    assert.ok(
      separation >= 850 && separation < 1300,
      `Receipt spacing ${separation}ms`,
    );
    await wait(`!document.querySelector('.conversation-feedback[data-event]')`);
    const duplicate = s.liveTurnReads;
    await until(
      () => s.liveTurnReads > duplicate,
      "unchanged live turn and tool snapshot",
    );
    assert.equal((await notices()).length, 3);
    s.replying = false;
    await wait(`document.querySelector('${add}:enabled')`);
    await pasteFixtureImage(run);
    await wait(`document.querySelector('.chat-image-draft img')`);
    await wait(`!document.querySelector('.conversation-feedback[data-event]')`);
    s.failMode = false;
    await wait(`document.querySelector('.mode-toggle.off')`);
    const baseline = s.modeReads;
    await until(
      () => s.modeReads > baseline,
      "duplicate recovered mode snapshot",
    );
    const feedback = await ev(
      "opticalProbe.endFeedback();opticalProbe.feedback",
    );
    assert.deepEqual(
      feedback.filter((e) => e.text).map((e) => e.text),
      ["Message received", "Message received", "2 messages received"],
    );
    assert.ok(
      feedback
        .filter((e) => e.text)
        .every(
          (e) =>
            e.visible &&
            e.rect.width > 0 &&
            e.rect.height > 0 &&
            e.rect.left >= 0 &&
            e.rect.right <= row.width + 1,
        ),
    );
    const animations = feedback.filter((e) => e.animation);
    const visibleBrand = await ev(
      "document.querySelector('.brand-logo').checkVisibility()",
    );
    if (row.motion === "reduce")
      assert.ok(
        feedback.every((e) => !e.animation && e.brandAnimation === "none"),
      );
    if (row.motion === "reduce" || !visibleBrand)
      assert.equal(animations.length, 0);
    else {
      // Tie each actual animationstart to its own feedback window, not just
      // the total count or a computed animation-name on the second receipt.
      const labels = feedback.filter((e) => e.text);
      assert.equal(animations.length, labels.length);
      for (const [i, label] of labels.entries()) {
        assert.ok(
          animations[i].at >= label.at &&
            animations[i].at < (labels[i + 1]?.at ?? label.at + 680),
        );
        assert.equal(animations[i].animation, label.brandAnimation);
      }
    }
    assert.deepEqual(
      s.commands.map((c) => c.kind),
      [
        "image-upload",
        "send",
        "image-upload",
        "send",
        ...Array(4).fill("conversation-input"),
      ],
    );
    row.bootstrap = {
      feedback,
      receiptPair,
      separation,
      animationStarts: animations.length,
      held,
      locked,
      settled: await editor(),
      commands: s.commands,
    };
  } finally {
    await stop();
  }
}

// Use the browser's editor and capture the actual input it delivers. An
// application history prompt or an untrusted input cannot satisfy restore().
async function nativeEditor({ run, send, ev, press }, steps) {
  await run((sel) => {
    const field = document.querySelector(sel),
      edits = [];
    opticalProbe.nativeEdits = edits;
    field.addEventListener("input", (e) => {
      edits.push({
        type: e.inputType,
        text: field.value,
        trusted: e.isTrusted,
        focused: document.activeElement === field,
      });
    });
    opticalProbe.nativeFrame = (from = edits.length) => {
      const fields = document.querySelectorAll(sel);
      return {
        route: location.hash,
        connected: field.isConnected,
        matches: fields.length,
        same: field === fields[0],
        focused: document.activeElement === field,
        value: field.value,
        currentValue: fields[0]?.value,
        count: edits.length,
        events: edits.slice(from),
      };
    };
  }, input);
  const checkField = (f) =>
    assert.ok(
      f.connected && f.matches === 1 && f.same && f.focused,
      `Native editor changed: ${q(f)}`,
    );
  // CDP delivers these native inputs before the command returns. Keep both
  // frames in the report even if the action fails or the event is missing.
  const edit = async (operation, type, text, act) => {
    const before = await ev("opticalProbe.nativeFrame()");
    const step = { operation, type, text, before };
    steps.push(step);
    checkField(before);
    try {
      await act();
    } finally {
      step.after = await ev(`opticalProbe.nativeFrame(${before.count})`);
    }
    checkField(step.after);
    assert.deepEqual(step.after.events, [
      { type, text, trusted: true, focused: true },
    ]);
    assert.equal(step.after.value, text);
    return step.after.events[0];
  };
  const nativeKey = async (key, code, modifiers, editCommand) => {
    for (const type of ["keyDown", "keyUp"])
      await send("Input.dispatchKeyEvent", {
        type,
        key,
        code: `Key${key.toUpperCase()}`,
        windowsVirtualKeyCode: code,
        modifiers,
        ...(type === "keyDown" ? { commands: [editCommand] } : {}),
      });
  };
  const replace = (text) =>
    edit("replace", "insertText", text, async () => {
      await nativeKey("a", 65, 2, "SelectAll");
      await send("Input.insertText", { text });
    });
  const restore = (redo, text) =>
    edit("restore", redo ? "historyRedo" : "historyUndo", text, () =>
      nativeKey("z", 90, redo ? 10 : 2, redo ? "Redo" : "Undo"),
    );
  const append = (suffix, expected) =>
    edit("append", "insertText", expected, async () => {
      await press("End", 35);
      await send("Input.insertText", { text: suffix });
    });
  return { replace, restore, append };
}

// A new direct session with a known ordinary mode throughout. The prior
// fixture's accepted live input is a real prompt-history entry in this tab.
async function observeOrdinaryPhrase(p, row, paths) {
  const { go, click, send, press, wait, run, ev } = p;
  const s = specimen(`ordinary-${randomUUID()}`);
  s.firstHead.resolve();
  const stop = await intercept(p, s);
  try {
    await go(`/app#chat=${s.id}`, input);
    let editor;
    for (const via of paths) {
      await wait(
        `location.hash===${q(`#chat=${s.id}`)} && document.querySelector('${composer} .mode-toggle.off') && document.querySelector('${composer} .model-trigger-text')?.innerText==='optical'`,
      );
      const before = s.commands.length;
      await click(input);
      editor ??= await nativeEditor(p, row.nativeEditorSteps);
      const attachment = via === "remove image";
      if (attachment) {
        await pasteFixtureImage(run);
        await wait(`document.querySelector('.chat-image-draft img')`);
      }
      let restored, continued;
      if (via === "edit starter") {
        const starter = ".entry-starters button";
        await click(starter);
        const prompt = await ev(`document.activeElement.value`);
        assert.equal(prompt, "Explain this project");
        continued = await editor.append(phrase, prompt + phrase);
        await run(
          (length) => document.activeElement.setSelectionRange(0, length),
          prompt.length,
        );
        await press("Backspace", 8);
      } else if (via === "recall confirmed Send") {
        assert.equal(s.turns.at(-1)?.kind, "send");
        assert.equal(s.turns.at(-1).text, phrase);
        assert.equal(await ev(`document.activeElement.value`), "");
        await press("ArrowUp", 38);
      } else if (via === "complete restored prefix") {
        await editor.replace("按计划");
        await editor.replace(discussion);
        restored = await editor.restore(false, "按计划");
        continued = await editor.append("实施", phrase);
      } else if (via === "historyUndo" || via === "historyRedo") {
        const redo = via === "historyRedo";
        await editor.replace(redo ? discussion : phrase);
        await editor.replace(redo ? phrase : discussion);
        restored = await editor.restore(false, redo ? discussion : phrase);
        if (redo) restored = await editor.restore(true, phrase);
      } else {
        await send("Input.insertText", { text: phrase });
        if (attachment) {
          await click(".chat-image-remove");
          await wait(`!document.querySelector('.chat-image-draft')`);
          await click(input);
        } else {
          await press("ArrowUp", 38);
          await wait(
            `document.querySelector(${q(input)}).value==='queue: accepted'`,
          );
          await press("Escape", 27);
        }
      }
      await wait(
        `document.activeElement.matches(${q(input)}) && document.activeElement.value===${q(phrase)} && document.querySelector('.chat-composer button[type="submit"]:enabled')`,
      );
      assert.equal(s.commands.length, before); // local recovery alone sends nothing
      s.permit = "send";
      await press("Enter", 13);
      await until(() => s.pending, `ordinary send after ${via}`);
      const { command, finish } = s.pending;
      assert.equal(command.kind, "send");
      assert.equal(command.conversationId, s.id);
      assert.equal(command.text, phrase);
      assert.equal(command.images?.length ?? 0, 0);
      assert.equal(command.head, s.turns.at(-1)?.entry ?? null);
      s.turns.push({
        ...command,
        entry: s.turns.length ? "00000014" : "00000012",
        answer: "Ordinary discussion.",
      });
      finish(ok({ kind: "accepted", commandId: command.commandId }));
      s.pending = null;
      await wait(
        `document.querySelector(${q(input)}).value==='' && document.querySelectorAll('.msg-user').length===${s.turns.length}`,
      );
      const commands = s.commands.slice(before);
      assert.deepEqual(
        commands.map((c) => c.kind),
        ["send"],
      );
      row.ordinaryPhrase.push({
        via,
        restored,
        continued,
        text: command.text,
        target: command.conversationId,
        commands,
        focusedAfterReceipt: await ev(
          `document.activeElement.matches(${q(input)})`,
        ),
        mode: await ev(`document.querySelector('.mode-toggle.off').innerText`),
      });
    }
    assert.deepEqual(
      s.commands.map((c) => c.kind),
      paths.map(() => "send"),
    );
    assert.ok(row.ordinaryPhrase.every((trial) => trial.focusedAfterReceipt));
  } finally {
    await stop();
  }
}

async function observeEntry(p, s, row, shot) {
  const { wait, ev, run, press, send, click, observeButton } = p;
  const mode = ".composer-delivery .mode-toggle",
    starter = ".entry-starters button";
  const field = () => ev(`document.querySelector(${q(input)}).value`);
  const record = async (name) => {
    const f = await run(entryFrame);
    row.entry[name] = f;
    assert.equal(f.inputs, 1);
    assert.equal(f.same, true);
    return f;
  };
  await until(() => s.headRequested, "held opening head");
  await wait(
    `document.querySelector('.chat-workspace[data-entry="unobserved"]') && !document.querySelector('.chat-welcome')`,
  );
  await ev(`opticalProbe.editor=document.querySelector(${q(input)});void 0`);
  s.unknown = true;
  s.firstHead.resolve();
  await wait(
    `document.querySelector('${mode}.unknown:disabled') && document.querySelector('.chat-messages').innerText.includes('Mode observation unavailable for this specimen.')`,
  );
  row.unknown = await ev(`document.querySelector('${mode}').title`);
  assert.match(row.unknown, /unavailable/i);
  s.unknown = false;
  await wait(
    `document.querySelector('${mode}.off') && document.querySelector('.model-trigger-text')?.textContent==='optical' && document.querySelector('${starter}')`,
  );
  await run(watchFeedback);
  const fresh = await record("new");
  assert.equal(fresh.dark, p.theme === "dark");
  assert.equal(fresh.viewport[0], p.width);
  assert.equal(fresh.reduced, p.motion === "reduce");
  assert.equal(fresh.mode, "Ordinary send");
  assert.equal(fresh.draft, "");
  assert.ok(fresh.starters.length >= 1 && fresh.starters.length <= 2);
  assert.ok(
    fresh.logo.height > 0 &&
      fresh.greeting.height > 0 &&
      fresh.form.top >= fresh.greeting.bottom,
  );
  const mid = (fresh.header.bottom + fresh.workspace.bottom) / 2;
  assert.ok(
    Math.abs((fresh.welcome.top + fresh.form.bottom) / 2 - mid) <
      fresh.workspace.height * 0.09,
    "Welcome and form not centered together",
  );
  assert.ok(
    fresh.model.visible &&
      fresh.level.visible &&
      fresh.level.text.includes("Medium"),
  );
  await shot("new");
  const key = async (selector, name = undefined) => {
    const g = await observeButton("quiet keyboard", selector, name);
    assert.equal(g.keyboardFocus, true);
    await press(" ", 32);
  };
  for (const [selector, model, level] of [
    [".model-option:nth-of-type(2)", "agate", "Medium"],
    [".model-thinking [aria-label='Thinking level: High']", "agate", "High"],
  ]) {
    await key(".chat-composer .model-trigger");
    await wait(`document.querySelector(${q(`${selector}:enabled`)})`);
    s.permit = "conversation-model";
    await key(selector);
    await wait(
      `!document.querySelector('.model-popover') && document.querySelector('.model-trigger-text').textContent===${q(model)} && document.querySelector('.model-trigger-level').innerText.includes(${q(level)})`,
    );
  }
  const selected = await record("chosen");
  assert.ok(selected.model.visible && selected.level.visible);
  await key(starter);
  await wait(
    `document.activeElement.matches(${q(input)}) && !document.querySelector(${q(starter)})`,
  );
  const start = await field();
  assert.equal(start, fresh.starters[0]);
  await send("Input.insertText", { text: " — inspect the facet." });
  const draft = await field();
  assert.ok(draft.includes(start) && draft.includes("inspect the facet"));
  await pasteFixtureImage(run);
  await wait(
    `document.querySelector('.chat-image-draft img') && document.querySelector('.chat-composer button[type="submit"]:enabled')`,
  );
  assert.deepEqual(
    s.commands.map((c) => c.kind),
    ["conversation-model", "conversation-model"],
  );
  const dispatch = async (kind) => {
    s.permit = kind;
    await press("Enter", 13);
    await until(() => s.pending, kind);
    return s.pending.command;
  };
  const settle = (response) => {
    s.pending.finish(response);
    s.pending = null;
  };
  await dispatch("send");
  await press("Enter", 13);
  const held = await record("unconfirmed");
  assert.equal(held.entry, "new");
  assert.equal(held.focus, true);
  assert.equal(held.draft, draft);
  assert.equal(held.images, 1);
  settle(refused());
  await wait(
    `document.querySelector('.chat-composer button[type="submit"]:enabled')`,
  );
  const failed = await record("refused");
  assert.equal(failed.entry, "new");
  assert.equal(failed.focus, true);
  assert.equal(failed.draft, draft);
  assert.equal(failed.images, 1);
  await click(`${mode}.off`);
  await wait(`document.querySelector('${mode}.armed')`);
  row.armed = await ev(`document.querySelector('${mode}').innerText`);
  assert.match(row.armed, /next Send/i);
  await click(input);
  const c = await dispatch("cadence-send");
  assert.equal(c.intent, "enter");
  assert.equal(c.text, draft);
  assert.equal(c.images.length, 1);
  s.turns.push({
    ...c,
    entry: "00000012",
    answer: [
      "The material is quartz.",
      ...Array.from(
        { length: 28 },
        (_, i) => `Sample ${i + 1}: compare the polished and natural surfaces.`,
      ),
    ].join("\n\n"),
  });
  ++s.revision;
  // Capture real intermediate compositor-frame coordinates, not an animation
  // declaration. Start before the receipt while the very same editor is locked.
  await ev(
    `opticalProbe.movement=[]; { const start=performance.now(); const frame=now=>{const dock=document.querySelector('.composer-dock');opticalProbe.movement.push({ms:Math.round(now-start),top:dock.getBoundingClientRect().top,focus:document.activeElement===opticalProbe.editor});if(now-start<800)requestAnimationFrame(frame);else opticalProbe.moved=true;};requestAnimationFrame(frame); }`,
  );
  settle(ok({ kind: "accepted", commandId: c.commandId }));
  await wait(
    `document.querySelector('.msg-assistant')?.innerText.includes('The material is quartz.') && document.querySelector('${mode}.on')`,
  );
  const received = await record("received");
  assert.ok(received.entry !== "new" && !received.welcome);
  assert.equal(received.focus, true);
  assert.equal(received.draft, "");
  assert.equal(received.images, 0);
  assert.ok(
    received.form.top > fresh.form.top + 50 &&
      received.workspace.bottom - received.form.bottom < 36,
  );
  assert.deepEqual(
    s.commands.map((c) => c.kind),
    [
      "conversation-model",
      "conversation-model",
      "image-upload",
      "send",
      "image-upload",
      "cadence-send",
    ],
  );
  await wait("opticalProbe.moved");
  row.movement = await ev("opticalProbe.movement");
  assert.ok(row.movement.every((f) => f.focus));
  row.receiptFeedback = await ev("opticalProbe.feedback");
  const receipts = row.receiptFeedback.filter(
    (e) => e.text === "Message received",
  );
  assert.equal(receipts.length, 1);
  assert.ok(receipts[0].rect.height > 0);
  if (p.motion === "reduce")
    assert.ok(
      row.receiptFeedback.every(
        (e) =>
          !e.animation && (!e.brandAnimation || e.brandAnimation === "none"),
      ),
    );
  await shot("received");
}

function planFrame() {
  return opticalProbe.stableFrames(() => {
    const e = document.querySelector("[data-plan-proposal]"),
      panel = e.closest(".current-plan-panel"),
      details = e.querySelector(":scope > details"),
      box = (node) => node.getBoundingClientRect().toJSON();
    return {
      count: document.querySelectorAll("[data-plan-proposal]").length,
      tail: document.querySelectorAll(".chat-messages [data-plan-proposal]")
        .length,
      status: e.querySelector(".plan-status").innerText,
      goal: e.querySelector("h3").innerText,
      sections: [
        ...e.querySelectorAll(
          ":scope > header, :scope > section, :scope > details",
        ),
      ].map((node) => ({
        label: node.querySelector("h3,h4,summary")?.innerText,
        rect: box(node),
      })),
      scope: e.querySelector(".plan-scope").innerText,
      open: details.open,
      summary: details.querySelector("summary").innerText,
      button: e.querySelector(":scope > button.primary").innerText,
      disabled: e.querySelector(":scope > button.primary").disabled,
      viewport: innerWidth,
      card: box(e),
      panel: box(panel),
      client: panel.clientWidth,
      scroll: panel.scrollWidth,
      binding: [...details.querySelectorAll(".plan-binding > p")].map((el) => ({
        text: el.innerText,
        rect: box(el),
      })),
    };
  }, "current plan");
}
async function observeProposal(p, s, row, shot) {
  const { ev, run, wait, click, press, send, observeButton } = p;
  const collapsed = async (goal) =>
    wait(
      `document.querySelector(${q(trigger)})?.title===${q(goal)} && document.querySelector(${q(trigger)})?.getAttribute('aria-expanded')==='false' && !document.querySelector(${q(card)}) && !document.querySelector('.chat-messages .workflow-plan > button.primary')`,
    );
  const open = async () => {
    const g = await observeButton(
      "open current plan",
      trigger,
      "View current plan",
    );
    assert.equal(g.keyboardFocus, true);
    await press(" ", 32);
    await wait(
      `document.querySelector(${q(trigger)})?.getAttribute('aria-expanded')==='true' && document.querySelector(${q(card)})`,
    );
  };
  const frame = async (name, proposal) => {
    const f = await run(planFrame);
    row.plan[name] = f;
    assert.equal(f.count, 1);
    assert.equal(f.tail, 0);
    assert.equal(f.open, false);
    assert.ok(f.goal.includes(proposal.plan.goal));
    assert.ok(!f.disabled);
    assert.ok(
      f.card.left >= 0 &&
        f.card.right <= f.viewport + 1 &&
        f.scroll <= f.client + 1,
      "Proposal exceeds its reading viewport",
    );
    assert.deepEqual(
      f.sections.slice(1, 4).map((s) => s.label),
      ["Proposed changes", "Decisions and non-goals", "What approval allows"],
    );
    for (let i = 1; i < f.sections.length; i++) {
      const a = f.sections[i - 1].rect,
        b = f.sections[i].rect;
      assert.ok(
        b.top >= a.bottom - 1 && Math.abs(a.left - b.left) <= 1,
        "Proposal sections must stack in one column",
      );
    }
    const local = proposal.plan.delivery === "local-merge";
    assert.equal(f.scope.includes("fast-forward"), local);
    for (const term of [
      cwd,
      "optical/reader",
      "not in a sandbox",
      local ? "isolated worktrees" : "No commit or merge",
      "route and repository write scope",
      "No dependency installation",
      "No push, publication or deployment",
    ])
      assert.ok(f.scope.includes(term), `Missing default scope: ${term}`);
    const terms = [
      readableWorkflowPlan(proposal.plan),
      readableDelivery(proposal.delivery),
    ].filter(Boolean);
    const counts = await run(
      (sel, terms, runtime) => {
        const e = document.querySelector(sel);
        return {
          exact: terms.map((text) => e.textContent.split(text).length - 1),
          outside: terms.map((text) => e.innerText.includes(text)),
          runtimeOutside: e.innerText.includes(runtime),
          actions: e.querySelectorAll(":scope > button.primary").length,
        };
      },
      card,
      terms,
      proposal.display.runtime,
    );
    assert.deepEqual(counts, {
      exact: terms.map(() => 1),
      outside: terms.map(() => false),
      runtimeOutside: false,
      actions: 1,
    });
    return f;
  };
  const witnessPreparation = async (target, name, before) => {
    s.permit = "cadence-prepare";
    await press("Enter", 13);
    await until(() => !s.permit, "explicit edit bound to B");
    row.plan[name] = {
      proposal: target.id,
      commands: s.commands.slice(before),
    };
    assert.deepEqual(
      row.plan[name].commands.map((c) => c.kind),
      ["cadence-prepare"],
    );
    assert.equal(row.plan[name].commands[0].proposalId, target.id);
  };
  const prefix = s.commands.length,
    pane = ".chat-workspace .chat-messages";
  const pos = () =>
    ev(
      `opticalProbe.stableFrames(()=>document.querySelector(${q(pane)}).scrollTop,'reader offset')`,
    );
  const xy = await run((sel) => {
    const e = document.querySelector(sel),
      r = e.getBoundingClientRect();
    return { x: r.left + 24, y: r.top + 85, top: e.scrollTop };
  }, pane);
  assert.ok(xy.top > 120);
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: xy.x,
    y: xy.y,
    deltaX: 0,
    deltaY: -124,
  });
  await wait(`document.querySelector(${q(pane)}).scrollTop<${xy.top - 80}`);
  row.beforePublication = await pos();
  const first = s.makeProposal();
  await collapsed(first.plan.goal);
  assert.equal(await pos(), row.beforePublication);
  assert.ok(await ev(`document.activeElement===opticalProbe.editor`));
  await open();
  const a = await frame("published", first);
  assert.equal(a.status, "Awaiting plan approval");
  assert.equal(a.button, "Implement this plan");
  await shot("plan");
  await click(`${card} > details > summary`);
  const details = await run(planFrame);
  row.plan.details = details;
  assert.equal(details.open, true);
  assert.ok(details.scroll <= details.client + 1);
  const brief = details.binding[0],
    policy = details.binding.at(-1);
  assert.ok(
    brief.text.includes(cwd) &&
      policy.text === first.display.runtime &&
      policy.rect.height > brief.rect.height * 2 &&
      policy.rect.top >= brief.rect.bottom,
    "Short target and long runtime must not share a stretched row",
  );
  await run(() =>
    document
      .querySelector(".plan-binding > p:last-of-type")
      .scrollIntoView({ block: "start" }),
  );
  await shot("technical-details");
  await click(trigger);
  await collapsed(first.plan.goal);
  assert.equal(await pos(), row.beforePublication);
  await open();
  await click(input);
  await send("Input.insertText", { text: discussion });
  s.permit = "cadence-send";
  await press("Enter", 13);
  await until(() => s.pending, "discussion Send");
  const c = s.pending.command;
  assert.equal(c.text, discussion);
  assert.equal(c.head, s.turns[0].entry);
  assert.equal(c.intent, "message");
  s.turns.push({
    ...c,
    entry: "00000014",
    answer: "The JSON output will stay as it is.",
  });
  ++s.revision;
  s.pending.finish(ok({ kind: "accepted", commandId: c.commandId }));
  s.pending = null;
  await wait(
    `document.querySelectorAll('.msg-user').length===2 && document.querySelector('.chat-messages').innerText.includes(${q(discussion)})`,
  );
  await collapsed(first.plan.goal);
  assert.ok(await ev("document.activeElement===opticalProbe.editor"));
  await shot("discussion");
  await open();
  await frame("reopened", first);
  await click(input);
  await send("Input.insertText", { text: phrase });
  await wait(`document.querySelector(${q(input)}).value === ${q(phrase)}`);
  const ready = s.makeProposal("replacement");
  await collapsed(ready.plan.goal);
  const refuseDraft = async (name, text = phrase) => {
    const before = s.commands.length;
    await press("Enter", 13);
    await wait(
      `document.querySelector('.notice[role="alert"]')?.textContent.includes('Review it from the conversation title')`,
    );
    row.plan[name] = await run((selector) => {
      const editor = document.querySelector(selector);
      return { text: editor.value, focused: document.activeElement === editor };
    }, input);
    assert.deepEqual(row.plan[name], { text, focused: true });
    row.plan[name].commands = s.commands.slice(before);
    assert.deepEqual(row.plan[name].commands, []);
    await click('.notice[role="alert"] .notice-close');
  };
  // This B can be implemented immediately. A stale-model B would exercise
  // the validation path instead and miss the unintended approval entirely.
  await refuseDraft("replacedBeforeEnter");
  await open();
  assert.equal(
    (await frame("readyReplacement", ready)).button,
    "Implement this plan",
  );
  await click(input);
  await refuseDraft("openedWithoutEditing");
  // The title now shows B. Editing only the margins of A's still-mounted
  // draft must not re-author it. Remove only the added character between
  // trials, without replacing or parking the original phrase.
  const endOfDraft = async () => {
    await click(input);
    await run((sel) => {
      const field = document.querySelector(sel);
      field.setSelectionRange(field.value.length, field.value.length);
    }, input);
  };
  for (const suffix of [" ", "\n"]) {
    await endOfDraft();
    if (suffix === " ") await send("Input.insertText", { text: suffix });
    else
      for (const type of ["keyDown", "keyUp"])
        await send("Input.dispatchKeyEvent", {
          type,
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          modifiers: 8, // Shift+Enter, including Chromium's native text edit.
          ...(type === "keyDown" ? { text: "\r" } : {}),
        });
    await wait(`document.activeElement.value===${q(phrase + suffix)}`);
    await refuseDraft(
      suffix === " " ? "spaceOnOldPhrase" : "newlineOnOldPhrase",
      phrase + suffix,
    );
    await endOfDraft();
    await press("Backspace", 8);
    await wait(`document.activeElement.value===${q(phrase)}`);
  }
  // Restoring A's parked text from a real history walk is not entering B's
  // phrase. Exercise both ways out of the history cursor.
  for (const [key, code] of [
    ["Escape", 27],
    ["ArrowDown", 40],
  ]) {
    await click(input);
    await press("ArrowUp", 38);
    await wait(
      `document.querySelector(${q(input)}).value === ${q(discussion)}`,
    );
    await press(key, code);
    await wait(`document.querySelector(${q(input)}).value === ${q(phrase)}`);
    await refuseDraft(`historyRestored${key}`);
  }
  await click(input);
  const retypePrefix = s.commands.length;
  const authored = await nativeEditor(p, row.nativeEditorSteps);
  await authored.replace(discussion);
  await authored.replace(phrase);
  await witnessPreparation(ready, "retypedAfterWhitespace", retypePrefix);
  const next = s.makeProposal("stale");
  await collapsed(next.plan.goal);
  await open();
  const replacement = await frame("replacement", next);
  assert.equal(replacement.button, "Validate plan again");
  assert.ok(
    !(await ev(
      `document.querySelector(${q(card)}).textContent.includes(${q(first.id)})`,
    )),
  );
  const before = await ev("performance.timeOrigin");
  await send("Page.reload", { ignoreCache: true });
  await wait(`performance.timeOrigin !== ${before}`);
  await collapsed(next.plan.goal);
  const history = await run(
    (sel) => ({
      entry: document.querySelector(".chat-workspace[data-entry]").dataset
        .entry,
      welcome: !!document.querySelector(".chat-welcome"),
      draft: document.querySelector(sel).value,
    }),
    input,
  );
  assert.deepEqual(history, {
    entry: "history",
    welcome: false,
    draft: phrase,
  });
  await open();
  assert.equal((await frame("cold", next)).button, "Validate plan again");
  await click(input);
  await refuseDraft("restoredTextOnly");
  assert.deepEqual(
    s.commands.slice(prefix).map((c) => c.kind),
    ["cadence-send", "cadence-prepare"],
  );
  // This time the draft really does belong to the displayed stale proposal.
  // The button validates it once; neither validation nor opening the rebound
  // proposal may transfer that draft to the new approvable binding.
  const validationPhrase = "approve and execute";
  await click(input);
  await run((selector) => document.querySelector(selector).select(), input);
  await send("Input.insertText", { text: validationPhrase });
  await wait(
    `document.querySelector(${q(input)}).value === ${q(validationPhrase)}`,
  );
  s.permit = "cadence-revalidate";
  await click(`${card} > button.primary`, "Validate plan again");
  await until(
    () => s.proposal.revalidatedFrom === next.id,
    "revalidated projection",
  );
  await collapsed(next.plan.goal);
  await open();
  const rebound = await frame("revalidated", s.proposal);
  assert.equal(rebound.button, "Confirm implementation");
  assert.match(rebound.status, /Nothing was approved/);
  await shot("revalidated");
  await click(input);
  await refuseDraft("revalidatedWithoutEditing", validationPhrase);
  assert.deepEqual(
    s.commands.slice(prefix).map((c) => c.kind),
    ["cadence-send", "cadence-prepare", "cadence-revalidate"],
  );

  // Create both sides of Chromium's native history cursor under A. The
  // middle discussion edit can now be undone OR redone back to A's phrase.
  // CDP edit commands run the browser's editor; no value setter, fake input
  // event or application draft callback is used. Capture the trusted input.
  const nativePrefix = s.commands.length;
  await click(input);
  const { replace, restore } = await nativeEditor(p, row.nativeEditorSteps);
  await replace(phrase);
  await replace(discussion);
  await replace(phrase);
  await restore(false, discussion);
  const target = s.makeProposal("replacement");
  await collapsed(target.plan.goal);
  await open();
  assert.equal(
    (await frame("nativeReplacement", target)).button,
    "Implement this plan",
  );
  await click(input);
  await restore(false, phrase);
  await refuseDraft("nativeUndo");
  await click(input);
  await restore(true, discussion);
  await restore(true, phrase);
  await refuseDraft("nativeRedo");
  row.plan.nativeHistory = {
    edits: await ev("opticalProbe.nativeEdits"),
    commands: s.commands.slice(nativePrefix),
  };
  assert.deepEqual(row.plan.nativeHistory.commands, []);

  // A new explicit edit under B is the positive control. Intercept only its
  // exact B preparation and refuse it: no grant, approval or real execution.
  await click(input);
  await replace(discussion);
  await replace(phrase);
  await witnessPreparation(target, "freshPreparation", nativePrefix);
  await click(trigger);
}

function historyFrame(title) {
  return opticalProbe.stableFrames(() => {
    const side = document.querySelector(".panel-left"),
      rows = [...side.querySelectorAll(".conversation-row > .session-item")],
      button = rows.find((e) => e.title === title),
      root = button.closest(".history-entry"),
      mark = button.querySelector(".history-activity-mark"),
      summary = root.querySelector(".history-workflows summary"),
      rect = button.getBoundingClientRect();
    return {
      order: rows.map((e) => e.title),
      text: button.innerText,
      working: mark?.getAttribute("aria-label"),
      result: button.querySelector(".session-state")?.innerText ?? "",
      markAnimations: mark?.getAnimations().length,
      rect: rect.toJSON(),
      hit: button.contains(
        document.elementFromPoint(rect.left + 12, rect.top + rect.height / 2),
      ),
      focused: document.activeElement === button,
      focusVisible: button.matches(":focus-visible"),
      inHistory: !!button.closest(".task-list"),
      linked: summary?.innerText.trim() ?? "0",
      feedback:
        document.querySelector(".conversation-feedback")?.innerText ?? "",
    };
  }, "background conversation");
}
// Keep the clicked node, not a selector that could silently pick up its replacement.
function watchReplyInput(sel, answer, stopButton) {
  const field = document.querySelector(sel),
    events = [],
    listeners = new AbortController();
  const name = (el) => el && `${el.localName}.${el.className}`;
  for (const type of ["pointerdown", "focusin", "focusout"])
    document.addEventListener(
      type,
      (e) =>
        events.push({
          type,
          at: performance.now(),
          trusted: e.isTrusted,
          onField: e.target === field,
          target: name(e.target),
          related: name(e.relatedTarget),
          ...(type === "pointerdown" ? { x: e.clientX, y: e.clientY } : {}),
        }),
      { capture: true, signal: listeners.signal },
    );
  const frame = () => {
    const fields = document.querySelectorAll(sel),
      rect = field.getBoundingClientRect(),
      point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      target = document.elementFromPoint(point.x, point.y);
    return {
      matches: fields.length,
      same: fields[0] === field && field.isConnected,
      disabled: field.disabled,
      readOnly: field.readOnly,
      draft: field.value,
      active: name(document.activeElement),
      focused: document.activeElement === field,
      replyShown:
        document
          .querySelector(".msg-assistant .msg-body")
          ?.innerText.includes(answer) ?? false,
      stopAvailable: !!document.querySelector(`${stopButton}:enabled`),
      ordinary: !!field.form?.querySelector(".mode-toggle.off"),
      model: field.form?.querySelector(".model-trigger-text")?.innerText,
      level: field.form?.querySelector(".model-trigger-level")?.innerText,
      rect: rect.toJSON(),
      point,
      hit: target === field,
      target: name(target),
      events,
    };
  };
  opticalProbe.replyInput = {
    frame,
    end: () => {
      listeners.abort();
      return frame();
    },
  };
}

// One ordinary reply, exact turn + epoch throughout. No linked workflow or
// gateway discovery can mask an early release of this direct owner's row.
async function observeDirectReply(p, row) {
  const { go, click, clickPoint, wait, run, ev, press, observeButton } = p;
  const s = specimen(background);
  s.firstCatalog = Promise.withResolvers();
  s.firstHead.resolve();
  s.turns.push({
    kind: "send",
    commandId: s.live.commandId,
    text: "Describe the material.",
    answer: "Reading the notes.",
    entry: "00000012",
  });
  s.replying = true;
  s.roster = {
    name: "solo reply",
    soloReply: true,
    at: clock,
    count: 0,
    reply: true,
  };
  const opening = {};
  row.directReply = { id: s.id, live: s.live, opening, inputs: [] };
  const stop = await intercept(p, s);
  try {
    const stopButton = '.chat-composer button[aria-label="Stop response"]';
    await go(`/app#chat=${s.id}`, input);
    await run(watchReplyInput, input, s.turns[0].answer, stopButton);
    await until(() => s.catalogRequested, "held direct-reply model catalog");
    const ready = (f) =>
      f.replyShown &&
      f.stopAvailable &&
      f.ordinary &&
      f.matches === 1 &&
      f.same &&
      !f.disabled &&
      !f.readOnly;
    await wait(`(${ready})(opticalProbe.replyInput.frame())`);
    const held = await ev(
      `opticalProbe.stableFrames(opticalProbe.replyInput.frame, 'direct reply before catalog')`,
    );
    opening.held = held;
    assert.ok(ready(held) && held.hit);
    assert.notEqual(held.model, "optical");
    await clickPoint(input, held.point);
    const pressed = await ev("opticalProbe.replyInput.frame()");
    opening.pressed = pressed;
    assert.deepEqual(
      pressed.events
        .filter((e) => e.type === "pointerdown")
        .map((e) => [e.trusted, e.onField]),
      [[true, true]],
    );
    assert.ok(pressed.same && pressed.focused);
    s.firstCatalog.resolve();
    await wait(
      `document.querySelector('${composer} .model-trigger-text')?.innerText==='optical' && document.querySelector('${composer} .model-trigger-level')?.innerText==='Thinking · Medium'`,
    );
    const loaded = await ev("opticalProbe.replyInput.frame()");
    opening.loaded = loaded;
    assert.ok(loaded.matches === 1 && loaded.same && loaded.focused);
    assert.ok(
      !loaded.events
        .slice(held.events.length)
        .some((e) => e.type === "focusout" && e.onField),
      "Clicked editor lost focus",
    );
    const editor = await nativeEditor(p, row.nativeEditorSteps);
    const reason =
      "Cannot steer or queue: Current action context unavailable; observe again.";
    const frame = () =>
      run(
        (sel, stop) =>
          opticalProbe.stableFrames(() => {
            const field = document.querySelector(sel),
              status = document.querySelector(".composer-status");
            return {
              draft: field.value,
              focus: field === document.activeElement,
              stop: !!document.querySelector(`${stop}:enabled`),
              steer: !!document.querySelector(".composer-steer:enabled"),
              queue: !!document.querySelector(".composer-queue:enabled"),
              reason: status?.innerText ?? null,
              description: field.getAttribute("aria-description"),
            };
          }, "live input"),
        input,
        stopButton,
      );
    for (const mode of ["steer", "queue"]) {
      await editor.replace(phrase);
      await editor.replace(discussion);
      const restored = await editor.restore(false, phrase);
      await wait(`document.querySelector('.composer-steer:enabled')`);
      if (mode === "steer") {
        // An explicit readonly refresh retires action context until the
        // workspace GET returns. The allocation and its safety Stop survive.
        s.firstWorkspace = Promise.withResolvers();
        await click(".more-menu > summary");
        await click('.more-menu [aria-label="Observe current state"]');
        await until(() => s.workspaceRequested, "held current-state read");
        await wait(
          `document.querySelector('${stopButton}:enabled') && document.querySelector('.composer-status')?.innerText===${q(reason)}`,
        );
        await click(input);
        const blocked = [];
        for (const modifier of [0, 1]) {
          await press("Enter", 13, modifier);
          const held = await frame();
          assert.deepEqual(held, {
            draft: phrase,
            focus: true,
            stop: true,
            steer: false,
            queue: false,
            reason,
            description: reason,
          });
          assert.deepEqual(s.commands, []);
          blocked.push({
            key: modifier ? "Alt+Enter" : "Enter",
            ...held,
            commands: [...s.commands],
          });
        }
        s.firstWorkspace.resolve();
        await wait(`document.querySelector('.composer-queue:enabled')`);
        const recovered = await frame();
        assert.deepEqual(recovered, {
          draft: phrase,
          focus: true,
          stop: true,
          steer: true,
          queue: true,
          reason: null,
          description: null,
        });
        assert.deepEqual(s.commands, []);
        row.directReply.context = {
          blocked,
          recovered,
          commandsBeforeFreshKey: [...s.commands],
        };
      }
      s.permit = mode;
      await press("Enter", 13, mode === "queue" ? 1 : 0);
      await until(() => s.pending, `explicit ${mode} of restored text`);
      const { command, finish } = s.pending;
      assert.deepEqual(command, {
        kind: "conversation-input",
        commandId: command.commandId,
        conversationId: s.id,
        turnId: s.live.commandId,
        epoch: s.live.epoch,
        text: phrase,
        mode,
      });
      if (mode === "queue")
        s.waiting = [{ commandId: command.commandId, mode, text: phrase }];
      finish(ok({ kind: "accepted", commandId: command.commandId }));
      s.pending = null;
      await wait(
        `document.activeElement.matches(${q(input)}) && !document.activeElement.value && document.querySelector('${stopButton}:enabled')`,
      );
      row.directReply.inputs.push({ restored, command, after: await frame() });
    }
    row.directReply.withdrawals = [];
    const withdraw =
      '.chat-waiting button[aria-label="Withdraw and put back in the message box"]';
    const target = {
      conversationId: s.id,
      turnId: s.live.commandId,
      epoch: s.live.epoch,
    };
    for (const mode of ["queue", "steer"]) {
      const before = s.commands.length;
      const original = s.waiting[0];
      assert.equal(original.text, phrase);
      await wait(`document.querySelector('${withdraw}:enabled')`);
      s.permit = "conversation-input-cancel";
      await click(withdraw);
      await until(() => s.pending, "withdrawing the original input");
      const cancel = s.pending.command;
      assert.deepEqual(cancel, {
        kind: "conversation-input-cancel",
        commandId: cancel.commandId,
        ...target,
        inputId: original.commandId,
      });
      assert.equal(await ev(`document.querySelector(${q(input)}).value`), "");
      s.waiting = [];
      s.pending.finish(ok({ kind: "accepted", commandId: cancel.commandId }));
      s.pending = null;
      await wait(
        `!document.querySelector('${withdraw}') && document.querySelector('.composer-queue:enabled') && document.querySelector(${q(input)}).value===${q(phrase)}`,
      );
      assert.deepEqual(s.commands.slice(before), [
        { kind: cancel.kind, commandId: cancel.commandId },
      ]);
      await click(input);
      s.permit = mode;
      await press("Enter", 13, mode === "queue" ? 1 : 0);
      await until(() => s.pending, `explicit ${mode} after withdrawal`);
      const next = s.pending.command;
      assert.deepEqual(next, {
        kind: "conversation-input",
        commandId: next.commandId,
        ...target,
        mode,
        text: phrase,
      });
      if (mode === "queue")
        s.waiting = [{ commandId: next.commandId, mode, text: next.text }];
      s.pending.finish(ok({ kind: "accepted", commandId: next.commandId }));
      s.pending = null;
      await wait(`document.querySelector(${q(input)}).value===''`);
      row.directReply.withdrawals.push({ original, cancel, next });
    }
    // A final queued input will outlive its reply. Putting it back must be
    // just a draft edit, even when submitted later as ordinary discussion.
    await editor.replace(phrase);
    s.permit = "queue";
    await press("Enter", 13, 1);
    await until(() => s.pending, "queue before reply failure");
    const queued = s.pending.command;
    assert.deepEqual(queued, {
      kind: "conversation-input",
      commandId: queued.commandId,
      ...target,
      mode: "queue",
      text: phrase,
    });
    s.waiting = [{ commandId: queued.commandId, mode: "queue", text: phrase }];
    s.pending.finish(ok({ kind: "accepted", commandId: queued.commandId }));
    s.pending = null;
    await wait(
      `document.querySelector('.chat-waiting.queue .chat-attempt-text')?.textContent===${q(phrase)}`,
    );
    const button = `.conversation-row > button[title="${title}"]`;
    if (
      await ev(
        `document.querySelector('.navigation-toggle')?.getAttribute('aria-expanded')==='false'`,
      )
    )
      await click(".navigation-toggle");
    assert.ok(
      (await observeButton("single direct reply", button)).keyboardFocus,
    );
    const active = await run(historyFrame, title);
    assert.deepEqual(active.order, [title, "Earlier material"]);
    assert.ok(
      active.focused && !active.inHistory && active.working === "Working",
    );
    assert.equal(active.linked, "0");
    assert.equal(active.result, "");
    s.replying = false;
    s.roster = { ...s.roster, name: "result recorded", replyResult: "failed" };
    s.waiting = [];
    s.undelivered = [
      {
        commandId: queued.commandId,
        status: "failed",
        notice: "Not delivered.",
        text: phrase,
      },
    ];
    await wait(
      `document.querySelector(${q(`${button} .session-state.failed`)})`,
    );
    const settling = await run(historyFrame, title);
    assert.deepEqual(settling.order, active.order);
    assert.ok(
      settling.focused && !settling.inHistory && settling.working === "Working",
    );
    assert.equal(settling.result, "failed");
    assert.equal(settling.linked, "0");
    s.roster = { ...s.roster, name: "cleanup finished", reply: false };
    await wait(
      `document.querySelector(${q(`.task-list ${button} .session-state.failed`)})`,
    );
    const released = await run(historyFrame, title);
    assert.deepEqual(released.order, ["Earlier material", title]);
    assert.ok(released.inHistory && !released.working);
    assert.equal(released.result, "failed");
    row.directReply.history = { active, settling, released };
    if (await ev(`!!document.querySelector('.panel-drawer.drawer-left.open')`))
      await click(".navigation-toggle");
    await wait(
      `document.querySelector('.chat-undelivered button') && !document.querySelector('.composer-queue')`,
    );
    await click(input);
    await editor.replace(discussion);
    const ledger = s.commands.slice();
    await click(".chat-undelivered button", "Put back in the message box");
    const appended = await ev("opticalProbe.nativeFrame()");
    assert.ok(appended.same && appended.focused);
    assert.equal(appended.value, `${discussion}\n${phrase}`);
    await run(
      (selector, count) =>
        document.querySelector(selector).setSelectionRange(0, count),
      input,
      discussion.length + 1,
    );
    await press("Backspace", 8);
    const remaining = await ev("opticalProbe.nativeFrame()");
    assert.equal(remaining.value, phrase);
    assert.ok(remaining.same && remaining.focused);
    assert.deepEqual(s.commands, ledger);
    s.permit = "send";
    await press("Enter", 13);
    await until(
      () => s.pending,
      "ordinary Send after appending the undelivered text",
    );
    const resent = s.pending.command;
    assert.equal(resent.kind, "send");
    assert.equal(resent.text, phrase);
    assert.equal(resent.head, s.turns.at(-1).entry);
    assert.equal(resent.conversationId, s.id);
    s.pending.finish(ok({ kind: "accepted", commandId: resent.commandId }));
    s.pending = null;
    await wait(
      `!document.querySelector(${q(input)}).value && opticalProbe.nativeFrame().focused`,
    );
    row.directReply.appendToDraft = {
      queued,
      appended,
      remaining,
      commandsBeforeSend: ledger,
      resent,
    };
    row.directReply.commands = [...s.commands];
    assert.deepEqual(
      s.commands,
      [
        ...row.directReply.inputs.map(({ command }) => command),
        ...row.directReply.withdrawals.flatMap(({ cancel, next }) => [
          cancel,
          next,
        ]),
        queued,
        resent,
      ].map(({ kind, commandId }) => ({ kind, commandId })),
    );
    assert.equal(
      new Set(s.commands.map((c) => c.commandId)).size,
      s.commands.length,
    );
  } finally {
    try {
      opening.catalogRequested = !!s.catalogRequested;
      opening.last = await ev("opticalProbe.replyInput?.end() ?? null");
    } finally {
      s.firstCatalog.resolve();
      await stop();
    }
  }
}

async function observeHistory(p, s, row, shot) {
  const { wait, click, ev, observeButton, run } = p;
  const button = `.conversation-row > button[title="${title}"]`,
    summary = ".history-unlinked > summary";
  if (
    await ev(
      `document.querySelector('.navigation-toggle')?.getAttribute('aria-expanded')==='false'`,
    )
  )
    await click(".navigation-toggle");
  const change = async (name, seconds, phase, count, reply, stale = false) => {
    s.roster = {
      name,
      at: clock + seconds * 1000,
      stale,
      phase,
      count,
      reply,
    };
    await until(
      () =>
        ["conversation-active", "workflow-active"].every((k) =>
          s.served.has(`${k}:${name}`),
        ),
      `both roster reads: ${name}`,
    );
    await wait(
      `document.querySelector(${q(button)})?.closest('.history-entry')?.querySelectorAll('.history-run').length===${Math.min(count, 2)} && !!document.querySelector('.conversation-row > button[title="Unwritten reply"]')===${reply}`,
    );
  };
  // After validation's legitimate pulse has finished, no other session's
  // updates, nor identical rereads, may pulse the header or brand.
  await wait(`!document.querySelector('.conversation-feedback[data-event]')`);
  await run(watchFeedback);
  await change("start", 0, "research", 3, true);
  await click(summary);
  const unlinked = await run(() => {
    const row = document.querySelector(".history-unlinked[open] .history-run"),
      open = row.querySelector("button.session-item"),
      stop = row.querySelector(".conversation-stop");
    return {
      open: open.title,
      stop: stop.getAttribute("aria-label"),
      disabled: stop.disabled,
    };
  });
  row.unlinked = unlinked;
  assert.match(unlinked.open, /Unlinked specimen/);
  assert.match(unlinked.stop, /Unlinked specimen/);
  assert.equal(unlinked.disabled, false);
  await click(summary);
  await click(".history-workflows > summary");
  const linked = await run(() =>
    [
      ...document.querySelectorAll(
        ".history-workflows[open] .conversation-stop",
      ),
    ].map((e) => ({
      name: e.getAttribute("aria-label"),
      disabled: e.disabled,
    })),
  );
  assert.equal(linked.length, 2);
  assert.equal(new Set(linked.map((l) => l.name)).size, 2);
  assert.ok(linked.every((l) => !l.disabled));
  row.linked = linked;
  await click(".history-workflows > summary");
  const unwritten = '.conversation-row > button[title="Unwritten reply"]';
  await observeButton("unwritten reply", unwritten);
  const starting = await run(historyFrame, "Unwritten reply");
  await change("first reply running", 1, "research", 3, true);
  await wait(
    `document.querySelector(${q(unwritten)})?.matches(':focus-visible')`,
  );
  const running = await run(historyFrame, "Unwritten reply");
  assert.deepEqual(running, starting);
  row.unwritten = { starting, running };
  const g = await observeButton("active background conversation", button);
  assert.equal(g.keyboardFocus, true);
  const record = async (name) => {
    const f = await run(historyFrame, title);
    row.background.push({ name, ...s.roster, ...f });
    assert.equal(f.order.filter((t) => t === title).length, 1);
    return f;
  };
  const first = await record("start");
  assert.equal(first.working, "Working");
  assert.equal(first.inHistory, false);
  assert.equal(first.linked, "2");
  for (const t of [title, "Archived reply", "Unwritten reply"])
    assert.ok(
      first.order.indexOf(t) >= 0 &&
        first.order.indexOf(t) < first.order.indexOf("Earlier material"),
    );
  await shot("background");
  for (const [i, phase] of [
    "implementing",
    "verifying",
    "reviewing",
  ].entries()) {
    await change(phase, (i + 1) * 20, phase, 3, true);
    const f = await record(phase);
    assert.deepEqual(f.order, first.order);
    assert.equal(f.text, first.text);
    assert.equal(f.focused, true);
    assert.equal(f.focusVisible, true);
    assert.equal(f.markAnimations, 0);
    assert.equal(f.feedback, "");
    assert.equal(f.hit, true);
  }
  await change("unavailable", 65, "reviewing", 3, true, true);
  await wait(
    `document.querySelector(${q(button)})?.querySelector('[aria-label="Stale observation"]')`,
  );
  const stale = await record("unavailable");
  assert.deepEqual(stale.order, first.order);
  assert.ok(stale.focused && !stale.inHistory);
  await change("one workflow remains", 75, "reviewing", 1, false);
  const one = await record("one workflow remains");
  assert.equal(one.inHistory, false);
  assert.equal(one.linked, "1");
  assert.equal(one.working, "Working");
  assert.equal(one.focused, true);
  await change("settled", 90, "finished", 0, false);
  const done = await record("settled");
  assert.equal(done.inHistory, true);
  assert.equal(done.working, undefined);
  assert.ok(done.order.indexOf(title) > done.order.indexOf("Earlier material"));
  row.backgroundFeedback = await ev(
    "opticalProbe.endFeedback();opticalProbe.feedback",
  );
  assert.deepEqual(row.backgroundFeedback, []);
}

// A task viewer has a real fixture WebSocket. Close that socket (not a
// failed poll), then gate its replacement session and two independent GETs.
async function observeDisconnect(p, s, row) {
  const { run, ev, wait } = p;
  await run((id) => {
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(Type, args) {
        const socket = new Type(...args);
        opticalProbe.socket = socket;
        return socket;
      },
    });
    location.hash = `task=${id}`;
  }, task);
  const linked = '.history-entry:has(button[title="Conversation off-page"])';
  const orphan = ".history-unlinked";
  const starting = {
    name: "before loss",
    offPage: true,
    at: clock,
    phase: "research",
    count: 3,
    reply: true,
  };
  s.roster = starting;
  await wait(
    `opticalProbe.socket?.readyState===WebSocket.OPEN && document.querySelector('${linked} .conversation-stop:enabled') && document.querySelector('${orphan} .conversation-stop:enabled')`,
  );
  const sessions = s.sessions.size;
  s.holdSession = Promise.withResolvers();
  await ev("opticalProbe.socket.close()");
  const stale = () =>
    wait(
      `document.querySelector('${linked} [aria-label="Stale observation"]') && document.querySelector('${orphan} [aria-label="Stale observation"]') && document.querySelector('${linked} .conversation-stop:disabled') && document.querySelector('${orphan} .conversation-stop:disabled') && !document.querySelector('.history-run .conversation-stop:enabled')`,
    );
  await stale();
  await until(() => s.sessions.size > sessions, "retired viewer replaced");
  s.holdRosters = Promise.withResolvers();
  s.holdSession.resolve();
  await until(
    () => s.heldKinds.size === 2,
    "replacement attachment awaiting both rosters",
  );
  await stale();
  row.offlineEntries = await run(() =>
    [...document.querySelectorAll(".history-run button.session-item")].map(
      (b) => b.title,
    ),
  );
  assert.ok(
    row.offlineEntries.some((title) => title.includes("Unlinked specimen")),
  );
  assert.ok(
    row.offlineEntries.some((title) => title.includes("Compare facets")),
  );
  s.roster = {
    ...starting,
    name: "authoritative empty",
    count: 0,
    reply: false,
  };
  s.holdRosters.resolve();
  s.holdRosters = null;
  await wait(
    `!document.querySelector('${linked}') && !document.querySelector('${orphan}') && !document.querySelector('button[title="Unwritten reply"]')`,
  );
  s.roster = starting;
  await wait(`document.querySelector('${linked} .conversation-stop:enabled')`);
  s.deny = true;
  await wait(
    `document.querySelector('.workspace-connection').innerText.includes('Sign-in required') && !document.querySelector('${linked}') && !document.querySelector('${orphan}')`,
  );
}

// aria-expanded changes at the start of the compact drawer's transition.
// A desktop navigation pane is docked and never needs the overlay's open class.
function terminalDrawerFrame(selector) {
  const pane = document.querySelector(".panel-drawer.drawer-left");
  const rect = pane.getBoundingClientRect(),
    style = getComputedStyle(pane),
    offset = new DOMMatrixReadOnly(
      style.transform === "none" ? undefined : style.transform,
    ).m41,
    open = pane.matches(".open");
  const frame = {
    rect: rect.toJSON(),
    offset,
    open,
    inert: pane.inert,
    ready:
      !pane.inert &&
      style.visibility === "visible" &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left >= 0 &&
      rect.right <= innerWidth &&
      offset === 0 &&
      (!matchMedia("(max-width: 900px)").matches || open),
  };
  if (selector) {
    const button = document.querySelector(selector)?.getBoundingClientRect();
    const hit =
      button &&
      document.elementFromPoint(
        button.left + button.width / 2,
        button.top + button.height / 2,
      );
    Object.assign(frame, {
      selector,
      button: button?.toJSON() ?? null,
      hit: hit && [hit.localName, hit.id, hit.getAttribute("class")],
    });
  }
  return frame;
}

// Unlike direct-owner rosters, native work is observed through the gateway's
// independent activity GET. Its select POST binds a reader, never a worker.
async function observeTerminalHistory(p, row, shot) {
  const { go, click, ev, run, wait, observeButton } = p;
  const s = specimen(`discovery-${randomUUID()}`);
  s.firstHead.resolve();
  const a = {
    source: "terminal",
    sessionId: background,
    cwd,
    leaf: "00000021",
    id: randomUUID(),
    instance: randomUUID(),
    epoch: null,
    history: "shared",
    phase: "turn",
    freshness: "current",
    executionCwd: null,
  };
  const b = { ...a, instance: randomUUID(), leaf: "00000022" };
  const other = { ...a, cwd: recentFolder, leaf: "00000023" };
  // Deliberately indistinguishable by session, phase or short UUID prefix.
  const unshared = ["1", "2"].map((suffix) => ({
    ...a,
    history: "unavailable",
    leaf: `0000003${suffix}`,
    id: a.id.slice(0, -1) + suffix,
    instance: a.instance.slice(0, -1) + suffix,
  }));
  // Only the first orphan will have a matching viewer run. Its exact ID and
  // epoch also occur in another directory, where discovery must stay readonly.
  const orphans = [s.runIds[2], randomUUID()].map((id) => ({
    ...a,
    source: "workflow",
    sessionId: null,
    instance: null,
    leaf: null,
    epoch,
    id,
    phase: "research",
    observedAt: clock,
  }));
  // Two default-model owner slots have no session link. Match just one to
  // an unwritten Pi session when the viewer learns its exact turn identity.
  const turns = [randomUUID(), randomUUID()].map((id) => ({
    ...orphans[0],
    id,
    source: "turn",
    phase: "turn",
  }));
  s.unwrittenLive = { epoch, commandId: turns[0].id };
  const unattributed = [...orphans, ...turns];
  // These are the SAME identities the two held viewer rosters will later
  // return. A session match alone would neither deduplicate nor grant Stop.
  const shared = [s.live.commandId, ...s.runIds.slice(0, 2)].map((id, i) => ({
    ...orphans[0],
    source: i ? "workflow" : "turn",
    sessionId: background,
    id,
    phase: i ? "research" : "turn",
  }));
  const gateway = {
    reads: new Set(),
    selections: [],
    select: null,
    observe(stage) {
      const native = [a, b].slice(0, stage.missing ? 0 : stage.native);
      if (stage.phase === "verifying") native.reverse();
      const activities = native.map((report) => ({
        ...report,
        observedAt: stage.at,
        freshness: stage.partial ? "unknown" : "current",
      }));
      const local = stage.unshared
        ? [unshared[0], ...unshared].map((report) => ({
            ...report,
            observedAt: stage.at,
            phase: stage.phase,
          }))
        : stage.cold
          ? [...shared, ...unattributed].map((report) => ({
              ...report,
              observedAt: stage.at,
              phase: stage.reordered ? stage.phase : report.phase,
            }))
          : activities;
      const projects = [
        { path: cwd, activities: stage.reordered ? local.reverse() : local },
        {
          path: recentFolder,
          activities: [
            { ...other, observedAt: stage.at },
            ...(stage.cold ? [{ ...orphans[0], cwd: recentFolder }] : []),
          ],
        },
      ];
      return {
        kind: "activity-discovery",
        epoch,
        observedAt: stage.at,
        completeness: stage.partial ? "partial" : "complete",
        unavailable: Number(stage.partial),
        projects: stage.reordered ? projects.reverse() : projects,
      };
    },
  };
  s.gateway = gateway;
  const root = `.history-entry:has(.conversation-row > button[title="${title}"])`,
    button = `${root} .conversation-row > button.session-item`,
    outside = 'section[aria-label="Active Pi work"]';
  const drawer = async () => {
    if (
      await ev(
        `document.querySelector('.navigation-toggle')?.getAttribute('aria-expanded')==='false'`,
      )
    )
      await click(".navigation-toggle");
    await wait(`(${terminalDrawerFrame})().ready`);
    const frame = await ev(
      `opticalProbe.stableFrames(${terminalDrawerFrame}, 'terminal navigation')`,
    );
    assert.ok(
      frame.ready,
      `Drawer did not stay open: ${JSON.stringify(frame)}`,
    );
  };
  const clickEntry = async (selector) => {
    try {
      await click(selector);
    } catch (error) {
      row.terminalHitFailure = await run(terminalDrawerFrame, selector);
      throw error;
    }
  };
  row.terminalHistory = [];
  const stage = (
    name,
    seconds,
    phase,
    reply,
    count,
    native,
    partial = false,
  ) => ({
    name,
    at: clock + seconds * 1000,
    phase,
    reply,
    count,
    native,
    partial,
  });
  s.roster = {
    ...stage("cold discovery", 0, "research", true, 3, 0),
    cold: true,
  };
  s.firstProject = Promise.withResolvers();
  s.holdRosters = Promise.withResolvers();
  const settledFrame = async (focus = false) => {
    const r = s.roster;
    await until(
      () =>
        ["workflow-active", "conversation-active", "discovery"].every((k) =>
          s.served.has(`${k}:${r.name}`),
        ),
      r.name,
    );
    await wait(
      `document.querySelectorAll('${root} .history-run:not(.history-terminal)').length===${r.count} && document.querySelectorAll('${root} .history-terminal').length===${r.native} && !!document.querySelector('button[title="Unwritten reply"]')===${r.reply}`,
    );
    if (focus)
      assert.ok(
        (await observeButton("shared terminal history", button)).keyboardFocus,
      );
    const f = await run(historyFrame, title);
    assert.equal(f.order.filter((t) => t === title).length, 1);
    assert.equal(f.inHistory, !(r.reply || r.count || r.native));
    assert.equal(f.linked, String(r.count + r.native));
    assert.equal(
      f.working,
      f.inHistory ? undefined : r.partial ? "Stale observation" : "Working",
    );
    const additional = await run(
      (selector) =>
        [...document.querySelectorAll(`${selector} button`)].map(
          (e) => e.innerText,
        ),
      outside,
    );
    // Other directories still expire on the ordinary discovery deadline.
    if (r.discoveryFailed) assert.deepEqual(additional, []);
    else {
      assert.equal(additional.length, 1);
      assert.ok(
        additional[0].includes(background) &&
          additional[0].includes(recentFolder),
      );
    }
    assert.deepEqual(s.commands, []);
    const branches = await run(
      (selector) =>
        [
          ...document.querySelectorAll(`${selector} .history-terminal button`),
        ].map((e) => e.title),
      root,
    );
    const frame = { ...f, branches };
    row.terminalHistory.push({ ...r, ...frame, additional });
    return frame;
  };
  const stop = await intercept(p, s);
  try {
    const unlinked = ".panel-left details.history-unlinked";
    const orphanFrame = async () => {
      await drawer();
      if (!(await ev(`document.querySelector(${q(unlinked)}).open`)))
        await clickEntry(`${unlinked} > summary`);
      await wait(`document.querySelector(${q(`${unlinked}[open]`)})`);
      return run(
        (sel, path, section) => {
          const details = document.querySelector(sel);
          const otherDir = [
            ...document.querySelectorAll(`${section} .lp-section-body > div`),
          ].find((e) => e.querySelector("p")?.innerText === path);
          return {
            summary: details.querySelector("summary").innerText,
            mark: details
              .querySelector('summary [role="img"]')
              .getAttribute("aria-label"),
            ids: [...details.querySelectorAll("code")].map((e) => ({
              id: e.innerText,
              text: e.closest(".history-run").innerText,
              visible: e.checkVisibility(),
              rect: e.getBoundingClientRect().toJSON(),
            })),
            actions: [...details.querySelectorAll("button")].map((e) => ({
              label: e.getAttribute("aria-label") ?? e.title,
              disabled: e.disabled,
            })),
            other: [...(otherDir?.querySelectorAll("button") ?? [])].map(
              (e) => ({
                text: e.innerText,
                disabled: e.disabled,
              }),
            ),
          };
        },
        unlinked,
        recentFolder,
        outside,
      );
    };
    const coldTitle = `Conversation ${background}`;
    const coldButton = `.conversation-row > button[title="${coldTitle}"]`;
    const sessionFrame = (remember = false) =>
      run(
        (labels, path, remember) => {
          const pane = document.querySelector(".panel-left");
          const mains = [
            ...pane.querySelectorAll(".conversation-row > .session-item"),
          ].filter((e) => labels.includes(e.title));
          const button = mains[0];
          const entry = button.closest(".history-entry");
          const details = [
            ...entry.querySelectorAll(".history-run > button.session-item"),
          ];
          const other = pane.querySelector(
            'section[aria-label="Active Pi work"]',
          );
          const dirs = [...other.querySelectorAll(".lp-section-body > div")];
          const local = dirs.find(
            (dir) => dir.querySelector("p").innerText === path,
          );
          if (remember) opticalProbe.coldNodes = [button, ...details];
          const nodes = [button, ...details];
          return {
            mains: mains.map((b) => b.title),
            text: button.innerText,
            focused: button === document.activeElement,
            working: button
              .querySelector(".history-activity-mark")
              ?.getAttribute("aria-label"),
            open: entry.querySelector(".history-workflows").open,
            details: details.map((b) => b.title),
            sameNodes:
              nodes.length === opticalProbe.coldNodes.length &&
              nodes.every((e, i) => e === opticalProbe.coldNodes[i]),
            // Include both directories as well as every main row/disclosure in them.
            order: dirs.flatMap((dir) =>
              [
                ...dir.querySelectorAll(
                  ":scope > p, .conversation-row > .session-item, :scope > .history-unlinked > summary, :scope > .session-item",
                ),
              ].map((e) => e.innerText),
            ),
            rawLocalRows:
              local?.querySelectorAll(":scope > .session-item").length ?? 0,
            stops: [...pane.querySelectorAll(".conversation-stop")].map(
              (e) => ({
                label: e.getAttribute("aria-label"),
                disabled: e.disabled,
              }),
            ),
          };
        },
        [coldTitle, title],
        cwd,
        remember,
      );
    const sharedTitles = shared.map(
      (r) =>
        `${r.source === "turn" ? "Owner turn" : "Owner workflow"} · ${cwd} · ${background} · ${epoch} · ${r.id}`,
    );
    const assertDiscoverySession = (f) => {
      assert.equal(f.mains.length, 1);
      assert.equal(f.rawLocalRows, 0);
      assert.equal(f.working, "Working");
      assert.deepEqual([...f.details].sort(), [...sharedTitles].sort());
      assert.deepEqual(f.stops, []);
    };
    await go(`/app?project=${project}#chat=${s.id}`, `${outside} details`);
    await until(
      () => s.projectRequested && s.served.has("discovery:cold discovery"),
      "discovery ahead of first project observation",
    );
    const cold = await orphanFrame();
    const ids = unattributed.map((a) => a.id).sort();
    const assertReports = (
      f,
      expected,
      reordered,
      fresh = "Current observation",
    ) => {
      assert.deepEqual(
        f.ids.map((e) => e.id).sort(),
        expected.map((a) => a.id).sort(),
      );
      for (const { id, source, phase } of expected) {
        const { text } = f.ids.find((e) => e.id === id);
        assert.ok(
          text.includes(
            `${source === "turn" ? "Owner turn" : "Owner workflow"} · ${id}`,
          ),
        );
        assert.ok(
          text.includes(
            `${reordered ? "verifying" : phase} · ${fresh} · ${cwd}`,
          ),
        );
      }
    };
    const readonly = (f, reordered = false, stale = false) => {
      assert.equal(f.summary.trim(), "Unattributed work · 4");
      assert.equal(f.mark, stale ? "Stale observation" : "Working");
      assertReports(
        f,
        unattributed,
        reordered,
        stale ? "Stale observation" : "Current observation",
      );
      assert.ok(
        f.ids.every((e) => e.visible && e.rect.width > 0 && e.rect.height > 0),
      );
      assert.deepEqual(f.actions, []);
    };
    readonly(cold);
    assert.equal(s.sessions.size, 0);
    assert.equal(cold.other.length, 2);
    assert.ok(cold.other.every((e) => e.text.includes(recentFolder)));
    assert.ok(
      cold.other.some(
        (e) =>
          e.disabled &&
          e.text.includes("Unattributed work") &&
          e.text.includes("Owner workflow"),
      ),
    );
    assert.ok(
      cold.other.some((e) => !e.disabled && e.text.includes(background)),
    );
    await clickEntry(`.history-entry:has(${coldButton}) summary`);
    assert.ok(
      (await observeButton("cold shared conversation", coldButton))
        .keyboardFocus,
    );
    const primary = await sessionFrame(true);
    assertDiscoverySession(primary);
    assert.deepEqual(primary.mains, [coldTitle]);
    assert.ok(primary.focused && primary.open);
    s.roster = {
      ...s.roster,
      name: "cold reordered",
      at: clock + 60_000,
      phase: "verifying",
      reordered: true,
    };
    // Wait for this projection to PAINT: a fulfilled GET alone might still
    // leave us comparing the pre-update DOM with itself.
    await wait(
      `document.querySelector(${q(unlinked)})?.innerText.includes('verifying')`,
    );
    const reordered = await sessionFrame();
    assert.deepEqual(reordered, primary);
    assert.equal(s.sessions.size, 0);
    s.firstProject.resolve();
    await until(() => s.heldKinds.size === 2, "viewer awaiting cold rosters");
    const awaitingRoster = await orphanFrame();
    readonly(awaitingRoster, true);
    const awaitingSession = await sessionFrame();
    assertDiscoverySession(awaitingSession);
    // No viewer has witnessed these runs yet. Expire the *gateway* feed:
    // only this directory's history details should survive, without Stop.
    const lastCold = s.roster;
    await run((now) => {
      opticalProbe.wallClock = Date.now;
      Date.now = () => now;
    }, lastCold.at + 120_001);
    s.roster = {
      ...lastCold,
      name: "cold discovery expired",
      discoveryFailed: true,
    };
    await wait(
      `document.querySelector(${q(`${unlinked} summary [aria-label="Stale observation"]`)}) && !document.querySelector(${q(`${outside} button`)})`,
    );
    const expired = await orphanFrame();
    readonly(expired, true, true);
    assert.deepEqual(expired.other, []);
    await ev(
      "Date.now = opticalProbe.wallClock; delete opticalProbe.wallClock",
    );
    s.roster = lastCold;
    await wait(
      `document.querySelector(${q(`${unlinked} summary [aria-label="Working"]`)}) && document.querySelector(${q(`${outside} button`)})`,
    );
    s.holdRosters.resolve();
    s.holdRosters = null;
    // The two independently held GETs can paint in either order. Wait for
    // each roster's own witness before checking their joined identities.
    await wait(
      `document.querySelector(${q(`${unlinked} .conversation-stop:enabled`)}) && document.querySelector('button[title="Unwritten reply"]')`,
    );
    const joined = await orphanFrame();
    assertReports(joined, [orphans[1], turns[1]], true);
    assert.equal(joined.summary.trim(), "Unattributed work · 3");
    const matchedTurn = await run(historyFrame, "Unwritten reply");
    assert.equal(
      matchedTurn.order.filter((t) => t === "Unwritten reply").length,
      1,
    );
    assert.ok(!matchedTurn.inHistory && matchedTurn.working === "Working");
    assert.equal(matchedTurn.linked, "0");
    assert.deepEqual(joined.actions, [
      {
        label: `Open workflow details · Unlinked specimen · ${orphans[0].id}`,
        disabled: false,
      },
      {
        label: `Cancel workflow — request stop · Unlinked specimen · ${orphans[0].id}`,
        disabled: false,
      },
    ]);
    assert.deepEqual(joined.other, cold.other);
    assert.equal(
      await ev(
        `document.querySelectorAll(${q(`${outside} .history-unlinked`)}).length`,
      ),
      0,
    );
    const rosterSession = await sessionFrame();
    assert.deepEqual(rosterSession.mains, [title]);
    assert.equal(rosterSession.rawLocalRows, 0);
    assert.deepEqual(
      [...rosterSession.details].sort(),
      s.runIds
        .slice(0, 2)
        .map(
          (id, i) =>
            `Open workflow details · ${["Compare facets", "Check notes"][i]} · ${id}`,
        )
        .sort(),
    );
    assert.deepEqual(
      rosterSession.stops.map((e) => e.label).sort(),
      s.runIds
        .map(
          (id, i) =>
            `Cancel workflow — request stop · ${["Compare facets", "Check notes", "Unlinked specimen"][i]} · ${id}`,
        )
        .sort(),
    );
    assert.ok(rosterSession.stops.every((e) => !e.disabled));
    row.coldDiscovery = {
      ids,
      reports: unattributed,
      viewerTurn: s.unwrittenLive,
      matchedTurn,
      cold,
      primary,
      reordered,
      awaitingRoster,
      awaitingSession,
      expired,
      joined,
      rosterSession,
    };
    assert.deepEqual(s.commands, []);
    s.roster = stage("together", 0, "research", true, 2, 2);
    const first = await settledFrame(true);
    assert.equal(await ev(`!!document.querySelector(${q(unlinked)})`), false);
    assert.ok(
      first.order.indexOf(title) < first.order.indexOf("Earlier material"),
    );
    await shot("terminal-history");
    for (const next of [
      stage("working", 20, "implementing", true, 2, 2),
      stage("minute", 60, "verifying", true, 2, 2),
      stage("reply left", 62, "reviewing", false, 2, 2),
      stage("one workflow", 65, "reviewing", false, 1, 2),
      stage("terminals only", 68, "finished", false, 0, 2),
      stage("one terminal", 72, "finished", false, 0, 1),
      stage("uncertain", 75, "finished", false, 0, 1, true),
      {
        ...stage("expired discovery", 196, "finished", false, 0, 1, true),
        discoveryFailed: true,
      },
      {
        ...stage(
          "partial without local report",
          197,
          "finished",
          false,
          0,
          1,
          true,
        ),
        missing: true,
      },
      stage("terminal observed again", 198, "finished", false, 0, 1),
      stage("last left", 200, "finished", false, 0, 0),
    ]) {
      if (next.discoveryFailed) {
        // Move only the specimen document's wall clock past staleActivity's
        // retention window; keep its polling and browser frames in real time.
        await run((now) => {
          opticalProbe.wallClock = Date.now;
          Date.now = () => now;
        }, next.at);
      }
      s.roster = next;
      if (next.discoveryFailed || next.missing) {
        await wait(
          `!!document.querySelector('${outside} button')===${!next.discoveryFailed} && document.querySelector('${root} .history-terminal button')?.textContent.includes('Stale observation') && !document.querySelector('${root} .conversation-stop')`,
        );
      }
      if (next.name === "terminal observed again")
        await wait(`document.querySelector('${root} [aria-label="Working"]')`);
      if (next.partial)
        await wait(
          `document.querySelector('${root} [aria-label="Stale observation"]')`,
        );
      const f = await settledFrame();
      if (next.reply) {
        assert.deepEqual(f.order, first.order);
        assert.deepEqual(f.branches, first.branches);
      }
      if (!f.inHistory) {
        assert.equal(f.text, first.text);
        assert.ok(f.focused && f.focusVisible);
        assert.ok(f.order.indexOf(title) < f.order.indexOf("Earlier material"));
      } else
        assert.ok(f.order.indexOf(title) > f.order.indexOf("Earlier material"));
    }
    await ev(
      "Date.now = opticalProbe.wallClock; delete opticalProbe.wallClock",
    );
    s.roster = stage("navigation", 210, "research", false, 2, 2);
    await settledFrame();
    for (const terminal of [a, b, other]) {
      await drawer();
      const local = terminal !== other;
      if (
        local &&
        !(await ev(`document.querySelector('${root} details').open`))
      )
        await clickEntry(`${root} summary`);
      const selector = local
        ? `${root} .history-terminal button[title*="${terminal.leaf}"]`
        : `${outside} button`;
      assert.equal(
        await ev(
          `document.querySelectorAll('${root} .conversation-stop:enabled').length`,
        ),
        2,
      );
      assert.equal(
        await ev(
          `document.querySelectorAll('${root} .history-terminal button').length`,
        ),
        2,
      );
      if (terminal === a) await shot("terminal-branches");
      gateway.select = terminal.cwd;
      await clickEntry(selector);
      const target = `/app?project=${local ? project : otherProject}#chat=${background}&activity=1&leaf=${terminal.leaf}`;
      await wait(
        `location.pathname + location.search + location.hash === ${q(target)}`,
      );
      await until(
        () =>
          gateway.reads.has(
            `/projects/${local ? project : otherProject}/api/v1/workbench/read:${background}:${terminal.leaf}`,
          ),
        `observed exact terminal leaf ${target}`,
      );
    }
    assert.deepEqual(gateway.selections, [cwd, cwd, recentFolder]);
    assert.deepEqual(s.commands, []);
    row.terminalNavigation = {
      directories: gateway.selections,
      reads: [...gateway.reads],
      commands: s.commands,
    };
    // A fresh document with a held project read: the incompatible reader
    // scope never becomes local history, even after its namesake is listed.
    const route = `/app?project=${project}#chat=${s.id}`;
    const group = `${outside} .history-unlinked`;
    const namesake = `.task-list button[title="${title}"]`;
    const selected = [...gateway.selections];
    s.roster = {
      ...stage("unshared history", 0, "turn", false, 0, 0),
      unshared: true,
    };
    s.firstProject = Promise.withResolvers();
    s.projectRequested = false;
    await go(route, `${group} summary`);
    await until(() => s.projectRequested, "held local history");
    const open = async () => {
      await drawer();
      await run(
        (sel) => document.querySelector(sel).focus(),
        `${group} summary`,
      );
      if (await ev(`document.querySelector(${q(group)}).open`))
        await p.press(" ", 32);
      await p.press(" ", 32);
      await wait(`document.querySelector(${q(`${group}[open]`)})`);
    };
    const inspect = async (loaded) => {
      const frame = await run(
        (sel, namesake, title) => {
          const details = document.querySelector(sel);
          const history = document.querySelector(namesake);
          return {
            route: location.pathname + location.search + location.hash,
            focused:
              details.querySelector("summary") === document.activeElement,
            summary: details.querySelector("summary").innerText.trim(),
            namesakes: [
              ...document.querySelectorAll(".conversation-row > button"),
            ].filter((e) => e.title === title).length,
            listed: !!history,
            promoted: !!history?.querySelector(".history-activity-mark"),
            actions: details.querySelectorAll("a,button,[role=button]").length,
            reports: [...details.querySelectorAll(".history-terminal")].map(
              (row) => ({
                text: row.innerText,
                ids: [...row.querySelectorAll("code")].map((e) => ({
                  text: e.innerText,
                  visible: e.checkVisibility() && e.getClientRects().length > 0,
                })),
              }),
            ),
          };
        },
        group,
        namesake,
        title,
      );
      assert.equal(frame.route, route);
      assert.ok(frame.focused);
      assert.equal(frame.listed, loaded);
      assert.equal(frame.namesakes, Number(loaded));
      assert.equal(frame.promoted, false);
      assert.equal(frame.actions, 0);
      assert.equal(frame.summary, "Unattributed work · 2");
      assert.equal(frame.reports.length, 2);
      for (const [i, report] of unshared.entries()) {
        const observed = frame.reports[i];
        assert.deepEqual(
          observed.ids,
          [
            `instance: ${report.instance}`,
            `id: ${report.id}`,
            `leaf: ${report.leaf}`,
          ].map((text) => ({ text, visible: true })),
        );
        assert.ok(
          observed.text.includes(cwd) && observed.text.includes(background),
        );
        assert.ok(
          observed.text.includes(
            "History configuration differs. Activity remains observe-only.",
          ),
        );
      }
      assert.deepEqual(gateway.selections, selected);
      assert.deepEqual(s.commands, []);
      return frame;
    };
    await open();
    row.unsharedTerminals = { held: await inspect(false) };
    s.roster = {
      ...s.roster,
      name: "unshared reversed",
      reordered: true,
      phase: "settling",
    };
    await wait(
      `document.querySelector(${q(group)}).innerText.includes('settling')`,
    );
    row.unsharedTerminals.reordered = await inspect(false);
    s.firstProject.resolve();
    await wait(`document.querySelector(${q(namesake)})`);
    await open();
    row.unsharedTerminals.loaded = await inspect(true);
  } finally {
    await stop();
  }
}

/** Register as quiet-workspace:<theme>:<width> (one call per group). Uses the
 * entrypoint's helpers directly; b is its CDP browser, rows the report array. */
export async function observeQuietWorkspace(p) {
  const { width, theme, go, layout, rows, screenshot } = p;
  const motion = width === 390 ? "reduce" : "no-preference";
  const id = `quiet-${randomUUID()}`,
    s = specimen(id);
  const row = {
    width,
    theme,
    motion,
    id,
    entry: {},
    ordinaryPhrase: [],
    nativeEditorSteps: [],
    plan: {},
    background: [],
    screenshots: [],
    commands: s.commands,
  };
  rows.push(row);
  const shot = async (stage) => {
    const name = `quiet-workspace-${theme}-${width}-${stage}.png`;
    await screenshot(name);
    row.screenshots.push(name);
  };
  const navigate = async () => {
    await go(`/app#chat=${id}`, input);
  };
  await layout(width, theme, motion);
  await observeBootstrap(p, row);
  await observeOrdinaryPhrase(p, row, ["park and restore", "remove image"]);
  await observeOrdinaryPhrase(p, row, ["historyUndo", "historyRedo"]);
  await observeOrdinaryPhrase(p, row, [
    "complete restored prefix",
    "recall confirmed Send",
  ]);
  await observeOrdinaryPhrase(p, row, ["edit starter"]);
  await observeDirectReply(p, row);
  const stop = await intercept(p, s);
  try {
    await navigate();
    await observeEntry({ ...p, motion }, s, row, shot);
    await observeProposal(p, s, row, shot);
    await observeHistory(p, s, row, shot);
    await observeDisconnect(p, s, row);
  } finally {
    await stop();
  }
  await observeTerminalHistory(p, row, shot);
}
