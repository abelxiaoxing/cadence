// CDP pipe (no debug port, no package runner). Only an installed binary and a
// new private profile. In particular, never add --no-sandbox for automation.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { access, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
export async function executable() {
  const cache = join(process.env.HOME, ".cache/ms-playwright");
  const paths = process.env.OPTICAL_CHROME
    ? [resolve(process.env.OPTICAL_CHROME)]
    : [
        ...(await readdir(cache).catch(() => []))
          .filter((n) => /^chromium-\d+$/.test(n))
          .sort()
          .reverse()
          .map((n) => join(cache, n, "chrome-linux64/chrome")),
        "/usr/bin/chromium",
        "/usr/bin/google-chrome",
      ];
  for (const p of paths)
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {}
  throw Error(
    "Installed Chromium unavailable: set OPTICAL_CHROME to a local executable. No download attempted.",
  );
}
export async function browser(root) {
  const bin = await executable(),
    home = await mkdtemp(join(root, "optical-browser-"));
  // Chromium binds a Unix socket below TMPDIR. A descriptor-relative spelling
  // keeps that pathname short without moving any bytes outside this private home.
  const handle = process.platform === "linux" ? await open(home, "r") : null;
  const temp = handle ? `/proc/${process.pid}/fd/${handle.fd}` : home;
  const child = spawn(
    bin,
    [
      "--headless",
      "--remote-debugging-pipe",
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
      "--disable-sync",
      "--proxy-server=http://127.0.0.1:1",
      `--user-data-dir=${join(home, "profile")}`,
      "about:blank",
    ],
    {
      cwd: home,
      env: {
        HOME: home,
        TMPDIR: temp,
        TEMP: temp,
        TMP: temp,
        PATH: process.env.PATH,
        XDG_RUNTIME_DIR: home,
      },
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    },
  );
  let id = 0,
    buffer = "",
    log = "";
  const pending = new Map(),
    listen = new Map();
  const exited = once(child, "close");
  exited.catch(() => {});
  child.stderr.on("data", (b) => {
    log = (log + b).slice(-1200);
  });
  child.stdio[4].on("error", () => {});
  child.stdio[3].on("error", () => {});
  child.stdio[4].setEncoding("utf8").on("data", (data) => {
    buffer += data;
    for (let n = buffer.indexOf("\0"); n !== -1; n = buffer.indexOf("\0")) {
      const m = JSON.parse(buffer.slice(0, n));
      buffer = buffer.slice(n + 1);
      if (m.id) pending.get(m.id)?.(m);
      else listen.get(m.method)?.(m.params);
    }
  });
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const seq = ++id;
      const timer = setTimeout(() => {
        pending.delete(seq);
        reject(Error(`${method} unavailable: ${log}`));
      }, 15000);
      pending.set(seq, (m) => {
        clearTimeout(timer);
        pending.delete(seq);
        if (m.error) reject(Error(`${method}: ${m.error.message}`));
        else resolve(m.result);
      });
      child.stdio[3].write(
        JSON.stringify({ id: seq, method, params, sessionId }) + "\0",
      );
    });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null)
      await call("Browser.close").catch(() => child.kill());
    await exited.catch(() => {});
    await handle?.close();
    await rm(home, { force: true, recursive: true });
  };
  try {
    const version = await call("Browser.getVersion");
    const { targetId } = await call("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await call("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const send = (method, params) => call(method, params, sessionId);
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (exceptionDetails)
        throw Error(
          exceptionDetails.exception?.description ?? exceptionDetails.text,
        );
      return result.value;
    };
    await send("Page.enable");
    return {
      version,
      call,
      targetId,
      send,
      evaluate,
      close,
      on: (name, fn) => listen.set(name, fn),
    };
  } catch (e) {
    await close();
    throw e;
  }
}
