import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { it } from "vitest";
import { publicError } from "../../src/service-contract.ts";
import { acceptingFixture } from "../helpers/accepting-fixture.ts";

it("browser-only persistent Cadence: clarification, exact approval, lost reply, real local merge, refresh and explicit exit", async () => {
  const f = await acceptingFixture("generated");
  const root = mkdtempSync(join(tmpdir(), "cwf-"));
  let browser, launcher, original, page, failure;
  let releaseMode = () => {};
  const receipt = {
    passed: false,
    errors: [],
    commands: [],
    paidProvider: false,
    physicalHuman: false,
  };
  try {
    const git = (...args) =>
      execFileSync("git", args, { cwd: f.root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "Workflow fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("add", ".");
    git("commit", "-qm", "baseline");
    f.mode("coordinator");
    assert(process.env.CADENCE_BROWSER_PATH, "existing browser required");
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
    const ctx = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
    });
    page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => receipt.errors.push(e.message));
    let lastHeaders;
    page.on("request", (request) => {
      if (request.url().endsWith("/workbench/command")) {
        const body = request.postDataJSON();
        receipt.commands.push(body.kind);
        lastHeaders = request.headers();
      }
      if (request.url().endsWith("/commands"))
        receipt.commands.push("legacy-command");
    });
    const heldMode = new Promise((resolve) => {
      releaseMode = resolve;
    });
    const modeRoute = (url) =>
      url.pathname.endsWith("/api/v1/workbench/read") &&
      JSON.parse(url.searchParams.get("request") ?? "null")?.kind ===
        "cadence-conversation";
    const sawMode = page.waitForRequest((request) =>
      modeRoute(new URL(request.url())),
    );
    void sawMode.catch(() => {});
    await page.route(modeRoute, async (route) => {
      await heldMode;
      await route.continue().catch(() => {});
    });
    await page.goto(f.tokenLink);
    await page
      .getByRole("button", { name: "Choose owner model", exact: true })
      .click();
    await page
      .getByLabel("Exact model / API / thinking")
      .selectOption({ label: "fixture/fixed · openai-completions · off" });
    await page
      .getByRole("button", { name: "Confirm owner model choice", exact: true })
      .click();
    await sawMode;
    assert(
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .isDisabled(),
      "unobserved mode must not accept input before its project binding settles",
    );
    releaseMode();
    const composer = () =>
      page.getByRole("textbox", { name: "Message", exact: true });
    const send = async (text) => {
      await composer().fill(text);
      await page.getByRole("button", { name: "Send", exact: true }).click();
    };
    await send("/cadence");
    await page
      .getByText("Cadence is on. What would you like to accomplish?", {
        exact: true,
      })
      .waitFor();
    const chatUrl = page.url();
    await page
      .locator(".conversation-badge")
      .filter({ hasText: "Cadence on" })
      .waitFor();
    const investigation = "Inspect the fixture without changing files";
    const sendIds = [];
    let sendAttempts = 0;
    await page.route("**/api/v1/workbench/command", async (route) => {
      const command = route.request().postDataJSON();
      if (command?.kind !== "cadence-send" || command.text !== investigation)
        return route.continue();
      sendIds.push(command.commandId);
      if (++sendAttempts === 1) {
        // Real pre-admission rejection, not a synthesized client error.
        const response = await route.fetch({
          postData: JSON.stringify({
            ...command,
            revision: command.revision + 1,
          }),
        });
        const body = await response.json();
        assert.equal(body.error.effect, "none");
        return route.fulfill({ response });
      }
      const response = await route.fetch();
      assert.equal((await response.json()).kind, "ok");
      return route.abort("failed"); // Actual Send accepted; its response is lost.
    });
    const beforeRefusal = f.contacts();
    await send(investigation);
    await page
      .locator('[role="alert"]')
      .filter({ hasText: "stale" })
      .first()
      .waitFor();
    assert.equal(await composer().inputValue(), investigation);
    assert(
      await page.getByRole("button", { name: "Send", exact: true }).isEnabled(),
    );
    assert(
      await page
        .getByRole("button", { name: "Exit Cadence", exact: true })
        .isEnabled(),
    );
    assert.equal(f.contacts(), beforeRefusal);
    await page.reload();
    await page
      .locator(".conversation-badge")
      .filter({ hasText: "Cadence on" })
      .waitFor();
    await send(investigation); // New human Send, never automatic resubmission.
    await page
      .getByText("Investigation complete. Should we write both files?", {
        exact: true,
      })
      .waitFor();
    assert.equal(sendAttempts, 2);
    assert.equal(new Set(sendIds).size, 2);
    await page.unroute("**/api/v1/workbench/command");
    assert.equal(existsSync(join(f.root, "a.txt")), false);
    assert.equal(page.url(), chatUrl, "activation must not navigate to a task");
    await send("Decisions aligned, plan now");
    await page
      .getByRole("button", { name: "Implement this plan", exact: true })
      .waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Implement this plan" && !b.disabled,
      ),
    );
    assert.equal(existsSync(join(f.root, "a.txt")), false);
    const other = await ctx.newPage();
    other.setDefaultTimeout(15000);
    await other.goto(chatUrl);
    await other
      .getByRole("button", { name: "Implement this plan", exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole("button", { name: "Implement this plan", exact: true })
      .waitFor();
    let acceptedId,
      approveCalls = 0;
    await page.route("**/api/v1/workbench/command", async (route) => {
      if (route.request().postDataJSON()?.kind !== "cadence-approve")
        return route.continue();
      approveCalls++;
      const response = await route.fetch();
      const body = await response.json();
      assert.equal(body.kind, "ok", JSON.stringify(body));
      acceptedId = body.value.commandId;
      await route.abort("failed"); // Actual acceptance with an intentionally lost response.
    });
    await page
      .getByRole("button", { name: "Implement this plan", exact: true })
      .click();
    await page
      .getByText("Actual local merge commit:", { exact: false })
      .first()
      .waitFor();
    assert.equal(approveCalls, 1, "lost reply is observed, never replayed");
    assert(acceptedId);
    await other
      .getByRole("button", { name: "Implement this plan", exact: true })
      .waitFor({ state: "hidden" });
    await page.unroute("**/api/v1/workbench/command");
    // A browser attachment can approve the specific plan, not call the native general workflow boundary.
    const bootstrap = await f.client.session();
    assert.equal(bootstrap.kind, "ok");
    const {
      "content-length": _length,
      host: _host,
      ...browserHeaders
    } = lastHeaders;
    const forbidden = await ctx.request.post(
      `${f.endpoint}/api/v1/workbench/command`,
      {
        headers: { ...browserHeaders, origin: f.endpoint },
        data: {
          kind: "workflow",
          commandId: crypto.randomUUID(),
          epoch: bootstrap.value.epoch,
          request: { action: "cancel", runId: acceptedId },
        },
      },
    );
    assert.equal((await forbidden.json()).error.code, "forbidden");
    const deadline = Date.now() + 15000;
    let result;
    while (Date.now() < deadline) {
      result = await f.client.workbenchRead({
        kind: "workflow",
        id: acceptedId,
      });
      if (
        result.kind === "ok" &&
        result.value.kind === "workflow" &&
        !["running", "queued"].includes(result.value.response.run.status)
      )
        break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(
      result.value.response.run.status,
      "completed",
      JSON.stringify(result),
    );
    assert.equal(result.value.response.run.humanReviewed, false);
    assert.equal(
      git("rev-parse", "HEAD").trim(),
      result.value.response.run.mergedCommit,
    );
    assert(readFileSync(join(f.root, "a.txt"), "utf8").includes("implemented"));
    const childSummary = page
      .locator(".workflow-card details > summary")
      .filter({ hasText: /^implementation/ })
      .first();
    await childSummary.click();
    const child = childSummary.locator("..");
    await child
      .getByRole("button", { name: "Open subagent context", exact: true })
      .click();
    // The subagent's context opens in the main area, not inside the chat.
    const context = page.getByLabel("Subagent context", { exact: true });
    await context
      .getByRole("region", { name: "Conversation turn" })
      .getByText("Implemented the declared file.", { exact: true })
      .waitFor();
    assert(
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .isHidden(),
    );
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    await composer().waitFor();
    // The same agent is listed in the subagent dock and opens from there.
    const dockRow = page
      .locator(".agent-dock-row")
      .filter({ hasText: /^implementation/i })
      .first();
    await dockRow.waitFor();
    await dockRow.click();
    await context
      .getByRole("region", { name: "Conversation turn" })
      .getByText("Implemented the declared file.", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    await page.reload();
    await page
      .locator(".conversation-badge")
      .filter({ hasText: "Cadence on" })
      .waitFor();
    // Retained workflows are reachable without asking the coordinator/model.
    const historyContacts = f.contacts();
    await page.locator(".workflow-history > summary").click();
    await page
      .locator(".workflow-history .session-item")
      .filter({ hasText: result.value.response.run.goal })
      .click();
    await page.getByLabel("Subagent context", { exact: true }).waitFor();
    assert.equal(f.contacts(), historyContacts);
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    await send("Next goal: explain the existing files");
    await page
      .getByText("Investigation complete. Should we write both files?", {
        exact: true,
      })
      .last()
      .waitFor();
    assert.equal(page.url(), chatUrl);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(root, "mobile.png"), fullPage: true });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    let unexpectedModelReads = 0;
    const modelsRoute = (url) => url.pathname.endsWith("/api/v1/models");
    const workspaceRoute = (url) => url.pathname.endsWith("/api/v1/workspace");
    await page.route(modelsRoute, (route) => {
      unexpectedModelReads++;
      return route.abort("failed");
    });
    await page.route(workspaceRoute, (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ kind: "error", error: publicError("stale") }),
      }),
    );
    await page
      .locator('button.chip[aria-label="Observe current state"]')
      .click();
    await page
      .locator('[role="alert"]')
      .filter({ hasText: "stale" })
      .first()
      .waitFor();
    assert(
      await page
        .getByRole("button", { name: "Send", exact: true })
        .isDisabled(),
    );
    await page
      .getByRole("button", { name: "Exit Cadence", exact: true })
      .click();
    assert.equal(
      unexpectedModelReads,
      0,
      "mode exit does not consult stale model sources",
    );
    await page.unroute(modelsRoute);
    await page.unroute(workspaceRoute);
    await page
      .locator(".conversation-badge")
      .filter({ hasText: "Ordinary" })
      .waitFor();
    await page.reload();
    await page
      .locator(".conversation-badge")
      .filter({ hasText: "Ordinary" })
      .waitFor();
    assert(!receipt.commands.includes("legacy-command"));
    assert.equal(receipt.errors.length, 0, receipt.errors.join("\n"));
    receipt.passed = true;
  } catch (e) {
    failure = e;
    receipt.error = String(e);
    if (page)
      await page
        .screenshot({ path: join(root, "failure.png"), fullPage: true })
        .catch(() => {});
  } finally {
    releaseMode();
    if (browser)
      await browser.close().catch((e) => {
        failure ??= e;
      });
    if (launcher)
      await launcher.close().catch((e) => {
        failure ??= e;
      });
    if (original) {
      receipt.browserClose = await original;
      if (receipt.browserClose[0] !== 0)
        failure ??= Error("browser close not zero");
    }
    try {
      await f.close();
    } catch (e) {
      failure ??= e;
    }
    receipt.passed &&= !failure;
    writeFileSync(join(root, "receipt.json"), JSON.stringify(receipt, null, 2));
  }
  if (failure) throw failure;
}, 120000);
