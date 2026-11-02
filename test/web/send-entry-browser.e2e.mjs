import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { it } from "vitest";
import { gatewayFixture } from "../helpers/gateway-fixture.ts";

it("Send entry: a lost preparation reply sends nothing; refresh and departure never replay or rebind the message", async () => {
  const g = await gatewayFixture();
  const root = mkdtempSync(join(tmpdir(), "send-entry-"));
  const directories = [
    join(g.f.dir, "first-send"),
    join(g.f.dir, "departed-send"),
  ];
  for (const path of directories) mkdirSync(path, { mode: 0o700 });
  let browser, page, release;
  const errors = [],
    commands = [],
    preparations = [],
    cleanup = [];
  try {
    assert(process.env.CADENCE_BROWSER_PATH, "existing browser required");
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
    page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const value = request.postDataJSON();
      if (
        ["send", "cadence-send", "cadence-prepare", "cadence-approve"].includes(
          value?.kind,
        )
      )
        commands.push(value);
      if (request.url().endsWith("/workbench/v1/prepare-send"))
        preparations.push(value);
    });
    await page.goto(g.link);
    async function select(path) {
      await page
        .getByRole("button", { name: "Switch working folder", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Edit path", exact: true })
        .click();
      await page.getByRole("textbox", { name: "Folder path" }).fill(path);
      await page
        .getByRole("button", { name: "Use this folder", exact: true })
        .click();
      await page.locator("dialog[open]").waitFor({ state: "hidden" });
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .fill("Original message, never a queued retry");
    }
    await select(directories[0]);
    assert.equal(g.store.associatedProjects().length, 0);
    const preparationRoute = "**/workbench/v1/prepare-send";
    await page.route(preparationRoute, async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "The message was not sent" })
      .waitFor();
    assert.equal(preparations.length, 1);
    assert.equal(commands.length, 0);
    assert.equal(g.store.associatedProjects().length, 1);
    assert.equal(g.f.contacts(), 0);
    await page.unroute(preparationRoute);
    await page.reload();
    await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .inputValue(),
      "Original message, never a queued retry",
    );
    assert.equal(preparations.length, 1);
    assert.equal(commands.length, 0);
    // A new explicit Send may reuse the already-started owner. Choosing a model
    // completes only that Send, not the earlier failed preparation.
    g.f.reply("One current explicit Send completed.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Choose a model" })
      .getByRole("option", { name: /^fixed/ })
      .click();
    await page
      .getByText("One current explicit Send completed.", { exact: true })
      .waitFor();
    assert.equal(commands.length, 1);
    assert.equal(commands[0].text, "Original message, never a queued retry");
    assert.equal(g.f.contacts(), 1);
    // Departure wins while the current Send's preparation response is held.
    // The accepted startup can finish, but no message may enter a new view.
    await select(directories[1]);
    let prepared;
    const observed = new Promise((resolve) => {
      prepared = resolve;
    });
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route(preparationRoute, async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      prepared();
      await held;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await observed;
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("New view draft stays unsent");
    release();
    // The owner was admitted, not a turn. Reload observes it and the new draft.
    await page.reload();
    await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .inputValue(),
      "New view draft stays unsent",
    );
    assert.equal(g.store.associatedProjects().length, 2);
    assert.equal(commands.length, 1);
    assert.equal(g.f.contacts(), 1);
    await page.unroute(preparationRoute);
    // An unreadable initial/partial context cannot silently rebase into a Send.
    // Preparation remains reachable even without an existing draft (e.g. after
    // failed owner setup), but asks for a new explicit Send after the user can
    // inspect the restored context.
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("");
    const unreadable = (url) =>
      url.pathname.endsWith("/api/v1/workbench/read") &&
      JSON.parse(url.searchParams.get("request") ?? "null")?.kind ===
        "conversation";
    await page.route(unreadable, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          kind: "error",
          error: { code: "unavailable", effect: "none", recovery: "operator" },
        }),
      }),
    );
    await page.reload();
    await page
      .getByText(
        "Conversation context is unavailable. Send can prepare execution, but cannot submit this draft until the context is observed.",
        { exact: true },
      )
      .waitFor();
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    assert.equal(await message.inputValue(), "");
    assert.equal(await message.isEnabled(), true);
    await message.fill(
      "Draft entered while conversation reads are unavailable",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({
        hasText: "Execution was prepared, but the conversation was unreadable",
      })
      .waitFor();
    assert.equal(commands.length, 1);
    assert.equal(g.f.contacts(), 1);
    await page.unroute(unreadable);
    await page.reload();
    await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
    // Losing the actual accepted Send reply is different: observe that exact
    // command, including across refresh; do not prepare or submit it again.
    let accepted;
    await page.route("**/api/v1/workbench/command", async (route) => {
      if (route.request().postDataJSON()?.kind !== "send")
        return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      assert.equal(body.kind, "ok", JSON.stringify(body));
      accepted = body.value.commandId;
      assert.equal(accepted, route.request().postDataJSON().commandId);
      await route.abort("failed");
    });
    g.f.reply("Accepted despite a lost Send reply.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .getByText("Accepted despite a lost Send reply.", { exact: true })
      .waitFor();
    assert.equal(commands.length, 2);
    assert.equal(accepted, commands[1].commandId);
    assert.notEqual(commands[0].conversationId, commands[1].conversationId);
    const preparedCount = preparations.length;
    await page.reload();
    await page
      .getByText("Accepted despite a lost Send reply.", { exact: true })
      .waitFor();
    assert.equal(commands.length, 2);
    assert.equal(preparations.length, preparedCount);
    assert.equal(g.f.contacts(), 2);
    // A failed first readiness observation must not hide the conversation or
    // its draft. Reads and editing are not proof of execution readiness.
    const readiness = /\/workbench\/v1\/projects\/[a-f0-9]{64}$/;
    await page.route(readiness, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          kind: "error",
          error: { code: "unavailable", effect: "none", recovery: "operator" },
        }),
      }),
    );
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "unavailable" }).waitFor();
    assert.equal(await message.count(), 1);
    await message.fill("Draft survives an unavailable readiness observation");
    await page
      .getByText("Accepted despite a lost Send reply.", { exact: true })
      .waitFor();
    assert.equal(commands.length, 2);
    assert.equal(preparations.length, preparedCount);
    await page.reload();
    await message.waitFor();
    assert.equal(
      await message.inputValue(),
      "Draft survives an unavailable readiness observation",
    );
    await page.unroute(readiness);
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: join(root, "failure.png") })
        .catch(() => {});
    throw error;
  } finally {
    release?.();
    writeFileSync(
      join(root, "receipt.json"),
      JSON.stringify({
        errors,
        commands,
        preparations,
        contacts: g.f.contacts(),
        cleanup,
      }),
    );
    try {
      if (browser) await browser.close();
    } catch (error) {
      cleanup.push(String(error));
    }
    try {
      await g.close();
    } catch (error) {
      cleanup.push(String(error));
    }
    writeFileSync(
      join(root, "receipt.json"),
      JSON.stringify({
        errors,
        commands,
        preparations,
        contacts: g.f.contacts(),
        cleanup,
      }),
    );
    assert.deepEqual(cleanup, []);
  }
}, 120000);
