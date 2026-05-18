const HIGH_RISK_TOOLS = [
  "shell",
  "file.write", "file.patch", "file.apply_patch", "file.delete", "file.move",
  "browser",
];
const MEDIUM_RISK_TOOLS = [
  "file.create",
  "git", "npm", "pnpm", "yarn",
  "agent.spawn",
  "plan.update",
  "mcp.call",
];

export function classifyToolRisk(toolId: string): "low" | "medium" | "high" {
  if (HIGH_RISK_TOOLS.some((prefix) => toolId === prefix || toolId.startsWith(`${prefix}.`))) return "high";
  if (MEDIUM_RISK_TOOLS.some((prefix) => toolId === prefix || toolId.startsWith(`${prefix}.`))) return "medium";
  return "low";
}

/** 工具类别判断 — 供 Router 和 Adapter 共用，避免两边工具列表不一致。 */

const SEARCH_TOOL_IDS = ["web.search", "web.fetch", "web_search", "web_fetch", "search", "browser.navigate"];

export function isSearchTool(toolId: string): boolean {
  return SEARCH_TOOL_IDS.some((t) => toolId === t || toolId.startsWith(`${t}.`));
}

const READ_CONTEXT_TOOL_IDS = [
  "file.read", "file.grep", "file.glob", "file.list",
  "file_read", "file_grep", "file_glob", "file_list",
  "read", "grep", "glob",
];

export function isReadContextTool(toolId: string): boolean {
  return READ_CONTEXT_TOOL_IDS.some((t) => toolId === t || toolId.startsWith(`${t}.`));
}
