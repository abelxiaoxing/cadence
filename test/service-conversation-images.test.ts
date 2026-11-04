// @module-tag slow
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type {
  ImageSend,
  WorkbenchRead,
  WorkbenchResult,
} from "../src/service/contracts/workbench.ts";
import { readImage, uploadImages } from "../web/src/client/images.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { PNG, pngBytes } from "./helpers/images.ts";

it("real owner/SDK receives image-only ordinary and Cadence turns, retains images across restart, and observes the original Send receipt", async () => {
  const f = await acceptingFixture("generated", undefined, null, {
    images: true,
  });
  try {
    await f.client.session();
    const catalog = await f.client.models();
    if (catalog.kind !== "ok") throw Error("catalog");
    expect(catalog.value.entries[0].images).toBe(true);
    const selected = await f.client.chooseModel({
      expected: catalog.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (selected.kind !== "ok") throw Error("choice");
    const read = async (request: WorkbenchRead): Promise<WorkbenchResult> => {
      const reply = await f.client.workbenchRead(request);
      if (reply.kind !== "ok") throw Error(JSON.stringify(reply));
      return reply.value;
    };
    const id = randomUUID();
    let leaf: string | null = null;
    for (const kind of ["send", "cadence-send"] as const) {
      const command: ImageSend = {
        kind,
        commandId: randomUUID(),
        conversationId: id,
        head: leaf,
        text: "",
        model: selected.value.version,
        ...(kind === "cadence-send"
          ? { intent: "enter" as const, revision: 0 }
          : {}),
      } as ImageSend;
      // Trailing fixture bytes exercise multiple upload/history parts and a private pipe payload beyond both existing public control limits.
      const bytes =
        kind === "send"
          ? Buffer.concat([pngBytes(), Buffer.alloc(1024 * 1024)])
          : pngBytes();
      const sent = await uploadImages(
        f.client,
        command,
        [new File([bytes], "screenshot.png", { type: "image/png" })],
        () => true,
      );
      f.mode("pending");
      const before = f.contacts();
      const accepted = await f.client.workbenchCommand(sent);
      expect(accepted).toMatchObject({
        kind: "ok",
        value: { kind: "accepted", commandId: command.commandId },
      });
      await expect
        .poll(() => f.held(), { timeout: 15000, interval: 25 })
        .toBe(1);
      const runningHead = await read({
        kind: "conversation",
        id,
        leaf: null,
        known: null,
      });
      if (runningHead.kind !== "conversation") throw Error("running head");
      expect(runningHead.summary?.status).toBe("running");
      expect(runningHead.leaf).toBe(leaf);
      const runningTurn = await read({
        kind: "conversation-turn",
        id,
        leaf,
        ordinal: runningHead.turns - 1,
        before: null,
      });
      if (runningTurn.kind !== "conversation-turn") throw Error("running turn");
      const runningImage = runningTurn.steps[0].images?.[0];
      if (!runningImage) throw Error("running image");
      const liveBlob = await readImage(runningImage, (offset) =>
        read({
          kind: "conversation-image",
          id,
          leaf,
          ...(runningImage.live ? { live: true } : {}),
          entry: runningImage.entry,
          index: runningImage.index,
          offset,
        }),
      );
      expect(Buffer.from(await liveBlob.arrayBuffer())).toEqual(bytes);
      expect(
        await f.client.workbenchRead({
          kind: "conversation-image",
          id,
          leaf,
          live: true,
          entry: randomUUID(),
          index: 0,
          offset: 0,
        }),
      ).toMatchObject({ kind: "error", error: { code: "stale" } });
      expect(
        await f.client.workbenchRead({
          kind: "conversation-image",
          id,
          leaf,
          ...(runningImage.live ? { live: true as const } : {}),
          entry: runningImage.entry,
          index: 1024,
          offset: 0,
        }),
      ).toMatchObject({ kind: "error" });
      f.release();
      let view: WorkbenchResult;
      await expect
        .poll(
          async () => {
            view = await read({
              kind: "conversation",
              id,
              leaf: null,
              known: null,
            });
            return view.kind === "conversation"
              ? view.summary?.status
              : "wrong";
          },
          { timeout: 15000, interval: 25 },
        )
        .toBe("completed");
      const head = await read({
        kind: "conversation",
        id,
        leaf: null,
        known: null,
      });
      if (head.kind !== "conversation") throw Error("head");
      leaf = head.leaf;
      expect(
        await f.client.workbenchRead({
          kind: "conversation-image",
          id,
          leaf,
          live: true,
          entry: command.commandId,
          index: 0,
          offset: 0,
        }),
      ).toMatchObject({ kind: "error", error: { code: "stale" } });
      const turn = await read({
        kind: "conversation-turn",
        id,
        leaf,
        ordinal: head.turns - 1,
        before: null,
      });
      if (turn.kind !== "conversation-turn") throw Error("turn");
      const image = turn.steps[0].images?.[0];
      expect(image).toBeDefined();
      if (!image) throw Error("missing image");
      expect(JSON.stringify(turn)).not.toContain(PNG);
      const blob = await readImage(image, (offset) =>
        read({
          kind: "conversation-image",
          id,
          leaf,
          entry: image.entry,
          index: image.index,
          offset,
        }),
      );
      expect(Buffer.from(await blob.arrayBuffer())).toEqual(bytes);
      expect(turn.turn.omitted.media).toBe(false);
      expect(f.contacts()).toBe(before + 1);
      expect(JSON.stringify(f.observations.at(-1)?.messages)).toContain(
        `data:image/png;base64,${bytes.toString("base64")}`,
      );
      const duplicate = await f.client.workbenchCommand(sent);
      expect(duplicate).toEqual(accepted);
      expect(f.contacts()).toBe(before + 1);
      expect(f.observations.at(-1)?.tools.includes("cadence_plan")).toBe(
        kind === "cadence-send",
      );
    }
    const restarted = await f.restart();
    const head = await restarted.client.workbenchRead({
      kind: "conversation",
      id,
      leaf: null,
      known: null,
    });
    expect(head).toMatchObject({
      kind: "ok",
      value: { kind: "conversation", turns: 2 },
    });
    const turn = await restarted.client.workbenchRead({
      kind: "conversation-turn",
      id,
      leaf,
      ordinal: 1,
      before: null,
    });
    if (turn.kind !== "ok" || turn.value.kind !== "conversation-turn")
      throw Error("retained turn");
    const image = turn.value.steps[0].images?.[0];
    if (!image) throw Error("retained image");
    const result = await restarted.client.workbenchRead({
      kind: "conversation-image",
      id,
      leaf,
      entry: image.entry,
      index: image.index,
      offset: 0,
    });
    expect(result).toMatchObject({
      kind: "ok",
      value: { kind: "conversation-image", data: PNG },
    });
  } finally {
    await f.close();
  }
}, 30000);

it("a text-only model refuses images before any message admission or provider call", async () => {
  const f = await acceptingFixture("generated");
  try {
    await f.client.session();
    const catalog = await f.client.models();
    if (catalog.kind !== "ok") throw Error("catalog");
    const selected = await f.client.chooseModel({
      expected: catalog.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (selected.kind !== "ok") throw Error("choice");
    const command: ImageSend = {
      kind: "send",
      commandId: randomUUID(),
      conversationId: randomUUID(),
      head: null,
      text: "inspect",
      model: selected.value.version,
    };
    const sent = await uploadImages(
      f.client,
      command,
      [new File([pngBytes()], "image.png", { type: "image/png" })],
      () => true,
    );
    expect(await f.client.workbenchCommand(sent)).toMatchObject({
      kind: "error",
      error: { code: "unsupported-context", effect: "none" },
    });
    expect(f.contacts()).toBe(0);
    expect(
      await f.client.workbenchRead({
        kind: "conversation",
        id: command.conversationId,
        leaf: null,
        known: null,
      }),
    ).toMatchObject({ kind: "ok", value: { summary: null } });
  } finally {
    await f.close();
  }
}, 15000);
