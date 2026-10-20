// Track npm registry download counts for the published Cadence package.
//
// The pi.dev package page displays npm rolling 30-day and 7-day tarball
// download counts for the package. Every registry tarball fetch
// (`npm install`, `npm pack`, `pi install npm:...`) adds one count.
//
// Usage:
//   node scripts/npm-downloads.mjs status         7/30-day counts plus 14-day trend
//   node scripts/npm-downloads.mjs fetch          one counted tarball fetch from this IP
//   node scripts/npm-downloads.mjs burst <n>      n counted tarball fetches in sequence
//   node scripts/npm-downloads.mjs append <file>  append "date,week,month" row (used by CI)
//   node scripts/npm-downloads.mjs summary        markdown block for a CI step summary
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const PACKAGE = "@abelxiaoxing/cadence";
const API = "https://api.npmjs.org/downloads";
const USER_AGENT = "cadence-download-tracker/1.0";

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

function fetchOnce(quiet = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "cadence-download-"));
  const result = spawnSync(
    "npm",
    ["pack", PACKAGE, `--pack-destination=${directory}`],
    { stdio: quiet ? "ignore" : "inherit", shell: false },
  );
  if (result.error) throw new Error("npm-downloads-npm-missing");
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (!quiet) console.log(`downloaded ${PACKAGE} into ${directory}`);
}

async function burst(count) {
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new Error("npm-downloads-usage-burst-n-1-200");
  }
  for (let i = 1; i <= count; i += 1) {
    fetchOnce(true);
    console.log(`burst ${i}/${count} done`);
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
      fetchOnce();
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
