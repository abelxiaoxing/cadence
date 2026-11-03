import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { it } from "vitest";
import { sessionDirectory } from "../../src/service/pi-sessions.ts";
import { publicError } from "../../src/service-contract.ts";
import { acceptingFixture } from "../helpers/accepting-fixture.ts";
import { seedPiSessions } from "../helpers/retained-conversations.ts";

it("built browser pages all 205 terminal sessions, continues one as a new branch and switches branches in its tree", async () => {
  const f = await acceptingFixture("generated"),
    root = mkdtempSync(join(tmpdir(), "chat-pages-"));
  let browser, page;
  let releaseModel = () => {};
  const errors = [];
  const readTrace = [];
  const trace = (entry) => {
    readTrace.push({ at: Date.now(), ...entry });
    if (readTrace.length > 200) readTrace.shift();
  };
  try {
    await f.client.session();
    const catalog = await f.client.models();
    assert.equal(catalog.kind, "ok");
    const directory = sessionDirectory(f.root, join(f.dir, "agent"), {});
    const seeded = seedPiSessions(directory, f.root, 205, 2);
    const chosen = await f.client.chooseModel({
      expected: catalog.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    assert.equal(chosen.kind, "ok");
    assert(process.env.CADENCE_BROWSER_PATH, "existing browser required");
    browser = await chromium.launch({
      executablePath: process.env.CADENCE_BROWSER_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      env: {
        PATH: process.env.PATH,
        HOME: root,
        TMPDIR: root,
        TEMP: root,
        TMP: root,
      },
    });
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
    });
    page = await context.newPage();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/api/v1/workbench/read"))
        trace({
          phase: "request",
          request: JSON.parse(url.searchParams.get("request") ?? "null"),
        });
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/api/v1/workbench/read"))
        trace({
          phase: "failed",
          request: JSON.parse(url.searchParams.get("request") ?? "null"),
          failure: request.failure()?.errorText,
        });
    });
    page.on("response", async (response) => {
      try {
        const url = new URL(response.url());
        if (!url.pathname.endsWith("/api/v1/workbench/read")) return;
        const request = JSON.parse(url.searchParams.get("request") ?? "null");
        if (!["conversation", "conversation-turn"].includes(request?.kind))
          return;
        const reply = await response.json();
        const { summary, leaf, turns, branches, continues, turn, ordinal } =
          reply.value ?? {};
        trace({
          request,
          code: reply.error?.code,
          summary,
          leaf,
          turns,
          branches,
          continues,
          turn,
          ordinal,
        });
      } catch (error) {
        trace({ readFailure: String(error) });
      }
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(f.tokenLink);
    const rows = page
      .locator(".task-list button.session-item")
      .filter({ hasText: "Terminal question" });
    // The first page is re-read every 2 s; a shown list stays in place and
    // never flashes the reading hint, which belongs to a page with no rows yet.
    await page
      .getByRole("button", { name: /^Terminal question 204/ })
      .waitFor();
    await page.evaluate(() => {
      const list = document.querySelector(".task-list");
      const seen = { hint: 0, short: 0 };
      window.__historyFlicker = seen;
      new MutationObserver(() => {
        if (list.textContent.includes("Reading conversation history"))
          seen.hint++;
        if (list.querySelectorAll("button.session-item").length < 50)
          seen.short++;
      }).observe(list, { subtree: true, childList: true, characterData: true });
    });
    const reread = () =>
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/workbench/read") &&
          decodeURIComponent(response.url()).includes('"conversations"'),
      );
    await reread();
    await reread();
    assert.deepEqual(await page.evaluate(() => window.__historyFlicker), {
      hint: 0,
      short: 0,
    });
    const seen = new Set();
    for (let n = 0; n < 5; n++) {
      const first = 204 - n * 50;
      await page
        .getByRole("button", {
          name: new RegExp(
            `^Terminal question ${String(first).padStart(3, "0")}`,
          ),
        })
        .waitFor();
      const labels = await rows.locator(".session-title").allTextContents();
      assert.equal(labels.length, n === 4 ? 5 : 50);
      for (const label of labels) {
        assert(!seen.has(label));
        seen.add(label);
      }
      if (n < 4)
        await page
          .getByRole("button", { name: "Older conversations", exact: true })
          .click();
    }
    assert.equal(seen.size, 205);
    await page.getByRole("button", { name: /^Terminal question 000/ }).click();
    await page
      .locator(".conversation-badge")
      .filter({ hasText: "Started in the terminal" })
      .waitFor();
    await page.getByText("Saved reply 0.1", { exact: true }).waitFor();
    assert.equal(f.contacts(), 0, "history never calls a provider");
    // A Send awaiting its scoped model must not escape after the user chooses
    // an earlier turn. The relocated branch button uses the same retirement
    // path as the branch tree; changing the view never cancels admitted work.
    const sends = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.postDataJSON()?.kind === "send"
      )
        sends.push(request.postDataJSON());
    });
    const modelRoute = (url) =>
      url.pathname.endsWith("/api/v1/workbench/read") &&
      JSON.parse(url.searchParams.get("request") ?? "null")?.kind ===
        "conversation-models";
    const held = new Promise((resolve) => {
      releaseModel = resolve;
    });
    const queried = page.waitForRequest((request) =>
      modelRoute(new URL(request.url())),
    );
    await page.route(modelRoute, async (route) => {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    });
    const composer = page.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    await composer.fill("Must remain a draft after branch navigation");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const pendingModel = await queried;
    // Continue from the first turn: the message starts a second branch.
    await page
      .getByRole("button", { name: "Continue from here", exact: true })
      .first()
      .click();
    await page
      .getByText(
        "You are viewing an earlier point of this conversation. A message sent now starts a new branch here; the rest stays in the session.",
      )
      .waitFor();
    releaseModel();
    await (await pendingModel.response())?.finished();
    await page.unroute(modelRoute);
    assert.equal(
      await composer.inputValue(),
      "Must remain a draft after branch navigation",
    );
    assert.equal(f.contacts(), 0);
    f.reply("Answered on a new branch.");
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Branch from the first answer");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .getByText("Answered on a new branch.", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Branches (2)", exact: true })
      .click();
    const tree = page.getByRole("region", { name: "Conversation branches" });
    await tree
      .getByRole("button", { name: /^Terminal question 000\.1/ })
      .click();
    await page.getByText("Saved reply 0.1", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByText("Answered on a new branch.", { exact: true })
        .count(),
      0,
    );
    // The browser wrote Pi's own file, which the terminal resumes as is.
    const [file] = readdirSync(directory).filter((name) =>
      name.endsWith(`_${seeded.ids[0]}.jsonl`),
    );
    assert.match(
      readFileSync(join(directory, file), "utf8"),
      /Answered on a new branch\./,
    );
    await page
      .getByRole("button", { name: "Latest conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    f.reply("New conversation beyond the old ceiling.");
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Explicit Send beyond 200 conversations");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .getByText("New conversation beyond the old ceiling.", { exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".conversation-header .ep-state")
          ?.textContent === "completed",
    );
    assert.equal(f.contacts(), 2);
    assert.deepEqual(
      sends.map((command) => command.text),
      [
        "Branch from the first answer",
        "Explicit Send beyond 200 conversations",
      ],
    );
    // Readonly transport fixtures exercise list growth during a failed read.
    // They start no workflow and do not replace actual owner settlement evidence.
    const bootstrap = await f.client.session();
    assert.equal(bootstrap.kind, "ok");
    const chat = new URLSearchParams(page.url().split("#")[1]).get("chat");
    const liveId = randomUUID(),
      doneId = randomUUID();
    const run = (id, live) => ({
      id,
      epoch: bootstrap.value.epoch,
      goal: live ? "Observed live A" : "Observed settled B",
      status: live ? "running" : "completed",
      phase: live ? "implementing" : "finished",
      steps: [],
      notice: "",
      mergedCommit: null,
      humanReviewed: false,
    });
    let expanded = false;
    const observationRoute = (url) =>
      url.pathname.endsWith("/api/v1/workbench/read");
    await page.route(observationRoute, async (route) => {
      const request = JSON.parse(
        new URL(route.request().url()).searchParams.get("request") ?? "null",
      );
      if (request?.kind === "cadence-conversation" && request.id === chat) {
        const response = await route.fetch(),
          reply = await response.json();
        reply.value.state.runs = expanded ? [liveId, doneId] : [liveId];
        return route.fulfill({ response, json: reply });
      }
      if (request?.kind === "workflow" && [liveId, doneId].includes(request.id))
        return route.fulfill({
          json:
            expanded && request.id === liveId
              ? {
                  kind: "error",
                  error: publicError("unavailable"),
                }
              : {
                  kind: "ok",
                  value: {
                    kind: "workflow",
                    commandId: null,
                    response: {
                      type: "run",
                      run: run(request.id, request.id === liveId),
                    },
                  },
                },
        });
      return route.continue();
    });
    const liveLine = page.getByRole("article", {
      name: "Observed live A",
      exact: true,
    });
    await liveLine.waitFor();
    expanded = true;
    await page
      .getByRole("article", { name: "Observed settled B", exact: true })
      .waitFor();
    await page
      .getByText(
        "Workflow activity unavailable; retained work may still be running.",
        { exact: true },
      )
      .waitFor();
    assert(await liveLine.isVisible());
    assert(
      await liveLine
        .getByRole("button", {
          name: "Cancel workflow — request stop",
          exact: true,
        })
        .isVisible(),
    );
    assert.equal(
      await page.locator(".conversation-header .ep-state.running").innerText(),
      "implementing",
    );
    assert.equal(f.contacts(), 2);
    await page.unroute(observationRoute);
    // Unsupported old IDs are not repairable by preparing an owner or Send.
    const retired = randomUUID();
    const oldPath = join(
      f.c.directory,
      "conversations-v1",
      "identities",
      `${retired}.json`,
    );
    const oldBytes = "opaque retired conversation";
    f.c.files.create(oldPath, oldBytes);
    const retiredUrl = new URL(f.tokenLink);
    retiredUrl.hash = `chat=${retired}`;
    await page.goto(retiredUrl.href);
    await page
      .getByText(
        "This Cadence conversation format is no longer supported. Start a new conversation; existing files are kept (retired-conversation).",
        { exact: true },
      )
      .first()
      .waitFor();
    assert(
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .isDisabled(),
    );
    assert(
      await page
        .getByRole("button", { name: "New conversation", exact: true })
        .isVisible(),
    );
    assert.equal(readFileSync(oldPath, "utf8"), oldBytes);
    assert.equal(f.contacts(), 2);
    assert.deepEqual(errors, []);
    writeFileSync(
      join(root, "receipt.json"),
      JSON.stringify({
        passed: true,
        conversations: seen.size,
        contacts: f.contacts(),
        errors,
      }),
    );
  } catch (error) {
    writeFileSync(
      join(root, "read-trace.json"),
      JSON.stringify({ failure: String(error), errors, readTrace }, null, 2),
    );
    writeFileSync(
      join(root, "failure.html"),
      (await page?.content().catch(() => "unavailable")) ?? "unavailable",
    );
    await page
      ?.screenshot({ path: join(root, "failure.png"), fullPage: true })
      .catch(() => {});
    writeFileSync(
      join(root, "failure.txt"),
      (await page
        ?.locator("body")
        .innerText()
        .catch(() => "unavailable")) ?? "unavailable",
    );
    throw error;
  } finally {
    releaseModel();
    await browser?.close();
    await f.close();
  }
}, 120000);
