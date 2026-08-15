#!/usr/bin/env node

import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requestJson } from "../_shared/http-client.mjs";
import { loadConfig } from "../_shared/load-config.mjs";

const DEFAULT_API_URL = "https://context7.com/api/v2";

export function loadContext7Config({ cwd, home }) {
  const selected = loadConfig({ cwd, home });
  return {
    path: selected.path,
    apiUrl: selected.values.CONTEXT7_API_URL || DEFAULT_API_URL,
    apiKey: selected.values.CONTEXT7_API_KEY ?? "",
  };
}

async function resolveQuery(queryArgs, readStdin) {
  if (queryArgs.length === 1 && queryArgs[0] === "-") {
    const query = (await readStdin()).trim();
    if (!query) throw new Error("Stdin query input was empty");
    return query;
  }
  if (queryArgs.includes("-")) {
    throw new Error("When using -, it must be the only query argument");
  }
  const query = queryArgs.join(" ").trim();
  if (!query) throw new Error("A non-empty query is required");
  return query;
}

function buildHeaders(apiKey) {
  return {
    Accept: "application/json",
    "User-Agent": "cadence-context7/0.0.0",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function validateResult(command, value) {
  if (command === "search" && value && Array.isArray(value.results))
    return value;
  if (command === "context") {
    if (Array.isArray(value)) return value;
    if (
      value &&
      typeof value === "object" &&
      (Array.isArray(value.codeSnippets) || Array.isArray(value.infoSnippets))
    ) {
      return value;
    }
  }
  throw new Error(`Invalid Context7 ${command} response shape`);
}

export async function runContext7({
  argv,
  cwd,
  home,
  fetchImpl = fetch,
  sleep,
  readStdin,
}) {
  const [command, operand, ...queryArgs] = argv;
  if (command !== "search" && command !== "context") {
    throw new Error("Unknown command; expected search or context");
  }
  if (!operand) {
    throw new Error(
      `${command} requires a library ${command === "search" ? "name" : "id"}`,
    );
  }

  const query = await resolveQuery(queryArgs, readStdin);
  const config = loadContext7Config({ cwd, home });
  const base = config.apiUrl.replace(/\/+$/, "");
  const endpoint = new URL(
    `${base}/${command === "search" ? "libs/search" : "context"}`,
  );
  endpoint.searchParams.set(
    command === "search" ? "libraryName" : "libraryId",
    operand,
  );
  endpoint.searchParams.set("query", query);
  if (command === "context") endpoint.searchParams.set("type", "json");

  const result = await requestJson({
    operation: `Context7 ${command}`,
    url: endpoint,
    headers: buildHeaders(config.apiKey),
    fetchImpl,
    sleep,
  });
  return validateResult(command, result);
}

async function readAllStdin() {
  process.stdin.setEncoding("utf8");
  let content = "";
  for await (const chunk of process.stdin) content += chunk;
  return content;
}

function printUsage() {
  process.stderr.write(
    "Usage:\n  node context7.mjs search <library-name> <query|->\n  node context7.mjs context <library-id> <query|->\n",
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const result = await runContext7({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      home: homedir(),
      readStdin: readAllStdin,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    printUsage();
    process.stderr.write(
      `${error instanceof Error ? error.message : "Context7 failed"}\n`,
    );
    process.exitCode = 1;
  }
}
