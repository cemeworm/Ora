import type { ActionRecord } from "@cemeworm/shared";
import type { ApprovedToolContinuationHandler } from "./approved-tool-continuation-handler.js";
import { continuationHandlerRegistry } from "./approved-tool-continuation-handler.js";
import { isRuntimeToolImplemented, RuntimeToolExecutor, type RuntimeToolId } from "./runtime-tool-executor.js";
import type { RuntimeToolExecutionContext, RuntimeToolExecutionResult } from "./runtime-tool-executor.js";

const GENERIC_CONTINUABLE_TOOL_IDS = new Set<string>([
  "shell.execute",
  "skills.create",
  "skills.update",
  "skills.setEnabled",
  "skills.patch",
  "mcp.call",
  "package.promote",
  "package.switch",
  "package.rollback",
]);

class GenericContinuationHandler implements ApprovedToolContinuationHandler {
  canReplay(action: ActionRecord): boolean {
    return GENERIC_CONTINUABLE_TOOL_IDS.has(action.type);
  }

  async replay(
    action: ActionRecord,
    context: RuntimeToolExecutionContext,
    allowRisky: boolean,
  ): Promise<RuntimeToolExecutionResult> {
    if (!isRuntimeToolImplemented(action.type)) {
      throw new Error(`Unsupported runtime tool: ${action.type}`);
    }
    const args = action.input && typeof action.input === "object" && !Array.isArray(action.input)
      ? action.input as Record<string, unknown>
      : {};
    const executor = new RuntimeToolExecutor({
      workspace: context.workspace,
      hostFilesystem: context.hostFilesystem,
      fetchImpl: context.fetchImpl,
      skillRegistry: context.skillRegistry,
      modeRegistry: context.modeRegistry,
      selfIterationRegistry: context.selfIterationRegistry,
      automationRegistry: context.automationRegistry,
      mcpConfigPaths: context.mcpConfigPaths,
      searchProvider: context.searchProvider,
      toolLimits: context.limits,
      packageManager: context.packageManager,
      signal: context.signal,
      workspaceOperations: context.operations,
      permissionProfile: context.permissionProfile,
      taskIntent: context.taskIntent,
    });
    return executor.executeWithMetadata(
      { tool: action.type as RuntimeToolId, args },
      { allowRisky },
    );
  }

  shouldContinueKernelAfterTool(_result: RuntimeToolExecutionResult): boolean {
    return true;
  }
}

export const genericContinuationHandler = new GenericContinuationHandler();

export function registerGenericContinuationHandlers(): void {
  for (const toolId of GENERIC_CONTINUABLE_TOOL_IDS) {
    continuationHandlerRegistry.register(toolId, genericContinuationHandler);
  }
}
