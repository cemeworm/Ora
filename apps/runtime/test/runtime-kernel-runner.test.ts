import { describe, expect, it } from "vitest";
import { getModePreset, modeSpecToPatternDefinition, SINGLE_AGENT_MODE_ID, type OraEventEnvelope, type StateSnapshot } from "@cemeworm/shared";
import { KernelRunner, createKernelRunnerDeps } from "../src/harness/runtime-kernel-runner.js";

function createRunner(params?: {
  resumeState?: { conversation: unknown[]; toolResults: unknown[]; continuation: { frames: unknown[] } };
  alreadyAnnounced?: boolean;
}) {
  const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
  const definition = modeSpecToPatternDefinition(modeSpec);
  const emitted: OraEventEnvelope[] = [];
  const emit = (type: OraEventEnvelope["type"], payload: unknown, extra?: Partial<OraEventEnvelope>) => {
    const event = {
      id: `evt-${emitted.length}`,
      runId: "run-kernel-runner-test",
      seq: emitted.length,
      type,
      payload,
      createdAt: 1_000 + emitted.length,
      pattern: definition.pattern,
      ...extra,
    } as OraEventEnvelope;
    emitted.push(event);
    return event;
  };

  const runner = new KernelRunner(createKernelRunnerDeps({
    request: {
      input: { prompt: "Resume runner event test.", createdAt: 1_000, context: {} },
      config: {
        pattern: definition.pattern,
        modeId: SINGLE_AGENT_MODE_ID,
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        skillIds: [],
        toolIds: [],
        modelRef: "local/test-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
      },
      options: {
        turnIndex: 1,
        resumeContext: {
          clarifications: { scope: "narrow fix" },
          alreadyAnnounced: params?.alreadyAnnounced,
        },
        resumeState: params?.resumeState,
      },
    },
    runtime: {
      kernelRuntimeContext: {
        runId: "run-kernel-runner-test",
        topology: { nodes: [], edges: [] },
        busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
        latestEventSeq: () => emitted.length - 1,
        updateQueueSummary: () => ({ mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] }),
        eventCount: () => emitted.length,
        latestNodeCheckpoint: () => undefined,
        assembleFinalSnapshot: () => ({ events: emitted } as StateSnapshot),
      },
      emit,
    },
    start: {
      skills: { skills: [] } as never,
      tools: { tools: [] } as never,
      profiles: [],
    },
    progress: {
      emitPlanUpdated: () => undefined,
      emitTodoUpdated: () => undefined,
    },
    topology: {
      setTopologyStatus: () => undefined,
    },
    stores: {
      planService: {
        list: () => [],
        setStatus: () => undefined,
        attachCheckpoint: () => undefined,
      },
      todoService: {
        list: () => [],
        setStatus: () => undefined,
      },
    },
    execution: {
      executeModeSpec: async () => ({ output: "done" }),
      kernelPatternExecutionContextAdapter: { create: () => ({}) } as never,
      resolvedModeSpec: modeSpec,
      resolvedDefinition: definition,
    },
    preflight: {
      clarificationAnswer: () => undefined,
      requestIntentClarificationQuestion: async () => undefined,
      ensureClarification: async () => undefined,
      rootTopology: {},
      emitOraObservation: () => undefined,
      agentLabel: () => "Solo Agent",
    },
    finalization: {
      inferCompletionStopReason: () => undefined,
      modeProgressFinalizationError: () => undefined,
      outputWithCompletionMetadata: (value) => value,
      completionMetadata: () => ({ stopReason: "completed" }),
      finalizeAsOra: async (value) => value,
      incompleteForcedFinalError: () => undefined,
      assertTerminalState: undefined as never,
    },
    memory: {
      memoryCaptureQueue: {
        size: () => 0,
        flush: () => [],
      } as never,
      memoryService: {
        list: () => [],
      } as never,
    },
    checkpoint: {
      runId: "run-kernel-runner-test",
      checkpointLabelForStatus: () => "Succeeded",
      now: () => 2_000,
      actionLedger: {
        list: () => [],
      },
    },
  }));

  return { runner, emitted };
}

describe("KernelRunner resume events", () => {
  it("emits run.resumed before kernel execution when resume state exists", async () => {
    const { runner, emitted } = createRunner({
      resumeState: {
        conversation: [],
        toolResults: [],
        continuation: { frames: [] },
      },
    });

    await runner.run();

    expect(emitted.slice(0, 2).map((event) => event.type)).toEqual([
      "run.started",
      "run.resumed",
    ]);
    expect(emitted[1]?.payload).toMatchObject({
      reason: "resume",
      patch: {
        clarifications: { scope: "narrow fix" },
      },
    });
  });

  it("does not emit run.resumed on fresh runs", async () => {
    const { runner, emitted } = createRunner();

    await runner.run();

    expect(emitted.map((event) => event.type)).not.toContain("run.resumed");
  });

  it("does not emit a duplicate run.resumed when resume was already announced upstream", async () => {
    const { runner, emitted } = createRunner({
      resumeState: {
        conversation: [],
        toolResults: [],
        continuation: { frames: [] },
      },
      alreadyAnnounced: true,
    });

    await runner.run();

    expect(emitted.map((event) => event.type)).toEqual([
      "run.started",
      "topology.updated",
      "profile.updated",
      "causal.decision.recorded",
      "run.done",
      "checkpoint.created",
    ]);
  });
});
