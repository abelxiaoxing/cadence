// Explicit readonly built-asset/auth/CSP fixture. No W4 actions or browser workflow claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { it } from "vitest";
import { ServiceHttpServer } from "../../src/service/http.ts";
import { loadWebAssets } from "../../src/service-assets.ts";
import { httpFixture } from "../helpers/service-http-fixture.ts";

it("actual built assets, two isolated readonly contexts and CSP (no execution workflow)", async () => {
  const executablePath = process.env.CADENCE_BROWSER_PATH;
  if (!executablePath) throw new Error("explicit-existing-browser-required");
  const root = mkdtempSync(join(tmpdir(), "b-"));
  const { manifest, assets } = loadWebAssets(resolve("web/dist"));
  const fixture = await httpFixture();
  const session = fixture.projection.session;
  fixture.projection.session = async () => {
    const value = await session();
    return {
      ...value,
      capabilities: {
        ...value.capabilities,
        actions: false,
        manualChecks: false,
      },
    };
  };
  const server = new ServiceHttpServer({
    policy: {
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 0,
      proxy: null,
    },
    auth: fixture.auth,
    adapters: fixture.adapters,
    assets,
  });
  let browser;
  let failure;
  const receipt = {
    scope: "built-empty-workspace/auth/assets/CSP-only",
    executionWorkflow: false,
    physicalHuman: false,
    buildId: manifest.buildId,
    browserVersion: null,
    passed: false,
    contexts: 0,
    fonts: [],
    timelineModuleImported: false,
    cspDirectives: [],
    returnedWithoutCancel: false,
  };
  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    void browser?.close().catch(() => {});
  }, 110000);
  try {
    const origin = await server.listen();
    server.admit();
    const env = Object.fromEntries(
      ["PATH", "SystemRoot", "WINDIR", "LANG"]
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    );
    Object.assign(env, {
      HOME: root,
      USERPROFILE: root,
      TMPDIR: root,
      TEMP: root,
      TMP: root,
    });
    browser = await chromium.launch({ executablePath, headless: true, env });
    receipt.browserVersion = browser.version();
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport });
      context.setDefaultTimeout(15000);
      await context.route("**/*", (route) =>
        route.request().url().startsWith(`${origin}/`)
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      const paths = [],
        errors = [];
      page.on("request", (req) => {
        paths.push({ method: req.method(), path: new URL(req.url()).pathname });
      });
      page.on("pageerror", (error) => errors.push(error.name));
      await page.addInitScript(() => {
        window.cspDirectives = [];
        document.addEventListener("securitypolicyviolation", (event) =>
          window.cspDirectives.push(event.effectiveDirective),
        );
      });
      assert.equal((await page.goto(`${origin}/app`)).status(), 401);
      const sessionReply = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/v1/session",
      );
      await page.goto(fixture.material.tokenLink(origin));
      await page
        .getByRole("heading", { name: "Cadence", exact: true })
        .waitFor();
      assert.equal((await sessionReply).status(), 200);
      assert.equal(new URL(page.url()).search, "");
      assert.equal(await page.evaluate(() => localStorage.length), 0);
      assert.equal(await page.evaluate(() => document.cookie), "");
      const observed = await page.evaluate(async () => {
        const module = document.createElement("script");
        module.type = "module";
        module.src = "/assets/vis-timeline.js";
        await new Promise((resolve, reject) => {
          module.onload = resolve;
          module.onerror = reject;
          document.head.append(module);
        });
        const fonts = [];
        for (const ext of ["woff2", "woff", "ttf"]) {
          const font = new FontFace(
            `fixture-${ext}`,
            `url(/assets/KaTeX_Main-Regular.${ext})`,
          );
          await font.load();
          document.fonts.add(font);
          fonts.push(font.status);
        }
        const before = [...window.cspDirectives];
        const numeric = document.createElement("div");
        numeric.setAttribute("style", "width:44px");
        document.body.append(numeric);
        const width = getComputedStyle(numeric).width;
        numeric.remove();
        const badScript = document.createElement("script");
        badScript.textContent = "window.inlineExecuted=true";
        document.body.append(badScript);
        const badStyle = document.createElement("style");
        badStyle.textContent = "body{--untrusted-style:bad}";
        document.body.append(badStyle);
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return {
          fonts,
          before,
          width,
          directives: [...window.cspDirectives],
          inlineExecuted: window.inlineExecuted === true,
          untrustedStyle: getComputedStyle(document.body).getPropertyValue(
            "--untrusted-style",
          ),
        };
      });
      assert.deepEqual(observed.before, []);
      assert.equal(observed.width, "44px");
      assert.deepEqual(observed.fonts, ["loaded", "loaded", "loaded"]);
      assert.equal(observed.inlineExecuted, false);
      assert.equal(observed.untrustedStyle, "");
      assert(observed.directives.includes("script-src-elem"));
      assert(observed.directives.includes("style-src-elem"));
      await page
        .getByRole("button", { name: "Return — work continues" })
        .click();
      await page
        .getByRole("heading", { name: "Detached", exact: true })
        .waitFor();
      const atReturn = paths.length;
      // Bounded absence observation across the known one-second observation tick,
      // not readiness or a universal no-future-work guarantee.
      await page.waitForTimeout(1200);
      assert.equal(paths.length, atReturn);
      assert(!paths.some((p) => /commands|preflight|cancel/.test(p.path)));
      assert.deepEqual(errors, []);
      receipt.contexts++;
      receipt.fonts = observed.fonts;
      receipt.timelineModuleImported = true;
      receipt.cspDirectives = observed.directives;
      receipt.returnedWithoutCancel = true;
      await context.close();
    }
    assert.equal(timedOut, false);
    receipt.passed = true;
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(watchdog);
    const cleanup = [];
    for (const close of [
      () => browser?.close(),
      () => server.close(),
      () => fixture.server.close(),
    ]) {
      try {
        await close();
        cleanup.push(true);
      } catch {
        cleanup.push(false);
        failure ??= new Error("browser-fixture-cleanup-unconfirmed");
      }
    }
    receipt.cleanup = cleanup;
    receipt.passed = receipt.passed && cleanup.every(Boolean);
    try {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(executablePath))
        hash.update(chunk);
      receipt.executableSha256 = hash.digest("hex");
      writeFileSync(
        join(root, "receipt.json"),
        `${JSON.stringify(receipt, null, 2)}\n`,
        { mode: 0o600 },
      );
    } catch {
      failure ??= new Error("browser-fixture-diagnostics-unavailable");
    }
    console.log(
      JSON.stringify({
        receipt: join(root, "receipt.json"),
        passed: receipt.passed,
      }),
    );
  }
  if (failure) throw failure;
}, 120000);

it("built readonly history, exact Unicode/full copy, timeline and drawers across four viewports (injected records)", async () => {
  const { readonlyWorkspace } = await import("./readonly-browser-fixture.tsx");
  const { readFileSync } = await import("node:fs");
  const executablePath = process.env.CADENCE_BROWSER_PATH;
  if (!executablePath) throw new Error("explicit-existing-browser-required");
  const root = mkdtempSync(join(tmpdir(), "r-"));
  const fixture = await httpFixture(),
    data = readonlyWorkspace(fixture);
  const { assets, manifest } = loadWebAssets(resolve("web/dist"));
  const server = new ServiceHttpServer({
    policy: {
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 0,
      proxy: null,
    },
    auth: fixture.auth,
    adapters: fixture.adapters,
    assets,
  });
  let browser, failure;
  let debugPage;
  const receipt = {
    scope: "built-readonly-DOM/injected-records",
    buildId: manifest.buildId,
    executionWorkflow: false,
    durableArchive: false,
    physicalHuman: false,
    passed: false,
    layouts: [],
    nativeDownloads: [],
    originalBrowserExit: "unobserved",
    descendantClosure: "unqualified",
  };
  try {
    const origin = await server.listen();
    server.admit();
    browser = await chromium.launch({
      executablePath,
      headless: true,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        USERPROFILE: root,
        TMPDIR: root,
        TEMP: root,
        TMP: root,
      },
    });
    receipt.browserVersion = browser.version();
    for (const viewports of [
      [
        { width: 1440, height: 900 },
        { width: 768, height: 1024 },
      ],
      [
        { width: 390, height: 844 },
        { width: 320, height: 568 },
      ],
    ]) {
      const context = await browser.newContext({
        viewport: viewports[0],
        permissions: ["clipboard-read", "clipboard-write"],
        reducedMotion: "reduce",
      });
      context.setDefaultTimeout(15000);
      const external = [],
        controls = [],
        errors = [];
      await context.route("**/*", (route) => {
        if (!route.request().url().startsWith(`${origin}/`)) {
          external.push("external");
          return route.abort();
        }
        if (
          /\/(commands|preflight|cancel)(?:\?|$)/.test(
            new URL(route.request().url()).pathname,
          )
        )
          controls.push("control");
        return route.continue();
      });
      const page = await context.newPage();
      debugPage = page;
      page.on("pageerror", (error) => errors.push(error.name));
      await page.goto(fixture.material.tokenLink(origin));
      await page
        .getByRole("heading", { name: "Cadence", exact: true })
        .waitFor();
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        if (viewport.width <= 900)
          await page
            .getByRole("button", { name: "Tasks", exact: true })
            .click();
        await page
          .getByRole("button", { name: /Readonly Unicode fixture/ })
          .click();
        await page
          .getByRole("button", { name: "Inspect message", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Continue validation", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Markdown page", exact: true })
          .click();
        await page.locator(".katex").first().waitFor();
        assert.equal(
          await page
            .locator(
              "[data-retained-field] img, [data-retained-field] script, [data-retained-field] style",
            )
            .count(),
          0,
        );
        assert.equal(await page.evaluate(() => window.untrusted), undefined);
        await page
          .getByRole("button", {
            name: "Search all retained pages in selected scope",
          })
          .first()
          .click();
        const query = page.getByRole("textbox", {
          name: "Case-sensitive literal query",
        });
        await query.fill("a".repeat(1025));
        await page
          .getByText("Query must be 1–1024 UTF-8 bytes; it was not clipped.", {
            exact: false,
          })
          .waitFor();
        await query.fill("🚀");
        await page.getByText(/not finished/).waitFor();
        await page
          .getByRole("button", { name: "Continue same snapshot search" })
          .click();
        await page.locator(".gs-item").click();
        await page
          .getByRole("button", { name: "Continue validation", exact: true })
          .click();
        await page.locator(".detail-text mark").waitFor();
        assert.equal(
          await page.locator(".detail-text mark").textContent(),
          "🚀",
        );
        assert(
          (await page.locator(".coverage").last().textContent()).includes(
            "limited",
          ),
        );
        await page
          .getByRole("button", { name: "Copy full retained field" })
          .click();
        await page.getByText(/Copied all retained field bytes/).waitFor();
        assert.equal(
          await page.evaluate(() => navigator.clipboard.readText()),
          data.text,
        );
        await page
          .getByRole("button", { name: "timeline", exact: true })
          .click();
        await page.locator(".rtr .vis-timeline").waitFor();
        await page.locator(".rtr-row").first().focus();
        await page.keyboard.press("Enter");
        await page.waitForFunction(() =>
          document
            .querySelector(".rtr-row.sel")
            ?.textContent?.includes("#1 ready"),
        );
        assert.equal(
          await page
            .locator(".rtr-row")
            .first()
            .evaluate((el) => el === document.activeElement),
          true,
          "timeline selection must retain keyboard focus",
        );
        const dimensions = await page.evaluate(() => ({
          list: document.querySelector(".rtr-list").clientHeight,
          detail: document.querySelector(".rtr-detail").clientHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
        assert(
          dimensions.list >= 80 && dimensions.detail >= 80,
          `timeline readable regions: ${JSON.stringify(dimensions)}`,
        );
        assert.equal(dimensions.overflow, false);
        await page.locator('.rtr-dtab[data-tab="raw"]').click();
        await page
          .getByText(
            "Recorded event metadata; long fields are independently paged.",
          )
          .waitFor();
        await page
          .getByRole("button", { name: "▶ Visual replay", exact: true })
          .click();
        await page.locator(".rtr-replaybar input[type=range]").fill("1");
        await page
          .getByRole("button", { name: "⏹ Exit replay", exact: true })
          .click();
        if (viewport.width <= 900) {
          const opener = page.getByRole("button", {
            name: "Plan / review",
            exact: true,
          });
          await opener.click();
          const geometry = await page
            .locator(".drawer-right")
            .evaluate((el) => ({
              outer: el.clientWidth,
              inner: el.querySelector(".panel").clientWidth,
              duration: getComputedStyle(el).transitionDuration,
            }));
          assert.equal(geometry.inner, geometry.outer);
          assert.equal(geometry.duration, "0s");
          await page.keyboard.press("Escape");
          assert.equal(
            await opener.evaluate((el) => el === document.activeElement),
            true,
          );
        }
        receipt.layouts.push({ ...viewport, ...dimensions });
      }
      await page
        .getByRole("button", { name: "Export selected scope", exact: true })
        .click();
      await page.getByLabel("Format").selectOption("markdown");
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: /Request .*download/ }).click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /\.md$/);
      const path = join(root, `download-${receipt.nativeDownloads.length}.md`);
      await download.saveAs(path);
      assert.equal(await download.failure(), null);
      const body = readFileSync(path, "utf8");
      assert.match(body, /cadence-public-export\/2/);
      // The tiny fixture export has two exact Markdown frames. Validate the
      // observed downloaded footer/prefix independently; UI still says unverified.
      const blocks = [...body.matchAll(/\n\n```json\n([^\n]+)\n```\n/g)];
      assert.equal(blocks.length, 2);
      const last = blocks[1],
        trailer = JSON.parse(last[1]).event;
      assert.equal(last.index + last[0].length, body.length);
      assert.equal(trailer.kind, "trailer");
      assert.equal(trailer.complete, true);
      assert.equal(trailer.frames, 1);
      const prefix = body.slice(0, last.index);
      assert.equal(trailer.encodedBytes, Buffer.byteLength(prefix));
      assert.equal(
        trailer.sha256,
        createHash("sha256").update(prefix).digest("hex"),
      );
      await page.getByText(/completion not verified/i).waitFor();
      receipt.nativeDownloads.push({
        filename: download.suggestedFilename(),
        bytes: Buffer.byteLength(body),
        sha256: createHash("sha256").update(body).digest("hex"),
        fixtureExporter: true,
        uiClaim: "requested-unverified",
      });
      await page.keyboard.press("Escape");
      assert.deepEqual(external, []);
      assert.deepEqual(controls, []);
      assert.deepEqual(errors, []);
      // A missing local vendor degrades visibly; it does not erase retained data
      // or cause CDN loading. A fresh document avoids the prior module cache.
      const degraded = await context.newPage();
      await degraded.setViewportSize({ width: 1440, height: 900 });
      await degraded.route("**/assets/vis-timeline.js", (route) =>
        route.abort(),
      );
      await degraded.goto(`${origin}/app`);
      await degraded
        .getByRole("button", { name: /Readonly Unicode fixture/ })
        .click();
      await degraded
        .getByRole("button", { name: "timeline", exact: true })
        .click();
      await degraded
        .getByText(
          /Local timeline vendor unavailable — degraded ordinal preview only/,
        )
        .waitFor();
      assert.equal(await degraded.locator(".rtr-row").count(), 3);
      await degraded.close();
      await context.close();
    }
    receipt.passed = true;
  } catch (error) {
    failure = error;
    try {
      writeFileSync(
        join(root, "readonly-failure.txt"),
        (await debugPage.locator("body").innerText()).slice(0, 50000),
        { mode: 0o600 },
      );
      await debugPage.screenshot({ path: join(root, "readonly-failure.png") });
    } catch {}
  } finally {
    receipt.cleanup = [];
    for (const close of [
      () => browser?.close(),
      () => server.close(),
      () => fixture.server.close(),
    ]) {
      try {
        await close();
        receipt.cleanup.push(true);
      } catch {
        receipt.cleanup.push(false);
        failure ??= new Error("cleanup-unconfirmed");
      }
    }
    receipt.passed = receipt.passed && receipt.cleanup.every(Boolean);
    writeFileSync(
      join(root, "receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o600 },
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
