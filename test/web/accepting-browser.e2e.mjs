import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { it } from "vitest";
import { acceptingFixture } from "../helpers/accepting-fixture.ts";
import { secureAcceptingFixture } from "../helpers/secure-accepting.ts";

for (const route of ["loopback", "https"])
  it(`built ${route} browser-only accepting workflow, two contexts, original service work, full durable downloads and four viewports`, async () => {
    const f =
      route === "https"
        ? await secureAcceptingFixture()
        : await acceptingFixture("generated");
    const root = mkdtempSync("/home/mirako/abel/cdb-");
    let launcher, browser, original, failure, secondPage;
    const receipt = {
      passed: false,
      paidProvider: false,
      physicalHuman: false,
      viewports: [],
      downloads: [],
      errors: [],
    };
    try {
      const executablePath = process.env.CADENCE_BROWSER_PATH;
      assert(
        executablePath,
        "explicit existing Chromium required; never download",
      );
      launcher = await chromium.launchServer({
        executablePath,
        headless: true,
        env: {
          PATH: process.env.PATH,
          HOME: f.browserHome ?? root,
          TMPDIR: root,
          TEMP: root,
          TMP: root,
        },
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      original = once(launcher.process(), "close");
      browser = await chromium.connect(launcher.wsEndpoint());
      const one = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        acceptDownloads: true,
      });
      const two = await browser.newContext({
        viewport: { width: 390, height: 844 },
        acceptDownloads: true,
      });
      const p = await one.newPage(),
        other = await two.newPage();
      secondPage = other;
      for (const page of [p, other]) {
        page.setDefaultTimeout(15000);
        page.on("pageerror", (e) => receipt.errors.push(e.message));
        await page.goto(f.tokenLink);
        assert(!page.url().includes("token="));
        await page
          .getByText("Shared compatibility: compatible", { exact: false })
          .waitFor();
      }
      await p.getByRole("button", { name: "Choose owner model" }).click();
      await p
        .getByLabel("Exact model / API / thinking")
        .selectOption({ label: "fixture/fixed · openai-completions · off" });
      await p
        .getByRole("button", { name: "Confirm owner model choice" })
        .click();
      // The second already-attached tab must observe the new owner choice without
      // reloading, allocating another attachment, choosing again or starting work.
      await other
        .getByRole("button", { name: "Observe current state", exact: true })
        .click();
      await other
        .getByRole("button", { name: "Create task", exact: true })
        .click();
      await other
        .getByLabel("Goal", { exact: true })
        .fill("Local unsent draft");
      await other.waitForFunction(() =>
        [...document.querySelectorAll("button")].some(
          (button) =>
            button.textContent === "Preview Create (does not Start)" &&
            !button.disabled,
        ),
      );
      await other.keyboard.press("Escape");
      assert.equal(f.contacts(), 0);
      await p.getByRole("button", { name: "Create task", exact: true }).click();
      await p
        .getByLabel("Goal", { exact: true })
        .fill("Browser independent readonly collaboration");
      await p
        .getByRole("button", { name: "Preview Create (does not Start)" })
        .click();
      async function confirm(kind) {
        const response = p.waitForResponse(
          (r) =>
            r.url().endsWith("/api/v1/commands") &&
            r.request().method() === "POST",
        );
        void response.catch(() => {});
        await p
          .getByRole("button", { name: `Confirm ${kind}`, exact: true })
          .click();
        const body = await (await response).json();
        assert.equal(body.kind, "ok", JSON.stringify(body));
        return body.value;
      }
      async function drained(id) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const reply = await f.client.activeRuns();
          if (
            reply.kind === "ok" &&
            reply.value.status === "complete" &&
            !reply.value.runs.some((r) => r.runId === id)
          )
            return;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw Error("original run did not drain within action allowance");
      }
      async function published(command) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const r = await f.client.receipt(command.commandId);
          if (r.status === "found" && r.receipt.publication === "published") {
            if (command.runId) await drained(command.runId);
            return r.receipt;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        throw Error("publication unavailable");
      }
      const created = await published(await confirm("create"));
      const taskId = created.created.taskId;
      await p
        .locator(".panel-left")
        .getByRole("button", { name: "Observe a new snapshot" })
        .click();
      await p
        .getByRole("button", {
          name: /Browser independent readonly collaboration/,
        })
        .click();
      await p
        .getByLabel("Readable plan", { exact: true })
        .fill(
          "Inspect two independent readonly questions. Run the real configured check and review current changes.",
        );
      for (const name of ["first", "second"]) {
        await p
          .getByRole("button", { name: "Add assignment", exact: true })
          .click();
        await p
          .getByLabel("Instructions", { exact: true })
          .fill(`Inspect ${name} independently without editing.`);
        await p
          .getByLabel("Expected output", { exact: true })
          .fill("Report full retained observations.");
        await p.getByRole("button", { name: "Apply to local draft" }).click();
      }
      await p
        .getByRole("button", { name: "Preview Save plan", exact: true })
        .click();
      await published(await confirm("save-plan"));
      await p
        .getByRole("button", { name: "Observe current state", exact: true })
        .click();
      await p
        .getByRole("button", {
          name: "Load observed saved plan into local draft",
        })
        .waitFor();
      await p
        .getByRole("button", { name: "Preview readonly Generate proposal" })
        .click();
      const generated = await confirm("generate-plan");
      await published(generated);
      assert.equal(
        f.contacts(),
        1,
        "Generate is exactly one readonly advisory child",
      );
      await p
        .getByRole("button", { name: "Observe current state", exact: true })
        .click();
      f.mode("parallel");
      await p
        .getByRole("button", { name: "Preview Start saved graph" })
        .click();
      const started = await confirm("start");
      // Departure is not Cancel. The other context attaches to the actual task.
      await p.getByRole("button", { name: "Return — work continues" }).click();
      await other.goto(`${f.endpoint}/app#task=${taskId}`);
      await published(started);
      assert(f.maxActive() >= 2, "genuine overlapping SDK HTTP requests");
      assert.equal(f.contacts(), 3);
      await other
        .getByRole("button", { name: "Observe current state", exact: true })
        .click();
      await other
        .getByRole("button", { name: "outcomes", exact: true })
        .click();
      await other.getByText(started.runId, { exact: true }).waitFor();
      receipt.secondContextRunId = started.runId;
      await p.getByRole("button", { name: "Reconnect as a viewer" }).click();
      await p
        .getByRole("button", { name: "Observe current state", exact: true })
        .click();
      await p.getByRole("button", { name: "checks", exact: true }).click();
      await p
        .getByRole("button", { name: "Preview exact configured check" })
        .click();
      const checked = await confirm("check");
      await published(checked);
      await p
        .getByRole("button", { name: "Observe current state", exact: true })
        .click();
      await p
        .getByRole("button", { name: "Observe obligations", exact: true })
        .click();
      await p
        .getByRole("heading", { name: "Actual configured: passed" })
        .waitFor();
      await p.getByRole("button", { name: "changes", exact: true }).click();
      await p
        .getByRole("heading", {
          name: "Current checkout changes (not a captured historical diff)",
        })
        .waitFor();
      await p
        .getByText(/Fingerprint/)
        .first()
        .waitFor();
      await p.getByRole("button", { name: "review", exact: true }).click();
      await p.getByLabel("Episode to review").selectOption(started.runId);
      await p.getByLabel(/I acknowledge current unresolved issues/).check();
      await p
        .getByRole("button", { name: "Preview human review / Done" })
        .click();
      await published(await confirm("review"));
      await p
        .getByRole("button", { name: "Observe current state", exact: true })
        .click();
      if (route === "loopback") {
        const contacts = f.contacts();
        const prior = await f.client.session();
        assert.equal(prior.kind, "ok");
        const restarted = await f.restart();
        assert.notEqual(restarted.epoch, prior.value.epoch);
        assert.equal((await restarted.client.models()).value.selected, null);
        assert.equal(
          (await restarted.client.activeRuns()).value.runs.length,
          0,
        );
        await p.goto(f.tokenLink);
        await p.goto(`${f.endpoint}/app#task=${taskId}`);
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
        while (
          !(await p.locator(".gs-item").count()) &&
          Date.now() < deadline
        ) {
          const next = p.getByRole("button", {
            name: "Continue same snapshot search",
          });
          if (await next.count()) await next.click();
          else await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await p.locator(".gs-item").first().click();
        const detailDeadline = Date.now() + 15000;
        while (
          !(await p.locator(".detail-text mark").count()) &&
          Date.now() < detailDeadline
        ) {
          const next = p.getByRole("button", {
            name: "Continue validation",
            exact: true,
          });
          if (await next.count()) await next.click();
          else await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal(
          await p.locator(".detail-text mark").first().textContent(),
          "END-RETAINED",
        );
        assert.equal(
          f.contacts(),
          contacts,
          "cold readers/search never replay work or auth",
        );
        receipt.coldRestart = {
          priorEpoch: prior.value.epoch,
          epoch: restarted.epoch,
          taskId,
          runId: started.runId,
          exactHit: "END-RETAINED",
          contactsUnchanged: true,
        };
        await p.goto(`${f.endpoint}/app#task=${taskId}`);
      }
      for (const [scopeLabel, format] of [
        ["task", "ndjson"],
        ["task", "markdown"],
        ["run", "ndjson"],
        ["child", "markdown"],
      ]) {
        if (scopeLabel === "run")
          await p
            .getByRole("button", { name: "start settled", exact: true })
            .click();
        if (scopeLabel === "child")
          await p
            .getByRole("button", { name: "assignment-1 settled", exact: true })
            .click();
        await p.getByRole("button", { name: "Export selected scope" }).click();
        const dialog = p.getByRole("dialog");
        await dialog.getByLabel("Format").selectOption(format);
        const download = p.waitForEvent("download");
        await dialog
          .getByRole("button", { name: "Request selected-scope download" })
          .click();
        const d = await download;
        const path = join(root, `${scopeLabel}.${format}`);
        await d.saveAs(path);
        assert.equal(await d.failure(), null);
        const text = readFileSync(path, "utf8");
        assert(text.includes("END-RETAINED"));
        if (scopeLabel === "task") assert(text.includes("ACTUAL-PARENT-CHECK"));
        assert(
          text.includes('"kind":"trailer"') ||
            text.includes('"kind": "trailer"'),
        );
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
        const prefix = text.slice(0, marker);
        assert.equal(frame.event.kind, "trailer");
        assert.equal(frame.event.complete, true);
        assert.equal(frame.event.encodedBytes, Buffer.byteLength(prefix));
        assert.equal(
          frame.event.sha256,
          createHash("sha256").update(prefix).digest("hex"),
        );
        assert.equal(frame.event.frames, frame.ordinal - 1);
        if (format === "ndjson")
          assert.equal(prefix.trimEnd().split("\n").length, frame.event.frames);
        receipt.downloads.push({
          scope: scopeLabel,
          format,
          bytes: Buffer.byteLength(text),
          path,
        });
        await p.keyboard.press("Escape");
      }
      for (const [width, height] of [
        [1440, 900],
        [768, 1024],
        [390, 844],
        [320, 568],
      ]) {
        await p.setViewportSize({ width, height });
        if (width <= 900) {
          await p
            .getByRole("button", { name: "Plan / review", exact: true })
            .click();
          // Establish real drawer focus before dispatching Escape; click delivery
          // alone is not evidence that React's focus-containment effect ran.
          await p.waitForFunction(
            () =>
              document.activeElement?.closest(".drawer-right.open") !== null,
          );
          await p.keyboard.press("Escape");
          await p.waitForFunction(
            () => !document.querySelector(".panel-drawer.open"),
          );
          assert.equal(
            await p
              .getByRole("button", { name: "Plan / review", exact: true })
              .evaluate((button) => button === document.activeElement),
            true,
          );
        }
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        receipt.viewports.push({ width, height });
      }
      assert.deepEqual(receipt.errors, []);
      await f.rotate();
      await p
        .getByRole("button", { name: "Observe current state", exact: true })
        .click();
      await p
        .getByText(/explicit.*re-entry required/)
        .first()
        .waitFor();
      assert.equal(
        f.contacts(),
        3,
        "reconnect and rotation never replay mutations",
      );
      if (route === "https") {
        receipt.proxy = f.proxyFacts();
        assert(receipt.proxy.http > 0 && receipt.proxy.upgrades > 0);
        assert(
          (await one.cookies()).some(
            (cookie) => cookie.secure && cookie.httpOnly,
          ),
        );
      }
      receipt.passed = true;
    } catch (error) {
      failure = error;
      if (secondPage)
        writeFileSync(
          join(root, "second-failed-dom.html"),
          await secondPage.content(),
        );
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
          failure ??= Error("browser original close not zero");
      }
      receipt.passed &&= !failure;
      writeFileSync(
        join(root, "receipt.json"),
        JSON.stringify(receipt, null, 2),
      );
      console.log(
        JSON.stringify({
          receipt: join(root, "receipt.json"),
          passed: receipt.passed,
        }),
      );
    }
    if (failure) throw failure;
  }, 120000);
