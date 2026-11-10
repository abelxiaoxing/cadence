/* Adapted from pi-web-ui web/src/file-diff.ts @ b627452c: the language map,
 * word-level diff, hunks built from edits and the edit/write argument reader.
 * MIT (c) 2026 xing-shuyin.
 * Cadence: built only from a call's recorded arguments, complete as read. No
 * streaming-partial recovery, result `details` patch, output-path fallback or
 * comparison with the file on disk: this is what the call asked for, never
 * proof of what the file holds. */

export interface DiffWordToken {
  type: "same" | "add" | "del";
  text: string;
}
export interface DiffLine {
  type: "add" | "del";
  content: string;
  tokens?: DiffWordToken[];
}
export interface DiffHunk {
  /** Lines the edit replaces and lines it puts there. */
  removed: number;
  added: number;
  lines: DiffLine[];
}
export interface FileDiffData {
  filePath: string;
  isWrite: boolean;
  language: string;
  additions: number;
  deletions: number;
  /** An edit's replacements in recorded order; a write's content as one hunk. */
  hunks: DiffHunk[];
}

/** File extension to a highlight.js language of the bundled (lowlight common)
 * set, so the same name labels a change and fences a preview. */
const EXT_LANG_MAP: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  rb: "ruby",
  php: "php",
  lua: "lua",
  pl: "perl",
  r: "r",
  cs: "csharp",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  md: "markdown",
  sql: "sql",
  diff: "diff",
  patch: "diff",
  graphql: "graphql",
  mk: "makefile",
};

export function detectLanguage(filePath?: string): string {
  const name = filePath?.split(/[\\/]/).pop() ?? "";
  if (name === "Makefile") return "makefile";
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  return (
    (ext && Object.hasOwn(EXT_LANG_MAP, ext) && EXT_LANG_MAP[ext]) ||
    "plaintext"
  );
}

const TOKEN_SPLIT_REGEX = /\s+|[a-zA-Z0-9_$]+|[^\s\w]/g;

/** What changed inside one replaced line. Long or mostly different lines are
 * not worth a token table: they read as one removal and one addition. */
export function computeWordDiff(
  oldText: string,
  newText: string,
): { oldTokens: DiffWordToken[]; newTokens: DiffWordToken[] } {
  const whole = {
    oldTokens: [{ type: "del" as const, text: oldText }],
    newTokens: [{ type: "add" as const, text: newText }],
  };
  if (!oldText || !newText || oldText.length > 800 || newText.length > 800)
    return whole;
  const oldWords = oldText.match(TOKEN_SPLIT_REGEX) || [oldText];
  const newWords = newText.match(TOKEN_SPLIT_REGEX) || [newText];
  const n = oldWords.length;
  const m = newWords.length;
  if (n * m > 4000) return whole;

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] =
        oldWords[i - 1] === newWords[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
  if (dp[n][m] / Math.max(n, m) < 0.25) return whole;

  const oldAcc: DiffWordToken[] = [];
  const newAcc: DiffWordToken[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      oldAcc.push({ type: "same", text: oldWords[i - 1] });
      newAcc.push({ type: "same", text: newWords[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      newAcc.push({ type: "add", text: newWords[j - 1] });
      j--;
    } else {
      oldAcc.push({ type: "del", text: oldWords[i - 1] });
      i--;
    }
  }
  const merged = (reversed: DiffWordToken[]) => {
    const tokens: DiffWordToken[] = [];
    for (const token of reversed.reverse()) {
      const last = tokens.at(-1);
      if (last?.type === token.type) last.text += token.text;
      else tokens.push({ ...token });
    }
    return tokens;
  };
  return { oldTokens: merged(oldAcc), newTokens: merged(newAcc) };
}

/** A text's lines. Its final line break ends the last line rather than
 * starting an empty one. */
function textLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

export function buildHunksFromEdits(
  edits: readonly { oldText?: unknown; newText?: unknown }[],
): { hunks: DiffHunk[]; additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  const hunks = edits.map((edit) => {
    const oldText = typeof edit.oldText === "string" ? edit.oldText : "";
    const newText = typeof edit.newText === "string" ? edit.newText : "";
    const oldLines = textLines(oldText);
    const newLines = textLines(newText);
    deletions += oldLines.length;
    additions += newLines.length;
    const lines: DiffLine[] = [];
    if (oldLines.length === 1 && newLines.length === 1) {
      const { oldTokens, newTokens } = computeWordDiff(
        oldLines[0],
        newLines[0],
      );
      lines.push({ type: "del", content: oldLines[0], tokens: oldTokens });
      lines.push({ type: "add", content: newLines[0], tokens: newTokens });
    } else {
      for (const line of oldLines) lines.push({ type: "del", content: line });
      for (const line of newLines) lines.push({ type: "add", content: line });
    }
    return { removed: oldLines.length, added: newLines.length, lines };
  });
  return { hunks, additions, deletions };
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** An `edit` or `write` call's recorded arguments as a change to show, or null
 * when they are not such a call's complete, readable arguments (the card then
 * shows them as recorded). Pi's `edit` takes `{path, edits: [{oldText,
 * newText}]}` and still accepts the older single `{path, oldText, newText}`. */
export function parseFileMutationArgs(
  toolName: string,
  argsText: string,
): FileDiffData | null {
  if (toolName !== "edit" && toolName !== "write") return null;
  let args: unknown;
  try {
    args = JSON.parse(argsText);
  } catch {
    return null;
  }
  if (!record(args)) return null;
  const filePath =
    typeof args.path === "string"
      ? args.path
      : typeof args.file_path === "string"
        ? args.file_path
        : "";
  const base = { filePath, language: detectLanguage(filePath) };
  if (toolName === "write") {
    if (typeof args.content !== "string") return null;
    const lines = textLines(args.content);
    return {
      ...base,
      isWrite: true,
      additions: lines.length,
      deletions: 0,
      hunks: [
        {
          removed: 0,
          added: lines.length,
          lines: lines.map((content) => ({ type: "add", content })),
        },
      ],
    };
  }
  const edits = [
    ...(Array.isArray(args.edits) ? args.edits.filter(record) : []),
    ...(typeof args.oldText === "string" || typeof args.newText === "string"
      ? [{ oldText: args.oldText, newText: args.newText }]
      : []),
  ];
  if (edits.length === 0) return null;
  return { ...base, isWrite: false, ...buildHunksFromEdits(edits) };
}
