import { describe, expect, it } from "vitest";
import {
  acceptedPlanExecutionContractFromMetadata,
  RunConfigSchema,
  SINGLE_AGENT_MODE_ID,
  getModePreset,
  modeSpecToPatternDefinition,
  type StateSnapshot,
} from "@cemeworm/shared";
import { RunKernelExecutionService } from "../src/run-kernel-execution-service.js";

class CapturingRunKernelExecutionService extends RunKernelExecutionService {
  public lastRunParams: Parameters<RunKernelExecutionService["executeRun"]>[0] | undefined;
  public lastResumeParams: Parameters<RunKernelExecutionService["executeResume"]>[0] | undefined;
  private readonly snapshotToReturn: StateSnapshot;

  constructor(snapshotToReturn: StateSnapshot, taskMemoryPersistenceDir: string) {
    super({
      clock: () => 1_000,
      skillRegistry: {} as never,
      modeRegistry: {} as never,
      selfIterationRegistry: {} as never,
      automationRegistry: {} as never,
      widgetRegistry: {} as never,
      customAgentOverlay: () => undefined,
      customAgentOverlaysForMode: () => ({}),
      systemAgentOverlaysForMode: () => ({}),
      customAgentContextsForMode: () => ({}),
      buildConversationMessages: () => [],
      taskMemoryPersistenceDir,
    });
    this.snapshotToReturn = snapshotToReturn;
  }

  override executeRun(params: Parameters<RunKernelExecutionService["executeRun"]>[0]): Promise<StateSnapshot> {
    this.lastRunParams = params;
    return Promise.resolve(this.snapshotToReturn);
  }

  override executeResume(params: Parameters<RunKernelExecutionService["executeResume"]>[0]): Promise<StateSnapshot> {
    this.lastResumeParams = params;
    return Promise.resolve(this.snapshotToReturn);
  }
}

function snapshotWithPendingPlanDecision(): StateSnapshot {
  const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
  const definition = modeSpecToPatternDefinition(modeSpec);
  return {
    runId: "run-plan-resume",
    sessionId: "session-plan-resume",
    status: "succeeded",
    pattern: definition.coordinationKind,
    modeId: SINGLE_AGENT_MODE_ID,
    modeSpec,
    input: { prompt: "Return a proposed plan.", createdAt: 1, context: {} },
    config: RunConfigSchema.parse({
      pattern: definition.coordinationKind,
      modeId: SINGLE_AGENT_MODE_ID,
      metadata: { taskIntent: "plan" },
    }),
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    planList: [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    childSessions: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    planDecisions: [{
      id: "decision-plan",
      runId: "run-plan-resume",
      sessionId: "session-plan-resume",
      status: "pending",
      planContent: "## Runtime status plan\n1. Add shared attention projection.\n2. Persist plan decision gates.",
      createdAt: 1_000,
    }],
    output: "done",
    updatedAt: 1_000,
  } as unknown as StateSnapshot;
}

function snapshotWithPendingPlanDecisionAndPausedContinuation(): StateSnapshot {
  const snapshot = snapshotWithPendingPlanDecision();
  return {
    ...snapshot,
    continuation: {
      activeFrameId: "run-plan-resume:continuation:0",
      frames: [{
        id: "run-plan-resume:continuation:0",
        runId: snapshot.runId,
        status: "paused",
        reason: "manual_interrupt",
        conversationCursor: 0,
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
        approvedActionIds: [],
        resolvedClarificationIds: [],
        agentId: "ora",
        nodeId: "run",
        nodeCheckpoint: {
          agentId: "ora",
          nodeId: "run",
          conversationCursor: 0,
          bag: {},
        },
        createdAt: 1_000,
        updatedAt: 1_000,
      }],
    },
  } as StateSnapshot;
}

describe("RunKernelExecutionService task memory integration", () => {
  it("injects a default TaskMemoryStore into fresh kernel runs", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const snapshot = {
      runId: "run-0001",
      sessionId: "session-0001",
      status: "succeeded",
      pattern: definition.coordinationKind,
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "test", createdAt: 1, context: {} },
      config: RunConfigSchema.parse({
        pattern: definition.coordinationKind,
        modeId: SINGLE_AGENT_MODE_ID,
        metadata: {},
      }),
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      continuation: { frames: [] },
      conversation: [],
      toolResults: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [],
      childSessions: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: "done",
      updatedAt: 1_000,
    } as unknown as StateSnapshot;
    const service = new CapturingRunKernelExecutionService(snapshot, "/tmp/ora-task-memory");

    await service.executePreparedRun({
      runId: "run-0001",
      input: { prompt: "test", createdAt: 1, context: {} },
      config: snapshot.config,
      modeSpec,
      definition,
      sessionId: "session-0001",
      turnIndex: 1,
      conversationMessages: [],
    });

    expect(service.lastRunParams?.taskMemoryStore).toBeDefined();
  });

  it("injects a default TaskMemoryStore into kernel resumes", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const snapshot = {
      runId: "run-0002",
      sessionId: "session-0002",
      status: "interrupted",
      pattern: definition.coordinationKind,
      modeId: SINGLE_AGENT_MODE_ID,
      modeSpec,
      input: { prompt: "resume", createdAt: 1, context: {} },
      config: RunConfigSchema.parse({
        pattern: definition.coordinationKind,
        modeId: SINGLE_AGENT_MODE_ID,
        metadata: {},
      }),
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      planList: [],
      todos: [],
      actions: [],
      toolCalls: [],
      continuation: { frames: [] },
      conversation: [],
      toolResults: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      agentMessages: [],
      childSessions: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      output: "paused",
      updatedAt: 1_000,
    } as unknown as StateSnapshot;
    const resumedSnapshot = {
      ...snapshot,
      status: "succeeded",
      output: "done",
    } as StateSnapshot;
    const service = new CapturingRunKernelExecutionService(resumedSnapshot, "/tmp/ora-task-memory");

    await service.executePreparedResume({
      snapshot,
      clarificationPatch: {},
      approvedActionIds: [],
      approvedActions: [],
      conversationMessages: [],
    });

    expect(service.lastResumeParams?.taskMemoryStore).toBeDefined();
  });

  it("injects accepted-plan resume context and implement intent overrides on same-run plan acceptance", async () => {
    const snapshot = snapshotWithPendingPlanDecision();
    const service = new CapturingRunKernelExecutionService(snapshot, "/tmp/ora-task-memory");

    await service.executeKernelResumeWork({
      snapshot,
      clarificationPatch: {},
      approvedActionIds: [],
      approvedActions: [],
      planDecisionResolutions: [{ decisionId: "decision-plan", status: "accepted" }],
    });

    expect(service.lastResumeParams?.config.metadata).toMatchObject({
      taskIntent: "implement",
      acceptedPlanExecutionContract: "same_run_implementation",
      acceptedPlanDecisionId: "decision-plan",
      acceptedPlanRunId: snapshot.runId,
    });
    expect(service.lastResumeParams?.conversationMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("<accepted_plan>"),
      }),
    ]));
    expect(service.lastResumeParams?.planDecisionResolutions).toEqual([
      { decisionId: "decision-plan", status: "accepted" },
    ]);
  });

  it("does not convert a paused continuation frame into awaiting_model for accepted-plan same-run implementation", async () => {
    const snapshot = snapshotWithPendingPlanDecisionAndPausedContinuation();
    const service = new CapturingRunKernelExecutionService(snapshot, "/tmp/ora-task-memory");

    await service.executeKernelResumeWork({
      snapshot,
      clarificationPatch: {},
      approvedActionIds: [],
      approvedActions: [],
      planDecisionResolutions: [{ decisionId: "decision-plan", status: "accepted" }],
    });

    expect(acceptedPlanExecutionContractFromMetadata(service.lastResumeParams?.config.metadata ?? {})).toBe(
      "same_run_implementation",
    );
    expect(service.lastResumeParams?.resumeSnapshot?.continuation.activeFrameId).toBe("run-plan-resume:continuation:0");
    expect(service.lastResumeParams?.resumeSnapshot?.continuation.frames[0]?.status).toBe("paused");
  });

  it("injects declined-plan revision context without switching away from plan intent", async () => {
    const snapshot = snapshotWithPendingPlanDecision();
    const service = new CapturingRunKernelExecutionService(snapshot, "/tmp/ora-task-memory");

    await service.executeKernelResumeWork({
      snapshot,
      clarificationPatch: {},
      approvedActionIds: [],
      approvedActions: [],
      planDecisionResolutions: [{ decisionId: "decision-plan", status: "declined" }],
    });

    expect(service.lastResumeParams?.config.metadata.taskIntent).toBe("plan");
    expect(service.lastResumeParams?.conversationMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("<previous_plan>"),
      }),
    ]));
    expect(service.lastResumeParams?.planDecisionResolutions).toEqual([
      { decisionId: "decision-plan", status: "declined" },
    ]);
  });
});
