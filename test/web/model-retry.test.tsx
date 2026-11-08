import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ChatTurn } from "../../src/service/contracts/workbench.ts";
import { recordedTurn } from "../../web/src/client/turn-source";
import { turnParts } from "../../web/src/components/workspace/ChatSteps";
import { ChatTurnView } from "../../web/src/components/workspace/ChatTurnView";
import { LocaleProvider } from "../../web/src/i18n/locale";

function fixture(): ChatTurn {
  return {
    id: "fixture",
    epoch: "fixture",
    status: "running",
    items: [],
    notice: "",
    omitted: { thinking: false, media: false, other: false },
    retry: { phase: "waiting", attempt: 2, maxAttempts: 6, delayMs: 10000 },
  };
}
it("restored owner progress is visible in both locales without a client retry action", () => {
  const turn = recordedTurn(fixture());
  const render = (locale: "en" | "zh") =>
    renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <ChatTurnView turn={turn} />
      </LocaleProvider>,
    );
  expect(render("en")).toContain("Retry 2/6 is scheduled after 10s");
  expect(render("zh")).toContain("第 2/6 次重试安排在 10 秒后");
  expect(render("en")).toContain('role="status"');
  expect(render("en")).not.toContain("<button");
});
it("partial failed replies are labeled in steps instead of concatenated into the final answer", () => {
  const value = fixture();
  value.status = "completed";
  delete value.retry;
  value.items = [
    {
      id: "failed",
      role: "assistant",
      text: "Partial",
      error: true,
      name: "",
      args: "",
    },
    {
      id: "final",
      role: "assistant",
      text: "Complete",
      error: false,
      name: "",
      args: "",
    },
  ];
  const source = recordedTurn(value);
  const parts = turnParts(source.steps);
  expect(parts.steps.map((i) => i.step.text)).toEqual(["Partial"]);
  expect(parts.answer.map((i) => i.step.text)).toEqual(["Complete"]);
  expect(renderToStaticMarkup(<ChatTurnView turn={source} />)).toContain(
    "Incomplete model response",
  );
});

it("requesting progress is not a countdown and stale settled progress is never shown", () => {
  const turn = fixture();
  turn.retry = { phase: "requesting", attempt: 2, maxAttempts: 6, delayMs: 0 };
  const render = () =>
    renderToStaticMarkup(<ChatTurnView turn={recordedTurn(turn)} />);
  expect(render()).toContain("Retrying the model request (2/6)");
  for (const status of [
    "failed",
    "canceled",
    "unknown",
    "completed",
  ] as const) {
    turn.status = status;
    expect(render()).not.toContain("Retrying the model request");
    expect(render()).not.toContain('role="status"');
  }
});
