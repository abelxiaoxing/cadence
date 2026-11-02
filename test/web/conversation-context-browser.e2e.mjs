import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { stopService } from "../../src/service/cli.ts";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { processStart } from "../../src/service/liveness.ts";
import { gatewayFixture } from "../helpers/gateway-fixture.ts";

it("conversation directories and models survive same-checkout navigation and another tab's model changes", async () => {
  const g = await gatewayFixture(null, { models: ["fixed", "alternate"] });
  const evidence = mkdtempSync(join(tmpdir(), "ctx-ui-"));
  const repo = join(g.f.dir, "monorepo"),
    a = join(repo, "one"),
    b = join(repo, "two");
  for (const [cwd, name] of [
    [a, "only-a.txt"],
    [b, "only-b.txt"],
  ]) {
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, name), name);
  }
  execFileSync("git", ["init", "-q"], { cwd: repo });
  let browser, page;
  const errors = [],
    cleanup = [],
    commands = [];
  try {
    assert(process.env.CADENCE_BROWSER_PATH);
    browser = await chromium.launch({
      executablePath: process.env.CADENCE_BROWSER_PATH,
      headless: true,
      env: {
        PATH: process.env.PATH,
        HOME: evidence,
        TMPDIR: evidence,
        TEMP: evidence,
        TMP: evidence,
      },
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    context.on("page", (tab) => {
      tab.setDefaultTimeout(15000);
      tab.on("pageerror", (e) => errors.push(e.message));
    });
    page.on("pageerror", (e) => errors.push(e.message));
    context.on("request", (r) => {
      if (r.method() === "POST" && r.postDataJSON()?.kind === "send")
        commands.push(r.postDataJSON());
    });
    await page.goto(g.link);
    const input = () =>
      page.getByRole("textbox", { name: "Message", exact: true });
    const sendButton = () =>
      page.getByRole("button", { name: "Send", exact: true });
    async function folder(cwd) {
      await page
        .getByRole("button", { name: "Switch working folder", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Edit path", exact: true })
        .click();
      await page.getByRole("textbox", { name: "Folder path" }).fill(cwd);
      await page
        .getByRole("button", { name: "Use this folder", exact: true })
        .click();
      await page.locator("dialog[open]").waitFor({ state: "hidden" });
      await expect.poll(() => input().isEnabled()).toBe(true);
    }
    async function choose(tab, model) {
      await tab.getByRole("button", { name: /^Model:/ }).click();
      await tab
        .getByRole("dialog", { name: "Choose a model" })
        .getByRole("option", { name: new RegExp(`^${model}`) })
        .click();
      await tab
        .getByRole("dialog", { name: "Choose a model" })
        .waitFor({ state: "hidden" });
    }
    async function sent(text, first = false) {
      g.f.reply(`Answer: ${text}`);
      await input().fill(text);
      await sendButton().click();
      if (first)
        await page
          .getByRole("dialog", { name: "Choose a model" })
          .getByRole("option", { name: /^fixed/ })
          .click();
      await page.getByText(`Answer: ${text}`, { exact: true }).waitFor();
      await expect
        .poll(
          () =>
            page.getByRole("button", { name: /^Model:/ }).getAttribute("title"),
          { timeout: 15000 },
        )
        .not.toBe("Switch models after the current reply finishes.");
    }
    await folder(a);
    assert.equal(g.store.associatedProjects().length, 0);
    assert.equal(g.f.contacts(), 0);
    await sent("A original", true);
    const aUrl = page.url(),
      aId = commands[0].conversationId;
    await page
      .getByRole("button", { name: "Reference only-a.txt", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Reference only-b.txt", exact: true })
        .count(),
      0,
    );
    await folder(b);
    assert.equal(g.f.contacts(), 1);
    await sent("B first default");
    const bUrl = page.url();
    await choose(page, "alternate");
    await sent("B own model");
    assert.equal(commands[1].conversationId, commands[2].conversationId);
    await input().fill("B draft survives a different directory entry");
    await page
      .getByRole("button", { name: "Reference only-b.txt", exact: true })
      .waitFor();
    const entries = g.store.projects();
    assert.equal(entries.length, 2);
    assert.notEqual(entries[0].id, entries[1].id);
    assert.equal(entries[0].path, repo);
    assert.equal(entries[1].path, repo);
    assert.equal(entries[0].epoch, entries[1].epoch); // one execution owner, two directory entries
    await folder(a);
    assert.equal(page.url(), aUrl);
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    await sent("A second conversation"); // new conversations may use the remembered default
    await page.getByRole("button", { name: /A original/ }).click();
    await expect.poll(() => input().isEnabled()).toBe(true);
    assert.equal(new URL(page.url()).hash, `#chat=${aId}`);
    await expect
      .poll(() => page.getByRole("button", { name: /^Model:/ }).textContent())
      .toContain("fixed");
    const tab = await context.newPage();
    await tab.goto(bUrl);
    await expect
      .poll(() => tab.getByRole("button", { name: /^Model:/ }).isEnabled())
      .toBe(true);
    g.f.reply("Answer: A admitted before other-tab changes");
    g.f.mode("pending");
    await input().fill("A admitted before other-tab changes");
    await sendButton().click();
    await expect.poll(() => g.f.held(), { timeout: 15000 }).toBe(1);
    await choose(tab, "fixed");
    await choose(tab, "alternate");
    g.f.mode("single");
    g.f.release();
    await page
      .getByText("Answer: A admitted before other-tab changes", { exact: true })
      .waitFor();
    await expect
      .poll(
        () =>
          page.getByRole("button", { name: /^Model:/ }).getAttribute("title"),
        { timeout: 15000 },
      )
      .not.toBe("Switch models after the current reply finishes.");
    assert.deepEqual(g.f.modelRequests, [
      "fixed",
      "fixed",
      "alternate",
      "alternate",
      "fixed",
    ]);
    assert.deepEqual(
      commands.map((c) => c.model.conversation.cwd),
      [a, b, b, a, a],
    );
    assert.equal(commands[4].conversationId, aId);
    assert.notEqual(commands[3].conversationId, aId);
    assert.equal(g.f.maxActive(), 1);
    await tab.close();
    // Open B's retained conversation through A's navigation entry. Its original
    // directory/model, not the entry or the owner's old default, controls Send.
    await page.getByRole("button", { name: /B first default/ }).click();
    await expect
      .poll(() =>
        page
          .getByRole("button", { name: "Switch working folder", exact: true })
          .textContent(),
      )
      .toContain(b);
    assert.equal(
      await input().inputValue(),
      "B draft survives a different directory entry",
    );
    const owner = new ServiceCoordination(repo, g.f.c.stateHome);
    const row = owner.registry().value.entries.find((r) => r.root === repo);
    const started = processStart(row.pid);
    const settings = join(
      owner.directory,
      "conversations-v1",
      "contexts",
      `${commands[1].conversationId}.json`,
    );
    const keptSettings = readFileSync(settings, "utf8");
    assert.equal((await stopService(owner)).status, "stopped");
    if (started)
      await expect
        .poll(() => processStart(row.pid), { timeout: 15000 })
        .not.toBe(started);
    // Stop can overlap a poll and leave its refusal visible until the next
    // readonly observation. Sending then correctly prepares only, not a turn.
    // Observe the cold context/head before this test's single explicit Send;
    // never retry Send or treat successful preparation as message admission.
    await Promise.all([
      ...["conversation", "conversation-context"].map((kind) =>
        page.waitForResponse(async (response) => {
          const url = new URL(response.url());
          if (!url.pathname.endsWith("/api/v1/workbench/read")) return false;
          const request = JSON.parse(url.searchParams.get("request") ?? "null");
          if (request?.kind !== kind || !response.ok()) return false;
          const reply = await response.json();
          return (
            reply.kind === "ok" &&
            (kind === "conversation"
              ? reply.value.summary?.head === commands[2].commandId
              : reply.value.context?.id === commands[2].conversationId)
          );
        }),
      ),
      page
        .getByText(
          "Execution will be prepared when you send. Browsing does not start it.",
          { exact: true },
        )
        .waitFor(),
    ]);
    await page
      .getByText(
        "Conversation context is unavailable. Send can prepare execution, but cannot submit this draft until the context is observed.",
        { exact: true },
      )
      .waitFor({ state: "hidden" });
    assert.equal(commands.length, 5);
    assert.equal(g.f.contacts(), 5);
    renameSync(a, join(repo, "retired-one"));
    await sent("B after removed owner default");
    assert.equal(commands.at(-1).model.conversation.cwd, b);
    assert.equal(g.f.modelRequests.at(-1), "alternate");
    assert.notEqual(commands.at(-1).model.epoch, commands[0].model.epoch);
    assert.equal(readFileSync(settings, "utf8"), keptSettings);
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .getByRole("button", { name: "Switch working folder", exact: true })
          .textContent(),
      )
      .toContain(b);
    await page
      .getByRole("button", { name: "Reference only-b.txt", exact: true })
      .waitFor();
    await input().fill("Unsent B draft");
    await page.reload();
    await expect.poll(() => input().inputValue()).toBe("Unsent B draft");
    await expect
      .poll(() =>
        page
          .getByRole("button", { name: "Switch working folder", exact: true })
          .textContent(),
      )
      .toContain(b);
    assert.equal(g.f.contacts(), 6);
    assert.deepEqual(errors, []);
  } catch (e) {
    await page
      ?.screenshot({ path: join(evidence, "failure.png"), fullPage: true })
      .catch(() => {});
    throw e;
  } finally {
    try {
      await browser?.close();
    } catch (e) {
      cleanup.push(String(e));
    }
    try {
      await g.close();
    } catch (e) {
      cleanup.push(String(e));
    }
    writeFileSync(
      join(evidence, "receipt.json"),
      JSON.stringify(
        {
          commands,
          modelRequests: g.f.modelRequests,
          contacts: g.f.contacts(),
          errors,
          cleanup,
        },
        null,
        2,
      ),
    );
    assert.deepEqual(cleanup, []);
  }
}, 60000);
