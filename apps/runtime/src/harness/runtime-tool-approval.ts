import type { ActionApprovalRequestCopy } from "@cemeworm/shared";
import { prefersChineseResponse, type RuntimeResponseLanguage } from "./runtime-language.js";

export function prefersChinese(text: string | undefined): boolean {
  return typeof text === "string" && /[\u3400-\u9fff]/.test(text);
}

export function approvalRequestLanguage(params: {
  userPrompt?: string;
  context?: Record<string, unknown>;
  language?: RuntimeResponseLanguage;
}): RuntimeResponseLanguage {
  return prefersChineseResponse(params) ? "zh" : "en";
}

export function stringArg(args: Record<string, unknown>, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function genericApprovalRequest(userPrompt?: string): ActionApprovalRequestCopy {
  const zh = approvalRequestLanguage({ userPrompt }) === "zh";
  return zh
    ? {
        title: "需要你确认后继续",
        summary: "我准备执行一项会影响本地环境的操作。",
        whatWillChange: "操作完成后，本地状态可能发生变化。",
        whyNeeded: "这是继续当前任务所需的步骤。",
        riskNote: "请确认这符合你的预期后再继续。",
        confirmLabel: "批准并继续",
      }
    : {
        title: "Confirm before continuing",
        summary: "I am ready to perform an action that can affect the local environment.",
        whatWillChange: "Local state may change after the action completes.",
        whyNeeded: "This step is needed to continue the current task.",
        riskNote: "Confirm this matches your expectations before continuing.",
        confirmLabel: "Approve and continue",
      };
}
