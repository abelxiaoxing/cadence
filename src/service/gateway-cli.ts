/** Explicit SDK-free workbench startup/control. No project is selected here. */
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkSnapshot } from "../sdk-network.ts";
import { defaultStateHome } from "../task-store.ts";
import {
  launchHost,
  managementExitCode,
  nativeCall,
  serviceStatus,
  stopService,
} from "./cli.ts";
import { decodeHttpPolicy } from "./config.ts";
import { ContractError, closed, text } from "./contracts/core.ts";
import { decodeGatewayInput, GatewayStore } from "./gateway-store.ts";
import { encoded, json, PrivateFiles } from "./private-files.ts";
import { localGatewayRecovery } from "./recovery-cli.ts";
import { hostEnvironment } from "./runtime.ts";
import {
  ensureServerConfig,
  readServerConfig,
  serverConfigPath,
} from "./server-config.ts";

export async function gatewayMain(argv: string[], hostUrl: URL): Promise<void> {
  const operation = argv.shift();
  if (
    ![
      "start",
      "status",
      "diagnose",
      "stop",
      "token-link",
      "token-rotate",
      "recover",
    ].includes(operation ?? "")
  )
    throw new ContractError("invalid");
  const recovery = operation === "recover" ? argv.shift() : undefined;
  if (
    operation === "recover" &&
    recovery !== "inspect" &&
    recovery !== "resolve"
  )
    throw new ContractError("invalid");
  let config = serverConfigPath(homedir()),
    stateHome = defaultStateHome(),
    agentDir: string | undefined,
    policyFile: string | undefined;
  let foreground = false,
    reveal = false;
  const seen = new Set<string>();
  while (argv.length) {
    const key = argv.shift() as string;
    if (seen.has(key)) throw new ContractError("invalid");
    seen.add(key);
    if (key === "--foreground" && operation === "start") foreground = true;
    else if (key === "--reveal" && operation === "token-link") reveal = true;
    else if (
      argv[0] &&
      (operation === "recover"
        ? ["--server-config", "--state-home"]
        : ["--server-config", "--state-home", "--agent-dir", "--config"]
      ).includes(key)
    ) {
      const value = resolve(argv.shift() as string);
      if (key === "--server-config") config = value;
      if (key === "--state-home") stateHome = value;
      if (key === "--agent-dir") agentDir = value;
      if (key === "--config") policyFile = value;
    } else throw new ContractError("invalid");
  }
  const store = new GatewayStore(config, stateHome);
  let result: unknown;
  if (operation === "start") {
    const network = networkSnapshot(process.env),
      env = hostEnvironment(process.env);
    if (!seen.has("--server-config")) ensureServerConfig(homedir());
    const server = readServerConfig(config).config;
    const selectedFile = store.files.read(store.path("input.json"));
    const selected = selectedFile
      ? decodeGatewayInput(json(selectedFile))
      : undefined;
    let policy =
      selected?.policy ??
      decodeHttpPolicy({
        schema: "cadence-service-http/1",
        host: "127.0.0.1",
        port: server.port,
        proxy: null,
      });
    if (policyFile) {
      const file = new PrivateFiles(dirname(policyFile)).read(policyFile);
      if (!file) throw new ContractError("invalid");
      policy = decodeHttpPolicy(json(file));
    }
    const input = decodeGatewayInput({
      kind: "workbench",
      serverConfig: config,
      stateHome: store.stateHome,
      agentDir:
        agentDir ??
        selected?.agentDir ??
        resolve(
          process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
        ),
      policy: { ...policy, port: server.port },
    });
    const status = await serviceStatus(store);
    if (
      status &&
      typeof status === "object" &&
      "status" in status &&
      status.status === "alive"
    ) {
      if (!selected || encoded(selected) !== encoded(input))
        throw new ContractError("conflict");
      result = status;
    } else
      result = await launchHost(
        input,
        store,
        foreground,
        hostUrl,
        dirname(dirname(fileURLToPath(hostUrl))),
        env,
        network,
      );
    if (
      !foreground &&
      result &&
      typeof result === "object" &&
      "status" in result &&
      result.status === "alive"
    ) {
      const reply = closed(await nativeCall(store, "token-link", true), [
        "link",
      ]);
      process.stderr.write(
        `Cadence workbench: ${text(reply.link, 4096, true)}\nNo project or default workspace was created.\n`,
      );
    }
  } else if (
    operation === "recover" &&
    (recovery === "inspect" || recovery === "resolve")
  )
    result = await localGatewayRecovery(store, recovery);
  else if (operation === "stop") result = await stopService(store);
  else if (operation === "status" || operation === "diagnose")
    result = await serviceStatus(store, operation === "diagnose");
  else {
    if (operation === "token-link" && !reveal)
      throw new ContractError("forbidden");
    result = await nativeCall(store, operation as string, reveal);
  }
  if (result !== null) process.stdout.write(`${JSON.stringify(result)}\n`);
  if (
    result &&
    typeof result === "object" &&
    "status" in result &&
    ["unconfirmed", "unavailable", "quarantined", "refused"].includes(
      String(result.status),
    )
  )
    process.exitCode = managementExitCode(result, foreground);
  if (
    result &&
    typeof result === "object" &&
    "status" in result &&
    ["unavailable", "quarantined", "refused", "unconfirmed"].includes(
      String(result.status),
    )
  )
    process.stderr.write(
      `Preserve state; inspect locally: cadence workbench recover inspect --server-config ${JSON.stringify(config)} --state-home ${JSON.stringify(store.stateHome)}. Eligible recovery requires recover resolve in a local terminal; it never starts work.\n`,
    );
}
