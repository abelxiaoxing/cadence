// Repository-only release checks. Publishing itself stays one explicit CI step.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { auditPackage } from "./package-audit.mjs";

const repository = "abelxiaoxing/cadence";
const packageName = "@abelxiaoxing/cadence";
const registry = "https://registry.npmjs.org";
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const stableVersion = (value) =>
  typeof value === "string" && versionPattern.exec(value)?.[0] === value;
// Only readonly publication observations are retried, never npm publish.
// One monotonic window bounds metadata reads and polling delays; npm may still
// be processing the version when it ends, which is pending, not a failure.
const observationWindowMs = 5 * 60_000;
const observationDelayMs = 5000;
const requestTimeoutMs = 30_000;
const refuse = (reason) => {
  throw new Error(`npm-release-${reason}`);
};
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const hash = (algorithm, bytes, encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);

export function releaseVersion(pkg, env, event) {
  if (
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_EVENT_NAME !== "push" ||
    event.created !== true ||
    event.deleted !== false ||
    event.forced !== false ||
    env.GITHUB_SHA?.length !== 40 ||
    !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA)
  )
    refuse("tag-creation-required");
  const version = env.GITHUB_REF?.replace(/^refs\/tags\/v/, "");
  if (
    !stableVersion(version) ||
    env.GITHUB_REF !== `refs/tags/v${version}` ||
    event.ref !== env.GITHUB_REF ||
    pkg.version !== version
  )
    refuse("stable-tag-version-mismatch");
  if (
    pkg.name !== packageName ||
    pkg.private ||
    pkg.repository?.url !== `git+https://github.com/${repository}.git` ||
    pkg.publishConfig !== undefined
  )
    refuse("package-identity-or-publish-config");
  return version;
}

/** Refresh exact refs without force; accept lightweight and annotated tags. */
export function assertReleaseCheckout(root, env) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git(
    "fetch",
    "--no-tags",
    "origin",
    "refs/heads/main:refs/remotes/origin/main",
    `${env.GITHUB_REF}:${env.GITHUB_REF}`,
  );
  const commit = git("rev-parse", "HEAD");
  if (
    commit !== git("rev-parse", "--verify", `${env.GITHUB_SHA}^{commit}`) ||
    commit !== git("rev-parse", "--verify", `${env.GITHUB_REF}^{commit}`)
  )
    refuse("checkout-mismatch");
  git("merge-base", "--is-ancestor", commit, "refs/remotes/origin/main");
  if (git("status", "--porcelain", "--untracked-files=normal"))
    refuse("dirty-checkout");
  return commit;
}

function newerThan(version, latest) {
  if (!stableVersion(latest)) refuse("invalid-latest-version");
  const a = version.split(".").map(BigInt);
  const b = latest.split(".").map(BigInt);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function assertUnpublished(version, latest, existing) {
  if (latest?.name !== packageName) refuse("registry-package-identity");
  if (existing !== null) refuse("version-already-published");
  if (!newerThan(version, latest.version))
    refuse("version-not-newer-than-latest");
}

// The observation window ended before npm finished processing the version.
class ObservationExpired extends Error {}

// Await the original fetch/body operation, not a Promise.race that abandons it.
// The request timer stays owned through body consumption and is always cleared.
async function request(url, fetcher, consume, deadline = Infinity) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw new ObservationExpired();
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Registry request timed out", "TimeoutError"),
      ),
    Math.min(requestTimeoutMs, Math.ceil(remaining)),
  );
  try {
    const response = await fetcher(url, {
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    try {
      const value = await consume(response);
      controller.signal.throwIfAborted();
      if (performance.now() >= deadline) throw new ObservationExpired();
      return value;
    } finally {
      if (response.body && !response.bodyUsed) await response.body.cancel();
    }
  } catch (error) {
    if (
      controller.signal.aborted &&
      performance.now() >= deadline &&
      (error === controller.signal.reason || error?.name === "AbortError")
    )
      throw new ObservationExpired();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function registryVersion(
  version,
  missing = false,
  fetcher = fetch,
  deadline = Infinity,
) {
  return request(
    `${registry}/${packageName.replace("/", "%2f")}/${encodeURIComponent(version)}`,
    fetcher,
    async (response) => {
      if (!response.ok) {
        if (missing && response.status === 404) return null;
        refuse(`registry-http-${response.status}`);
      }
      const value = await response.json();
      if (
        value?.name !== packageName ||
        !stableVersion(value.version) ||
        (version !== "latest" && value.version !== version)
      )
        refuse("registry-version-identity");
      return value;
    },
    deadline,
  );
}

const archiveName = (version) => `abelxiaoxing-cadence-${version}.tgz`;

/** The one release tarball in `directory` and the digests npm records for it. */
function readArchive(directory, name, expectedSha256) {
  const entries = readdirSync(directory);
  if (entries.length !== 1 || (name ?? entries[0]) !== entries[0])
    refuse("archive-file-set");
  const archive = join(directory, entries[0]);
  const stat = lstatSync(archive);
  if (!stat.isFile() || stat.nlink !== 1) refuse("archive-not-regular");
  const bytes = readFileSync(archive);
  const sha256 = hash("sha256", bytes);
  if (
    expectedSha256 !== undefined &&
    (expectedSha256.length !== 64 ||
      !/^[0-9a-f]{64}$/.test(expectedSha256) ||
      expectedSha256 !== sha256)
  )
    refuse("transport-digest-mismatch");
  return {
    archive,
    sha256,
    shasum: hash("sha1", bytes),
    integrity: `sha512-${hash("sha512", bytes, "base64")}`,
  };
}

/** Reuse the independently enumerated member/body/pin/notice audit, on both jobs. */
export function releaseArchive(root, directory, version, expectedSha256) {
  const artifact = readArchive(directory, archiveName(version), expectedSha256);
  auditPackage(
    artifact.archive,
    root,
    json(join(root, "provenance/package-members.json")),
  );
  return artifact;
}

/** An already audited release tarball, named by its version, for confirmation. */
export function auditedArchive(directory, expectedSha256) {
  const [entry] = readdirSync(directory);
  const version = /^abelxiaoxing-cadence-(.+)\.tgz$/.exec(entry ?? "")?.[1];
  if (!stableVersion(version)) refuse("archive-file-set");
  return { version, ...readArchive(directory, entry, expectedSha256) };
}

/** One readonly look at the registry: true once the version is public with the
 * audited digests and is `latest`, false while npm is still processing it.
 * npm clients verify every downloaded tarball against `dist.integrity`, so a
 * matching integrity binds what users install to the audited bytes. */
export async function observePublished(
  version,
  artifact,
  fetcher = fetch,
  deadline = Infinity,
) {
  const published = await registryVersion(version, true, fetcher, deadline);
  // Reject definite corruption before a stale/stalled latest can hide it.
  if (published) {
    if (
      published.dist?.shasum !== artifact.shasum ||
      published.dist?.integrity !== artifact.integrity
    )
      refuse("published-digest-mismatch");
    if (
      published.dist.tarball !==
      `${registry}/${packageName}/-/cadence-${version}.tgz`
    )
      refuse("published-tarball-url");
  }
  const latest = await registryVersion("latest", false, fetcher, deadline);
  if (newerThan(latest.version, version)) refuse("latest-moved-ahead");
  return published !== null && latest.version === version;
}

/** Poll for one fixed window. The end of the window is `pending`, not a
 * failure: npm acknowledges a publish and then processes it asynchronously,
 * sometimes for longer than this job should wait. */
export async function confirmPublished(version, artifact, fetcher = fetch) {
  const deadline = performance.now() + observationWindowMs;
  try {
    for (;;) {
      if (await observePublished(version, artifact, fetcher, deadline))
        return "confirmed";
      const remaining = deadline - performance.now();
      if (remaining <= 0) return "pending";
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(observationDelayMs, remaining)),
      );
    }
  } catch (error) {
    if (error instanceof ObservationExpired) return "pending";
    throw error;
  }
}

const receipt = (outcome) =>
  outcome === "success"
    ? "npm publish succeeded"
    : outcome === "failure"
      ? "npm publish failed"
      : "The npm publish outcome is unknown";
const recovery = (sha256) =>
  `Recheck later with one readonly observation of this run's audited artifact: download it (gh run download <run-id> -n npm-package -D <empty directory>), then run node scripts/npm-release.mjs check <that directory> ${sha256}. Do not rerun npm publish or the publish job, move/delete the tag, or repair dist-tags automatically.`;

/** What the confirmation step reports, and whether it fails the job. Only a
 * successful publish may end pending without failing. */
export function confirmationReport(outcome, version, sha256, result) {
  const id = `${packageName}@${version}`;
  if (result instanceof Error)
    return {
      failed: true,
      text: `${receipt(outcome)}; registry confirmation failed.\n${result.message}\n${recovery(sha256)}`,
    };
  if (result === "confirmed")
    return {
      failed: false,
      text:
        outcome === "success"
          ? `Registry confirmed ${id} as latest with the audited integrity; SHA-256 ${sha256}.`
          : `${receipt(outcome)}, yet the registry shows ${id} as latest with the audited integrity; SHA-256 ${sha256}.`,
    };
  return {
    failed: outcome !== "success",
    text: `${receipt(outcome)}; npm is still processing ${id}, so registry visibility and latest are pending.\n${recovery(sha256)}`,
  };
}

async function main() {
  const [command, directory, expectedSha256, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !["preflight", "audit", "confirm", "check"].includes(command) ||
    (command === "preflight" && directory !== undefined) ||
    (command !== "preflight" && !directory) ||
    (command === "confirm" && !expectedSha256)
  )
    throw new Error(
      "Usage: npm-release.mjs preflight | audit <directory> [sha256] | confirm <directory> <sha256> | check <directory> [sha256]",
    );
  const env = process.env;
  if (command === "check") {
    const artifact = auditedArchive(directory, expectedSha256);
    const id = `${packageName}@${artifact.version}`;
    if (await observePublished(artifact.version, artifact))
      console.log(`Registry shows ${id} as latest with the audited integrity.`);
    else {
      console.log(`${id} is not yet public as latest; no mismatch observed.`);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "confirm") {
    const artifact = auditedArchive(directory, expectedSha256);
    const result = await confirmPublished(artifact.version, artifact).catch(
      (error) => error,
    );
    const outcome = env.RELEASE_PUBLISH_OUTCOME;
    const report = confirmationReport(
      outcome,
      artifact.version,
      artifact.sha256,
      result,
    );
    if (report.failed) console.error(report.text);
    else if (result === "pending")
      console.log(
        `::warning title=npm publication pending::${report.text.replaceAll("\n", "%0A")}`,
      );
    else console.log(report.text);
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(env.GITHUB_STEP_SUMMARY, `${report.text}\n`);
    if (report.failed) process.exitCode = 1;
    return;
  }
  const root = resolve(import.meta.dirname, "..");
  const version = releaseVersion(
    json(join(root, "package.json")),
    env,
    env.GITHUB_EVENT_PATH ? json(env.GITHUB_EVENT_PATH) : {},
  );
  if (command === "preflight") {
    const commit = assertReleaseCheckout(root, env);
    assertUnpublished(
      version,
      await registryVersion("latest"),
      await registryVersion(version, true),
    );
    console.log(
      `Release preflight: v${version}, commit ${commit}, unpublished`,
    );
    return;
  }
  const artifact = releaseArchive(root, directory, version, expectedSha256);
  if (env.GITHUB_OUTPUT)
    appendFileSync(
      env.GITHUB_OUTPUT,
      `archive=${artifact.archive}\nsha256=${artifact.sha256}\n`,
    );
  console.log(`Audited ${packageName}@${version}: sha256 ${artifact.sha256}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
