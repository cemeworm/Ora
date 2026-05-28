import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { EvaluationFeedbackRecord, EvaluationRun, ProjectInsight, ProjectSignal, StateSnapshot } from "@cemeworm/shared";
import { LocalSelfIterationStore } from "./self-iteration-store.js";
import { selfIterationToolRuntimeFields } from "./harness/runtime-self-iteration-tools.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-self-iteration-"));
}

function makeRun(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    runId: overrides.runId ?? "run-1",
    status: overrides.status ?? "succeeded",
    pattern: overrides.pattern ?? "orchestrator_subagent",
    input: overrides.input ?? { prompt: "build a reusable workflow", projectId: "project-1" } as StateSnapshot["input"],
    config: overrides.config ?? {
      pattern: "orchestrator_subagent",
      modeId: "single_agent",
      modeSelection: "manual",
      profileIds: [],
      skillIds: [],
      toolIds: [],
      approvalMode: "auto",
      permissionMode: "auto_review",
      patternOptions: {},
      metadata: {},
      causalInterventionLevel: "record_only",
      deterministicSeed: "seed",
    } as StateSnapshot["config"],
    topology: overrides.topology ?? { nodes: [], edges: [] },
    profiles: overrides.profiles ?? [],
    memory: overrides.memory ?? [],
    plan: overrides.plan ?? [],
    planList: overrides.planList ?? [],
    todos: overrides.todos ?? [],
    actions: overrides.actions ?? [],
    toolCalls: overrides.toolCalls ?? [
      { id: "tc-1", runId: "run-1", toolId: "file.read", args: {}, source: "provider_native", status: "succeeded", requestedAt: 1, updatedAt: 1 },
      { id: "tc-2", runId: "run-1", toolId: "file.write", args: {}, source: "provider_native", status: "succeeded", requestedAt: 2, updatedAt: 2 },
      { id: "tc-3", runId: "run-1", toolId: "git.status", args: {}, source: "provider_native", status: "succeeded", requestedAt: 3, updatedAt: 3 },
    ],
    continuation: overrides.continuation ?? { frames: [] },
    planDecisions: overrides.planDecisions ?? [],
    conversation: overrides.conversation ?? [],
    toolResults: overrides.toolResults ?? [],
    policyDecisions: overrides.policyDecisions ?? [],
    checkpoints: overrides.checkpoints ?? [],
    events: overrides.events ?? [],
    agentMessages: overrides.agentMessages ?? [],
    artifacts: overrides.artifacts ?? [],
    activeAgents: overrides.activeAgents ?? [],
    queueSummary: overrides.queueSummary ?? {},
    sharedStateSummary: overrides.sharedStateSummary ?? {},
    busStats: overrides.busStats ?? {},
    pendingClarifications: overrides.pendingClarifications ?? [],
    pendingApprovals: overrides.pendingApprovals ?? [],
    updatedAt: overrides.updatedAt ?? 1,
  } as StateSnapshot;
}

function makeInput(): {
  signals: ProjectSignal[];
  insights: ProjectInsight[];
  runs: StateSnapshot[];
  evaluationRuns: EvaluationRun[];
  feedbackRecords: EvaluationFeedbackRecord[];
  skills?: Parameters<LocalSelfIterationStore["scan"]>[1]["skills"];
} {
  return {
    signals: [],
    insights: [],
    runs: [makeRun()],
    evaluationRuns: [],
    feedbackRecords: [],
  };
}

describe("LocalSelfIterationStore", () => {
  it("auto-applies background_auto skill candidates during scan", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 1_000);
    const result = await store.scan({}, makeInput(), {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
      applySkillCandidate: (candidate) => ({ applied: true, candidateId: candidate.id }),
      captureBeforeSnapshot: () => ({ kind: "skill", existed: false }),
      evaluateCandidate: async () => ({ passed: true }),
    });

    const skillCandidate = result.candidates.find((candidate) => candidate.targetKind === "skill");
    expect(skillCandidate?.targetRef.skillProvenance).toBe("background_auto");
    expect(result.autoApplied.some((candidate) => candidate.targetKind === "skill")).toBe(false);
  });

  it("allows background_auto skill apply without explicit confirmation through the tool wrapper", () => {
    const fields = selfIterationToolRuntimeFields("selfIteration.apply");
    const candidate = {
      targetKind: "skill",
      targetRef: { skillProvenance: "background_auto" },
      proposedChange: { metadata: {} },
    } as never;
    const registry = {
      getSelfIterationCandidate: () => candidate,
      applySelfIterationCandidate: (params: Record<string, unknown>) => params,
    };
    const output = fields.execute?.({ candidateId: "skill-1" }, { selfIterationRegistry: registry, allowRisky: false } as never);
    expect(output).toEqual({ output: { candidateId: "skill-1", confirmed: true } });
  });

  it("generates stale, archive, and merge skill governance candidates", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 100 * 24 * 60 * 60 * 1000);
    const result = await store.scan({}, {
      ...makeInput(),
      skills: [
        {
          id: "auto-skill-a",
          name: "auto-skill-a",
          description: "A",
          category: "private",
          enabled: true,
          editable: true,
          provenance: "background_auto",
          lifecycle: "active",
          createdAt: 0,
          updatedAt: 0,
          telemetry: { useCount: 4, viewCount: 0, patchCount: 3, lastUsedAt: 95 * 24 * 60 * 60 * 1000 },
          governance: { history: [{ action: "patch", at: 1 }, { action: "patch", at: 2 }, { action: "patch", at: 3 }] },
        },
        {
          id: "auto-skill-b",
          name: "auto-skill-b",
          description: "A",
          category: "private",
          enabled: true,
          editable: true,
          provenance: "background_auto",
          lifecycle: "active",
          createdAt: 0,
          updatedAt: 0,
          telemetry: { useCount: 1, viewCount: 0, patchCount: 0, lastUsedAt: 80 * 24 * 60 * 60 * 1000 },
        },
        {
          id: "auto-skill-c",
          name: "auto-skill-c",
          description: "C",
          category: "private",
          enabled: true,
          editable: true,
          provenance: "background_auto",
          lifecycle: "stale",
          createdAt: 0,
          updatedAt: 0,
          telemetry: { useCount: 0, viewCount: 0, patchCount: 0, lastUsedAt: 0 },
        },
        {
          id: "auto-skill-d",
          name: "auto-skill-d",
          description: "D",
          category: "private",
          enabled: true,
          editable: true,
          provenance: "background_auto",
          lifecycle: "active",
          createdAt: 0,
          updatedAt: 0,
          telemetry: { useCount: 0, viewCount: 0, patchCount: 0, lastUsedAt: 0 },
        },
      ],
    }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
      applySkillCandidate: (candidate) => ({ applied: true, candidateId: candidate.id, operation: candidate.proposedChange.operation }),
      captureBeforeSnapshot: () => ({ kind: "skill", existed: true, content: "---\nname: x\ndescription: x\n---\n" }),
      evaluateCandidate: async () => ({ passed: true }),
    });

    const operations = result.candidates.filter((candidate) => candidate.targetKind === "skill").map((candidate) => candidate.proposedChange.operation);
    expect(operations).toContain("skills.archive");
    expect(operations).toContain("skills.transitionLifecycle");
    expect(operations).toContain("skills.merge");
    expect(result.autoApplied.some((candidate) => candidate.proposedChange.operation === "skills.archive")).toBe(false);
  });

  it("keeps merge candidates separate from stale/archive candidates", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 100 * 24 * 60 * 60 * 1000);
    const result = await store.scan({}, {
      ...makeInput(),
      skills: [
        {
          id: "merge-a",
          name: "merge-a",
          description: "same",
          category: "private",
          enabled: true,
          editable: true,
          provenance: "background_auto",
          lifecycle: "active",
          createdAt: 0,
          updatedAt: 0,
          telemetry: { useCount: 4, viewCount: 0, patchCount: 3, lastUsedAt: 0 },
          governance: { history: [{ action: "patch", at: 1 }, { action: "patch", at: 2 }, { action: "patch", at: 3 }] },
        },
        {
          id: "merge-b",
          name: "merge-b",
          description: "same",
          category: "private",
          enabled: true,
          editable: true,
          provenance: "background_auto",
          lifecycle: "active",
          createdAt: 0,
          updatedAt: 0,
          telemetry: { useCount: 4, viewCount: 0, patchCount: 0, lastUsedAt: 0 },
        },
      ],
    }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
      applySkillCandidate: (candidate) => ({ applied: true, candidateId: candidate.id, operation: candidate.proposedChange.operation }),
      captureBeforeSnapshot: () => ({ kind: "skill", existed: true, content: "---\nname: x\ndescription: x\n---\n" }),
      evaluateCandidate: async () => ({ passed: true }),
    });

    const operations = result.candidates.filter((candidate) => candidate.targetKind === "skill").map((candidate) => candidate.proposedChange.operation);
    expect(operations).toContain("skills.merge");
  });

  it("auto-applies background_auto skill candidates during curator scan", async () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 1_000);
    const result = await store.triggerCuratorScan({ trigger: "run_completed_idle", force: true }, makeInput(), {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
      applySkillCandidate: (candidate) => ({ applied: true, candidateId: candidate.id }),
      captureBeforeSnapshot: () => ({ kind: "skill", existed: false }),
      evaluateCandidate: async () => ({ passed: true }),
    });

    expect(result.scanned).toBe(true);
    expect(result.result?.autoApplied.some((candidate) => candidate.targetKind === "skill")).toBe(true);
  });
});
