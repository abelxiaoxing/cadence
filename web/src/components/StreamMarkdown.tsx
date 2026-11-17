/* Adapted from the existing pi-web-ui prefix-cache renderer
 * (e8bab487af208bc9a1ab60a821652323f598127f). MIT (c) 2026 xing-shuyin;
 * see licenses/pi-web-ui-MIT.txt. Ordinary conversations render observations,
 * never a character-paced replay of an already received snapshot. */
import { memo, useMemo } from "react";
import { segmentStream } from "../rich/stream-markdown";
import { MarkdownBody } from "./rich/Markdown";

/** A tail becoming frozen keeps the same component and key. Unchanged complete
 * segments do not reparse when a later tool arrives or the reply ends. */
const Segment = memo(function Segment({
  text,
  inFence,
}: {
  text: string;
  inFence: boolean;
}) {
  return inFence ? (
    <div className="codeblock">
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  ) : (
    <MarkdownBody text={text} />
  );
});

export const StreamMarkdown = memo(function StreamMarkdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const { frozen, active, inFence } = useMemo(
    () =>
      // Reference definitions have document-wide meaning. Their arrival is a
      // content change that requires a whole parse, not a terminal-state swap
      // that would remount every ordinary frozen paragraph on handoff.
      /^ {0,3}\[[^\]\n]+\]:/m.test(text)
        ? { frozen: [], active: text, inFence: false }
        : segmentStream(text),
    [text],
  );
  let offset = 0;
  const segments = [...frozen, ...(active ? [active] : [])].map(
    (part, index) => {
      const key = `stream-offset:${offset}`;
      offset += part.length;
      return {
        key,
        text: part,
        inFence: streaming && index === frozen.length && inFence,
      };
    },
  );
  return (
    <div className="md">
      {segments.map((segment) => (
        <Segment {...segment} key={segment.key} />
      ))}
    </div>
  );
});
