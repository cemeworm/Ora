import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { EvaluationCase, EvaluationDatasetDetail, StateSnapshot } from "@cemeworm/shared";
import { LocalRunStore } from "./run-store.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-run-store-self-iteration-"));
}

function makeRun(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    runId: overrides.runId ?? "run-1",
    sessionId: overrides.sessionId ?? "session-1",
    turnIndex: overrides.turnIndex ?? 1,
    status: overrides.status ?? "succeeded",
    pattern: overrides.pattern ?? "orchestrator_subagent",
    modeId: overrides.modeId ?? "single_agent",
    input: overrides.input ?? { prompt: "build a reusable workflow", projectId: "project-1", context: { projectId: "project-1" } } as StateSnapshot["input"],
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

describe("LocalRunStore self-iteration integration", () => {
  it("materializes a learned skill during self-iteration scan", async () => {
    const store = new LocalRunStore({ dataDir: tempDir() });
    const run = makeRun();
    (store as unknown as { runs: Map<string, StateSnapshot> }).runs.set(run.runId, run);

    const result = await store.scanSelfIteration({ projectId: "project-1" });
    const skillCandidate = result.candidates.find((candidate) => candidate.targetKind === "skill");

    expect(skillCandidate?.targetRef.skillName).toBe("learned-single-agent");
    expect(skillCandidate?.status).toBe("applied");
    expect(result.autoApplied.some((candidate) => candidate.targetKind === "skill")).toBe(true);
    expect(() => store.getSkill({ name: "learned-single-agent" })).not.toThrow();
  });

  it("captures missing skill snapshots for create candidates without throwing", async () => {
    const store = new LocalRunStore({ dataDir: tempDir() });
    const candidate = {
      id: "project-1:self:skill:run-1",
      projectId: "project-1",
      targetKind: "skill",
      targetRef: {
        kind: "skill",
        id: "learned-single-agent",
        skillName: "learned-single-agent",
        skillProvenance: "background_auto",
      },
      title: "Create skill draft from run-1",
      summary: "A successful multi-tool workflow can be captured as procedural memory.",
      evidence: [{
        id: "run-1",
        label: "Successful run",
        target: { kind: "run", id: "run-1", runId: "run-1" },
      }],
      proposedChange: {
        operation: "skills.create",
        title: "Create learned-single-agent",
        summary: "Create a private editable skill draft from the observed workflow.",
        after: {
          name: "learned-single-agent",
          description: "Evidence-backed workflow distilled from a successful Ora run.",
          content: "---\nname: learned-single-agent\ndescription: Evidence-backed workflow distilled from a successful Ora run.\n---\nUse this skill when a request resembles run run-1.\n",
        },
        metadata: { runId: "run-1", skillName: "learned-single-agent", skillProvenance: "background_auto" },
      },
      riskLevel: "high",
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
    } as const;

    const snapshot = (store as unknown as { captureSelfIterationBeforeSnapshot(candidate: unknown): unknown }).captureSelfIterationBeforeSnapshot(candidate);
    expect(snapshot).toMatchObject({ kind: "skill", skillName: "learned-single-agent", existed: false });
  });

  it("writes prompt guidance to the authoritative instructions field for single_agent nodes", () => {
    const store = new LocalRunStore({ dataDir: tempDir() });
    const editableMode = store.cloneModeFromPreset({ sourceModeId: "single_agent", modeId: "single_agent_prompt_apply_test" });
    const mode = store.getMode({ modeId: editableMode.id });
    const targetNode = mode.nodes.find((node) => node.enabled) ?? mode.nodes[0];
    expect(targetNode?.id).toBeDefined();

    const firstCandidate = promptCandidate({
      modeId: editableMode.id,
      nodeId: targetNode!.id,
      guidanceText: "First guardrails for repeated semantic failures.",
    });
    const secondCandidate = promptCandidate({
      modeId: editableMode.id,
      nodeId: targetNode!.id,
      guidanceText: "Second guardrails for repeated semantic failures.",
    });

    (store as unknown as { applyPromptSelfIterationCandidate(candidate: unknown): unknown }).applyPromptSelfIterationCandidate(firstCandidate);
    const firstMode = store.getMode({ modeId: editableMode.id });
    const firstInstructions = instructionsTextForMode(firstMode, targetNode!.id);
    expect(firstInstructions).toContain("First guardrails for repeated semantic failures.");
    expect(countPromptGuidanceBlocks(firstInstructions)).toBe(1);
    expect(promptFieldForMode(firstMode, targetNode!.id)).toBeUndefined();

    (store as unknown as { applyPromptSelfIterationCandidate(candidate: unknown): unknown }).applyPromptSelfIterationCandidate(secondCandidate);
    const secondMode = store.getMode({ modeId: editableMode.id });
    const secondInstructions = instructionsTextForMode(secondMode, targetNode!.id);
    expect(secondInstructions).toContain("Second guardrails for repeated semantic failures.");
    expect(secondInstructions).not.toContain("First guardrails for repeated semantic failures.");
    expect(countPromptGuidanceBlocks(secondInstructions)).toBe(1);
    expect(promptFieldForMode(secondMode, targetNode!.id)).toBeUndefined();
  });

  it("migrates legacy appended prompt pollution into instructions and rollback restores the original node", () => {
    const store = new LocalRunStore({ dataDir: tempDir() });
    const editableMode = store.cloneModeFromPreset({ sourceModeId: "single_agent", modeId: "single_agent_prompt_cleanup_test" });
    const originalMode = store.getMode({ modeId: editableMode.id });
    const targetNode = originalMode.nodes.find((node) => node.enabled) ?? originalMode.nodes[0];
    expect(targetNode?.id).toBeDefined();

    store.updateMode({
      modeId: editableMode.id,
      spec: {
        ...originalMode,
        nodes: originalMode.nodes.map((node) => node.id === targetNode!.id
          ? {
              ...node,
              prompt: `${node.instructions}\n\nSelf-Iteration guidance: Old appended guidance.`,
            }
          : node),
      },
    });

    const candidate = promptCandidate({
      modeId: editableMode.id,
      nodeId: targetNode!.id,
      guidanceText: "Replacement guardrails for semantic failures.",
    });
    const snapshot = (store as unknown as { captureSelfIterationBeforeSnapshot(candidate: unknown): unknown }).captureSelfIterationBeforeSnapshot(candidate);

    (store as unknown as { applyPromptSelfIterationCandidate(candidate: unknown): unknown }).applyPromptSelfIterationCandidate(candidate);
    const appliedMode = store.getMode({ modeId: editableMode.id });
    const appliedInstructions = instructionsTextForMode(appliedMode, targetNode!.id);
    expect(appliedInstructions).toContain("Replacement guardrails for semantic failures.");
    expect(promptFieldForMode(appliedMode, targetNode!.id)).toBeUndefined();

    (store as unknown as { rollbackSelfIterationSnapshot(candidate: unknown): void }).rollbackSelfIterationSnapshot({
      ...candidate,
      beforeSnapshot: snapshot,
    });
    const rolledBackMode = store.getMode({ modeId: editableMode.id });
    expect(instructionsTextForMode(rolledBackMode, targetNode!.id)).toBe(targetNode!.instructions ?? "");
    expect(promptFieldForMode(rolledBackMode, targetNode!.id)).toBe(`${targetNode!.instructions}\n\nSelf-Iteration guidance: Old appended guidance.`);
  });

  it("materializes causal subset datasets for prompt impact evaluation and falls back safely", () => {
    const store = new LocalRunStore({ dataDir: tempDir() });
    const sourceDataset = store.importEvaluationDataset({
      name: "Source Causal Dataset",
      sourceFormat: "inline",
      content: JSON.stringify([
        evaluationCase("case-1"),
        evaluationCase("case-2"),
        evaluationCase("case-3"),
      ]),
    }) as EvaluationDatasetDetail;
    const candidate = promptCandidate({
      datasetId: sourceDataset.dataset.id,
      caseIds: ["case-1", "case-3"],
      failureTags: ["latent_goal_missing", "under_clarification"],
    });

    const impact = (store as unknown as { selfIterationImpactDataset(candidate: unknown): { datasetId: string; scope: string; sourceDatasetId?: string; sourceCaseIds?: string[]; sourceConfigId?: string; sourceFailureTags?: string[] } }).selfIterationImpactDataset(candidate);
    expect(impact).toMatchObject({
      scope: "causal_subset",
      sourceDatasetId: sourceDataset.dataset.id,
      sourceCaseIds: ["case-1", "case-3"],
      sourceConfigId: "causal-config",
      sourceFailureTags: ["latent_goal_missing", "under_clarification"],
    });

    const subset = store.getEvaluationDataset({ datasetId: impact.datasetId });
    expect(subset.cases.map((evaluationCase) => evaluationCase.id)).toEqual(["case-1", "case-3"]);
    const repeated = (store as unknown as { selfIterationImpactDataset(candidate: unknown): { datasetId: string; scope: string } }).selfIterationImpactDataset(candidate);
    expect(repeated.datasetId).toBe(impact.datasetId);

    const fallback = (store as unknown as { selfIterationImpactDataset(candidate: unknown): { datasetId: string; scope: string } }).selfIterationImpactDataset(promptCandidate({
      datasetId: "missing-dataset",
      caseIds: ["missing-case"],
    }));
    expect(fallback.scope).toBe("synthetic_fallback");
  });

  it("cleans up orphaned self-iteration impact datasets on startup", () => {
    const dataDir = tempDir();
    const store = new LocalRunStore({ dataDir });
    const orphan = store.importEvaluationDataset({
      name: "Self-Iteration Impact · prompt",
      description: "Inline subset dataset materialized from causal semantic failures for orphan-candidate.",
      sourceFormat: "inline",
      content: JSON.stringify([evaluationCase("orphan-case")]),
      tags: [
        "self-iteration",
        "prompt",
        "causal-semantic",
        "subset",
        "candidate:orphan-candidate",
        "source-dataset:dataset-1",
        "source-config:causal-config",
      ],
    }) as EvaluationDatasetDetail;
    expect(store.getEvaluationDataset({ datasetId: orphan.dataset.id }).dataset.id).toBe(orphan.dataset.id);

    const reloaded = new LocalRunStore({ dataDir });
    expect(() => reloaded.getEvaluationDataset({ datasetId: orphan.dataset.id })).toThrow(/Evaluation dataset not found/);
  });
});

function promptCandidate(overrides: {
  modeId?: string;
  nodeId?: string;
  datasetId?: string;
  caseIds?: string[];
  failureTags?: string[];
  guidanceText?: string;
}) {
  const modeId = overrides.modeId ?? "single_agent";
  const caseIds = overrides.caseIds ?? ["case-1", "case-2"];
  const failureTags = overrides.failureTags ?? ["latent_goal_missing", "under_clarification"];
  return {
    id: `project-1:self:prompt:causal-semantic:${modeId}`,
    projectId: "project-1",
    targetKind: "prompt",
    targetRef: {
      kind: "prompt",
      id: modeId,
      modeId,
      ...(overrides.nodeId ? { nodeId: overrides.nodeId } : {}),
    },
    title: `Tighten semantic clarification guidance for ${modeId}`,
    summary: "Repeated causal semantic-state failures indicate this mode needs stronger latent-goal and clarification guidance before tool use.",
    evidence: [{
      id: "evidence-1",
      label: "Open Evaluation run",
      target: {
        kind: "evaluation",
        id: "eval-causal-1",
        evaluationRunId: "eval-causal-1",
        datasetId: overrides.datasetId ?? "dataset-1",
        caseId: caseIds[0],
      },
    }],
    proposedChange: {
      operation: "mode.node.prompt.update",
      title: "Add causal semantic clarification guidance",
      summary: "Replace or insert a focused clarification guidance block for this mode before tool use.",
      after: "First guardrails for repeated semantic failures.",
      metadata: {
        modeId,
        sourceSignalKind: "causal_semantic_gap",
        causalOrigin: {
          source: "causal_decision",
          insightKind: "semantic_gap",
          evaluationRunId: "eval-causal-1",
          configId: "causal-config",
          datasetId: overrides.datasetId ?? "dataset-1",
          modeId,
          failureTags,
          caseIds,
          evidenceCount: caseIds.length,
        },
        causalProposal: {
          patchKind: "clarification_prompt",
          confidence: caseIds.length >= 3 ? 0.82 : 0.72,
          rationale: "Repeated causal semantic-state failures require stronger latent-goal restatement.",
        },
        promptPatch: {
          marker: "ora-self-iteration-causal-semantic-guidance",
          version: 1,
          guidanceText: overrides.guidanceText ?? (overrides.datasetId === "missing-dataset"
            ? "Fallback guidance"
            : "First guardrails for repeated semantic failures."),
        },
      },
    },
    riskLevel: "high",
    status: "draft",
    createdAt: 1,
    updatedAt: 1,
  } as const;
}

function evaluationCase(caseId: string): EvaluationCase {
  return {
    id: caseId,
    input: { prompt: caseId, context: {} },
    expected: { text: caseId },
    metadata: {},
  };
}

function instructionsTextForMode(mode: { nodes: Array<{ id: string; prompt?: string; instructions?: string }> }, nodeId: string): string {
  return mode.nodes.find((node) => node.id === nodeId)?.instructions ?? "";
}

function promptFieldForMode(mode: { nodes: Array<{ id: string; prompt?: string; instructions?: string }> }, nodeId: string): string | undefined {
  return mode.nodes.find((node) => node.id === nodeId)?.prompt;
}

function countPromptGuidanceBlocks(prompt: string): number {
  return (prompt.match(/\[Ora self-iteration: prompt guidance v1\]/g) ?? []).length;
}
