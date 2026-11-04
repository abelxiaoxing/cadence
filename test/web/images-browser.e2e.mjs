// Real generated owner, SDK worker, Pi history and existing Chromium. Local provider only.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { acceptingFixture } from "../helpers/accepting-fixture.ts";
import { PNG, pngBytes } from "../helpers/images.ts";

it("built WebUI selects, pastes, drops and removes images; image-only ordinary/Cadence sends survive refresh and lost replies", async () => {
  if (!process.env.CADENCE_BROWSER_PATH)
    throw Error("CADENCE_BROWSER_PATH must name an existing browser");
  const root = mkdtempSync(join(tmpdir(), "image-browser-"));
  const f = await acceptingFixture("generated", undefined, null, {
    images: true,
  });
  f.reply("IMAGE-ANSWER");
  f.mode("pending");
  let browser, page;
  const errors = [],
    commands = [];
  try {
    browser = await chromium.launch({
      executablePath: process.env.CADENCE_BROWSER_PATH,
      headless: true,
      args: ["--no-sandbox"],
      env: { ...process.env, HOME: root, TMPDIR: root, TEMP: root, TMP: root },
    });
    page = await browser.newPage({
      locale: "en-US",
      viewport: { width: 1280, height: 850 },
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("request", (request) => {
      if (request.url().endsWith("/api/v1/workbench/command"))
        commands.push(request.postDataJSON().kind);
    });
    await page.goto(f.tokenLink);
    await page.getByRole("button", { name: "Model: Choose a model" }).click();
    await page.getByRole("option", { name: /^fixed/ }).click();
    await page.getByRole("button", { name: "Model: fixed · Off" }).waitFor();
    const picker = page.locator('input[type="file"]');
    const bomb = pngBytes();
    bomb.writeUInt32BE(16384, 16);
    bomb.writeUInt32BE(16384, 20);
    await picker.setInputFiles({
      name: "bomb.png",
      mimeType: "image/png",
      buffer: bomb,
    });
    await page
      .getByText("Invalid or oversized image.", { exact: true })
      .waitFor();
    expect(await page.locator(".chat-image-draft img").count()).toBe(0);
    await page.getByRole("button", { name: "Remove image: bomb.png" }).click();
    await picker.setInputFiles({
      name: "bad.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    });
    await page
      .getByText("Use PNG, JPEG or WebP images.", { exact: true })
      .waitFor();
    const rasters = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 2;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "red";
      ctx.fillRect(0, 0, 2, 2);
      return {
        jpeg: canvas.toDataURL("image/jpeg").split(",")[1],
        webp: canvas.toDataURL("image/webp").split(",")[1],
      };
    });
    await picker.setInputFiles({
      name: "chosen.png",
      mimeType: "image/png",
      buffer: pngBytes(),
    });
    await page
      .getByRole("button", { name: "Remove image: chosen.png" })
      .waitFor();
    await page
      .getByRole("textbox", { name: "Message" })
      .evaluate((element, base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const clipboardData = new DataTransfer();
        clipboardData.items.add(
          new File([bytes], "pasted.jpg", { type: "image/jpeg" }),
        );
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, rasters.jpeg);
    await page
      .getByRole("button", { name: "Remove image: pasted.jpg" })
      .waitFor();
    await page.locator(".chat-composer").evaluate((element, base64) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(
        new File(
          [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
          "dropped.webp",
          { type: "image/webp" },
        ),
      );
      element.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, rasters.webp);
    await page
      .getByRole("button", { name: "Remove image: dropped.webp" })
      .waitFor();
    await page
      .getByRole("button", { name: "Remove image: pasted.jpg" })
      .click();
    expect(await page.locator(".chat-image-draft").count()).toBe(2);
    expect(f.contacts()).toBe(0);
    expect(commands).not.toContain("image-upload");
    // Lose the admission response, after it reaches the owner. The UI observes
    // the command ID; it must never resubmit the pictures or the model request.
    let lost = false;
    await page.route("**/api/v1/workbench/command", async (route) => {
      if (!lost && route.request().postDataJSON().kind === "send") {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await page.getByAltText("Attached image", { exact: true }).nth(1).waitFor();
    await expect.poll(() => page.locator(".chat-image-draft").count()).toBe(0);
    await expect
      .poll(() => page.getByAltText("Attached image", { exact: true }).count())
      .toBe(2);
    await expect
      .poll(() =>
        page
          .getByAltText("Attached image", { exact: true })
          .evaluateAll((images) =>
            images.every((i) => i.complete && i.naturalWidth > 0),
          ),
      )
      .toBe(true);
    await expect.poll(() => f.held(), { timeout: 15000 }).toBe(1);
    expect(await page.getByText("IMAGE-ANSWER", { exact: true }).count()).toBe(
      0,
    );
    f.release();
    await page.getByText("IMAGE-ANSWER", { exact: true }).waitFor();
    expect(commands.filter((kind) => kind === "send")).toHaveLength(1);
    expect(f.contacts()).toBe(1);
    expect(JSON.stringify(f.observations[0].messages)).toContain(
      `data:image/png;base64,${PNG}`,
    );
    await page.reload();
    await page.getByText("IMAGE-ANSWER", { exact: true }).waitFor();
    await expect
      .poll(() => page.getByAltText("Attached image", { exact: true }).count())
      .toBe(2);
    f.mode("single");
    await page.getByRole("button", { name: "Cadence mode" }).click();
    await picker.setInputFiles({
      name: "cadence.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(rasters.jpeg, "base64"),
    });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByText("IMAGE-ANSWER", { exact: true }).nth(1).waitFor();
    await expect
      .poll(() => page.getByAltText("Attached image", { exact: true }).count())
      .toBe(3);
    expect(f.contacts()).toBe(2);
    expect(f.observations[1].tools).toContain("cadence_plan");
    expect(JSON.stringify(f.observations[0].messages)).toContain(
      "data:image/webp;base64,",
    );
    expect(JSON.stringify(f.observations[1].messages)).toContain(
      "data:image/jpeg;base64,",
    );
    await page.screenshot({
      path: join(root, "images-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Tasks", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const left = document
        .querySelector(".drawer-left")
        ?.getBoundingClientRect();
      const right = document
        .querySelector(".drawer-right")
        ?.getBoundingClientRect();
      return left && right && left.right <= 0 && right.left >= innerWidth;
    });
    await page.screenshot({
      path: join(root, "images-mobile.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    writeFileSync(
      join(root, "receipt.json"),
      JSON.stringify({ commands, contacts: f.contacts(), errors }, null, 2),
    );
    console.log(`Image browser evidence: ${root}`);
  } catch (error) {
    await page
      ?.screenshot({ path: join(root, "failure.png"), fullPage: true })
      .catch(() => {});
    writeFileSync(
      join(root, "failure.txt"),
      `${String(error)}\n${await page
        ?.locator("body")
        .innerText()
        .catch(() => "unavailable")}`,
    );
    throw error;
  } finally {
    await browser?.close();
    await f.close();
  }
}, 120000);
