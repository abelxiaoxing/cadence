/* Adapted from the existing pi-web-ui prefix-cache renderer
 * (e8bab487af208bc9a1ab60a821652323f598127f). MIT (c) 2026 xing-shuyin;
 * see licenses/pi-web-ui-MIT.txt. Ordinary conversations render observations,
 * never a character-paced replay of an already received snapshot. */
import { memo, useMemo } from "react";
import { segmentStream } from "../rich/stream-markdown";
import { MarkdownBody } from "./rich/Markdown";

/** A tail becoming frozen keeps the same component and source-position key.
 * Unchanged prefixes do not reparse when a tool arrives or the reply ends.
 * Even an incomplete block uses the authoritative syntax/security pipeline:
 * execution state alone must not replace its renderer or its code controls. */
const Segment = memo(function Segment({ text }: { text: string }) {
  return <MarkdownBody text={text} />;
});

export const StreamMarkdown = memo(function StreamMarkdown({
  text,
}: {
  text: string;
  streaming?: boolean;
}) {
  const { segments } = useMemo(() => segmentStream(text), [text]);
  return (
    <div className="md">
      {segments.map((segment) => (
        <Segment key={`stream-offset:${segment.start}`} text={segment.text} />
      ))}
    </div>
  );
});
