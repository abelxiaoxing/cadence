import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { expect, it } from "vitest";
import {
  loginNextPath,
  loginRetryPath,
  readLoginForm,
} from "../src/service/auth-form.ts";
import { renderAuthPage } from "../src/service/auth-page.ts";
import { LIMITS } from "../src/service-contract.ts";

function request(
  body: Buffer | string,
  headers: Record<string, string | undefined> = {},
) {
  return Object.assign(Readable.from([Buffer.from(body)]), {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
  }) as unknown as IncomingMessage;
}

it("the shared form decoder bounds both declared and streamed bodies", async () => {
  await expect(
    readLoginForm(
      request("password=key", {
        "content-length": String(LIMITS.controlBytes + 1),
      }),
    ),
  ).rejects.toThrow("oversize");
  await expect(
    readLoginForm(request("x".repeat(LIMITS.controlBytes + 1))),
  ).rejects.toThrow("oversize");
  expect(await readLoginForm(request("password=key&next=%2Fapp"))).toEqual({
    password: "key",
    next: "/app",
  });
});

it.each([
  "password=key&password=other",
  "password=key&next=%2Fapp&next=%2Fother",
  "password=key&unknown=value",
  "next=%2Fapp",
  Buffer.from([0xff]),
])(
  "ambiguous or malformed login data refuses without choosing credentials",
  async (body) => {
    await expect(readLoginForm(request(body))).rejects.toThrow("invalid");
  },
);

it.each([
  { "content-type": "application/json" },
  { "content-encoding": "gzip" },
  { "transfer-encoding": "chunked" },
])("both entries reject unsupported form transport", async (headers) => {
  await expect(readLoginForm(request("password=key", headers))).rejects.toThrow(
    "invalid",
  );
});

it("retry destinations round-trip without allowing external navigation or token queries", () => {
  for (const next of ["/app?project=abc", "/app?q=a%26b", "/app"]) {
    expect(
      loginNextPath(new URL(loginRetryPath(next), "http://localhost")),
    ).toBe(next);
  }
  for (const next of [
    "//evil.test",
    "/\\evil.test",
    "/app?token=secret&auth_error=1",
  ]) {
    expect(loginRetryPath(next)).toBe("/?auth_error=1");
  }
  expect(
    loginNextPath(
      new URL("http://localhost/?auth_error=1&next=https://evil.test"),
    ),
  ).toBe("/app");
});

it("the native form escapes reflected attributes without adding scripts or filling a password", () => {
  const html = renderAuthPage({
    authError: true,
    nextPath: '/app?q="/><script>alert(1)</script>&a=1',
  });
  expect(html).not.toMatch(
    /<script|\son\w+=|\sstyle=|localStorage|sessionStorage/iu,
  );
  expect(html).toContain("&quot;/&gt;&lt;script&gt;");
  const password = /<input id="key"[^>]*>/.exec(html)![0];
  expect(password).not.toMatch(/\bvalue=/);
  expect(password).toContain('type="password"');
});
