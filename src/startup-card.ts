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
  const lines: string[] = [];
  if (!options.projectTrusted) {
    return ["Cadence：当前项目未信任，未读取研究配置。"];
  }

  let selectedPath: string | null = null;
  try {
    selectedPath = selectConfigPath(options);
    const { values } = loadConfig({ ...options, allowMissing: true });
    const context7UrlValid = validUrl(
      values.CONTEXT7_API_URL || "https://context7.com/api/v2",
    );
    const context7 = !context7UrlValid
      ? "CONTEXT7_API_URL 格式无效"
      : values.CONTEXT7_API_KEY
        ? "已配置密钥"
        : "匿名模式，无需密钥";
    const missing = ["GROK_API_URL", "GROK_API_KEY"].filter(
      (name) => !values[name],
    );
    const grokUrlValid = !missing.length && validUrl(values.GROK_API_URL);
    const grok = missing.length
      ? `待配置 ${missing.join("、")}`
      : !grokUrlValid
        ? "GROK_API_URL 格式无效"
        : "已配置";
    const tavilyUrlValid = validUrl(
      values.TAVILY_API_URL || "https://api.tavily.com",
    );
    const tavily =
      values.TAVILY_ENABLED === "false"
        ? "已关闭"
        : !values.TAVILY_API_KEY
          ? "未配置（可选）"
          : !tavilyUrlValid
            ? "TAVILY_API_URL 格式无效"
            : "已配置";
    lines.push(`Context7：${context7}｜Grok：${grok}｜Tavily：${tavily}`);
  } catch {
    lines.push("研究配置无法读取或解析：请检查配置文件；未回退到其他配置。");
  }

  const userPath = path.join(options.home, ".pi", "agent", "cadence", ".env");
  lines.unshift(
    selectedPath
      ? `Cadence配置文件：${displayPath(selectedPath)}`
      : `Cadence配置文件：${displayPath(userPath)}（未创建）`,
  );
  return lines;
}
