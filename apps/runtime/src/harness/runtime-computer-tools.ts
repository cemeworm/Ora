import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { RuntimeToolExecutionContext } from "./runtime-tool-executor.js";
import { prefersChinese, stringArg } from "./runtime-tool-approval.js";
import type { ComputerTargetKind } from "@cemeworm/shared";

// ---------------------------------------------------------------------------
// Computer Tool Runtime Fields
// ---------------------------------------------------------------------------

const COMPUTER_OBSERVE_EXAMPLE = '{"tool":"computer.observe","args":{"target":"frontmost window"}}';
const COMPUTER_CLICK_EXAMPLE = '{"tool":"computer.click","args":{"target":"element-3","snapshotId":"snap-1"}}';

function resolveTargetKind(args: Record<string, unknown>): ComputerTargetKind {
  const kind = stringArg(args, "targetKind", "");
  if (kind === "native_app" || kind === "browser_page" || kind === "ora_view") {
    return kind;
  }
  return "native_app";
}

function getBackend(context: RuntimeToolExecutionContext, targetKind: ComputerTargetKind) {
  if (!context.computerBackendManager) {
    throw new Error("Computer use is not available in this runtime context. No backend manager configured.");
  }
  const backend = context.computerBackendManager.selectBackend(targetKind);
  if (!backend) {
    throw new Error(`No computer use backend available for target kind: ${targetKind}. Check computer.permissionStatus.`);
  }
  return backend;
}

// ---------------------------------------------------------------------------
// Approval Requests
// ---------------------------------------------------------------------------

function observeApprovalRequest(
  args: Record<string, unknown>,
  context: { toolId: string; userPrompt?: string },
) {
  const zh = prefersChinese(context.userPrompt);
  const target = stringArg(args, "target", "屏幕");
  return zh
    ? {
        title: "观察屏幕",
        summary: `准备观察：${target}`,
        whatWillChange: "不会修改任何内容。仅截取屏幕快照和 UI 元素信息。",
        whyNeeded: "需要先了解当前屏幕状态才能进行后续操作。",
        riskNote: "截图可能包含敏感信息，请确保屏幕内容适合被观察。",
        confirmLabel: "开始观察",
      }
    : {
        title: "Observe Screen",
        summary: `Ready to observe: ${target}`,
        whatWillChange: "No changes will be made. Only a screenshot and UI element summary will be captured.",
        whyNeeded: "Current screen state is needed before proceeding with further actions.",
        riskNote: "Screenshots may contain sensitive information. Ensure the screen content is safe to observe.",
        confirmLabel: "Start observing",
      };
}

function clickApprovalRequest(
  args: Record<string, unknown>,
  context: { toolId: string; userPrompt?: string },
) {
  const zh = prefersChinese(context.userPrompt);
  const target = stringArg(args, "target", "指定元素");
  return zh
    ? {
        title: "点击 UI 元素",
        summary: `准备点击：${target}`,
        whatWillChange: `将点击 ${target}，可能触发导航、提交或界面状态变更。`,
        whyNeeded: "这是完成任务所需的 GUI 交互步骤。",
        riskNote: "点击操作不可撤销，请确认目标是安全的。",
        confirmLabel: "确认点击",
      }
    : {
        title: "Click UI Element",
        summary: `Ready to click: ${target}`,
        whatWillChange: `Will click ${target}, which may trigger navigation, submission, or UI state changes.`,
        whyNeeded: "This GUI interaction is required to complete the current task.",
        riskNote: "Click actions cannot be undone. Confirm the target is safe.",
        confirmLabel: "Confirm click",
      };
}

function typeApprovalRequest(
  args: Record<string, unknown>,
  context: { toolId: string; userPrompt?: string },
) {
  const zh = prefersChinese(context.userPrompt);
  const rawText = stringArg(args, "text", "");
  const preview = rawText.length > 80 ? rawText.slice(0, 80) + "..." : rawText;
  const target = stringArg(args, "target", "当前焦点元素");
  return zh
    ? {
        title: "输入文本",
        summary: `准备输入文本到 ${target}`,
        whatWillChange: `将输入文本：${preview}`,
        whyNeeded: "需要在输入框中填入所需内容。",
        riskNote: "请确认输入内容正确。请勿在自动化中输入密码或敏感信息。",
        confirmLabel: "确认输入",
      }
    : {
        title: "Type Text",
        summary: `Ready to type into ${target}`,
        whatWillChange: `Will type text: ${preview}`,
        whyNeeded: "The input field needs to be filled with the required content.",
        riskNote: "Confirm the text content is correct. Do not type passwords or sensitive data through automation.",
        confirmLabel: "Confirm typing",
      };
}

function pressApprovalRequest(
  args: Record<string, unknown>,
  context: { toolId: string; userPrompt?: string },
) {
  const zh = prefersChinese(context.userPrompt);
  const keys = stringArg(args, "keys", "指定按键");
  return zh
    ? {
        title: "按键操作",
        summary: `准备按下：${keys}`,
        whatWillChange: `将发送按键：${keys}`,
        whyNeeded: "需要通过快捷键或特殊按键完成操作。",
        riskNote: "请确认按键组合不会触发危险操作（如强制退出、关机等）。",
        confirmLabel: "确认按键",
      }
    : {
        title: "Press Keys",
        summary: `Ready to press: ${keys}`,
        whatWillChange: `Will send keystroke: ${keys}`,
        whyNeeded: "A keyboard shortcut or special key is needed to complete the action.",
        riskNote: "Confirm the key combination is safe and won't trigger destructive actions.",
        confirmLabel: "Confirm keystroke",
      };
}

function scrollApprovalRequest(
  args: Record<string, unknown>,
  context: { toolId: string; userPrompt?: string },
) {
  const zh = prefersChinese(context.userPrompt);
  const direction = stringArg(args, "direction", "向下");
  return zh
    ? {
        title: "滚动",
        summary: `准备向${direction}滚动`,
        whatWillChange: "视口内容将发生滚动。",
        whyNeeded: "需要查看更多内容或定位到特定位置。",
        riskNote: "滚动通常无害，但请确认在正确的窗口/元素中操作。",
        confirmLabel: "确认滚动",
      }
    : {
        title: "Scroll",
        summary: `Ready to scroll ${direction}`,
        whatWillChange: "The viewport content will scroll.",
        whyNeeded: "More content needs to be viewed or a specific position needs to be located.",
        riskNote: "Scrolling is generally safe but confirm the target window/element is correct.",
        confirmLabel: "Confirm scroll",
      };
}

function windowApprovalRequest(
  args: Record<string, unknown>,
  context: { toolId: string; userPrompt?: string },
) {
  const zh = prefersChinese(context.userPrompt);
  const action = stringArg(args, "action", "操作");
  const app = stringArg(args, "app", "");
  return zh
    ? {
        title: "窗口管理",
        summary: `准备执行窗口操作：${action}${app ? ` (${app})` : ""}`,
        whatWillChange: `将执行 ${action} 操作`,
        whyNeeded: "需要管理应用窗口以继续任务。",
        riskNote: "窗口关闭可能导致未保存数据丢失。请确认操作安全。",
        confirmLabel: "确认操作",
      }
    : {
        title: "Window Management",
        summary: `Ready to ${action} window${app ? ` (${app})` : ""}`,
        whatWillChange: `Will ${action} the window.`,
        whyNeeded: "Window management is needed to continue the task.",
        riskNote: "Closing windows may lose unsaved data. Confirm this action is safe.",
        confirmLabel: "Confirm action",
      };
}

function windowRiskLevel(args: Record<string, unknown>): "low_risk" | "requires_approval" {
  const action = stringArg(args, "action", "");
  return action === "list" || action === "focus" ? "low_risk" : "requires_approval";
}

// ---------------------------------------------------------------------------
// Runtime Fields Factory
// ---------------------------------------------------------------------------

export function computerToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  switch (toolId) {
    case "computer.permissionStatus":
      return {
        promptExample: '{"tool":"computer.permissionStatus","args":{}}',
        requiresApprovalCopy: false,
        riskLevel: () => "safe",
        async execute(args, context) {
          const targetKind = resolveTargetKind(args);
          if (context.computerBackendManager) {
            const result = await context.computerBackendManager.permissionStatus(targetKind);
            return { output: result };
          }
          return { output: noBackendStatus() };
        },
      };

    case "computer.observe":
      return {
        promptExample: COMPUTER_OBSERVE_EXAMPLE,
        requiresApprovalCopy: true,
        riskLevel: () => "low_risk",
        approvalRequest: observeApprovalRequest,
        async execute(args, context) {
          const targetKind = resolveTargetKind(args);
          const backend = getBackend(context, targetKind);
          const result = await backend.observe({
            target: stringArg(args, "target", "frontmost window"),
            targetKind,
            app: stringArg(args, "app", "") || undefined,
            windowTitle: stringArg(args, "windowTitle", "") || undefined,
            mode: (["full", "overview", "detail"].includes(stringArg(args, "mode", "")) ? stringArg(args, "mode", "") : "full") as "full" | "overview" | "detail",
            annotate: args.annotate !== false,
            maxElements: typeof args.maxElements === "number" ? args.maxElements : 50,
            includeScreenshot: args.includeScreenshot !== false,
            timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
            signal: context.signal,
          });
          return { output: result };
        },
      };

    case "computer.click":
      return {
        promptExample: COMPUTER_CLICK_EXAMPLE,
        requiresApprovalCopy: true,
        riskLevel: () => "requires_approval",
        approvalRequest: clickApprovalRequest,
        async execute(args, context) {
          const targetKind = resolveTargetKind(args);
          const backend = getBackend(context, targetKind);
          const result = await backend.click({
            target: stringArg(args, "target", ""),
            snapshotId: stringArg(args, "snapshotId", "") || undefined,
            targetKind,
            button: (["left", "right", "middle"].includes(stringArg(args, "button", "")) ? stringArg(args, "button", "") : "left") as "left" | "right" | "middle",
            clickCount: typeof args.clickCount === "number" ? args.clickCount : 1,
            waitFor: stringArg(args, "waitFor", "") || undefined,
            timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
            signal: context.signal,
          });
          return { output: result };
        },
      };

    case "computer.type":
      return {
        promptExample: '{"tool":"computer.type","args":{"text":"hello","target":"input-field"}}',
        requiresApprovalCopy: true,
        riskLevel: () => "requires_approval",
        approvalRequest: typeApprovalRequest,
        async execute(args, context) {
          const targetKind = resolveTargetKind(args);
          const backend = getBackend(context, targetKind);
          const result = await backend.type({
            text: stringArg(args, "text", ""),
            target: stringArg(args, "target", "") || undefined,
            snapshotId: stringArg(args, "snapshotId", "") || undefined,
            targetKind,
            clear: args.clear === true,
            delayMs: typeof args.delayMs === "number" ? args.delayMs : undefined,
            submit: args.submit === true,
            timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
            signal: context.signal,
          });
          return { output: result };
        },
      };

    case "computer.press":
      return {
        promptExample: '{"tool":"computer.press","args":{"keys":"cmd,l"}}',
        requiresApprovalCopy: true,
        riskLevel: () => "requires_approval",
        approvalRequest: pressApprovalRequest,
        async execute(args, context) {
          const targetKind = resolveTargetKind(args);
          const backend = getBackend(context, targetKind);
          const result = await backend.press({
            keys: stringArg(args, "keys", ""),
            count: typeof args.count === "number" ? args.count : 1,
            holdMs: typeof args.holdMs === "number" ? args.holdMs : undefined,
            targetKind,
            timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
            signal: context.signal,
          });
          return { output: result };
        },
      };

    case "computer.scroll":
      return {
        promptExample: '{"tool":"computer.scroll","args":{"direction":"down"}}',
        requiresApprovalCopy: true,
        riskLevel: () => "requires_approval",
        approvalRequest: scrollApprovalRequest,
        async execute(args, context) {
          const targetKind = resolveTargetKind(args);
          const backend = getBackend(context, targetKind);
          const result = await backend.scroll({
            target: stringArg(args, "target", "") || undefined,
            snapshotId: stringArg(args, "snapshotId", "") || undefined,
            targetKind,
            direction: (["up", "down", "left", "right"].includes(stringArg(args, "direction", "")) ? stringArg(args, "direction", "") : "down") as "up" | "down" | "left" | "right",
            amount: typeof args.amount === "number" ? args.amount : undefined,
            unit: (["lines", "pages"].includes(stringArg(args, "unit", "")) ? stringArg(args, "unit", "") : "lines") as "lines" | "pages",
            timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
            signal: context.signal,
          });
          return { output: result };
        },
      };

    case "computer.window":
      return {
        promptExample: '{"tool":"computer.window","args":{"action":"list"}}',
        requiresApprovalCopy: true,
        riskLevel: windowRiskLevel,
        approvalRequest: windowApprovalRequest,
        async execute(args, context) {
          const targetKind = resolveTargetKind(args);
          const backend = getBackend(context, targetKind);
          const result = await backend.window({
            action: stringArg(args, "action", "list") as ComputerWindowAction,
            app: stringArg(args, "app", "") || undefined,
            windowTitle: stringArg(args, "windowTitle", "") || undefined,
            targetKind,
            bounds: parseBoundsArg(args.bounds),
            timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
            signal: context.signal,
          });
          return { output: result };
        },
      };

    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ComputerWindowAction = "list" | "focus" | "move" | "resize" | "minimize" | "maximize" | "close";

function parseBoundsArg(raw: unknown): { x: number; y: number; width: number; height: number } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Record<string, unknown>;
  const x = typeof b.x === "number" ? b.x : NaN;
  const y = typeof b.y === "number" ? b.y : NaN;
  const width = typeof b.width === "number" ? b.width : NaN;
  const height = typeof b.height === "number" ? b.height : NaN;
  if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) return undefined;
  return { x, y, width, height };
}

function noBackendStatus() {
  return {
    backend: "none",
    targetKind: "native_app" as const,
    available: false,
    permissions: [],
    recoverableError: {
      code: "backend_unavailable" as const,
      message: "No computer use backend is configured. Install Peekaboo (npm install -g peekaboo) for macOS GUI automation.",
    },
  };
}
