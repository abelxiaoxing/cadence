/** A text as one Markdown fenced code block, so the existing Markdown code
 * renderer (line numbers, bundled highlighting, copy) shows it verbatim. The
 * fence is longer than any backtick run in the text, which therefore cannot
 * close it; `plaintext` gets no language and so no highlighting. */
export function fencedCode(text: string, language = "plaintext"): string {
  let longest = 0;
  for (const run of text.matchAll(/`+/g))
    longest = Math.max(longest, run[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  const info = /^[a-z0-9+#-]+$/.test(language) && language !== "plaintext";
  return `${fence}${info ? language : ""}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
}
