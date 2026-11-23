import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";

/** Observe Pi's synchronous Enter completion without replacing its editor or
 * treating a matching prefix as command consent. Wrappers die on unsubscribe. */
export function commandTerminalInput(
  ctx: ExtensionContext,
  command: string,
  input: (data: string) => void,
  complete: (before: string, after: string) => void,
): () => void {
  let active = true;
  let enter: { text: string } | undefined;
  ctx.ui.addAutocompleteProvider((current) => {
    const shouldTrigger = current.shouldTriggerFileCompletion;
    return {
      triggerCharacters: current.triggerCharacters,
      getSuggestions: (...args) => current.getSuggestions(...args),
      ...(shouldTrigger
        ? {
            shouldTriggerFileCompletion: (...args) =>
              shouldTrigger.apply(current, args),
          }
        : {}),
      applyCompletion(lines, line, col, item, prefix) {
        const before = lines.join("\n");
        const result = current.applyCompletion(lines, line, col, item, prefix);
        const after = result.lines.join("\n");
        if (
          active &&
          enter?.text === before &&
          lines.length === 1 &&
          line === 0 &&
          /^\/[^\s/]*$/u.test(before.slice(0, col)) &&
          prefix === before.slice(0, col) &&
          item.value === command &&
          after === `/${command} ${before.slice(col)}`
        ) {
          enter = undefined;
          complete(before, after);
        }
        return result;
      },
    };
  });
  const unsubscribe = ctx.ui.onTerminalInput((data) => {
    enter = matchesKey(data, Key.enter)
      ? { text: ctx.ui.getEditorText() }
      : undefined;
    const occurrence = enter;
    // Completion runs before the editor submits, within this input dispatch.
    queueMicrotask(() => {
      if (enter === occurrence) enter = undefined;
    });
    input(data);
    return undefined;
  });
  return () => {
    active = false;
    enter = undefined;
    unsubscribe();
  };
}
