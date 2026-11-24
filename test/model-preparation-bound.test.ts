import { expect, it } from "vitest";
import { OwnerModelContext } from "../src/service/model-context.ts";

/** No model is loaded: every request is answered on its own merits (here an
 * invalid one), which is enough to observe that all of them wait their turn. */
const context = () =>
  new OwnerModelContext({
    home: "/nonexistent",
    cwd: "/nonexistent",
    environment: {},
    owner: {} as never,
    accounting: {} as never,
  });
const ask = (c: OwnerModelContext) =>
  c.prepareTracked({
    request: null,
    operationId: "",
    epoch: "",
    signal: new AbortController().signal,
    current: () => true,
  } as never);
const code = async (asked: ReturnType<typeof ask>) => {
  const result = await asked.result;
  return result.status === "refused" ? result.error.code : result.status;
};

it("auth preparations of any number of live workers wait their turn; none is refused for how many wait", async () => {
  // Every live worker of an owner may have one request outstanding, and the
  // owner does not limit how many workers are live.
  const c = context();
  const waiting = Array.from({ length: 200 }, () => ask(c));
  expect(c.pending).toBe(200);
  for (const asked of waiting) expect(await code(asked)).not.toBe("capacity");
  await Promise.all(waiting.map((asked) => asked.settled));
  expect(c.pending).toBe(0);
});
