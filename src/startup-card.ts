import path from "node:path";
import {
  loadConfig,
  selectConfigPath,
} from "../skills/_shared/load-config.mjs";

export const STARTUP_CARD_KEY = "cadence-configuration";

// Only code-owned labels and paths enter the UI; never values, endpoints,
// models, parser errors or credentials from the configuration file.
function displayPath(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function startupCardLines(options: {
  cwd: string;
  home: string;
  projectTrusted: boolean;
}): string[] {
  const lines = ["Cadence · 研究能力（仅本地配置检查，未联网验证）"];
  if (!options.projectTrusted) {
    return [
      ...lines,
      "尚未信任当前项目：未读取研究配置；信任项目后重新加载可查看状态。",
      "不自动启动 Abel 工作流；请勿在聊天中发送 API Key。",
    ];
  }

  let selectedPath: string | null = null;
  try {
    selectedPath = selectConfigPath(options);
    const { values } = loadConfig({ ...options, allowMissing: true });
    const context7 = !validUrl(
      values.CONTEXT7_API_URL || "https://context7.com/api/v2",
    )
      ? "CONTEXT7_API_URL 格式无效"
      : values.CONTEXT7_API_KEY
        ? "已配置密钥"
        : "匿名模式，无需密钥";
    const missing = ["GROK_API_URL", "GROK_API_KEY"].filter(
      (name) => !values[name],
    );
    const grok = missing.length
      ? `待配置 ${missing.join("、")}`
      : !validUrl(values.GROK_API_URL)
        ? "GROK_API_URL 格式无效"
        : "已配置";
    const tavily =
      values.TAVILY_ENABLED === "false"
        ? "已关闭"
        : !values.TAVILY_API_KEY
          ? "未配置（可选）"
          : !validUrl(values.TAVILY_API_URL || "https://api.tavily.com")
            ? "TAVILY_API_URL 格式无效"
            : "已配置（Grok Skill 仍需 Grok 配置）";
    lines.push(
      `文档查询 Context7：${context7}`,
      `联网搜索 Grok：${grok}；Tavily：${tavily}`,
    );
  } catch {
    lines.push("研究配置无法读取或解析：请检查下方文件；未回退到其他配置。");
  }

  const userPath = path.join(options.home, ".pi", "agent", "cadence", ".env");
  const projectPath = path.join(options.cwd, ".pi", "cadence", ".env");
  lines.push(
    selectedPath
      ? `生效文件：${displayPath(selectedPath)}${selectedPath === projectPath ? "（项目整文件优先，不合并用户配置）" : "（用户级，跨项目复用）"}`
      : `配置位置：${displayPath(userPath)}（用户级，跨项目复用）`,
    "在本地编辑该文件：GROK_API_URL=<服务地址>、GROK_API_KEY=<密钥>，每项一行；可选 TAVILY_API_KEY。",
    "研究 Skills 不读取 shell API 变量；保存后下次调用生效。不要把密钥发到聊天或提交到 Git。",
    "可选服务未配置不阻塞普通任务，也不自动启动 Abel 工作流。",
  );
  return lines;
}
