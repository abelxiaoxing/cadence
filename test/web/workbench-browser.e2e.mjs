import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { it } from "vitest";
import { acceptingFixture } from "../helpers/accepting-fixture.ts";

it("built workbench: ordinary chat, file reference, explicit Cadence transition, retained link and responsive drawers", async () => {
  const f = await acceptingFixture("generated");
  const root = mkdtempSync(join(tmpdir(), "wb-"));
  let browser, page;
  const errors = [],
    responses = [];
  try {
    assert(
      process.env.CADENCE_BROWSER_PATH,
      "existing browser required; no download",
    );
    browser = await chromium.launch({
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
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
    const p = await context.newPage();
    page = p;
    p.on("response", (response) => {
      if (response.status() >= 400)
        responses.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
    });
    p.setDefaultTimeout(15000);
    p.on("pageerror", (error) => errors.push(error.message));
    await p.goto(f.tokenLink);
    await p.getByRole("textbox", { name: "Message", exact: true }).waitFor();
    assert(!p.url().includes("token="));
    assert.equal(f.contacts(), 0);
    await p.getByRole("button", { name: "Choose owner model" }).click();
    await p
      .getByLabel("Exact model / API / thinking")
      .selectOption({ label: "fixture/fixed · openai-completions · off" });
    await p.getByRole("button", { name: "Confirm owner model choice" }).click();
    await p.locator("dialog[open]").waitFor({ state: "hidden" });
    const input = p.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("x".repeat(16 * 1024 + 1));
    await p.getByRole("button", { name: "Send", exact: true }).click();
    await p.getByText(/Send unavailable.*16 KiB/).waitFor();
    assert.equal(f.contacts(), 0);
    await input.fill("Browser ordinary conversation");
    await p.getByRole("button", { name: "Send", exact: true }).click();
    await p
      .locator(".chat-message.assistant")
      .getByText(/Advisory:/)
      .waitFor();
    await p.waitForFunction(
      () =>
        document.querySelector(".chat-workspace .conversation-header .ep-state")
          ?.textContent === "completed",
    );
    assert.equal(f.contacts(), 1);
    const chatUrl = p.url();
    await p.getByRole("button", { name: "existing.txt", exact: true }).click();
    await p
      .locator(".file-preview pre")
      .getByText("pre-existing dirt is preserved")
      .waitFor();
    await p
      .getByRole("button", { name: "Reference existing.txt", exact: true })
      .click();
    await p.waitForFunction(
      () =>
        document.querySelector('textarea[aria-label="Message"]')?.value ===
        "@existing.txt",
    );
    assert.equal(await input.inputValue(), "@existing.txt");
    await p.screenshot({ path: join(root, "desktop.png"), fullPage: true });
    await input.fill("/cadence Prepare a safe task from this chat");
    await p.getByRole("button", { name: "Prepare task", exact: true }).click();
    await p
      .getByRole("button", { name: "Review implementation plan", exact: true })
      .waitFor();
    await p.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) =>
          button.textContent === "Review implementation plan" &&
          !button.disabled,
      ),
    );
    assert.equal(await p.getByRole("dialog").count(), 0);
    assert.equal(await p.getByLabel("Kind", { exact: true }).count(), 0);
    await p.getByLabel("Readable plan", { exact: true }).waitFor();
    await p
      .getByRole("button", {
        name: "Back to ordinary conversation",
        exact: true,
      })
      .waitFor();
    assert.equal(
      f.contacts(),
      2,
      "Send starts one readonly analysis without editing",
    );
    await p.reload();
    await p
      .getByRole("button", {
        name: "Back to ordinary conversation",
        exact: true,
      })
      .click();
    assert.equal(p.url(), chatUrl);
    await p
      .locator(".chat-message.assistant")
      .getByText(/Advisory:/)
      .waitFor();
    const drawer = async (side, open) =>
      p.waitForFunction(
        ({ side, open }) => {
          const panel = document.querySelector(`.drawer-${side}`);
          if (!panel || panel.classList.contains("open") !== open) return false;
          const box = panel.getBoundingClientRect();
          return open
            ? box.left >= -1 &&
                box.right <= innerWidth + 1 &&
                panel.contains(document.activeElement)
            : side === "left"
              ? box.right <= 0
              : box.left >= innerWidth;
        },
        { side, open },
      );
    for (const width of [390, 320]) {
      await p.setViewportSize({ width, height: 844 });
      await p.getByRole("button", { name: "Tasks", exact: true }).click();
      await drawer("left", true);
      await p.getByRole("button", { name: /Subagents/ }).waitFor();
      await p.screenshot({
        path: join(root, `left-${width}.png`),
        fullPage: true,
      });
      await p.keyboard.press("Escape");
      await drawer("left", false);
      await p
        .getByRole("button", { name: "Plan / review", exact: true })
        .click();
      await drawer("right", true);
      await p.getByRole("region", { name: "File list", exact: true }).waitFor();
      await p.screenshot({
        path: join(root, `files-${width}.png`),
        fullPage: true,
      });
      await p.keyboard.press("Escape");
      await drawer("right", false);
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await p.screenshot({
        path: join(root, `chat-${width}.png`),
        fullPage: true,
      });
    }
    await p
      .getByRole("button", { name: "Switch working folder", exact: true })
      .click();
    await p
      .getByRole("dialog", { name: "Open working folder", exact: true })
      .waitFor();
    assert.equal(f.contacts(), 2);
    await p.keyboard.press("Escape");
    await p.setViewportSize({ width: 1440, height: 900 });
    await p
      .getByRole("button", { name: /Prepare a safe task from this chat/ })
      .click();
    await p
      .getByRole("button", { name: "Review implementation plan", exact: true })
      .click();
    await p
      .getByRole("dialog", { name: "Confirm plan and execute", exact: true })
      .waitFor();
    assert.equal(f.contacts(), 2, "Opening a plan confirmation does not edit");
    await p
      .getByRole("button", { name: "Confirm plan and execute", exact: true })
      .click();
    await p.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    const deadline = Date.now() + 15000;
    while (f.contacts() < 3 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      f.contacts(),
      3,
      "One plan confirmation starts exactly one implementation worker",
    );
    // The started worker settles before the fixture's orderly close.
    const drainBy = Date.now() + 15000;
    for (;;) {
      const active = await f.client.activeRuns();
      if (
        active.kind === "ok" &&
        active.value.status === "complete" &&
        active.value.runs.length === 0
      )
        break;
      assert(Date.now() < drainBy, "implementation run did not drain");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.deepEqual(errors, []);
    writeFileSync(
      join(root, "receipt.json"),
      JSON.stringify(
        {
          passed: true,
          errors,
          contacts: f.contacts(),
          viewports: [1440, 390, 320],
          paidProvider: false,
          screenshots: root,
        },
        null,
        2,
      ),
    );
    console.log(`Workbench browser evidence: ${root}`);
  } catch (error) {
    await page
      ?.screenshot({ path: join(root, "failure.png"), fullPage: true })
      .catch(() => {});
    writeFileSync(
      join(root, "failure-dom.txt"),
      (await page
        ?.locator("body")
        .innerText()
        .catch(() => "unavailable")) ?? "unavailable",
    );
    writeFileSync(
      join(root, "failure.json"),
      JSON.stringify({ errors, responses, message: String(error) }, null, 2),
    );
    throw error;
  } finally {
    await browser?.close();
    await f.close();
  }
}, 120000);
