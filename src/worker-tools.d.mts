import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  createLocalBashOperations,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
export function captureBash(
  cwd: string,
  secrets: string[],
  fail: () => void,
  operations: typeof createLocalBashOperations,
  queue: CaptureQueue,
): ToolDefinition;

import type { CaptureQueue } from "./worker-capture.mjs";
export class ToolIngress {
  constructor(secrets: string[], fail: () => void, queue: CaptureQueue);
  bytes: number;
  frames: number;
  wrap(tools: AgentTool[]): AgentTool[];
  release(event: unknown): void;
}
