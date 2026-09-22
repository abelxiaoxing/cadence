import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runSubagentProcess } from "../src/subagent-process.ts";

function fakePi(output: string, exitCode = 0): string {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-pi-child-"));
  const file = path.join(root, "pi");
  writeFileSync(
    file,
    `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${output.replaceAll("'", "'\\''")}'\nexit ${exitCode}\n`,
  );
  chmodSync(file, 0o755);
  return file;
}

describe("subagent process runner", () => {
  it("runs JSON-mode children with a bounded final result", async () => {
    const executable = fakePi(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `\`\`\`json\\n${JSON.stringify({ ok: true })}\\n\`\`\``,
            },
          ],
        },
      }),
    );
    try {
      const events: string[] = [];
      const result = await runSubagentProcess({
        role: "design-explorer",
        cwd: process.cwd(),
        prompt: "inspect",
        piExecutable: executable,
        onEvent: (event) => events.push(event.type),
      });
      expect(result.status).toBe("completed");
      expect(result.finalText).toContain('"ok"');
      expect(events).toContain("message_end");
    } finally {
      rmSync(path.dirname(executable), { recursive: true, force: true });
    }
  });

  it("rejects malformed output, reports non-zero children, and cancels", async () => {
    const malformed = fakePi("not-json");
    try {
      const result = await runSubagentProcess({
        role: "diagnosis-worker",
        cwd: process.cwd(),
        prompt: "inspect",
        piExecutable: malformed,
      });
      expect(result.status).toBe("failed");
      expect(result.error).toBe("subagent-jsonl-malformed");
    } finally {
      rmSync(path.dirname(malformed), { recursive: true, force: true });
    }

    const executable = fakePi(JSON.stringify({ type: "agent_start" }), 7);
    try {
      const result = await runSubagentProcess({
        role: "diagnosis-worker",
        cwd: process.cwd(),
        prompt: "inspect",
        piExecutable: executable,
      });
      expect(result.status).toBe("failed");
      expect(result.error).toContain("subagent-exit-7");
    } finally {
      rmSync(path.dirname(executable), { recursive: true, force: true });
    }

    const controller = new AbortController();
    controller.abort();
    const cancelled = await runSubagentProcess({
      role: "design-explorer",
      cwd: process.cwd(),
      prompt: "inspect",
      signal: controller.signal,
      piExecutable: "missing-pi",
    });
    expect(cancelled.status).toBe("cancelled");
  });
});
