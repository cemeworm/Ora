import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type ModeId,
  getModePreset,
  modeSpecToPatternDefinition,
  OraEventEnvelopeSchema,
  SINGLE_AGENT_MODE_ID,
  StateSnapshotSchema,
  type OraEventEnvelope,
  type StateSnapshot,
} from "@cemeworm/shared";

vi.mock("../src/providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/index.js")>(
    "../src/providers/index.js",
  );

  return {
    ...actual,
    invokeRunProvider: vi.fn(async (config, request) => {
      const messages = (request.messages ?? []).map((message) => ({
        role: message.role,
        content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      }));
      return {
        providerId: config.providerId ?? "mock-provider",
        providerType: "local_smoke",
        modelId: config.modelRef ?? "mock-model",
        text: responseForRequest(messages),
        raw: { request },
      };
    }),
  };
});

import { RuntimeSkillRegistry } from "../src/harness/capability-registries.js";
import { completeApprovedToolContinuation } from "../src/approved-file-write-resume.js";
import { executeRuntimeKernel } from "../src/index.js";
import { runtimeConversationToModelMessages } from "../src/runtime-conversation.js";

describe("approved tool resume completion", () => {
  it("returns a continuation snapshot when explicit plan-list state remains incomplete", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-approved-plan-list-"));
    const snapshot = approvedFileWriteSnapshot(workspaceRoot, {
      planList: [{ step: "Verify the approved change", status: "in_progress" }],
    });

    const result = await completeApprovedToolContinuation(
      snapshot,
      ["run-approved:action-write"],
      {},
      deps(),
    );

    expect(result?.kind).toBe("continue");
    const resumed = result?.kind === "continue" ? result.snapshot : undefined;
    expect(resumed?.status).toBe("running");
    expect(resumed?.error).toBeUndefined();
    expect(resumed?.events.map((event) => event.type)).toContain("task.progress");
    expect(resumed?.events.map((event) => event.type)).not.toContain("run.failed");
    expect(resumed?.events.map((event) => event.type)).not.toContain("run.done");
    expect(resumed?.conversation.at(-1)?.content).toContain("The current plan list is not complete yet");
    expect(resumed?.toolCalls.find((call) => call.actionId === "run-approved:action-write")).toMatchObject({
      status: "succeeded",
    });
  });

  it("completes interrupted mode progress before approved-tool direct finalization", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-approved-mode-progress-"));
    const snapshot = approvedFileWriteSnapshot(workspaceRoot, {
      planStatus: "blocked",
      todoStatus: "blocked",
    });

    const result = await completeApprovedToolContinuation(
      snapshot,
      ["run-approved:action-write"],
      {},
      deps(),
    );

    expect(result?.kind).toBe("completed");
    const resumed = result?.kind === "completed" ? result.snapshot : undefined;
    expect(resumed?.status).toBe("succeeded");
    expect(resumed?.events.map((event) => event.type)).toContain("plan.updated");
    expect(resumed?.events.map((event) => event.type)).toContain("todo.updated");
    expect(resumed?.plan.every((item) => item.status === "done")).toBe(true);
    expect(resumed?.todos.every((item) => item.status === "done")).toBe(true);
    expect(resumed?.events.map((event) => event.type)).toContain("run.done");
  });

  it("continues through the kernel after approved tool execution when plan-list work remains", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-approved-kernel-continue-"));
    const snapshot = approvedFileWriteSnapshot(workspaceRoot, {
      planList: [{ step: "Verify the approved change", status: "in_progress" }],
      toolIds: ["file.write", "plan.update"],
    });

    const result = await completeApprovedToolContinuation(
      snapshot,
      ["run-approved:action-write"],
      {},
      deps(),
    );

    expect(result?.kind).toBe("continue");
    if (result?.kind !== "continue") {
      throw new Error("Expected approved tool continuation to require kernel continuation.");
    }

    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const { snapshot: resumed } = await executeRuntimeKernel(
      snapshot.runId,
      result.snapshot.input,
      result.snapshot.config,
      {
        modeSpec,
        definition,
        skillRegistry: new RuntimeSkillRegistry(),
        conversationMessages: runtimeConversationToModelMessages(result.snapshot.conversation),
        resumeState: result.snapshot,
      },
    );

    expect(resumed.status).toBe("succeeded");
    expect(resumed.planList).toEqual([
      {
        id: "plan-step-1-verify-the-approved-change",
        step: "Verify the approved change",
        status: "completed",
      },
    ]);
    expect(resumed.toolCalls.find((call) => call.id === "run-approved:tool-call-write")).toMatchObject({
      planStepId: "plan-step-1-verify-the-approved-change",
    });
    expect(resumed.toolCalls.find((call) => call.id === "run-approved:tool-call-write")).toMatchObject({
      status: "succeeded",
      actionId: "run-approved:action-write",
      toolId: "file.write",
    });
    expect(resumed.toolCalls.filter((call) => call.id === "run-approved:tool-call-write")).toHaveLength(1);
    expect(resumed.events.map((event) => event.type)).toContain("plan_list.updated");
    expect(resumed.events.map((event) => event.type)).toContain("run.done");
    expect(resumed.events.map((event) => event.type)).not.toContain("run.failed");
  });

  it("continues an agent-team approved tool from the paused frame owner when plan-list work remains", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-approved-team-frame-"));
    const snapshot = approvedFileWriteSnapshot(workspaceRoot, {
      modeId: "agent_teams",
      pattern: "agent_teams",
      agentId: "builder",
      nodeId: "builder",
      planList: [{ step: "Verify the approved change", status: "in_progress" }],
      toolIds: ["file.write", "plan.update"],
    });

    const result = await completeApprovedToolContinuation(
      snapshot,
      ["run-approved:action-write"],
      {},
      deps(),
    );

    expect(result?.kind).toBe("continue");
    if (result?.kind !== "continue") {
      throw new Error("Expected approved tool continuation to require kernel continuation.");
    }

    const modeSpec = getModePreset("agent_teams")!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const { snapshot: resumed } = await executeRuntimeKernel(
      snapshot.runId,
      result.snapshot.input,
      result.snapshot.config,
      {
        modeSpec,
        definition,
        skillRegistry: new RuntimeSkillRegistry(),
        conversationMessages: runtimeConversationToModelMessages(result.snapshot.conversation),
        resumeState: result.snapshot,
      },
    );
    const agentStartedEvents = resumed.events.filter((event) => event.type === "agent.started");
    const frame = resumed.continuation.frames.find((item) => item.id === resumed.continuation.activeFrameId);

    expect(resumed.status).toBe("succeeded");
    expect(resumed.planList).toEqual([
      {
        id: "plan-step-1-verify-the-approved-change",
        step: "Verify the approved change",
        status: "completed",
      },
    ]);
    expect(resumed.toolCalls.find((call) => call.id === "run-approved:tool-call-write")).toMatchObject({
      planStepId: "plan-step-1-verify-the-approved-change",
    });
    expect(agentStartedEvents).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ title: "Continue Builder" }),
      }),
    ]);
    expect(agentStartedEvents[0]).toMatchObject({ agentId: "builder", nodeId: "builder" });
    expect(frame).toMatchObject({
      status: "completed",
      agentId: "builder",
      nodeId: "builder",
      approvedActionIds: ["run-approved:action-write"],
    });
    expect(resumed.events.map((event) => event.type)).toContain("plan_list.updated");
    expect(resumed.events.map((event) => event.type)).toContain("run.done");
  });

  it("continues a manual interrupted agent frame from the recorded owner", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-manual-team-frame-"));
    const paused = approvedFileWriteSnapshot(workspaceRoot, {
      modeId: "agent_teams",
      pattern: "agent_teams",
      agentId: "builder",
      nodeId: "builder",
      toolIds: ["file.write", "plan.update"],
    });
    const snapshot = StateSnapshotSchema.parse({
      ...paused,
      status: "interrupted",
      actions: paused.actions.map((action) => ({
        ...action,
        status: "succeeded" as const,
        output: { interrupted: true },
      })),
      pendingApprovals: [],
      toolCalls: paused.toolCalls.map((call) => ({
        ...call,
        status: "interrupted" as const,
        result: {
          status: "interrupted" as const,
          error: "Tool call was interrupted.",
          content: "Tool call was interrupted.",
          createdAt: call.updatedAt,
          updatedAt: call.updatedAt,
        },
      })),
      continuation: {
        activeFrameId: "run-approved:continuation:0",
        frames: [{
          ...paused.continuation.frames[0]!,
          status: "awaiting_model" as const,
          reason: "manual_interrupt" as const,
          agentId: "builder",
          nodeId: "builder",
          pendingActionIds: [],
          pendingToolCallIds: ["run-approved:tool-call-write"],
          nodeCheckpoint: {
            modeId: "agent_teams",
            agentId: "builder",
            nodeId: "builder",
            eventSeq: paused.events.at(-1)?.seq,
            conversationCursor: paused.conversation.length,
            bag: { interruptedToolCallIds: ["run-approved:tool-call-write"] },
          },
        }],
      },
      conversation: [{
        role: "tool" as const,
        toolCallId: "run-approved:tool-call-write",
        toolId: "file.write",
        content: "Tool call was interrupted.",
        status: "interrupted" as const,
        createdAt: 1,
      }],
    });

    const modeSpec = getModePreset("agent_teams")!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const { snapshot: resumed } = await executeRuntimeKernel(
      snapshot.runId,
      snapshot.input,
      snapshot.config,
      {
        modeSpec,
        definition,
        skillRegistry: new RuntimeSkillRegistry(),
        conversationMessages: runtimeConversationToModelMessages(snapshot.conversation),
        resumeState: snapshot,
      },
    );
    const agentStartedEvents = resumed.events.filter((event) => event.type === "agent.started");
    const frame = resumed.continuation.frames.find((item) => item.id === resumed.continuation.activeFrameId);

    expect(resumed.status).toBe("succeeded");
    expect(agentStartedEvents).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ title: "Continue Builder" }),
      }),
    ]);
    expect(agentStartedEvents[0]).toMatchObject({ agentId: "builder", nodeId: "builder" });
    expect(frame).toMatchObject({
      status: "completed",
      reason: "manual_interrupt",
      agentId: "builder",
      nodeId: "builder",
    });
    expect(frame?.nodeCheckpoint?.bag).toEqual({ interruptedToolCallIds: ["run-approved:tool-call-write"] });
    expect(resumed.events.map((event) => event.type)).toContain("run.done");
  });

  it("fails visibly when a resumable continuation frame has no owner metadata", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-missing-owner-frame-"));
    const snapshot = StateSnapshotSchema.parse({
      ...approvedFileWriteSnapshot(workspaceRoot, {
        modeId: "agent_teams",
        pattern: "agent_teams",
        toolIds: ["file.write", "plan.update"],
      }),
      status: "interrupted",
      continuation: {
        activeFrameId: "run-approved:continuation:0",
        frames: [{
          id: "run-approved:continuation:0",
          runId: "run-approved",
          status: "awaiting_model",
          reason: "manual_interrupt",
          conversationCursor: 0,
          pendingActionIds: [],
          pendingToolCallIds: ["run-approved:tool-call-write"],
          pendingClarificationIds: [],
          approvedActionIds: [],
          resolvedClarificationIds: [],
          createdAt: 1,
          updatedAt: 1,
        }],
      },
    });
    const modeSpec = getModePreset("agent_teams")!;

    await expect(executeRuntimeKernel(
      snapshot.runId,
      snapshot.input,
      snapshot.config,
      {
        modeSpec,
        definition: modeSpecToPatternDefinition(modeSpec),
        skillRegistry: new RuntimeSkillRegistry(),
        conversationMessages: [],
        resumeState: snapshot,
      },
    )).rejects.toThrow("cannot resume a suspended node without agentId");
  });
});

function responseForRequest(messages: Array<{ role: string; content: string }>): string {
  if (messages.some((message) => message.content.includes("Workspace tool result for plan.update"))) {
    return "All approved work is complete.";
  }
  if (messages.some((message) => message.content.includes("The current plan list is not complete yet"))) {
    return JSON.stringify({
      tool: "plan.update",
      args: {
        plan: [
          { step: "Verify the approved change", status: "completed" },
        ],
      },
    });
  }
  return "已完成批准的操作。";
}

function deps() {
  return {
    skillRegistry: new RuntimeSkillRegistry(),
    now: () => 1_714_000_000_000,
    appendEvent: (snapshot: StateSnapshot, type: OraEventEnvelope["type"], payload: unknown) => {
      const event = OraEventEnvelopeSchema.parse({
        id: `${snapshot.runId}:evt-${snapshot.events.length}`,
        runId: snapshot.runId,
        seq: snapshot.events.length,
        type,
        createdAt: 1_714_000_000_000,
        pattern: snapshot.pattern,
        payload,
      });
      return StateSnapshotSchema.parse({
        ...snapshot,
        events: [...snapshot.events, event],
        updatedAt: 1_714_000_000_000,
      });
    },
    attachTraceMetadata: (snapshot: StateSnapshot) => snapshot,
    buildConversationMessages: () => [{ role: "user" as const, content: "Write the approved note." }],
  };
}

function approvedFileWriteSnapshot(
  workspaceRoot: string,
  options: {
    modeId?: ModeId;
    pattern?: StateSnapshot["pattern"];
    agentId?: string;
    nodeId?: string;
    planList?: StateSnapshot["planList"];
    planStatus?: StateSnapshot["plan"][number]["status"];
    todoStatus?: StateSnapshot["todos"][number]["status"];
    toolIds?: string[];
  } = {},
): StateSnapshot {
  const runId = "run-approved";
  return StateSnapshotSchema.parse({
    runId,
    sessionId: "session-approved",
    turnIndex: 1,
    status: "interrupted",
    pattern: options.pattern ?? "orchestrator_subagent",
    modeId: options.modeId ?? "single_agent",
    input: {
      prompt: "Write the approved note.",
      createdAt: 1,
      context: { projectWorkspace: { label: "Approved Resume", rootPath: workspaceRoot } },
    },
    config: {
      pattern: options.pattern ?? "orchestrator_subagent",
      modeId: options.modeId ?? "single_agent",
      modeSelection: "manual",
      profileIds: ["solo_agent"],
      skillIds: [],
      toolIds: options.toolIds ?? ["file.write"],
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
      providerConfig: {
        id: "local-smoke",
        type: "local_smoke",
        label: "Smoke",
        modelId: "local/smoke-model",
        capabilities: ["chat"],
        headers: {},
      },
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "approved-tool-resume-completion",
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [{
      id: `${runId}:respond`,
      runId,
      title: "Respond",
      status: options.planStatus ?? "done",
      dependencies: [],
      actionIds: ["run-approved:action-write"],
      linkedActionIds: ["run-approved:action-write"],
      checkpointIds: [],
    }],
    planList: options.planList ?? [],
    todos: [{
      id: `${runId}:respond`,
      runId,
      sourcePlanItemId: `${runId}:respond`,
      label: "Respond",
      status: options.todoStatus ?? "done",
      createdAt: 1,
      updatedAt: 1,
    }],
    actions: [{
      id: "run-approved:action-write",
      runId,
      type: "file.write",
      riskLevel: "high",
      status: "approval_required",
      input: { path: "notes/result.md", content: "approved\n" },
      artifactIds: [],
      agentId: options.agentId ?? "solo_agent",
      planItemId: `${runId}:respond`,
    }],
    toolCalls: [{
      id: "run-approved:tool-call-write",
      runId,
      toolId: "file.write",
      args: { path: "notes/result.md", content: "approved\n" },
      source: "provider_native",
      status: "approval_required",
      actionId: "run-approved:action-write",
      agentId: options.agentId ?? "solo_agent",
      nodeId: options.nodeId ?? options.agentId ?? "solo_agent",
      requestedAt: 1,
      updatedAt: 1,
    }],
    continuation: {
      activeFrameId: "run-approved:continuation:0",
      frames: [{
        id: "run-approved:continuation:0",
        runId,
        status: "paused",
        reason: "approval_required",
        conversationCursor: 0,
        pendingActionIds: ["run-approved:action-write"],
        pendingToolCallIds: ["run-approved:tool-call-write"],
        pendingClarificationIds: [],
        approvedActionIds: [],
        resolvedClarificationIds: [],
        agentId: options.agentId,
        nodeId: options.nodeId,
        createdAt: 1,
        updatedAt: 1,
      }],
    },
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: {},
    sharedStateSummary: {},
    busStats: {},
    pendingClarifications: [],
    pendingApprovals: ["run-approved:action-write"],
    updatedAt: 1,
  });
}
