/** Bounded presentation only. Known request secrets are redacted before truncation. */
export function diagnosticText(
  value: string,
  maximum = 4096,
  secrets: readonly string[] = [],
): string {
  maximum = Math.max(0, Math.floor(maximum));
  let clean = value;
  for (const secret of [...new Set(secrets)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length))
    clean = clean.split(secret).join("[redacted]");
  clean = clean
    // biome-ignore lint/suspicious/noControlCharactersInRegex: remove terminal OSC controls
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: remove terminal CSI controls
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: remove remaining controls and bidi overrides
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
    .replace(
      /((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@");
  if (Buffer.byteLength(clean) <= maximum) return clean;
  const marker = maximum >= 12 ? "\n[truncated]" : ".".repeat(maximum);
  const bytes = Buffer.from(clean).subarray(
    0,
    Math.max(0, maximum - Buffer.byteLength(marker)),
  );
  return bytes.toString("utf8").replace(/\ufffd$/, "") + marker;
}
