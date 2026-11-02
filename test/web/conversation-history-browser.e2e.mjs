import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { it } from "vitest";
import { sessionDirectory } from "../../src/service/pi-sessions.ts";
import { acceptingFixture } from "../helpers/accepting-fixture.ts";
import { seedPiSessions } from "../helpers/retained-conversations.ts";

it("built browser pages all 205 terminal sessions, continues one as a new branch and switches branches in its tree", async () => {
  const f = await acceptingFixture("generated"),
    root = mkdtempSync(join(tmpdir(), "chat-pages-"));
  let browser, page;
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
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(f.tokenLink);
    const rows = page
      .locator(".task-list button.session-item")
      .filter({ hasText: "Terminal question" });
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
