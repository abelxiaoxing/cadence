#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requestJson } from "../_shared/http-client.mjs";
import { loadConfig } from "../_shared/load-config.mjs";

const DEFAULT_MODEL = "grok-4.20-non-reasoning";
const DEFAULT_TAVILY_URL = "https://api.tavily.com";
const TAVILY_MAX_RESULTS = 20;

const trimBase = (value) => value.replace(/\/+$/, "");

export function loadGrokConfig({ cwd, home }) {
  const selected = loadConfig({
    cwd,
    home,
    required: ["GROK_API_URL", "GROK_API_KEY"],
  });
  const tavilyKey = selected.values.TAVILY_API_KEY ?? "";
  return {
    path: selected.path,
    grokUrl: selected.values.GROK_API_URL,
    grokKey: selected.values.GROK_API_KEY,
    model: selected.values.GROK_MODEL || DEFAULT_MODEL,
    tavilyUrl: selected.values.TAVILY_API_URL || DEFAULT_TAVILY_URL,
    tavilyKey,
    tavilyEnabled: selected.values.TAVILY_ENABLED !== "false",
    tavilyConfigured: Boolean(tavilyKey),
  };
}

function parseOptions(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      !option?.startsWith("--") ||
      !allowed.has(option) ||
      value === undefined
    ) {
      throw new Error(`Invalid option near ${option ?? "end of command"}`);
    }
    if (Object.hasOwn(options, option))
      throw new Error(`Duplicate option ${option}`);
    options[option] = value;
  }
  return options;
}

function integerOption(
  name,
  value,
  { min = 0, max = Number.MAX_SAFE_INTEGER } = {},
) {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${name} must be a canonical non-negative integer`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error(`${name} must be a safe integer`);
  if (number < min || number > max) {
    throw new Error(
      `${name} integer is outside the supported range ${min}-${max}`,
    );
  }
  return number;
}

function httpUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTP or HTTPS URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must be an HTTP or HTTPS URL`);
  }
  return value.trim();
}

function grokHeaders(key) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function tavilyHeaders(key) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function requireTavily(config) {
  if (!config.tavilyEnabled || !config.tavilyConfigured) {
    throw new Error(
      "Tavily is required and must be enabled with a non-empty API key",
    );
  }
}

async function grokChat({ config, model, system, user, fetchImpl, sleep }) {
  const response = await requestJson({
    operation: "Grok Chat Completions",
    url: `${trimBase(config.grokUrl)}/chat/completions`,
    method: "POST",
    headers: grokHeaders(config.grokKey),
    body: {
      model: model || config.model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    fetchImpl,
    sleep,
  });
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Invalid Grok Chat Completions response shape");
  }
  return content;
}

function normalizeResult(item) {
  if (!item || typeof item !== "object")
    throw new Error("Invalid search result contract");
  const title = typeof item.title === "string" ? item.title : "";
  const description =
    typeof item.description === "string"
      ? item.description
      : typeof item.content === "string"
        ? item.content
        : "";
  const url = httpUrl(item.url, "Search result URL");
  if (!title || !description) throw new Error("Invalid search result contract");
  return { title, url, description };
}

function normalizeResults(value) {
  if (!Array.isArray(value)) throw new Error("Invalid search result contract");
  return value.map(normalizeResult);
}

export function mergeSources(grokResults, tavilyResults) {
  const merged = [];
  const seen = new Set();
  for (const item of [...grokResults, ...tavilyResults]) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    merged.push(item);
  }
  return merged;
}

async function tavilyRequest({ config, endpoint, body, fetchImpl, sleep }) {
  return requestJson({
    operation: `Tavily ${endpoint}`,
    url: `${trimBase(config.tavilyUrl)}/${endpoint}`,
    method: "POST",
    headers: tavilyHeaders(config.tavilyKey),
    body,
    fetchImpl,
    sleep,
  });
}

function parseSearchContent(content) {
  try {
    return normalizeResults(JSON.parse(content));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("Grok search returned malformed JSON");
    throw error;
  }
}

async function webSearch({ options, config, fetchImpl, sleep }) {
  const query = options["--query"]?.trim();
  if (!query) throw new Error("web_search requires --query");
  const minResults = integerOption(
    "--min-results",
    options["--min-results"] ?? "1",
    {
      min: 1,
    },
  );
  const maxResults = integerOption(
    "--max-results",
    options["--max-results"] ?? "10",
    {
      min: 1,
    },
  );
  if (maxResults < minResults)
    throw new Error("--max-results must be at least --min-results");
  const extraSources = integerOption(
    "--extra-sources",
    options["--extra-sources"] ?? "0",
    {
      max: TAVILY_MAX_RESULTS,
    },
  );

  let tavilyResults = [];
  if (extraSources > 0) {
    requireTavily(config);
    const response = await tavilyRequest({
      config,
      endpoint: "search",
      body: { query, max_results: extraSources },
      fetchImpl,
      sleep,
    });
    tavilyResults = normalizeResults(response?.results);
  }

  const platform = options["--platform"]?.trim();
  const user = platform ? `${query}\nPlatform constraint: ${platform}` : query;
  const content = await grokChat({
    config,
    model: options["--model"],
    system: `Return only a JSON array of ${minResults}-${maxResults} objects with string title, HTTP(S) url, and description fields. Do not stream or add prose.`,
    user,
    fetchImpl,
    sleep,
  });
  const grokResults = parseSearchContent(content);
  if (grokResults.length < minResults || grokResults.length > maxResults) {
    throw new Error(
      "Grok search result contract did not satisfy requested result counts",
    );
  }
  return mergeSources(grokResults, tavilyResults);
}

async function webFetch({ options, config, fetchImpl, sleep, warn }) {
  const requestedUrl = httpUrl(options["--url"], "--url");
  let markdown;
  if (config.tavilyEnabled && config.tavilyConfigured) {
    try {
      const response = await tavilyRequest({
        config,
        endpoint: "extract",
        body: { urls: [requestedUrl], format: "markdown" },
        fetchImpl,
        sleep,
      });
      markdown = response?.results?.[0]?.raw_content;
      if (typeof markdown !== "string" || !markdown) {
        throw new Error("Invalid Tavily extract response shape");
      }
    } catch (error) {
      warn(
        `Tavily extract warning: ${error instanceof Error ? error.message : "request failed"}`,
      );
    }
  }

  if (!markdown) {
    markdown = await grokChat({
      config,
      system:
        "Retrieve the requested URL and return structured Markdown only. Do not stream.",
      user: requestedUrl,
      fetchImpl,
      sleep,
    });
  }

  const output = options["--out"];
  if (output) {
    writeFileSync(output, markdown);
    return { out: output };
  }
  return markdown;
}

async function webMap({ options, config, fetchImpl, sleep }) {
  requireTavily(config);
  const requestedUrl = httpUrl(options["--url"], "--url");
  const maxDepth = integerOption("--max-depth", options["--max-depth"] ?? "2", {
    min: 1,
    max: 5,
  });
  const maxBreadth = integerOption(
    "--max-breadth",
    options["--max-breadth"] ?? "20",
    {
      min: 1,
    },
  );
  const limit = integerOption("--limit", options["--limit"] ?? "50", {
    min: 1,
  });
  const response = await tavilyRequest({
    config,
    endpoint: "map",
    body: {
      url: requestedUrl,
      ...(options["--instructions"]
        ? { instructions: options["--instructions"] }
        : {}),
      max_depth: maxDepth,
      max_breadth: maxBreadth,
      limit,
    },
    fetchImpl,
    sleep,
  });
  if (!response || !Array.isArray(response.results)) {
    throw new Error("Invalid Tavily map response shape");
  }
  return response;
}

export async function runGrokSearch({
  argv,
  cwd,
  home,
  fetchImpl = fetch,
  sleep,
  warn = (message) => console.error(message),
}) {
  const [command, ...args] = argv;
  const config = loadGrokConfig({ cwd, home });

  if (command === "get_config_info") {
    if (args.length > 0) throw new Error("get_config_info accepts no options");
    return {
      configPath: config.path,
      grokApiUrl: trimBase(config.grokUrl),
      model: config.model,
      grokConfigured: Boolean(config.grokKey),
      tavilyApiUrl: trimBase(config.tavilyUrl),
      tavilyEnabled: config.tavilyEnabled,
      tavilyConfigured: config.tavilyConfigured,
    };
  }
  if (command === "web_search") {
    const options = parseOptions(
      args,
      new Set([
        "--query",
        "--platform",
        "--min-results",
        "--max-results",
        "--model",
        "--extra-sources",
      ]),
    );
    return webSearch({ options, config, fetchImpl, sleep });
  }
  if (command === "web_fetch") {
    const options = parseOptions(args, new Set(["--url", "--out"]));
    return webFetch({ options, config, fetchImpl, sleep, warn });
  }
  if (command === "web_map") {
    const options = parseOptions(
      args,
      new Set([
        "--url",
        "--instructions",
        "--max-depth",
        "--max-breadth",
        "--limit",
      ]),
    );
    return webMap({ options, config, fetchImpl, sleep });
  }
  throw new Error(
    "Unknown command; expected web_search, web_fetch, web_map, or get_config_info",
  );
}

function printUsage() {
  process.stderr.write(
    "Usage: node grok-search.mjs web_search|web_fetch|web_map|get_config_info [options]\n",
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const result = await runGrokSearch({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      home: homedir(),
    });
    process.stdout.write(
      typeof result === "string"
        ? `${result}\n`
        : `${JSON.stringify(result, null, 2)}\n`,
    );
  } catch (error) {
    printUsage();
    process.stderr.write(
      `${error instanceof Error ? error.message : "Grok search failed"}\n`,
    );
    process.exitCode = 1;
  }
}
