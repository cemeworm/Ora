import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { RuntimeToolExecutionContext } from "./runtime-tool-executor.js";

export type {
  RuntimeToolResultPreview,
  RuntimeToolContinuationHandler,
} from "./capability-registries.js";

/**
 * V2 evolution of RuntimeToolDefinition — same shape as the updated V1 type
 * with resultPreview, prepareArguments, and continuationHandler.
 * Use toV2Definition to upcast a V1 definition.
 */
export type RuntimeToolDefinitionV2<TContext = unknown> = RuntimeToolDefinition<TContext>;

/**
 * Upcast V1 RuntimeToolDefinition to V2 shape.
 * Since V1 already has the V2 fields (resultPreview etc.), this is a trivial cast.
 */
export function toV2Definition(
  definition: RuntimeToolDefinition<RuntimeToolExecutionContext>,
): RuntimeToolDefinitionV2<RuntimeToolExecutionContext> {
  return definition;
}
