// @vitest-environment node
/** Messages into a running reply: when the browser offers one, the commands it
 * sends, and how waiting and undelivered messages are shown. Pure functions
 * and SSR markup; no pointer, focus or real owner. */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  PENDING_TEXT_BYTES,
  WAITING_INPUTS,
} from "../../src/service/contracts/workbench.ts";
import {
  inputCommand,
  inputOutcome,
  inputRefusal,
  wholePendingText,
  withdrawCommand,
} from "../../web/src/client/conversation-inputs";
import { WaitingMessages } from "../../web/src/components/workspace/WaitingMessages";
import { LocaleProvider } from "../../web/src/i18n/locale";

// The reasons the service records (`NOT_DELIVERED`, `UNOBSERVED` in
// src/service/conversation-records.ts); test/conversation-input.test.ts holds
// these exact words against the browser's translations.
const NOT_DELIVERED =
  "Not delivered: the reply ended before this message reached the model. Nothing was replayed; send it again.";
const UNOBSERVED =
  "Not observed: the session could not be read when the reply ended, so whether this message was delivered was not recorded. Nothing was replayed.";
const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const live = { commandId: ID(1), epoch: ID(2) };

it("a message into a running reply names that run and owner, and carries no head, model or image", () => {
  expect(
    inputCommand(ID(3), live, "steer", "Use the cursor API", ID(4)),
  ).toEqual({
    kind: "conversation-input",
    commandId: ID(4),
    conversationId: ID(3),
    turnId: ID(1),
    epoch: ID(2),
    mode: "steer",
    text: "Use the cursor API",
  });
  expect(withdrawCommand(ID(3), live, ID(4), ID(5))).toEqual({
    kind: "conversation-input-cancel",
    commandId: ID(5),
    conversationId: ID(3),
    turnId: ID(1),
    epoch: ID(2),
    inputId: ID(4),
  });
  // Each command has its own identity.
  expect(inputCommand(ID(3), live, "queue", "x").commandId).not.toBe(
    inputCommand(ID(3), live, "queue", "x").commandId,
  );
});

it("the text typed is offered to the running reply unless it has images, would change the mode, continues another entry or the reply already holds its share", () => {
  const free = { images: 0, modeChange: false, anchored: false, waiting: 0 };
  expect(inputRefusal(free)).toBeNull();
  expect(inputRefusal({ ...free, waiting: WAITING_INPUTS - 1 })).toBeNull();
  expect(inputRefusal({ ...free, waiting: WAITING_INPUTS })).toBe("full");
  expect(inputRefusal({ ...free, anchored: true })).toBe("anchor");
  expect(inputRefusal({ ...free, modeChange: true })).toBe("mode");
  // What the user can change first is named first.
  expect(
    inputRefusal({ images: 1, modeChange: true, anchored: true, waiting: 9 }),
  ).toBe("images");
});

it("only an accepted command clears the text; a refusal changed nothing and an unknown outcome is left to the next read", () => {
  expect(inputOutcome({ kind: "ok" })).toEqual({ kind: "accepted" });
  expect(
    inputOutcome({ kind: "error", error: { code: "stale", effect: "none" } }),
  ).toEqual({ kind: "refused", code: "stale" });
  expect(
    inputOutcome({ kind: "error", error: { code: "unavailable" } }),
  ).toEqual({ kind: "unknown", code: "unavailable" });
  expect(
    inputOutcome({
      kind: "error",
      error: { code: "unavailable", effect: "unknown" },
    }),
  ).toEqual({ kind: "unknown", code: "unavailable" });
});

it("a waiting message's stated text is put back only when it is surely the whole message", () => {
  expect(wholePendingText("Use the cursor API")).toBe(true);
  expect(wholePendingText("x".repeat(PENDING_TEXT_BYTES))).toBe(false);
  expect(wholePendingText("x".repeat(PENDING_TEXT_BYTES - 12))).toBe(true);
  // Escapes and multi-byte text count as encoded.
  expect(wholePendingText("消".repeat(PENDING_TEXT_BYTES / 3))).toBe(false);
  expect(wholePendingText('"'.repeat(PENDING_TEXT_BYTES / 2))).toBe(false);
});

const rows = (
  fields: Partial<Parameters<typeof WaitingMessages>[0]> = {},
  locale: "en" | "zh" = "en",
) =>
  renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <WaitingMessages
        pending={[]}
        undelivered={[]}
        canWithdraw={true}
        recallable={() => true}
        onWithdraw={() => {}}
        onRestore={() => {}}
        {...fields}
      />
    </LocaleProvider>,
  );

it("waiting messages are the user's own rows with how each was sent and a way to take it back; undelivered ones state their reason and send nothing", () => {
  expect(rows()).toBe("");
  const pending = [
    { commandId: ID(4), mode: "steer" as const, text: "Use the cursor API" },
    { commandId: ID(5), mode: "queue" as const, text: "Then update the docs" },
  ];
  const html = rows({ pending });
  expect(html).toMatch(
    /^<section class="chat-waiting-list" aria-label="Waiting messages">/,
  );
  expect(html.match(/<article class="chat-waiting /g)).toHaveLength(2);
  expect(html).toContain(
    '<span class="chat-waiting-tag steer">Steering: read at the model&#x27;s next step</span>',
  );
  expect(html).toContain(
    '<span class="chat-waiting-tag queue">Queued: sent when this reply ends</span>',
  );
  expect(html).toContain('<p class="chat-attempt-text">Use the cursor API</p>');
  expect(html.match(/aria-label="Withdraw"/g)).toHaveLength(2);
  expect(
    html.match(/aria-label="Withdraw and put back in the message box"/g),
  ).toHaveLength(2);
  expect(html).not.toContain("disabled");
  // A clipped message can be withdrawn but not put back as if it were whole.
  const clipped = rows({
    pending,
    recallable: (input) => input.commandId === ID(4),
  });
  expect(
    clipped.match(/aria-label="Withdraw and put back in the message box"/g),
  ).toHaveLength(1);
  expect(clipped.match(/aria-label="Withdraw"/g)).toHaveLength(2);
  // While a command is in flight, or the owner is away, nothing can be asked.
  expect(
    rows({ pending, canWithdraw: false }).match(/disabled=""/g),
  ).toHaveLength(4);
  expect(rows({ pending }, "zh")).toContain("插队：模型下一步就会读到");
  expect(rows({ pending }, "zh")).toContain("排队：这条回复结束后发送");

  const undelivered = rows({
    undelivered: [
      {
        commandId: ID(6),
        text: "Also bump the version",
        status: "failed",
        notice: NOT_DELIVERED,
      },
    ],
  });
  expect(undelivered).toContain(
    '<article class="chat-attempt chat-undelivered">',
  );
  expect(undelivered).toContain("Also bump the version");
  // The status and the reason are the service's own words.
  expect(undelivered).toContain('<span class="ep-state failed">failed</span>');
  expect(undelivered).toContain(NOT_DELIVERED);
  // Both reasons the service records are said in the reader's language.
  for (const notice of [NOT_DELIVERED, UNOBSERVED]) {
    const zh = rows(
      {
        undelivered: [
          { commandId: ID(6), text: "x", status: "failed", notice },
        ],
      },
      "zh",
    );
    expect(zh).not.toContain(notice);
    expect(zh).toContain("没有任何内容被重放");
    expect(zh).toContain("放回输入框");
  }
  expect(undelivered).toContain("Put back in the message box</button>");
  expect(undelivered).not.toContain("Withdraw");
});
