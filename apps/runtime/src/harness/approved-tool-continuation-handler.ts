import type { ActionRecord, OraEventEnvelope, StateSnapshot } from "@cemeworm/shared";
import type { RuntimeToolExecutionContext, RuntimeToolExecutionResult } from "./runtime-tool-executor.js";

/**
 * Handler registered per tool family for approved tool continuation.
 * Decouples continuation replay from file-specific logic.
 */
export interface ApprovedToolContinuationHandler {
  /** Whether this handler can replay the given approved action. */
  canReplay(action: ActionRecord): boolean;
  /** Execute the approved tool action and return the result. */
  replay(
    action: ActionRecord,
    executorContext: RuntimeToolExecutionContext,
    allowRisky: boolean,
  ): Promise<RuntimeToolExecutionResult>;
  /** Produce artifact metadata from the execution result. */
  buildArtifact?(
    result: RuntimeToolExecutionResult,
    params: { runId: string; artifactIndex: number; createdAt: number },
  ): unknown;
  /** Whether the kernel should continue after this tool result. Default true. */
  shouldContinueKernelAfterTool(result: RuntimeToolExecutionResult): boolean;
}

/**
 * Registry that maps tool IDs to their continuation handlers.
 */
export class ContinuationHandlerRegistry {
  private readonly handlers = new Map<string, ApprovedToolContinuationHandler>();

  register(toolId: string, handler: ApprovedToolContinuationHandler): void {
    this.handlers.set(toolId, handler);
  }

  get(toolId: string): ApprovedToolContinuationHandler | undefined {
    return this.handlers.get(toolId);
  }

  /**
   * Returns the set of tool IDs with registered continuation handlers.
   */
  get supportedToolIds(): string[] {
    return Array.from(this.handlers.keys());
  }
}

/** Global singleton for handler registration. */
export const continuationHandlerRegistry = new ContinuationHandlerRegistry();

/**
 * Filter approved actions to those that have a registered continuation handler.
 */
export function filterContinuableActions(
  actions: ActionRecord[],
  approvedActionIds: string[],
): ActionRecord[] {
  const approvedIds = new Set(approvedActionIds);
  return actions.filter(
    (action) =>
      approvedIds.has(action.id) &&
      continuationHandlerRegistry.get(action.type) !== undefined,
  );
}
