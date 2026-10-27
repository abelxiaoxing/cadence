import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { nativeCall } from "../../src/service/cli.ts";
import { publicError } from "../../src/service-contract.ts";
import { confirm, prepare } from "../../web/src/client/actions.ts";
import { acceptingFixture } from "../helpers/accepting-fixture.ts";

const ok = (reply) => {
  assert.equal(reply.kind, "ok", JSON.stringify(reply));
  return reply.value;
};
it("built browser reads retained conversation after live task removal and restart with no model, without a stale/restart banner", async () => {
  const f = await acceptingFixture("generated"),
    root = mkdtempSync(join(tmpdir(), "rt-"));
  let launcher, browser, original, page, failure;
  const receipt = { passed: false, errors: [], mutations: [] };
  try {
    // Seed genuine retained SDK text with fabricated loopback credentials. These
    // are explicit fixture actions, not browser observation or service recovery.
    const c = f.client,
      session = ok(await c.session());
    ok(
      await c.chooseModel({
        expected: ok(await c.models()).version,
        choice: {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    );
    async function submit(action) {
      const current = ok(
        await c.current({
          storeId: session.storeId,
          taskId: action.kind === "create" ? null : action.taskId,
        }),
      );
      assert.equal(current.context.status, "available");
      const command = ok(
        await confirm(c, ok(await prepare(c, current.context.version, action))),
      );
      await expect
        .poll(
          async () => {
            const lookup = await c.receipt(command.commandId),
              active = ok(await c.activeRuns());
            return (
              lookup.status === "found" &&
              lookup.receipt.publication === "published" &&
              active.status === "complete" &&
              !active.runs.some((r) => r.runId === command.runId)
            );
          },
          { timeout: 15000, interval: 100 },
        )
        .toBe(true);
      return command;
    }
    const created = await submit({
      kind: "create",
      taskKind: "research",
      goal: "Retained conversation without live record",
    });
    const taskId = created.created.taskId;
    const run = await submit({ kind: "start", taskId });
    assert.equal(
      (await c.receipt(run.commandId)).receipt.execution,
      "completed",
    );
    const taskPath = join(
      f.root,
      ".cadence",
      "assistant",
      "tasks",
      taskId,
      "task.json",
    );
    unlinkSync(taskPath);
    const next = await f.restart();
    assert.notEqual(next.epoch, session.epoch);
    assert.equal(ok(await next.client.session()).capabilities.actions, false);
    const snap = ok(await next.client.snapshot({ kind: "task", id: taskId }));
    assert.equal(snap.context.status, "unavailable");
    assert(
      snap.runs.some((r) => r.runId === run.runId && r.outcome === "completed"),
    );
    const link = await nativeCall(f.c, "token-link", true);

    assert(
      process.env.CADENCE_BROWSER_PATH,
      "explicit existing Chromium required; never download",
    );
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
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => receipt.errors.push(error.message));
    page.on("request", (request) => {
      if (
        /\/api\/v1\/(commands|preflight|model-choice|cancel)$/.test(
          request.url(),
        )
      )
        receipt.mutations.push(request.url());
    });
    await page.goto(link.link);
    await page
      .getByText("Shared compatibility: compatible", { exact: false })
      .waitFor();
    const selected = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/v1/snapshot",
    );
    void selected.catch(() => {});
    await page
      .getByRole("button", {
        name: /Retained conversation without live record/,
      })
      .click();
    assert.equal(
      ok(await (await selected).json()).context.status,
      "unavailable",
    );
    await page
      .getByText(
        "Advisory: inspect both independent readonly assignments, then explicitly review and save. Never auto-Start.",
        { exact: false },
      )
      .waitFor();
    await page
      .getByText(
        "Current control context unavailable. Historical data is not action authority.",
        { exact: true },
      )
      .waitFor();
    assert.equal(await page.locator(".banner-notice").count(), 0);
    assert.equal(
      await page
        .getByRole("button", { name: "Preview Start saved graph" })
        .count(),
      0,
    );

    // A local clipboard failure neither diagnoses the service nor masks a later
    // stale observation. Exercise real App state, not only a rendered component.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw Error("fixture clipboard denied");
          },
        },
      });
      document.execCommand = () => false;
    });
    await page.locator(".view-menu > summary").click();
    await page.getByRole("button", { name: "Copy token-free link" }).click();
    await page.getByText("Link copy unavailable.", { exact: false }).waitFor();
    assert.doesNotMatch(
      await page.locator(".banner-notice").innerText(),
      /cadence-service|systemctl|restart/,
    );

    // An independent generic stale still needs observation/confirmation, not an
    // invented models.json diagnosis. Do not change the real session build.
    await page.route(/\/api\/v1\/snapshot(?:\?|$)/, (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ kind: "error", error: publicError("stale") }),
      }),
    );
    await page
      .getByRole("button", { name: "Observe current state", exact: true })
      .click();
    await page
      .getByText(
        "Context changed. Observe again and request a fresh confirmation.",
        { exact: false },
      )
      .waitFor();
    assert.doesNotMatch(
      await page.locator(".banner-notice").innerText(),
      /models\.json|systemctl|restart|cadence-service/,
    );
    assert.deepEqual(receipt.mutations, []);
    assert.deepEqual(receipt.errors, []);
    assert.equal(f.contacts(), 1);
    assert.equal(existsSync(taskPath), false);
    receipt.passed = true;
  } catch (error) {
    failure = error;
    if (page)
      writeFileSync(join(root, "failed-dom.html"), await page.content());
  } finally {
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
