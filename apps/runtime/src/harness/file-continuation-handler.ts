import type { ActionRecord } from "@cemeworm/shared";
import type { ApprovedToolContinuationHandler } from "./approved-tool-continuation-handler.js";
import { fileChangeArtifact } from "./file-change-artifact.js";
import { isRuntimeToolImplemented, RuntimeToolExecutor, type RuntimeToolId } from "./runtime-tool-executor.js";
import type { RuntimeToolExecutionContext, RuntimeToolExecutionResult } from "./runtime-tool-executor.js";
import { continuationHandlerRegistry } from "./approved-tool-continuation-handler.js";

const FILE_CONTINUABLE_TOOL_IDS = new Set<string>([
  "file.read",
  "file.write",
  "file.patch",
  "file.apply_patch",
]);

class FileContinuationHandler implements ApprovedToolContinuationHandler {
  canReplay(action: ActionRecord): boolean {
    return FILE_CONTINUABLE_TOOL_IDS.has(action.type);
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
      searchProvider: context.searchProvider,
      toolLimits: context.limits,
      packageManager: context.packageManager,
      signal: context.signal,
    });
    return executor.executeWithMetadata(
      { tool: action.type as RuntimeToolId, args },
      {
        allowRisky,
        currentAgentId: context.currentAgentId,
        currentNodeId: context.currentNodeId,
        currentNodeLabel: context.currentNodeLabel,
        clarificationAnswer: context.clarificationAnswer,
        ensureClarification: context.ensureClarification,
        signal: context.signal,
      },
    );
  }

  buildArtifact(
    result: RuntimeToolExecutionResult,
    params: { runId: string; artifactIndex: number; createdAt: number },
  ): unknown {
    if (!result.fileChange) {
      return undefined;
    }
    return fileChangeArtifact({
      runId: params.runId,
      artifactIndex: params.artifactIndex,
      fileChange: result.fileChange,
      createdAt: params.createdAt,
    });
  }

  shouldContinueKernelAfterTool(_result: RuntimeToolExecutionResult): boolean {
    return true;
  }
}

export const fileContinuationHandler = new FileContinuationHandler();

export function registerFileContinuationHandler(): void {
  for (const toolId of FILE_CONTINUABLE_TOOL_IDS) {
    continuationHandlerRegistry.register(toolId, fileContinuationHandler);
  }
}
