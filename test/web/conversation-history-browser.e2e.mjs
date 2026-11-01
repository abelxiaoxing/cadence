import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { it } from "vitest";
import { acceptingFixture } from "../helpers/accepting-fixture.ts";
import { seedConversations } from "../helpers/retained-conversations.ts";

it("built browser pages all 205 conversations, returns to recent history and explicitly sends a new one", async () => {
  const f = await acceptingFixture("generated"),
    root = mkdtempSync(join(tmpdir(), "chat-pages-"));
  let browser, page;
  try {
    await f.client.session();
    const catalog = await f.client.models();
    assert.equal(catalog.kind, "ok");
    seedConversations(f.c, f.root, catalog.value.version);
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
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(f.tokenLink);
    const rows = page
      .locator(".task-list button.session-item")
      .filter({ hasText: "Archived conversation" });
    const seen = new Set();
    for (let n = 0; n < 5; n++) {
      const first = 204 - n * 50;
      await page
        .getByRole("button", {
          name: new RegExp(
            `^Archived conversation ${String(first).padStart(3, "0")}`,
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
    await page
      .getByRole("button", { name: /^Archived conversation 000/ })
      .click();
    await page
      .locator(".chat-message.assistant")
      .getByText("Saved reply 0", { exact: true })
      .waitFor();
    assert.equal(f.contacts(), 0, "history never calls a provider");
    await page
      .getByRole("button", { name: "Latest conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^Archived conversation 204/ })
      .waitFor();
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    f.reply("New conversation beyond the old ceiling.");
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Explicit Send beyond 200 conversations");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .locator(".chat-message.assistant")
      .getByText("New conversation beyond the old ceiling.", { exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".conversation-header .ep-state")
          ?.textContent === "completed",
    );
    assert.equal(f.contacts(), 1);
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
    await browser?.close();
    await f.close();
  }
}, 120000);
