import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeCall, stopService } from "../../src/service/cli.ts";
import { GatewayStore } from "../../src/service/gateway-store.ts";
import { readHostConfig } from "../../src/service/runtime.ts";
import { acceptingFixture } from "./accepting-fixture.ts";
import { windowsSystemEnvironment } from "./windows-environment.ts";

/** Genuine generated entry + genuine independently opened owners. Only the
 * loopback provider and credentials are fabricated. No personal SDK resources. */
export async function gatewayFixture(
  proxy: import("../../src/service/config.ts").HttpPolicy["proxy"] = null,
) {
  const f = await acceptingFixture("generated");
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw Error();
  const port = address.port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const config = join(f.dir, "workbench.env"),
    home = join(f.dir, "home");
  writeFileSync(
    config,
    `CADENCE_PORT=${port}\nCADENCE_TOKEN=${"gateway-fixture-".repeat(4)}\n`,
    { mode: 0o600 },
  );
  const store = new GatewayStore(config, f.c.stateHome);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../../src/service-host.mjs", import.meta.url))],
    {
      cwd: home,
      env: {
        ...windowsSystemEnvironment(),
        PATH: process.env.PATH,
        HOME: home,
        USERPROFILE: home,
        TMPDIR: join(f.dir, "tmp"),
        TMP: join(f.dir, "tmp"),
        TEMP: join(f.dir, "tmp"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = once(child, "close");
  let output = "",
    stderr = "";
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("gateway readiness unconfirmed")),
      15000,
    );
    child.stdout.on("data", (b) => {
      output += b;
      if (!output.endsWith("\n")) return;
      clearTimeout(timer);
      try {
        if (JSON.parse(output).status !== "ready") throw Error(output);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(timer);
      reject(Error("gateway exited before readiness"));
    });
  });
  child.stderr.on("data", (b) => {
    stderr += b;
  });
  child.stdin.end(
    JSON.stringify({
      kind: "workbench",
      serverConfig: config,
      stateHome: f.c.stateHome,
      agentDir: readHostConfig(f.c)?.agentDir,
      policy: {
        schema: "cadence-service-http/1",
        host: "127.0.0.1",
        port,
        proxy,
      },
    }),
  );
  async function close() {
    let failed = false;
    try {
      if (child.exitCode === null) {
        const stop = await stopService(store);
        failed = stop.status !== "stopped";
        const timeout = Symbol("timeout");
        let timer: ReturnType<typeof setTimeout> | undefined;
        const ended = await Promise.race([
          closed,
          new Promise((r) => {
            timer = setTimeout(() => r(timeout), 5000);
          }),
        ]);
        clearTimeout(timer);
        if (ended === timeout) {
          failed = true;
          child.kill("SIGTERM");
          await closed;
        }
      }
      if (child.exitCode !== 0 || child.signalCode !== null) failed = true;
    } finally {
      await f.close();
      writeFileSync(
        join(f.dir, "gateway-receipt.json"),
        JSON.stringify(
          {
            output,
            stderr,
            exitCode: child.exitCode,
            signal: child.signalCode,
            clean: !failed,
            paidProvider: false,
          },
          null,
          2,
        ),
      );
    }
    if (failed)
      throw Error(
        "fixture gateway Stop/close unconfirmed; not a clean success",
      );
  }
  try {
    await ready;
  } catch (error) {
    await close();
    throw error;
  }
  const link = (await nativeCall(store, "token-link", true)) as {
    link: string;
  };
  return {
    f,
    store,
    home,
    child,
    closed,
    endpoint: store.localAccess().endpoint,
    link: link.link,
    close,
  };
}
