import { OraEventEnvelope, StateSnapshot, StateSnapshotSchema } from "@cemeworm/shared";
import { LongTermMemoryManager, LongTermMemoryUpdateQueue } from "./memory.js";
import type { LongTermMemoryUpdateTask } from "./memory.js";
import { ModeSelectionDeps, resolveMemoryPolicy } from "./mode-selection.js";
import { invokeRunProvider, type ModelMessage } from "./providers/index.js";
import { assistantTextForRun } from "./session-title.js";

export interface MemoryUpdateDeps {
  longTermMemory: LongTermMemoryManager;
  longTermMemoryQueue: LongTermMemoryUpdateQueue;
  modeSelectionDeps: () => ModeSelectionDeps;
  buildConversationMessages: (sessionId: string, currentPrompt: string, excludeRunId?: string) => ModelMessage[];
  getCachedRun: (runId: string) => StateSnapshot | undefined;
  appendEvent: (
    snapshot: StateSnapshot,
    type: OraEventEnvelope["type"],
    payload: unknown,
    extra?: Partial<OraEventEnvelope>,
  ) => StateSnapshot;
  cacheRun: (snapshot: StateSnapshot, flush: boolean) => void;
}

export function scheduleLongTermMemoryUpdate(snapshot: StateSnapshot, deps: MemoryUpdateDeps): void {
  if (snapshot.status === "queued" || snapshot.status === "running") {
    return;
  }
  const policy = resolveMemoryPolicy(snapshot.config, deps.modeSelectionDeps());
  if (!policy.enabled) {
    return;
  }
  const conversationMessages = deps.buildConversationMessages(snapshot.sessionId ?? "", snapshot.input.prompt, snapshot.runId)
    .filter((message): message is typeof message & { role: "system" | "developer" | "user" | "assistant" } => message.role !== "tool")
    .map((message) => ({ role: message.role, content: message.content }));
  deps.longTermMemoryQueue.enqueue({
    snapshot,
    assistantText: assistantTextForRun(snapshot),
    conversationMessages,
    policy,
    invokeModel: policy.updater === "provider"
      ? async (request) => {
          const toolModelProviderId = snapshot.config.metadata?.toolModelProviderId;
          const effectiveProviderId = policy.updaterProviderId
            ?? (typeof toolModelProviderId === "string" && toolModelProviderId !== "auto" ? toolModelProviderId : undefined)
            ?? snapshot.config.providerId;
          const response = await invokeRunProvider({
            ...snapshot.config,
            providerId: effectiveProviderId,
          }, request);
          return response.text;
        }
      : undefined,
  }, policy.debounceMs);
}

export async function processLongTermMemoryUpdate(
  task: LongTermMemoryUpdateTask,
  deps: MemoryUpdateDeps,
): Promise<void> {
  const projectId = task.snapshot.input.projectId;
  const manager = projectId ? deps.longTermMemory.forProject(projectId) : deps.longTermMemory;
  const { factsAdded } = await manager.updateFromRunWithProvider(task);
  const snapshot = deps.getCachedRun(task.snapshot.runId) ?? task.snapshot;
  const records = manager.createRunMemoryRecords(snapshot, factsAdded);
  if (records.length === 0) {
    return;
  }

  let updated = StateSnapshotSchema.parse({
    ...snapshot,
    memory: [...snapshot.memory, ...records],
  });
  for (const record of records) {
    updated = deps.appendEvent(updated, "memory.updated", {
      record,
      durability: "long_term",
    });
  }
  deps.cacheRun(updated, true);
}
