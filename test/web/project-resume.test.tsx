// Controlled fetch, pure route selection and SSR; not physical two-device/browser validation.
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type {
  WorkbenchRead,
  WorkbenchResult,
} from "../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../src/service/contracts/workflow.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { HttpServiceTransport } from "../../src/service-http-client.ts";
import { ConversationReader } from "../../web/src/client/conversation-reader";
import { draftKey } from "../../web/src/client/conversation-send";
import { rememberedProject } from "../../web/src/client/last-project";
import {
  chatFromLocation,
  currentProject,
  projectRoute,
} from "../../web/src/client/project-route";
import { WorkflowLine } from "../../web/src/components/workspace/WorkflowPanel";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const project = "a".repeat(64),
  chat = randomUUID(),
  head = randomUUID(),
  commandId = randomUUID();
const route = `http://127.0.0.1:43210/app?project=${project}#chat=${chat}`;
const run: WorkflowRun = {
  id: randomUUID(),
  epoch: randomUUID(),
  goal: "Server-owned work",
  status: "running",
  phase: "implementing",
  steps: [],
  notice: "",
  mergedCommit: null,
  humanReviewed: false,
};
it.each(["empty", "blocked", "another-recent-project"])(
  "complete project+chat URL restores server history/work with %s storage and no preparation or replay",
  async (storage) => {
    vi.useFakeTimers();
    const getItem = vi.fn((key: string) => {
      if (storage === "blocked") throw new Error("storage denied");
      return storage === "another-recent-project" &&
        key === "cadence-last-project"
        ? "b".repeat(64)
        : null;
    });
    const write = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem,
      setItem: write,
      removeItem: write,
    });
    vi.stubGlobal("sessionStorage", {
      getItem,
      setItem: write,
      removeItem: write,
    });
    vi.stubGlobal("window", { location: new URL(route) });
    expect(projectRoute(window.location.search, window.location.hash)).toEqual({
      project,
      chat,
    });
    expect(currentProject()).toBe(project);
    expect(chatFromLocation()).toBe(chat);
    expect(getItem).not.toHaveBeenCalled();
    expect(rememberedProject()).toBe(
      storage === "another-recent-project" ? "b".repeat(64) : null,
    );
    expect(draftKey(`checkout:/fixture`, chat)).toBe(
      `cadence:draft:checkout:/fixture:${chat}`,
    );
    const requests: WorkbenchRead[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.method).toBe("GET");
      const url = new URL(String(input));
      expect(url.pathname).toBe(`/projects/${project}/api/v1/workbench/read`);
      const request = JSON.parse(
        url.searchParams.get("request") ?? "",
      ) as WorkbenchRead;
      requests.push(request);
      let value: WorkbenchResult;
      switch (request.kind) {
        case "conversation":
          expect(request.id).toBe(chat);
          value = {
            kind: "conversation",
            summary: {
              id: chat,
              title: "Sent on the first device",
              status: "running",
              updatedAt: 1,
              origin: "webui",
              leaf: head,
            },
            leaf: head,
            continues: true,
            turns: 0,
            branches: 1,
            runs: [run.id],
            attempt: null,
            commands: [commandId],
          };
          break;
        case "conversation-context":
          value = {
            kind: "conversation-context",
            context: {
              id: chat,
              cwd: "/fixture/retained-cwd",
              revision: 7,
              model: {
                provider: "fixture",
                model: "retained-model",
                api: "openai-completions",
                thinking: "off",
              },
            },
          };
          break;
        case "cadence-conversation":
          value = {
            kind: "cadence-conversation",
            state: {
              id: chat,
              revision: 9,
              enabled: true,
              head,
              runs: [run.id],
              proposal: null,
            },
          };
          break;
        case "workflow":
          value = {
            kind: "workflow",
            commandId: null,
            response: { type: "run", run },
          };
          break;
        default:
          throw new Error(`unexpected read ${request.kind}`);
      }
      return Response.json({ kind: "ok", value });
    });
    const selectedProject = currentProject(),
      selectedChat = chatFromLocation();
    if (!selectedProject || !selectedChat)
      throw new Error("complete route not restored");
    const client = new ServiceClient(
      new HttpServiceTransport({
        origin: new URL(route).origin,
        project: selectedProject,
        fetch: fetcher,
        requestTimeoutMs: 1000,
      }),
    );
    const reader = new ConversationReader(client, selectedChat, () => {});
    try {
      reader.setActive(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(reader.view()).toMatchObject({
        error: "",
        summary: { status: "running", title: "Sent on the first device" },
        runs: [run.id],
        commands: [commandId],
      });
      const context = await client.workbenchRead({
        kind: "conversation-context",
        location: { id: chat, cwd: "/fixture" },
      });
      expect(context).toMatchObject({
        kind: "ok",
        value: {
          context: {
            cwd: "/fixture/retained-cwd",
            revision: 7,
            model: { model: "retained-model" },
          },
        },
      });
      expect(
        await client.workbenchRead({ kind: "cadence-conversation", id: chat }),
      ).toMatchObject({
        kind: "ok",
        value: { state: { enabled: true, revision: 9, runs: [run.id] } },
      });
      const observed = await client.workbenchRead({
        kind: "workflow",
        id: reader.view().runs[0],
      });
      if (
        observed.kind !== "ok" ||
        observed.value.kind !== "workflow" ||
        observed.value.response.type !== "run"
      )
        throw new Error("missing workflow");
      const html = renderToStaticMarkup(
        <WorkflowLine
          client={client}
          run={observed.value.response.run}
          onOpen={() => {}}
        />,
      );
      expect(html).toContain("Server-owned work");
      expect(html).toContain("implementing");
      expect(html).not.toContain("Implement this plan");
      reader.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(requests.filter((r) => r.kind === "conversation")).toHaveLength(2);
      expect(write).not.toHaveBeenCalled();
    } finally {
      reader.close();
    }
    const count = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  },
);
it("invalid identities keep controlled null selections without reconstructing paths or another conversation", () => {
  expect(projectRoute("?project=/fixture", "#chat=bad%2Fsession")).toEqual({
    project: null,
    chat: null,
  });
  expect(projectRoute(`?project=${project}`, "#chat=bad%2Fsession")).toEqual({
    project,
    chat: null,
  });
  expect(projectRoute("", `#chat=${chat}`)).toEqual({ project: null, chat });
});
