import { describe, expect, it } from "vitest";
import type { StateSnapshot } from "@cemeworm/shared";
import { adaptCausalDecisionsFromTrace } from "./causal-decision-adapter.js";

function mockSnapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  const now = Date.now();
  return {
    runId: "run-adapter-1",
    turnIndex: 1,
    status: "succeeded",
    pattern: "solo_agent",
    input: { prompt: "帮我优化一下那个东西的性能", context: {}, createdAt: now },
    config: { pattern: "solo_agent", metadata: {} },
    topology: { nodes: [], edges: [] },
    profiles: [{ id: "solo_agent", label: "Solo Agent", role: "执行所有任务" }],
    memory: [],
    plan: [],
    planList: [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    planDecisions: [],
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: now,
    ...overrides,
  } as unknown as StateSnapshot;
}

function event(seq: number, type: string, payload: unknown = {}, createdAt?: number) {
  return {
    id: `evt-${seq}`,
    runId: "run-adapter-1",
    seq,
    type,
    createdAt: createdAt ?? Date.now() + seq * 1000,
    payload,
  } as any;
}

function toolCall(overrides: Record<string, unknown> = {}): any {
  const now = Date.now();
  return {
    id: overrides.id ?? `call-1`,
    runId: "run-adapter-1",
    toolId: overrides.toolId ?? "file.read",
    args: overrides.args ?? {},
    source: "agent",
    status: overrides.status ?? "succeeded",
    requestedAt: overrides.requestedAt ?? now,
    updatedAt: now,
    result: { kind: "text", text: "mock result" },
    ...overrides,
  };
}

describe("causal decision adapter", () => {
  it("returns answer_directly for snapshot with no trace signals", () => {
    const snapshot = mockSnapshot();
    const decisions = adaptCausalDecisionsFromTrace(snapshot);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.chosenIntervention).toBe("answer_directly");
    expect(decisions[0]!.policyDecision.reason).toContain("[adapter-inferred]");
  });

  it("infers clarify from clarification.required event", () => {
    const snapshot = mockSnapshot({
      events: [event(1, "clarification.required", { question: "你想优化哪个方面？" })],
    });
    const decisions = adaptCausalDecisionsFromTrace(snapshot);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.chosenIntervention).toBe("clarify");
    expect(decisions[0]!.policyDecision.goalUncertainty).toBe(0.7);
  });

  it("infers request_approval from approval.required event", () => {
    const snapshot = mockSnapshot({
      events: [event(1, "approval.required", { action: "file.write" })],
    });
    const decisions = adaptCausalDecisionsFromTrace(snapshot);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.chosenIntervention).toBe("request_approval");
    expect(decisions[0]!.policyDecision.actionRisk).toBe(0.8);
    expect(decisions[0]!.policyDecision.reversibility).toBe("low");
  });

  it("infers search_web from web.search tool call", () => {
    const snapshot = mockSnapshot({
      toolCalls: [
        toolCall({ toolId: "web.search", args: { query: "react 性能优化" } }),
      ],
    });
    const decisions = adaptCausalDecisionsFromTrace(snapshot);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.chosenIntervention).toBe("search_web");
    expect(decisions[0]!.policyDecision.factUncertainty).toBe(0.7);
  });

  it("infers read_context from file.read tool call", () => {
    const snapshot = mockSnapshot({
      toolCalls: [
        toolCall({ toolId: "file.read", args: { path: "/src/App.tsx" } }),
      ],
    });
    const decisions = adaptCausalDecisionsFromTrace(snapshot);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.chosenIntervention).toBe("read_context");
    expect(decisions[0]!.policyDecision.contextUncertainty).toBe(0.6);
  });

  it("infers use_tool from shell tool call", () => {
    const snapshot = mockSnapshot({
      toolCalls: [
        toolCall({ toolId: "shell.run", args: { command: "npm test" } }),
      ],
    });
    const decisions = adaptCausalDecisionsFromTrace(snapshot);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.chosenIntervention).toBe("use_tool");
    expect(decisions[0]!.policyDecision.actionRisk).toBe(0.8);
  });

  it("produces multiple decisions for mixed signals", () => {
    const base = Date.now();
    const snapshot = mockSnapshot({
      events: [
        event(1, "clarification.required", {}, base),
        event(2, "approval.required", {}, base + 2000),
      ],
      toolCalls: [
        toolCall({ toolId: "web.search", args: { query: "test" }, requestedAt: base + 4000 }),
      ],
    });
    const decisions = adaptCausalDecisionsFromTrace(snapshot);
    expect(decisions).toHaveLength(3);
    expect(decisions[0]!.chosenIntervention).toBe("clarify");
    expect(decisions[1]!.chosenIntervention).toBe("request_approval");
    expect(decisions[2]!.chosenIntervention).toBe("search_web");
  });

  it("groups same tool type into one decision point", () => {
    const snapshot = mockSnapshot({
      toolCalls: [
        toolCall({ id: "call-1", toolId: "file.read", args: { path: "/a.ts" } }),
        toolCall({ id: "call-2", toolId: "file.read", args: { path: "/b.ts" }, requestedAt: Date.now() + 1000 }),
      ],
    });
    const decisions = adaptCausalDecisionsFromTrace(snapshot);
    // Two file.read calls → one read_context decision
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.chosenIntervention).toBe("read_context");
  });

  it("all output records match CausalDecisionRecord shape", () => {
    const snapshot = mockSnapshot({
      events: [
        event(1, "clarification.required"),
        event(2, "approval.required"),
      ],
      toolCalls: [
        toolCall({ id: "call-1", toolId: "file.read", args: { path: "/a.ts" } }),
        toolCall({ id: "call-2", toolId: "web.search", args: { query: "x" }, requestedAt: Date.now() + 1000 }),
      ],
    });
    const decisions = adaptCausalDecisionsFromTrace(snapshot);
    for (const d of decisions) {
      expect(d).toHaveProperty("taskState");
      expect(d).toHaveProperty("policyDecision");
      expect(d).toHaveProperty("chosenIntervention");
      expect(d).toHaveProperty("alternativeInterventions");
      expect(d).toHaveProperty("recordedAt");
      expect(d.policyDecision.reason).toContain("[adapter-inferred]");
      expect(d.taskState.surfaceRequest).toBe(snapshot.input!.prompt);
    }
  });

  it("marks wouldChangeOutcomeIfWrong for high-risk or high-uncertainty decisions", () => {
    const approval = mockSnapshot({
      events: [event(1, "approval.required")],
    });
    const direct = mockSnapshot();

    const approvalDecisions = adaptCausalDecisionsFromTrace(approval);
    const directDecisions = adaptCausalDecisionsFromTrace(direct);

    expect(approvalDecisions[0]!.policyDecision.wouldChangeOutcomeIfWrong).toBe(true);
    expect(directDecisions[0]!.policyDecision.wouldChangeOutcomeIfWrong).toBe(false);
  });
});
