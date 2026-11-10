import { expect, it } from "vitest";
import {
  OwnerModelContext,
  PREPARATIONS,
} from "../src/service/model-context.ts";

/** No model is loaded: every request is answered on its own merits (here an
 * invalid one), which is enough to observe who waits and who is refused. */
const context = (preparations?: number) =>
  new OwnerModelContext({
    home: "/nonexistent",
    cwd: "/nonexistent",
    environment: {},
    owner: {} as never,
    accounting: {} as never,
    ...(preparations === undefined ? {} : { preparations }),
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

it("auth preparations of many live workers wait their turn; only one beyond the bound is refused", async () => {
  // Every live worker of an owner may have one request in flight.
  expect(PREPARATIONS).toBeGreaterThanOrEqual(8 + 8 + 16);
  const roomy = context();
  const waiting = Array.from({ length: 5 }, () => ask(roomy));
  expect(roomy.pending).toBe(5);
  for (const asked of waiting) expect(await code(asked)).not.toBe("capacity");
  await Promise.all(waiting.map((asked) => asked.settled));
  expect(roomy.pending).toBe(0);

  const tight = context(2);
  const [first, second, third] = [ask(tight), ask(tight), ask(tight)];
  // The refused one reserved nothing; the two admitted ones settle normally.
  expect(tight.pending).toBe(2);
  expect(await code(third)).toBe("capacity");
  expect(await code(first)).not.toBe("capacity");
  expect(await code(second)).not.toBe("capacity");
  await Promise.all([first.settled, second.settled]);
  expect(tight.pending).toBe(0);
});
