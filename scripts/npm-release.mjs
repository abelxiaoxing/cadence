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
const observationAttempts = 6;
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

const requestOptions = () => ({
  redirect: "error",
  cache: "no-store",
  signal: AbortSignal.timeout(requestTimeoutMs),
});

export async function registryVersion(
  version,
  missing = false,
  fetcher = fetch,
) {
  const response = await fetcher(
    `${registry}/${packageName.replace("/", "%2f")}/${encodeURIComponent(version)}`,
    requestOptions(),
  );
  if (!response.ok) {
    await response.body?.cancel();
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
}

/** Reuse the independently enumerated member/body/pin/notice audit, on both jobs. */
export function releaseArchive(root, directory, version, expectedSha256) {
  const name = `abelxiaoxing-cadence-${version}.tgz`;
  const entries = readdirSync(directory);
  if (entries.length !== 1 || entries[0] !== name) refuse("archive-file-set");
  const archive = join(directory, name);
  const stat = lstatSync(archive);
  if (!stat.isFile() || stat.nlink !== 1) refuse("archive-not-regular");
  const audit = auditPackage(
    archive,
    root,
    json(join(root, "provenance/package-members.json")),
  );
  if (
    expectedSha256 !== undefined &&
    (expectedSha256.length !== 64 ||
      !/^[0-9a-f]{64}$/.test(expectedSha256) ||
      expectedSha256 !== audit.archiveSha256)
  )
    refuse("transport-digest-mismatch");
  const bytes = readFileSync(archive);
  return {
    archive,
    sha256: audit.archiveSha256,
    shasum: hash("sha1", bytes),
    integrity: `sha512-${hash("sha512", bytes, "base64")}`,
    bytes,
  };
}

export async function confirmPublished(
  version,
  artifact,
  fetcher = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; attempt < observationAttempts; attempt++) {
    const published = await registryVersion(version, true, fetcher);
    const latest = await registryVersion("latest", false, fetcher);
    if (published) {
      if (
        published.dist?.shasum !== artifact.shasum ||
        published.dist?.integrity !== artifact.integrity
      )
        refuse("published-digest-mismatch");
      if (latest.version === version) {
        const url = `${registry}/${packageName}/-/cadence-${version}.tgz`;
        if (published.dist.tarball !== url) refuse("published-tarball-url");
        const response = await fetcher(url, requestOptions());
        if (!response.ok) {
          await response.body?.cancel();
          refuse(`tarball-http-${response.status}`);
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > artifact.bytes.length) refuse("published-byte-mismatch");
          chunks.push(chunk);
        }
        if (!Buffer.concat(chunks).equals(artifact.bytes))
          refuse("published-byte-mismatch");
        return;
      }
    }
    if (newerThan(latest.version, version)) refuse("latest-moved-ahead");
    if (attempt + 1 < observationAttempts) await sleep(observationDelayMs);
  }
  refuse("publication-not-visible");
}

async function main() {
  const [command, directory, expectedSha256, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !["preflight", "audit", "confirm"].includes(command) ||
    (command === "preflight" && directory !== undefined) ||
    (command !== "preflight" && !directory)
  )
    throw new Error(
      "Usage: npm-release.mjs preflight | audit|confirm <directory> [sha256]",
    );
  const root = resolve(import.meta.dirname, "..");
  const env = process.env;
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
  if (command === "audit") {
    if (env.GITHUB_OUTPUT)
      appendFileSync(
        env.GITHUB_OUTPUT,
        `archive=${artifact.archive}\nsha256=${artifact.sha256}\n`,
      );
    console.log(`Audited ${packageName}@${version}: sha256 ${artifact.sha256}`);
    return;
  }
  await confirmPublished(version, artifact);
  const message = `Registry confirmed ${packageName}@${version}, latest, and exact tarball bytes; SHA-256 ${artifact.sha256}.`;
  console.log(message);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
