import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { it } from "vitest";
import { wireRequest } from "../../src/service-wire.ts";
import { acceptingFixture } from "../helpers/accepting-fixture.ts";
import { nativeObserver } from "../helpers/native-observer.mjs";
import { browserBuild } from "../helpers/source-build.ts";

it("built browser safety: old task active Cancel, bad/missing builds, manual refusal, lost receipt observation and failed human review", async () => {
  const f = await acceptingFixture("generated"),
    root = mkdtempSync(join(tmpdir(), "cdn-"));
  let launcher, browser, original, failure, page;
  const receipt = {
    passed: false,
    lostReplies: 0,
    contacts: 0,
    manualRefused: false,
    buildRefused: false,
    compatibleCancel: false,
    failedReview: false,
    settlementWaits: [],
  };
  try {
    assert(process.env.CADENCE_BROWSER_PATH);
    launcher = await chromium.launchServer({
      executablePath: process.env.CADENCE_BROWSER_PATH,
      headless: true,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        TMPDIR: root,
        TEMP: root,
        TMP: root,
      },
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    original = once(launcher.process(), "close");
    browser = await chromium.connect(launcher.wsEndpoint());
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
    const p = await context.newPage();
    page = p;
    p.setDefaultTimeout(15000);
    await p.goto(f.tokenLink);
    await p.getByRole("button", { name: "Choose owner model" }).click();
    await p
      .getByLabel("Exact model / API / thinking")
      .selectOption({ label: "fixture/fixed · openai-completions · off" });
    await p.getByRole("button", { name: "Confirm owner model choice" }).click();
    async function command(kind) {
      const response = p.waitForResponse((r) =>
        r.url().endsWith("/api/v1/commands"),
      );
      void response.catch(() => {});
      await p
        .getByRole("button", { name: `Confirm ${kind}`, exact: true })
        .click();
      const reply = await (await response).json();
      assert.equal(reply.kind, "ok", JSON.stringify(reply));
      return reply.value;
    }
    async function settled(r) {
      const started = Date.now(),
        deadline = started + 15000;
      let last;
      const observed = (complete) =>
        receipt.settlementWaits.push({
          commandId: r.commandId,
          runId: r.runId,
          complete,
          startedAt: started,
          observedAt: Date.now(),
          elapsedMs: Date.now() - started,
          last,
        });
      while (Date.now() < deadline) {
        const result = await f.client.receipt(r.commandId),
          active = await f.client.activeRuns();
        // Fixed/public DTO facts before teardown, not provider bodies or thrown
        // diagnostics. A later explicit Stop must not be mistaken for the cause
        // of the original assertion/timeout (nor erase its original native facts).
        last = { receipt: result, active };
        if (
          result.status === "found" &&
          result.receipt.publication === "published" &&
          active.kind === "ok" &&
          active.value.status === "complete" &&
          !active.value.runs.some((a) => a.runId === r.runId)
        ) {
          observed(true);
          return result.receipt;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      observed(false);
      throw Error("original work did not settle");
    }
    async function create(goal, kind) {
      await p.getByRole("button", { name: "New task", exact: true }).click();
      await p.getByRole("dialog").getByLabel("Kind").selectOption(kind);
      await p.getByLabel("Goal", { exact: true }).fill(goal);
      await p
        .getByRole("button", { name: "Preview Create (does not Start)" })
        .click();
      const r = await settled(await command("create"));
      await p
        .locator(".task-list > .page-controls")
        .getByRole("button", { name: "Observe a new snapshot" })
        .click();
      await p.getByRole("button", { name: new RegExp(goal) }).click();
      return r.created.taskId;
    }
    const older = await create("Older code task", "code");
    // Actual browser-origin attacker requests. Source-bound identity, never the server echo.
    const negatives = await p.evaluate(
      async ({ build }) => {
        const session = await fetch("/api/v1/session", {
          headers: { "X-Cadence-Build": JSON.stringify(build) },
        });
        return {
          attachment: session.headers.get("X-Cadence-Attachment"),
          boot: (await session.json()).value,
        };
      },
      { build: browserBuild, taskId: older },
    );
    // Keep the additional explicit attack attachment bounded; all requests still authenticate normally.
    const session = negatives.boot,
      attachment = negatives.attachment;
    const state = await f.client.current({
      storeId: session.storeId,
      taskId: older,
    });
    assert.equal(state.kind, "ok");
    assert.equal(state.value.context.status, "available");
    const preflight = {
      expected: state.value.context.version,
      action: {
        kind: "check",
        taskId: older,
        check: {
          kind: "manual",
          name: "Manual",
          command: "echo MUST-NOT-RUN",
          timeoutMs: 120000,
        },
      },
    };
    const post = (path, body, build) =>
      p.evaluate(
        async ({ path, body, build, attachment, csrf }) => {
          const r = await fetch(path, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Cadence-Attachment": attachment,
              "X-Cadence-CSRF": csrf,
              ...(build ? { "X-Cadence-Build": JSON.stringify(build) } : {}),
            },
            body: JSON.stringify(body),
          });
          return { status: r.status, body: await r.json() };
        },
        { path, body, build, attachment, csrf: session.csrf },
      );
    const manual = await post("/api/v1/preflight", preflight, browserBuild);
    assert.equal(manual.body.error.code, "forbidden");
    assert.equal(manual.body.error.effect, "none");
    receipt.manualRefused = true;
    for (const build of [
      null,
      { ...browserBuild, buildId: "0".repeat(64) },
      { ...browserBuild, contractHash: "0".repeat(64) },
    ]) {
      const result = await post("/api/v1/preflight", preflight, build);
      assert.equal(result.body.error.code, "unsupported-context");
      assert.equal(result.body.error.effect, "none");
    }
    receipt.buildRefused = true;
    const live = await create("Cancelable readonly task", "research");
    f.mode("pending");
    await p.getByRole("button", { name: "Preview Start saved graph" }).click();
    const run = await command("start");
    const contactDeadline = Date.now() + 15000;
    while (!f.contacts() && Date.now() < contactDeadline)
      await new Promise((r) => setTimeout(r, 50));
    assert.equal(f.contacts(), 1);
    // A running subagent opens as an observation, not another Start. It follows
    // live watermarks (the bounded reader still requires an explicit update).
    await p
      .locator(".running-conversations .session-item")
      .filter({ hasText: "Subagent" })
      .first()
      .click();
    await p
      .locator(".conversation-badge")
      .getByText("Subagent", { exact: true })
      .waitFor();
    const selected = new URLSearchParams(new URL(p.url()).hash.slice(1));
    assert.equal(JSON.parse(selected.get("scope")).kind, "child");
    assert.equal(selected.has("snapshot"), false);
    assert.equal(f.contacts(), 1);
    // Two actual browser contexts and a real Pi PTY observe the SAME pending run.
    const secondContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "en-US",
    });
    const second = await secondContext.newPage();
    second.setDefaultTimeout(15000);
    await second.goto(f.tokenLink);
    await second.goto(`${f.endpoint}/app#task=${live}`);
    await second.locator(".view-menu > summary").click();
    await second.getByRole("button", { name: "outcomes", exact: true }).click();
    await second.getByText(run.runId, { exact: true }).waitFor();
    receipt.nativeObserver = await nativeObserver(f, run.runId);
    assert.equal(f.contacts(), 1, "Pi attachment/quit never replayed Start");
    const surviving = await f.client.activeRuns();
    assert.equal(surviving.kind, "ok");
    assert(surviving.value.runs.some((r) => r.runId === run.runId));
    await secondContext.close();
    await p.getByRole("button", { name: /Older code task/ }).click();
    await p
      .getByRole("button", { name: "Observe current state", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Cancel run — request stop" })
      .waitFor();
    // Inject one definitive no-effect transport refusal. An explicit retry must
    // remain reachable; no failed reply may permanently disable the safety control.
    let refusedCancels = 0;
    await p.route("**/cancel", async (route) => {
      refusedCancels++;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          kind: "error",
          error: { code: "unavailable", effect: "none", recovery: "observe" },
        }),
      });
    });
    await p.getByRole("button", { name: "Cancel run — request stop" }).click();
    await p.getByText(/cancellation effect none/).waitFor();
    await p.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) =>
          button.textContent === "Cancel run — request stop" &&
          !button.disabled,
      ),
    );
    assert.equal(refusedCancels, 1, "no automatic Cancel replay");
    assert.equal(f.contacts(), 1);
    await p.unroute("**/cancel");
    // Only the compiled contract needs to match for explicit safety Cancel. A stale
    // browser body build cannot make normal preflight/choice ingress compatible.
    await p.route("**/cancel", async (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          "x-cadence-build": JSON.stringify({
            ...browserBuild,
            buildId: "0".repeat(64),
          }),
        },
      }),
    );
    const cancellation = p.waitForResponse((r) => r.url().endsWith("/cancel"));
    await p.getByRole("button", { name: "Cancel run — request stop" }).click();
    assert.equal((await (await cancellation).json()).kind, "ok");
    assert.equal((await settled(run)).execution, "canceled");
    receipt.compatibleCancel = true;
    await p.unroute("**/cancel");
    await p.getByRole("button", { name: /Cancelable readonly task/ }).click();
    await p
      .getByRole("button", { name: "Observe current state", exact: true })
      .click();
    f.mode("failure");
    await p.getByRole("button", { name: "Preview Start saved graph" }).click();
    let lostCommand, resolveLoss, rejectLoss;
    const lostReply = new Promise((resolve, reject) => {
      resolveLoss = resolve;
      rejectLoss = reject;
    });
    void lostReply.catch(() => {});
    await p.route("**/api/v1/commands", async (route) => {
      try {
        lostCommand = route.request().postDataJSON();
        const response = await route.fetch();
        assert.equal((await response.json()).kind, "ok");
        receipt.lostReplies++;
        await route.abort("failed");
        resolveLoss();
      } catch (error) {
        rejectLoss(error);
      }
    });
    await p.getByRole("button", { name: "Confirm start", exact: true }).click();
    // Wait the original injected loss, not an older unrelated refusal message.
    // Removing an in-flight route can deliver it instead of losing this reply.
    await lostReply;
    assert(lostCommand);
    await p
      .getByRole("region", { name: "Command receipt" })
      .filter({ hasText: lostCommand.commandId })
      .getByText(/Uncertain|unavailable/)
      .waitFor();
    await p.unroute("**/api/v1/commands");
    let lostReceipt;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const lookup = await f.client.receipt(lostCommand.commandId);
      if (lookup.status === "found") {
        lostReceipt = lookup.receipt;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert(lostReceipt);
    const exactReceipt = p.waitForResponse(
      (r) =>
        r.url() ===
        `${f.endpoint}${wireRequest("receipt", lostCommand.commandId).path}`,
    );
    await p
      .getByRole("region", { name: "Command receipt" })
      .filter({ hasText: lostCommand.commandId })
      .getByRole("button", { name: "Observe exact receipt" })
      .click();
    assert.equal((await (await exactReceipt).json()).status, "found");
    const failed = await settled(lostReceipt);
    assert.equal(failed.execution, "failed");
    await p
      .getByRole("button", { name: "Observe current state", exact: true })
      .click();
    await p.getByRole("button", { name: "checks", exact: true }).click();
    await p
      .getByRole("button", { name: "Observe obligations", exact: true })
      .click();
    await p
      .getByText(
        "No configured obligations. This is not passing check coverage.",
      )
      .waitFor();
    await p.getByRole("button", { name: "review", exact: true }).click();
    await p.getByLabel("Episode to review").selectOption(failed.runId);
    await p.getByLabel(/I acknowledge current unresolved issues/).check();
    await p
      .getByRole("button", { name: "Preview human review / Done" })
      .click();
    await settled(await command("review"));
    const snap = await f.client.snapshot({ kind: "task", id: live });
    assert.equal(snap.kind, "ok");
    assert.equal(
      snap.value.runs.find((r) => r.runId === failed.runId && !r.childRunId)
        .outcome,
      "failed",
    );
    receipt.failedReview = true;
    receipt.contacts = f.contacts();
    assert.equal(receipt.contacts, 2);
    assert.equal(receipt.lostReplies, 1);
    await post("/api/v1/detach", null, browserBuild);
    receipt.passed = true;
  } catch (error) {
    failure = error;
    if (page)
      writeFileSync(join(root, "failed-dom.html"), await page.content());
  } finally {
    receipt.teardownStartedAt = Date.now();
    receipt.contacts = f.contacts();
    for (const close of [
      () => browser?.close(),
      () => launcher?.close(),
      () => f.close(),
    ])
      try {
        await close();
      } catch (error) {
        failure ??= error;
      }
    if (original) {
      receipt.originalBrowserClose = await original;
      if (receipt.originalBrowserClose[0] !== 0)
        failure ??= Error("browser close");
    }
    receipt.passed &&= !failure;
    writeFileSync(join(root, "receipt.json"), JSON.stringify(receipt, null, 2));
    console.log(
      JSON.stringify({
        receipt: join(root, "receipt.json"),
        passed: receipt.passed,
      }),
    );
  }
  if (failure) throw failure;
}, 120000);
