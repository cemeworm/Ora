import {
  CODE_DEVELOPMENT_MODE_ID,
  DEBATE_MODE_ID,
  SINGLE_AGENT_MODE_ID,
} from "@cemeworm/shared";
import type { ModeCard } from "../types";

export type DebuggerTrailTab = "diagnosis" | "timeline" | "compare" | "raw";

export const DEBUGGER_MODE_SHORTLIST = [
  {
    modeId: SINGLE_AGENT_MODE_ID,
    label: "Fast Solo",
    reason: "低协调开销，适合快速定位或复现一个 run。",
  },
  {
    modeId: CODE_DEVELOPMENT_MODE_ID,
    label: "Plan -> Build -> Review",
    reason: "显式计划、实施、审查和调试，适合可验证代码任务。",
  },
  {
    modeId: DEBATE_MODE_ID,
    label: "Multi-Agent Debate",
    reason: "多视角辩论与对抗审视，适合需要深度推敲的复杂任务。",
  },
] as const;

export function debuggerTrailTabLabel(tab: DebuggerTrailTab): string {
  switch (tab) {
    case "diagnosis":
      return "诊断";
    case "timeline":
      return "时间线";
    case "compare":
      return "对比";
    case "raw":
      return "原始数据";
  }
}

export function debuggerTrailTabDescription(tab: DebuggerTrailTab): string {
  switch (tab) {
    case "diagnosis":
      return "失败点、阻塞关卡、恢复建议和下一步动作。";
    case "timeline":
      return "关键路径、智能体、工具、延迟和恢复循环。";
    case "compare":
      return "同一 session 中 before/after run 的成本、工具、关卡和结果差异。";
    case "raw":
      return "trace、checkpoint、artifact、plan 和 snapshot 证据；这是完整回放入口。";
  }
}

export function modeShortlistCards(modeCards: readonly ModeCard[]): ModeCard[] {
  const byId = new Map(modeCards.map((mode) => [mode.id, mode]));
  return DEBUGGER_MODE_SHORTLIST
    .map((preset) => byId.get(preset.modeId))
    .filter((mode): mode is ModeCard => Boolean(mode));
}

export function isShortlistedDebuggerMode(modeId: string): boolean {
  return DEBUGGER_MODE_SHORTLIST.some((preset) => preset.modeId === modeId);
}

export function debuggerModeLabel(mode: ModeCard): string {
  return DEBUGGER_MODE_SHORTLIST.find((preset) => preset.modeId === mode.id)?.label ?? mode.label;
}

export function debuggerModeReason(mode: ModeCard): string {
  return DEBUGGER_MODE_SHORTLIST.find((preset) => preset.modeId === mode.id)?.reason ?? mode.summary;
}
