import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import {
  StateSnapshotSchema,
  createModeSpecFromPattern,
  getModePreset,
  modeSpecToPatternDefinition,
  type ModeSpec,
  type PatternDefinition,
  type RunConfig,
  type StateSnapshot,
  type UserTaskInput
} from "@ora/shared";
import type { ModelMessage } from "../providers/index.js";
import { createOraSqliteCheckpointer } from "../persistence/sqlite-checkpointer.js";
import { executeRuntimeKernel } from "../harness/runtime-kernel.js";
import { withLangfuseRunTrace } from "../telemetry/langfuse.js";

/**
 * Manages active LangGraph runs.
 *
 * For now, wraps the existing LocalRunStore deterministic behavior.
 * When LangGraph is enabled (via ORA_LANGGRAPH_ENABLED), real LangGraph
 * graph invocations are used. Otherwise, deterministic behavior is maintained.
 */
export class SessionManager {
  private readonly checkpointer?: BaseCheckpointSaver;
  private readonly enabled: boolean;

  constructor(enabled = false, options: { checkpointer?: BaseCheckpointSaver } = {}) {
    this.enabled = enabled;
    this.checkpointer = enabled ? options.checkpointer ?? createOraSqliteCheckpointer() : undefined;
  }

  /**
   * Start a new pattern graph run.
   * When LangGraph is disabled, returns undefined (caller should use deterministic path).
   * When enabled, invokes the actual LangGraph graph.
   */
  async startRun(
    runId: string,
    input: UserTaskInput,
    config: RunConfig,
    conversationMessages: ModelMessage[] = [],
    resolved?: { modeSpec: ModeSpec; definition: PatternDefinition }
  ): Promise<StateSnapshot | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    return withLangfuseRunTrace({ runId, input, config }, () =>
      this.startTracedRun(runId, input, config, conversationMessages, resolved)
    );
  }

  private async startTracedRun(
    runId: string,
    input: UserTaskInput,
    config: RunConfig,
    conversationMessages: ModelMessage[],
    resolved?: { modeSpec: ModeSpec; definition: PatternDefinition }
  ): Promise<StateSnapshot> {
    const nextResolved = resolveSessionMode(config, resolved);
    const { snapshot } = await executeRuntimeKernel(runId, input, config, {
      clock: Date.now,
      modeSpec: nextResolved.modeSpec,
      definition: nextResolved.definition,
      conversationMessages,
    });
    return StateSnapshotSchema.parse(snapshot);
  }

  /**
   * Interrupt a running graph.
   */
  async interruptRun(_runId: string): Promise<void> {
    // LangGraph interrupt support via Command interrupt
    // For now, no-op (deterministic path handles this)
  }

  /**
   * Resume a graph from an interrupt.
   */
  async resumeRun(_runId: string, _patch?: Record<string, unknown>): Promise<StateSnapshot | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    // LangGraph resume with Command
    return undefined;
  }

  /**
   * Cancel a running graph.
   */
  async cancelRun(_runId: string): Promise<void> {
    // No-op for now
  }

  /**
   * Get the current state of a run.
   */
  async getRunState(_runId: string): Promise<StateSnapshot | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    return undefined;
  }

  /**
   * Check whether LangGraph mode is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

function resolveSessionMode(
  config: RunConfig,
  resolved?: { modeSpec: ModeSpec; definition: PatternDefinition }
): { modeSpec: ModeSpec; definition: PatternDefinition } {
  if (resolved) {
    return resolved;
  }

  const requestedModeId = config.modeId ?? config.pattern;
  const preset = getModePreset(requestedModeId);
  if (preset) {
    return {
      modeSpec: preset,
      definition: modeSpecToPatternDefinition(preset),
    };
  }

  if (!config.modeId || config.modeId === config.pattern) {
    const modeSpec = createModeSpecFromPattern(config.pattern);
    return {
      modeSpec,
      definition: modeSpecToPatternDefinition(modeSpec),
    };
  }

  throw new Error(`SessionManager requires resolved mode data for custom mode '${config.modeId}'.`);
}
