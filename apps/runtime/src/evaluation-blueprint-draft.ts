import {
  EvaluationBlueprint,
  EvaluationBlueprintSchema,
  EvaluationRecipeId,
  RunConfig,
  RunConfigSchema,
} from "@ora/shared";
import { parseJsonObject } from "./provider-json.js";
import { invokeRunProvider } from "./providers/index.js";

export async function generateEvaluationBlueprintDraftWithProvider(params: {
  id: string;
  now: number;
  goal: string;
  recipe: EvaluationRecipeId;
  datasetId?: string;
  providerId?: string;
  modelRef?: string;
}): Promise<EvaluationBlueprint> {
  const config: RunConfig = RunConfigSchema.parse({
    pattern: "orchestrator_subagent",
    providerId: params.providerId,
    modelRef: params.modelRef,
  });
  const response = await invokeRunProvider(config, {
    system: [
      "You are Ora's Evaluation Strategist.",
      "Turn a natural-language evaluation goal into one reviewable EvaluationBlueprint JSON object.",
      "Return only JSON. Do not start an evaluation run.",
      "Use schemaVersion 1, status draft, and the supplied id/createdAt/updatedAt.",
      "For Auto Router goals, use recipe auto_router_quality, target runtime.mode_selection, subject { kind: 'auto_router' }, routerOnly true, and metrics exact_match, acceptable_match, assertion_pass_rate, fallback_rate, confidence_calibration.",
      "For ordinary mode comparison goals, use recipe mode_comparison, target run.output, subject { kind: 'mode_matrix', modeIds: ['orchestrator_subagent','agent_teams'] }.",
    ].join("\n"),
    messages: [{
      role: "user",
      content: JSON.stringify(params, null, 2),
    }],
    temperature: 0,
    maxTokens: 1600,
    toolChoice: "none",
  });
  const parsed = parseJsonObject(response.text);
  return EvaluationBlueprintSchema.parse({
    ...parsed,
    id: params.id,
    goal: typeof parsed.goal === "string" ? parsed.goal : params.goal,
    recipe: typeof parsed.recipe === "string" ? parsed.recipe : params.recipe,
    schemaVersion: 1,
    createdAt: params.now,
    updatedAt: params.now,
  });
}
