/** Generated owner + built UI over fabricated retained runs; no model selection or execution. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { it } from "vitest";
import { acceptingFixture } from "../helpers/accepting-fixture.ts";

it("built workflow history continues scans beyond 200 records, pages Back and refreshes without model calls", async () => {
  const f = await acceptingFixture("generated");
  const root = mkdtempSync(join(tmpdir(), "whb-"));
  let browser, page;
  const errors = [],
    commands = [],
    collected = [];
  try {
    const epoch = randomUUID();
    for (let i = 0; i < 221; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      const dir = join(f.c.directory, "workflows-v1", "runs", id);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(
        join(dir, "state.json"),
        JSON.stringify({
          id,
          epoch,
          goal: `Archived ${i}`,
          status: "completed",
          phase: "finished",
          steps: [],
          notice: "Fabricated archive",
          mergedCommit: null,
          humanReviewed: false,
        }),
        { mode: 0o600 },
      );
    }
    assert(process.env.CADENCE_BROWSER_PATH, "existing Chromium required");
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
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        /\/(command|commands|preflight)$/.test(new URL(request.url()).pathname)
      )
        commands.push(request.postData());
    });
    await page.goto(f.tokenLink);
    const panel = page.locator(".workflow-history");
    await panel.locator("summary").click();
    const continueScan = async () => {
      await panel
        .getByText("Scanning retained workflow IDs; no complete page yet.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await panel
          .getByText("No retained workflows on this page.", { exact: true })
          .count(),
        0,
      );
      await panel
        .getByRole("button", { name: "Continue reading history", exact: true })
        .click();
      await panel.locator(".session-title").first().waitFor();
    };
    for (let n = 0; n < 12; n++) {
      await continueScan();
      const titles = await panel.locator(".session-title").allTextContents();
      assert(titles.length > 0 && titles.length <= 20);
      collected.push(...titles);
      const next = panel.getByRole("button", { name: "Next", exact: true });
      if (n === 11) assert(await next.isDisabled());
      else await next.click();
    }
    assert.deepEqual(
      collected,
      Array.from({ length: 221 }, (_, i) => `Archived ${i}`),
    );
    await panel.getByRole("button", { name: "Previous", exact: true }).click();
    await continueScan();
    assert.deepEqual(
      await panel.locator(".session-title").allTextContents(),
      Array.from({ length: 20 }, (_, i) => `Archived ${200 + i}`),
    );
    await panel
      .getByRole("button", { name: "Observe current state", exact: true })
      .click();
    await continueScan();
    assert.equal(
      await panel.locator(".session-title").first().textContent(),
      "Archived 200",
    );
    assert.equal(f.contacts(), 0);
    assert.deepEqual(commands, []);
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page)
      await page.screenshot({
        path: join(root, "failure.png"),
        fullPage: true,
      });
    throw error;
  } finally {
    await browser?.close();
    await f.close();
  }
}, 120000);
