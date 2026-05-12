export {
  isInternalAssistantText,
  isInternalDeltaPayload,
  isInternalDeltaText,
  isInternalRecoveryFallbackText,
  mergeAssistantDeltaProjection,
  mergeAssistantDeltaText,
  projectAssistantTextFromEvents,
  projectAssistantTextFromSnapshot,
} from "@cemeworm/shared";

export type { AssistantDeltaProjection, ProjectAssistantTextOptions } from "@cemeworm/shared";

import { mergeAssistantDeltaProjection } from "@cemeworm/shared";

/** @deprecated Use mergeAssistantDeltaProjection instead */
export function mergeAssistantMessageTextProjection(
  current: { text: string } | undefined,
  payload: Record<string, unknown>,
): { text: string } | undefined {
  return mergeAssistantDeltaProjection(current, payload);
}
