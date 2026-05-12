import { describe, expect, it } from "vitest";
import {
  CODE_DEVELOPMENT_MODE_ID,
  DEERFLOW_HARNESS_MODE_ID,
  SINGLE_AGENT_MODE_ID,
} from "@cemeworm/shared";
import {
  debuggerModeLabel,
  debuggerTrailTabLabel,
  modeShortlistCards,
  type DebuggerTrailTab,
} from "./debuggerSurface";
import type { ModeCard } from "../types";

const modes: ModeCard[] = [
  {
    id: "message_bus",
    family: "message_bus",
    label: "Message Bus",
    summary: "Routed events.",
    recommendedUse: "Routing.",
    failureMode: "Overhead.",
    isPreset: true,
  },
  {
    id: CODE_DEVELOPMENT_MODE_ID,
    family: "agent_teams",
    label: "Code Development",
    summary: "Plan, build, review.",
    recommendedUse: "Code.",
    failureMode: "Coordination overhead.",
    isPreset: true,
  },
  {
    id: SINGLE_AGENT_MODE_ID,
    family: "orchestrator_subagent",
    label: "Single Agent",
    summary: "One accountable agent.",
    recommendedUse: "Simple work.",
    failureMode: "Blind spots.",
    isPreset: true,
  },
  {
    id: DEERFLOW_HARNESS_MODE_ID,
    family: "orchestrator_subagent",
    label: "DeerFlow-like Harness",
    summary: "Delegated long task.",
    recommendedUse: "Long work.",
    failureMode: "Delegation overhead.",
    isPreset: true,
  },
];

describe("debugger surface", () => {
  it("keeps the default 0.3 mode surface to three debugger presets", () => {
    expect(modeShortlistCards(modes).map((mode) => mode.id)).toEqual([
      SINGLE_AGENT_MODE_ID,
      CODE_DEVELOPMENT_MODE_ID,
      DEERFLOW_HARNESS_MODE_ID,
    ]);
  });

  it("labels the three shortlisted modes with product-facing names", () => {
    expect(modeShortlistCards(modes).map(debuggerModeLabel)).toEqual([
      "Fast Solo",
      "Plan -> Build -> Review",
      "Recoverable Long Task",
    ]);
  });

  it("uses four debugger-first trail workspaces", () => {
    const tabs: DebuggerTrailTab[] = ["diagnosis", "timeline", "compare", "raw"];
    expect(tabs.map(debuggerTrailTabLabel)).toEqual([
      "诊断",
      "时间线",
      "对比",
      "原始数据",
    ]);
  });
});
