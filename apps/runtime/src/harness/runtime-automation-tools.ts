import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { AutomationRegistryTools, RuntimeToolExecutionContext } from "./runtime-tool-executor.js";
import { approvalRequestLanguage, stringArg } from "./runtime-tool-approval.js";

export function automationToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  switch (toolId) {
    case "automations.list":
      return {
        promptExample: "{\"tool\":\"automations.list\",\"args\":{\"includePaused\":true}}",
        execute: (args, context) => ({ output: listRuntimeAutomations(context.automationRegistry, args) }),
      };
    case "automations.get":
      return {
        promptExample: "{\"tool\":\"automations.get\",\"args\":{\"id\":\"automation-123\"}}",
        execute: (args, context) => ({ output: getRuntimeAutomation(context.automationRegistry, args) }),
      };
    case "automations.previewSchedule":
      return {
        promptExample: "{\"tool\":\"automations.previewSchedule\",\"args\":{\"schedule\":{\"kind\":\"rrule\",\"rrule\":\"FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0\",\"timezone\":\"Asia/Shanghai\"},\"limit\":3}}",
        execute: (args, context) => ({ output: previewRuntimeAutomationSchedule(context.automationRegistry, args) }),
      };
    case "automations.create":
      return riskyAutomationTool("{\"tool\":\"automations.create\",\"args\":{\"title\":\"Daily status review\",\"prompt\":\"Summarize project status.\",\"schedule\":{\"kind\":\"rrule\",\"rrule\":\"FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0\",\"timezone\":\"Asia/Shanghai\"},\"status\":\"active\",\"modeSelection\":\"manual\",\"taskIntent\":\"plan\",\"skillIds\":[],\"toolIds\":[],\"runConfig\":{}}}", (args, context) => ({ output: createRuntimeAutomation(context.automationRegistry, args) }));
    case "automations.update":
      return riskyAutomationTool("{\"tool\":\"automations.update\",\"args\":{\"id\":\"automation-123\",\"title\":\"Updated daily review\"}}", (args, context) => ({ output: updateRuntimeAutomation(context.automationRegistry, args) }));
    case "automations.pause":
      return riskyAutomationTool("{\"tool\":\"automations.pause\",\"args\":{\"id\":\"automation-123\"}}", (args, context) => ({ output: pauseRuntimeAutomation(context.automationRegistry, args) }));
    case "automations.resume":
      return riskyAutomationTool("{\"tool\":\"automations.resume\",\"args\":{\"id\":\"automation-123\"}}", (args, context) => ({ output: resumeRuntimeAutomation(context.automationRegistry, args) }));
    case "automations.delete":
      return riskyAutomationTool("{\"tool\":\"automations.delete\",\"args\":{\"id\":\"automation-123\"}}", (args, context) => ({ output: deleteRuntimeAutomation(context.automationRegistry, args) }));
    case "automations.runNow":
      return riskyAutomationTool("{\"tool\":\"automations.runNow\",\"args\":{\"id\":\"automation-123\"}}", (args, context) => ({ output: runRuntimeAutomationNow(context.automationRegistry, args) }));
    default:
      return {};
  }
}

function riskyAutomationTool(
  promptExample: string,
  execute: NonNullable<RuntimeToolDefinition<RuntimeToolExecutionContext>["execute"]>,
): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  return {
    promptExample,
    requiresApprovalCopy: true,
    actionRiskLevel: () => "high",
    approvalRequest: automationApprovalRequest,
    execute,
  };
}

function automationApprovalRequest(args: Record<string, unknown>, context: { toolId: string; userPrompt?: string }) {
  const zh = approvalRequestLanguage({ userPrompt: context.userPrompt }) === "zh";
  const action = automationActionLabel(context.toolId, zh);
  const title = stringArg(args, "title", zh ? "这个定时任务" : "this scheduled task");
  return zh
    ? {
        title: `需要你确认${action}`,
        summary: `我准备${action}“${title}”。`,
        whatWillChange: context.toolId === "automations.runNow"
          ? "会立即启动一次定时任务运行，并写入运行历史。"
          : "会改变 Ora 本地定时任务配置或状态。",
        whyNeeded: "这是完成你刚才要求管理定时任务的必要步骤。",
        riskNote: "定时任务会在未来自动触发 agent，请确认调度、目标和影响范围正确。",
        confirmLabel: "批准并继续",
      }
    : {
        title: `Confirm ${action}`,
        summary: `I am ready to ${action} "${title}".`,
        whatWillChange: context.toolId === "automations.runNow"
          ? "This will start one scheduled task run now and write run history."
          : "This will change local Ora scheduled task configuration or state.",
        whyNeeded: "This is required to manage the scheduled task you requested.",
        riskNote: "Scheduled tasks can trigger agents later, so confirm the schedule, goal, and impact first.",
        confirmLabel: "Approve and continue",
      };
}

function automationActionLabel(toolId: string, zh: boolean): string {
  switch (toolId) {
    case "automations.create":
      return zh ? "创建定时任务" : "create the scheduled task";
    case "automations.update":
      return zh ? "更新定时任务" : "update the scheduled task";
    case "automations.pause":
      return zh ? "暂停定时任务" : "pause the scheduled task";
    case "automations.resume":
      return zh ? "恢复定时任务" : "resume the scheduled task";
    case "automations.delete":
      return zh ? "删除定时任务" : "delete the scheduled task";
    case "automations.runNow":
      return zh ? "立即运行定时任务" : "run the scheduled task now";
    default:
      return zh ? "管理定时任务" : "manage the scheduled task";
  }
}

function listRuntimeAutomations(automationRegistry: AutomationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!automationRegistry) {
    throw new Error("An automation registry is required for automations.list.");
  }
  return automationRegistry.listAutomations(args);
}

function getRuntimeAutomation(automationRegistry: AutomationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!automationRegistry) {
    throw new Error("An automation registry is required for automations.get.");
  }
  return automationRegistry.getAutomation(args);
}

function previewRuntimeAutomationSchedule(automationRegistry: AutomationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!automationRegistry) {
    throw new Error("An automation registry is required for automations.previewSchedule.");
  }
  return automationRegistry.previewAutomationSchedule(args);
}

function createRuntimeAutomation(automationRegistry: AutomationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!automationRegistry) {
    throw new Error("An automation registry is required for automations.create.");
  }
  return automationRegistry.createAutomation(args);
}

function updateRuntimeAutomation(automationRegistry: AutomationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!automationRegistry) {
    throw new Error("An automation registry is required for automations.update.");
  }
  return automationRegistry.updateAutomation(args);
}

function pauseRuntimeAutomation(automationRegistry: AutomationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!automationRegistry) {
    throw new Error("An automation registry is required for automations.pause.");
  }
  return automationRegistry.pauseAutomation(args);
}

function resumeRuntimeAutomation(automationRegistry: AutomationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!automationRegistry) {
    throw new Error("An automation registry is required for automations.resume.");
  }
  return automationRegistry.resumeAutomation(args);
}

function deleteRuntimeAutomation(automationRegistry: AutomationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!automationRegistry) {
    throw new Error("An automation registry is required for automations.delete.");
  }
  return automationRegistry.deleteAutomation(args);
}

function runRuntimeAutomationNow(automationRegistry: AutomationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!automationRegistry) {
    throw new Error("An automation registry is required for automations.runNow.");
  }
  return automationRegistry.runAutomationNow(args);
}
