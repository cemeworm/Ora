import {
  CheckpointMeta,
  OraEventEnvelope,
  StateSnapshot,
  StateSnapshotSchema,
  createModeSpecFromPattern,
  type BuiltInCoordinationPattern,
} from "@cemeworm/shared";
import { checkpointLabelForStatus } from "./harness/runtime-prompts.js";
import type { MemoryRecord } from "@cemeworm/shared";
import {
  patternMemoryNamespace,
  patternOutput,
  withTopologyStatus
} from "./run-deterministic-patterns.js";
import {
  currentPendingApprovalActions,
  currentPendingApprovalActionIds,
  currentPendingClarifications,
} from "./run-orchestration.js";

export type AppendRunEvent = (
  snapshot: StateSnapshot,
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => StateSnapshot;

export interface NonKernelResumeMutationDeps {
  appendEvent: AppendRunEvent;
  now: () => number;
  syncTodos: (snapshot: StateSnapshot, reason: string) => StateSnapshot;
}

/**
 * Shared checkpoint creation for both kernel and non-kernel resume paths.
 * Ensures consistent structure and labeling across all resume flows.
 */
export function createResumeCheckpoint(params: {
  runId: string;
  index: number;
  label?: string;
  now: number;
  eventSeq: number;
  stateHash?: string;
}): CheckpointMeta {
  return {
    id: `${params.runId}:checkpoint-${params.index}`,
    runId: params.runId,
    label: params.label ?? checkpointLabelForStatus("succeeded"),
    createdAt: params.now,
    eventSeq: params.eventSeq,
    stateHash: params.stateHash ?? `${params.runId}:resume:${params.eventSeq}`,
  };
}

export function beginNonKernelResume(params: {
  snapshot: StateSnapshot;
  reason: string;
  patch: unknown;
  deps: Pick<NonKernelResumeMutationDeps, "appendEvent" | "syncTodos">;
}): StateSnapshot {
  const resumed = params.deps.appendEvent(params.snapshot, "run.resumed", {
    reason: params.reason,
    patch: params.patch ?? {},
  });
  return params.deps.syncTodos(resumed, "resume.sync");
}

export function resolveNonKernelResumeClarifications(params: {
  snapshot: StateSnapshot;
  clarificationPatch: Record<string, unknown>;
  appendEvent: AppendRunEvent;
}): StateSnapshot {
  let working = params.snapshot;
  const pendingClarifications = currentPendingClarifications(working);
  if (pendingClarifications.length === 0) {
    return working;
  }

  const resolvedIds = new Set<string>();
  for (const clarification of pendingClarifications) {
    const answer = params.clarificationPatch[clarification.id] ?? params.clarificationPatch[clarification.key];
    if (answer === undefined) {
      continue;
    }
    working = params.appendEvent(working, "clarification.resolved", {
      clarificationId: clarification.id,
      nodeId: clarification.nodeId,
      answer,
      mode: "resume",
    });
    resolvedIds.add(clarification.id);
  }

  if (resolvedIds.size === 0) {
    return working;
  }

  const existingClarifications = working.input.context?.clarifications;
  const nextClarifications = typeof existingClarifications === "object" && existingClarifications !== null
    ? { ...existingClarifications, ...params.clarificationPatch }
    : { ...params.clarificationPatch };
  return StateSnapshotSchema.parse({
    ...working,
    input: {
      ...working.input,
      context: {
        ...working.input.context,
        clarifications: nextClarifications,
      },
    },
    pendingClarifications: working.pendingClarifications.filter((clarification) => !resolvedIds.has(clarification.id)),
  });
}

export function applyNonKernelResumeApprovals(
  snapshot: StateSnapshot,
  deps: Pick<NonKernelResumeMutationDeps, "appendEvent" | "now">,
): StateSnapshot {
  let working = snapshot;
  const pendingApprovalActions = currentPendingApprovalActions(working);
  for (const action of pendingApprovalActions) {
    working = deps.appendEvent(working, "approval.resolved", {
      actionId: action.id,
      decision: "approved",
      mode: "resume",
    });

    const approved = { ...action, status: "approved" as const };
    working = deps.appendEvent(
      { ...working, actions: working.actions.map((item) => (item.id === action.id ? approved : item)) },
      "action.updated",
      { actionId: action.id, status: "approved", record: approved },
    );

    const running = { ...approved, status: "running" as const };
    working = deps.appendEvent(
      { ...working, actions: working.actions.map((item) => (item.id === action.id ? running : item)) },
      "action.updated",
      { actionId: action.id, status: "running", record: running },
    );

    const workingModeSpec = working.modeSpec ?? createModeSpecFromPattern(working.pattern as BuiltInCoordinationPattern);
    const output = patternOutput(working.pattern, working.input.prompt, workingModeSpec);
    const createdAt = deps.now();
    const memory: MemoryRecord = {
      id: `${working.runId}:memory:resumed-pattern-state`,
      namespace: patternMemoryNamespace(working.pattern, working.input.projectId, workingModeSpec),
      kind: working.pattern === "agent_teams" ? "worker" : "session",
      value: output.state,
      sourceRunId: working.runId,
      sourceActionId: action.id,
      createdAt,
      updatedAt: createdAt,
    };
    working = deps.appendEvent(
      { ...working, memory: [...working.memory, memory] },
      "memory.updated",
      { record: memory },
    );

    const succeeded = {
      ...running,
      status: "succeeded" as const,
      output: output.state,
    };
    working = deps.appendEvent(
      {
        ...working,
        actions: working.actions.map((item) => (item.id === action.id ? succeeded : item)),
        output: output.state,
      },
      "action.updated",
      { actionId: action.id, status: "succeeded", record: succeeded },
    );
  }
  return working;
}

export function nonKernelResumeNeedsInput(snapshot: StateSnapshot): boolean {
  return currentPendingClarifications(snapshot).length > 0
    || currentPendingApprovalActionIds(snapshot).length > 0;
}

export function interruptedNonKernelResumeSnapshot(snapshot: StateSnapshot, updatedAt: number): StateSnapshot {
  return StateSnapshotSchema.parse({
    ...snapshot,
    status: "interrupted",
    updatedAt,
  });
}

export function completeNonKernelResumeMutation(
  snapshot: StateSnapshot,
  deps: Pick<NonKernelResumeMutationDeps, "appendEvent" | "now">,
): StateSnapshot {
  let working = snapshot;
  const checkpoint = createResumeCheckpoint({
    runId: working.runId,
    index: working.checkpoints.length,
    label: "Resume checkpoint",
    now: deps.now(),
    eventSeq: working.events.length,
  });
  working = deps.appendEvent(
    {
      ...working,
      checkpoints: [...working.checkpoints, checkpoint],
      plan: working.plan.map((item) => ({
        ...item,
        status: "done",
        checkpointIds: [...new Set([...item.checkpointIds, checkpoint.id])],
      })),
    },
    "checkpoint.created",
    {
      checkpoint,
      summary: "Checkpoint captured after deterministic resume.",
    },
    { checkpointId: checkpoint.id },
  );

  const completed = deps.appendEvent(
    {
      ...working,
      status: "running",
      topology: withTopologyStatus(working, "running"),
    },
    "run.done",
    {
      status: "succeeded",
      summary: "Deterministic MVP run resumed and completed.",
    },
  );

  return StateSnapshotSchema.parse({
    ...completed,
    status: "succeeded",
    topology: withTopologyStatus(completed, "done"),
    plan: completed.plan.map((item) => ({ ...item, status: "done" })),
    updatedAt: completed.updatedAt,
  });
}
