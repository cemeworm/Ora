import { OraEventEnvelope, StateSnapshot, StateSnapshotSchema } from "@ora/shared";
import type { ActionRecord } from "@ora/shared";
import { RuntimeSkillRegistry, RuntimeToolRegistry } from "./harness/capability-registries.js";
import { RuntimeToolExecutor } from "./harness/runtime-tool-executor.js";
import { invokeRunProvider, type ModelMessage } from "./providers/index.js";

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

export function approvedFileWriteResumeActions(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
): ActionRecord[] {
  if (snapshot.pendingClarifications.length > 0) {
    return [];
  }
  const approvedIds = new Set(approvedActionIds);
  const pendingActions = snapshot.actions.filter((action) => action.status === "approval_required");
  const approvedFileWrites = pendingActions.filter((action) =>
    approvedIds.has(action.id) && action.type === "file.write"
  );
  return approvedFileWrites.length > 0 && approvedFileWrites.length === pendingActions.length
    ? approvedFileWrites
    : [];
}

export async function completeApprovedFileWriteResume(
  snapshot: StateSnapshot,
  approvedActionIds: string[],
  params: { reason?: string; patch?: unknown } = {},
  deps: ApprovedFileWriteResumeDeps,
  onEvent?: (event: OraEventEnvelope, snapshot: StateSnapshot) => void,
): Promise<StateSnapshot | undefined> {
  const approvedFileWrites = approvedFileWriteResumeActions(snapshot, approvedActionIds);
  if (approvedFileWrites.length === 0) {
    return undefined;
  }
  const writeResults: Array<{ path?: unknown; sizeBytes?: unknown; content?: unknown }> = [];

  const executor = new RuntimeToolExecutor({
    workspace: snapshot.input.context?.projectWorkspace,
    toolDescriptors: new RuntimeToolRegistry().list(),
    skillRegistry: deps.skillRegistry,
    searchProviderConfig: snapshot.config.searchProvider,
  });

  let working = StateSnapshotSchema.parse({
    ...snapshot,
    status: "running",
    pendingApprovals: snapshot.pendingApprovals.filter((actionId) => !approvedActionIds.includes(actionId)),
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

  for (const originalAction of approvedFileWrites) {
    const action = working.actions.find((item) => item.id === originalAction.id) ?? originalAction;
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
    append("action.updated", { actionId: action.id, status: "running", record: running });

    try {
      const args = action.input && typeof action.input === "object" && !Array.isArray(action.input)
        ? action.input as Record<string, unknown>
        : {};
      const output = await executor.execute({ tool: "file.write", args }, { allowRisky: true });
      writeResults.push({
        path: (output as Record<string, unknown>)?.path ?? args.path,
        sizeBytes: (output as Record<string, unknown>)?.sizeBytes,
        content: args.content,
      });
      const resultText = JSON.stringify(output, null, 2);
      const succeeded = { ...running, status: "succeeded" as const, output };
      replaceAction(succeeded);
      replaceToolCall(action.id, "succeeded", { output, content: resultText });
      append("tool.called", {
        toolCallId: working.toolCalls.find((call) => call.actionId === action.id)?.id,
        actionId: action.id,
        toolId: action.type,
        source: "replay",
        status: "succeeded",
        input: args,
        output,
        cacheHit: false,
      });
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
      append("action.updated", { actionId: action.id, status: "failed", record: failed });
      append("run.failed", { status: "failed", error: detail });
      return deps.attachTraceMetadata(StateSnapshotSchema.parse({
        ...working,
        status: "failed",
        error: detail,
        activeAgents: [],
        updatedAt: deps.now(),
      }));
    }
  }

  const finalText = await finalTextForApprovedFileWriteResume(snapshot, writeResults, deps);
  append("message.delta", { role: "assistant", content: finalText });
  const output = { text: finalText };
  append("run.done", { status: "succeeded", output });
  return deps.attachTraceMetadata(StateSnapshotSchema.parse({
    ...working,
    status: "succeeded",
    pendingApprovals: [],
    activeAgents: [],
    output,
    updatedAt: deps.now(),
  }));
}

async function finalTextForApprovedFileWriteResume(
  snapshot: StateSnapshot,
  writeResults: Array<{ path?: unknown; sizeBytes?: unknown; content?: unknown }>,
  deps: ApprovedFileWriteResumeDeps,
): Promise<string> {
  const writeSummary = writeResults.map((result) => ({
    path: result.path,
    sizeBytes: result.sizeBytes,
  }));
  const updatedContent = writeResults
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
        "The user approved the pending file.write action, and the runtime has already executed it.",
        "Do not call any tools or emit tool JSON.",
        "Now provide the final answer in the user's language.",
        "Briefly confirm the document update and summarize the substantive findings from the updated content.",
        `Write result: ${JSON.stringify(writeSummary)}`,
        updatedContent ? `Updated document content:\n${updatedContent}` : undefined,
      ].filter(Boolean).join("\n\n"),
    },
  ];
  const system = [
    "You are Ora completing a resumed run after an approved document write.",
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
        content: "Tools are disabled for this final answer. Reply in plain prose only, confirming the document update and summarizing the findings.",
      },
    ],
    system,
    maxTokens: snapshot.config.budget?.maxTokens,
    tools: [],
    toolChoice: "none",
  });
  return retry.text.trim() || "文档已更新。";
}
