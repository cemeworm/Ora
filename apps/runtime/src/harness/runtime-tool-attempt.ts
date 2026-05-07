import type {
  RuntimeCompletionController,
  RuntimeToolScope,
} from "./runtime-completion.js";
import type { RuntimeToolAttemptDecision } from "./runtime-tool-loop.js";
import type { RuntimeToolCall } from "./runtime-tool-executor.js";

export interface RuntimeToolAttemptRegistration {
  completion: RuntimeCompletionController;
  toolCall: RuntimeToolCall;
  scope: RuntimeToolScope;
}

export function registerRuntimeToolAttempt(
  params: RuntimeToolAttemptRegistration,
): RuntimeToolAttemptDecision {
  return params.completion.registerToolAttempt(params.toolCall, params.scope);
}
