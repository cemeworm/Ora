import { z } from "zod";
import {
  CoordinationPatternSchema,
  RunStatusSchema,
  type RunStatus,
} from "./primitives.js";
import {
  CheckpointMetaSchema,
  OraEventEnvelopeSchema,
  PendingClarificationSchema,
  PlanDecisionGateSchema,
  RunAttentionSchema,
  RunConfigSchema,
  RuntimeToolResultLedgerEntrySchema,
  RuntimeToolResultPreviewSchema,
  SessionBranchGroupSchema,
  SessionContextStateSchema,
  SessionDetailSchema,
  SessionSummarySchema,
  SessionTranscriptMessageSchema,
  SessionTurnSchema,
  StateSnapshotSchema,
  UserTaskInputSchema,
  type CheckpointMeta,
  type OraEventEnvelope,
  type PlanDecisionGate,
  type RunAttention,
  type RunConfig,
  type RuntimeToolResultLedgerEntry,
  type SessionBranchGroup,
  type SessionContextState,
  type SessionDetail,
  type SessionSummary,
  type SessionTranscriptMessage,
  type SessionTurn,
  type StateSnapshot,
  type UserTaskInput,
} from "./runtime.js";

export const RuntimeSessionEntryTypeSchema = z.enum([
  "session.created",
  "session.info",
  "user.message",
  "run.started",
  "runtime.event_batch",
  "assistant.checkpoint",
  "assistant.message",
  "tool.result",
  "gate.opened",
  "gate.resolved",
  "handoff.accepted_plan",
  "compaction.summary",
  "branch.created",
  "branch.candidate_started",
  "branch.adopted",
  "branch.dismissed",
]);
export type RuntimeSessionEntryType = z.infer<typeof RuntimeSessionEntryTypeSchema>;

export const RuntimeSessionEntrySchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  turnIndex: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  type: RuntimeSessionEntryTypeSchema,
  createdAt: z.number().int().nonnegative(),
  payload: z.unknown().default({}),
});
export type RuntimeSessionEntry = z.infer<typeof RuntimeSessionEntrySchema>;

export const RuntimeSessionLedgerSchema = z.object({
  sessionId: z.string().min(1),
  leafEntryId: z.string().min(1).optional(),
  entries: z.array(RuntimeSessionEntrySchema).default([]),
});
export type RuntimeSessionLedger = z.infer<typeof RuntimeSessionLedgerSchema>;

export const RuntimeGateKindSchema = z.enum(["clarification", "approval", "plan_decision"]);
export type RuntimeGateKind = z.infer<typeof RuntimeGateKindSchema>;

export const RuntimeGateProjectionSchema = z.object({
  gateId: z.string().min(1),
  kind: RuntimeGateKindSchema,
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(["open", "resolved"]),
  openedAt: z.number().int().nonnegative(),
  resolvedAt: z.number().int().nonnegative().optional(),
  pendingActionIds: z.array(z.string().min(1)).default([]),
  pendingToolCallIds: z.array(z.string().min(1)).default([]),
  pendingClarificationIds: z.array(z.string().min(1)).default([]),
  planDecisionId: z.string().min(1).optional(),
  clarification: PendingClarificationSchema.optional(),
  planDecision: PlanDecisionGateSchema.optional(),
});
export type RuntimeGateProjection = z.infer<typeof RuntimeGateProjectionSchema>;

export const RuntimeAcceptedPlanHandoffSchema = z.object({
  decisionId: z.string().min(1),
  sourceRunId: z.string().min(1),
  planContent: z.string().min(1),
  acceptedAt: z.number().int().nonnegative(),
  consumedByRunId: z.string().min(1).optional(),
});
export type RuntimeAcceptedPlanHandoff = z.infer<typeof RuntimeAcceptedPlanHandoffSchema>;

export const RuntimeRunProjectionSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  turnIndex: z.number().int().positive(),
  status: RunStatusSchema,
  attention: RunAttentionSchema,
  input: UserTaskInputSchema,
  config: RunConfigSchema,
  pattern: CoordinationPatternSchema,
  modeId: z.string().min(1).optional(),
  events: z.array(OraEventEnvelopeSchema).default([]),
  eventCount: z.number().int().nonnegative().default(0),
  checkpoints: z.array(CheckpointMetaSchema).default([]),
  toolResults: z.array(RuntimeToolResultLedgerEntrySchema).default([]),
  gates: z.array(RuntimeGateProjectionSchema).default([]),
  planDecisions: z.array(PlanDecisionGateSchema).default([]),
  output: z.unknown().optional(),
  error: z.string().optional(),
  finalSnapshot: StateSnapshotSchema.optional(),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type RuntimeRunProjection = z.infer<typeof RuntimeRunProjectionSchema>;

export const RuntimeSessionProjectionSchema = z.object({
  session: SessionSummarySchema,
  turns: z.array(SessionTurnSchema),
  transcript: z.array(SessionTranscriptMessageSchema).default([]),
  branchGroups: z.array(SessionBranchGroupSchema).default([]),
  latestSnapshot: StateSnapshotSchema.optional(),
  runs: z.array(RuntimeRunProjectionSchema).default([]),
  gates: z.array(RuntimeGateProjectionSchema).default([]),
  acceptedPlanHandoffs: z.array(RuntimeAcceptedPlanHandoffSchema).default([]),
  contextState: SessionContextStateSchema.optional(),
  leafEntryId: z.string().min(1).optional(),
});
export type RuntimeSessionProjection = z.infer<typeof RuntimeSessionProjectionSchema>;

const SessionCreatedPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});

const SessionInfoPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  archivedAt: z.number().int().nonnegative().optional(),
});

const UserMessagePayloadSchema = z.object({
  content: z.string().min(1),
});

const RunStartedPayloadSchema = z.object({
  input: UserTaskInputSchema,
  config: RunConfigSchema,
  modeId: z.string().min(1).optional(),
  status: RunStatusSchema.default("running"),
});

const RuntimeEventBatchPayloadSchema = z.object({
  events: z.array(OraEventEnvelopeSchema).default([]),
  eventCount: z.number().int().nonnegative().optional(),
  status: RunStatusSchema.optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  snapshot: StateSnapshotSchema.optional(),
});

const AssistantCheckpointPayloadSchema = z.object({
  checkpoint: CheckpointMetaSchema,
});

const AssistantMessagePayloadSchema = z.object({
  content: z.string().default(""),
  status: RunStatusSchema.optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  snapshot: StateSnapshotSchema.optional(),
});

const ToolResultPayloadSchema = z.object({
  result: RuntimeToolResultLedgerEntrySchema,
});

const GateOpenedPayloadSchema = z.object({
  gateId: z.string().min(1),
  kind: RuntimeGateKindSchema,
  pendingActionIds: z.array(z.string().min(1)).default([]),
  pendingToolCallIds: z.array(z.string().min(1)).default([]),
  pendingClarificationIds: z.array(z.string().min(1)).default([]),
  clarification: PendingClarificationSchema.optional(),
  planDecision: PlanDecisionGateSchema.optional(),
});

const GateResolvedPayloadSchema = z.object({
  gateId: z.string().min(1),
  status: z.enum(["accepted", "declined", "resolved"]).default("resolved"),
  resolvedAt: z.number().int().nonnegative().optional(),
});

const AcceptedPlanHandoffPayloadSchema = RuntimeAcceptedPlanHandoffSchema;

const CompactionSummaryPayloadSchema = z.object({
  contextState: SessionContextStateSchema,
});

const BranchGroupPayloadSchema = SessionBranchGroupSchema.partial().extend({
  branchGroupId: z.string().min(1),
  supersededRunId: z.string().min(1).optional(),
  notifiedCandidateRunIds: z.array(z.string().min(1)).optional(),
  dismissedRunIds: z.array(z.string().min(1)).optional(),
});

interface ProjectionState {
  title: string;
  projectId: string | undefined;
  createdAt: number | undefined;
  updatedAt: number;
  archivedAt: number | undefined;
  runs: Map<string, RuntimeRunProjection>;
  gates: Map<string, RuntimeGateProjection>;
  transcript: SessionTranscriptMessage[];
  acceptedPlanHandoffs: RuntimeAcceptedPlanHandoff[];
  contextState: SessionContextState | undefined;
  branchGroups: Map<string, SessionBranchGroup>;
}

export function orderedRuntimeSessionEntries(entries: readonly RuntimeSessionEntry[]): RuntimeSessionEntry[] {
  return entries
    .map((entry) => RuntimeSessionEntrySchema.parse(entry))
    .sort((a, b) =>
      a.seq - b.seq ||
      runtimeSessionEntryReplayOrder(a) - runtimeSessionEntryReplayOrder(b) ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id)
    );
}

function runtimeSessionEntryReplayOrder(entry: RuntimeSessionEntry): number {
  switch (entry.type) {
    case "session.created":
      return 0;
    case "session.info":
      return 10;
    case "branch.created":
      return 20;
    case "branch.candidate_started":
      return 30;
    case "user.message":
      return 40;
    case "run.started":
      return 50;
    case "runtime.event_batch":
      return 60;
    case "assistant.checkpoint":
      return 70;
    case "tool.result":
      return 80;
    case "gate.opened":
      return 90;
    case "gate.resolved":
      return 100;
    case "handoff.accepted_plan":
      return 110;
    case "compaction.summary":
      return 120;
    case "assistant.message":
      return 130;
    case "branch.adopted":
      return 140;
    case "branch.dismissed":
      return 150;
  }
}

export function runtimeSessionEntryPath(
  ledger: RuntimeSessionLedger,
  leafEntryId = ledger.leafEntryId,
): RuntimeSessionEntry[] {
  const parsed = RuntimeSessionLedgerSchema.parse(ledger);
  const entriesById = new Map(parsed.entries.map((entry) => [entry.id, entry]));
  if (!leafEntryId) {
    return orderedRuntimeSessionEntries(parsed.entries);
  }
  const path: RuntimeSessionEntry[] = [];
  let cursor: string | undefined = leafEntryId;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) {
      throw new Error(`Cycle detected in runtime session ledger at entry '${cursor}'.`);
    }
    seen.add(cursor);
    const entry = entriesById.get(cursor);
    if (!entry) {
      // Parent was filtered out (e.g. lazy-loaded event batch); stop here.
      break;
    }
    path.push(entry);
    cursor = entry.parentId;
  }
  return path.reverse().map((entry) => RuntimeSessionEntrySchema.parse(entry));
}

/**
 * Build a ledger with reduced payload: keep all entries but strip the heavy
 * `events` array from runtime.event_batch payloads, preserving structural
 * fields (status, output, error) and parent chains as-is.
 */
export function buildVisibleLedger(ledger: RuntimeSessionLedger): RuntimeSessionLedger {
  const parsed = RuntimeSessionLedgerSchema.parse(ledger);
  if (parsed.entries.length === 0) {
    return parsed;
  }

  const slimmed = parsed.entries.map((entry) => {
    if (entry.type !== "runtime.event_batch") {
      return entry;
    }
    const payload = entry.payload as Record<string, unknown>;
    return {
      ...entry,
      payload: {
        events: [],
        eventCount: payload.eventCount,
        status: payload.status,
        output: payload.output,
        error: payload.error,
      },
    };
  });

  return RuntimeSessionLedgerSchema.parse({
    sessionId: parsed.sessionId,
    leafEntryId: parsed.leafEntryId,
    entries: slimmed,
  });
}

export function deriveSessionProjection(
  ledger: RuntimeSessionLedger,
  leafEntryId = ledger.leafEntryId,
): RuntimeSessionProjection {
  const parsed = RuntimeSessionLedgerSchema.parse(ledger);
  const entries = runtimeSessionEntryPath(parsed, leafEntryId);
  const state: ProjectionState = {
    title: "New Chat",
    projectId: undefined,
    createdAt: undefined,
    updatedAt: 0,
    archivedAt: undefined,
    runs: new Map(),
    gates: new Map(),
    transcript: [],
    acceptedPlanHandoffs: [],
    contextState: undefined,
    branchGroups: new Map(),
  };

  for (const entry of entries) {
    applyEntryToProjection(state, entry);
  }

  const hiddenRunIds = new Set(
    [...state.branchGroups.values()]
      .filter((group) => group.status === "adopted" && group.target === "replace_latest" && group.replaceRunId)
      .map((group) => group.replaceRunId!),
  );
  for (const run of state.runs.values()) {
    const metadata = run.finalSnapshot?.config.metadata ?? run.config.metadata;
    if (
      metadata.branchRole === "adopted" &&
      metadata.branchTarget === "replace_latest" &&
      typeof metadata.branchReplaceRunId === "string"
    ) {
      hiddenRunIds.add(metadata.branchReplaceRunId);
    }
  }
  const runs = [...state.runs.values()]
    .filter((run) => !hiddenRunIds.has(run.runId))
    .map((run) => RuntimeRunProjectionSchema.parse({
      ...run,
      gates: [...state.gates.values()].filter((gate) => gate.runId === run.runId),
      attention: deriveLedgerRunAttention({
        ...run,
        gates: [...state.gates.values()].filter((gate) => gate.runId === run.runId),
      }),
    }))
    .sort((a, b) => a.turnIndex - b.turnIndex || a.startedAt - b.startedAt || a.runId.localeCompare(b.runId));
  const latest = runs.at(-1);
  const session = SessionSummarySchema.parse({
    sessionId: parsed.sessionId,
    title: state.title,
    projectId: state.projectId,
    status: latest?.status,
    attention: latest?.attention,
    latestRunId: latest?.runId,
    latestPattern: latest?.pattern,
    latestModeId: latest?.modeId,
    latestProviderId: typeof latest?.config.providerId === "string" ? latest.config.providerId : undefined,
    latestModelRef: latest?.config.modelRef,
    turnCount: runs.length,
    contextState: state.contextState,
    createdAt: state.createdAt ?? entries[0]?.createdAt ?? 0,
    updatedAt: Math.max(state.updatedAt, latest?.updatedAt ?? 0, entries.at(-1)?.createdAt ?? 0),
    archivedAt: state.archivedAt,
  });
  const turns = runs.map(toLedgerSessionTurn);
  const latestSnapshot = latest ? runtimeRunProjectionToSnapshot(latest, state.contextState) : undefined;
  const visibleRunIds = new Set(runs.map((run) => run.runId));

  return RuntimeSessionProjectionSchema.parse({
    session,
    turns,
    transcript: state.transcript.filter((message) => visibleRunIds.has(message.runId)),
    branchGroups: [...state.branchGroups.values()],
    latestSnapshot,
    runs,
    gates: [...state.gates.values()],
    acceptedPlanHandoffs: state.acceptedPlanHandoffs,
    contextState: state.contextState,
    leafEntryId,
  });
}

export function deriveRunProjection(
  ledger: RuntimeSessionLedger,
  runId: string,
  leafEntryId = ledger.leafEntryId,
): RuntimeRunProjection | undefined {
  return deriveSessionProjection(ledger, leafEntryId).runs.find((run) => run.runId === runId);
}

export function deriveRunSnapshot(
  ledger: RuntimeSessionLedger,
  runId: string,
  leafEntryId?: string,
  projection?: RuntimeSessionProjection,
): StateSnapshot | undefined {
  const proj = projection ?? deriveSessionProjection(ledger, leafEntryId ?? ledger.leafEntryId);
  const run = proj.runs.find((candidate) => candidate.runId === runId);
  return run ? runtimeRunProjectionToSnapshot(run, proj.contextState) : undefined;
}

export function deriveLedgerRunAttention(run: Pick<RuntimeRunProjection, "runId" | "status" | "gates" | "error" | "events">): RunAttention {
  const openGates = run.gates.filter((gate) => gate.status === "open");
  const clarification = openGates.find((gate) => gate.kind === "clarification");
  if (clarification) {
    return RunAttentionSchema.parse({
      kind: "needs_clarification",
      blocking: true,
      sourceRunId: run.runId,
      reason: "clarification_required",
      pendingClarificationIds: clarification.pendingClarificationIds,
    });
  }
  const approval = openGates.find((gate) => gate.kind === "approval");
  if (approval) {
    return RunAttentionSchema.parse({
      kind: "needs_approval",
      blocking: true,
      sourceRunId: run.runId,
      reason: "approval_required",
      pendingActionIds: approval.pendingActionIds,
      pendingToolCallIds: approval.pendingToolCallIds,
    });
  }
  const planDecision = openGates.find((gate) => gate.kind === "plan_decision");
  if (planDecision) {
    return RunAttentionSchema.parse({
      kind: "needs_plan_decision",
      blocking: true,
      sourceRunId: run.runId,
      reason: "plan_decision_required",
      planDecisionId: planDecision.planDecisionId ?? planDecision.gateId,
    });
  }
  if (run.status === "queued" || run.status === "running") {
    return RunAttentionSchema.parse({ kind: "running", blocking: false, sourceRunId: run.runId });
  }
  if (run.status === "interrupted") {
    if (hasIncompleteResolvedHumanGateResume(run)) {
      return RunAttentionSchema.parse({
        kind: "failed",
        blocking: false,
        sourceRunId: run.runId,
        reason: run.error ?? "resume_incomplete_after_gate_resolution",
      });
    }
    return RunAttentionSchema.parse({ kind: "paused", blocking: false, sourceRunId: run.runId, reason: "manual_interrupt" });
  }
  if (run.status === "failed") {
    return RunAttentionSchema.parse({ kind: "failed", blocking: false, sourceRunId: run.runId, reason: run.error });
  }
  if (run.status === "cancelled") {
    return RunAttentionSchema.parse({ kind: "cancelled", blocking: false, sourceRunId: run.runId, reason: run.error });
  }
  return RunAttentionSchema.parse({ kind: "idle", blocking: false, sourceRunId: run.runId });
}

function hasIncompleteResolvedHumanGateResume(
  run: Pick<RuntimeRunProjection, "gates" | "events">,
): boolean {
  const latestResolvedGateAt = run.gates.reduce((latest, gate) =>
    gate.status === "resolved" ? Math.max(latest, gate.resolvedAt ?? gate.openedAt) : latest,
  0);
  if (latestResolvedGateAt === 0) {
    return false;
  }
  if (run.events.length === 0) {
    // Events unavailable (e.g. slimmed ledger). Conservative: treat as
    // paused rather than failed, since we can't distinguish a manual
    // interrupt from an incomplete resume without event data.
    return false;
  }
  const manualInterruptAfterResume = run.events.some((event) =>
    event.type === "run.interrupted" &&
    event.createdAt >= latestResolvedGateAt &&
    event.payload &&
    typeof event.payload === "object" &&
    typeof (event.payload as Record<string, unknown>).reason === "string"
  );
  return !manualInterruptAfterResume;
}

function applyEntryToProjection(state: ProjectionState, entry: RuntimeSessionEntry): void {
  state.updatedAt = Math.max(state.updatedAt, entry.createdAt);
  switch (entry.type) {
    case "session.created": {
      const payload = SessionCreatedPayloadSchema.parse(entry.payload);
      state.title = payload.title ?? state.title;
      state.projectId = payload.projectId ?? state.projectId;
      state.createdAt = state.createdAt ?? entry.createdAt;
      break;
    }
    case "session.info": {
      const payload = SessionInfoPayloadSchema.parse(entry.payload);
      state.title = payload.title ?? state.title;
      state.projectId = payload.projectId ?? state.projectId;
      state.archivedAt = payload.archivedAt ?? state.archivedAt;
      break;
    }
    case "user.message": {
      const payload = UserMessagePayloadSchema.parse(entry.payload);
      if (entry.runId) {
        state.transcript.push(SessionTranscriptMessageSchema.parse({
          id: entry.id,
          sessionId: entry.sessionId,
          runId: entry.runId,
          turnIndex: Math.max(1, entry.turnIndex),
          role: "user",
          content: payload.content,
          pattern: runPattern(state.runs.get(entry.runId)),
          modeId: state.runs.get(entry.runId)?.modeId,
          createdAt: entry.createdAt,
        }));
      }
      break;
    }
    case "run.started": {
      const payload = RunStartedPayloadSchema.parse(entry.payload);
      if (!entry.runId) break;
      const run = RuntimeRunProjectionSchema.parse({
        runId: entry.runId,
        sessionId: entry.sessionId,
        turnIndex: Math.max(1, entry.turnIndex),
        status: payload.status,
        attention: RunAttentionSchema.parse({ kind: "running", blocking: false, sourceRunId: entry.runId }),
        input: payload.input,
        config: payload.config,
        pattern: payload.config.pattern,
        modeId: payload.modeId ?? payload.config.modeId,
        events: [],
        checkpoints: [],
        toolResults: [],
        gates: [],
        planDecisions: [],
        startedAt: entry.createdAt,
        updatedAt: entry.createdAt,
      });
      state.runs.set(entry.runId, run);
      break;
    }
    case "runtime.event_batch": {
      const payload = RuntimeEventBatchPayloadSchema.parse(entry.payload);
      const batchEventCount = payload.eventCount ?? payload.events.length;
      const eventFacts = runtimeEventBatchFacts(payload.events);
      updateRun(state, entry, (run) => ({
        ...run,
        events: [...run.events, ...payload.events],
        eventCount: run.eventCount + batchEventCount,
        status: eventFacts.status ?? payload.status ?? run.status,
        output: eventFacts.output ?? payload.output ?? run.output,
        error: eventFacts.error ?? payload.error ?? run.error,
        checkpoints: eventFacts.checkpoints.length > 0
          ? upsertCheckpoints(run.checkpoints, eventFacts.checkpoints)
          : run.checkpoints,
        finalSnapshot: payload.snapshot ?? run.finalSnapshot,
      }));
      break;
    }
    case "assistant.checkpoint": {
      const payload = AssistantCheckpointPayloadSchema.parse(entry.payload);
      updateRun(state, entry, (run) => ({
        ...run,
        checkpoints: [...run.checkpoints, payload.checkpoint],
      }));
      break;
    }
    case "assistant.message": {
      const payload = AssistantMessagePayloadSchema.parse(entry.payload);
      updateRun(state, entry, (run) => ({
        ...run,
        status: payload.status ?? run.status,
        output: payload.output ?? (payload.content ? { text: payload.content } : run.output),
        error: payload.error ?? run.error,
        finalSnapshot: payload.snapshot ?? run.finalSnapshot,
      }));
      if (entry.runId && payload.content.trim()) {
        const run = state.runs.get(entry.runId);
        state.transcript.push(SessionTranscriptMessageSchema.parse({
          id: entry.id,
          sessionId: entry.sessionId,
          runId: entry.runId,
          turnIndex: Math.max(1, entry.turnIndex),
          role: "assistant",
          content: payload.content,
          pattern: runPattern(run),
          modeId: run?.modeId,
          createdAt: entry.createdAt,
        }));
      }
      break;
    }
    case "tool.result": {
      const payload = ToolResultPayloadSchema.parse(entry.payload);
      updateRun(state, entry, (run) => ({
        ...run,
        toolResults: [...run.toolResults, payload.result],
      }));
      break;
    }
    case "gate.opened": {
      const payload = GateOpenedPayloadSchema.parse(entry.payload);
      if (!entry.runId) break;
      const existing = state.gates.get(payload.gateId);
      if (existing?.status === "resolved") {
        break;
      }
      const gate = RuntimeGateProjectionSchema.parse({
        gateId: payload.gateId,
        kind: payload.kind,
        runId: entry.runId,
        sessionId: entry.sessionId,
        status: "open",
        openedAt: entry.createdAt,
        pendingActionIds: payload.pendingActionIds,
        pendingToolCallIds: payload.pendingToolCallIds,
        pendingClarificationIds: payload.pendingClarificationIds,
        planDecisionId: payload.planDecision?.id,
        clarification: payload.clarification,
        planDecision: payload.planDecision,
      });
      state.gates.set(gate.gateId, gate);
      updateRun(state, entry, (run) => ({
        ...run,
        planDecisions: gate.planDecision ? upsertPlanDecision(run.planDecisions, gate.planDecision) : run.planDecisions,
      }));
      break;
    }
    case "gate.resolved": {
      const payload = GateResolvedPayloadSchema.parse(entry.payload);
      const existing = state.gates.get(payload.gateId);
      if (existing) {
        const resolved = RuntimeGateProjectionSchema.parse({
          ...existing,
          status: "resolved",
          resolvedAt: payload.resolvedAt ?? entry.createdAt,
          planDecision: existing.planDecision
            ? {
                ...existing.planDecision,
                status: payload.status === "declined" ? "declined" : "accepted",
                resolvedAt: payload.resolvedAt ?? entry.createdAt,
              }
            : undefined,
        });
        state.gates.set(payload.gateId, resolved);
        updateRun(state, { ...entry, runId: existing.runId }, (run) => ({
          ...run,
          planDecisions: resolved.planDecision ? upsertPlanDecision(run.planDecisions, resolved.planDecision) : run.planDecisions,
        }));
      }
      break;
    }
    case "handoff.accepted_plan": {
      state.acceptedPlanHandoffs = upsertAcceptedPlanHandoff(
        state.acceptedPlanHandoffs,
        AcceptedPlanHandoffPayloadSchema.parse(entry.payload),
      );
      break;
    }
    case "compaction.summary": {
      state.contextState = CompactionSummaryPayloadSchema.parse(entry.payload).contextState;
      break;
    }
    case "branch.created":
    case "branch.candidate_started":
    case "branch.adopted":
    case "branch.dismissed": {
      const payload = BranchGroupPayloadSchema.parse(entry.payload);
      const existing = state.branchGroups.get(payload.branchGroupId);
      state.branchGroups.set(payload.branchGroupId, SessionBranchGroupSchema.parse({
        branchGroupId: payload.branchGroupId,
        sessionId: entry.sessionId,
        target: payload.target ?? existing?.target ?? "append_after_latest",
        baseRunId: payload.baseRunId ?? existing?.baseRunId,
        replaceRunId: payload.replaceRunId ?? existing?.replaceRunId,
        baseTurnIndex: payload.baseTurnIndex ?? existing?.baseTurnIndex ?? 0,
        prompt: payload.prompt ?? existing?.prompt ?? "",
        status: entry.type === "branch.adopted" ? "adopted" : entry.type === "branch.dismissed" ? "dismissed" : payload.status ?? existing?.status ?? "running",
        candidateRunIds: payload.candidateRunIds ?? existing?.candidateRunIds ?? [],
        candidates: payload.candidates ?? existing?.candidates ?? [],
        adoptedRunId: payload.adoptedRunId ?? existing?.adoptedRunId,
        createdAt: payload.createdAt ?? existing?.createdAt ?? entry.createdAt,
        updatedAt: Math.max(payload.updatedAt ?? 0, existing?.updatedAt ?? 0, entry.createdAt),
      }));
      // Restore branch metadata to affected runs for ledger replay consistency.
      if (entry.type === "branch.adopted") {
        if (payload.supersededRunId) {
          const superseded = state.runs.get(payload.supersededRunId);
          if (superseded) {
            state.runs.set(payload.supersededRunId, RuntimeRunProjectionSchema.parse({
              ...superseded,
              config: {
                ...superseded.config,
                metadata: {
                  ...superseded.config.metadata,
                  supersededByRunId: payload.adoptedRunId,
                  supersededAt: entry.createdAt,
                },
              },
            }));
          }
        }
        if (payload.notifiedCandidateRunIds) {
          for (const runId of payload.notifiedCandidateRunIds) {
            const run = state.runs.get(runId);
            if (run) {
              state.runs.set(runId, RuntimeRunProjectionSchema.parse({
                ...run,
                config: {
                  ...run.config,
                  metadata: {
                    ...run.config.metadata,
                    branchGroupAdoptedRunId: payload.adoptedRunId,
                  },
                },
              }));
            }
          }
        }
      }
      if (entry.type === "branch.dismissed" && payload.dismissedRunIds) {
        for (const runId of payload.dismissedRunIds) {
          const run = state.runs.get(runId);
          if (run) {
            state.runs.set(runId, RuntimeRunProjectionSchema.parse({
              ...run,
              config: {
                ...run.config,
                metadata: {
                  ...run.config.metadata,
                  branchDismissed: true,
                  branchDismissedAt: entry.createdAt,
                },
              },
            }));
          }
        }
      }
      break;
    }
  }
}

function updateRun(
  state: ProjectionState,
  entry: RuntimeSessionEntry & { runId?: string },
  update: (run: RuntimeRunProjection) => RuntimeRunProjection,
): void {
  if (!entry.runId) {
    return;
  }
  const run = state.runs.get(entry.runId);
  if (!run) {
    return;
  }
  state.runs.set(entry.runId, RuntimeRunProjectionSchema.parse({
    ...update(run),
    updatedAt: Math.max(run.updatedAt, entry.createdAt),
  }));
}

function runtimeEventBatchFacts(events: readonly OraEventEnvelope[]): {
  status?: RuntimeRunProjection["status"];
  output?: unknown;
  error?: string;
  checkpoints: CheckpointMeta[];
} {
  let status: RuntimeRunProjection["status"] | undefined;
  let output: unknown;
  let error: string | undefined;
  const checkpoints: CheckpointMeta[] = [];
  for (const event of events) {
    if (event.type === "checkpoint.created") {
      const payload = event.payload && typeof event.payload === "object"
        ? event.payload as Record<string, unknown>
        : {};
      const maybeCheckpoint = payload.checkpoint;
      if (maybeCheckpoint && typeof maybeCheckpoint === "object") {
        checkpoints.push(CheckpointMetaSchema.parse(maybeCheckpoint));
      } else if (typeof payload.checkpointId === "string") {
        checkpoints.push(CheckpointMetaSchema.parse({
          id: payload.checkpointId,
          runId: event.runId,
          label: typeof payload.label === "string" ? payload.label : "Checkpoint",
          createdAt: event.createdAt,
          eventSeq: event.seq,
        }));
      }
      continue;
    }
    if (
      event.type !== "run.done" &&
      event.type !== "run.failed" &&
      event.type !== "run.cancelled"
    ) {
      continue;
    }
    const payload = event.payload && typeof event.payload === "object"
      ? event.payload as Record<string, unknown>
      : {};
    if (
      payload.status === "queued" ||
      payload.status === "running" ||
      payload.status === "interrupted" ||
      payload.status === "succeeded" ||
      payload.status === "failed" ||
      payload.status === "cancelled"
    ) {
      status = payload.status;
    } else if (event.type === "run.done") {
      status = "succeeded";
    } else if (event.type === "run.failed") {
      status = "failed";
    } else {
      status = "cancelled";
    }
    if ("output" in payload) {
      output = payload.output;
    }
    if (typeof payload.error === "string") {
      error = payload.error;
    } else if (typeof payload.reason === "string") {
      error = payload.reason;
    }
  }
  return { status, output, error, checkpoints };
}

function upsertCheckpoints(
  existing: readonly CheckpointMeta[],
  next: readonly CheckpointMeta[],
): CheckpointMeta[] {
  const byId = new Map(existing.map((checkpoint) => [checkpoint.id, checkpoint]));
  for (const checkpoint of next) {
    byId.set(checkpoint.id, checkpoint);
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function upsertPlanDecision(decisions: readonly PlanDecisionGate[], decision: PlanDecisionGate): PlanDecisionGate[] {
  const without = decisions.filter((candidate) => candidate.id !== decision.id);
  return [...without, decision].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function upsertAcceptedPlanHandoff(
  handoffs: readonly RuntimeAcceptedPlanHandoff[],
  handoff: RuntimeAcceptedPlanHandoff,
): RuntimeAcceptedPlanHandoff[] {
  const without = handoffs.filter((candidate) =>
    candidate.decisionId !== handoff.decisionId || candidate.sourceRunId !== handoff.sourceRunId
  );
  return [...without, handoff].sort((a, b) => a.acceptedAt - b.acceptedAt || a.decisionId.localeCompare(b.decisionId));
}

function toLedgerSessionTurn(run: RuntimeRunProjection): SessionTurn {
  return SessionTurnSchema.parse({
    runId: run.runId,
    sessionId: run.sessionId,
    turnIndex: run.turnIndex,
    status: run.status,
    attention: run.attention,
    pattern: run.pattern,
    modeId: run.modeId,
    providerId: typeof run.config.providerId === "string" ? run.config.providerId : undefined,
    modelRef: run.config.modelRef,
    prompt: run.input.prompt,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    eventCount: run.eventCount,
    checkpointCount: run.checkpoints.length,
    artifactCount: 0,
  });
}

function runtimeRunProjectionToSnapshot(run: RuntimeRunProjection, contextState?: SessionContextState): StateSnapshot {
  if (run.finalSnapshot) {
    return reconcileSnapshotRuntimeFields(StateSnapshotSchema.parse({
      ...run.finalSnapshot,
      status: run.status,
      attention: run.attention,
      planDecisions: run.planDecisions.length > 0 ? run.planDecisions : run.finalSnapshot.planDecisions,
      pendingClarifications: run.gates.flatMap((gate) => gate.status === "open" && gate.clarification ? [gate.clarification] : []),
      pendingApprovals: run.gates.flatMap((gate) => gate.status === "open" ? gate.pendingActionIds : []),
      output: run.output ?? run.finalSnapshot.output,
      error: run.error ?? run.finalSnapshot.error,
      contextState: contextState ?? run.finalSnapshot.contextState,
      events: run.events,
      checkpoints: run.checkpoints.length > 0 ? run.checkpoints : run.finalSnapshot.checkpoints,
      toolResults: run.toolResults.length > 0 ? run.toolResults : run.finalSnapshot.toolResults,
      updatedAt: run.updatedAt,
      snapshotSource: "ledger" as const,
    }), run.gates);
  }
  return StateSnapshotSchema.parse({
    runId: run.runId,
    sessionId: run.sessionId,
    turnIndex: run.turnIndex,
    status: run.status,
    attention: run.attention,
    pattern: run.pattern,
    coordinationKind: run.pattern,
    modeId: run.modeId,
    input: run.input,
    config: run.config,
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    planList: [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    planDecisions: run.planDecisions,
    conversation: [],
    contextState,
    toolResults: run.toolResults,
    policyDecisions: [],
    checkpoints: run.checkpoints,
    events: run.events,
    agentMessages: [],
    artifacts: [],
    activeAgents: run.status === "running" ? ["orchestrator"] : [],
    queueSummary: { mode: "dag", pending: 0, inProgress: run.status === "running" ? 1 : 0, completed: run.status === "succeeded" ? 1 : 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: run.gates.flatMap((gate) => gate.status === "open" && gate.clarification ? [gate.clarification] : []),
    pendingApprovals: run.gates.flatMap((gate) => gate.status === "open" ? gate.pendingActionIds : []),
    output: run.output,
    error: run.error,
    updatedAt: run.updatedAt,
    snapshotSource: "ledger" as const,
  });
}

function reconcileSnapshotRuntimeFields(snapshot: StateSnapshot, gates: readonly RuntimeGateProjection[]): StateSnapshot {
  let actions = snapshot.actions;
  let toolCalls = snapshot.toolCalls;
  let events = snapshot.events;
  let toolResults = snapshot.toolResults;
  let conversation = snapshot.conversation;
  let continuation = snapshot.continuation;
  let artifacts = snapshot.artifacts;

  for (const event of snapshot.events) {
    if (!event.payload || typeof event.payload !== "object") {
      continue;
    }
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "action.updated" && payload.record && typeof payload.record === "object") {
      const record = payload.record as StateSnapshot["actions"][number];
      if (typeof record.id !== "string") {
        continue;
      }
      actions = actions.map((action) => action.id === record.id ? record : action);
      toolCalls = toolCalls.map((call) =>
        call.actionId === record.id
          ? {
              ...call,
              status: record.status === "approval_required"
                ? "approval_required"
                : record.status === "running"
                  ? "running"
                  : record.status === "succeeded"
                    ? "succeeded"
                    : record.status === "failed"
                      ? "failed"
                      : call.status,
              updatedAt: event.createdAt,
            }
          : call
      );
    }
    if (event.type === "tool.called") {
      const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
      const status = payload.status;
      if (!toolCallId || (status !== "succeeded" && status !== "failed")) {
        continue;
      }
      const resultPreview = payload.resultPreview && typeof payload.resultPreview === "object"
        ? RuntimeToolResultPreviewSchema.safeParse(payload.resultPreview).data
        : undefined;
      toolCalls = toolCalls.map((call) =>
        call.id === toolCallId
          ? {
              ...call,
              status,
              result: {
                status,
                output: payload.output,
                error: typeof payload.error === "string" ? payload.error : undefined,
                content: payload.output === undefined ? undefined : JSON.stringify(payload.output),
                resultPreview,
                createdAt: event.createdAt,
                updatedAt: event.createdAt,
              },
              updatedAt: event.createdAt,
            }
          : call
      );
    }
    if ((event.type === "artifact.exported" || event.type === "artifact.degraded") && payload.artifact && typeof payload.artifact === "object") {
      artifacts = upsertById(artifacts, payload.artifact as StateSnapshot["artifacts"][number]);
    }
  }

  let nextSeq = events.reduce((max, event) => Math.max(max, event.seq), -1) + 1;
  const appendProjectedEvent = (type: OraEventEnvelope["type"], payload: unknown, createdAt: number): void => {
    events = [
      ...events,
      OraEventEnvelopeSchema.parse({
        id: `${snapshot.runId}:ledger-projected-${nextSeq}`,
        runId: snapshot.runId,
        seq: nextSeq,
        type,
        createdAt,
        pattern: snapshot.pattern,
        payload,
      }),
    ];
    nextSeq += 1;
  };

  for (const gate of gates) {
    if (gate.status !== "resolved") {
      continue;
    }
    if (gate.kind === "clarification") {
      for (const clarificationId of gate.pendingClarificationIds) {
        const exists = events.some((event) =>
          event.type === "clarification.resolved" &&
          event.payload &&
          typeof event.payload === "object" &&
          (event.payload as Record<string, unknown>).clarificationId === clarificationId
        );
        if (!exists) {
          appendProjectedEvent("clarification.resolved", {
            clarificationId,
            mode: "ledger_projection",
          }, gate.resolvedAt ?? gate.openedAt);
        }
      }
    }
    if (gate.kind === "approval") {
      for (const actionId of gate.pendingActionIds) {
        const exists = events.some((event) =>
          event.type === "approval.resolved" &&
          event.payload &&
          typeof event.payload === "object" &&
          (event.payload as Record<string, unknown>).actionId === actionId
        );
        if (!exists) {
          appendProjectedEvent("approval.resolved", {
            actionId,
            decision: "approved",
            mode: "ledger_projection",
          }, gate.resolvedAt ?? gate.openedAt);
        }
      }
    }
  }

  const resolvedApprovalActionIds = new Set(
    gates
      .filter((gate) => gate.status === "resolved" && gate.kind === "approval")
      .flatMap((gate) => gate.pendingActionIds),
  );
  if (snapshot.status === "succeeded" && resolvedApprovalActionIds.size > 0) {
    actions = actions.map((action) =>
      resolvedApprovalActionIds.has(action.id) &&
      (action.status === "approval_required" || action.status === "approved" || action.status === "running")
        ? { ...action, status: "succeeded" as const }
        : action
    );
    toolCalls = toolCalls.map((call) =>
      call.actionId && resolvedApprovalActionIds.has(call.actionId) &&
      (call.status === "approval_required" || call.status === "approved" || call.status === "running")
        ? { ...call, status: "succeeded" as const, updatedAt: snapshot.updatedAt }
        : call
    );
    continuation = {
      ...continuation,
      frames: continuation.frames.map((frame) =>
        frame.reason === "approval_required" &&
        frame.pendingActionIds.some((actionId) => resolvedApprovalActionIds.has(actionId))
          ? {
              ...frame,
              status: "completed" as const,
              pendingActionIds: [],
              pendingToolCallIds: [],
              approvedActionIds: [...new Set([...frame.approvedActionIds, ...resolvedApprovalActionIds])],
              updatedAt: snapshot.updatedAt,
            }
          : frame
      ),
    };
  }
  for (const call of toolCalls) {
    if (call.status !== "succeeded" && call.status !== "failed") {
      continue;
    }
    if (!call.actionId || !resolvedApprovalActionIds.has(call.actionId)) {
      continue;
    }
    const exists = events.some((event) =>
      event.type === "tool.called" &&
      event.payload &&
      typeof event.payload === "object" &&
      (event.payload as Record<string, unknown>).toolCallId === call.id
    );
    if (!exists) {
      appendProjectedEvent("tool.called", {
        toolCallId: call.id,
        actionId: call.actionId,
        toolId: call.toolId,
        source: "ledger_projection",
        status: call.status,
        input: call.args,
        output: call.result?.output,
        error: call.result?.error,
        resultPreview: call.result?.resultPreview,
        cacheHit: false,
      }, call.updatedAt);
    }
  }
  for (const action of actions) {
    if ((action.status !== "succeeded" && action.status !== "failed") || !resolvedApprovalActionIds.has(action.id)) {
      continue;
    }
    const exists = events.some((event) =>
      event.type === "tool.called" &&
      event.payload &&
      typeof event.payload === "object" &&
      (event.payload as Record<string, unknown>).actionId === action.id
    );
    if (exists) {
      continue;
    }
    const call = toolCalls.find((candidate) => candidate.actionId === action.id);
    appendProjectedEvent("tool.called", {
      toolCallId: call?.id,
      actionId: action.id,
      toolId: action.type,
      source: "ledger_projection",
      status: action.status,
      input: action.input,
      output: action.output,
      error: action.error,
      cacheHit: false,
    }, call?.updatedAt ?? snapshot.updatedAt);
    if (call && !toolResults.some((result) => result.resultToolCallId === call.id)) {
      toolResults = [
        ...toolResults,
        {
          key: `${action.type}:${JSON.stringify(action.input ?? {})}`,
          toolId: action.type,
          argsDigest: JSON.stringify(action.input ?? {}),
          resultToolCallId: call.id,
          status: action.status,
          output: action.output,
          error: action.error,
          resultPreview: call.result?.resultPreview,
          createdAt: call.updatedAt,
          updatedAt: call.updatedAt,
        },
      ];
    }
  }

  const preferredResolvedCallIds = new Set<string>();
  for (const actionId of resolvedApprovalActionIds) {
    const preferred = [...toolCalls]
      .reverse()
      .find((call) => call.actionId === actionId && (call.status === "succeeded" || call.status === "failed"))
      ?? [...toolCalls].reverse().find((call) => call.actionId === actionId);
    if (preferred) {
      preferredResolvedCallIds.add(preferred.id);
    }
  }
  toolCalls = toolCalls.filter((call) => !call.actionId || !resolvedApprovalActionIds.has(call.actionId) || preferredResolvedCallIds.has(call.id));
  const replayedApprovedToolKeys = new Set<string>();
  toolCalls = [...toolCalls].reverse().filter((call) => {
    if (call.status !== "succeeded" || !isDeterministicApprovedTool(call.toolId)) {
      return true;
    }
    const action = call.actionId ? actions.find((candidate) => candidate.id === call.actionId) : undefined;
    if (!call.actionId || !action || !resolvedApprovalActionIds.has(call.actionId)) {
      return true;
    }
    const key = `${call.toolId}:${JSON.stringify(call.args ?? {})}`;
    if (replayedApprovedToolKeys.has(key)) {
      return false;
    }
    replayedApprovedToolKeys.add(key);
    return true;
  }).reverse();
  for (const call of toolCalls) {
    if (!call.actionId || !resolvedApprovalActionIds.has(call.actionId) || (call.status !== "succeeded" && call.status !== "failed")) {
      continue;
    }
    if (toolResults.some((result) => result.resultToolCallId === call.id && result.status === call.status)) {
      continue;
    }
    toolResults = [
      ...toolResults,
      {
        key: `${call.toolId}:${JSON.stringify(call.args ?? {})}`,
        toolId: call.toolId,
        argsDigest: JSON.stringify(call.args ?? {}),
        resultToolCallId: call.id,
        status: call.status,
        output: call.result?.output,
        error: call.result?.error,
        createdAt: call.updatedAt,
        updatedAt: call.updatedAt,
      },
    ];
    if (!conversation.some((entry) =>
      entry.role === "tool" &&
      entry.toolCallId === call.id &&
      entry.toolId === call.toolId &&
      entry.status === call.status
    )) {
      conversation = [
        ...conversation,
        {
          role: "tool",
          toolCallId: call.id,
          providerCallId: call.providerCallId,
          toolId: call.toolId,
          content: call.result?.content ?? JSON.stringify(call.result?.output ?? ""),
          status: call.status,
          createdAt: call.updatedAt,
        },
      ];
    }
  }

  return StateSnapshotSchema.parse({
    ...snapshot,
    actions,
    toolCalls,
    toolResults,
    conversation,
    continuation,
    artifacts,
    events,
  });
}

function upsertById<T extends { id: string }>(items: readonly T[], next: T): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  byId.set(next.id, next);
  return [...byId.values()];
}

function isDeterministicApprovedTool(toolId: string): boolean {
  return toolId === "file.write" ||
    toolId === "file.patch" ||
    toolId === "shell.execute" ||
    toolId === "skills.create" ||
    toolId === "skills.update" ||
    toolId === "skills.setEnabled" ||
    toolId === "mcp.call" ||
    toolId === "package.promote" ||
    toolId === "package.switch" ||
    toolId === "package.rollback";
}

function runPattern(run: RuntimeRunProjection | undefined): RuntimeRunProjection["pattern"] {
  return run?.pattern ?? "orchestrator_subagent";
}

export function runtimeSessionProjectionToDetail(projection: RuntimeSessionProjection): SessionDetail {
  return SessionDetailSchema.parse({
    session: projection.session,
    turns: projection.turns,
    transcript: projection.transcript,
    branchGroups: projection.branchGroups,
    latestSnapshot: projection.latestSnapshot,
    snapshotSource: "ledger",
  });
}
