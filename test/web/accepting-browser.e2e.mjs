import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { it, vi } from "vitest";
import { acceptingFixture } from "../helpers/accepting-fixture.ts";
import { archivedRun } from "../helpers/archived-run.ts";
import { keepOnlyEnvironment } from "../helpers/windows-environment.ts";

it("retired task controls stay absent; a cold generated owner reads fabricated archived history, exact search and complete downloads", async () => {
  // Format-level archived evidence only; current SDK execution is tested separately.
  // No legacy task executor, model selection or provider request is used here.
  const executablePath = process.env.CADENCE_BROWSER_PATH;
  const f = await acceptingFixture("source", (env) => {
    keepOnlyEnvironment(Object.keys(env));
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  });
  const root = mkdtempSync(join(tmpdir(), "cdb-"));
  let browser, page;
  const errors = [],
    downloads = [];
  try {
    assert.equal((await f.client.session()).kind, "ok");
    const seeded = await archivedRun(f.host, f.longText);
    const taskId = seeded.taskId;
    const started = { runId: seeded.runId };
    const snapshot = await f.client.snapshot({ kind: "task", id: taskId });
    assert.equal(snapshot.kind, "ok");
    const child = snapshot.value.runs.find((run) => run.childRunId);
    assert(child);
    const contacts = f.contacts();
    assert.equal(contacts, 0);
    const restarted = await f.restart();
    assert.equal((await restarted.client.models()).value.selected, null);

    assert(executablePath, "existing Chromium required; never download");
    browser = await chromium.launch({
      executablePath,
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
      acceptDownloads: true,
    });
    page = await context.newPage();
    const p = page;
    p.setDefaultTimeout(15000);
    p.on("pageerror", (e) => errors.push(e.message));
    const mutations = [];
    p.on("request", (request) => {
      if (/\/(commands|preflight)$/.test(new URL(request.url()).pathname))
        mutations.push(request.url());
    });
    await p.goto(f.tokenLink);
    await p.getByRole("textbox", { name: "Message", exact: true }).waitFor();
    assert.equal(
      await p.getByRole("button", { name: "Legacy task", exact: true }).count(),
      0,
    );
    await p.goto(`${f.endpoint}/app#task=${taskId}`);
    await p
      .getByText(
        "History is readonly. Start new work in a conversation with /cadence.",
      )
      .waitFor();
    assert.equal(
      await p.getByLabel("Readable plan", { exact: true }).count(),
      0,
    );
    assert.equal(
      await p
        .getByRole("button", {
          name: /Preview Start|Confirm plan and execute|Review implementation plan/,
        })
        .count(),
      0,
    );
    await p
      .getByRole("button", {
        name: "Search all retained pages in selected scope",
      })
      .first()
      .click();
    await p
      .getByRole("textbox", { name: "Case-sensitive literal query" })
      .fill("END-RETAINED");
    const deadline = Date.now() + 15000;
    await p.locator(".gs-section-head").waitFor();
    while (!(await p.locator(".gs-item").count())) {
      assert(Date.now() < deadline, "retained search did not reach a hit");
      const response = p.waitForResponse((r) =>
        new URL(r.url()).pathname.endsWith("/search"),
      );
      await p
        .getByRole("button", { name: "Continue same snapshot search" })
        .click();
      await response;
      await p
        .getByText("Searching bounded retained range…", { exact: true })
        .waitFor({ state: "hidden" });
    }
    // The exact-hit keyboard path does not depend on pointer layout while
    // asynchronous source-coverage messages arrive.
    await p
      .getByRole("textbox", { name: "Case-sensitive literal query" })
      .press("Enter");
    await p.locator(".detail-text mark").first().waitFor();
    assert.equal(
      await p.locator(".detail-text mark").first().textContent(),
      "END-RETAINED",
    );
    for (const [kind, id, format] of [
      ["task", taskId, "ndjson"],
      ["task", taskId, "markdown"],
      ["run", started.runId, "ndjson"],
      ["child", child.childRunId, "markdown"],
    ]) {
      const hash = new URLSearchParams({
        task: taskId,
        scope: JSON.stringify({ kind, id }),
        snapshot: snapshot.value.committedSeq,
      });
      await p.goto(`${f.endpoint}/app#${hash}`);
      await p.locator(".view-menu > summary").click();
      await p.getByRole("button", { name: "Export selected scope" }).click();
      const dialog = p.getByRole("dialog");
      await dialog.getByLabel("Format").selectOption(format);
      const pending = p.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "Request selected-scope download" })
        .click();
      const download = await pending;
      const path = join(root, `${kind}.${format}`);
      await download.saveAs(path);
      assert.equal(await download.failure(), null);
      const text = readFileSync(path, "utf8");
      assert(text.includes("END-RETAINED"));
      const marker =
        format === "ndjson"
          ? text.lastIndexOf("\n", text.length - 2) + 1
          : text.lastIndexOf("\n\n```json\n");
      const tail = text.slice(marker);
      const frame = JSON.parse(
        format === "ndjson"
          ? tail.trim()
          : tail.slice("\n\n```json\n".length, -"\n```\n".length),
      );
      assert.equal(frame.event.kind, "trailer");
      assert.equal(frame.event.complete, true);
      assert.equal(
        frame.event.encodedBytes,
        Buffer.byteLength(text.slice(0, marker)),
      );
      assert.equal(
        frame.event.sha256,
        createHash("sha256").update(text.slice(0, marker)).digest("hex"),
      );
      assert.equal(frame.event.frames, frame.ordinal - 1);
      downloads.push({ kind, format, bytes: Buffer.byteLength(text) });
      await p.keyboard.press("Escape");
    }
    for (const width of [1440, 768, 390, 320]) {
      await p.setViewportSize({ width, height: 900 });
      if (width <= 900) {
        await p
          .getByRole("button", { name: "Files / history", exact: true })
          .click();
        await p.waitForFunction(
          () => document.activeElement?.closest(".drawer-right.open") !== null,
        );
        await p.keyboard.press("Escape");
        await p.waitForFunction(
          () => !document.querySelector(".panel-drawer.open"),
        );
      }
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    assert.equal(
      f.contacts(),
      contacts,
      "history never needs model authentication or starts work",
    );
    assert.deepEqual(mutations, []);
    assert.deepEqual(errors, []);
    writeFileSync(
      join(root, "receipt.json"),
      JSON.stringify({ passed: true, contacts, downloads, errors }),
    );
  } catch (error) {
    if (page)
      await page.screenshot({
        path: join(root, "failure.png"),
        fullPage: true,
      });
    if (page)
      writeFileSync(join(root, "failed-dom.html"), await page.content());
    throw error;
  } finally {
    await browser?.close();
    await f.close();
    vi.unstubAllEnvs();
  }
}, 120000);
