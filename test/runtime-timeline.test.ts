// Genuine capture -> controlled Pi/command records -> closed public DTOs.
// No browser, provider, owner process or service manager is started.
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  runtimeTimeline,
  type TimelineIds,
  timelineArgs,
  timelineCommand,
  timelineOrders,
  timelineResults,
  timelineText,
  timelineVersions,
} from "./helpers/runtime-timeline.ts";

function timelineFixture() {
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
  const records = new ConversationRecords({
    coordination,
    cwd,
    agentDir,
    active,
    assertCurrent() {},
    secrets: () => [],
  });
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
  const user = append("message", {
    message: { role: "user", content: [{ type: "text", text: "Question" }] },
  });
  const mark = (captureMessageId?: string) =>
    append("custom", {
      customType: BROWSER_COMMAND_ENTRY,
      data: {
        commandId,
        userId: user,
        ...(captureMessageId ? { captureMessageId } : {}),
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
      head: null,
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
    parent: null,
    offset: 0,
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
    settle() {
      active.delete(commandId);
      writeFileSync(
        records.path(commandId, "state.json"),
        JSON.stringify({ ...state, status: "completed" }),
      );
      records.closeReads();
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
