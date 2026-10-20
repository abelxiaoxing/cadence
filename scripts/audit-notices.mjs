/** Reviewed emitted-module/notice/font closure. No network, install or regeneration. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function auditNotices(root, emitted) {
  const policy = JSON.parse(
    readFileSync(join(root, "provenance/bundled-notices.json"), "utf8"),
  );
  const body = readFileSync(join(root, policy.noticeFile));
  const refuse = () => {
    throw new Error("bundled-notice-drift");
  };
  if (
    policy.schema !== "cadence-bundled-notices/1" ||
    hash(body) !== policy.noticeSha256
  )
    refuse();
  for (const notice of policy.notices) {
    if (
      hash(body.subarray(notice.offset, notice.offset + notice.bytes)) !==
      notice.sha256
    )
      refuse();
  }
  const expected = [];
  for (const family of policy.families) {
    if (
      !family.notices.length ||
      family.notices.some((n) => !policy.notices[n])
    )
      refuse();
    for (const source of family.modules) {
      if (hash(readFileSync(join(root, source.path))) !== source.sha256)
        refuse();
      for (const asset of source.assets)
        expected.push(`${asset}\0${source.path}`);
    }
  }
  for (const family of policy.virtualModules) {
    if (
      !family.notices.length ||
      family.notices.some((n) => !policy.notices[n])
    )
      refuse();
    const pkg = JSON.parse(
      readFileSync(
        join(root, "node_modules", family.name, "package.json"),
        "utf8",
      ),
    );
    if (pkg.version !== family.version) refuse();
    for (const module of family.modules)
      for (const asset of module.assets)
        expected.push(`${asset}\0${module.id}`);
  }
  for (const family of policy.embeddedVis) {
    if (
      !family.notices.length ||
      family.notices.some((n) => !policy.notices[n])
    )
      refuse();
  }
  for (const font of policy.fonts) {
    if (
      hash(readFileSync(join(root, font.source))) !== font.sha256 ||
      hash(readFileSync(join(root, "web/dist", font.asset))) !== font.sha256
    )
      refuse();
  }
  if (emitted) {
    const actual = emitted.flatMap((asset) =>
      asset.modules
        .filter(
          (name) => name.includes("node_modules/") || name.startsWith("\0"),
        )
        .map((name) => `${asset.name}\0${name}`),
    );
    if (JSON.stringify(actual.sort()) !== JSON.stringify(expected.sort()))
      refuse();
  }
  return {
    families: policy.families.length,
    modules: expected.length,
    notices: policy.notices.length,
    fonts: policy.fonts.length,
  };
}
if (process.argv[1] === import.meta.filename)
  console.log(JSON.stringify(auditNotices(resolve(import.meta.dirname, ".."))));
