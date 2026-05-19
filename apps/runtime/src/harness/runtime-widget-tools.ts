import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { RuntimeToolExecutionContext } from "./runtime-tool-executor.js";

export function widgetToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  switch (toolId) {
    case "widgets.getSelectedContext":
      return {
        promptExample: "{\"tool\":\"widgets.getSelectedContext\",\"args\":{}}",
        promptSnippet: "When the user refers to the currently selected widget, use widgets.getSelectedContext if you need to confirm which widget is selected before acting.",
        execute: (_args, context) => ({ output: selectedWidgetContextFromTurn(context.turnContext) ?? null }),
      };
    case "widgets.get":
      return {
        promptExample: "{\"tool\":\"widgets.get\",\"args\":{\"id\":\"widget-123\"}}",
        promptSnippet: "Use widgets.get to inspect the persisted state of a widget before making a precise widget edit.",
        execute: (args, context) => ({ output: getRuntimeWidget(context, args) }),
      };
    case "widgets.todo.addItem":
      return {
        promptExample: "{\"tool\":\"widgets.todo.addItem\",\"args\":{\"title\":\"买药\",\"notes\":\"今天下午五点\",\"dueDate\":1770000000000}}",
        promptSnippet: "When the user asks to add or update the currently selected task widget, call widgets.todo.addItem instead of only saying the todo was added.",
        promptGuidelines: [
          "Omit widgetId only when the current turn already has a selected widget context.",
          "Preserve the user's requested time in dueDate when you can infer a concrete timestamp.",
          "Use notes for extra detail that should not be lost from the user's wording.",
        ],
        riskLevel: () => "low_risk",
        execute: (args, context) => ({ output: addRuntimeTodoItem(context, args) }),
      };
    default:
      return {};
  }
}

function getRuntimeWidget(
  context: RuntimeToolExecutionContext,
  args: Record<string, unknown>,
) {
  if (!context.widgetRegistry) {
    throw new Error("A widget registry is required for widgets.get.");
  }
  const widgetId = stringArg(args.widgetId ?? args.id);
  if (!widgetId) {
    throw new Error("widgets.get requires a non-empty id.");
  }
  const widget = context.widgetRegistry.getWidget({ id: widgetId });
  if (!widget) {
    throw new Error(`Widget not found: ${widgetId}`);
  }
  return widget;
}

function addRuntimeTodoItem(
  context: RuntimeToolExecutionContext,
  args: Record<string, unknown>,
) {
  if (!context.widgetRegistry) {
    throw new Error("A widget registry is required for widgets.todo.addItem.");
  }
  const title = stringArg(args.title);
  if (!title) {
    throw new Error("widgets.todo.addItem requires a non-empty title.");
  }
  const selectedWidgetId = selectedWidgetIdFromTurn(context.turnContext);
  const widgetId = stringArg(args.widgetId) ?? selectedWidgetId;
  if (!widgetId) {
    throw new Error("widgets.todo.addItem requires widgetId when no widget is selected in this turn.");
  }
  return context.widgetRegistry.addTodoWidgetItem({
    widgetId,
    title,
    ...(stringArg(args.notes) ? { notes: stringArg(args.notes) } : {}),
    ...(numberArg(args.dueDate) !== undefined ? { dueDate: numberArg(args.dueDate) } : {}),
    ...(numberArg(args.reminderAt) !== undefined ? { reminderAt: numberArg(args.reminderAt) } : {}),
  });
}

function selectedWidgetContextFromTurn(
  turnContext: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const selected = turnContext?.selectedWidgetContext;
  return isRecord(selected) ? selected : undefined;
}

function selectedWidgetIdFromTurn(turnContext: Record<string, unknown> | undefined): string | undefined {
  const selected = selectedWidgetContextFromTurn(turnContext);
  return stringArg(selected?.id);
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
