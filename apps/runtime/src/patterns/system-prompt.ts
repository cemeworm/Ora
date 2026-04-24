import type { OraGraphState } from "../graph/ora-state.js";

export function withGraphPersona(state: OraGraphState, base: string): string {
  const overlay = state.config.metadata?.customAgentOverlay;
  const skillOverlay = state.config.metadata?.skillPromptOverlay;
  return [
    base,
    typeof overlay === "string" && overlay.length > 0 ? overlay : undefined,
    typeof skillOverlay === "string" && skillOverlay.length > 0 ? skillOverlay : undefined,
  ].filter(Boolean).join("\n\n");
}
