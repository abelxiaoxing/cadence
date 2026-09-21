import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import register from "../src/index.ts";
import { STARTUP_CARD_KEY, startupCardLines } from "../src/startup-card.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-card-"));
  roots.push(root);
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  return {
    cwd,
    home,
    projectTrusted: true,
    projectFile: path.join(cwd, ".pi", "cadence", ".env"),
    userFile: path.join(home, ".pi", "agent", "cadence", ".env"),
  };
}
function write(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
function displayedPath(file: string) {
  return JSON.stringify(file).slice(1, -1);
}
function harness(registrar = register) {
  const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
  let active = ["read", "bash"];
  const pi = {
    on(name: string, handler: (...args: any[]) => unknown) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerTool: vi.fn(),
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    appendEntry: vi.fn(),
    registerCommand: vi.fn(),
  };
  registrar(pi as never);
  return {
    pi,
    active: () => active,
    async emit(name: string, ctx: unknown, reason = "startup") {
      for (const handler of handlers.get(name) ?? [])
        await handler({ reason }, ctx);
    },
  };
}

describe("Cadence startup configuration card", () => {
  it("shows actionable zero-config guidance without writing files or using the network", () => {
    const input = fixture();
    const fetch = vi.fn(() => {
      throw new Error("no network");
    });
    vi.stubGlobal("fetch", fetch);
    const lines = startupCardLines(input);
    expect(lines).toHaveLength(7);
    const text = lines.join("\n");
    expect(text).toContain("匿名模式，无需密钥");
    expect(text).toContain("待配置 GROK_API_URL、GROK_API_KEY");
    expect(text).toContain(displayedPath(input.userFile));
    expect(text).toContain("不读取 shell API 变量");
    expect(text).toContain("未联网验证");
    expect(() => readFileSync(input.userFile)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not expose keys, URLs, models or arbitrary configuration fields", () => {
    const input = fixture();
    write(
      input.userFile,
      [
        "GROK_API_URL=https://sensitive.invalid/private-token?key=secret",
        "GROK_API_KEY=secret-grok",
        "GROK_MODEL=secret-model",
        "CONTEXT7_API_KEY=secret-context7",
        "TAVILY_API_KEY=secret-tavily",
        "UNKNOWN=secret-unknown",
      ].join("\n"),
    );
    const text = startupCardLines(input).join("\n");
    expect(text).toContain("Grok：已配置");
    expect(text).toContain("Context7：已配置密钥");
    expect(text).toContain("Tavily：已配置");
    expect(text).not.toMatch(/secret|sensitive|private-token/);
  });

  it("reports project whole-file shadowing and never fills missing keys from the user file", () => {
    const input = fixture();
    write(
      input.userFile,
      "GROK_API_URL=https://example.test\nGROK_API_KEY=secret\n",
    );
    write(input.projectFile, "CONTEXT7_API_KEY=\n");
    const text = startupCardLines(input).join("\n");
    expect(text).toContain(displayedPath(input.projectFile));
    expect(text).toContain("项目整文件优先，不合并用户配置");
    expect(text).toContain("待配置 GROK_API_URL、GROK_API_KEY");
    expect(readFileSync(input.projectFile, "utf8")).toBe("CONTEXT7_API_KEY=\n");
  });

  it("handles invalid syntax without leaking source or falling back", () => {
    const input = fixture();
    write(input.projectFile, "secret invalid contents");
    write(
      input.userFile,
      "GROK_API_URL=https://example.test\nGROK_API_KEY=secret\n",
    );
    const text = startupCardLines(input).join("\n");
    expect(text).toContain("无法读取或解析");
    expect(text).toContain(displayedPath(input.projectFile));
    expect(text).not.toContain("secret");
    expect(text).not.toContain("Grok：已配置");
  });

  it("reports invalid endpoints and explicit Tavily opt-out", () => {
    const input = fixture();
    write(
      input.userFile,
      "GROK_API_URL=secret-invalid\nGROK_API_KEY=secret\nCONTEXT7_API_URL=file:///secret\nTAVILY_API_KEY=secret\nTAVILY_ENABLED=false\n",
    );
    const text = startupCardLines(input).join("\n");
    expect(text).toContain("GROK_API_URL 格式无效");
    expect(text).toContain("CONTEXT7_API_URL 格式无效");
    expect(text).toContain("Tavily：已关闭");
    expect(text).not.toContain("secret");
  });

  it("does not inspect research files before project trust", () => {
    const input = fixture();
    write(input.projectFile, "broken secret");
    const text = startupCardLines({ ...input, projectTrusted: false }).join(
      "\n",
    );
    expect(text).toContain("未读取研究配置");
    expect(text).not.toContain("无法读取或解析");
    expect(text).not.toContain(input.projectFile);
  });

  it.each(["tui", "rpc"])(
    "shows on every load/reload/resume in %s, clears only its own widget",
    async (mode) => {
      const input = fixture();
      const h = harness();
      const setWidget = vi.fn();
      const ctx = {
        cwd: input.cwd,
        hasUI: true,
        mode,
        isProjectTrusted: () => true,
        ui: { setWidget },
      };
      for (const reason of [
        "startup",
        "reload",
        "reload",
        "new",
        "resume",
        "fork",
      ]) {
        await h.emit("session_start", ctx, reason);
      }
      expect(setWidget).toHaveBeenCalledTimes(6);
      expect(
        setWidget.mock.calls.every(
          ([key, lines]) => key === STARTUP_CARD_KEY && Array.isArray(lines),
        ),
      ).toBe(true);
      await h.emit("agent_start", ctx);
      expect(setWidget).toHaveBeenLastCalledWith(STARTUP_CARD_KEY, undefined);
      await h.emit("session_shutdown", ctx);
      expect(setWidget).toHaveBeenLastCalledWith(STARTUP_CARD_KEY, undefined);
      expect(h.pi.sendMessage).not.toHaveBeenCalled();
      expect(h.pi.sendUserMessage).not.toHaveBeenCalled();
      expect(h.pi.appendEntry).not.toHaveBeenCalled();
      expect(h.pi.registerCommand).not.toHaveBeenCalled();
    },
  );

  it.each(["print", "json"])(
    "does not prompt, inspect configuration or pollute stdout in %s",
    async (mode) => {
      const h = harness();
      const isProjectTrusted = vi.fn();
      const setWidget = vi.fn();
      const ctx = { hasUI: false, mode, isProjectTrusted, ui: { setWidget } };
      await h.emit("session_start", ctx);
      await h.emit("agent_start", ctx);
      await h.emit("session_shutdown", ctx);
      expect(isProjectTrusted).not.toHaveBeenCalled();
      expect(setWidget).not.toHaveBeenCalled();
    },
  );

  it("the shipped entrypoint registers the card without activating a stage or adding commands", async () => {
    const input = fixture();
    const h = harness(register);
    const setWidget = vi.fn();
    const ctx = {
      cwd: input.cwd,
      hasUI: true,
      mode: "rpc",
      isProjectTrusted: () => true,
      ui: { setWidget },
    };
    await h.emit("session_start", ctx);
    expect(setWidget).toHaveBeenCalledWith(STARTUP_CARD_KEY, expect.any(Array));
    expect(h.active()).toEqual(["read", "bash"]);
    expect(h.pi.registerCommand).not.toHaveBeenCalled();
    await h.emit("session_shutdown", ctx);
  });
});
