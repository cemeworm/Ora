import { MemorySaver } from "@langchain/langgraph";
import type { RunConfig, StateSnapshot, UserTaskInput } from "@ora/shared";
import { createPatternGraph, createPatternGraphWithCheckpointer } from "../patterns/registry.js";

/**
 * Manages active LangGraph runs.
 *
 * For now, wraps the existing LocalRunStore deterministic behavior.
 * When LangGraph is enabled (via ORA_LANGGRAPH_ENABLED), real LangGraph
 * graph invocations are used. Otherwise, deterministic behavior is maintained.
 */
export class SessionManager {
  private readonly checkpointer: MemorySaver;
  private readonly enabled: boolean;

  constructor(enabled = false) {
    this.checkpointer = new MemorySaver();
    this.enabled = enabled;
  }

  /**
   * Start a new pattern graph run.
   * When LangGraph is disabled, returns undefined (caller should use deterministic path).
   * When enabled, invokes the actual LangGraph graph.
   */
  async startRun(
    runId: string,
    input: UserTaskInput,
    config: RunConfig
  ): Promise<StateSnapshot | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    const { graph } = createPatternGraphWithCheckpointer(config.pattern);
    const initialState = {
      runId,
      pattern: config.pattern,
      input,
      config,
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      actions: [],
      policyDecisions: [],
      events: [],
      checkpoints: [],
      artifacts: [],
      output: undefined,
      error: undefined,
    };

    const result = await graph.invoke(initialState, {
      configurable: {
        thread_id: runId,
      },
    });

    // Return undefined for now as the graph returns partial state
    // Full StateSnapshot construction is handled by the LocalRunStore
    return undefined;
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
