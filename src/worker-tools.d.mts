import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  createBashToolDefinition,
  createLocalBashOperations,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
export function captureShell(
  cwd: string,
  secrets: string[],
  fail: () => void,
  operations: typeof createLocalBashOperations,
  queue: CaptureQueue,
  definition: ReturnType<typeof createBashToolDefinition>,
  commandPrefix?: string,
): ToolDefinition<ReturnType<typeof createBashToolDefinition>["parameters"]>;

import type { CaptureQueue } from "./worker-capture.mjs";
export class ToolIngress {
  constructor(secrets: string[], fail: () => void, queue: CaptureQueue);
  bytes: number;
  frames: number;
  wrap(tools: AgentTool[]): AgentTool[];
  release(event: unknown): void;
}
