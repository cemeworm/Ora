import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { StateSnapshot } from "@cemeworm/shared";
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
});
