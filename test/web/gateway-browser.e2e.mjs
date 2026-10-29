import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { it } from "vitest";
import { gatewayFixture } from "../helpers/gateway-fixture.ts";

it("unified loopback workbench: no default project, same-origin switching, ordinary chat and task navigation survive refresh", async () => {
  const g = await gatewayFixture();
  const root = mkdtempSync(join(tmpdir(), "gw-"));
  const paths = [join(g.f.dir, "browser-b"), join(g.f.dir, "browser-c")];
  for (const path of paths) mkdirSync(path, { mode: 0o700 });
  writeFileSync(
    join(paths[0], "project-b.txt"),
    "Project B, not a default workspace",
  );
  let browser, page;
  const errors = [];
  try {
    assert(process.env.CADENCE_BROWSER_PATH, "existing browser required");
    browser = await chromium.launch({
      executablePath: process.env.CADENCE_BROWSER_PATH,
      headless: true,
      env: {
        PATH: process.env.PATH,
        HOME: g.browserHome ?? root,
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
    await page.goto(g.link);
    await page.getByText("What would you like to work on?").waitFor();
    assert(!existsSync(join(g.home, "cadence")));
    assert.equal(g.f.contacts(), 0);
    assert.equal(g.store.projects().length, 0);
    assert(
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .isDisabled(),
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Create task", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByText("Recent projects", { exact: true }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Open working folder", exact: true })
      .waitFor();
    assert.equal(
      g.store.projects().length,
      0,
      "New conversation only offers folder selection",
    );
    const openProject = page.getByRole("button", {
      name: "Open this folder",
      exact: true,
    });
    const waitForObservedFolder = () =>
      page.waitForFunction(() =>
        [...document.querySelectorAll("dialog button")].some(
          (button) =>
            button.textContent === "Open this folder" && !button.disabled,
        ),
      );
    await waitForObservedFolder();
    assert.equal(
      await page.getByRole("button", { name: "Browse", exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "Edit path", exact: true }).click();
    const folderPath = page.getByRole("textbox", { name: "Folder path" });
    await folderPath.fill(paths[0]);
    assert.equal(
      await page.locator(".cwd-target code").textContent(),
      paths[0],
      "Open names the typed path, not the previously listed folder",
    );
    let directoryReads = 0;
    let releaseRead;
    const heldRead = new Promise((resolve) => {
      releaseRead = resolve;
    });
    const directoriesRoute = "**/workbench/v1/directories?*";
    await page.route(directoriesRoute, async (request) => {
      if (
        new URL(request.request().url()).searchParams.get("path") !== paths[0]
      )
        return request.continue();
      directoryReads++;
      if (directoryReads === 1)
        return request.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            kind: "error",
            error: { code: "unavailable" },
          }),
        });
      if (directoryReads === 3) await heldRead;
      return request.continue();
    });
    // Open of a typed path observes it first; a failed read opens nothing
    // and keeps both the typed path and the previous listing in view.
    await openProject.click();
    await page
      .getByRole("alert")
      .filter({ hasText: "could not be read right now" })
      .waitFor();
    assert.equal(directoryReads, 1);
    assert.equal(g.store.projects().length, 0);
    assert.equal(await folderPath.inputValue(), paths[0]);
    assert(
      await page
        .getByRole("button", { name: "Parent folder", exact: true })
        .isVisible(),
    );
    // Enter retries the same readonly observation, never Open.
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("directories") &&
          new URL(r.url()).searchParams.get("path") === paths[0] &&
          r.status() === 200,
      ),
      folderPath.press("Enter"),
    ]);
    await waitForObservedFolder();
    assert.equal(directoryReads, 2);
    assert.equal(g.store.projects().length, 0);
    const here = page.locator('.cwd-crumbs [aria-current="location"]');
    assert.equal(await here.textContent(), "browser-b");
    try {
      await Promise.all([
        page.waitForRequest(
          (request) =>
            request.url().includes("directories") &&
            new URL(request.url()).searchParams.get("path") === paths[0],
        ),
        here.click(),
      ]);
      assert(
        await openProject.isDisabled(),
        "refreshing a previously successful listing must fence Open until it settles",
      );
    } finally {
      releaseRead();
    }
    await waitForObservedFolder();
    assert.equal(directoryReads, 3);
    await page.unroute(directoriesRoute);
    assert.equal(g.store.projects().length, 0);
    assert.equal(g.f.contacts(), 0);
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole("button", { name: "Tasks", exact: true }).click();
      await page.waitForFunction(() => {
        const panel = document.querySelector(".drawer-left");
        return (
          panel?.classList.contains("open") &&
          panel.contains(document.activeElement)
        );
      });
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () =>
          !document.querySelector(".drawer-left")?.classList.contains("open"),
      );
      await page.getByRole("button", { name: "Files", exact: true }).click();
      await page.waitForFunction(() =>
        document
          .querySelector(".drawer-right")
          ?.contains(document.activeElement),
      );
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Switch working folder", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Open working folder", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await page.locator("dialog[open]").waitFor({ state: "hidden" });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      const folder = await page.locator(".status-cwd").boundingBox();
      assert(folder && folder.x + folder.width > width - 20 && folder.y > 780);
      await page.screenshot({ path: join(root, `no-project-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(g.store.projects().length, 0);
    assert.equal(g.f.contacts(), 0);
    // Visibility/font readiness can precede Chromium's first composited
    // surface. Observe painted frames before capture, without retrying Open
    // or swallowing a failed screenshot (same frame barrier as assets-browser).
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    await page.screenshot({ path: join(root, "no-project.png") });
    async function open(path) {
      await page
        .getByRole("button", { name: "Switch working folder", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Edit path", exact: true })
        .click();
      await page.getByRole("textbox", { name: "Folder path" }).fill(path);
      // One explicit Open: a fresh readonly observation, then that folder.
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes("directories") &&
            r.url().includes(encodeURIComponent(path)) &&
            r.status() === 200,
        ),
        page
          .getByRole("button", { name: "Open this folder", exact: true })
          .click(),
      ]);
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .waitFor();
      await page.locator("dialog[open]").waitFor({ state: "hidden" });
      assert.equal(new URL(page.url()).origin, g.endpoint);
      assert(!page.url().includes("token="));
    }
    if (process.platform !== "win32") {
      const lock = join(g.f.c.registryDirectory, "registry.lock");
      const writer = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
          import { writeFileSync } from "node:fs";
          import { hostname } from "node:os";
          import { randomUUID } from "node:crypto";
          writeFileSync(process.argv[1], JSON.stringify({schema: "cadence-service-registry-lock/1", token: randomUUID(), pid: process.pid, host: hostname()}), {flag: "wx", mode: 0o600});
        `,
          lock,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      assert.equal(writer.status, 0, writer.stderr);
      await page
        .getByRole("button", { name: "Switch working folder", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Edit path", exact: true })
        .click();
      await page.getByRole("textbox", { name: "Folder path" }).fill(paths[0]);
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes("directories") &&
            r.url().includes(encodeURIComponent(paths[0])) &&
            r.status() === 200,
        ),
        page
          .getByRole("button", { name: "Open this folder", exact: true })
          .click(),
      ]);
      await page
        .getByRole("alert")
        .filter({ hasText: "The shared registry lock is blocking projects." })
        .waitFor();
      assert(
        (await page.getByRole("alert").textContent()).includes(
          "cadence recover inspect",
        ),
      );
      assert.equal(g.store.projects().length, 0);
      assert.equal(g.f.contacts(), 0);
      const receipt = join(root, "registry-pty-receipt.json"),
        config = join(root, "registry-pty.json");
      writeFileSync(
        config,
        JSON.stringify({
          mode: "resolve",
          epoch: g.f.c.inspectRegistryRecovery().epoch,
          receipt,
          cwd: root,
          env: { ...process.env, HOME: root, USERPROFILE: root },
          argv: [
            process.execPath,
            join(process.cwd(), "src/service-cli.mjs"),
            "recover",
            "resolve",
            "--workspace",
            g.f.c.store.root,
            "--state-home",
            g.f.c.stateHome,
          ],
        }),
        { mode: 0o600 },
      );
      const driver = spawnSync(
        "python3",
        ["test/helpers/recovery-pty.py", config],
        { encoding: "utf8", timeout: 90000 },
      );
      assert.equal(driver.status, 0, driver.stderr);
      assert.deepEqual(JSON.parse(readFileSync(receipt, "utf8")), {
        waitpidReturned: true,
        exitCode: 0,
        forced: false,
        fault: null,
      });
      assert(!existsSync(lock));
      assert.equal(
        g.store.projects().length,
        0,
        "recovery does not replay Open",
      );
      await page
        .getByRole("button", {
          name: "Close dialog — no cancellation of accepted work",
        })
        .click();
    }
    await open(paths[0]);
    const projectB = new URL(page.url()).searchParams.get("project");
    assert(projectB);
    await page.getByRole("button", { name: "Choose owner model" }).click();
    await page
      .getByLabel("Exact model / API / thinking")
      .selectOption({ label: "fixture/fixed · openai-completions · off" });
    await page
      .getByRole("button", { name: "Confirm owner model choice" })
      .click();
    await page.locator("dialog[open]").waitFor({ state: "hidden" });
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Ordinary conversation in project B");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .locator(".chat-message.assistant")
      .getByText(/Advisory:/)
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".chat-workspace .conversation-header .ep-state")
          ?.textContent === "completed",
    );
    assert.equal(g.f.contacts(), 1);
    await page.screenshot({ path: join(root, "project-b.png") });
    await open(paths[1]);
    assert.notEqual(new URL(page.url()).searchParams.get("project"), projectB);
    assert.equal(g.f.contacts(), 1);
    // Recent projects live in the lower-right picker. One click on a recent
    // entry is its explicit Open, even while the picker's first read is
    // still pending, and the original chat returns.
    let pendingReads = 0;
    let releaseFirstRead;
    const firstRead = new Promise((resolve) => {
      releaseFirstRead = resolve;
    });
    const anyDirectories = (url) => url.href.includes("directories");
    await page.route(anyDirectories, async (request) => {
      if (pendingReads++ === 0) await firstRead;
      // The superseded first read may already be aborted by the client.
      await request.continue().catch(() => {});
    });
    try {
      await Promise.all([
        page.waitForRequest((request) =>
          anyDirectories(new URL(request.url())),
        ),
        page
          .getByRole("button", { name: "Switch working folder", exact: true })
          .click(),
      ]);
      await page
        .getByRole("region", { name: "Recent projects", exact: true })
        .getByRole("button", { name: paths[0], exact: true })
        .click();
      await page.locator("dialog[open]").waitFor({ state: "hidden" });
    } finally {
      releaseFirstRead();
      await page.unroute(anyDirectories);
    }
    assert.equal(pendingReads, 2);
    await page
      .locator(".chat-message.assistant")
      .getByText(/Advisory:/)
      .waitFor();
    assert.equal(new URL(page.url()).searchParams.get("project"), projectB);
    await page.reload();
    await page
      .locator(".chat-message.assistant")
      .getByText(/Advisory:/)
      .waitFor();
    assert.equal(g.f.contacts(), 1);
    const chatUrl = page.url();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("/cadence A task in the unified workbench");
    await page
      .getByRole("button", { name: "Prepare task", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Preview Create (does not Start)",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Confirm create", exact: true })
      .click();
    await page.getByLabel("Readable plan", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("project"), projectB);
    assert.equal(g.f.contacts(), 1, "Create is not Start");
    await page.reload();
    await page
      .getByRole("button", {
        name: "Back to ordinary conversation",
        exact: true,
      })
      .click();
    await page
      .locator(".chat-message.assistant")
      .getByText(/Advisory:/)
      .waitFor();
    assert.equal(page.url(), chatUrl);
    // An unselected entry returns to the last project while its owner runs.
    // That is navigation, not Open: no association, contact or Send is added.
    const associated = g.store.projects().length;
    await page.goto(`${g.endpoint}/app`);
    await page
      .locator(".panel-left .session-item")
      .filter({ hasText: "Ordinary conversation in project B" })
      .waitFor();
    assert.equal(new URL(page.url()).searchParams.get("project"), projectB);
    assert.equal(g.store.projects().length, associated);
    assert.equal(g.f.contacts(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(root, "project-390.png") });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    assert(!existsSync(join(g.home, "cadence")));
    writeFileSync(
      join(root, "receipt.json"),
      JSON.stringify({
        uiPassed: true,
        errors,
        contacts: g.f.contacts(),
        sameOrigin: true,
        noDefaultWorkspace: true,
        paidProvider: false,
      }),
    );
  } catch (error) {
    await page?.screenshot({ path: join(root, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    await g.close();
  }
}, 120000);
