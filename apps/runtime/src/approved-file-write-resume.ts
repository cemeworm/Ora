import { OraEventEnvelope, resolvePublicAssistantText, StateSnapshot, StateSnapshotSchema, type PendingClarificationOption } from "@cemeworm/shared";
import type { ActionRecord } from "@cemeworm/shared";
import { RuntimeSkillRegistry, RuntimeToolRegistry } from "./harness/capability-registries.js";
import { continuationHandlerRegistry } from "./harness/approved-tool-continuation-handler.js";
import { registerFileContinuationHandler } from "./harness/file-continuation-handler.js";
import { registerGenericContinuationHandlers } from "./harness/generic-continuation-handler.js";
import { isRuntimeToolImplemented, RuntimeToolExecutor, type RuntimeToolId } from "./harness/runtime-tool-executor.js";
import { PackageManager } from "./package-manager.js";
import { invokeRunProvider, type ModelMessage } from "./providers/index.js";
import {
  evaluateRuntimeCompletionGuards,
  type RuntimeCompletionGuardResult,
  assertRunCanBecomeTerminal,
  deriveTerminalStateAssertionFromSnapshot,
  TerminalStateIntegrityError,
} from "./harness/runtime-completion-guards.js";
import {
  currentPendingApprovalActions,
  currentPendingApprovalToolActionIds,
  currentPendingClarifications,
} from "./run-orchestration.js";
import { activePlanStepId, planListUpdatedPayload } from "./harness/runtime-plan-list-state.js";
import { finalOutputContractViolation } from "./harness/runtime-output.js";

const USER_RESUMED_MESSAGE = "Confirmed. Continuing.";

registerFileContinuationHandler();
registerGenericContinuationHandlers();

export interface ApprovedFileWriteResumeDeps {
  skillRegistry: RuntimeSkillRegistry;
  now: () => number;
  appendEvent: (
    snapshot: StateSnapshot,
    type: OraEventEnvelope["type"],
    payload: unknown,
    extra?: Partial<OraEventEnvelope>,
  ) => StateSnapshot;
  attachTraceMetadata: (snapshot: StateSnapshot) => StateSnapshot;
  buildConversationMessages: (sessionId: string, currentPrompt: string, excludeRunId?: string) => ModelMessage[];
  clarificationAnswer?: (key: string, id: string) => unknown;
  ensureClarification?: (params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options?: PendingClarificationOption[];
  }) => Promise<unknown>;
  signal?: AbortSignal;
}

type ContinueGuardResult = Extract<RuntimeCompletionGuardResult, { allowComplete: false }>;

export type ApprovedToolContinuationResult =
  | { kind: "completed"; snapshot: StateSnapshot }
  | { kind: "continue"; snapshot: StateSnapshot; guardResult: ContinueGuardResult };

type ToolContinuationMode = "approval" | "clarification";

type ToolContinuationParams = {
  reason?: string;
  patch?: unknown;
  continuationMode?: ToolContinuationMode;
};

function isContinuationParams(value: unknown): value is ToolContinuationParams {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolvedClarificationIdsForPatch(
  snapshot: StateSnapshot,
  patch: unknown,
): string[] {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return [];
  }
  const patchRecord = patch as Record<string, unknown>;
  const clarifications = patchRecord.clarifications;
  if (!clarifications || typeof clarifications !== "object" || Array.isArray(clarifications)) {
    return [];
  }
  const clarificationPatch = clarifications as Record<string, unknown>;
  return currentPendingClarifications(snapshot)
    .filter((clarification) =>
      clarificationPatch[clarification.id] !== undefined ||
      clarificationPatch[clarification.key] !== undefined
    )
    .map((clarification) => clarification.id);
}

function continuationActionsByIds(
  snapshot: StateSnapshot,
  continuationActionIds: readonly string[],
): ActionRecord[] {
  if (continuationActionIds.length === 0) {
    return [];
  }
  const continuationIdSet = new Set(continuationActionIds);
  const continuable = snapshot.actions.filter((action) =>
    continuationIdSet.has(action.id) &&
    continuationHandlerRegistry.get(action.type) !== undefined
  );
  return continuable.length > 0 && continuable.length === continuationIdSet.size
    ? continuable
    : [];
}

export function approvedToolContinuationActions(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
): ActionRecord[] {
  if (currentPendingClarifications(snapshot).length > 0) {
    return [];
  }
  const approvedIds = new Set(approvedActionIds);
  const pendingActions = currentPendingApprovalActions(snapshot);
  const pendingToolActionIds = new Set(currentPendingApprovalToolActionIds(snapshot));
  const approvedTools = pendingActions.filter((action) =>
    approvedIds.has(action.id) &&
    pendingToolActionIds.has(action.id) &&
    continuationHandlerRegistry.get(action.type) !== undefined
  );
  return approvedTools.length > 0 && approvedTools.length === pendingActions.length
    ? approvedTools
    : [];
}

export function clarificationResolvedToolContinuationActions(
  snapshot: StateSnapshot,
  clarificationPatch: Record<string, unknown>,
): ActionRecord[] {
  const resolvedClarifications = currentPendingClarifications(snapshot);
  if (resolvedClarifications.length === 0) {
    return [];
  }
  const resolvedIds = new Set<string>();
  for (const clarification of resolvedClarifications) {
    if (clarification.id in clarificationPatch || clarification.key in clarificationPatch) {
      resolvedIds.add(clarification.id);
    }
  }
  if (resolvedIds.size === 0) {
    return [];
  }
  const activeFrame = snapshot.continuation.frames.find((frame) => frame.id === snapshot.continuation.activeFrameId);
  if (!activeFrame || activeFrame.reason !== "clarification_required") {
    return [];
  }
  if (!activeFrame.pendingClarificationIds.some((id) => resolvedIds.has(id))) {
    return [];
  }
  const pendingActionIds = new Set(activeFrame.pendingActionIds);
  if (pendingActionIds.size === 0) {
    return [];
  }
  const continuable = snapshot.actions.filter((action) =>
    pendingActionIds.has(action.id)
    && continuationHandlerRegistry.get(action.type) !== undefined
  );
  return continuable.length > 0 && continuable.length === pendingActionIds.size
    ? continuable
    : [];
}

export function approvedFileWriteResumeActions(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
): ActionRecord[] {
  return approvedToolContinuationActions(snapshot, approvedActionIds)
    .filter((action) => action.type === "file.write" || action.type === "file.apply_patch");
}

export async function completeApprovedToolContinuation(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
  continuationActionIdsOrParams: string[] | ToolContinuationParams = approvedActionIds,
  paramsOrDeps: ToolContinuationParams | ApprovedFileWriteResumeDeps = {},
  depsOrOnEvent?: ApprovedFileWriteResumeDeps | ((event: OraEventEnvelope, snapshot: StateSnapshot) => void),
  maybeOnEvent?: (event: OraEventEnvelope, snapshot: StateSnapshot) => void,
): Promise<ApprovedToolContinuationResult | undefined> {
  const normalized = Array.isArray(continuationActionIdsOrParams)
    ? {
        continuationActionIds: continuationActionIdsOrParams,
        params: isContinuationParams(paramsOrDeps) ? paramsOrDeps : {},
        deps: (isContinuationParams(paramsOrDeps) ? depsOrOnEvent : paramsOrDeps) as ApprovedFileWriteResumeDeps,
        onEvent: (isContinuationParams(paramsOrDeps) ? maybeOnEvent : depsOrOnEvent) as
          | ((event: OraEventEnvelope, snapshot: StateSnapshot) => void)
          | undefined,
      }
    : {
        continuationActionIds: approvedActionIds,
        params: continuationActionIdsOrParams,
        deps: paramsOrDeps as ApprovedFileWriteResumeDeps,
        onEvent: depsOrOnEvent as ((event: OraEventEnvelope, snapshot: StateSnapshot) => void) | undefined,
      };
  const continuationActionIds = normalized.continuationActionIds;
  const params = normalized.params;
  const deps = normalized.deps;
  const onEvent = normalized.onEvent;
  const approvedTools = continuationActionsByIds(snapshot, continuationActionIds);
  if (approvedTools.length === 0) {
    return undefined;
  }
  const toolResults: Array<{
    toolId: string;
    path?: unknown;
    sizeBytes?: unknown;
    content?: unknown;
    output?: unknown;
    failed: boolean;
  }> = [];

  const executor = new RuntimeToolExecutor({
    workspace: snapshot.input.context?.projectWorkspace,
    hostFilesystem: snapshot.hostFilesystem ?? snapshot.config.hostFilesystem,
    toolDescriptors: new RuntimeToolRegistry().list(),
    skillRegistry: deps.skillRegistry,
    searchProviderConfig: snapshot.config.searchProvider,
    packageManager: new PackageManager(),
    signal: deps.signal,
  });

  const continuationIdSet = new Set(continuationActionIds);
  const frameId = snapshot.continuation.activeFrameId ?? `${snapshot.runId}:continuation:${snapshot.continuation.frames.length}`;
  const existingFrame = snapshot.continuation.frames.find((frame) => frame.id === frameId);
  const continuationMode = params.continuationMode ?? "approval";
  const resolvedClarificationIds = continuationMode === "clarification"
    ? resolvedClarificationIdsForPatch(snapshot, params.patch)
    : [];
  const createdAt = existingFrame?.createdAt ?? deps.now();
  const pendingToolCallIds = snapshot.toolCalls
    .filter((call) => call.actionId && continuationIdSet.has(call.actionId))
    .map((call) => call.id);
  let working = StateSnapshotSchema.parse({
    ...snapshot,
    status: "running",
    pendingApprovals: snapshot.pendingApprovals.filter((actionId) => !approvedActionIds.includes(actionId)),
    continuation: upsertContinuationFrame(snapshot, {
      id: frameId,
      runId: snapshot.runId,
      status: "resuming",
      reason: continuationMode === "clarification"
        ? existingFrame?.reason ?? "clarification_required"
        : "approval_required",
      conversationCursor: snapshot.conversation.length,
      pendingActionIds: approvedTools.map((action) => action.id),
      pendingToolCallIds,
      pendingClarificationIds: continuationMode === "clarification"
        ? existingFrame?.pendingClarificationIds ?? []
        : [],
      approvedActionIds: continuationMode === "clarification"
        ? existingFrame?.approvedActionIds ?? []
        : approvedActionIds,
      resolvedClarificationIds: continuationMode === "clarification"
        ? [...new Set([...(existingFrame?.resolvedClarificationIds ?? []), ...resolvedClarificationIds])]
        : [],
      agentId: existingFrame?.agentId,
      nodeId: existingFrame?.nodeId,
      planItemId: existingFrame?.planItemId,
      modelIteration: existingFrame?.modelIteration,
      resumedFromFrameId: existingFrame?.resumedFromFrameId,
      nodeCheckpoint: existingFrame?.nodeCheckpoint ?? {
        modeId: snapshot.modeId,
        agentId: existingFrame?.agentId,
        nodeId: existingFrame?.nodeId,
        planItemId: existingFrame?.planItemId,
        eventSeq: snapshot.events.at(-1)?.seq,
        conversationCursor: snapshot.conversation.length,
        bag: {},
      },
      createdAt,
      updatedAt: deps.now(),
    }),
    updatedAt: deps.now(),
  });
  const append = (type: OraEventEnvelope["type"], payload: unknown, base: StateSnapshot = working) => {
    working = deps.appendEvent(base, type, payload);
    const event = working.events.at(-1);
    if (event) {
      onEvent?.(event, working);
    }
  };
  const replaceAction = (record: ActionRecord) => {
    working = StateSnapshotSchema.parse({
      ...working,
      actions: working.actions.map((action) => (action.id === record.id ? record : action)),
    });
  };
  const replaceToolCall = (
    actionId: string,
    status: "approved" | "running" | "succeeded" | "failed",
    result?: { output?: unknown; error?: string; content?: string },
  ) => {
    const updatedAt = deps.now();
    const currentPlanStepId = activePlanStepId(working.planList);
    working = StateSnapshotSchema.parse({
      ...working,
      planList: working.planList.length > 0
        ? planListUpdatedPayload({ plan: working.planList }).plan
        : working.planList,
      toolCalls: working.toolCalls.map((call) =>
        call.actionId === actionId
          ? {
              ...call,
              planStepId: call.planStepId ?? currentPlanStepId,
              status,
              updatedAt,
              result: result
                ? {
                    status,
                    output: result.output,
                    error: result.error,
                    content: result.content,
                    createdAt: updatedAt,
                    updatedAt,
                  }
                : call.result,
            }
          : call
      ),
    });
  };
  const continueWithGuardResult = (guardResult: ContinueGuardResult): ApprovedToolContinuationResult => {
    append("task.progress", {
      kind: "chat_progress",
      source: "runtime_status",
      trigger: guardResult.progressTrigger,
      title: "Runtime",
      summary: guardResult.progressSummary,
      audience: "internal",
      basedOnSeq: Math.max(0, working.events.length - 1),
    });
    const toolResultSummary = toolResults.length > 0
      ? [
          "",
          "Just executed (results already applied):",
          ...toolResults.map((r, i) =>
            `  ${i + 1}. ${r.toolId} — ${
              r.output !== undefined
                ? typeof r.output === "string"
                  ? r.output.slice(0, 400)
                  : JSON.stringify(r.output).slice(0, 400)
                : "ok"
            }`
          ),
        ].join("\n")
      : "";
    working = StateSnapshotSchema.parse({
      ...working,
      conversation: [
        ...working.conversation,
        {
          role: "user",
          content: guardResult.followUpContent + toolResultSummary,
          createdAt: deps.now(),
        },
      ],
      updatedAt: deps.now(),
    });
    return {
      kind: "continue",
      snapshot: deps.attachTraceMetadata(working),
      guardResult,
    };
  };

  append("run.resumed", {
    reason: params.reason ?? USER_RESUMED_MESSAGE,
    patch: params.patch ?? {},
  });

  const updateContinuationStatus = (status: "resuming" | "executing_tool" | "awaiting_model" | "completed" | "failed") => {
    working = StateSnapshotSchema.parse({
      ...working,
      continuation: upsertContinuationFrame(working, {
        ...working.continuation.frames.find((frame) => frame.id === frameId)!,
        status,
        pendingActionIds: status === "completed" ? [] : working.continuation.frames.find((frame) => frame.id === frameId)?.pendingActionIds ?? [],
        pendingToolCallIds: status === "completed" ? [] : working.continuation.frames.find((frame) => frame.id === frameId)?.pendingToolCallIds ?? [],
        updatedAt: deps.now(),
      }),
    });
  };

  for (const originalAction of approvedTools) {
    const action = working.actions.find((item) => item.id === originalAction.id) ?? originalAction;
    const handler = continuationHandlerRegistry.get(action.type);
    if (!isRuntimeToolImplemented(action.type) || !handler) {
      return undefined;
    }
    append("approval.resolved", {
      actionId: action.id,
      decision: "approved",
      mode: "resume",
    });

    const approved = { ...action, status: "approved" as const };
    replaceAction(approved);
    replaceToolCall(action.id, "approved");
    append("action.updated", { actionId: action.id, status: "approved", record: approved });

    const running = { ...approved, status: "running" as const };
    replaceAction(running);
    replaceToolCall(action.id, "running");
    updateContinuationStatus("executing_tool");
    append("action.updated", { actionId: action.id, status: "running", record: running });

    try {
      const args = action.input && typeof action.input === "object" && !Array.isArray(action.input)
        ? action.input as Record<string, unknown>
        : {};
      const toolId = action.type as RuntimeToolId;
      const execution = await executor.executeWithMetadata(
        { tool: toolId, args },
        {
          allowRisky: true,
          currentAgentId: action.agentId,
          currentNodeId: existingFrame?.nodeId,
          currentNodeLabel: existingFrame?.nodeId ?? "respond",
          clarificationAnswer: deps.clarificationAnswer,
          ensureClarification: deps.ensureClarification,
          signal: deps.signal,
        },
      );
      const output = execution.output;
      const artifact = handler.buildArtifact
        ? handler.buildArtifact(execution, {
            runId: working.runId,
            artifactIndex: working.artifacts.length,
            createdAt: deps.now(),
          })
        : undefined;
      const artifactRecord = artifact as { id?: string } | undefined;
      if (artifactRecord) {
        working = StateSnapshotSchema.parse({
          ...working,
          artifacts: [...working.artifacts, artifactRecord],
        });
        append("artifact.exported", { artifact: artifactRecord, actionId: action.id });
      }
      toolResults.push({
        toolId,
        path: (output as Record<string, unknown>)?.path ?? args.path,
        sizeBytes: (output as Record<string, unknown>)?.sizeBytes,
        content: args.content,
        output,
        failed: false,
      });
      const resultText = JSON.stringify(output, null, 2);
      const succeeded = {
        ...running,
        status: "succeeded" as const,
        output,
        artifactIds: artifactRecord?.id ? [artifactRecord.id] : running.artifactIds,
      };
      replaceAction(succeeded);
      replaceToolCall(action.id, "succeeded", { output, content: resultText });
      append("tool.called", {
        toolCallId: working.toolCalls.find((call) => call.actionId === action.id)?.id,
        actionId: action.id,
        toolId,
        source: "replay",
        status: "succeeded",
        input: args,
        output,
        ...(execution.fileChange ? { fileChange: execution.fileChange } : {}),
        cacheHit: false,
      });
      const toolCall = working.toolCalls.find((call) => call.actionId === action.id);
      if (toolCall) {
        working = StateSnapshotSchema.parse({
          ...working,
          conversation: [
            ...working.conversation,
            {
              role: "assistant",
              content: "",
              toolCalls: [{
                id: toolCall.id,
                providerCallId: toolCall.providerCallId,
                toolId,
                args,
              }],
              createdAt: deps.now(),
            },
            {
              role: "tool",
              toolCallId: toolCall.id,
              providerCallId: toolCall.providerCallId,
              toolId,
              content: resultText,
              status: "succeeded",
              createdAt: deps.now(),
            },
          ],
          toolResults: [
            ...working.toolResults,
            {
              key: `${toolId}:${stableArgsDigest(args)}`,
              toolId,
              argsDigest: stableArgsDigest(args),
              resultToolCallId: toolCall.id,
              status: "succeeded",
              output,
              createdAt: deps.now(),
              updatedAt: deps.now(),
            },
          ],
        });
      }
      append("action.updated", { actionId: action.id, status: "succeeded", record: succeeded });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const failed = { ...running, status: "failed" as const, error: detail };
      replaceAction(failed);
      replaceToolCall(action.id, "failed", { error: detail, content: detail });
      append("tool.called", {
        toolCallId: working.toolCalls.find((call) => call.actionId === action.id)?.id,
        actionId: action.id,
        toolId: action.type,
        source: "replay",
        status: "failed",
        input: action.input,
        error: detail,
        cacheHit: false,
      });
      const toolCall = working.toolCalls.find((call) => call.actionId === action.id);
      if (toolCall) {
        const args = action.input && typeof action.input === "object" && !Array.isArray(action.input)
          ? action.input as Record<string, unknown>
          : {};
        working = StateSnapshotSchema.parse({
          ...working,
          conversation: [
            ...working.conversation,
            {
              role: "assistant",
              content: "",
              toolCalls: [{
                id: toolCall.id,
                providerCallId: toolCall.providerCallId,
                toolId: action.type,
                args,
              }],
              createdAt: deps.now(),
            },
            {
              role: "tool",
              toolCallId: toolCall.id,
              providerCallId: toolCall.providerCallId,
              toolId: action.type,
              content: detail,
              status: "failed",
              createdAt: deps.now(),
            },
          ],
          toolResults: [
            ...working.toolResults,
            {
              key: `${action.type}:${stableArgsDigest(args)}`,
              toolId: action.type,
              argsDigest: stableArgsDigest(args),
              resultToolCallId: toolCall.id,
              status: "failed",
              error: detail,
              createdAt: deps.now(),
              updatedAt: deps.now(),
            },
          ],
        });
      }
      // Track the failure so the follow-up message and failure cap can reference it.
      toolResults.push({
        toolId: action.type,
        path: (action.input as Record<string, unknown>)?.path,
        output: detail,
        failed: true,
      });
      append("action.updated", { actionId: action.id, status: "failed", record: failed });
      // Do NOT emit run.failed here — instead fall through to the guard
      // check so the model sees the failure context and can adjust its
      // approach on the next kernel invocation. A hard per-run failure cap
      // is enforced at the end of the for-loop.
      continue;
    }
  }

  // After all approved tools have been attempted, enforce a hard failure
  // cap: if ALL of them failed, refuse to continue and let the run terminate
  // with an actionable diagnostic so the user can intervene.
  const succeededTools = toolResults.filter((r) => !r.failed);
  if (toolResults.length > 0 && succeededTools.length === 0) {
    const allFailures = toolResults.map((r) => `${r.toolId}: ${String(r.output).slice(0, 300)}`).join(" | ");
    const detail = `All ${toolResults.length} approved tool(s) failed: ${allFailures}`;
    updateContinuationStatus("awaiting_model");
    return continueWithGuardResult({
      allowComplete: false,
      reason: "approved_tools_failed",
      progressTrigger: "approved_tools.failed",
      progressSummary: "Approved tool replay failed; preserving context for repair.",
      detail,
      followUpReason: "approved_tools_failed",
      followUpContent: [
        "The approved tool replay failed, so do not provide a final answer yet.",
        "Use the failure details below to repair the approach, request clarification if user input is required, or choose a safer next action.",
        `Failure summary: ${detail}`,
      ].join("\n"),
    });
  }

  function completeInterruptedModeProgress(): void {
    const nextPlan = working.plan.map((item) =>
      item.status === "done" || item.status === "skipped"
        ? item
        : item.status === "blocked"
          ? { ...item, status: "done" as const }
          : item
    );
    const nextTodos = working.todos.map((item) =>
      item.status === "done" || item.status === "skipped"
        ? item
        : item.status === "blocked"
          ? { ...item, status: "done" as const, updatedAt: deps.now() }
          : item
    );
    const planChanged = nextPlan.some((item, index) => item.status !== working.plan[index]?.status);
    const todoChanged = nextTodos.some((item, index) => item.status !== working.todos[index]?.status);
    if (planChanged) {
      working = StateSnapshotSchema.parse({ ...working, plan: nextPlan });
      append("plan.updated", { items: nextPlan, reason: "approved_tool_resume.completed" });
    }
    if (todoChanged) {
      working = StateSnapshotSchema.parse({ ...working, todos: nextTodos });
      append("todo.updated", { items: nextTodos, reason: "approved_tool_resume.completed" });
    }
  }

  function incompleteModeProgressError(): string | undefined {
    const unfinishedPlans = working.plan.filter((item) => item.status !== "done" && item.status !== "skipped");
    const unfinishedTodos = working.todos.filter((item) => item.status !== "done" && item.status !== "skipped");
    if (unfinishedPlans.length === 0 && unfinishedTodos.length === 0) {
      return undefined;
    }
    return [
      "Mode progress is incomplete; refusing to emit run.done.",
      ...unfinishedPlans.map((item) => `plan:${item.id} [${item.status}] ${item.title}`),
      ...unfinishedTodos.map((item) => `todo:${item.id} [${item.status}] ${item.label}`),
    ].join("\n");
  }

  updateContinuationStatus("awaiting_model");
  if (continuationMode === "clarification") {
    updateContinuationStatus("awaiting_model");
    return continueWithGuardResult({
      allowComplete: false,
      reason: "clarification_tool_replay_completed",
      progressTrigger: "clarification_tools.replayed",
      progressSummary: "Clarification-targeted tool replay completed; resuming the interrupted node.",
      detail: "The clarification-resolved tool action has been replayed. Resume the suspended node with the replayed tool result in context.",
      followUpReason: "clarification_tool_replay_completed",
      followUpContent: [
        "The missing clarification has been resolved and the interrupted tool action has already been replayed.",
        "Continue the suspended task from these results. Do not re-run the same tool unless the arguments must change.",
      ].join("\n"),
    });
  }

  const guardResult = evaluateRuntimeCompletionGuards({
    actions: working.actions,
    planList: working.planList,
    plan: working.plan,
    todos: working.todos,
    replayedActionIds: approvedTools.map((action) => action.id),
    toolCalls: working.toolCalls,
  });
  if (!guardResult.allowComplete) {
    return continueWithGuardResult(guardResult);
  }

  completeInterruptedModeProgress();
  const modeProgressError = incompleteModeProgressError();
  if (modeProgressError) {
    const output = { text: modeProgressError };
    append("run.failed", {
      status: "failed",
      error: modeProgressError,
      output,
    });
    updateContinuationStatus("failed");
    return {
      kind: "completed",
      snapshot: deps.attachTraceMetadata(StateSnapshotSchema.parse({
        ...working,
        status: "failed",
        error: modeProgressError,
        activeAgents: [],
        output,
        updatedAt: deps.now(),
      })),
    };
  }

  const finalResolution = await finalTextForApprovedToolContinuation(snapshot, toolResults, deps);
  const output = { text: finalResolution.acceptedText ?? finalResolution.rawText };
  const outputViolation = finalOutputContractViolation(output);
  if (outputViolation) {
    const detail = outputViolation.reason === "internal_protocol"
      ? "Final approved-action output contained internal protocol text."
      : outputViolation.reason === "recovery_fallback"
        ? "Final approved-action output resolved to recovery fallback text."
        : outputViolation.reason === "invalid_multiple_proposed_plans"
          ? "Final approved-action output contained multiple complete proposed_plan blocks."
          : outputViolation.reason === "invalid_malformed_proposed_plan"
            ? "Final approved-action output contained a malformed proposed_plan block."
            : "Final approved-action output was empty after public-output filtering.";
    append("run.failed", {
      status: "failed",
      error: detail,
      output: { text: detail, visibleText: outputViolation.visibleText },
    });
    updateContinuationStatus("failed");
    return {
      kind: "completed",
      snapshot: deps.attachTraceMetadata(StateSnapshotSchema.parse({
        ...working,
        status: "failed",
        error: detail,
        activeAgents: [],
        output: { text: detail, visibleText: outputViolation.visibleText },
        updatedAt: deps.now(),
      })),
    };
  }
  const finalText = finalResolution.acceptedText ?? output.text;
  append("message.delta", {
    role: "assistant",
    messageId: `${snapshot.runId}:assistant:approved-file-write-resume`,
    content: finalText,
  });
  updateContinuationStatus("completed");

  // Shared terminal-state integrity gate: refuse to emit run.done if any
  // open gates, pending approvals/clarifications, or active continuation
  // frames remain.
  try {
    assertRunCanBecomeTerminal(deriveTerminalStateAssertionFromSnapshot(working));
  } catch (caught) {
    if (caught instanceof TerminalStateIntegrityError) {
      const detail = `Terminal state integrity violation: ${caught.message}`;
      append("run.failed", { status: "failed", error: detail, output: { text: detail, violations: caught.violations } });
      updateContinuationStatus("failed");
      return {
        kind: "completed",
        snapshot: deps.attachTraceMetadata(StateSnapshotSchema.parse({
          ...working,
          status: "failed",
          error: detail,
          activeAgents: [],
          output: { text: detail, violations: caught.violations },
          updatedAt: deps.now(),
        })),
      };
    }
    throw caught;
  }

  append("run.done", { status: "succeeded", output });
  return {
    kind: "completed",
    snapshot: deps.attachTraceMetadata(StateSnapshotSchema.parse({
      ...working,
      status: "succeeded",
      pendingApprovals: [],
      activeAgents: [],
      output,
      updatedAt: deps.now(),
    })),
  };
}

export async function completeApprovedFileWriteResume(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
  continuationActionIds: string[] = approvedActionIds,
  params: { reason?: string; patch?: unknown } = {},
  deps: ApprovedFileWriteResumeDeps,
  onEvent?: (event: OraEventEnvelope, snapshot: StateSnapshot) => void,
): Promise<ApprovedToolContinuationResult | undefined> {
  return completeApprovedToolContinuation(
    snapshot,
    approvedActionIds,
    continuationActionIds,
    params,
    deps,
    onEvent,
  );
}

async function finalTextForApprovedToolContinuation(
  snapshot: StateSnapshot,
  toolResults: Array<{ toolId: string; path?: unknown; sizeBytes?: unknown; content?: unknown; output?: unknown }>,
  deps: ApprovedFileWriteResumeDeps,
): Promise<ReturnType<typeof resolvePublicAssistantText>> {
  const resultSummary = toolResults.map((result) => ({
    toolId: result.toolId,
    path: result.path,
    sizeBytes: result.sizeBytes,
    output: result.output,
  }));
  const updatedContent = toolResults
    .map((result) => typeof result.content === "string" ? result.content : "")
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 60_000);
  const messages = [
    ...(snapshot.sessionId
      ? deps.buildConversationMessages(snapshot.sessionId, snapshot.input.prompt, snapshot.runId)
      : [{ role: "user" as const, content: snapshot.input.prompt.trim() }]),
    {
      role: "user" as const,
      content: [
        "The user approved the pending tool action, and the runtime has already executed the exact stored action.",
        "Do not call any tools or emit tool JSON.",
        "Now provide the final answer in the user's language.",
        "Briefly confirm the completed action and summarize the concrete result.",
        `Tool results: ${JSON.stringify(resultSummary)}`,
        updatedContent ? `Updated document content:\n${updatedContent}` : undefined,
      ].filter(Boolean).join("\n\n"),
    },
  ];
  const system = [
    "You are Ora completing a resumed run after an approved tool action.",
    "The side effect has already happened. Do not request another tool call.",
    "Answer directly and naturally.",
  ].join("\n");
  const first = await invokeRunProvider(snapshot.config, {
    messages,
    system,
    maxTokens: snapshot.config.budget?.maxTokens,
    tools: [],
    toolChoice: "none",
  });
  const firstResolved = resolvePublicAssistantText(first.text);
  if ((first.toolCalls?.length ?? 0) === 0 && firstResolved.acceptedText) {
    return firstResolved;
  }
  const retry = await invokeRunProvider(snapshot.config, {
    messages: [
      ...messages,
      {
        role: "assistant",
        content: first.text,
        toolCalls: first.toolCalls,
      },
      {
        role: "user",
        content: "Tools are disabled for this final answer. Reply in plain prose only, confirming the completed action and summarizing the result.",
      },
    ],
    system,
    maxTokens: snapshot.config.budget?.maxTokens,
    tools: [],
    toolChoice: "none",
  });
  return resolvePublicAssistantText(retry.text || firstResolved.rawText);
}

function upsertContinuationFrame(
  snapshot: StateSnapshot,
  frame: StateSnapshot["continuation"]["frames"][number],
): StateSnapshot["continuation"] {
  const frames = snapshot.continuation.frames.some((item) => item.id === frame.id)
    ? snapshot.continuation.frames.map((item) => (item.id === frame.id ? frame : item))
    : [...snapshot.continuation.frames, frame];
  return {
    activeFrameId: frame.status === "completed" || frame.status === "failed" ? undefined : frame.id,
    frames,
  };
}

function stableArgsDigest(args: Record<string, unknown>): string {
  return JSON.stringify(sortJson(args));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}
