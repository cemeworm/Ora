import {
  CODE_DEVELOPMENT_MODE_ID,
  type ModeSpec,
} from "@cemeworm/shared";
import type {
  RuntimeToolCall,
  RuntimeToolExecutor,
} from "./runtime-tool-executor.js";

const CODE_DEVELOPMENT_ORCHESTRATOR_BLOCKED_TOOLS = new Set([
  "file.write",
  "file.patch",
  "file.apply_patch",
  "file.delete",
  "modes.applyDraft",
  "selfIteration.apply",
  "skills.create",
  "skills.update",
  "skills.setEnabled",
]);

export function codeDevelopmentToolBoundaryError(params: {
  modeSpec: ModeSpec;
  agentId: string;
  toolCall: RuntimeToolCall;
  runtimeToolExecutor: RuntimeToolExecutor;
}): string | undefined {
  if (params.modeSpec.id !== CODE_DEVELOPMENT_MODE_ID || params.agentId !== "orchestrator") {
    return undefined;
  }
  const isBlockedStaticTool = CODE_DEVELOPMENT_ORCHESTRATOR_BLOCKED_TOOLS.has(params.toolCall.tool);
  const isHighRiskShell =
    params.toolCall.tool === "shell.execute" &&
    params.runtimeToolExecutor.riskLevel(params.toolCall) === "high";
  if (!isBlockedStaticTool && !isHighRiskShell) {
    return undefined;
  }
  return "Code Development boundary violation: Orchestrator may plan and finalize, but code mutations must run in the Builder stage.";
}
