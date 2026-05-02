import {
  ArtifactRefSchema,
  MODE_STUDIO_BUILDER_MODE_ID,
  ModeStudioBuilderResult,
  ModeStudioBuilderResultSchema,
  ModeStudioDraftBundle,
  ModeStudioStartBuilderRunParams,
  ModeSpec,
  OraEventEnvelope,
  PatternDefinition,
  RunConfig,
  RunConfigSchema,
  StateSnapshot,
  StateSnapshotSchema,
  UserTaskInput,
  UserTaskInputSchema
} from "@cemeworm/shared";
import { modeStudioUserText } from "./mode-studio-draft.js";

export interface ModeStudioBuilderRunResult {
  draftBundle?: ModeStudioDraftBundle;
  issues: Array<{ field: string; message: string }>;
  rawText?: string;
}

export type AppendRunEvent = (
  snapshot: StateSnapshot,
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => StateSnapshot;

export function createModeStudioBuilderInput(
  params: ModeStudioStartBuilderRunParams,
  createdAt: number,
): UserTaskInput {
  return UserTaskInputSchema.parse({
    prompt: modeStudioUserText(params.messages) || "Mode Studio builder request",
    context: {
      kind: "mode_studio_builder",
      operation: params.operation,
      messages: params.messages,
      baseModeId: params.baseModeId,
      currentDraft: params.currentDraft,
      draftBundle: params.draftBundle,
    },
    createdAt,
  });
}

export function createModeStudioBuilderConfig(
  params: ModeStudioStartBuilderRunParams,
  modeSpec: ModeSpec,
): RunConfig {
  return RunConfigSchema.parse({
    pattern: modeSpec.family,
    modeId: modeSpec.id,
    providerId: params.providerId,
    providerConfig: params.providerConfig,
    modelRef: params.modelRef ?? params.providerConfig?.modelId ?? "local/smoke-model",
    approvalMode: "auto",
    metadata: {
      modeStudioBuilder: true,
      operation: params.operation,
    },
    deterministicSeed: "mode-studio-builder",
  });
}

export function startModeStudioBuilderSnapshot(params: {
  snapshot: StateSnapshot;
  builderParams: ModeStudioStartBuilderRunParams;
  appendEvent: AppendRunEvent;
}): StateSnapshot {
  let snapshot = params.appendEvent(params.snapshot, "run.started", {
    kind: "mode_studio_builder",
    operation: params.builderParams.operation,
    messageCount: params.builderParams.messages.length,
  });
  snapshot = params.appendEvent(snapshot, "agent.started", {
    agentId: "orchestrator",
    title: "Read Mode Studio context",
  }, { agentId: "orchestrator", nodeId: "triage" });
  return snapshot;
}

export function completeModeStudioBuilderSnapshot(params: {
  snapshot: StateSnapshot;
  result: ModeStudioBuilderRunResult;
  runId: string;
  definition: PatternDefinition;
  createdAt: number;
  appendEvent: AppendRunEvent;
}): StateSnapshot {
  const output = {
    kind: "mode_studio_builder_result",
    runId: params.runId,
    draftBundle: params.result.draftBundle,
    issues: params.result.issues,
    rawText: params.result.rawText,
  };
  const finalStatus = params.result.draftBundle ? "succeeded" : "failed";
  const finalEventType = finalStatus === "succeeded" ? "run.done" : "run.failed";
  let snapshot = StateSnapshotSchema.parse({
    ...params.snapshot,
    status: finalStatus,
    output,
    artifacts: params.result.draftBundle
      ? [
          ...params.snapshot.artifacts,
          ArtifactRefSchema.parse({
            id: `${params.runId}:artifact:mode-studio-builder-result`,
            runId: params.runId,
            kind: "log",
            label: "Mode Studio builder result",
            mimeType: "application/json",
            createdAt: params.createdAt,
            payload: output,
          }),
        ]
      : params.snapshot.artifacts,
    queueSummary: {
      ...params.snapshot.queueSummary,
      pending: 0,
      inProgress: 0,
      completed: params.result.draftBundle ? params.definition.planTemplate.length : 0,
    },
  });
  snapshot = params.appendEvent(snapshot, "agent.completed", {
    agentId: "orchestrator",
    title: params.result.draftBundle?.needsInput ? "Needs more input" : "Draft bundle ready",
    issues: params.result.issues,
  }, { agentId: "orchestrator", nodeId: "handoff" });
  if (params.result.draftBundle) {
    snapshot = params.appendEvent(snapshot, "artifact.exported", {
      artifact: snapshot.artifacts.at(-1),
    });
  }
  return params.appendEvent(snapshot, finalEventType, {
    kind: "mode_studio_builder",
    valid: params.result.draftBundle?.validation.valid ?? false,
    issueCount: params.result.issues.length,
  });
}

export function modeStudioBuilderResultFromSnapshot(snapshot: StateSnapshot): ModeStudioBuilderResult {
  const output = snapshot.output && typeof snapshot.output === "object"
    ? snapshot.output as Record<string, unknown>
    : {};
  return ModeStudioBuilderResultSchema.parse({
    runId: snapshot.runId,
    status: snapshot.status,
    draftBundle: output.draftBundle,
    issues: output.issues ?? [],
    rawText: output.rawText,
  });
}
