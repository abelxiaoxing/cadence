import { describe, expect, it } from "vitest";

let activation = null;
let entrypoint = null;
try {
  activation = await import("../src/activation");
} catch {
  activation = null;
}
try {
  entrypoint = await import("../src/index");
} catch {
  entrypoint = null;
}

class FakePi {
  tools: { name: string }[] = [];
  active: string[] = [];
  handlers: Record<string, ((...args: unknown[]) => unknown)[]> = {};
  registerTool(def: { name: string }) {
    this.tools.push(def);
  }
  on(event: string, handler: (...args: unknown[]) => unknown) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }
  async emit(event: string, ...args: unknown[]) {
    for (const h of this.handlers[event] ?? []) await h(...args, {});
  }
  getAllTools() {
    return this.tools.map((t) => ({ name: t.name }));
  }
  getActiveTools() {
    return [...this.active];
  }
  setActiveTools(names: string[]) {
    this.active = [...names];
  }
}

const notReady = (what: string) => {
  expect.fail(`not_ready: ${what} is not implemented`);
};

describe("abel_dispatch registration and activation facade", () => {
  it("registers the dispatcher in the catalogue but keeps it inactive by default", async () => {
    if (!entrypoint || !activation) return notReady("activation/entrypoint");
    const pi = new FakePi();
    entrypoint.default(pi as never);
    pi.active = ["read", "bash"];
    await pi.emit("session_start", { reason: "startup" });
    expect(pi.getAllTools().map((t) => t.name)).toContain("abel_dispatch");
    expect(pi.getActiveTools()).not.toContain("abel_dispatch");
  });

  it("preserves unrelated active tools on activation and deactivation", async () => {
    if (!activation) return notReady("activation");
    let active = ["read", "bash", "edit"];
    active = activation.activateTool(active, "abel_dispatch");
    expect(active).toEqual(["read", "bash", "edit", "abel_dispatch"]);
    active = activation.deactivateTool(active, "abel_dispatch");
    expect(active).toEqual(["read", "bash", "edit"]);
  });

  it("follows only the inactive -> pending -> active -> draining -> inactive state machine", async () => {
    if (!activation) return notReady("activation");
    const a = new activation.Activation();
    expect(a.state).toBe("inactive");
    expect(a.isActive()).toBe(false);
    expect(a.request()).toBe(true);
    expect(a.state).toBe("pending");
    expect(a.activate()).toBe(true);
    expect(a.state).toBe("active");
    expect(a.isActive()).toBe(true);
    expect(a.activate()).toBe(false);
    expect(a.drain()).toBe(true);
    expect(a.state).toBe("inactive");
    expect(a.drain()).toBe(false);
    expect(a.request()).toBe(true);
  });

  it("rejects illegal transitions", async () => {
    if (!activation) return notReady("activation");
    const a = new activation.Activation();
    expect(a.activate()).toBe(false);
    expect(a.state).toBe("inactive");
    const b = new activation.Activation();
    b.request();
    expect(b.drain()).toBe(false);
    expect(b.state).toBe("pending");
    const c = new activation.Activation();
    c.request();
    c.activate();
    expect(c.request()).toBe(false);
    expect(c.state).toBe("active");
  });

  it("removes only the dispatcher on session_start while another tool survives", async () => {
    if (!entrypoint) return notReady("entrypoint");
    const pi = new FakePi();
    entrypoint.default(pi as never);
    pi.active = ["read", "bash", "abel_dispatch"];
    await pi.emit("session_start", { reason: "reload" });
    expect(pi.getActiveTools()).toEqual(["read", "bash"]);
  });
});
