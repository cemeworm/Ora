import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { ModeRegistryTools, RuntimeToolExecutionContext } from "./runtime-tool-executor.js";
import { prefersChinese } from "./runtime-tool-approval.js";

export function modeToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  switch (toolId) {
    case "modes.list":
      return {
        promptExample: "{\"tool\":\"modes.list\",\"args\":{}}",
        execute: (_args, context) => ({ output: listRuntimeModes(context.modeRegistry) }),
      };
    case "modes.generateDraft":
      return {
        promptExample: "{\"tool\":\"modes.generateDraft\",\"args\":{\"messages\":[{\"role\":\"user\",\"content\":\"I want a code review mode with a generator and a reviewer\"}]}}",
        execute: (args, context) => ({ output: generateRuntimeModeDraft(context.modeRegistry, args) }),
      };
    case "modes.refineDraft":
      return {
        promptExample: "{\"tool\":\"modes.refineDraft\",\"args\":{\"messages\":[{\"role\":\"user\",\"content\":\"Add a security review step\"}],\"draftBundle\":{...}}}",
        execute: (args, context) => ({ output: refineRuntimeModeDraft(context.modeRegistry, args) }),
      };
    case "modes.validate":
      return {
        promptExample: "{\"tool\":\"modes.validate\",\"args\":{\"draftBundle\":{...}}}",
        execute: (args, context) => ({ output: validateRuntimeModeDraft(context.modeRegistry, args) }),
      };
    case "modes.applyDraft":
      return {
        promptExample: "{\"tool\":\"modes.applyDraft\",\"args\":{\"draftBundle\":{...},\"saveAgentDrafts\":true}}",
        requiresApprovalCopy: true,
        actionRiskLevel: () => "high",
        approvalRequest: modeApplyApprovalRequest,
        execute: (args, context) => ({ output: applyRuntimeModeDraft(context.modeRegistry, args) }),
      };
    default:
      return {};
  }
}

function modeApplyApprovalRequest(_args: Record<string, unknown>, context: { userPrompt?: string }) {
  const zh = prefersChinese(context.userPrompt);
  const draftLabel = zh ? "这个协调模式" : "this coordination mode";
  return zh
    ? {
        title: "需要你确认创建模式",
        summary: `我准备将${draftLabel}写入 Ora 配置，并可选地创建关联的 agent 草稿。`,
        whatWillChange: "会新增或更新一个协调模式条目，后续运行可以使用该模式。",
        whyNeeded: "这是完成你刚才要求创建协调模式的必要步骤。",
        riskNote: "创建模式会影响运行时可用的协调拓扑，请确认内容和配置正确。",
        confirmLabel: "批准并继续",
      }
    : {
        title: "Confirm mode creation",
        summary: `I am ready to write ${draftLabel} into Ora configuration and optionally create associated agent drafts.`,
        whatWillChange: "A coordination mode entry will be added or updated so future runs can use it.",
        whyNeeded: "This is needed to finish the mode creation you requested.",
        riskNote: "Creating a mode affects the coordination topologies available at runtime, so confirm the content and configuration are correct.",
        confirmLabel: "Approve and continue",
      };
}

function listRuntimeModes(modeRegistry: ModeRegistryTools | undefined) {
  if (!modeRegistry) {
    throw new Error("A mode registry is required for modes.list.");
  }
  return { modes: modeRegistry.listModes() };
}

function generateRuntimeModeDraft(modeRegistry: ModeRegistryTools | undefined, args: Record<string, unknown>) {
  if (!modeRegistry) {
    throw new Error("A mode registry is required for modes.generateDraft.");
  }
  return modeRegistry.generateModeStudioDraft(args);
}

function refineRuntimeModeDraft(modeRegistry: ModeRegistryTools | undefined, args: Record<string, unknown>) {
  if (!modeRegistry) {
    throw new Error("A mode registry is required for modes.refineDraft.");
  }
  return modeRegistry.refineModeStudioDraft(args);
}

function validateRuntimeModeDraft(modeRegistry: ModeRegistryTools | undefined, args: Record<string, unknown>) {
  if (!modeRegistry) {
    throw new Error("A mode registry is required for modes.validate.");
  }
  return modeRegistry.validateModeStudioDraft(args);
}

function applyRuntimeModeDraft(modeRegistry: ModeRegistryTools | undefined, args: Record<string, unknown>) {
  if (!modeRegistry) {
    throw new Error("A mode registry is required for modes.applyDraft.");
  }
  return modeRegistry.applyModeStudioDraft(args);
}
