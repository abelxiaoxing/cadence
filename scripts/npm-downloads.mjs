// Track npm registry download counts for the published Cadence package.
//
// The pi.dev package page displays npm rolling 30-day and 7-day tarball
// download counts for the package. Every registry tarball fetch
// (`npm install`, `npm pack`, `pi install npm:...`) adds one count.
//
// Fetches rotate through the local mihomo proxy (127.0.0.1:7891, API on
// 127.0.0.1:9091) so each tarball fetch exits from a different node IP.
// When mihomo is unreachable the fetch falls back to the direct IP.
//
// Usage:
//   node scripts/npm-downloads.mjs status         7/30-day counts plus 14-day trend
//   node scripts/npm-downloads.mjs fetch          one counted tarball fetch (rotating IP)
//   node scripts/npm-downloads.mjs burst <n>      n counted tarball fetches in sequence
//   node scripts/npm-downloads.mjs append <file>  append "date,week,month" row (used by CI)
//   node scripts/npm-downloads.mjs summary        markdown block for a CI step summary
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const PACKAGE = "@abelxiaoxing/cadence";
const API = "https://api.npmjs.org/downloads";
const USER_AGENT = "cadence-download-tracker/1.0";
const MIHOMO_API = "http://127.0.0.1:9091";
const PROXY = "http://127.0.0.1:7891";
const ROTATE_STATE = path.join(homedir(), ".cache", "cadence-rotate.json");
const MAX_NODE_ATTEMPTS = 8;
const NODE_DEAD_TTL_MS = 10 * 60 * 1000;
const NPM_FETCH_TIMEOUT_MS = "15000";

async function getJson(url) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`npm-downloads-http-${response.status}`);
  return response.json();
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

async function point(window) {
  const data = await getJson(`${API}/point/${window}/${PACKAGE}`);
  if (typeof data.downloads !== "number")
    throw new Error("npm-downloads-invalid-point");
  return data;
}

async function daily(days) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const data = await getJson(
    `${API}/range/${iso(start)}:${iso(end)}/${PACKAGE}`,
  );
  if (!Array.isArray(data.downloads))
    throw new Error("npm-downloads-invalid-range");
  return data.downloads;
}

function renderDaily(rows) {
  if (rows.length === 0) return "  no daily data";
  const max = Math.max(...rows.map((row) => row.downloads), 1);
  return rows
    .map((row) => {
      const bar = "#".repeat(Math.round((row.downloads / max) * 24));
      return `  ${row.day}  ${String(row.downloads).padStart(5)}  ${bar}`;
    })
    .join("\n");
}

async function status() {
  const [week, month, days] = await Promise.all([
    point("last-week"),
    point("last-month"),
    daily(14),
  ]);
  console.log(`${PACKAGE}  (source: npm registry stats)`);
  console.log(
    `  last 7d  : ${String(week.downloads).padStart(6)}  ${week.start} .. ${week.end}`,
  );
  console.log(
    `  last 30d : ${String(month.downloads).padStart(6)}  ${month.start} .. ${month.end}`,
  );
  console.log("  daily (last 14d)");
  console.log(renderDaily(days));
}

// --- mihomo node rotation -------------------------------------------------

async function mihomoGroup() {
  const controller = AbortSignal.timeout(2000);
  const response = await fetch(`${MIHOMO_API}/proxies/ROTATE`, { controller });
  if (!response.ok) throw new Error("mihomo-rotate-group-unavailable");
  const group = await response.json();
  if (!Array.isArray(group.all) || group.all.length === 0) {
    throw new Error("mihomo-rotate-group-empty");
  }
  return group.all;
}

function readRotateState() {
  try {
    const parsed = JSON.parse(readFileSync(ROTATE_STATE, "utf8"));
    return {
      index: typeof parsed.index === "number" ? parsed.index : 0,
      dead: parsed.dead && typeof parsed.dead === "object" ? parsed.dead : {},
    };
  } catch {
    return { index: 0, dead: {} };
  }
}

function writeRotateState(state) {
  writeFileSync(ROTATE_STATE, JSON.stringify(state));
}

async function rotateToNext(exclude) {
  const state = readRotateState();
  const now = Date.now();
  const all = await mihomoGroup();
  // Drop dead marks that expired so flaky nodes get retried later.
  for (const name of Object.keys(state.dead)) {
    if (now - state.dead[name] > NODE_DEAD_TTL_MS) delete state.dead[name];
  }
  const options = all.filter(
    (name) => !exclude.has(name) && !(name in state.dead),
  );
  if (options.length === 0) {
    // Everything is excluded or dead; retry the full pool once.
    for (const name of Object.keys(state.dead)) delete state.dead[name];
  }
  const pool =
    options.length > 0 ? options : all.filter((name) => !exclude.has(name));
  if (pool.length === 0) throw new Error("mihomo-rotate-options-exhausted");
  const node = pool[state.index % pool.length];
  writeRotateState({
    index: (state.index + 1) % pool.length,
    dead: state.dead,
  });
  const controller = AbortSignal.timeout(2000);
  const put = await fetch(`${MIHOMO_API}/proxies/ROTATE`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: node }),
    controller,
  });
  if (put.status !== 204) throw new Error(`mihomo-rotate-http-${put.status}`);
  return node;
}

function markNodeDead(node) {
  const state = readRotateState();
  state.dead[node] = Date.now();
  writeRotateState(state);
}

function runNpmPack(directory, useProxy, quiet) {
  const env = { ...process.env };
  if (useProxy) {
    env.HTTPS_PROXY = PROXY;
    env.HTTP_PROXY = PROXY;
    env.NO_PROXY = "localhost,127.0.0.1";
  } else {
    delete env.HTTPS_PROXY;
    delete env.HTTP_PROXY;
  }
  return spawnSync(
    "npm",
    [
      "pack",
      PACKAGE,
      `--pack-destination=${directory}`,
      `--fetch-timeout=${NPM_FETCH_TIMEOUT_MS}`,
      "--fetch-retries=1",
    ],
    { stdio: quiet ? "ignore" : "inherit", shell: false, env },
  );
}

async function fetchOnce(quiet = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "cadence-download-"));
  try {
    let node = null;
    const excluded = new Set();
    for (let attempt = 1; attempt <= MAX_NODE_ATTEMPTS; attempt += 1) {
      try {
        node = await rotateToNext(excluded);
      } catch {
        break; // mihomo unreachable; fall through to a direct fetch
      }
      const result = runNpmPack(directory, true, quiet);
      if (!result.error && result.status === 0) {
        if (!quiet) console.log(`downloaded ${PACKAGE} via ${node}`);
        return node;
      }
      markNodeDead(node);
      excluded.add(node);
    }
    const direct = runNpmPack(directory, false, quiet);
    if (direct.error) throw new Error("npm-downloads-npm-missing");
    if (direct.status !== 0) process.exit(direct.status ?? 1);
    if (!quiet) console.log(`downloaded ${PACKAGE} via DIRECT`);
    return "DIRECT";
  } finally {
    // The tarball is discarded after the counted registry fetch; keep tmpfs clean.
    rmSync(directory, { recursive: true, force: true });
  }
}

async function burst(count) {
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new Error("npm-downloads-usage-burst-n-1-200");
  }
  for (let i = 1; i <= count; i += 1) {
    const node = await fetchOnce(true);
    console.log(`burst ${i}/${count} done via ${node}`);
    if (i < count) await delay(1500);
  }
}

async function append(file) {
  const [week, month] = await Promise.all([
    point("last-week"),
    point("last-month"),
  ]);
  if (!existsSync(file)) appendFileSync(file, "date,week,month\n");
  appendFileSync(file, `${week.end},${week.downloads},${month.downloads}\n`);
  console.log(
    `appended ${file}: week=${week.downloads} month=${month.downloads}`,
  );
}

async function summary() {
  const [week, month, days] = await Promise.all([
    point("last-week"),
    point("last-month"),
    daily(14),
  ]);
  console.log(`## ${PACKAGE} downloads`);
  console.log("");
  console.log("| Window | Downloads | Period |");
  console.log("| --- | --- | --- |");
  console.log(
    `| last 7 days | ${week.downloads} | ${week.start} .. ${week.end} |`,
  );
  console.log(
    `| last 30 days | ${month.downloads} | ${month.start} .. ${month.end} |`,
  );
  console.log("");
  console.log("<details><summary>Daily trend (last 14 days)</summary>");
  console.log("");
  console.log("```text");
  console.log(renderDaily(days));
  console.log("```");
  console.log("</details>");
}

const [command, ...args] = process.argv.slice(2);
try {
  switch (command) {
    case "status":
      await status();
      break;
    case "fetch":
      await fetchOnce();
      break;
    case "burst":
      if (args.length !== 1)
        throw new Error("npm-downloads-usage-burst-n-1-200");
      await burst(Number(args[0]));
      break;
    case "append":
      if (args.length !== 1) throw new Error("npm-downloads-usage-append-file");
      await append(path.resolve(args[0]));
      break;
    case "summary":
      await summary();
      break;
    default:
      throw new Error(
        "npm-downloads-usage-status|fetch|burst-n|append-file|summary",
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
