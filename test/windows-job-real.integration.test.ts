import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { executionProfile } from "../src/execution-profile.ts";

const { probeWindowsJob, WindowsJobBackend } = (await import(
  process.env.CADENCE_NATIVE_PACKAGE_ROOT
    ? pathToFileURL(
        path.join(
          process.env.CADENCE_NATIVE_PACKAGE_ROOT,
          "src/windows-job-backend.ts",
        ),
      ).href
    : new URL("../src/windows-job-backend.ts", import.meta.url).href
)) as typeof import("../src/windows-job-backend.ts");

import { exerciseNativeImplement } from "./helpers/native-implement.ts";

const roots: string[] = [];
const temporary = () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence Windows 中文 "));
  roots.push(root);
  return root;
};
afterEach(() => {
  vi.unstubAllEnvs();
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  });
});
const helper = executionProfile({
  ...process.env,
  ABEL_EXECUTION_MODE: "host-trusted",
}).windowsHelperPath!;
const environment = () => ({
  SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
  PATH: path.dirname(process.execPath),
});
describe.skipIf(process.env.CADENCE_REAL_WINDOWS_JOB !== "1")(
  "actual Windows x64 Job backend",
  () => {
    beforeAll(() => {
      expect(process.platform).toBe("win32");
      expect(process.arch).toBe("x64");
      expect(probeWindowsJob(helper)).toBe(true);
    });
    it("preserves Unicode, spaces, empty and quoted argv and the actual root exit code", async () => {
      const root = temporary();
      const args = ["", "路径 with spaces", 'a"b', "end\\"];
      const result = await new WindowsJobBackend({ helperPath: helper }).run({
        root,
        executable: process.execPath,
        args: [
          "-e",
          `require('node:assert/strict').deepEqual(process.argv.slice(1), ${JSON.stringify(args)}); process.stdout.write('目标-RED'); process.exit(17)`,
          ...args,
        ],
        environment: environment(),
        outputWitness: "目标-RED",
      });
      expect(result).toMatchObject({
        ok: true,
        exitCode: 17,
        outputWitnessMatched: true,
      });
    });
    it.each(["timeout", "cancel", "root-exit"])(
      "settles detached descendants on %s before reporting or returning",
      async (cause) => {
        const root = temporary(),
          marker = path.join(root, "child.pid");
        const controller = new AbortController();
        writeFileSync(
          path.join(root, "child.cjs"),
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(()=>{},1000);`,
        );
        const result = new WindowsJobBackend({
          helperPath: helper,
          timeoutMs: 1500,
        }).run({
          root,
          executable: process.execPath,
          args: [
            "-e",
            "require('node:child_process').spawn(process.execPath,['child.cjs'],{detached:true,stdio:'ignore'}).unref();" +
              (cause === "root-exit" ? "" : "setInterval(()=>{},1000)"),
          ],
          environment: environment(),
          signal: controller.signal,
        });
        const deadline = Date.now() + 1000;
        while (!existsSync(marker) && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 20));
        expect(existsSync(marker)).toBe(true);
        if (cause === "cancel") controller.abort();
        expect(await result).toMatchObject(
          cause === "cancel"
            ? { ok: false, state: "cancelled" }
            : { ok: false, code: "isolation-execution-timeout" },
        );
        const pid = Number(readFileSync(marker, "utf8"));
        expect(() => process.kill(pid, 0)).toThrow();
      },
      15000,
    );
    it.each(["control-loss", "helper-loss"])(
      "contains descendants after %s without inventing product evidence",
      async (cause) => {
        const root = temporary(),
          marker = path.join(root, "child.pid");
        let helperProcess: ReturnType<typeof spawn> | undefined;
        const spawnProcess: typeof spawn = ((
          ...args: Parameters<typeof spawn>
        ) => {
          helperProcess = spawn(...args);
          return helperProcess;
        }) as typeof spawn;
        const result = new WindowsJobBackend({
          helperPath: helper,
          timeoutMs: 10000,
          spawnProcess,
        }).run({
          root,
          executable: process.execPath,
          args: [
            "-e",
            `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid));setInterval(()=>{},1000)`,
          ],
          environment: environment(),
        });
        const deadline = Date.now() + 5000;
        while (!existsSync(marker) && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 20));
        expect(existsSync(marker)).toBe(true);
        if (cause === "helper-loss") helperProcess?.kill();
        else helperProcess?.stdin?.end();
        expect(await result).toMatchObject(
          cause === "helper-loss"
            ? { ok: false, code: "isolation-termination-unconfirmed" }
            : { ok: false, code: "cancelled" },
        );
        const pid = Number(readFileSync(marker, "utf8"));
        let alive = true;
        const stopDeadline = Date.now() + 5000;
        while (alive && Date.now() < stopDeadline) {
          try {
            process.kill(pid, 0);
            await new Promise((resolve) => setTimeout(resolve, 20));
          } catch {
            alive = false;
          }
        }
        expect(alive).toBe(false);
      },
      20000,
    );
    it("executes baseline, Red, Green, reopen, cumulative, apply and post-apply with native verification", async () => {
      await exerciseNativeImplement("host-trusted", temporary);
    }, 60000);
  },
);
