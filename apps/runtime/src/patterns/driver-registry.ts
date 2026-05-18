import {
  createModeSpecFromPattern,
  modeSpecToPatternDefinition,
  type BuiltInCoordinationPattern,
  type CoordinationPattern,
} from "@cemeworm/shared";
import type { PatternDriver, PatternExecutionResult } from "./execution-context.js";
import { executeAgentTeams } from "./agent-teams-driver.js";
import { executeGeneratorVerifier } from "./generator-verifier-driver.js";
import { executeMessageBus } from "./message-bus-driver.js";
import { createBuiltInModeDriverRegistry, type ModeExecutionInput } from "./mode-driver-registry.js";
import { executeOrchestratorSubagent } from "./orchestrator-subagent-driver.js";
import { executeSharedState } from "./shared-state-driver.js";

const builtInModeDriverRegistry = createBuiltInModeDriverRegistry({
  generator_verifier: executeGeneratorVerifier,
  orchestrator_subagent: executeOrchestratorSubagent,
  agent_teams: executeAgentTeams,
  message_bus: executeMessageBus,
  shared_state: executeSharedState,
});

export function executeModeSpec(input: ModeExecutionInput): Promise<PatternExecutionResult> {
  return builtInModeDriverRegistry.execute(input);
}

export function getPatternDriver(pattern: CoordinationPattern): PatternDriver {
  return {
    id: pattern,
    async execute(context, prompt) {
      const modeSpec = createModeSpecFromPattern(pattern as BuiltInCoordinationPattern);
      const definition = modeSpecToPatternDefinition(modeSpec);
      return executeModeSpec({
        context,
        prompt,
        config: {
          pattern,
          modeId: modeSpec.id,
          modeSelection: "manual",
          profileIds: [],
          modelRef: "",
          skillIds: [],
          toolIds: [],
          approvalMode: "high_risk_only",
          permissionMode: "default",
          patternOptions: {},
          metadata: {},
          causalInterventionLevel: "record_only" as const,
          deterministicSeed: "ora-smoke",
        },
        modeSpec,
        definition,
      });
    },
  };
}
