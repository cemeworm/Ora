import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalSelfIterationStore } from "../src/self-iteration-store.js";
import type { EvaluationFeedbackRecord, ProjectSignal, StateSnapshot } from "@ora/shared";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-self-iteration-"));
}

describe("LocalSelfIterationStore", () => {
  it("creates and auto-applies evaluation candidates under low-risk policy", () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 1000);
    const applied: string[] = [];
    const feedback = feedbackRecord("feedback-1", "The answer missed the required citation.");
    const result = store.scan({}, {
      signals: [],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [feedback],
    }, {
      applyEvaluationCandidate: (candidate) => {
        applied.push(candidate.targetRef.feedbackId ?? "");
        return { acceptedFeedbackId: candidate.targetRef.feedbackId };
      },
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.targetKind).toBe("evaluation");
    expect(result.autoApplied[0]?.status).toBe("applied");
    expect(applied).toEqual(["feedback-1"]);
  });

  it("requires confirmation before applying prompt candidates", () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 2000);
    const signal = recoverySignal();
    store.scan({ autoApplyEvaluation: false }, {
      signals: [signal],
      insights: [],
      runs: [],
      evaluationRuns: [],
      feedbackRecords: [],
    }, {
      applyEvaluationCandidate: () => ({ applied: true }),
    });
    const candidate = store.listCandidates({ targetKind: "prompt" })[0]!;

    expect(() => store.applyCandidate({ candidateId: candidate.id }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ applied: true }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
    })).toThrow(/require confirmation/);

    const applied = store.applyCandidate({ candidateId: candidate.id, confirmed: true }, {
      applyEvaluationCandidate: () => ({ applied: true }),
      applyPromptCandidate: () => ({ modeId: "single_agent" }),
      applySkillCandidate: () => ({ applied: true }),
      applyModeCandidate: () => ({ applied: true }),
    });
    expect(applied.status).toBe("applied");
    expect(applied.applyResult).toEqual({ modeId: "single_agent" });
  });

  it("creates skill candidates from successful multi-tool runs", () => {
    const store = new LocalSelfIterationStore(tempDir(), () => 3000);
    store.scan({ autoApplyEvaluation: false }, {
      signals: [],
      insights: [],
      runs: [successfulRun()],
      evaluationRuns: [],
      feedbackRecords: [],
    }, {
      applyEvaluationCandidate: () => ({ applied: true }),
    });
    const candidate = store.listCandidates({ targetKind: "skill" })[0]!;
    expect(candidate.proposedChange.operation).toBe("skills.create");
    expect(candidate.proposedChange.after).toMatchObject({ name: "learned-single-agent" });
  });
});

function feedbackRecord(id: string, feedbackText: string): EvaluationFeedbackRecord {
  return {
    id,
    status: "pending",
    feedbackText,
    sourceRunId: "run-1",
    draft: {
      case: {
        id: `case-${id}`,
        input: { prompt: "Original prompt", context: {} },
        expected: { text: "Better answer" },
        metadata: { failureMode: "missed_requirement", tags: [] },
      },
      rationale: "Test draft",
      confidence: 0.8,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function recoverySignal(): ProjectSignal {
  return {
    id: "signal-1",
    projectId: "local-project",
    source: "recovery_event",
    sourceRef: "run-1:evt-1",
    title: "Recovery exhausted",
    summary: "Recovery was exhausted.",
    severity: "critical",
    confidence: 0.9,
    createdAt: 1,
    updatedAt: 1,
    evidence: [{ id: "run-1:evt-1", label: "Trail", target: { kind: "trail", id: "run-1", runId: "run-1" } }],
    metadata: { eventType: "recovery.exhausted", modeId: "single_agent" },
  };
}

function successfulRun(): StateSnapshot {
  return {
    runId: "run-success",
    sessionId: "session-1",
    turnIndex: 1,
    projectId: "local-project",
    pattern: "single_agent",
    modeId: "single_agent",
    status: "succeeded",
    input: { prompt: "Do the workflow", context: {}, createdAt: 1 },
    events: [],
    actions: [],
    toolCalls: [
      { id: "tool-1", toolId: "file.read", status: "succeeded", requestedAt: 1, updatedAt: 1, input: {}, output: {} },
      { id: "tool-2", toolId: "file.grep", status: "succeeded", requestedAt: 2, updatedAt: 2, input: {}, output: {} },
    ],
    todos: [],
    artifacts: [],
    agentMessages: [],
    conversation: [],
    pendingClarifications: [],
    pendingApprovals: [],
    createdAt: 1,
    updatedAt: 2,
  };
}
