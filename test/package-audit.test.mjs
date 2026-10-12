import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import {
  archiveBodies,
  auditPackage,
  sha256,
} from "../scripts/package-audit.mjs";

const roots = [];
afterEach(() =>
  roots.splice(0).forEach((r) => {
    rmSync(r, { recursive: true, force: true });
  }),
);
function header(name, type = 48, body = "ok") {
  const b = Buffer.alloc(512);
  b.write(name);
  b.write("0000644\0", 100);
  b.write("0000000\0", 108);
  b.write("0000000\0", 116);
  b.write(Buffer.byteLength(body).toString(8).padStart(11, "0") + "\0", 124);
  b.fill(32, 148, 156);
  b[156] = type;
  b.write("ustar\0", 257);
  b.write(
    b
      .reduce((sum, x) => sum + x, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
  );
  return Buffer.concat([
    b,
    Buffer.from(body),
    Buffer.alloc((512 - (Buffer.byteLength(body) % 512)) % 512),
  ]);
}
function archive(entries) {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-tar-negative-"));
  roots.push(root);
  const file = path.join(root, "package.tgz");
  writeFileSync(
    file,
    gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])),
  );
  return file;
}
it("decodes actual bodies rather than a tar listing or file count", () => {
  expect(
    archiveBodies(archive([header("package/file")]))
      .get("package/file")
      .toString(),
  ).toBe("ok");
});
it.each([49, 50, 51, 52, 54, 120, 103])(
  "rejects tar link/special/extended type %s",
  (type) => {
    expect(() =>
      archiveBodies(archive([header("package/file", type)])),
    ).toThrow("package-audit-nonregular");
  },
);
it.each([
  "../outside",
  "package/../outside",
  "package//file",
  "package/file\\escape",
  "package/file\nsecret",
])("rejects unsafe member %s", (name) => {
  expect(() => archiveBodies(archive([header(name)]))).toThrow(
    "package-audit-name",
  );
});
it("rejects duplicated regular members and corrupt header checksums", () => {
  expect(() =>
    archiveBodies(archive([header("package/file"), header("package/file")])),
  ).toThrow("package-audit-name");
  const b = header("package/file");
  b[12] ^= 1;
  expect(() => archiveBodies(archive([b]))).toThrow("package-audit-checksum");
});

function sourceFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-body-negative-"));
  roots.push(root);
  mkdirSync(path.join(root, "agents"));
  mkdirSync(path.join(root, "provenance"));
  const roles = [
    "design-explorer",
    "implementation-worker",
    "diagnosis-worker",
  ];
  let pins = "agents:\n";
  const entries = [];
  const expected = [];
  for (const role of roles) {
    const relative = `agents/${role}.md`;
    writeFileSync(path.join(root, relative), role);
    pins += `  - path: ${relative}\n    role: ${role}\n    sha256: ${sha256(role)}\n`;
    entries.push(header(`package/${relative}`, 48, role));
    expected.push(`package/${relative}`);
  }
  writeFileSync(path.join(root, "provenance/adapted-modules.yaml"), pins);
  return { root, expected, file: archive(entries) };
}
it("rejects same-member changed bodies and missing members", () => {
  const f = sourceFixture();
  expect(auditPackage(f.file, f.root, f.expected).members).toHaveLength(3);
  expect(() => auditPackage(f.file, f.root, f.expected.slice(1))).toThrow(
    "member-drift",
  );
  writeFileSync(path.join(f.root, "agents/design-explorer.md"), "changed");
  expect(() => auditPackage(f.file, f.root, f.expected)).toThrow("body-drift");
});
it("rejects mismatched Agent provenance even when bodies match", () => {
  const f = sourceFixture();
  const pin = path.join(f.root, "provenance/adapted-modules.yaml");
  writeFileSync(
    pin,
    readFileSync(pin, "utf8").replace(
      sha256("design-explorer"),
      "0".repeat(64),
    ),
  );
  expect(() => auditPackage(f.file, f.root, f.expected)).toThrow("agent-pin");
});
it("rejects duplicate reviewed manifest names", () => {
  const f = sourceFixture();
  expect(() =>
    auditPackage(f.file, f.root, [...f.expected, f.expected[0]]),
  ).toThrow("manifest");
});
it("rejects linked source ancestors rather than following matching bodies", () => {
  const f = sourceFixture();
  const linked = path.join(f.root, "linked");
  mkdirSync(linked);
  symlinkSync(
    path.join(f.root, "agents"),
    path.join(linked, "agents"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() => auditPackage(f.file, linked, f.expected, f.root)).toThrow(
    "source-link",
  );
});
