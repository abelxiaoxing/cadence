// Dispatcher activation state machine and tool activation helpers.
// State: inactive -> pending -> active -> draining -> inactive.
// Tool activation always starts from the current active set so unrelated
// tools are preserved; deactivation removes only the dispatcher name.
export type ActivationState = "inactive" | "pending" | "active" | "draining";

export class Activation {
  state: ActivationState = "inactive";

  isActive(): boolean {
    return this.state === "active";
  }

  /** inactive -> pending (an eligible stage began). */
  request(): boolean {
    if (this.state !== "inactive") return false;
    this.state = "pending";
    return true;
  }

  /** pending -> active (stage verified). */
  activate(): boolean {
    if (this.state !== "pending") return false;
    this.state = "active";
    return true;
  }

  /** One idempotent drain step: active -> inactive directly (P-006 unified drain). */
  drain(): boolean {
    if (this.state === "inactive" || this.state === "pending") return false;
    this.state = "inactive";
    return true;
  }
}

/** Additively enable a tool name, preserving every currently active tool. */
export function activateTool(active: string[], name: string): string[] {
  return [...new Set([...active, name])];
}

/** Remove only the given tool name from the active set. */
export function deactivateTool(active: string[], name: string): string[] {
  return active.filter((n) => n !== name);
}
