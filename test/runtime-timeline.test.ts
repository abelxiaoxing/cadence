// Genuine capture -> controlled Pi/command records -> closed public DTOs.
// No browser, provider, owner process or service manager is started.
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { expect, it } from "vitest";
import {
  decodeWorkbenchResult,
  type WorkbenchRead,
  type WorkbenchResult,
} from "../src/service/contracts/workbench.ts";
import { ConversationRecords } from "../src/service/conversation-records.ts";
import { LiveCapture, type LiveTurn } from "../src/service/conversations.ts";
import type { ServiceCoordination } from "../src/service/coordination.ts";
import { sessionDirectory } from "../src/service/pi-sessions.ts";
import { PrivateFiles } from "../src/service/private-files.ts";
import { BROWSER_COMMAND_ENTRY } from "../src/session-entries.mjs";
import { CaptureEmitter, SdkCapture } from "../src/worker-capture.mjs";
import {
  type IndependentIds,
  independentResults,
  independentScenarios,
  independentTimeline,
  runtimeTimeline,
  type TimelineIds,
  timelineArgs,
  timelineCommand,
  timelineOrders,
  timelineResults,
  timelineText,
  timelineVersions,
} from "./helpers/runtime-timeline.ts";

function timelineFixture(historyCount = 0) {
  const scratch = process.env.TMPDIR;
  if (!scratch) throw Error("TMPDIR required");
  const root = mkdtempSync(join(scratch, "runtime-timeline-"));
  const cwd = join(root, "project"),
    agentDir = join(root, "agent");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  const coordination = {
    directory: join(root, "service-v1"),
    files: new PrivateFiles(root),
    store: { root: cwd },
  } as unknown as ServiceCoordination;
  const active = new Map<string, LiveTurn>();
  const options = {
    coordination,
    cwd,
    agentDir,
    active,
    assertCurrent() {},
    secrets: () => [],
  };
  let records = new ConversationRecords(options);
  const id = randomUUID(),
    commandId = randomUUID();
  const directory = sessionDirectory(cwd, agentDir);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `2026-11-02T00-00-00-000Z_${id}.jsonl`);
  const timestamp = new Date(1_800_000_000_000).toISOString();
  writeFileSync(
    path,
    `${JSON.stringify({ type: "session", version: 3, id, cwd, timestamp })}\n`,
  );
  let leaf: string | null = null,
    serial = 1;
  const append = (type: string, fields: Record<string, unknown>) => {
    const id = (serial++).toString(16).padStart(8, "0");
    appendFileSync(
      path,
      `${JSON.stringify({ type, id, parentId: leaf, timestamp, ...fields })}\n`,
    );
    leaf = id;
    return id;
  };
  const history = Array.from({ length: historyCount }, () => ({
    user: append("message", {
      message: { role: "user", content: [{ type: "text", text: "Question" }] },
    }),
    assistant: append("message", {
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: timelineText }],
      },
    }),
  }));
  const parent = leaf,
    offset = statSync(path).size;
  const user = append("message", {
    message: { role: "user", content: [{ type: "text", text: "Question" }] },
  });
  const mark = (
    captureMessageId?: string,
    captureResultCallId?: string | null,
  ) =>
    append("custom", {
      customType: BROWSER_COMMAND_ENTRY,
      data: {
        commandId,
        userId: user,
        ...(captureMessageId ? { captureMessageId } : {}),
        ...(captureResultCallId ? { captureResultCallId } : {}),
      },
    });
  mark();
  const write = (path: string, value: unknown) =>
    coordination.files.create(path, JSON.stringify(value));
  write(records.path(commandId, "accepted.json"), {
    command: {
      kind: "send",
      commandId,
      conversationId: id,
      head: parent,
      text: "Question",
      model: {
        epoch: randomUUID(),
        accessGeneration: 1,
        configRev: 1,
        catalogId: randomUUID(),
      },
    },
    at: 1,
    session: id,
    parent,
    offset,
  });
  const state = {
    status: "running" as const,
    notice: "",
    user,
    omitted: { thinking: false, media: false, other: false },
  };
  write(records.path(commandId, "state.json"), state);
  write(records.indexPath(id), {
    schema: "cadence-session-commands/1",
    id,
    commands: [commandId],
  });
  const accepted = records.accepted(commandId);
  if (accepted?.command.kind !== "send") throw Error("admission");
  const capture = new LiveCapture(() => []);
  const epoch = randomUUID();
  const frames: string[] = [];
  active.set(commandId, {
    coordinator: false,
    inputs: [],
    worker: null,
    ready: true,
    ended: false,
    commandId,
    accepted,
    epoch,
    title: "Question",
    execution: {
      cwd,
      checkoutRoot: cwd,
      model: null,
      version: accepted.command.model,
    },
    state,
    stateFile: null,
    capture,
    abort: new AbortController(),
    original: new Promise(() => {}),
  });
  const emitter = new CaptureEmitter(
    randomUUID(),
    new Writable({
      write(chunk, _encoding, done) {
        frames.push(String(chunk));
        capture.accept(JSON.parse(String(chunk)));
        done();
      },
    }),
    () => {
      throw Error("capture failed");
    },
  );
  const sdk = new SdkCapture(emitter);
  let failed = false;
  const ids: TimelineIds = {
    conversation: id,
    command: commandId,
    epoch,
    user,
    sourceLeaf: leaf ?? user,
    // Bound explicitly when those source events happen, never from text/position.
    captureMessage: "",
    assistant: "",
    terminal: "",
    call: "call",
  };
  return {
    ids,
    history,
    sdk,
    emitter,
    append,
    mark,
    frames,
    sourceLeaf: () => leaf ?? user,
    disconnect(value: boolean) {
      failed = value;
    },
    read(request: WorkbenchRead) {
      if (failed) throw Error("controlled disconnected read");
      let value: WorkbenchResult;
      if (request.kind === "conversation")
        value = records.conversation(request.id, request.leaf, request.known);
      else if (request.kind === "conversation-turn")
        value = records.turnSteps(
          request.id,
          request.leaf,
          request.ordinal,
          request.before,
        );
      else if (request.kind === "conversation-step")
        value = records.step(
          request.id,
          request.leaf,
          request.turnId,
          request.step,
          request.part,
        );
      else throw Error("unexpected read");
      return decodeWorkbenchResult(value);
    },
    settle(status: "completed" | "failed" | "canceled" = "completed") {
      active.delete(commandId);
      writeFileSync(
        records.path(commandId, "state.json"),
        JSON.stringify({ ...state, status }),
      );
      records.closeReads();
    },
    reconnect() {
      records.closeReads();
      records = new ConversationRecords({ ...options, active: new Map() });
    },
    close() {
      records.closeReads();
    },
  };
}

it.each(timelineOrders)(
  "%s: real capture/Pi projection satisfies the shared runtime timeline DTO contract",
  async (order) => {
    const f = timelineFixture();
    const { ids } = f;
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: timelineText },
        {
          type: "thinking",
          thinking: "PRIVATE_THINKING",
          thinkingSignature: "PRIVATE_SIGNATURE",
        },
        {
          type: "toolCall",
          id: ids.call,
          name: "bash",
          arguments: { command: timelineCommand },
        },
        { type: "text", text: timelineText },
      ],
    };
    // Opaque versions are checked for equality AND distinction, not copied from
    // actual into expected. This does not duplicate the service's hash algorithm.
    const versions = new Map<string, string>();
    const checkVersion = (
      token: string | undefined,
      actual: string | undefined,
    ) => {
      expect(typeof actual).toBe("string");
      expect(actual?.length).toBeGreaterThan(0);
      if (!token || !actual) throw Error("missing version");
      if (versions.has(token)) expect(actual).toBe(versions.get(token));
      else {
        expect([...versions.values()]).not.toContain(actual);
        versions.set(token, actual);
      }
    };
    let prior:
      | Extract<WorkbenchResult, { kind: "conversation-turn" }>
      | undefined;
    let previewIds: string[] | undefined;
    let durableIds: string[] | undefined;
    try {
      for (const point of runtimeTimeline(order)) {
        switch (point.action) {
          case "ready":
            await f.emitter.emit({ kind: "ready", requestProtocol: 2 });
            break;
          case "text":
            await f.sdk.event({
              type: "message_start",
              message: { role: "assistant" },
            });
            if (!f.sdk.messageId) throw Error("message not started");
            ids.captureMessage = f.sdk.messageId;
            await f.sdk.event({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                contentIndex: 0,
                delta: timelineText,
              },
            });
            break;
          case "thinking":
            await f.sdk.event({
              type: "message_update",
              assistantMessageEvent: {
                type: "thinking_start",
                contentIndex: 1,
              },
            });
            break;
          case "final":
            await f.sdk.event({ type: "message_end", message });
            break;
          case "write-pi":
            ids.assistant = f.append("message", { message });
            break;
          case "mark-pi":
            f.mark(ids.captureMessage);
            break;
          case "tool-start":
            await f.sdk.event({
              type: "tool_execution_start",
              toolCallId: ids.call,
              toolName: "bash",
              args: { command: timelineCommand },
            });
            break;
          case "read-failure":
            f.disconnect(true);
            break;
          case "read-recovery":
            f.disconnect(false);
            break;
          case "tool-first":
          case "tool-later":
            await f.sdk.event({
              type: "tool_execution_update",
              toolCallId: ids.call,
              toolName: "bash",
              partialResult: {
                content: [
                  {
                    type: "text",
                    text: timelineResults(ids, point).tool?.item.text,
                  },
                ],
              },
            });
            break;
          case "tool-end":
            await f.sdk.event({
              type: "tool_execution_end",
              toolCallId: ids.call,
              toolName: "bash",
              isError: false,
              result: { content: [{ type: "text", text: "final output" }] },
            });
            f.append("message", {
              message: {
                role: "toolResult",
                toolCallId: ids.call,
                toolName: "bash",
                isError: false,
                content: [{ type: "text", text: "final output" }],
              },
            });
            ids.terminal = f.mark();
            break;
          case "reply-end":
            f.settle();
            break;
          case "reconnect":
            f.close();
            break;
          // No capture/storage event: successful observations cannot end work.
          // Workflow outcome is independently supplied to the Web test, not
          // fabricated by this ordinary-conversation backend fixture.
          case "silence":
          case "workflow-end":
            break;
        }
        const request = {
          kind: "conversation",
          id: ids.conversation,
          leaf: null,
          known: null,
        } as const;
        if (point.failed) {
          expect(() => f.read(request)).toThrow("controlled disconnected read");
          continue;
        }
        ids.sourceLeaf = f.sourceLeaf();
        const expected = timelineResults(ids, point);
        const head = f.read(request);
        if (head.kind !== "conversation") throw Error("unexpected head");
        // File mtime is observation-local; source leaf is explicitly fixture-bound.
        const { summary, ...headFields } = expected.head;
        expect(head).toMatchObject(headFields);
        expect(head.summary, point.action).toMatchObject({
          id: ids.conversation,
          title: "Question",
          status: summary?.status,
          origin: "terminal",
          leaf: summary?.leaf,
        });
        expect(head.summary?.live).toEqual(summary?.live);
        const actual = f.read({
          kind: "conversation-turn",
          id: ids.conversation,
          leaf: head.leaf,
          ordinal: 0,
          before: null,
        });
        if (actual.kind !== "conversation-turn") throw Error("unexpected turn");
        const { steps, turn, ...coordinates } = expected.turn;
        expect(actual).toMatchObject(coordinates);
        const { at: _at, activity, ...header } = turn;
        expect(actual.turn, point.action).toMatchObject(header);
        if (activity) {
          expect(actual.turn.activity).toMatchObject({
            kind: activity.kind,
            ...(activity.name ? { name: activity.name } : {}),
          });
          expect(actual.turn.activity?.sequence).toBeGreaterThanOrEqual(
            prior?.turn.activity?.sequence ?? 0,
          );
        } else expect(actual.turn.activity).toBeUndefined();
        expect(actual.steps, point.action).toHaveLength(steps.length);
        expect(
          actual.steps.map(({ version: _version, ...step }) => step),
        ).toEqual(steps.map(({ version: _version, ...step }) => step));
        for (const step of steps) {
          const observed = actual.steps.find(
            (s) => s.renderId === step.renderId,
          );
          checkVersion(step.version, observed?.version);
        }
        expect(JSON.stringify(actual)).not.toMatch(
          /PRIVATE_THINKING|PRIVATE_SIGNATURE/,
        );
        expect(f.frames.join("")).not.toMatch(
          /PRIVATE_THINKING|PRIVATE_SIGNATURE/,
        );
        if (point.action === "thinking")
          previewIds = actual.steps.map((s) => s.renderId ?? "");
        if (point.action === "mark-pi") {
          durableIds = actual.steps.map((s) => s.renderId ?? "");
          expect(durableIds.slice(0, 3)).toEqual(previewIds);
          expect(
            actual.steps
              .filter((s) => s.role === "assistant")
              .map((s) => s.text),
          ).toEqual([timelineText, timelineText]);
        }
        if (
          [
            "write-pi",
            "silence",
            "read-recovery",
            "reconnect",
            "workflow-end",
          ].includes(point.action)
        ) {
          expect(actual.steps).toEqual(prior?.steps);
          expect(actual.turn.activity).toEqual(prior?.turn.activity);
        }
        if (point.action === "reply-end")
          expect(actual.steps.map((s) => s.renderId)).toEqual(durableIds);
        if (expected.tool) {
          const detail = f.read({
            kind: "conversation-step",
            id: ids.conversation,
            leaf: head.leaf,
            turnId: actual.turn.id,
            step: expected.tool.step,
            part: 0,
          });
          if (detail.kind !== "conversation-step")
            throw Error("unexpected detail");
          const { item, ...coords } = expected.tool;
          expect(detail).toMatchObject(coords);
          const { version, ...body } = item;
          expect(detail.item).toEqual({
            ...body,
            version: versions.get(version ?? ""),
          });
          expect(detail.item.args).toBe(timelineArgs);
        }
        prior = actual;
      }
      expect(versions.get(timelineVersions["first output"])).not.toBe(
        versions.get(timelineVersions["later output"]),
      );
      expect(versions.get(timelineVersions["later output"])).not.toBe(
        versions.get(timelineVersions["final output"]),
      );
    } finally {
      f.close();
    }
  },
);

it.each(independentScenarios)(
  "$kind/$order/$terminal: independent executions satisfy the shared public timeline through unmarked Pi, terminal and overlay-free cold reads",
  async ({ kind, order, terminal }) => {
    const f = timelineFixture(3);
    const ids: IndependentIds = {
      ...f.ids,
      execution: "",
      repeatExecution: "",
      history: f.history,
    };
    const declaration = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: timelineText },
        ...(kind === "ambiguous"
          ? [0, 1].map(() => ({
              type: "toolCall",
              id: ids.call,
              name: "read",
              arguments: {},
            }))
          : []),
        { type: "text", text: timelineText },
      ],
    };
    const result = { content: [{ type: "text", text: "final output" }] };
    const event = { toolCallId: ids.call, toolName: "read" };
    const resultMessage = {
      role: "toolResult",
      ...event,
      isError: false,
      ...result,
    };
    let resultMessageId = "";
    const versions = new Map<string, string>();
    const checkVersion = (
      expected: string | undefined,
      actual: string | undefined,
    ) => {
      expect(actual).toMatch(/^[a-f0-9]{64}$/);
      if (!expected || !actual) throw Error("missing content version");
      if (versions.has(expected)) expect(actual).toBe(versions.get(expected));
      else {
        expect([...versions.values()]).not.toContain(actual);
        versions.set(expected, actual);
      }
    };
    const checkTurn = (
      expected: Extract<WorkbenchResult, { kind: "conversation-turn" }>,
      before: number | null = null,
    ) => {
      const actual = f.read({
        kind: "conversation-turn",
        id: ids.conversation,
        leaf: expected.leaf,
        ordinal: expected.ordinal,
        before,
      });
      if (actual.kind !== "conversation-turn") throw Error("turn");
      const { at: _at, ...header } = expected.turn;
      const { steps: _steps, ...coordinates } = expected;
      expect(actual).toMatchObject({ ...coordinates, turn: header });
      // Versions are equality/change tokens; all other public step fields are exact.
      expect(actual.steps.map(({ version: _, ...s }) => s)).toEqual(
        expected.steps.map(({ version: _, ...s }) => s),
      );
      actual.steps.forEach((s, i) => {
        checkVersion(expected.steps[i].version, s.version);
      });
      expect(new Set(actual.steps.map((s) => s.renderId)).size).toBe(
        actual.steps.length,
      );
      return actual;
    };
    let prior: ReturnType<typeof checkTurn> | undefined;
    try {
      for (const point of independentTimeline(order, terminal)) {
        switch (point.action) {
          case "declared":
            await f.emitter.emit({ kind: "ready", requestProtocol: 2 });
            await f.sdk.event({ type: "message_start", message: declaration });
            ids.captureMessage = f.sdk.messageId!;
            await f.sdk.event({ type: "message_end", message: declaration });
            ids.assistant = f.append("message", { message: declaration });
            f.mark(ids.captureMessage);
            break;
          case "tool-start": {
            await f.sdk.event({
              type: "tool_execution_start",
              ...event,
              args: {},
            });
            const frame = JSON.parse(f.frames.at(-1)!).event;
            expect(frame).toMatchObject({
              kind: "tool-start",
              declaration: null,
            });
            ids.execution = frame.callId;
            break;
          }
          case "tool-first":
          case "tool-later":
            await f.sdk.event({
              type: "tool_execution_update",
              ...event,
              partialResult: {
                content: [{ type: "text", text: point.output }],
              },
            });
            break;
          case "tool-end":
            await f.sdk.event({
              type: "tool_execution_end",
              ...event,
              isError: false,
              result,
            });
            await f.sdk.event({
              type: "message_start",
              message: resultMessage,
            });
            resultMessageId = f.sdk.messageId!;
            expect(f.sdk.resultCallId).toBe(ids.execution);
            break;
          case "result-final":
            await f.sdk.event({ type: "message_end", message: resultMessage });
            break;
          case "result-write":
            f.append("message", { message: resultMessage });
            break;
          case "result-mark":
            ids.terminal = f.mark(resultMessageId, ids.execution);
            break;
          case "repeat-result": {
            // A whole second execution/result fits between observations. Its
            // identical result body MUST remain a distinct source occurrence.
            const event = { toolCallId: "repeat-call", toolName: "read" };
            await f.sdk.event({
              type: "tool_execution_start",
              ...event,
              args: {},
            });
            await f.sdk.event({
              type: "tool_execution_end",
              ...event,
              isError: false,
              result,
            });
            const message = {
              role: "toolResult",
              ...event,
              isError: false,
              ...result,
            };
            await f.sdk.event({ type: "message_start", message });
            const messageId = f.sdk.messageId!;
            ids.repeatExecution = f.sdk.resultCallId!;
            expect(ids.repeatExecution).not.toBe(ids.execution);
            await f.sdk.event({ type: "message_end", message });
            f.append("message", { message });
            ids.terminal = f.mark(messageId, ids.repeatExecution);
            break;
          }
          case "reply-end":
            f.settle(terminal);
            break;
          case "reconnect":
            f.reconnect();
            break;
        }
        ids.sourceLeaf = f.sourceLeaf();
        const expected = independentResults(ids, kind, point);
        const head = f.read({
          kind: "conversation",
          id: ids.conversation,
          leaf: null,
          known: null,
        });
        const { updatedAt: _updatedAt, ...summary } = expected.head.summary!;
        expect(head, point.action).toMatchObject({ ...expected.head, summary });
        if (head.kind !== "conversation") throw Error("head");
        expect(head.summary?.live).toEqual(expected.head.summary?.live);
        const actual = checkTurn(expected.turn);
        for (const history of expected.history) checkTurn(history);
        for (const detail of expected.tools) {
          const value = f.read({
            kind: "conversation-step",
            id: ids.conversation,
            leaf: detail.leaf,
            turnId: detail.turnId,
            step: detail.step,
            part: 0,
          });
          if (value.kind !== "conversation-step") throw Error("detail");
          const { version, ...item } = detail.item;
          expect(value).toEqual({
            ...detail,
            item: { ...item, version: versions.get(version!) },
          });
        }
        if (
          ["result-write", "result-final", "reconnect"].includes(point.action)
        )
          expect(actual.steps, point.action).toEqual(prior?.steps);
        if (point.repeated) {
          expect(
            expected.tools
              .filter((s) => s.item.text === "final output")
              .map((s) => s.item.renderId),
          ).toEqual([`call:${ids.execution}`, `call:${ids.repeatExecution}`]);
          // The first execution also survives a genuine earlier-step-page read.
          checkTurn(
            { ...expected.turn, steps: expected.turn.steps.slice(0, -1) },
            expected.turn.steps.length - 1,
          );
        }
        prior = actual;
      }
    } finally {
      f.close();
    }
  },
);
