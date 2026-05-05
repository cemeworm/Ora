import { OraEventEnvelope, StateSnapshot, StateSnapshotSchema } from "@cemeworm/shared";
import type { ActionRecord } from "@cemeworm/shared";
import { RuntimeSkillRegistry, RuntimeToolRegistry } from "./harness/capability-registries.js";
import { fileChangeArtifact } from "./harness/file-change-artifact.js";
import { isRuntimeToolImplemented, RuntimeToolExecutor, type RuntimeToolId } from "./harness/runtime-tool-executor.js";
import { PackageManager } from "./package-manager.js";
import { invokeRunProvider, type ModelMessage } from "./providers/index.js";
import { evaluateRuntimeCompletionGuards } from "./harness/runtime-completion-guards.js";
import {
  currentPendingApprovalActions,
  currentPendingApprovalToolActionIds,
  currentPendingClarifications,
} from "./run-orchestration.js";

const USER_RESUMED_MESSAGE = "Confirmed. Continuing.";

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
}

const DETERMINISTIC_APPROVED_TOOL_IDS = new Set<string>([
  "file.write",
  "file.patch",
  "shell.execute",
  "skills.create",
  "skills.update",
  "skills.setEnabled",
  "mcp.call",
  "package.promote",
  "package.switch",
  "package.rollback",
]);

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
    DETERMINISTIC_APPROVED_TOOL_IDS.has(action.type)
  );
  return approvedTools.length > 0 && approvedTools.length === pendingActions.length
    ? approvedTools
    : [];
}

export function approvedFileWriteResumeActions(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
): ActionRecord[] {
  return approvedToolContinuationActions(snapshot, approvedActionIds)
    .filter((action) => action.type === "file.write");
}

export async function completeApprovedToolContinuation(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
  params: { reason?: string; patch?: unknown } = {},
  deps: ApprovedFileWriteResumeDeps,
  onEvent?: (event: OraEventEnvelope, snapshot: StateSnapshot) => void,
): Promise<StateSnapshot | undefined> {
  const approvedTools = approvedToolContinuationActions(snapshot, approvedActionIds);
  if (approvedTools.length === 0) {
    return undefined;
  }
  const toolResults: Array<{ toolId: string; path?: unknown; sizeBytes?: unknown; content?: unknown; output?: unknown }> = [];

  const executor = new RuntimeToolExecutor({
    workspace: snapshot.input.context?.projectWorkspace,
    toolDescriptors: new RuntimeToolRegistry().list(),
    skillRegistry: deps.skillRegistry,
    searchProviderConfig: snapshot.config.searchProvider,
    packageManager: new PackageManager(),
  });

  const approvedIdSet = new Set(approvedActionIds);
  const frameId = snapshot.continuation.activeFrameId ?? `${snapshot.runId}:continuation:${snapshot.continuation.frames.length}`;
  const existingFrame = snapshot.continuation.frames.find((frame) => frame.id === frameId);
  const createdAt = existingFrame?.createdAt ?? deps.now();
  const pendingToolCallIds = snapshot.toolCalls
    .filter((call) => call.actionId && approvedIdSet.has(call.actionId))
    .map((call) => call.id);
  let working = StateSnapshotSchema.parse({
    ...snapshot,
    status: "running",
    pendingApprovals: snapshot.pendingApprovals.filter((actionId) => !approvedActionIds.includes(actionId)),
    continuation: upsertContinuationFrame(snapshot, {
      id: frameId,
      runId: snapshot.runId,
      status: "resuming",
      reason: "approval_required",
      conversationCursor: snapshot.conversation.length,
      pendingActionIds: approvedTools.map((action) => action.id),
      pendingToolCallIds,
      pendingClarificationIds: [],
      approvedActionIds,
      resolvedClarificationIds: [],
      agentId: existingFrame?.agentId,
      nodeId: existingFrame?.nodeId,
      planItemId: existingFrame?.planItemId,
      modelIteration: existingFrame?.modelIteration,
      resumedFromFrameId: existingFrame?.resumedFromFrameId,
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
    working = StateSnapshotSchema.parse({
      ...working,
      toolCalls: working.toolCalls.map((call) =>
        call.actionId === actionId
          ? {
              ...call,
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
    if (!isRuntimeToolImplemented(action.type) || !DETERMINISTIC_APPROVED_TOOL_IDS.has(action.type)) {
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
      const execution = await executor.executeWithMetadata({ tool: toolId, args }, { allowRisky: true });
      const output = execution.output;
      const artifact = execution.fileChange
        ? fileChangeArtifact({
            runId: working.runId,
            artifactIndex: working.artifacts.length,
            fileChange: execution.fileChange,
            createdAt: deps.now(),
          })
        : undefined;
      if (artifact) {
        working = StateSnapshotSchema.parse({
          ...working,
          artifacts: [...working.artifacts, artifact],
        });
        append("artifact.exported", { artifact, actionId: action.id });
      }
      toolResults.push({
        toolId,
        path: (output as Record<string, unknown>)?.path ?? args.path,
        sizeBytes: (output as Record<string, unknown>)?.sizeBytes,
        content: args.content,
        output,
      });
      const resultText = JSON.stringify(output, null, 2);
      const succeeded = {
        ...running,
        status: "succeeded" as const,
        output,
        artifactIds: artifact ? [artifact.id] : running.artifactIds,
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
      append("action.updated", { actionId: action.id, status: "failed", record: failed });
      append("run.failed", { status: "failed", error: detail });
      updateContinuationStatus("failed");
      return deps.attachTraceMetadata(StateSnapshotSchema.parse({
        ...working,
        status: "failed",
        error: detail,
        activeAgents: [],
        updatedAt: deps.now(),
      }));
    }
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
  const guardResult = evaluateRuntimeCompletionGuards({
    actions: working.actions,
    planList: working.planList,
    toolCalls: working.toolCalls,
  });
  if (!guardResult.allowComplete) {
    const output = { text: guardResult.followUpContent };
    append("run.failed", {
      status: "failed",
      error: guardResult.progressSummary,
      output,
    });
    updateContinuationStatus("failed");
    return deps.attachTraceMetadata(StateSnapshotSchema.parse({
      ...working,
      status: "failed",
      error: guardResult.progressSummary,
      activeAgents: [],
      output,
      updatedAt: deps.now(),
    }));
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
    return deps.attachTraceMetadata(StateSnapshotSchema.parse({
      ...working,
      status: "failed",
      error: modeProgressError,
      activeAgents: [],
      output,
      updatedAt: deps.now(),
    }));
  }

  const finalText = await finalTextForApprovedToolContinuation(snapshot, toolResults, deps);
  append("message.delta", { role: "assistant", content: finalText });
  const output = { text: finalText };
  append("run.done", { status: "succeeded", output });
  updateContinuationStatus("completed");
  return deps.attachTraceMetadata(StateSnapshotSchema.parse({
    ...working,
    status: "succeeded",
    pendingApprovals: [],
    activeAgents: [],
    output,
    updatedAt: deps.now(),
  }));
}

export async function completeApprovedFileWriteResume(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
  params: { reason?: string; patch?: unknown } = {},
  deps: ApprovedFileWriteResumeDeps,
  onEvent?: (event: OraEventEnvelope, snapshot: StateSnapshot) => void,
): Promise<StateSnapshot | undefined> {
  return completeApprovedToolContinuation(snapshot, approvedActionIds, params, deps, onEvent);
}

async function finalTextForApprovedToolContinuation(
  snapshot: StateSnapshot,
  toolResults: Array<{ toolId: string; path?: unknown; sizeBytes?: unknown; content?: unknown; output?: unknown }>,
  deps: ApprovedFileWriteResumeDeps,
): Promise<string> {
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
  if ((first.toolCalls?.length ?? 0) === 0 && first.text.trim()) {
    return first.text.trim();
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
  return retry.text.trim() || "已完成批准的操作。";
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
