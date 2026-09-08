import type {
  VerificationFailureSummary,
  VerificationObservation,
} from "./contracts.ts";

/** Diagnostic text is evidence for repair, never a failure identity or authority. */

export function diagnosticText(value: string, maximum = 4096): string {
  const clean = value
    .replace(
      new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "gu"),
      "",
    )
    .replace(/(Bearer\s+)\S+/giu, "$1[redacted]")
    .replace(
      /((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/giu,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, "$1[redacted]@");
  return clean.length <= maximum
    ? clean
    : `${clean.slice(0, Math.floor(maximum / 2))}\n…[truncated]…\n${clean.slice(-Math.floor(maximum / 2))}`;
}

/** Bounded operation-local feedback; no raw transcripts or global cross-run cache. */
export class VerificationFeedback {
  readonly #entries = new Map<string, VerificationFailureSummary>();
  observe(result: VerificationObservation): void {
    if (result.kind === "cancelled") return;
    const id =
      result.kind === "unavailable"
        ? result.verificationId
        : result.evidence.id;
    this.#entries.delete(id);
    if (result.kind === "accepted") return;
    const summary = result.diagnostic ?? {
      verificationId: id,
      code: result.code,
      failures: [],
      stdout: "",
      stderr: "",
      truncated: false,
      nextStep:
        "Repair the verification environment or adapter before changing product code.",
    };
    this.#entries.set(id, structuredClone(summary));
    const oldest = this.#entries.keys().next().value;
    if (this.#entries.size > 32 && oldest !== undefined)
      this.#entries.delete(oldest);
  }
  current(): VerificationFailureSummary[] {
    const result: VerificationFailureSummary[] = [];
    let bytes = 0;
    for (const entry of [...this.#entries.values()].reverse()) {
      const summary = {
        ...entry,
        failures: entry.failures
          .slice(0, 4)
          .map((text) => diagnosticText(text, 256)),
        stdout: diagnosticText(entry.stdout, 512),
        stderr: diagnosticText(entry.stderr, 1024),
        truncated:
          entry.truncated ||
          entry.failures.length > 4 ||
          entry.failures.some((text) => text.length > 256) ||
          entry.stdout.length > 512 ||
          entry.stderr.length > 1024,
      };
      const size = Buffer.byteLength(JSON.stringify(summary), "utf8");
      if (bytes + size > 6000) break;
      result.push(summary);
      bytes += size;
    }
    return structuredClone(result.reverse());
  }
}
