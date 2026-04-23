import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import {
  type CheckpointMeta,
  type RunConfig,
  OraEventEnvelopeSchema,
  StateSnapshotSchema,
  getPatternDefinition,
  type StateSnapshot,
  type UserTaskInput
} from "@ora/shared";
import { ActionLedger, AgentProfileRegistry, PlanService, PolicyService } from "../capabilities.js";
import { createPatternGraphWithCheckpointer } from "../patterns/registry.js";
import { createOraSqliteCheckpointer } from "../persistence/sqlite-checkpointer.js";
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
    config: RunConfig
  ): Promise<StateSnapshot | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    return withLangfuseRunTrace({ runId, input, config }, () =>
      this.startTracedRun(runId, input, config)
    );
  }

  private async startTracedRun(
    runId: string,
    input: UserTaskInput,
    config: RunConfig
  ): Promise<StateSnapshot> {
    const definition = getPatternDefinition(config.pattern);
    const profiles = new AgentProfileRegistry(definition).list(config.profileIds);
    const planService = new PlanService(runId, definition);
    const actionLedger = new ActionLedger(runId);
    const policyService = new PolicyService(runId, () => Date.now());
    const startedAt = Date.now();
    const { graph } = createPatternGraphWithCheckpointer(config.pattern, this.checkpointer ?? false);
    const initialState = {
      runId,
      pattern: config.pattern,
      input,
      config,
      topology: definition.topology,
      profiles,
      memory: [],
      plan: planService.list(),
      actions: actionLedger.list(),
      policyDecisions: [],
      events: [],
      checkpoints: [],
      artifacts: [],
      output: undefined,
      error: undefined
    };

    const result = (await graph.invoke(initialState, {
      configurable: {
        thread_id: runId,
        checkpoint_ns: ""
      },
    })) as Record<string, unknown>;

    const finalOutput = result.output;
    const finalError = typeof result.error === "string" ? result.error : undefined;
    const status: StateSnapshot["status"] = finalError ? "failed" : "succeeded";
    const checkpointTuple = this.checkpointer
      ? await this.checkpointer.getTuple({
          configurable: {
            thread_id: runId,
            checkpoint_ns: ""
          }
        })
      : undefined;
    const checkpoint: CheckpointMeta | undefined = checkpointTuple
      ? {
          id: checkpointTuple.checkpoint.id,
          runId,
          label: "LangGraph checkpoint",
          createdAt: Number.isFinite(Date.parse(checkpointTuple.checkpoint.ts))
            ? Date.parse(checkpointTuple.checkpoint.ts)
            : startedAt + 1,
          eventSeq: 1,
          stateHash: typeof finalOutput === "string" ? finalOutput : JSON.stringify(finalOutput)
        }
      : undefined;
    const topologyStatus = status === "succeeded" ? "done" : "failed";
    const runNodeId = definition.topology.nodes.find((node) => node.kind === "run")?.id ?? "run";
    const events = [
      OraEventEnvelopeSchema.parse({
        id: `${runId}:evt-0`,
        runId,
        seq: 0,
        type: "run.started",
        createdAt: startedAt,
        pattern: config.pattern,
        payload: {
          input,
          config
        }
      }),
      ...(checkpoint
        ? [
            OraEventEnvelopeSchema.parse({
              id: `${runId}:evt-1`,
              runId,
              seq: 1,
              type: "checkpoint.created",
              createdAt: checkpoint.createdAt,
              pattern: config.pattern,
              checkpointId: checkpoint.id,
              payload: {
                checkpoint,
                summary: "LangGraph checkpoint captured during enabled SessionManager execution."
              }
            })
          ]
        : []),
      OraEventEnvelopeSchema.parse({
        id: `${runId}:evt-${checkpoint ? 2 : 1}`,
        runId,
        seq: checkpoint ? 2 : 1,
        type: status === "failed" ? "run.failed" : "run.done",
        createdAt: startedAt + (checkpoint ? 2 : 1),
        pattern: config.pattern,
        payload: status === "failed"
          ? {
              error: finalError ?? "LangGraph execution failed."
            }
          : {
              status,
              output: finalOutput
            }
      })
    ];
    const topology = {
      nodes: definition.topology.nodes.map((node) => ({
        ...node,
        status: node.id === runNodeId || node.kind === "agent" ? topologyStatus : node.status
      })),
      edges: definition.topology.edges
    };

    const action = actionLedger.propose({
      id: "langgraph-run",
      type: `pattern.${config.pattern}.invoke`,
      riskLevel: "low",
      planItemId: planService.firstItem().id,
      agentId: profiles[0]?.id,
      input: {
        input,
        config,
        output: finalOutput
      }
    });
    const decision = policyService.evaluate(action);
    actionLedger.transition(action.id, status === "failed" ? "failed" : "succeeded", {
      output: finalOutput,
      error: finalError
    });

    return StateSnapshotSchema.parse({
      runId,
      status,
      pattern: config.pattern,
      input,
      config,
      topology,
      profiles,
      memory: [],
      plan: planService.list(),
      actions: actionLedger.list(),
      policyDecisions: [decision],
      checkpoints: checkpoint ? [checkpoint] : [],
      events,
      artifacts: [],
      output: finalOutput,
      error: finalError,
      updatedAt: startedAt + events.length
    });
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
