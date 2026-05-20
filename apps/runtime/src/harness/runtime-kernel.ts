import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CODE_DEVELOPMENT_MODE_ID,
  type ActionRiskLevel,
  type ActionRecord,
  type AgentSpawnAffordance,
  type AgentSpawnContract,
  AgentSpawnContractSchema,
  type AgentSpawnContractViolation,
  type AgentSpawnPreflightResult,
  AgentSpawnPreflightTelemetrySchema,
  type AgentSpawnResultValidation,
  AgentSpawnResultValidationSchema,
  type AgentResultContract,
  type AgentConversationMessage,
  AgentConversationMessageSchema,
  type AgentToolBundleId,
  type BackgroundChildLifecyclePhase,
  type BackgroundChildResultAvailability,
  type ChildSessionAuthoritySource,
  type ChildSessionClass,
  type ChildSessionDeliveryStatus,
  type ChildSessionDelegationKind,
  type ChildSessionSummary,
  ChildSessionSummarySchema,
  type ParentCoordinationPhase,
  type ParentCoordinationState,
  ParentCoordinationStateSchema,
  type ArtifactRef,
  ArtifactRefSchema,
  type CheckpointMeta,
  type ModeSpec,
  type OraEventEnvelope,
  type PatternDefinition,
  type QueueSummary,
  type RunConfig,
  type SessionContextState,
  type SharedStateSummary,
  type StateSnapshot,
  type ToolRegistry,
  type UserTaskInput,
  type BusStats,
  type MemoryKind,
  type OraToolCallEnvelope,
  type PendingClarification,
  type PendingClarificationOption,
  RecoveryArtifactSchema,
  OraEventEnvelopeSchema,
  StateSnapshotSchema,
  CausalDecisionRecordSchema,
  type CompletionStopReason,
  type CustomAgentDetail,
  getPermissionProfile,
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
  SINGLE_AGENT_MODE_ID,
  type TaskIntent,
  delegationIntentFromMetadata,
  type PlanItem,
  type PlanListStep,
  type TodoItem,
} from "@cemeworm/shared";
import {
  ActionLedger,
  AgentProfileRegistry,
  MemoryCaptureQueue,
  MemoryService,
  PlanService,
  PolicyService,
  TodoService,
} from "../capabilities.js";
import { TaskMemoryStore } from "../task-memory.js";
import {
  configuredProviderId,
  invokeRunProvider,
  invokeRunProviderStream,
} from "../providers/index.js";
import {
  RuntimeSkillRegistry,
  RuntimeToolRegistry,
} from "./capability-registries.js";
import {
  extractRuntimeToolCallFromText,
  RuntimeToolExecutor,
  type RuntimeFileChangeMetadata,
  type RuntimePostToolPolicyHook,
  type RuntimeToolCall,
} from "./runtime-tool-executor.js";
import {
  classifyRecoveryError,
  RecoveryCoordinator,
  isRecoveryExhaustedError,
  type RecoveryDecision,
  type RecoveryIncident,
} from "./recovery-policy.js";
import { executeModeSpec } from "../patterns/driver-registry.js";
import type { PatternExecutionContext } from "../patterns/execution-context.js";
import type { ModelMessage, ModelRequest, ModelResponse } from "../providers/index.js";
import { RuntimeCompletionController } from "./runtime-completion.js";
import {
  coerceNoToolResponse as coerceNoToolResponseWithDeps,
  emitRejectedFinalToolIntent as emitRejectedFinalToolIntentWithDeps,
  forcedFinalSystemPrompt,
  incompleteForcedFinalError,
  outputWithCompletionMetadata,
} from "./runtime-output.js";
import {
  ApprovalInterruptError,
  ClarificationInterruptError,
  AgentDegradedError,
  isApprovalInterruptError,
  isClarificationInterruptError,
  isAgentDegradedError,
  createResumeApprovalMatcher,
  type ApprovedResumeAction,
} from "./runtime-interrupts.js";
import {
  ensureRuntimeClarification,
  ensureRuntimeClarifications,
  requestIntentClarificationQuestion,
  resolveClarificationAnswer,
} from "./runtime-clarifications.js";
import {
  extractCausalTaskState,
  latestCausalTaskState,
  mergeCausalTaskState,
  type ExtractCausalTaskStateParams,
} from "./causal-task-state-extractor.js";
import { buildAgentPromptContext, temporalContextPrompt } from "./prompt-context.js";
import { PromptSectionCache } from "./prompt-cache.js";
import { extractSkillMentions, resolveSkillMentions } from "./skill-mention.js";
import {
  channelProjectGuidancePrompt,
  checkpointLabelForStatus,
  promptWithTurnLocalMetadata,
  projectInstructionsSystemPrompt,
  turnLocalMetadataGuidancePrompt,
  turnLocalMetadataPrompt,
  userFacingLanguagePrompt,
  workspaceSystemPrompt,
} from "./runtime-prompts.js";
import { resolveRuntimeResponseLanguage } from "./runtime-language.js";
import {
  RuntimeToolCallLedger,
  type AppendRuntimeToolCallParams,
} from "./runtime-tool-ledger.js";
import { fileChangeArtifact } from "./file-change-artifact.js";
import {
  runRecoverableRuntimeNode,
  runRuntimeDelegatedTask,
} from "./runtime-node-support.js";
import {
  resolveRuntimeActionApproval,
  transitionRuntimeAction,
} from "./runtime-action-runner.js";
import { PackageManager } from "../package-manager.js";
import {
  isInternalProviderAssistantText,
  stripInternalAssistantText,
  type NodeRuntimeLoopState,
  runNodeRuntimeLoop,
  type RunNodeRuntimeLoopDeps,
  type RunNodeRuntimeLoopParams,
} from "./node-runtime-loop.js";
import { createKernelPatternExecutionContextAdapter } from "./runtime-pattern-context.js";
import { KernelRunner, createKernelRunnerDeps } from "./runtime-kernel-runner.js";
import { assertRunCanBecomeTerminal, TerminalStateIntegrityError, type TerminalStateAssertionInput } from "./runtime-completion-guards.js";
import { activePlanStepId, advancePlanListFromLifecycle, planListUpdatedPayload } from "./runtime-plan-list-state.js";
import { classifyContinuationDispatch } from "../run-continuation-dispatcher.js";
import { DIAGNOSTIC_FAILURE_SYMBOL } from "../run-kernel-execution-service.js";
import { createResumeCheckpoint } from "../run-resume-mutation.js";
import { SkillAutoGenService } from "./skill-auto-gen.js";
import {
  injectRootAgentTopology,
  rootAgentProfile,
} from "./runtime-root-agent.js";
import {
  resolveChildToolBundleDefinition,
  resolveVisibleToolsForAgent,
} from "./runtime-tool-visibility.js";

const DEFAULT_NODE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_PROVIDER_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

export interface RuntimeKernelResult {
  snapshot: StateSnapshot;
  tools: ToolRegistry;
}

export interface RuntimeKernelOptions {
  clock?: () => number;
  skillRegistry?: RuntimeSkillRegistry;
  toolRegistry?: RuntimeToolRegistry;
  modeRegistry?: import("./runtime-tool-executor.js").ModeRegistryTools;
  selfIterationRegistry?: import("./runtime-tool-executor.js").SelfIterationRegistryTools;
  automationRegistry?: import("./runtime-tool-executor.js").AutomationRegistryTools;
  widgetRegistry?: import("./runtime-tool-executor.js").WidgetRegistryTools;
  forkedFrom?: { runId: string; checkpointId: string; eventSeq: number };
  conversationMessages?: ModelMessage[];
  turnIndex?: number;
  customAgentOverlay?: string;
  customAgentOverlays?: Record<string, string>;
  systemAgentOverlays?: Record<string, string>;
  customAgentContexts?: Record<string, Pick<CustomAgentDetail, "model" | "skillIds" | "toolIds"> & { overlay: string }>;
  modeSpec?: ModeSpec;
  definition?: PatternDefinition;
  sessionContextState?: SessionContextState;
  resumeContext?: {
    clarifications?: Record<string, unknown>;
    approvedActionIds?: string[];
    approvedActions?: ApprovedResumeAction[];
    planDecisionResolutions?: Array<{ decisionId: string; status: "accepted" | "declined" }>;
    alreadyAnnounced?: boolean;
  };
  resumeState?: Pick<StateSnapshot, "plan" | "planList" | "todos" | "actions" | "toolCalls" | "toolResults" | "continuation" | "conversation" | "topology">;
  streamProvider?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: OraEventEnvelope) => void;
  promptCache?: PromptSectionCache;
  /** auto_review 模式自动批准时调用，携带被批准的 action IDs。
      实现方应写入 gate.resolved ledger entries。 */
  onApprovalAutoResolved?: (actionIds: string[]) => void;
  autoGenService?: SkillAutoGenService;
  autoGenStatePath?: string;
  taskMemoryStore?: TaskMemoryStore;
}

function withCurrentTurnLocalMetadata(
  messages: readonly ModelMessage[] | undefined,
  currentPrompt: string,
  turnLocalMetadata: string | undefined,
): ModelMessage[] | undefined {
  if (!messages?.length || !turnLocalMetadata?.trim()) {
    return messages ? [...messages] : undefined;
  }
  const trimmedPrompt = currentPrompt.trim();
  if (!trimmedPrompt) {
    return [...messages];
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") {
      continue;
    }
    if (message.content.trim() !== trimmedPrompt) {
      continue;
    }
    const nextMessages = [...messages];
    nextMessages[index] = {
      ...message,
      content: promptWithTurnLocalMetadata(message.content, turnLocalMetadata),
    };
    return nextMessages;
  }
  return [...messages];
}

type AsyncAgentResultEnvelope = {
  sourceAgentId: string;
  childSessionId: string;
  result: string;
  completedAt: number;
  toolBundleId?: AgentToolBundleId;
  resolvedToolIds: string[];
  spawnContract?: AgentSpawnContract;
  spawnValidation?: AgentSpawnResultValidation;
  resultContract?: AgentResultContract;
  usedToolCount: number;
  artifactIds: string[];
  durationMs?: number;
};

type BackgroundChildRegistryEntry = {
  id: string;
  agentId: string;
  parentAgentId?: string;
  label: string;
  sessionClass: ChildSessionClass;
  status: ChildSessionSummary["status"];
  lifecyclePhase: BackgroundChildLifecyclePhase;
  coordinationBarrier: "required" | "independent";
  deliveryStatus?: ChildSessionDeliveryStatus;
  resultAvailability: BackgroundChildResultAvailability;
  summary?: string;
  lastMessage?: string;
  artifactIds: string[];
  delegationKind?: ChildSessionDelegationKind;
  authoritySource?: ChildSessionAuthoritySource;
  toolBundleId?: AgentToolBundleId;
  requestedToolPreset?: ChildSessionSummary["requestedToolPreset"];
  resolvedToolPreset?: ChildSessionSummary["resolvedToolPreset"];
  resolvedToolIds: string[];
  spawnContract?: AgentSpawnContract;
  spawnPreflight?: AgentSpawnPreflightResult;
  spawnValidation?: AgentSpawnResultValidation;
  resultContract?: AgentResultContract;
  usedToolCount?: number;
  durationMs?: number;
  replayRef?: ChildSessionSummary["replayRef"];
  sourceSessionId?: string;
  sourceRunId?: string;
  lastProgressAt?: number;
  lastMeaningfulOutputAt?: number;
  lastToolActivityAt?: number;
  stallReason?: string;
  recoveryAttemptCount: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
};

const BACKGROUND_CHILD_STALL_TIMEOUT_MS = 90_000;

function defaultBackgroundLifecyclePhase(params: {
  status: ChildSessionSummary["status"];
  deliveryStatus?: ChildSessionDeliveryStatus;
  currentPhase?: BackgroundChildLifecyclePhase;
  hasMeaningfulOutput?: boolean;
}): BackgroundChildLifecyclePhase {
  if (params.deliveryStatus === "consumed") {
    return "picked_up";
  }
  if (params.deliveryStatus === "awaiting_pickup") {
    return "awaiting_pickup";
  }
  if (params.status === "queued") {
    return "queued";
  }
  if (params.status === "running") {
    if (params.currentPhase === "stalled") {
      return "stalled";
    }
    return params.hasMeaningfulOutput ? "produced_output" : "running";
  }
  return params.status;
}

function isBackgroundLifecycleActive(
  phase: BackgroundChildLifecyclePhase,
): boolean {
  return phase === "queued" || phase === "running" || phase === "produced_output";
}

function hasBackgroundChildConsumableOutput(
  entry: Pick<BackgroundChildRegistryEntry, "lastMessage" | "summary" | "lastMeaningfulOutputAt">,
): boolean {
  return Boolean(entry.lastMeaningfulOutputAt || entry.lastMessage?.trim() || entry.summary?.trim());
}

function projectBackgroundChildSummary(
  entry: BackgroundChildRegistryEntry,
): ChildSessionSummary {
  return ChildSessionSummarySchema.parse({
    id: entry.id,
    agentId: entry.agentId,
    label: entry.label,
    sessionClass: entry.sessionClass,
    delegationKind: entry.delegationKind,
    authoritySource: entry.authoritySource,
    status: entry.status,
    lifecyclePhase: entry.lifecyclePhase,
    deliveryStatus: entry.deliveryStatus,
    resultAvailability: entry.resultAvailability,
    summary: entry.summary,
    lastMessage: entry.lastMessage,
    artifactIds: entry.artifactIds,
    toolBundleId: entry.toolBundleId,
    requestedToolPreset: entry.requestedToolPreset,
    resolvedToolPreset: entry.resolvedToolPreset,
    resolvedToolIds: entry.resolvedToolIds,
    spawnContract: entry.spawnContract,
    spawnPreflight: entry.spawnPreflight,
    spawnValidation: entry.spawnValidation,
    resultContract: entry.resultContract,
    usedToolCount: entry.usedToolCount,
    durationMs: entry.durationMs,
    replayRef: entry.replayRef,
    sourceSessionId: entry.sourceSessionId,
    sourceRunId: entry.sourceRunId,
    lastProgressAt: entry.lastProgressAt,
    lastMeaningfulOutputAt: entry.lastMeaningfulOutputAt,
    lastToolActivityAt: entry.lastToolActivityAt,
    stallReason: entry.stallReason,
    recoveryAttemptCount: entry.recoveryAttemptCount,
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    completedAt: entry.completedAt,
  });
}

class KernelRuntimeContext {
  private readonly eventsValue: OraEventEnvelope[] = [];
  private readonly artifactsValue: ArtifactRef[] = [];
  private readonly agentMessagesValue: AgentConversationMessage[] = [];
  private readonly activeAgentsValue = new Set<string>();
  private readonly pendingClarificationsValue: PendingClarification[] = [];
  private readonly busTopicCountsValue: Record<string, number> = {};
  private readonly sharedEntriesValue: SharedStateSummary["entries"] = [];
  private readonly toolCallLedger: RuntimeToolCallLedger;
  private readonly topologyValue: StateSnapshot["topology"];
  private readonly asyncAgentResultsValue = new Map<string, AsyncAgentResultEnvelope[]>();
  private readonly childSessionsValue = new Map<string, BackgroundChildRegistryEntry>();
  private readonly agentMessagesQueueValue = new Map<string, string[]>();
  private readonly backgroundProgressWaitersValue = new Map<string, Array<() => void>>();
  private readonly backgroundProgressTimersValue = new Map<string, ReturnType<typeof setTimeout>>();
  private parentCoordinationValue: ParentCoordinationState | undefined;
  private planListValue: PlanListStep[];
  private queueSummaryValue: QueueSummary;
  private busStatsValue: BusStats;
  private sharedStateSummaryValue: SharedStateSummary;
  private nodeLoopDepsFactory?: () => RunNodeRuntimeLoopDeps;

  constructor(private readonly params: {
    runId: string;
    config: RunConfig;
    now: () => number;
    initialPlanList: PlanListStep[];
    initialToolCalls: OraToolCallEnvelope[];
    initialTopology: StateSnapshot["topology"];
    initialQueueSummary: QueueSummary;
    initialBusStats: BusStats;
    initialSharedStateSummary: SharedStateSummary;
    onEvent?: (event: OraEventEnvelope) => void;
  }) {
    this.planListValue = params.initialPlanList;
    this.toolCallLedger = new RuntimeToolCallLedger(params.runId, params.now, params.initialToolCalls);
    this.topologyValue = params.initialTopology;
    this.queueSummaryValue = params.initialQueueSummary;
    this.busStatsValue = params.initialBusStats;
    this.sharedStateSummaryValue = params.initialSharedStateSummary;
  }

  get events(): OraEventEnvelope[] {
    return this.eventsValue;
  }

  get runId(): string {
    return this.params.runId;
  }

  get planList(): PlanListStep[] {
    return this.planListValue;
  }

  get artifacts(): ArtifactRef[] {
    return this.artifactsValue;
  }

  get agentMessages(): AgentConversationMessage[] {
    return this.agentMessagesValue;
  }

  get childSessions(): ChildSessionSummary[] {
    this.reconcileBackgroundChildren();
    return [...this.childSessionsValue.values()].sort((left, right) =>
      left.startedAt - right.startedAt || left.id.localeCompare(right.id),
    ).map((entry) => projectBackgroundChildSummary(entry));
  }

  get parentCoordination(): ParentCoordinationState | undefined {
    this.reconcileBackgroundChildren();
    return this.parentCoordinationValue;
  }

  get toolCalls(): OraToolCallEnvelope[] {
    return this.toolCallLedger.list();
  }

  get topology(): StateSnapshot["topology"] {
    return this.topologyValue;
  }

  get activeAgents(): string[] {
    return [...this.activeAgentsValue];
  }

  get pendingClarifications(): PendingClarification[] {
    return this.pendingClarificationsValue;
  }

  get queueSummary(): QueueSummary {
    return this.queueSummaryValue;
  }

  get busStats(): BusStats {
    return this.busStatsValue;
  }

  get sharedStateSummary(): SharedStateSummary {
    return this.sharedStateSummaryValue;
  }

  eventCount(): number {
    return this.eventsValue.length;
  }

  agentMessageCount(): number {
    return this.agentMessagesValue.length;
  }

  artifactCount(): number {
    return this.artifactsValue.length;
  }

  activeAgentCount(): number {
    return this.activeAgentsValue.size;
  }

  pendingClarificationCount(): number {
    return this.pendingClarificationsValue.length;
  }

  activateAgent(agentId: string): void {
    this.activeAgentsValue.add(agentId);
  }

  deactivateAgent(agentId: string): void {
    this.activeAgentsValue.delete(agentId);
  }

  enqueueAsyncAgentResult(params: {
    targetAgentId: string;
    sourceAgentId: string;
    childSessionId: string;
    result: string;
    completedAt?: number;
    toolBundleId?: AgentToolBundleId;
    resolvedToolIds?: string[];
    spawnContract?: AgentSpawnContract;
    spawnValidation?: AgentSpawnResultValidation;
    resultContract?: AgentResultContract;
    usedToolCount?: number;
    artifactIds?: string[];
    durationMs?: number;
  }): void {
    const completedAt = params.completedAt ?? this.params.now();
    const results = this.asyncAgentResultsValue.get(params.targetAgentId) ?? [];
    results.push({
      sourceAgentId: params.sourceAgentId,
      childSessionId: params.childSessionId,
      result: params.result,
      completedAt,
      toolBundleId: params.toolBundleId,
      resolvedToolIds: params.resolvedToolIds ?? [],
      spawnContract: params.spawnContract,
      spawnValidation: params.spawnValidation,
      resultContract: params.resultContract,
      usedToolCount: params.usedToolCount ?? 0,
      artifactIds: params.artifactIds ?? [],
      durationMs: params.durationMs,
    });
    this.asyncAgentResultsValue.set(params.targetAgentId, results);
    const current = this.childSessionsValue.get(params.childSessionId);
    if (current) {
      this.replaceBackgroundChild(current.id, {
        ...current,
        deliveryStatus: "awaiting_pickup",
        lifecyclePhase: "awaiting_pickup",
        resultAvailability:
          current.lifecyclePhase === "stalled" || current.resultAvailability === "visible_output"
            ? "partial"
            : "queued_for_parent",
        updatedAt: completedAt,
        completedAt: current.completedAt ?? completedAt,
      });
    }
    this.notifyBackgroundProgress(params.targetAgentId);
  }

  drainAsyncAgentResults(
    agentId: string,
    filter?: { agentIds?: string[]; childSessionIds?: string[] },
  ): AsyncAgentResultEnvelope[] {
    const results = this.asyncAgentResultsValue.get(agentId) ?? [];
    if (results.length === 0) {
      return [];
    }
    const agentIds = filter?.agentIds?.length ? new Set(filter.agentIds) : undefined;
    const childSessionIds = filter?.childSessionIds?.length ? new Set(filter.childSessionIds) : undefined;
    const drained = results.filter((result) =>
      (!agentIds || agentIds.has(result.sourceAgentId)) &&
      (!childSessionIds || childSessionIds.has(result.childSessionId))
    );
    const remaining = results.filter((result) => !drained.includes(result));
    if (remaining.length > 0) {
      this.asyncAgentResultsValue.set(agentId, remaining);
    } else {
      this.asyncAgentResultsValue.delete(agentId);
    }
    for (const result of drained) {
      this.updateChildSessionDeliveryStatus(result.childSessionId, "consumed");
    }
    this.syncParentCoordinationFromChildren();
    return drained;
  }

  hasAsyncAgentResults(agentId: string): boolean {
    return (this.asyncAgentResultsValue.get(agentId)?.length ?? 0) > 0;
  }

  pendingAsyncAgentResultCount(agentId: string): number {
    return this.asyncAgentResultsValue.get(agentId)?.length ?? 0;
  }

  pendingAsyncAgentResults(
    agentId: string,
    filter?: { agentIds?: string[]; childSessionIds?: string[] },
  ): AsyncAgentResultEnvelope[] {
    const results = this.asyncAgentResultsValue.get(agentId) ?? [];
    if (!filter?.agentIds?.length && !filter?.childSessionIds?.length) {
      return [...results];
    }
    const agentIds = filter.agentIds?.length ? new Set(filter.agentIds) : undefined;
    const childSessionIds = filter.childSessionIds?.length ? new Set(filter.childSessionIds) : undefined;
    return results.filter((result) =>
      (!agentIds || agentIds.has(result.sourceAgentId)) &&
      (!childSessionIds || childSessionIds.has(result.childSessionId))
    );
  }

  enqueueAgentMessage(toAgentId: string, message: string): void {
    const messages = this.agentMessagesQueueValue.get(toAgentId) ?? [];
    messages.push(message);
    this.agentMessagesQueueValue.set(toAgentId, messages);
    this.notifyBackgroundProgress(toAgentId);
  }

  drainAgentMessages(toAgentId: string): string[] {
    const messages = this.agentMessagesQueueValue.get(toAgentId) ?? [];
    this.agentMessagesQueueValue.delete(toAgentId);
    return messages;
  }

  registerBackgroundChild(parentAgentId: string, childAgentId: string): void {
    this.setBackgroundChildRuntimeMetadata({ agentId: childAgentId, parentAgentId });
    this.notifyBackgroundProgress(parentAgentId);
  }

  completeBackgroundChild(parentAgentId: string, childAgentId: string): void {
    this.notifyBackgroundProgress(parentAgentId);
  }

  activeBackgroundChildCount(parentAgentId: string): number {
    this.reconcileBackgroundChildren();
    return [...this.childSessionsValue.values()].filter((child) =>
      child.parentAgentId === parentAgentId && isBackgroundLifecycleActive(child.lifecyclePhase)
    ).length;
  }

  activeBackgroundChildIds(parentAgentId: string): string[] {
    this.reconcileBackgroundChildren();
    return [...this.childSessionsValue.values()]
      .filter((child) =>
        child.parentAgentId === parentAgentId && isBackgroundLifecycleActive(child.lifecyclePhase)
      )
      .map((child) => child.agentId);
  }

  stalledBackgroundChildren(parentAgentId: string): ChildSessionSummary[] {
    this.reconcileBackgroundChildren();
    return [...this.childSessionsValue.values()]
      .filter((child) =>
        child.parentAgentId === parentAgentId && child.lifecyclePhase === "stalled"
      )
      .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id))
      .map((entry) => projectBackgroundChildSummary(entry));
  }

  async waitForBackgroundProgress(agentId: string): Promise<void> {
    this.reconcileBackgroundChildren();
    if (
      this.activeBackgroundChildCount(agentId) === 0 &&
      this.pendingAsyncAgentResultCount(agentId) === 0 &&
      (this.agentMessagesQueueValue.get(agentId)?.length ?? 0) === 0 &&
      this.stalledBackgroundChildren(agentId).length === 0
    ) {
      return;
    }
    await new Promise<void>((resolve) => {
      const waiters = this.backgroundProgressWaitersValue.get(agentId) ?? [];
      waiters.push(resolve);
      this.backgroundProgressWaitersValue.set(agentId, waiters);
      const existingTimer = this.backgroundProgressTimersValue.get(agentId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      const nextStallDelay = this.nextBackgroundStallDelay(agentId);
      if (nextStallDelay !== undefined) {
        const timer = setTimeout(() => {
          this.backgroundProgressTimersValue.delete(agentId);
          this.reconcileBackgroundChildren();
          this.notifyBackgroundProgress(agentId);
        }, nextStallDelay);
        this.backgroundProgressTimersValue.set(agentId, timer);
      }
    });
  }

  private notifyBackgroundProgress(agentId: string): void {
    const timer = this.backgroundProgressTimersValue.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.backgroundProgressTimersValue.delete(agentId);
    }
    const waiters = this.backgroundProgressWaitersValue.get(agentId) ?? [];
    if (waiters.length === 0) return;
    this.backgroundProgressWaitersValue.delete(agentId);
    for (const waiter of waiters) {
      waiter();
    }
  }

  updateChildSessionDeliveryStatus(
    childSessionId: string,
    deliveryStatus: ChildSessionDeliveryStatus,
  ): ChildSessionSummary | undefined {
    const current = this.childSessionsValue.get(childSessionId);
    if (!current || current.deliveryStatus === deliveryStatus) {
      return current ? projectBackgroundChildSummary(current) : current;
    }
    return this.replaceBackgroundChild(childSessionId, {
      ...current,
      deliveryStatus,
      lifecyclePhase: deliveryStatus === "consumed" ? "picked_up" : "awaiting_pickup",
      resultAvailability: deliveryStatus === "consumed" ? "consumed" : "queued_for_parent",
      updatedAt: this.params.now(),
    });
  }

  setTopologyStatus(
    agentId: string,
    status: "idle" | "running" | "done" | "blocked" | "failed",
  ): void {
    for (const node of this.topologyValue.nodes) {
      if (node.agentId === agentId || node.id === agentId) {
        node.status = status;
      }
    }
    this.emit("topology.updated", this.topologyValue, { agentId, nodeId: agentId });
  }

  appendAgentMessage(message: AgentConversationMessage): AgentConversationMessage {
    this.agentMessagesValue.push(message);
    return message;
  }

  updateChildSession(summary: ChildSessionSummary): ChildSessionSummary {
    const parsed = ChildSessionSummarySchema.parse(summary);
    const current = this.childSessionsValue.get(parsed.id);
    return this.replaceBackgroundChild(parsed.id, {
      id: parsed.id,
      agentId: parsed.agentId,
      parentAgentId: current?.parentAgentId,
      label: parsed.label,
      sessionClass: parsed.sessionClass,
      delegationKind: parsed.delegationKind ?? current?.delegationKind,
      authoritySource: parsed.authoritySource ?? current?.authoritySource,
      status: parsed.status,
      lifecyclePhase: parsed.lifecyclePhase ?? defaultBackgroundLifecyclePhase({
        status: parsed.status,
        deliveryStatus: parsed.deliveryStatus,
        currentPhase: current?.lifecyclePhase,
        hasMeaningfulOutput: Boolean(parsed.lastMeaningfulOutputAt || parsed.lastMessage?.trim() || parsed.summary?.trim()),
      }),
      coordinationBarrier: current?.coordinationBarrier ?? "independent",
      deliveryStatus: parsed.deliveryStatus,
      resultAvailability: parsed.resultAvailability ?? current?.resultAvailability ?? "none",
      summary: parsed.summary,
      lastMessage: parsed.lastMessage,
      artifactIds: parsed.artifactIds,
      toolBundleId: parsed.toolBundleId,
      requestedToolPreset: parsed.requestedToolPreset ?? current?.requestedToolPreset,
      resolvedToolPreset: parsed.resolvedToolPreset ?? current?.resolvedToolPreset,
      resolvedToolIds: parsed.resolvedToolIds ?? [],
      spawnContract: parsed.spawnContract ?? current?.spawnContract,
      spawnPreflight: parsed.spawnPreflight,
      spawnValidation: parsed.spawnValidation ?? current?.spawnValidation,
      resultContract: parsed.resultContract,
      usedToolCount: parsed.usedToolCount,
      durationMs: parsed.durationMs,
      replayRef: parsed.replayRef,
      sourceSessionId: parsed.sourceSessionId,
      sourceRunId: parsed.sourceRunId,
      lastProgressAt: parsed.lastProgressAt,
      lastMeaningfulOutputAt: parsed.lastMeaningfulOutputAt,
      lastToolActivityAt: parsed.lastToolActivityAt,
      stallReason: parsed.stallReason,
      recoveryAttemptCount: parsed.recoveryAttemptCount ?? current?.recoveryAttemptCount ?? 0,
      startedAt: parsed.startedAt,
      updatedAt: parsed.updatedAt,
      completedAt: parsed.completedAt,
    });
  }

  childSession(agentId: string): ChildSessionSummary | undefined {
    const child = [...this.childSessionsValue.values()].find((entry) => entry.agentId === agentId);
    return child ? projectBackgroundChildSummary(child) : undefined;
  }

  setBackgroundChildRuntimeMetadata(params: {
    agentId: string;
    parentAgentId?: string;
    coordinationBarrier?: "required" | "independent";
    delegationKind?: ChildSessionDelegationKind;
    authoritySource?: ChildSessionAuthoritySource;
    requestedToolPreset?: ChildSessionSummary["requestedToolPreset"];
    resolvedToolPreset?: ChildSessionSummary["resolvedToolPreset"];
    spawnContract?: AgentSpawnContract;
    spawnValidation?: AgentSpawnResultValidation;
  }): void {
    const current = [...this.childSessionsValue.values()].find((entry) => entry.agentId === params.agentId);
    if (!current) {
      return;
    }
    this.childSessionsValue.set(current.id, {
      ...current,
      parentAgentId: params.parentAgentId ?? current.parentAgentId,
      coordinationBarrier: params.coordinationBarrier ?? current.coordinationBarrier,
      delegationKind: params.delegationKind ?? current.delegationKind,
      authoritySource: params.authoritySource ?? current.authoritySource,
      requestedToolPreset: params.requestedToolPreset ?? current.requestedToolPreset,
      resolvedToolPreset: params.resolvedToolPreset ?? current.resolvedToolPreset,
      spawnContract: params.spawnContract ?? current.spawnContract,
      spawnValidation: params.spawnValidation ?? current.spawnValidation,
    });
    this.syncParentCoordinationFromChildren(current.status);
  }

  setParentCoordination(params: {
    phase: ParentCoordinationPhase;
    activeChildIds?: string[];
    waitingChildIds?: string[];
    blockedByChildIds?: string[];
    stalledChildIds?: string[];
    recoverableChildIds?: string[];
    partialResultChildIds?: string[];
    summary?: string;
    lastResumedAt?: number;
  }): ParentCoordinationState {
    const next = ParentCoordinationStateSchema.parse({
      phase: params.phase,
      activeChildIds: params.activeChildIds ?? this.parentCoordinationValue?.activeChildIds ?? [],
      waitingChildIds: params.waitingChildIds ?? this.parentCoordinationValue?.waitingChildIds ?? [],
      blockedByChildIds: params.blockedByChildIds ?? this.parentCoordinationValue?.blockedByChildIds ?? [],
      stalledChildIds: params.stalledChildIds ?? this.parentCoordinationValue?.stalledChildIds ?? [],
      recoverableChildIds: params.recoverableChildIds ?? this.parentCoordinationValue?.recoverableChildIds ?? [],
      partialResultChildIds: params.partialResultChildIds ?? this.parentCoordinationValue?.partialResultChildIds ?? [],
      summary: params.summary ?? this.parentCoordinationValue?.summary,
      lastResumedAt: params.lastResumedAt ?? this.parentCoordinationValue?.lastResumedAt,
      updatedAt: this.params.now(),
    });
    this.parentCoordinationValue = next;
    this.emit("parent_coordination.updated", { coordination: next }, { agentId: ORA_ROOT_AGENT_ID, nodeId: ORA_ROOT_AGENT_ID });
    return next;
  }

  private replaceBackgroundChild(
    childSessionId: string,
    entry: BackgroundChildRegistryEntry,
  ): ChildSessionSummary {
    this.childSessionsValue.set(childSessionId, entry);
    const summary = projectBackgroundChildSummary(entry);
    this.emit(
      "child_session.updated",
      { childSession: summary },
      { agentId: summary.agentId, nodeId: summary.agentId },
    );
    this.syncParentCoordinationFromChildren(summary.status);
    return summary;
  }

  private reconcileBackgroundChildren(): void {
    const now = this.params.now();
    let changed = false;
    for (const [id, current] of this.childSessionsValue.entries()) {
      if (!isBackgroundLifecycleActive(current.lifecyclePhase)) {
        continue;
      }
      const lastActivityAt = Math.max(
        current.lastProgressAt ?? 0,
        current.lastMeaningfulOutputAt ?? 0,
        current.lastToolActivityAt ?? 0,
        current.updatedAt,
      );
      if (now - lastActivityAt < BACKGROUND_CHILD_STALL_TIMEOUT_MS) {
        continue;
      }
      changed = true;
      this.childSessionsValue.set(id, {
        ...current,
        lifecyclePhase: "stalled",
        resultAvailability: hasBackgroundChildConsumableOutput(current) ? "partial" : current.resultAvailability,
        stallReason: current.stallReason ?? "no_progress_timeout",
        updatedAt: now,
      });
      const summary = projectBackgroundChildSummary(this.childSessionsValue.get(id)!);
      this.emit(
        "child_session.updated",
        { childSession: summary },
        { agentId: summary.agentId, nodeId: summary.agentId },
      );
      if (current.parentAgentId) {
        this.notifyBackgroundProgress(current.parentAgentId);
      }
    }
    if (changed) {
      this.syncParentCoordinationFromChildren();
    }
  }

  private nextBackgroundStallDelay(parentAgentId: string): number | undefined {
    const candidates = [...this.childSessionsValue.values()]
      .filter((child) =>
        child.parentAgentId === parentAgentId && isBackgroundLifecycleActive(child.lifecyclePhase)
      )
      .map((child) => {
        const lastActivityAt = Math.max(
          child.lastProgressAt ?? 0,
          child.lastMeaningfulOutputAt ?? 0,
          child.lastToolActivityAt ?? 0,
          child.updatedAt,
        );
        return Math.max(0, BACKGROUND_CHILD_STALL_TIMEOUT_MS - (this.params.now() - lastActivityAt));
      });
    if (candidates.length === 0) {
      return undefined;
    }
    return Math.min(...candidates);
  }

  private syncParentCoordinationFromChildren(
    lastChildStatus?: ChildSessionSummary["status"],
  ): void {
    if (this.childSessionsValue.size === 0) {
      return;
    }
    const coordination = deriveParentCoordinationUpdate({
      children: [...this.childSessionsValue.values()].map((child) => ({
        id: child.id,
        agentId: child.agentId,
        status: child.status,
        lifecyclePhase: child.lifecyclePhase,
        resultAvailability: child.resultAvailability,
        stallReason: child.stallReason,
        coordinationBarrier: child.coordinationBarrier,
      })),
      lastChildStatus:
        lastChildStatus ??
        [...this.childSessionsValue.values()].sort((left, right) => right.updatedAt - left.updatedAt)[0]?.status ??
        "running",
    });
    this.setParentCoordination({
      ...coordination,
      ...(coordination.phase === "resuming_with_child_summaries" ? { lastResumedAt: this.params.now() } : {}),
    });
  }

  private observeBackgroundChildEvent(event: OraEventEnvelope): void {
    const agentId = event.agentId;
    if (!agentId) {
      return;
    }
    const current = [...this.childSessionsValue.values()].find((child) => child.agentId === agentId);
    if (!current) {
      return;
    }
    const next: BackgroundChildRegistryEntry = {
      ...current,
      updatedAt: Math.max(current.updatedAt, event.createdAt),
      lastProgressAt: event.createdAt,
    };
    if (event.type === "tool.called") {
      next.lastToolActivityAt = event.createdAt;
    }
    if (
      event.type === "message.delta" ||
      event.type === "token.delta" ||
      event.type === "agent.message" ||
      event.type === "artifact.exported" ||
      event.type === "artifact.degraded"
    ) {
      next.lastMeaningfulOutputAt = event.createdAt;
      if (current.status === "running" && current.deliveryStatus !== "awaiting_pickup") {
        next.lifecyclePhase = "produced_output";
        if (current.resultAvailability === "none") {
          next.resultAvailability = "visible_output";
        }
      }
    }
    if (event.type === "recovery.applied" || event.type === "recovery.exhausted") {
      next.recoveryAttemptCount = current.recoveryAttemptCount + 1;
    }
    if (event.type === "recovery.detected" && !next.stallReason) {
      next.stallReason = "recovery_detected";
    }
    this.childSessionsValue.set(current.id, next);
  }

  appendArtifact(artifact: ArtifactRef): ArtifactRef {
    this.artifactsValue.push(artifact);
    return artifact;
  }

  appendToolCall = (params: AppendRuntimeToolCallParams): OraToolCallEnvelope => {
    return this.toolCallLedger.append(params);
  };

  updateQueueSummary(patch: Partial<QueueSummary>): QueueSummary {
    this.queueSummaryValue = { ...this.queueSummaryValue, ...patch };
    return this.queueSummaryValue;
  }

  recordBusPublished(topic: string): { queueSummary: QueueSummary; busStats: BusStats } {
    this.busTopicCountsValue[topic] = (this.busTopicCountsValue[topic] ?? 0) + 1;
    this.busStatsValue = {
      enabled: true,
      publishedCount: this.busStatsValue.publishedCount + 1,
      routedCount: this.busStatsValue.routedCount,
      topicCounts: { ...this.busTopicCountsValue },
    };
    this.addQueueTopic(topic);
    return { queueSummary: this.queueSummaryValue, busStats: this.busStatsValue };
  }

  recordBusRouted(topic: string): { queueSummary: QueueSummary; busStats: BusStats } {
    this.busTopicCountsValue[topic] = (this.busTopicCountsValue[topic] ?? 0) + 1;
    this.busStatsValue = {
      enabled: true,
      publishedCount: this.busStatsValue.publishedCount,
      routedCount: this.busStatsValue.routedCount + 1,
      topicCounts: { ...this.busTopicCountsValue },
    };
    this.addQueueTopic(topic);
    return { queueSummary: this.queueSummaryValue, busStats: this.busStatsValue };
  }

  writeSharedStateEntry(params: {
    key: string;
    summary: string;
    agentId: string;
  }): { entry: SharedStateSummary["entries"][number]; sharedStateSummary: SharedStateSummary } {
    const version = this.sharedStateSummaryValue.version + 1;
    const entry = {
      key: params.key,
      version,
      summary: params.summary,
      updatedBy: params.agentId,
    };
    this.sharedEntriesValue.push(entry);
    this.sharedStateSummaryValue = {
      enabled: true,
      storeKind: "blackboard",
      version,
      entries: [...this.sharedEntriesValue],
      stopReason: params.key === "convergence" ? "converged" : undefined,
    };
    return { entry, sharedStateSummary: this.sharedStateSummaryValue };
  }

  latestEventSeq(): number {
    return this.eventsValue.at(-1)?.seq ?? -1;
  }

  emit = (
    type: OraEventEnvelope["type"],
    payload: unknown,
    extra: Partial<OraEventEnvelope> = {},
  ) => {
    const canonicalPayload = type === "plan_list.updated"
      ? planListUpdatedPayload(payload as Record<string, unknown>)
      : payload;
    const basePayloadSnapshot = type === "message.delta" || type === "token.delta"
      ? this.cloneDeltaPayload(canonicalPayload)
      : this.cloneEventPayload(canonicalPayload);
    const payloadSnapshot = this.decorateCollaborationPayload(
      type,
      basePayloadSnapshot,
      typeof extra.agentId === "string" ? extra.agentId : undefined,
    );
    const envelope = OraEventEnvelopeSchema.parse({
      id: `${this.params.runId}:evt-${this.eventsValue.length}`,
      runId: this.params.runId,
      seq: this.eventsValue.length,
      type,
      createdAt: this.params.now(),
      pattern: this.params.config.pattern,
      payload: payloadSnapshot,
      ...extra,
    });
    this.eventsValue.push(envelope);
    this.observeBackgroundChildEvent(envelope);
    if (type === "plan_list.updated") {
      const planData = payloadSnapshot as { plan?: PlanListStep[] };
      if (planData.plan) {
        this.planListValue = planData.plan;
      }
    }
    this.params.onEvent?.(envelope);
    return envelope;
  };

  setNodeLoopDepsFactory(factory: () => RunNodeRuntimeLoopDeps): void {
    this.nodeLoopDepsFactory = factory;
  }

  get nodeLoopDeps(): RunNodeRuntimeLoopDeps {
    if (!this.nodeLoopDepsFactory) {
      throw new Error("KernelRuntimeContext node loop dependencies are not initialized.");
    }
    return this.nodeLoopDepsFactory();
  }

  assembleContinuation(params: {
    previous?: StateSnapshot["continuation"];
    status: StateSnapshot["status"];
    actions: ActionRecord[];
    conversationCursor: number;
    now: number;
  }): {
    continuation: StateSnapshot["continuation"];
    pendingApprovals: string[];
  } {
    const pendingApprovalActions = params.actions.filter((action) => action.status === "approval_required");
    const pendingApprovals = pendingApprovalActions.map((action) => action.id);
    const pendingApprovalToolCalls = this.toolCalls.filter((call) =>
      call.actionId && pendingApprovals.includes(call.actionId)
    );
    const pendingApprovalToolCallIds = pendingApprovalToolCalls.map((call) => call.id);
    const continuation = continuationForKernelSnapshot({
      previous: params.previous,
      runId: this.params.runId,
      status: params.status,
      reason: pendingApprovals.length > 0
        ? "approval_required"
        : this.pendingClarificationCount() > 0
          ? "clarification_required"
          : undefined,
      pendingApprovals,
      pendingApprovalToolCallIds,
      pendingClarificationIds: this.pendingClarifications.map((clarification) => clarification.id),
      agentId: pendingApprovalToolCalls[0]?.agentId ?? pendingApprovalActions[0]?.agentId,
      nodeId: pendingApprovalToolCalls[0]?.nodeId,
      planItemId: pendingApprovalActions[0]?.planItemId,
      nodeCheckpoint: this.latestNodeCheckpoint({
        agentId: pendingApprovalToolCalls[0]?.agentId ?? pendingApprovalActions[0]?.agentId,
        nodeId: pendingApprovalToolCalls[0]?.nodeId,
      }),
      conversationCursor: params.conversationCursor,
      now: params.now,
    });

    return { continuation, pendingApprovals };
  }

  latestNodeCheckpoint(params: { agentId?: string; nodeId?: string } = {}): StateSnapshot["continuation"]["frames"][number]["nodeCheckpoint"] | undefined {
    for (const event of [...this.eventsValue].reverse()) {
      if (event.type !== "node.updated" || !event.payload || typeof event.payload !== "object") {
        continue;
      }
      const checkpoint = (event.payload as { checkpoint?: StateSnapshot["continuation"]["frames"][number]["nodeCheckpoint"] }).checkpoint;
      if (!checkpoint) {
        continue;
      }
      if (params.agentId && checkpoint.agentId !== params.agentId) {
        continue;
      }
      if (params.nodeId && checkpoint.nodeId !== params.nodeId) {
        continue;
      }
      return checkpoint;
    }
    return undefined;
  }

  assembleFinalSnapshot(params: {
    status: StateSnapshot["status"];
    input: UserTaskInput;
    config: RunConfig;
    modeSpec: ModeSpec;
    profiles: StateSnapshot["profiles"];
    memory: StateSnapshot["memory"];
    plan: StateSnapshot["plan"];
    todos: StateSnapshot["todos"];
    actions: ActionRecord[];
    conversation: StateSnapshot["conversation"];
    toolResults: StateSnapshot["toolResults"];
    checkpoint: CheckpointMeta;
    previousContinuation?: StateSnapshot["continuation"];
    conversationCursor: number;
    output: unknown;
    error?: string;
    updatedAt: number;
  }): StateSnapshot {
    const { continuation, pendingApprovals } = this.assembleContinuation({
      previous: params.previousContinuation,
      status: params.status,
      actions: params.actions,
      conversationCursor: params.conversationCursor,
      now: params.updatedAt,
    });

    return StateSnapshotSchema.parse({
      runId: this.params.runId,
      status: params.status,
      pattern: params.config.pattern,
      coordinationKind: params.config.pattern,
      modeId: params.modeSpec.id,
      input: params.input,
      config: params.config,
      topology: this.topology,
      profiles: params.profiles,
      memory: params.memory,
      plan: params.plan,
      planList: this.planList,
      todos: params.todos,
      actions: params.actions,
      toolCalls: this.toolCalls,
      continuation,
      conversation: params.conversation,
      toolResults: params.toolResults,
      policyDecisions: [],
      checkpoints: [params.checkpoint],
      events: this.events,
      agentMessages: this.agentMessages,
      childSessions: this.childSessions,
      parentCoordination: this.parentCoordination,
      artifacts: this.artifacts,
      activeAgents: this.activeAgents,
      queueSummary: this.queueSummary,
      sharedStateSummary: this.sharedStateSummary,
      busStats: this.busStats,
      pendingClarifications: this.pendingClarifications,
      pendingApprovals,
      modeSpec: params.modeSpec,
      output: params.output,
      error: params.error,
      updatedAt: params.updatedAt,
    });
  }

  private cloneDeltaPayload<T>(value: T): T {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    return { ...(value as Record<string, unknown>) } as T;
  }

  private cloneEventPayload<T>(value: T): T {
    if (value === undefined || value === null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private decorateCollaborationPayload<T>(
    type: OraEventEnvelope["type"],
    payload: T,
    agentId: string | undefined,
  ): T {
    if (type !== "message.delta" || !this.isCollaborationAgent(agentId)) {
      return payload;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return payload;
    }
    return {
      ...(payload as Record<string, unknown>),
      audience: "collaboration",
      visibility: "collaboration",
      surface: "collaboration",
    } as T;
  }

  private isCollaborationAgent(agentId: string | undefined): boolean {
    if (!agentId || agentId === ORA_ROOT_AGENT_ID) {
      return false;
    }
    return this.childSession(agentId) !== undefined;
  }

  private addQueueTopic(topic: string): void {
    if (!this.queueSummaryValue.topics.includes(topic)) {
      this.queueSummaryValue = {
        ...this.queueSummaryValue,
        topics: [...this.queueSummaryValue.topics, topic],
      };
    }
  }
}

export function deriveParentCoordinationUpdate(params: {
  children: ReadonlyArray<
    Pick<ChildSessionSummary, "id" | "agentId" | "status" | "lifecyclePhase" | "resultAvailability" | "stallReason"> & {
      coordinationBarrier?: "required" | "independent";
    }
  >;
  lastChildStatus: ChildSessionSummary["status"];
}): Pick<
  ParentCoordinationState,
  "phase" | "activeChildIds" | "waitingChildIds" | "blockedByChildIds" | "stalledChildIds" | "recoverableChildIds" | "partialResultChildIds" | "summary"
> {
  const activeChildren = params.children
    .filter((child) => {
      const phase = child.lifecyclePhase ?? defaultBackgroundLifecyclePhase({
        status: child.status,
        hasMeaningfulOutput: child.resultAvailability === "visible_output" || child.resultAvailability === "partial",
      });
      return isBackgroundLifecycleActive(phase);
    });
  const activeChildIds = activeChildren.map((child) => child.id);
  const waitingChildIds = activeChildren
    .filter((child) => child.coordinationBarrier === "required")
    .map((child) => child.id);
  const stalledChildIds = params.children
    .filter((child) => child.lifecyclePhase === "stalled")
    .map((child) => child.id);
  const blockedByChildIds = params.children
    .filter((child) =>
      child.coordinationBarrier === "required" &&
      (waitingChildIds.includes(child.id) || child.lifecyclePhase === "stalled"),
    )
    .map((child) => child.id);
  const recoverableChildIds = params.children
    .filter((child) => child.lifecyclePhase === "stalled")
    .map((child) => child.id);
  const partialResultChildIds = params.children
    .filter((child) =>
      child.resultAvailability === "visible_output" ||
      child.resultAvailability === "queued_for_parent" ||
      child.resultAvailability === "consumed" ||
      child.resultAvailability === "partial",
    )
    .map((child) => child.id);
  const phase = blockedByChildIds.length > 0
    ? "waiting_on_required_children"
    : activeChildIds.length > 0
      ? "parallel_independent_work"
      : params.lastChildStatus === "succeeded" || params.lastChildStatus === "failed" || params.lastChildStatus === "cancelled"
        ? "resuming_with_child_summaries"
        : "dispatching";

  return {
    phase,
    activeChildIds,
    waitingChildIds,
    blockedByChildIds,
    stalledChildIds,
    recoverableChildIds,
    partialResultChildIds,
    summary: blockedByChildIds.length > 0
      ? stalledChildIds.length > 0
        ? `有 ${stalledChildIds.length} 个子任务卡住，仍阻塞父流程。`
        : `正在等待 ${waitingChildIds.length} 个必需子任务`
      : activeChildIds.length > 0
        ? `正在并行处理 ${activeChildIds.length} 个后台子任务`
        : partialResultChildIds.length > 0
          ? `子 Agent 结果已回流，父 Agent 可继续整合。`
        : "子 Agent 摘要已回流，父 Agent 恢复整合。",
  };
}

export function buildDelegationGuidance(
  config: RunConfig,
  agentId: string = ORA_ROOT_AGENT_ID,
): string | undefined {
  if (agentId !== ORA_ROOT_AGENT_ID) {
    return undefined;
  }
  const strategy = config.effectiveStrategy;
  const delegationIntent = delegationIntentFromMetadata(config.metadata);
  if (!strategy) {
    return undefined;
  }
  if (strategy.sourceModeId === CODE_DEVELOPMENT_MODE_ID) {
    return undefined;
  }
  if (strategy.collaborationRequirement === "required") {
    return [
      "Delegation guidance for this turn:",
      "- The user explicitly requested team-style collaboration for this turn.",
      strategy.requestedModeId
        ? `- The requested mode was ${strategy.requestedModeId}, but this run remains in ${strategy.sourceModeId}.`
        : "- This run remains in single-agent execution, so collaboration must happen through a delegated child task.",
      "- Before providing the final answer, you must delegate at least one substantial top-level subtask with agent.spawn.",
      "- Use the delegated result in your synthesis rather than answering entirely from the root agent.",
      ...(delegationIntent?.reason ? [`- Reason: ${delegationIntent.reason}`] : []),
    ].join("\n");
  }
  if (!strategy.delegationEnabled || !strategy.delegationRequestedByUser || delegationIntent?.preference === "none") {
    return undefined;
  }
  if (delegationIntent?.preference === "allow" || strategy.delegation === "allowed") {
    return [
      "Delegation guidance for this turn:",
      "- The user explicitly allowed sub-agent help for this turn.",
      "- You may use agent.spawn if delegation would materially improve the outcome.",
      ...(delegationIntent?.reason ? [`- Reason: ${delegationIntent.reason}`] : []),
    ].join("\n");
  }
  return [
    "Delegation guidance for this turn:",
    "- The user explicitly requested team-style collaboration or sub-agent coordination for this turn.",
    "- Even in single-agent mode, treat this as explicit permission to delegate.",
    "- If the work can be split into substantial, self-contained subtasks, prefer using agent.spawn instead of doing everything locally.",
    ...(delegationIntent?.reason ? [`- Reason: ${delegationIntent.reason}`] : []),
  ].join("\n");
}

function buildModelStateContext(config: RunConfig): string | undefined {
  const strategy = config.effectiveStrategy;
  const providerId = configuredProviderId(config) ?? config.providerConfig?.id;
  const modelRef = config.modelRef ?? config.providerConfig?.modelId;
  const lines = [
    providerId || modelRef ? "Current runtime model state:" : undefined,
    providerId ? `- Provider: ${providerId}` : undefined,
    modelRef ? `- Model: ${modelRef}` : undefined,
    strategy?.reasoningEffort ? `- Reasoning effort: ${strategy.reasoningEffort}` : undefined,
    strategy ? `- Provider thinking enabled: ${strategy.providerThinkingEnabled ? "yes" : "no"}` : undefined,
    strategy?.providerPolicyStatus ? `- Provider policy status: ${strategy.providerPolicyStatus}` : undefined,
    strategy?.notes?.length ? `- Runtime policy notes: ${strategy.notes.join(" | ")}` : undefined,
  ].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function buildCompressionStateContext(
  contextState: SessionContextState | undefined,
): string | undefined {
  const compactionCount = contextState?.compactionCount ?? 0;
  const compactedHistoryCount = contextState?.compactedHistory?.length ?? 0;
  const lastCompaction = contextState?.lastCompaction;
  if (compactionCount === 0 && compactedHistoryCount === 0 && !lastCompaction) {
    return undefined;
  }
  return [
    "Current session compression state:",
    `- Compaction count: ${compactionCount}`,
    contextState?.compactedThroughTurnIndex !== undefined
      ? `- History compacted through turn index: ${contextState.compactedThroughTurnIndex}`
      : undefined,
    compactedHistoryCount > 0
      ? `- Compacted history entries carried into this request: ${compactedHistoryCount}`
      : undefined,
    lastCompaction?.phase ? `- Latest compaction phase: ${lastCompaction.phase}` : undefined,
    lastCompaction?.implementation ? `- Latest compaction implementation: ${lastCompaction.implementation}` : undefined,
    typeof lastCompaction?.beforeTokens === "number" && typeof lastCompaction?.afterTokens === "number"
      ? `- Latest compaction tokens: ${lastCompaction.beforeTokens} -> ${lastCompaction.afterTokens}`
      : undefined,
    typeof lastCompaction?.limit === "number" ? `- Latest compaction limit: ${lastCompaction.limit}` : undefined,
    lastCompaction?.reason ? `- Latest compaction reason: ${lastCompaction.reason}` : undefined,
    "- Earlier turns before the compacted boundary should be interpreted through the carried compacted history summary, not reconstructed from scratch.",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function completedNodeIdsFromPlan(plan: readonly PlanItem[] | undefined, runId: string): string[] {
  const prefix = `${runId}:`;
  return (plan ?? [])
    .filter((item) => item.status === "done" || item.status === "skipped")
    .map((item) => item.id.startsWith(prefix) ? item.id.slice(prefix.length) : item.id);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function modeProgressFinalizationError(
  planItems: readonly PlanItem[],
  todoItems: readonly TodoItem[],
): string | undefined {
  const unfinishedPlans = planItems.filter((item) => item.status !== "done" && item.status !== "skipped");
  const unfinishedTodos = todoItems.filter((item) => item.status !== "done" && item.status !== "skipped");
  if (unfinishedPlans.length === 0 && unfinishedTodos.length === 0) {
    return undefined;
  }
  const planDetail = unfinishedPlans.map((item) => `plan:${item.id} [${item.status}] ${item.title}`);
  const todoDetail = unfinishedTodos.map((item) => `todo:${item.id} [${item.status}] ${item.label}`);
  return [
    "Mode progress is incomplete; refusing to emit run.done.",
    ...planDetail,
    ...todoDetail,
  ].join("\n");
}

function continuationForKernelSnapshot(params: {
  previous?: StateSnapshot["continuation"];
  runId: string;
  status: StateSnapshot["status"];
  reason?: "approval_required" | "clarification_required";
  pendingApprovals: string[];
  pendingApprovalToolCallIds: string[];
  pendingClarificationIds: string[];
  agentId?: string;
  nodeId?: string;
  planItemId?: string;
  nodeCheckpoint?: StateSnapshot["continuation"]["frames"][number]["nodeCheckpoint"];
  conversationCursor: number;
  now: number;
}): StateSnapshot["continuation"] {
  const previousFrames = params.previous?.frames ?? [];
  if (params.status !== "interrupted" || !params.reason) {
    return params.previous ?? { frames: [] };
  }
  const activeFrameId = params.previous?.activeFrameId ?? `${params.runId}:continuation:${previousFrames.length}`;
  const existing = previousFrames.find((frame) => frame.id === activeFrameId);
  const frame = {
    id: activeFrameId,
    runId: params.runId,
    status: "paused" as const,
    reason: params.reason,
    conversationCursor: params.conversationCursor,
    pendingActionIds: params.pendingApprovals,
    pendingToolCallIds: params.pendingApprovalToolCallIds,
    pendingClarificationIds: params.pendingClarificationIds,
    approvedActionIds: existing?.approvedActionIds ?? [],
    resolvedClarificationIds: existing?.resolvedClarificationIds ?? [],
    agentId: params.agentId ?? existing?.agentId,
    nodeId: params.nodeId ?? existing?.nodeId,
    planItemId: params.planItemId ?? existing?.planItemId,
    nodeCheckpoint: params.nodeCheckpoint ?? existing?.nodeCheckpoint ?? {
      modeId: undefined,
      agentId: params.agentId ?? existing?.agentId,
      nodeId: params.nodeId ?? existing?.nodeId,
      planItemId: params.planItemId ?? existing?.planItemId,
      eventSeq: undefined,
      conversationCursor: params.conversationCursor,
      bag: {},
    },
    createdAt: existing?.createdAt ?? params.now,
    updatedAt: params.now,
  };
  return {
    activeFrameId,
    frames: existing
      ? previousFrames.map((item) => (item.id === activeFrameId ? frame : item))
      : [...previousFrames, frame],
  };
}

function createTaskMemoryCaptureHook(
  taskMemoryStore: TaskMemoryStore,
  runId: string,
  sessionId?: string,
): RuntimePostToolPolicyHook {
  return ({ toolId, args, result, isError, error }) => {
    // Capture evidence from tool result
    const resultSummary = isError
      ? `${toolId} failed: ${truncateForEvidence(String(error ?? "unknown error"))}`
      : result?.output !== undefined
        ? truncateForEvidence(typeof result.output === "string" ? result.output : JSON.stringify(result.output))
        : `${toolId} completed`;
    const resultBytes = result?.output !== undefined
      ? typeof result.output === "string" ? Buffer.byteLength(result.output, "utf8") : Buffer.byteLength(JSON.stringify(result.output), "utf8")
      : 0;

    const evidenceRef = taskMemoryStore.captureEvidence({
      runId,
      sessionId,
      sourceKind: isError ? "error_log" : "tool_output",
      summary: resultSummary,
      byteLength: resultBytes,
    });

    // Capture operation node
    const argsSummary = Object.entries(args ?? {}).slice(0, 3)
      .map(([k, v]) => `${k}=${truncateForEvidence(String(v))}`)
      .join(", ");
    const label = argsSummary ? `${toolId}(${argsSummary})` : toolId;

    taskMemoryStore.captureNode({
      runId,
      sessionId,
      kind: isError ? "failure_recovery" : "tool_operation",
      label,
      summary: resultSummary,
      status: isError ? "failed" : "done",
      evidenceRefIds: [evidenceRef.id],
    });

    return undefined; // Don't modify result
  };
}

function truncateForEvidence(value: string, maxLen = 140): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length <= maxLen ? single : single.slice(0, maxLen - 3).trim() + "...";
}

export async function executeRuntimeKernel(
  runId: string,
  input: UserTaskInput,
  config: RunConfig,
  options: RuntimeKernelOptions = {},
): Promise<RuntimeKernelResult> {
  const now = options.clock ?? Date.now;
  const definition = options.definition;
  if (!definition) {
    throw new Error("Runtime kernel requires a resolved mode definition.");
  }
  const modeSpec = options.modeSpec;
  if (!modeSpec) {
    throw new Error("Runtime kernel requires a resolved mode spec.");
  }
  const resolvedDefinition: PatternDefinition = definition;
  const resolvedModeSpec: ModeSpec = modeSpec;
  const startedAt = now();
  const projectId = input.projectId ?? "local-project";
  const skillRegistry = options.skillRegistry ?? new RuntimeSkillRegistry();
  const autoGenService = options.autoGenService ?? new SkillAutoGenService(skillRegistry, {
    statePath: options.autoGenStatePath ?? path.join(os.homedir(), ".ora", "skills", "auto-gen-state.json"),
  });
  const toolRegistry = options.toolRegistry ?? new RuntimeToolRegistry();
  const promptCache = options.promptCache ?? new PromptSectionCache({
    maxEntries: 200,
    snapshotPath: path.join(os.homedir(), ".ora", "prompt-cache.json"),
  });
  const packageManager = new PackageManager();
  const tools = toolRegistry.snapshot();
  const taskIntent = config.metadata.taskIntent as TaskIntent | undefined;
  const permissionProfileId = config.permissionProfileId ?? modeSpec.permissionProfileId;
  const permissionProfile = permissionProfileId ? getPermissionProfile(permissionProfileId) : undefined;
  const taskMemoryStore = options.taskMemoryStore;
  const postToolPolicyHooks: RuntimePostToolPolicyHook[] = [];
  if (taskMemoryStore) {
    postToolPolicyHooks.push(createTaskMemoryCaptureHook(taskMemoryStore, runId));
  }
  const runtimeToolExecutor = new RuntimeToolExecutor({
    workspace: input.context?.projectWorkspace,
    toolDescriptors: tools.tools,
    skillRegistry,
    modeRegistry: options.modeRegistry,
    selfIterationRegistry: options.selfIterationRegistry,
    automationRegistry: options.automationRegistry,
    widgetRegistry: options.widgetRegistry,
    packageManager,
    searchProviderConfig: config.searchProvider,
    toolLimits: modeSpec.toolLimits,
    taskIntent,
    permissionProfile,
    toolDefinitions: toolRegistry.listDefinitions(),
    signal: options.signal,
    turnContext: input.context,
    postToolPolicyHooks,
  });
  const skills = skillRegistry.snapshot(modeSpec.family);
  const modeProfiles = new AgentProfileRegistry(definition).list(config.profileIds);
  const rootProfile = rootAgentProfile();
  const profiles = modeProfiles.some((profile) => profile.id === ORA_ROOT_AGENT_ID)
    ? modeProfiles
    : [rootProfile, ...modeProfiles];
  const memoryService = new MemoryService(runId, now);
  const memoryCaptureQueue = new MemoryCaptureQueue();
  const planService = new PlanService(runId, definition, options.resumeState?.plan);
  const todoService = new TodoService(runId, now, planService.list(), options.resumeState?.todos);
  const actionLedger = new ActionLedger(runId, options.resumeState?.actions);
  const policyService = new PolicyService(runId, now);
  const resumeApprovals = createResumeApprovalMatcher(options.resumeContext);
  const resumeTopology = options.resumeState?.topology;
  const rootTopology = resumeTopology
    ? { nodes: resumeTopology.nodes.map((n) => ({ ...n })), edges: resumeTopology.edges }
    : injectRootAgentTopology({
        nodes: definition.topology.nodes.map((node) => ({ ...node })),
        edges: definition.topology.edges,
      }, modeSpec);
  const initialQueueSummary: QueueSummary = {
    mode:
      definition.coordinationKind === "bus"
        ? "event_bus"
        : definition.coordinationKind === "shared_state"
          ? "shared_state"
          : definition.coordinationKind === "team"
            ? "backlog"
            : "dag",
    pending: definition.planTemplate.length,
    inProgress: 0,
    completed: 0,
    topics: [],
  };
  const initialBusStats: BusStats = {
    enabled: definition.supportsEventRouting,
    publishedCount: 0,
    routedCount: 0,
    topicCounts: {},
  };
  const initialSharedStateSummary: SharedStateSummary = {
    enabled: definition.supportsSharedState,
    storeKind: definition.supportsSharedState ? "blackboard" : "none",
    version: 0,
    entries: [],
  };
  const kernelRuntimeContext = new KernelRuntimeContext({
    runId,
    config,
    now,
    initialPlanList: options.resumeState?.planList ?? [],
    initialToolCalls: options.resumeState?.toolCalls ?? [],
    initialTopology: {
      nodes: rootTopology.nodes,
      edges: rootTopology.edges,
    },
    initialQueueSummary,
    initialBusStats,
    initialSharedStateSummary,
    onEvent: options.onEvent,
  });
  const emit = kernelRuntimeContext.emit;
  const runtimeToolResultCache = new Map<string, unknown>(
    (options.resumeState?.toolResults ?? [])
      .filter((entry) => entry.status === "succeeded")
      .map((entry) => [entry.key, entry.output] as const),
  );

  const profilesById = new Map(modeSpec.profiles.map((profile) => [profile.id, profile]));
  if (!profilesById.has(ORA_ROOT_AGENT_ID)) {
    profilesById.set(ORA_ROOT_AGENT_ID, rootProfile);
  }
  const agentLabel = (agentId: string): string => profilesById.get(agentId)?.label ?? agentId;
  kernelRuntimeContext.setParentCoordination({
    phase: "planning",
    activeChildIds: [],
    waitingChildIds: [],
    summary: "父 Agent 正在规划与编排。",
  });
  const suspendedFrameDispatch = options.resumeState ? classifyContinuationDispatch(options.resumeState) : undefined;
  if (suspendedFrameDispatch?.kind === "diagnostic_failure") {
    throw Object.assign(
      new Error(suspendedFrameDispatch.message),
      { [DIAGNOSTIC_FAILURE_SYMBOL]: true as const },
    );
  }
  const suspendedFrameDecision = suspendedFrameDispatch?.kind === "resume_suspended_node" && suspendedFrameDispatch.frame.status === "awaiting_model"
    ? suspendedFrameDispatch
    : undefined;
  const shouldResumeSuspendedFrameInModeDriver = suspendedFrameDecision !== undefined &&
    resolvedModeSpec.family === "orchestrator_subagent" &&
    !resolvedModeSpec.stages?.length &&
    resolvedModeSpec.nodes.length > 1;
  const modeResume = shouldResumeSuspendedFrameInModeDriver && suspendedFrameDecision
    ? {
        activeFrameId: suspendedFrameDecision.frame.id,
        activeNodeId: suspendedFrameDecision.nodeId,
        activeAgentId: suspendedFrameDecision.agentId,
        bag: cloneRecord(suspendedFrameDecision.frame.nodeCheckpoint?.bag),
        completedNodeIds: completedNodeIdsFromPlan(options.resumeState?.plan, runId),
      }
    : undefined;
  let suspendedFrameConsumedByMode = false;

  const emitAgentMessage = (params: {
    fromAgentId: string;
    toAgentIds?: string[];
    replyToId?: string;
    threadId: string;
    nodeId?: string;
    planItemId?: string;
    kind: AgentConversationMessage["kind"];
    status?: AgentConversationMessage["status"];
    content: string;
    topic?: string;
    correlationId?: string;
    artifactIds?: string[];
    transcript?: AgentConversationMessage["transcript"];
  }) => {
    const message = AgentConversationMessageSchema.parse({
      id: `${runId}:agent-message:${kernelRuntimeContext.agentMessageCount()}`,
      runId,
      createdAt: now(),
      toAgentIds: [],
      status: "sent",
      artifactIds: [],
      ...params,
    });
    kernelRuntimeContext.appendAgentMessage(message);
    emit(
      "agent.message",
      { message },
      {
        agentId: message.fromAgentId,
        nodeId: message.nodeId ?? message.fromAgentId,
      },
    );
    if (
      params.toAgentIds &&
      params.toAgentIds.length > 0
    ) {
      for (const toAgentId of params.toAgentIds) {
        kernelRuntimeContext.enqueueAgentMessage(toAgentId, params.content);
      }
    }
    return message;
  };

  const oraObservationKeys = new Set<string>();
  const emitOraObservation = (params: {
    phase: string;
    observedAgentId?: string;
    observedNodeId?: string;
    content: string;
  }) => {
    if (config.metadata.showOraObservations !== true) {
      return undefined;
    }
    if (modeSpec.id === SINGLE_AGENT_MODE_ID || oraObservationKeys.size >= 4) {
      return undefined;
    }
    const key = `${params.phase}:${params.observedNodeId ?? params.observedAgentId ?? "mode"}`;
    if (oraObservationKeys.has(key)) {
      return undefined;
    }
    oraObservationKeys.add(key);
    return emitAgentMessage({
      fromAgentId: ORA_ROOT_AGENT_ID,
      toAgentIds: [],
      threadId: `${runId}:ora-observer`,
      nodeId: ORA_ROOT_AGENT_ID,
      kind: "status",
      status: "done",
      content: params.content,
    });
  };

  const completion = new RuntimeCompletionController(config, modeSpec, emit);
  const recoveryCoordinator = new RecoveryCoordinator(
    modeSpec,
    runtimeToolExecutor.enabledToolIds(config.toolIds),
  );
  const resolvedTaskIntent = (
    config.metadata.taskIntent === "chat" ||
    config.metadata.taskIntent === "plan" ||
    config.metadata.taskIntent === "implement"
  )
    ? config.metadata.taskIntent
    : undefined;

  const publishRecoveryArtifact = (
    incident: RecoveryIncident,
    decision: RecoveryDecision,
  ) => {
    const recoveryArtifact = RecoveryArtifactSchema.parse({
      id: `${runId}:recovery:${kernelRuntimeContext.artifactCount()}`,
      runId,
      nodeId: incident.nodeId,
      toolId: incident.toolId,
      errorType: incident.errorType,
      decision: decision.action,
      summary: decision.summary,
      usableOutput: decision.usableOutput,
      originalError: incident.detail,
      createdAt: now(),
    });
    const artifact = ArtifactRefSchema.parse({
      id: recoveryArtifact.id,
      runId,
      kind: "log",
      label: "Recovery artifact",
      mimeType: "application/json",
      createdAt: recoveryArtifact.createdAt,
      payload: recoveryArtifact,
    });
    kernelRuntimeContext.appendArtifact(artifact);
    emit(
      "artifact.degraded",
      { artifact, recovery: recoveryArtifact },
      {
        nodeId: incident.nodeId,
        agentId: incident.agentId,
      },
    );
    return recoveryArtifact;
  };

  const emitRecoveryDecision = (
    incident: RecoveryIncident,
    decision: RecoveryDecision,
  ) => {
    emit(
      "recovery.detected",
      { incident },
      { nodeId: incident.nodeId, agentId: incident.agentId },
    );
    if (decision.action === "retry") {
      emit(
        "recovery.retry_scheduled",
        { incident, decision },
        { nodeId: incident.nodeId, agentId: incident.agentId },
      );
    } else if (decision.action === "fail") {
      emit(
        "recovery.exhausted",
        { incident, decision },
        { nodeId: incident.nodeId, agentId: incident.agentId },
      );
    } else {
      emit(
        "recovery.applied",
        { incident, decision },
        { nodeId: incident.nodeId, agentId: incident.agentId },
      );
    }
  };

  const emitPlanUpdated = () => {
    const items = planService.list();
    emit("plan.updated", { items });
    // Record causal decision when plan has pending items
    const hasPending = items.some((s) => s.status !== "done" && s.status !== "failed" && s.status !== "skipped");
    if (hasPending) {
      const inheritedTaskState = latestCausalTaskState(kernelRuntimeContext.events);
      emit("causal.decision.recorded", CausalDecisionRecordSchema.parse({
        decisionId: `${kernelRuntimeContext.runId}:plan:${Date.now()}`,
        source: "runtime_followup",
        decisionKind: "plan_updated",
        taskState: mergeCausalTaskState(inheritedTaskState, {
          surfaceRequest: input.prompt,
          keyUncertainties: ["上下文不足"],
          chosenIntervention: "plan",
          confidence: 0.5,
        }),
        policyDecision: {
          goalUncertainty: 0.5,
          factUncertainty: 0.2,
          contextUncertainty: 0.4,
          actionRisk: 0.1,
          userCost: 0.3,
          reversibility: "medium",
          recommendedAction: "plan",
          reason: "plan: plan.updated with pending items at runtime",
          wouldChangeOutcomeIfWrong: false,
        },
        chosenIntervention: "plan",
        alternativeInterventions: [],
        recordedAt: Date.now(),
        decisionContext: { phase: "plan_updated" },
      }));
    }
  };

  const emitTodoUpdated = () => {
    emit("todo.updated", { items: todoService.list() });
  };

  const appendToolCall = kernelRuntimeContext.appendToolCall;
  const actionDeps = () => ({
    actionLedger,
    policyService,
    approvalMode: config.approvalMode,
    permissionMode: config.permissionMode,
    resumeApprovals,
    emit,
    appendToolCallStatus: (
      record: OraToolCallEnvelope,
      status: OraToolCallEnvelope["status"],
    ) => {
      appendToolCall({ ...record, status });
    },
    appendToolCall,
    currentCausalTaskState: () => latestCausalTaskState(kernelRuntimeContext.events),
    onApprovalAutoResolved: options.onApprovalAutoResolved,
  });

  const emitNodeRuntimeState = (
    state: NodeRuntimeLoopState,
    params: {
      agentId: string;
      title?: string;
      actionId?: string;
      reason?: string;
      detail?: string;
      toolId?: string;
      iteration?: number;
    },
  ) => {
    emit(
      "node.updated",
      {
        state,
        title: params.title,
        actionId: params.actionId,
        reason: params.reason,
        detail: params.detail,
        toolId: params.toolId,
        iteration: params.iteration,
        toolAttempts: completion.toolAttempts,
        maxToolCalls: completion.maxToolCalls,
      },
      { agentId: params.agentId, nodeId: params.agentId },
    );
  };

  const emitDelegatedAgentState = (
    state: Extract<NodeRuntimeLoopState, "interrupted" | "failed" | "degraded">,
    params: {
      agentId: string;
      title?: string;
      detail?: string;
    },
  ) => {
    emitNodeRuntimeState(state, params);
  };

  const emitRejectedFinalToolIntent = (
    call: RuntimeToolCall,
    reason: CompletionStopReason,
  ) => {
    emitRejectedFinalToolIntentWithDeps(call, reason, emit);
  };

  const coerceNoToolResponse = (
    response: ModelResponse,
    reason: CompletionStopReason,
    options: { emitRejectedToolIntent?: boolean } = {},
  ): ModelResponse => {
    return coerceNoToolResponseWithDeps(response, reason, {
      toolIds: config.toolIds,
      emit,
      setCompletionStopReason: (stopReason) =>
        completion.setCompletionStopReason(stopReason),
    }, options);
  };

  const runForcedFinalProviderCall = async (params: {
    invokeProvider: typeof invokeRunProvider | typeof invokeRunProviderStream;
    config: RunConfig;
    messages: ModelMessage[];
    system: string;
    providerCache?: ModelRequest["providerCache"];
    cacheDiagnosticsContext?: ModelRequest["cacheDiagnosticsContext"];
    nativeTools: ReturnType<RuntimeToolExecutor["toolDefinitions"]>;
    streamCallbacks?: Parameters<typeof invokeRunProviderStream>[2];
    reason: CompletionStopReason;
    agentId?: string;
    nodeId?: string;
    title?: string;
    emitNodeRuntimeState?: typeof emitNodeRuntimeState;
    onProviderExhausted?: (error: unknown) => ModelResponse | undefined;
  }): Promise<ModelResponse> => {
    completion.markForcedFinalConsumed({ agentId: params.agentId, nodeId: params.nodeId });
    const forcedFinalStateEmitter = params.emitNodeRuntimeState ?? emitNodeRuntimeState;
    const invokeForcedFinalProvider = async (messages: ModelMessage[]): Promise<ModelResponse> => {
      try {
        return await params.invokeProvider(
          params.config,
          {
            messages,
            system: forcedFinalSystemPrompt(params.system, params.reason),
            providerCache: params.providerCache,
            cacheDiagnosticsContext: params.cacheDiagnosticsContext,
            maxTokens: params.config.budget?.maxTokens,
            tools: params.nativeTools,
            toolChoice: params.nativeTools.length > 0 ? "none" : undefined,
            signal: options.signal,
          },
          params.streamCallbacks,
        );
      } catch (caught) {
        if (params.agentId) {
          forcedFinalStateEmitter("failed", {
            agentId: params.agentId,
            title: params.title,
            reason: params.reason,
            detail: caught instanceof Error ? caught.message : String(caught),
          });
        }
        const exhaustedFallback = params.onProviderExhausted?.(caught);
        if (exhaustedFallback) {
          return exhaustedFallback;
        }
        throw caught;
      }
    };
    const response = await invokeForcedFinalProvider(params.messages);
    const fallbackToolIntent = extractRuntimeToolCallFromText(
      response.text,
      config.toolIds,
    );
    if (fallbackToolIntent) {
      emitRejectedFinalToolIntent(fallbackToolIntent, params.reason);
      const retryResponse = await invokeForcedFinalProvider([
        ...params.messages,
        {
          role: "user",
          content: [
            `Completion control rejected a ${fallbackToolIntent.tool} tool call because tools are disabled for this final answer.`,
            "Do not call tools or emit tool JSON.",
            "Use the available conversation and prior tool results to answer the user's original request now.",
          ].join("\n"),
        },
      ]);
      const finalResponse = coerceNoToolResponse(retryResponse, params.reason);
      if (params.agentId) {
        forcedFinalStateEmitter("completed", {
          agentId: params.agentId,
          title: params.title,
        });
      }
      return finalResponse;
    }
    const finalResponse = coerceNoToolResponse(response, params.reason);
    if (params.agentId) {
      forcedFinalStateEmitter("completed", {
        agentId: params.agentId,
        title: params.title,
      });
    }
    return finalResponse;
  };

  const completionMetadata = () => completion.metadata();

  const inferCompletionStopReason = (value: unknown) => {
    if (completion.completionStopReason) {
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const verifier = record.verifier;
      if (
        verifier &&
        typeof verifier === "object" &&
        !Array.isArray(verifier)
      ) {
        const verifierRecord = verifier as Record<string, unknown>;
        if (verifierRecord.verdict === "pass") {
          completion.setCompletionStopReason("verification_passed");
          return;
        }
        if (verifierRecord.exhausted === true) {
          completion.setCompletionStopReason("verification_exhausted");
          return;
        }
      }
    }
    completion.setCompletionStopReason("completed");
  };

  const clarificationAnswer = (key: string, id: string): unknown => {
    return resolveClarificationAnswer({
      key,
      id,
      resumeClarifications: options.resumeContext?.clarifications,
      inputClarifications: input.context?.clarifications,
    });
  };

  const setTopologyStatus = (
    agentId: string,
    status: "idle" | "running" | "done" | "blocked" | "failed",
  ) => {
    kernelRuntimeContext.setTopologyStatus(agentId, status);
  };

  const setPlanStatus = (
    templateId: string,
    status:
      | "planned"
      | "ready"
      | "running"
      | "blocked"
      | "done"
      | "failed"
      | "skipped",
  ) => {
    const item = planService.findByTemplateId(templateId);
    if (!item) {
      return;
    }
    planService.setStatus(item.id, status);
    todoService.setStatus(item.id, status);
    const queueSummary = kernelRuntimeContext.updateQueueSummary({
      pending: planService
        .list()
        .filter((plan) => plan.status === "planned" || plan.status === "ready")
        .length,
      inProgress: planService.list().filter((plan) => plan.status === "running")
        .length,
      completed: planService
        .list()
        .filter((plan) => plan.status === "done" || plan.status === "skipped")
        .length,
    });
    emitPlanUpdated();
    emit("queue.updated", { summary: queueSummary });
    if (status === "done" || status === "skipped" || status === "blocked" || status === "failed") {
      const node = modeSpec.nodes.find((candidate) => candidate.id === templateId);
      const observedAgentId = node?.ownerAgentId ?? node?.id;
      const label = node?.title ?? node?.label ?? templateId;
      const phase = status === "done" || status === "skipped" ? "stage-completed" : "stage-blocked";
      emitOraObservation({
        phase,
        observedAgentId,
        observedNodeId: templateId,
        content: status === "done" || status === "skipped"
          ? `${ORA_ROOT_AGENT_LABEL} observed ${label} complete and is keeping the run moving.`
          : `${ORA_ROOT_AGENT_LABEL} observed ${label} needs attention before the run can finish cleanly.`,
      });
    }
  };

  const effectiveAgentToolVisibility = (
    agentId: string,
    nodeId?: string,
    customAgentId?: string,
    requestedToolIds?: readonly string[],
  ) => {
    const profile = profilesById.get(agentId);
    const profileToolIds = profile?.toolIds ?? [];
    const customAgentToolIds = customAgentId ? options.customAgentContexts?.[customAgentId]?.toolIds ?? [] : [];
    return resolveVisibleToolsForAgent({
      availableToolIds: config.toolIds,
      toolDescriptors: toolRegistry.list(),
      modeSpec,
      agentId,
      nodeId,
      profileToolIds,
      customAgentToolIds,
      requestedToolIds,
      taskIntent: resolvedTaskIntent,
      isNestedAgentSpawn,
    });
  };

  const effectiveAgentToolIds = (agentId: string, nodeId?: string, customAgentId?: string): string[] => {
    return effectiveAgentToolVisibility(agentId, nodeId, customAgentId).visibleToolIds;
  };

  const restrictToolsForAgentBoundary = (agentId: string, toolIds: string[]): string[] => {
    return [...new Set(toolIds)].filter((toolId) => config.toolIds.includes(toolId));
  };

  const effectiveAgentSkillIds = (agentId: string, customAgentId?: string): string[] => {
    const profile = profilesById.get(agentId);
    const profileSkillIds = profile?.skillIds ?? [];
    const customAgentSkillIds = customAgentId ? options.customAgentContexts?.[customAgentId]?.skillIds ?? [] : [];
    const requestedSkillIds = profileSkillIds.length > 0 ? profileSkillIds : customAgentSkillIds;
    if (requestedSkillIds.length === 0) {
      return config.skillIds;
    }
    const requested = new Set(requestedSkillIds);
    return config.skillIds.filter((skillId) => requested.has(skillId));
  };

  const customAgentIdForAgent = (agentId: string, nodeCustomAgentId?: string): string | undefined =>
    profilesById.get(agentId)?.customAgentId ?? nodeCustomAgentId;

  const customAgentOverlayFor = (customAgentId: string | undefined): string | undefined => {
    if (!customAgentId) {
      return options.customAgentOverlay;
    }
    return options.customAgentContexts?.[customAgentId]?.overlay
      ?? options.customAgentOverlays?.[customAgentId]
      ?? options.customAgentOverlay;
  };

  const workspaceContext = [
    workspaceSystemPrompt(input.context?.projectWorkspace),
    channelProjectGuidancePrompt(input.context, input.context?.projectWorkspace),
  ].filter(Boolean).join("\n\n") || undefined;

  const projectInstructionsContext = ((): string | undefined => {
    const workspace = input.context?.projectWorkspace;
    if (!workspace || typeof workspace !== "object") return undefined;
    const rootPath = (workspace as Record<string, unknown>).rootPath;
    if (!rootPath || typeof rootPath !== "string") return undefined;
    const agentsPath = path.join(rootPath, "AGENTS.md");
    try {
      const stat = fs.statSync(agentsPath);
      if (!stat.isFile() || stat.size === 0) return undefined;
      return projectInstructionsSystemPrompt(fs.readFileSync(agentsPath, "utf8"));
    } catch {
      return undefined;
    }
  })();

  const turnLocalMetadataGuidance = turnLocalMetadataGuidancePrompt();
  const temporalContext = temporalContextPrompt({
    createdAt: input.createdAt,
    context: input.context,
    now,
  });
  const resolvedRuntimeLanguage = resolveRuntimeResponseLanguage({
    userPrompt: input.prompt,
    context: input.context,
  });
  const turnLocalMetadata = turnLocalMetadataPrompt({
    createdAt: input.createdAt,
    context: input.context,
    userPrompt: input.prompt,
    now,
  });
  const userLanguageContext = userFacingLanguagePrompt(input.prompt);
  const modelConversationMessages = withCurrentTurnLocalMetadata(
    options.conversationMessages,
    input.prompt,
    turnLocalMetadata,
  );
  const memoryContext =
    typeof config.metadata.memoryPromptOverlay === "string"
      ? config.metadata.memoryPromptOverlay
      : undefined;
  const taskMemoryOverlay = taskMemoryStore?.renderOverlay(runId);
  const mergedMemoryContext = [memoryContext, taskMemoryOverlay]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n\n") || undefined;
  const modelStateContext = buildModelStateContext(config);
  const compressionStateContext = buildCompressionStateContext(options.sessionContextState);
  const taskIntentContextForAgent = (agentId: string) => {
    const taskIntent = config.metadata.taskIntent as TaskIntent | undefined;
    const delegationContext = buildDelegationGuidance(config, agentId);
    switch (taskIntent) {
      case "chat":
        return [
          "你处于对话模式，不能修改任何文件。请以问答方式帮助用户，解释代码、回答问题，但不要尝试编辑或创建文件。",
          delegationContext,
        ].filter(Boolean).join("\n\n");
      case "plan":
        return [
          "你处于计划模式。你的目标：产出一份可直接交接给执行者实施的完整计划。不要执行任何文件修改操作。",
          delegationContext,
          "",
          "## 停止标准",
          "计划必须「决策完备」：另一个 agent 或工程师拿到这份计划后，不需要做任何实现决策即可开始执行。",
          "当以下条件满足时，停止探索并输出计划：",
          "- 剩余未知项不影响实现决策，或",
          "- 未知项已被记录为明确假设/默认选择",
          "",
          "## 未知分类",
          "A. 可发现事实（repo 中的代码、配置、schema）→ 自行探索，不问用户",
          "B. 偏好/取舍（产品意图、技术选型）→ 问用户；若无回答，采用推荐默认值并记录为假设",
          "",
          "## 三阶段推进",
          "Phase 1 - 环境理解：读代码、搜配置、看 schema、找入口",
          "Phase 2 - 意图确认：确认目标、成功标准、约束、范围",
          "Phase 3 - 方案设计：确认实现路径、接口、数据流、边界、测试",
          "",
          "只有 Phase 3 达到「决策完备」，才输出计划。",
          "",
          "## 输出协议",
          "决策完备后，输出：",
          "<proposed_plan>",
          "计划标题",
          "## 背景",
          "简要上下文",
          "## 实施步骤",
          "1. [步骤] - 涉及文件: path/to/file - 预期变更: ...",
          "2. ...",
          "## 假设与默认选择",
          "- [列出所有假设和未确认的偏好项]",
          "## 验证方式",
          "- [如何验证实施结果]",
          "</proposed_plan>",
          "",
          "输出上述 XML 块后，立即停止——不要继续调用任何工具，不要追加解释文字。",
        ].filter(Boolean).join("\n");
      case "implement":
        return delegationContext;
      default:
        return delegationContext;
    }
  };
  const systemPrompt = (extra: string) => extra.trim();

  const withAgentRuntimeContext = (
    system: string,
    params: { agentId: string; nodeId?: string; customAgentId?: string },
    overrideToolIds?: string[],
  ) => {
    const customOverlay = customAgentOverlayFor(params.customAgentId);
    const systemOverlay = params.customAgentId ? undefined : options.systemAgentOverlays?.[params.agentId];
    const toolIds = overrideToolIds
      ? restrictToolsForAgentBoundary(
          params.agentId,
          config.toolIds.filter((toolId) => overrideToolIds.includes(toolId)),
        )
      : effectiveAgentToolIds(params.agentId, params.nodeId, params.customAgentId);
    const configSkillIds = effectiveAgentSkillIds(params.agentId, params.customAgentId);
    const toolPrompt = runtimeToolExecutor.systemPrompt(toolIds);
    const availableSkills = skillRegistry.list({ enabledOnly: true });
    const mentionedSkillIds = resolveSkillMentions(
      extractSkillMentions(input.prompt),
      availableSkills,
    );
    const skillIds = [...new Set([...configSkillIds, ...mentionedSkillIds])];
    const snippets = skillRegistry.promptSnippets(skillIds);
    return buildAgentPromptContext({
      agentId: params.agentId,
      profile: profilesById.get(params.agentId),
      customAgentId: params.customAgentId,
      customPersona: customOverlay,
      systemAgentOverride: systemOverlay,
      stageSystem: [userLanguageContext, system].join("\n\n"),
      workspaceContext,
      projectInstructionsContext,
      turnLocalMetadataGuidance,
      temporalContext,
      memoryContext: mergedMemoryContext,
      taskIntentContext: taskIntentContextForAgent(params.agentId),
      modelStateContext,
      availableSkills,
      toolProtocol: toolPrompt,
      skillSnippets: snippets,
      compressionStateContext,
      toolIds,
      cache: promptCache,
    });
  };

  kernelRuntimeContext.setNodeLoopDepsFactory(() => ({
    config,
    modeSpec,
    conversationMessages: modelConversationMessages,
    streamProvider: options.streamProvider,
    signal: options.signal,
    inputPrompt: input.prompt,
    turnIndex: options.turnIndex,
    now,
    events: () => kernelRuntimeContext.events,
    eventsLength: () => kernelRuntimeContext.eventCount(),
    clarificationCount: () => kernelRuntimeContext.events.filter(
      (e) => e.type === "clarification.required",
    ).length,
    planList: () => kernelRuntimeContext.planList,
    activePlanStepId: () => activePlanStepId(kernelRuntimeContext.planList),
    autoAdvancePlanListFromLifecycle: ({ agentId, nodeId, title, evidenceToolCallIds, planStepId }) => {
      const payload = advancePlanListFromLifecycle({
        plan: kernelRuntimeContext.planList,
        planStepId,
        explanation: `Advanced plan after ${title} completed runtime work (${evidenceToolCallIds.length} tool result${evidenceToolCallIds.length === 1 ? "" : "s"}).`,
      });
      if (!payload) {
        return false;
      }
      emit("plan_list.updated", payload, { agentId, nodeId });
      return true;
    },
    toolCalls: () => kernelRuntimeContext.toolCalls,
    runtimeToolExecutor,
    completion,
    runtimeToolResultCache,
    recoveryCoordinator,
    appendToolCall,
    emit,
    emitNodeRuntimeState,
    emitRecoveryDecision,
    emitRejectedFinalToolIntent,
    extractCausalTaskState: (params: ExtractCausalTaskStateParams) => extractCausalTaskState(params, { invokeProvider: invokeRunProvider }),
    clarificationAnswer,
    drainPendingExternalInputs: (agentId) => ({
      messages: kernelRuntimeContext.drainAgentMessages(agentId),
      asyncResults: kernelRuntimeContext.drainAsyncAgentResults(agentId),
    }),
    activeBackgroundChildCount: (agentId) => kernelRuntimeContext.activeBackgroundChildCount(agentId),
    pendingAsyncResultCount: (agentId) => kernelRuntimeContext.pendingAsyncAgentResultCount(agentId),
    stalledBackgroundChildren: (agentId) => kernelRuntimeContext.stalledBackgroundChildren(agentId),
    waitForBackgroundProgress: (agentId) => kernelRuntimeContext.waitForBackgroundProgress(agentId),
    ensureClarification,
    ensureClarifications,
    coerceNoToolResponse,
    runForcedFinalProviderCall,
    publishRecoveryArtifact,
    publishFileChangeArtifact,
    sleep,
    actionDeps,
  }));

  const runNodeRuntimeLoopForAgent = async (params: RunNodeRuntimeLoopParams): Promise<ModelResponse> =>
    runNodeRuntimeLoop(params, kernelRuntimeContext.nodeLoopDeps);
  const latestAgentInvocationContext = new Map<string, { prompt: string; system: string }>();
  const assistantMessageId = (params: {
    agentId: string;
    nodeId: string;
    actionId?: string;
    suffix?: string;
  }) => {
    const actionSegment = params.actionId ? `:${params.actionId}` : "";
    const suffixSegment = params.suffix ? `:${params.suffix}` : "";
    return `${runId}:assistant:${params.agentId}:${params.nodeId}${actionSegment}${suffixSegment}`;
  };

  const callAgent = async (params: {
    agentId: string;
    planItemId?: string;
    title: string;
    prompt: string;
    system: string;
    customAgentId?: string;
    riskLevel?: ActionRiskLevel;
    toolIds?: string[];
  }) => {
    latestAgentInvocationContext.set(params.agentId, {
      prompt: params.prompt,
      system: params.system,
    });
    const agentInvocationStartedAt = now();
    const effectiveCustomAgentId = customAgentIdForAgent(params.agentId, params.customAgentId);
    const effectiveNodeId = params.planItemId ?? params.agentId;
    const effectiveVisibility = effectiveAgentToolVisibility(
      params.agentId,
      effectiveNodeId,
      effectiveCustomAgentId,
      params.toolIds,
    );
    const effectiveToolIds = params.toolIds
      ? restrictToolsForAgentBoundary(params.agentId, effectiveVisibility.visibleToolIds)
      : effectiveVisibility.visibleToolIds;
    const currentChildSession = params.agentId === ORA_ROOT_AGENT_ID
      ? undefined
      : kernelRuntimeContext.childSession(params.agentId);
    const modeStageChildSessionBase = params.agentId !== ORA_ROOT_AGENT_ID
      && currentChildSession?.authoritySource !== "dynamic_spawn"
      ? {
          agentId: params.agentId,
          label: currentChildSession?.label ?? params.title,
          sessionClass: currentChildSession?.sessionClass ?? "mode_subagent" as const,
          coordinationBarrier: "required" as const,
          delegationKind: currentChildSession?.delegationKind ?? "mode_stage" as const,
          authoritySource: currentChildSession?.authoritySource ?? "mode_stage" as const,
          requestedToolPreset: currentChildSession?.requestedToolPreset ?? effectiveVisibility.presetId,
          resolvedToolPreset: currentChildSession?.resolvedToolPreset ?? effectiveVisibility.presetId,
          resolvedToolIds: effectiveToolIds,
        }
      : undefined;
    const syncModeStageChild = (patch: {
      status: ChildSessionSummary["status"];
      summary?: string;
      lastMessage?: string;
      usedToolCount?: number;
      artifactIds?: string[];
      durationMs?: number;
    }) => {
      if (!modeStageChildSessionBase) {
        return;
      }
      updateCollaborationState({
        ...modeStageChildSessionBase,
        status: patch.status,
        summary: patch.summary,
        lastMessage: patch.lastMessage,
        usedToolCount: patch.usedToolCount,
        artifactIds: patch.artifactIds,
        durationMs: patch.durationMs,
      });
      kernelRuntimeContext.setBackgroundChildRuntimeMetadata({
        agentId: params.agentId,
        parentAgentId: ORA_ROOT_AGENT_ID,
        coordinationBarrier: modeStageChildSessionBase.coordinationBarrier,
        delegationKind: modeStageChildSessionBase.delegationKind,
        authoritySource: modeStageChildSessionBase.authoritySource,
        requestedToolPreset: modeStageChildSessionBase.requestedToolPreset,
        resolvedToolPreset: modeStageChildSessionBase.resolvedToolPreset,
      });
    };
    syncModeStageChild({
      status: "running",
      summary: "子 Agent 正在执行任务。",
    });

    kernelRuntimeContext.activateAgent(params.agentId);
    setTopologyStatus(params.agentId, "running");
    emit(
      "agent.started",
      { title: params.title, planItemId: params.planItemId },
      { agentId: params.agentId, nodeId: params.agentId },
    );
    const actionType = `agent.${params.agentId}.invoke`;
    const expectedPlanItemId = params.planItemId
      ? `${runId}:${params.planItemId}`
      : undefined;
    const resumeAction = actionLedger.list().find((record) =>
      record.type === actionType &&
      record.agentId === params.agentId &&
      record.status === "approval_required" &&
      (expectedPlanItemId === undefined || record.planItemId === expectedPlanItemId)
    );
    const action = resumeAction ?? actionLedger.propose({
      id: `${params.agentId}-${kernelRuntimeContext.eventCount()}`,
      type: actionType,
      riskLevel: params.riskLevel ?? "low",
      input: { prompt: params.prompt, title: params.title },
      planItemId: expectedPlanItemId,
      agentId: params.agentId,
    });
    if (params.planItemId) {
      planService.linkAction(`${runId}:${params.planItemId}`, action.id);
    }
    if (!resumeAction) {
      emit(
        "action.updated",
        { actionId: action.id, status: "proposed", record: action },
        { agentId: params.agentId, nodeId: params.agentId },
      );
    }

    const decision = policyService.evaluate(action);
    const requiresManualGate =
      config.approvalMode === "manual" &&
      actionLedger
        .list()
        .every(
          (record) => record.id === action.id || record.status === "proposed",
        );
    const effectiveDecision =
      requiresManualGate && !decision.requiredApproval
        ? {
            ...decision,
            requiredApproval: true,
            reason:
              "Manual approval mode pauses the run before the first action executes.",
          }
        : decision;
    if (
      effectiveDecision.requiredApproval &&
      config.approvalMode === "manual"
    ) {
      await resolveRuntimeActionApproval({
        action,
        context: {
          agentId: params.agentId,
          nodeId: params.agentId,
          title: params.title,
        },
        deps: actionDeps(),
        decision: effectiveDecision,
        approvalMode: "manual",
      });
    }

    transitionRuntimeAction({
      action,
      status: "running",
      context: { agentId: params.agentId, nodeId: params.agentId },
      deps: actionDeps(),
    });
    while (true) {
      try {
        const runtimePromptContext = withAgentRuntimeContext(params.system, {
          agentId: params.agentId,
          nodeId: effectiveNodeId,
          customAgentId: effectiveCustomAgentId,
        }, params.toolIds);
        const response = await runNodeRuntimeLoopForAgent({
          runId,
          agentId: params.agentId,
          nodeId: effectiveNodeId,
          title: params.title,
          prompt: promptWithTurnLocalMetadata(params.prompt, turnLocalMetadata),
          system: runtimePromptContext.system,
          providerCache: runtimePromptContext.stablePrefix
            ? { stableSystemPrefix: runtimePromptContext.stablePrefix }
            : undefined,
          cacheDiagnosticsContext: {
            derivedContextBlocks: runtimePromptContext.cacheDiagnosticsContext.derivedContextBlocks,
          },
          toolIds: effectiveToolIds,
          timeoutMs:
            resolvedModeSpec.nodes.find(
              (n) => n.id === (params.planItemId ?? params.agentId),
            )?.config.timeoutMs ?? DEFAULT_NODE_TIMEOUT_MS,
          onForcedFinalProviderExhausted: (error) => {
            const detail = error instanceof Error ? error.message : String(error);
            const incident = classifyRecoveryError(error, {
              surface: "provider",
              nodeId: params.agentId,
              agentId: params.agentId,
              actionId: action.id,
            });
            const finalizationIncident: RecoveryIncident = {
              ...incident,
              errorType: "provider_finalization_unavailable",
            };
            const recoveryDecision = recoveryCoordinator.resolve(finalizationIncident);
            emitRecoveryDecision(finalizationIncident, recoveryDecision);
            if (recoveryDecision.action !== "fallback_artifact") {
              return undefined;
            }
            const recoveryArtifact = publishRecoveryArtifact(
              finalizationIncident,
              recoveryDecision,
            );
            return {
              providerId: configuredProviderId(config) ?? "unknown",
              providerType: config.providerConfig?.type ?? "local_smoke",
              modelId: config.modelRef ?? config.providerConfig?.modelId ?? "unknown",
              text: `${params.title} continued with limited context after forced-final provider recovery.`,
              raw: {
                recoveryArtifactId: recoveryArtifact.id,
                recoveredFrom: "forced_final_provider",
                error: detail,
              },
              finishReason: "recovery_fallback",
            };
          },
        });

        emit(
          "tool.called",
          {
            actionId: action.id,
            providerId: response.providerId,
            modelId: response.modelId,
            title: params.title,
            status: "succeeded",
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        // Do not emit empty final message/token deltas — they mislead the
        // transcript into treating an empty response as meaningful output.
        const cleanedText = stripInternalAssistantText(response.text);
        if (cleanedText.length > 0) {
          emit(
            "message.delta",
            {
              role: "assistant",
              messageId: assistantMessageId({
                agentId: params.agentId,
                nodeId: params.planItemId ?? params.agentId,
                actionId: action.id,
              }),
              content: cleanedText,
              ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
              ...(isInternalProviderAssistantText(cleanedText)
                ? { visibility: "internal" }
                : {}),
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
          emit(
            "token.delta",
            {
              text: response.text.slice(0, 32),
              tokenCount: Math.max(
                1,
                response.text.split(/\s+/).filter(Boolean).length,
              ),
              budget: config.budget,
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
        }

        const succeeded = actionLedger.transition(action.id, "succeeded", {
          output: response.raw,
        });
        emit(
          "action.updated",
          { actionId: action.id, status: "succeeded", record: succeeded },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "agent.completed",
          { title: params.title },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        const toolStats = collectChildExecutionStats(params.agentId);
        syncModeStageChild({
          status: "succeeded",
          summary: cleanedText.trim() || `${params.title} 已完成。`,
          lastMessage: cleanedText.trim() || undefined,
          usedToolCount: toolStats.usedToolCount,
          artifactIds: toolStats.artifactIds,
          durationMs: Math.max(0, now() - agentInvocationStartedAt),
        });
        kernelRuntimeContext.deactivateAgent(params.agentId);
        setTopologyStatus(params.agentId, "done");
        return response.text;
      } catch (error) {
        if (isRecoveryExhaustedError(error)) {
          syncModeStageChild({
            status: "failed",
            summary: error instanceof Error ? error.message : String(error),
            lastMessage: error instanceof Error ? error.message : String(error),
            durationMs: Math.max(0, now() - agentInvocationStartedAt),
          });
          kernelRuntimeContext.deactivateAgent(params.agentId);
          setTopologyStatus(params.agentId, "failed");
          throw error;
        }
        if (
          isApprovalInterruptError(error) ||
          isClarificationInterruptError(error)
        ) {
          syncModeStageChild({
            status: "cancelled",
            summary: error instanceof Error ? error.message : String(error),
            lastMessage: error instanceof Error ? error.message : String(error),
            durationMs: Math.max(0, now() - agentInvocationStartedAt),
          });
          emitDelegatedAgentState("interrupted", {
            agentId: params.agentId,
            title: params.title,
            detail: error instanceof Error ? error.message : String(error),
          });
          kernelRuntimeContext.deactivateAgent(params.agentId);
          setTopologyStatus(params.agentId, "blocked");
          throw error;
        }

        const detail = error instanceof Error ? error.message : String(error);
        const failed = actionLedger.transition(action.id, "failed", {
          error: detail,
        });
        emit(
          "tool.called",
          {
            actionId: action.id,
            providerId: configuredProviderId(config) ?? "unknown",
            title: params.title,
            status: "failed",
            error: detail,
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "action.updated",
          { actionId: action.id, status: "failed", record: failed },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emitDelegatedAgentState("failed", {
          agentId: params.agentId,
          title: params.title,
          detail,
        });
        const incident = classifyRecoveryError(error, {
          surface: "provider",
          nodeId: params.agentId,
          agentId: params.agentId,
          actionId: action.id,
        });
        const recoveryDecision = recoveryCoordinator.resolve(incident);
        emitRecoveryDecision(incident, recoveryDecision);

        if (recoveryDecision.action === "retry") {
          await sleep(recoveryDecision.retryDelayMs ?? 0);
          const retrying = actionLedger.transition(action.id, "running");
          emit(
            "action.updated",
            { actionId: action.id, status: "running", record: retrying },
            { agentId: params.agentId, nodeId: params.agentId },
          );
          continue;
        }

        if (recoveryDecision.action !== "fallback_artifact") {
          syncModeStageChild({
            status: "failed",
            summary: detail,
            lastMessage: detail,
            durationMs: Math.max(0, now() - agentInvocationStartedAt),
          });
          kernelRuntimeContext.deactivateAgent(params.agentId);
          setTopologyStatus(params.agentId, "failed");
          throw error;
        }

        const recoveryArtifact = publishRecoveryArtifact(
          incident,
          recoveryDecision,
        );
        const fallbackPrefix = modeSpec.runtimeAtoms.includes(
          "tool_error_boundary",
        )
          ? "[tool-error-boundary]"
          : "[recovery:fallback]";
        const fallback = `${fallbackPrefix} ${params.title} degraded after ${incident.errorType}: ${detail}`;
        const visibleFallback = `${params.title} continued with limited context after a recoverable runtime issue.`;
        const degraded = actionLedger.transition(action.id, "failed", {
          output: { recoveryArtifactId: recoveryArtifact.id, text: fallback },
          artifactIds: [recoveryArtifact.id],
        });
        emit(
          "action.updated",
          { actionId: action.id, status: "failed", record: degraded },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "message.delta",
          {
            role: "assistant",
            messageId: assistantMessageId({
              agentId: params.agentId,
              nodeId: params.agentId,
              actionId: action.id,
              suffix: "recovery",
            }),
            content: fallback,
            visibility: "internal",
            boundary: modeSpec.runtimeAtoms.includes("recovery_policy")
              ? "recovery_policy"
              : "tool_error_boundary",
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emit(
          "agent.completed",
          { title: params.title, degraded: true },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        emitDelegatedAgentState("degraded", {
          agentId: params.agentId,
          title: params.title,
          detail,
        });
        syncModeStageChild({
          status: "succeeded",
          summary: visibleFallback,
          lastMessage: visibleFallback,
          durationMs: Math.max(0, now() - agentInvocationStartedAt),
        });
        kernelRuntimeContext.deactivateAgent(params.agentId);
        setTopologyStatus(params.agentId, "done");
        throw new AgentDegradedError(visibleFallback, {
          recoveryArtifactId: recoveryArtifact.id,
          errorType: incident.errorType,
          detail,
        });
      }
    }
  };

  let spawnDepth = 0;
  const MAX_SPAWN_DEPTH = 3;
  let isNestedAgentSpawn = false;
  let subAgentCounter = 0;
  const DEFAULT_RESULT_CONTRACT_BY_BUNDLE: Record<AgentToolBundleId, AgentResultContract> = {
    research_readonly: "final_answer",
    repo_forensics: "evidence_report",
    review_readonly: "evidence_report",
    builder_write: "diff_report",
  };
  const READONLY_SPAWN_BUNDLES = new Set<AgentToolBundleId>([
    "research_readonly",
    "repo_forensics",
    "review_readonly",
  ]);
  const MUTATING_TOOL_IDS = new Set(["file.write", "file.patch", "file.apply_patch"]);
  const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

  const uniqueStrings = (values: readonly string[]): string[] => [...new Set(values.filter((value) => value.length > 0))];

  const normalizeUrl = (value: string): string | undefined => {
    try {
      const parsed = new URL(value.trim());
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return undefined;
    }
  };

  const extractUrls = (text: string): string[] =>
    uniqueStrings(
      [...text.matchAll(URL_PATTERN)]
      .map((match) => normalizeUrl(match[0]))
      .filter((value): value is string => typeof value === "string"),
    );

  const normalizePathValue = (value: string): string => path.posix.normalize(value.trim().replaceAll("\\", "/"));

  const normalizeCasefold = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

  const defaultNormalizationForSubjectKind = (
    kind: "url" | "file" | "artifact" | "entity" | "topic" | "document",
  ): "url_canonical" | "path_canonical" | "casefold" | "none" => {
    switch (kind) {
      case "url":
        return "url_canonical";
      case "file":
      case "document":
        return "path_canonical";
      case "entity":
      case "topic":
        return "casefold";
      default:
        return "none";
    }
  };

  const normalizeValueWithMode = (
    value: string,
    normalization: "auto" | "none" | "url_canonical" | "path_canonical" | "casefold" | undefined,
    defaultMode: "url_canonical" | "path_canonical" | "casefold" | "none",
  ): string => {
    const mode = normalization && normalization !== "auto" ? normalization : defaultMode;
    switch (mode) {
      case "url_canonical":
        return normalizeUrl(value) ?? value.trim();
      case "path_canonical":
        return normalizePathValue(value);
      case "casefold":
        return normalizeCasefold(value);
      case "none":
      default:
        return value.trim();
    }
  };

  const effectiveValidationPolicyForContract = (
    contract: AgentSpawnContract,
  ): "enforce" | "diagnostics_only" =>
    contract.validationPolicy ?? (contract.source === "inferred" ? "diagnostics_only" : "enforce");

  const normalizeSpawnContract = (contract: AgentSpawnContract | undefined): AgentSpawnContract | undefined => {
    if (!contract) {
      return undefined;
    }
    const normalizedSubject = contract.subject
      ? {
          ...contract.subject,
          normalization: contract.subject.normalization ?? "auto",
          normalizedValue: normalizeValueWithMode(
            contract.subject.normalizedValue ?? contract.subject.value,
            contract.subject.normalization,
            defaultNormalizationForSubjectKind(contract.subject.kind),
          ),
        }
      : undefined;
    const normalizedBindings = contract.resourceBindings.map((binding: AgentSpawnContract["resourceBindings"][number]) => ({
      ...binding,
      ...(binding.locator === "value"
        ? {
            normalization: binding.normalization ?? "auto",
            normalizedValue: normalizeValueWithMode(
              binding.normalizedValue ?? binding.value,
              binding.normalization,
              defaultNormalizationForSubjectKind(binding.kind),
            ),
          }
        : {}),
    }));
    return AgentSpawnContractSchema.parse({
      ...contract,
      requiredAffordances: uniqueStrings(contract.requiredAffordances),
      resourceBindings: normalizedBindings,
      resultRules: uniqueStrings(contract.resultRules),
      subject: normalizedSubject,
      validationPolicy: effectiveValidationPolicyForContract(contract),
    });
  };

  const inferSpawnContract = (params: {
    prompt: string;
    description: string;
    toolBundle?: AgentToolBundleId;
    resolvedToolIds?: readonly string[];
    explicitContract?: AgentSpawnContract;
  }): AgentSpawnContract | undefined => {
    if (params.explicitContract) {
      return normalizeSpawnContract(params.explicitContract);
    }
    const requiredAffordances = new Set<AgentSpawnAffordance>();
    const resultRules = new Set<"subject_match_required" | "resource_binding_match_required" | "source_reference_required">();
    const allText = `${params.description}\n${params.prompt}`;
    const firstUrl = extractUrls(allText)[0];
    const scriptLike = /(?:\/|\b)(?:[^\s]+\.sh)\b|(?:^|\s)(?:bash|zsh|sh|python3?|node|pnpm|npm|yarn)\b/i.test(allText);
    if (scriptLike) {
      requiredAffordances.add("shell_execute");
    }
    if (firstUrl) {
      requiredAffordances.add("web_read");
      resultRules.add("subject_match_required");
      resultRules.add("source_reference_required");
      resultRules.add("resource_binding_match_required");
    }
    const sideEffectPolicy = params.toolBundle && READONLY_SPAWN_BUNDLES.has(params.toolBundle)
      ? "none"
      : undefined;
    const subject = firstUrl
      ? {
          kind: "url" as const,
          value: firstUrl,
          normalization: "url_canonical" as const,
          normalizedValue: firstUrl,
        }
      : undefined;
    const resourceBindings = firstUrl
      ? [{ locator: "value" as const, kind: "url" as const, value: firstUrl, normalization: "url_canonical" as const, normalizedValue: firstUrl, required: true }]
      : [];
    if (
      requiredAffordances.size === 0 &&
      !subject &&
      resourceBindings.length === 0 &&
      !sideEffectPolicy &&
      (!params.resolvedToolIds || !params.resolvedToolIds.length)
    ) {
      return undefined;
    }
    return normalizeSpawnContract({
      source: "inferred",
      requiredAffordances: [...requiredAffordances],
      subject,
      resourceBindings,
      sideEffectPolicy,
      resultRules: [...resultRules],
      validationPolicy: "diagnostics_only",
    });
  };

  const resolvedToolsSatisfyAffordance = (
    resolvedToolIds: readonly string[],
    affordance: AgentSpawnAffordance,
  ): boolean => {
    switch (affordance) {
      case "repo_read":
        return resolvedToolIds.includes("file.read");
      case "repo_search":
        return resolvedToolIds.includes("file.list")
          || resolvedToolIds.includes("file.glob")
          || resolvedToolIds.includes("file.grep");
      case "repo_explore":
        return resolvedToolIds.includes("repo.explore");
      case "web_read":
        return resolvedToolIds.includes("web.fetch") || resolvedToolIds.includes("web.search");
      case "shell_execute":
        return resolvedToolIds.includes("shell.execute");
      case "workspace_write":
        return resolvedToolIds.some((toolId) => MUTATING_TOOL_IDS.has(toolId));
      default:
        return false;
    }
  };

  const evaluateSpawnContractForTooling = (params: {
    contract?: AgentSpawnContract;
    resolvedToolIds: readonly string[];
  }): {
    blocked: boolean;
    diagnosticType?: string;
    message?: string;
    violations: AgentSpawnContractViolation[];
  } => {
    const contract = params.contract;
    if (!contract) {
      return { blocked: false, violations: [] };
    }
    const violations: AgentSpawnContractViolation[] = [];
    const missingAffordances = contract.requiredAffordances.filter((affordance: AgentSpawnAffordance) =>
      !resolvedToolsSatisfyAffordance(params.resolvedToolIds, affordance)
    );
    if (missingAffordances.length > 0) {
      violations.push({
        code: "missing_required_affordance",
        message: `Missing required affordances: ${missingAffordances.join(", ")}.`,
      });
    }
    if ((contract.resultRules.includes("subject_match_required") || contract.resultRules.includes("source_reference_required")) && !contract.subject) {
      violations.push({
        code: "subject_unbound",
        message: "The spawn contract requires a bound subject, but no subject was provided or inferred.",
      });
    }
    if (
      contract.sideEffectPolicy === "none" &&
      params.resolvedToolIds.some((toolId) => MUTATING_TOOL_IDS.has(toolId))
    ) {
      violations.push({
        code: "side_effect_not_allowed",
        message: "The spawn contract forbids workspace side effects, but the resolved tool surface includes mutation tools.",
      });
    }
    if (
      contract.resultRules.includes("resource_binding_match_required") &&
      contract.resourceBindings.filter((binding: AgentSpawnContract["resourceBindings"][number]) => binding.required).length === 0
    ) {
      violations.push({
        code: "resource_binding_missing",
        message: "The spawn contract requires explicit resource bindings, but none were resolved.",
      });
    }
    if (violations.length === 0) {
      return { blocked: false, violations };
    }
    const primary = violations[0];
    const diagnosticType =
      primary.code === "missing_required_affordance"
        ? "spawn_affordance_mismatch"
        : primary.code === "side_effect_not_allowed"
          ? "spawn_side_effect_violation"
          : primary.code === "resource_binding_missing"
            ? "spawn_resource_binding_missing"
            : "spawn_subject_unbound";
    return {
      blocked: true,
      diagnosticType,
      message: primary.message,
      violations,
    };
  };

  const updateCollaborationState = (params: {
    agentId: string;
    label: string;
    sessionClass: ChildSessionClass;
    status: ChildSessionSummary["status"];
    coordinationBarrier?: "required" | "independent";
    summary?: string;
    lastMessage?: string;
    artifactIds?: string[];
    delegationKind?: ChildSessionDelegationKind;
    authoritySource?: ChildSessionAuthoritySource;
    toolBundleId?: AgentToolBundleId;
    requestedToolPreset?: ChildSessionSummary["requestedToolPreset"];
    resolvedToolPreset?: ChildSessionSummary["resolvedToolPreset"];
    resolvedToolIds?: string[];
    spawnContract?: AgentSpawnContract;
    spawnPreflight?: AgentSpawnPreflightResult;
    spawnValidation?: AgentSpawnResultValidation;
    resultContract?: AgentResultContract;
    deliveryStatus?: ChildSessionSummary["deliveryStatus"];
    usedToolCount?: number;
    durationMs?: number;
  }) => {
    const current = kernelRuntimeContext.childSession(params.agentId);
    const startedAt = current?.startedAt ?? now();
    const next = kernelRuntimeContext.updateChildSession({
      id: `${runId}:${params.agentId}`,
      agentId: params.agentId,
      label: params.label,
      sessionClass: params.sessionClass,
      delegationKind: params.delegationKind ?? current?.delegationKind,
      authoritySource: params.authoritySource ?? current?.authoritySource,
      status: params.status,
      deliveryStatus: params.deliveryStatus ?? current?.deliveryStatus,
      summary: params.summary ?? current?.summary,
      lastMessage: params.lastMessage ?? current?.lastMessage,
      artifactIds: params.artifactIds ?? current?.artifactIds ?? [],
      toolBundleId: params.toolBundleId ?? current?.toolBundleId,
      requestedToolPreset: params.requestedToolPreset ?? current?.requestedToolPreset,
      resolvedToolPreset: params.resolvedToolPreset ?? current?.resolvedToolPreset,
      resolvedToolIds: params.resolvedToolIds ?? current?.resolvedToolIds ?? [],
      spawnContract: params.spawnContract ?? current?.spawnContract,
      spawnPreflight: params.spawnPreflight ?? current?.spawnPreflight,
      spawnValidation: params.spawnValidation ?? current?.spawnValidation,
      resultContract: params.resultContract ?? current?.resultContract,
      usedToolCount: params.usedToolCount ?? current?.usedToolCount,
      durationMs: params.durationMs ?? current?.durationMs,
      recoveryAttemptCount: current?.recoveryAttemptCount ?? 0,
      replayRef: {
        kind: "event_range",
        runId,
        fromSeq: current?.replayRef?.fromSeq ?? Math.max(0, kernelRuntimeContext.latestEventSeq()),
        toSeq: kernelRuntimeContext.latestEventSeq(),
      },
      sourceRunId: runId,
      startedAt,
      updatedAt: now(),
      completedAt:
        params.status === "succeeded" || params.status === "failed" || params.status === "cancelled"
          ? now()
          : undefined,
    });
    kernelRuntimeContext.setBackgroundChildRuntimeMetadata({
      agentId: params.agentId,
      coordinationBarrier: params.coordinationBarrier,
      delegationKind: params.delegationKind,
      authoritySource: params.authoritySource,
      requestedToolPreset: params.requestedToolPreset,
      resolvedToolPreset: params.resolvedToolPreset,
      spawnContract: params.spawnContract,
      spawnValidation: params.spawnValidation,
    });
    return next;
  };

  const resolvedSpawnTooling = (params: {
    agentId: string;
    parentAgentId: string;
    description: string;
    prompt: string;
    toolBundle?: AgentToolBundleId;
    toolIds?: string[];
    resultContract?: AgentResultContract;
    spawnContract?: AgentSpawnContract;
  }): {
    toolBundleId?: AgentToolBundleId;
    resolvedToolIds?: string[];
    spawnContract?: AgentSpawnContract;
    spawnPreflight?: AgentSpawnPreflightResult;
    resultContract: AgentResultContract;
    blockedResult?: Record<string, unknown>;
  } => {
    if (!params.toolBundle && !params.toolIds?.length) {
      const inferredContract = inferSpawnContract({
        prompt: params.prompt,
        description: params.description,
        resolvedToolIds: undefined,
        explicitContract: params.spawnContract,
      });
      return {
        spawnContract: inferredContract,
        resultContract: params.resultContract ?? "final_answer",
      };
    }
    if (!params.toolBundle) {
      const resolvedToolIds = restrictToolsForAgentBoundary(
        params.agentId,
        config.toolIds.filter((toolId) => params.toolIds?.includes(toolId)),
      );
      if (params.toolIds?.length && resolvedToolIds.length === 0) {
        throw new Error("agent.spawn custom tool_ids resolved to no executable tools in the current run.");
      }
      const spawnContract = inferSpawnContract({
        prompt: params.prompt,
        description: params.description,
        resolvedToolIds,
        explicitContract: params.spawnContract,
      });
      const contractAssessment = evaluateSpawnContractForTooling({
        contract: spawnContract,
        resolvedToolIds,
      });
      const resolvedResultContract = params.resultContract ?? "final_answer";
      if (contractAssessment.blocked) {
        return {
          resolvedToolIds,
          spawnContract,
          resultContract: resolvedResultContract,
          blockedResult: {
            status: "blocked",
            agent_id: params.agentId,
            authority_source: "dynamic_spawn",
            diagnostic_type: contractAssessment.diagnosticType,
            resolved_tool_ids: resolvedToolIds,
            result_contract: resolvedResultContract,
            spawn_contract: spawnContract,
            contract_violations: contractAssessment.violations,
            message: `agent.spawn blocked: ${contractAssessment.message}`,
            suggested_next_step: "Adjust the child contract or tool surface so the delegated task is structurally executable.",
          },
        };
      }
      return {
        resolvedToolIds,
        spawnContract,
        resultContract: resolvedResultContract,
      };
    }
    const bundle = resolveChildToolBundleDefinition({
      bundleId: params.toolBundle,
      availableToolIds: config.toolIds,
      toolDescriptors: toolRegistry.list(),
      taskIntent: resolvedTaskIntent,
      isNestedAgentSpawn,
    });
    const bundleToolIds = restrictToolsForAgentBoundary(params.agentId, bundle.toolIds);
    const preflight: AgentSpawnPreflightResult = {
      ...bundle.preflight,
      resolvedToolIds: bundleToolIds,
      missingToolIds: bundle.preflight.missingToolIds.filter((toolId: string) => !bundleToolIds.includes(toolId)),
    };
    const requestedToolIds = params.toolIds?.length
      ? bundleToolIds.filter((toolId) => params.toolIds?.includes(toolId))
      : bundleToolIds;
    const spawnContract = inferSpawnContract({
      prompt: params.prompt,
      description: params.description,
      toolBundle: params.toolBundle,
      resolvedToolIds: requestedToolIds,
      explicitContract: params.spawnContract,
    });
    emit(
      "agent_spawn_preflight.completed",
      AgentSpawnPreflightTelemetrySchema.parse({
        ...preflight,
        modeId: config.modeId,
        taskIntent: resolvedTaskIntent,
        parentAgentId: params.parentAgentId,
        nestedSpawn: isNestedAgentSpawn,
        spawnContract,
      }),
      { agentId: params.parentAgentId, nodeId: params.parentAgentId },
    );
    if (requestedToolIds.length === 0 && preflight.status !== "blocked") {
      throw new Error(`agent.spawn tool bundle "${params.toolBundle}" resolved to no executable tools in the current run.`);
    }
    const resolvedResultContract = params.resultContract ?? DEFAULT_RESULT_CONTRACT_BY_BUNDLE[params.toolBundle];
    const contractAssessment = evaluateSpawnContractForTooling({
      contract: spawnContract,
      resolvedToolIds: requestedToolIds,
    });
    if (preflight.status === "blocked") {
      const missingCaps = preflight.missingCapabilities.length > 0
        ? preflight.missingCapabilities.join(", ")
        : "required preset capabilities";
      const suggestion = preflight.recommendedAlternativePreset
        ? `Try tool_bundle="${preflight.recommendedAlternativePreset}" or stay in the parent's read-only surface.`
        : "Stay in the parent's current tool surface or route this task to an environment with the needed capabilities.";
      return {
        toolBundleId: params.toolBundle,
        resolvedToolIds: requestedToolIds,
        spawnContract,
        spawnPreflight: preflight,
        resultContract: resolvedResultContract,
        blockedResult: {
          status: "blocked",
          agent_id: params.agentId,
          authority_source: "dynamic_spawn",
          diagnostic_type: "spawn_authority_mismatch",
          tool_bundle: params.toolBundle,
          requested_tool_preset: preflight.requestedPreset,
          resolved_tool_preset: preflight.resolvedPreset,
          resolved_tool_ids: requestedToolIds,
          result_contract: resolvedResultContract,
          spawn_contract: spawnContract,
          message: `agent.spawn blocked: preset "${params.toolBundle}" is unavailable because ${missingCaps} are missing.`,
          recommended_alternative_preset: preflight.recommendedAlternativePreset,
          suggested_next_step: suggestion,
          preflight,
        },
      };
    }
    if (contractAssessment.blocked) {
      return {
        toolBundleId: params.toolBundle,
        resolvedToolIds: requestedToolIds,
        spawnContract,
        spawnPreflight: preflight,
        resultContract: resolvedResultContract,
        blockedResult: {
          status: "blocked",
          agent_id: params.agentId,
          authority_source: "dynamic_spawn",
          diagnostic_type: contractAssessment.diagnosticType,
          tool_bundle: params.toolBundle,
          requested_tool_preset: preflight.requestedPreset,
          resolved_tool_preset: preflight.resolvedPreset,
          resolved_tool_ids: requestedToolIds,
          result_contract: resolvedResultContract,
          spawn_contract: spawnContract,
          contract_violations: contractAssessment.violations,
          message: `agent.spawn blocked: ${contractAssessment.message}`,
          suggested_next_step: "Adjust the child contract or tool surface so the delegated task stays on the intended subject and resource boundary.",
          preflight,
        },
      };
    }
    return {
      toolBundleId: params.toolBundle,
      resolvedToolIds: requestedToolIds,
      spawnContract,
      spawnPreflight: preflight,
      resultContract: resolvedResultContract,
    };
  };

  const collectChildExecutionStats = (agentId: string): {
    usedToolCount: number;
    artifactIds: string[];
  } => {
    const childSession = kernelRuntimeContext.childSession(agentId);
    const startedAt = childSession?.startedAt;
    const completedAt = now();
    const toolCalls = kernelRuntimeContext.toolCalls.filter((call) =>
      call.agentId === agentId &&
      call.toolId !== "agent.spawn" &&
      call.toolId !== "agent.wait" &&
      call.toolId !== "message.send" &&
      call.status !== "proposed" &&
      (typeof startedAt !== "number" || call.requestedAt >= startedAt) &&
      call.requestedAt <= completedAt
    );
    const artifactIds = childSession?.artifactIds ?? [];
    return {
      usedToolCount: toolCalls.length,
      artifactIds: [...artifactIds],
    };
  };

  const collectChildToolCalls = (agentId: string): OraToolCallEnvelope[] => {
    const childSession = kernelRuntimeContext.childSession(agentId);
    const startedAt = childSession?.startedAt;
    const completedAt = now();
    return kernelRuntimeContext.toolCalls.filter((call) =>
      call.agentId === agentId &&
      call.toolId !== "agent.spawn" &&
      call.toolId !== "agent.wait" &&
      call.toolId !== "message.send" &&
      call.status !== "proposed" &&
      (typeof startedAt !== "number" || call.requestedAt >= startedAt) &&
      call.requestedAt <= completedAt
    );
  };

  const collectObservedSpawnEvidence = (agentId: string): {
    urls: string[];
    paths: string[];
    textValues: string[];
    handles: Array<{ handleKind: "artifact" | "browser_session" | "browser_snapshot" | "child_session" | "run"; handleId: string }>;
    mutatingToolIds: string[];
  } => {
    const toolCalls = collectChildToolCalls(agentId);
    const urls = new Set<string>();
    const paths = new Set<string>();
    const textValues = new Set<string>();
    const handles = new Map<string, { handleKind: "artifact" | "browser_session" | "browser_snapshot" | "child_session" | "run"; handleId: string }>();
    const mutatingToolIds = new Set<string>();
    const childSession = kernelRuntimeContext.childSession(agentId);

    const recordHandle = (
      handleKind: "artifact" | "browser_session" | "browser_snapshot" | "child_session" | "run",
      handleId: string,
    ) => {
      const trimmed = handleId.trim();
      if (!trimmed) return;
      handles.set(`${handleKind}:${trimmed}`, { handleKind, handleId: trimmed });
    };

    const visit = (value: unknown, keyHint?: string) => {
      if (typeof value === "string") {
        textValues.add(normalizeCasefold(value));
        for (const url of extractUrls(value)) {
          urls.add(url);
        }
        if (keyHint && keyHint.toLowerCase().includes("path") && value.trim().length > 0) {
          paths.add(normalizePathValue(value));
        }
        const normalizedKey = keyHint?.toLowerCase();
        if (normalizedKey === "artifact_id" || normalizedKey === "artifactid") {
          recordHandle("artifact", value);
        } else if (normalizedKey === "browser_session_id" || normalizedKey === "browsersessionid") {
          recordHandle("browser_session", value);
        } else if (normalizedKey === "browser_snapshot_id" || normalizedKey === "browsersnapshotid" || normalizedKey === "snapshot_id" || normalizedKey === "snapshotid") {
          recordHandle("browser_snapshot", value);
        } else if (normalizedKey === "child_session_id" || normalizedKey === "childsessionid") {
          recordHandle("child_session", value);
        } else if (normalizedKey === "run_id" || normalizedKey === "runid") {
          recordHandle("run", value);
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          visit(item, keyHint);
        }
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          visit(nested, key);
        }
      }
    };

    for (const call of toolCalls) {
      if (MUTATING_TOOL_IDS.has(call.toolId)) {
        mutatingToolIds.add(call.toolId);
      }
      visit(call.args);
      visit(call.result);
    }
    for (const artifactId of childSession?.artifactIds ?? []) {
      recordHandle("artifact", artifactId);
    }
    if (childSession?.id) {
      recordHandle("child_session", childSession.id);
    }
    if (childSession?.sourceRunId) {
      recordHandle("run", childSession.sourceRunId);
    }

    return {
      urls: [...urls],
      paths: [...paths],
      textValues: [...textValues],
      handles: [...handles.values()],
      mutatingToolIds: [...mutatingToolIds],
    };
  };

  const validateSpawnContractResult = (params: {
    agentId: string;
    contract?: AgentSpawnContract;
  }): AgentSpawnResultValidation | undefined => {
    if (!params.contract) {
      return undefined;
    }
    const observed = collectObservedSpawnEvidence(params.agentId);
    const violations: AgentSpawnContractViolation[] = [];
    const contract = params.contract;

    if (contract.sideEffectPolicy === "none" && observed.mutatingToolIds.length > 0) {
      violations.push({
        code: "unexpected_workspace_mutation",
        message: `The child used mutation tools despite side_effect_policy=none: ${observed.mutatingToolIds.join(", ")}.`,
      });
    }

    const subject = contract.subject;
    if (subject && contract.resultRules.includes("subject_match_required")) {
      if (subject.kind === "url") {
        const target = subject.normalizedValue ?? subject.value;
        if (!observed.urls.includes(target)) {
          violations.push({
            code: "subject_mismatch",
            message: `The child never touched the bound subject URL "${target}".`,
          });
        }
      } else if (subject.kind === "file" || subject.kind === "document") {
        const target = subject.normalizedValue ?? subject.value;
        if (!observed.paths.includes(target)) {
          violations.push({
            code: "subject_mismatch",
            message: `The child never touched the bound subject path "${target}".`,
          });
        }
      } else if (subject.kind === "entity" || subject.kind === "topic") {
        const target = subject.normalizedValue ?? subject.value;
        if (!observed.textValues.some((value) => value.includes(target))) {
          violations.push({
            code: "subject_mismatch",
            message: `The child never referenced the bound subject text "${target}".`,
          });
        }
      }
    }

    if (contract.resultRules.includes("resource_binding_match_required")) {
      for (const binding of contract.resourceBindings.filter((item: AgentSpawnContract["resourceBindings"][number]) => item.required)) {
        const matched = binding.locator === "handle"
          ? observed.handles.some((handle) => handle.handleKind === binding.handleKind && handle.handleId === binding.handleId)
          : (() => {
              const target = binding.normalizedValue ?? binding.value;
              return binding.kind === "url"
                ? observed.urls.includes(target)
                : observed.paths.includes(target);
            })();
        if (!matched) {
          violations.push({
            code: "resource_binding_mismatch",
            message:
              binding.locator === "handle"
                ? `The child result did not stay on the required ${binding.handleKind} handle "${binding.handleId}".`
                : `The child result did not stay on the required ${binding.kind} binding "${binding.normalizedValue ?? binding.value}".`,
          });
        }
      }
    }

    if (contract.resultRules.includes("source_reference_required")) {
      const hasObservedReference = observed.urls.length > 0 || observed.paths.length > 0 || observed.handles.length > 0;
      if (!hasObservedReference) {
        violations.push({
          code: "source_reference_missing",
          message: "The child returned a result without any observable source reference or bound resource usage.",
        });
      }
    }

    return AgentSpawnResultValidationSchema.parse({
      status: violations.length === 0 ? "passed" : "failed",
      policy: effectiveValidationPolicyForContract(contract),
      effect:
        violations.length === 0
          ? "none"
          : effectiveValidationPolicyForContract(contract) === "diagnostics_only"
            ? "warning"
            : "blocked",
      violations,
      observedUrls: observed.urls,
      observedPaths: observed.paths,
      observedHandles: observed.handles,
    });
  };

  const validateChildResult = (params: {
    agentId: string;
    description: string;
    resultText: string;
    resultContract: AgentResultContract;
    spawnContract?: AgentSpawnContract;
    toolBundleId?: AgentToolBundleId;
    resolvedToolIds?: string[];
    usedToolCount: number;
  }): {
    text: string;
    spawnValidation?: AgentSpawnResultValidation;
  } => {
    const trimmed = stripInternalAssistantText(params.resultText).trim();
    if (!trimmed || isInternalProviderAssistantText(params.resultText)) {
      throw new Error(`Sub-agent "${params.description || params.agentId}" produced only internal tool protocol text and no consumable answer.`);
    }
    if (
      params.resultContract !== "plan_only" &&
      /<proposed_plan>\s*[\s\S]+?\s*<\/proposed_plan>/i.test(params.resultText)
    ) {
      throw new Error(`Sub-agent "${params.description || params.agentId}" returned a proposed plan where an executable result was required.`);
    }
    if (
      (params.toolBundleId === "research_readonly" ||
        params.toolBundleId === "repo_forensics" ||
        params.toolBundleId === "review_readonly") &&
      params.usedToolCount === 0
    ) {
      throw new Error(`Sub-agent "${params.description || params.agentId}" did not execute any real tools for bundle "${params.toolBundleId}".`);
    }
    if (
      params.toolBundleId === "repo_forensics" &&
      params.resolvedToolIds?.includes("shell.execute") &&
      params.usedToolCount === 0
    ) {
      throw new Error(`Sub-agent "${params.description || params.agentId}" did not perform the expected repository forensics tool execution.`);
    }
    const spawnValidation = validateSpawnContractResult({
      agentId: params.agentId,
      contract: params.spawnContract,
    });
    if (spawnValidation?.status === "failed" && spawnValidation.effect === "blocked") {
      throw new Error(`Sub-agent "${params.description || params.agentId}" violated the spawn contract: ${spawnValidation.violations.map((violation: AgentSpawnContractViolation) => violation.message).join(" ")}`);
    }
    const text = spawnValidation?.status === "failed" && spawnValidation.effect === "warning"
      ? [
          `[spawn validation warning] ${spawnValidation.violations.map((violation: AgentSpawnContractViolation) => violation.message).join(" ")}`,
          "",
          trimmed,
        ].join("\n")
      : trimmed;
    return { text, spawnValidation };
  };

  type BackgroundSpawnEntry = {
    effectiveAgentId: string;
    parentAgentId: string;
    description: string;
    prompt: string;
    sessionClass: ChildSessionClass;
    toolBundleId?: AgentToolBundleId;
    spawnContract?: AgentSpawnContract;
    spawnPreflight?: AgentSpawnPreflightResult;
    resultContract: AgentResultContract;
    resolvedToolIds?: string[];
    customSystemPrompt?: string;
    customToolIds?: string[];
  };
  const backgroundSpawnTasks = new Map<string, Promise<void>>();

  const ensureSpawnProfile = (params: {
    effectiveAgentId: string;
    sourceAgentId: string;
    description: string;
    customToolIds?: string[];
    defaultLabelPrefix: string;
  }) => {
    if (!profilesById.has(params.effectiveAgentId)) {
      const baseProfile = profilesById.get(params.sourceAgentId) ?? profilesById.get(ORA_ROOT_AGENT_ID);
      if (baseProfile) {
        const customLabel = params.description.length > 30 ? params.description.slice(0, 30) : params.description;
        profilesById.set(params.effectiveAgentId, {
          ...baseProfile,
          id: params.effectiveAgentId,
          label: customLabel || `${params.defaultLabelPrefix} ${subAgentCounter}`,
          ...(params.customToolIds ? { toolIds: params.customToolIds } : {}),
        });
      }
      return;
    }
    if (params.customToolIds) {
      const existing = profilesById.get(params.effectiveAgentId);
      if (existing) {
        profilesById.set(params.effectiveAgentId, { ...existing, toolIds: params.customToolIds });
      }
    }
  };

  const buildInheritedPrompt = (params: {
    prompt: string;
    parentAgentId: string;
    inheritContext?: boolean;
  }): string => {
    if (!params.inheritContext) {
      return params.prompt;
    }
    const invocationContext = latestAgentInvocationContext.get(params.parentAgentId);
    if (!invocationContext?.prompt) {
      return params.prompt;
    }
    return [
      `<inherited-context>`,
      `The parent agent was working on this task:`,
      invocationContext.prompt,
      `</inherited-context>`,
      ``,
      `Your specific subtask:`,
      params.prompt,
    ].join("\n");
  };

  const applySpawnPreflightContext = (prompt: string, preflight?: AgentSpawnPreflightResult): string => {
    if (!preflight || preflight.status !== "degraded") {
      return prompt;
    }
    return [
      "<spawn-preflight>",
      `Requested tool bundle: ${preflight.requestedPreset}`,
      `Resolved preset: ${preflight.resolvedPreset}`,
      `Status: ${preflight.status}`,
      `Missing capabilities: ${preflight.missingCapabilities.join(", ") || "none"}`,
      `Applied degradations: ${preflight.appliedDegradations.join(", ") || "none"}`,
      "Stay within the resolved tool surface and mention any material capability limit if it affects your answer.",
      "</spawn-preflight>",
      "",
      prompt,
    ].join("\n");
  };

  const applySpawnContractContext = (prompt: string, contract?: AgentSpawnContract): string => {
    if (!contract) {
      return prompt;
    }
    const lines = [
      "<spawn-contract>",
      `Contract source: ${contract.source}`,
      `Required affordances: ${contract.requiredAffordances.join(", ") || "none"}`,
      `Side-effect policy: ${contract.sideEffectPolicy ?? "unspecified"}`,
      `Validation policy: ${effectiveValidationPolicyForContract(contract)}`,
      `Result rules: ${contract.resultRules.join(", ") || "none"}`,
    ];
    if (contract.subject) {
      lines.push(`Subject: ${contract.subject.kind}=${contract.subject.normalizedValue ?? contract.subject.value}`);
    }
    if (contract.resourceBindings.length > 0) {
      lines.push(`Resource bindings: ${contract.resourceBindings.map((binding: AgentSpawnContract["resourceBindings"][number]) =>
        binding.locator === "handle"
          ? `${binding.handleKind}#${binding.handleId}`
          : `${binding.kind}=${binding.normalizedValue ?? binding.value}`
      ).join(", ")}`);
    }
    lines.push(
      "Stay bound to the declared subject and resource bindings. If you cannot satisfy the contract with the resolved tools, say so explicitly instead of switching subjects or expanding side effects.",
      "When source_reference_required is present, make sure the result is grounded in the bound subject/resource rather than unrelated prior artifacts.",
      "</spawn-contract>",
      "",
      prompt,
    );
    return lines.join("\n");
  };

  const launchBackgroundSpawn = (entry: BackgroundSpawnEntry): void => {
    const task = (async () => {
      const prevNestedSpawn = isNestedAgentSpawn;
      isNestedAgentSpawn = true;
      const MAX_TITLE_LENGTH = 200;
      const safeTitle = entry.description.length > MAX_TITLE_LENGTH
        ? entry.description.slice(0, MAX_TITLE_LENGTH)
        : entry.description;
      const startedAt = now();
      try {
        updateCollaborationState({
          agentId: entry.effectiveAgentId,
          label: entry.description || agentLabel(entry.effectiveAgentId),
          sessionClass: entry.sessionClass,
          status: "running",
          coordinationBarrier: "independent",
          summary: "后台子 Agent 正在执行任务。",
          delegationKind: "dynamic_spawn",
          authoritySource: "dynamic_spawn",
          toolBundleId: entry.toolBundleId,
          requestedToolPreset: entry.spawnPreflight?.requestedPreset,
          resolvedToolPreset: entry.spawnPreflight?.resolvedPreset,
          resolvedToolIds: entry.resolvedToolIds,
          spawnContract: entry.spawnContract,
          spawnPreflight: entry.spawnPreflight,
          resultContract: entry.resultContract,
        });
        const runtimeCtx = withAgentRuntimeContext(
          entry.customSystemPrompt ?? "",
          { agentId: entry.effectiveAgentId },
          entry.customToolIds,
        );
        const result = await callAgent({
          agentId: entry.effectiveAgentId,
          title: safeTitle,
          prompt: entry.prompt,
          system: entry.customSystemPrompt || runtimeCtx.system,
          riskLevel: "low",
          toolIds: entry.customToolIds,
        });
        const rawText = typeof result === "string" ? result : String(result ?? "");
        const stats = collectChildExecutionStats(entry.effectiveAgentId);
        const durationMs = Math.max(0, now() - startedAt);
        const validated = validateChildResult({
          agentId: entry.effectiveAgentId,
          description: entry.description,
          resultText: rawText,
          resultContract: entry.resultContract,
          spawnContract: entry.spawnContract,
          toolBundleId: entry.toolBundleId,
          resolvedToolIds: entry.resolvedToolIds,
          usedToolCount: stats.usedToolCount,
        });
        kernelRuntimeContext.enqueueAsyncAgentResult({
          targetAgentId: entry.parentAgentId,
          sourceAgentId: entry.effectiveAgentId,
          childSessionId: `${runId}:${entry.effectiveAgentId}`,
          result: validated.text,
          toolBundleId: entry.toolBundleId,
          resolvedToolIds: entry.resolvedToolIds,
          spawnContract: entry.spawnContract,
          spawnValidation: validated.spawnValidation,
          resultContract: entry.resultContract,
          usedToolCount: stats.usedToolCount,
          artifactIds: stats.artifactIds,
          durationMs,
        });
        updateCollaborationState({
          agentId: entry.effectiveAgentId,
          label: entry.description || agentLabel(entry.effectiveAgentId),
          sessionClass: entry.sessionClass,
          status: "succeeded",
          coordinationBarrier: "independent",
          summary: validated.text.trim() || "后台子 Agent 已完成。",
          lastMessage: validated.text.trim() || undefined,
          delegationKind: "dynamic_spawn",
          authoritySource: "dynamic_spawn",
          toolBundleId: entry.toolBundleId,
          requestedToolPreset: entry.spawnPreflight?.requestedPreset,
          resolvedToolPreset: entry.spawnPreflight?.resolvedPreset,
          resolvedToolIds: entry.resolvedToolIds,
          spawnContract: entry.spawnContract,
          spawnPreflight: entry.spawnPreflight,
          spawnValidation: validated.spawnValidation,
          resultContract: entry.resultContract,
          deliveryStatus: "awaiting_pickup",
          usedToolCount: stats.usedToolCount,
          artifactIds: stats.artifactIds,
          durationMs,
        });
      } catch (err) {
        if (isAgentDegradedError(err)) {
          const stats = collectChildExecutionStats(entry.effectiveAgentId);
          const durationMs = Math.max(0, now() - startedAt);
          const text = stripInternalAssistantText(err.degradedOutput).trim() || err.degradedOutput;
          kernelRuntimeContext.enqueueAsyncAgentResult({
            targetAgentId: entry.parentAgentId,
            sourceAgentId: entry.effectiveAgentId,
            childSessionId: `${runId}:${entry.effectiveAgentId}`,
            result: text,
            toolBundleId: entry.toolBundleId,
            resolvedToolIds: entry.resolvedToolIds,
            spawnContract: entry.spawnContract,
            resultContract: entry.resultContract,
            usedToolCount: stats.usedToolCount,
            artifactIds: stats.artifactIds,
            durationMs,
          });
          updateCollaborationState({
            agentId: entry.effectiveAgentId,
            label: entry.description || agentLabel(entry.effectiveAgentId),
            sessionClass: entry.sessionClass,
            status: "succeeded",
            coordinationBarrier: "independent",
            summary: text,
            lastMessage: text,
            delegationKind: "dynamic_spawn",
            authoritySource: "dynamic_spawn",
            toolBundleId: entry.toolBundleId,
            requestedToolPreset: entry.spawnPreflight?.requestedPreset,
            resolvedToolPreset: entry.spawnPreflight?.resolvedPreset,
            resolvedToolIds: entry.resolvedToolIds,
            spawnContract: entry.spawnContract,
            spawnPreflight: entry.spawnPreflight,
            resultContract: entry.resultContract,
            deliveryStatus: "awaiting_pickup",
            usedToolCount: stats.usedToolCount,
            artifactIds: stats.artifactIds,
            durationMs,
          });
        } else {
          const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
          const stats = collectChildExecutionStats(entry.effectiveAgentId);
          const durationMs = Math.max(0, now() - startedAt);
          kernelRuntimeContext.enqueueAsyncAgentResult({
            targetAgentId: entry.parentAgentId,
            sourceAgentId: entry.effectiveAgentId,
            childSessionId: `${runId}:${entry.effectiveAgentId}`,
            result: message,
            toolBundleId: entry.toolBundleId,
            resolvedToolIds: entry.resolvedToolIds,
            spawnContract: entry.spawnContract,
            resultContract: entry.resultContract,
            usedToolCount: stats.usedToolCount,
            artifactIds: stats.artifactIds,
            durationMs,
          });
          updateCollaborationState({
            agentId: entry.effectiveAgentId,
            label: entry.description || agentLabel(entry.effectiveAgentId),
            sessionClass: entry.sessionClass,
            status: options.signal?.aborted ? "cancelled" : "failed",
            coordinationBarrier: "independent",
            summary: message,
            lastMessage: message,
            delegationKind: "dynamic_spawn",
            authoritySource: "dynamic_spawn",
            toolBundleId: entry.toolBundleId,
            requestedToolPreset: entry.spawnPreflight?.requestedPreset,
            resolvedToolPreset: entry.spawnPreflight?.resolvedPreset,
            resolvedToolIds: entry.resolvedToolIds,
            spawnContract: entry.spawnContract,
            spawnPreflight: entry.spawnPreflight,
            resultContract: entry.resultContract,
            deliveryStatus: "awaiting_pickup",
            usedToolCount: stats.usedToolCount,
            artifactIds: stats.artifactIds,
            durationMs,
          });
        }
      } finally {
        kernelRuntimeContext.completeBackgroundChild(entry.parentAgentId, entry.effectiveAgentId);
        backgroundSpawnTasks.delete(entry.effectiveAgentId);
        isNestedAgentSpawn = prevNestedSpawn;
      }
    })();
    backgroundSpawnTasks.set(entry.effectiveAgentId, task);
  };

  const waitForSelectedBackgroundChildren = async (params: {
    parentAgentId: string;
    agentIds?: string[];
    childSessionIds?: string[];
    requireAll?: boolean;
  }) => {
    const requireAll = params.requireAll !== false;
    const filter = {
      agentIds: params.agentIds?.length ? params.agentIds : undefined,
      childSessionIds: params.childSessionIds?.length ? params.childSessionIds : undefined,
    };
    const isSelectedActiveChild = (agentId: string) =>
      (!filter.agentIds || filter.agentIds.includes(agentId)) &&
      (!filter.childSessionIds || filter.childSessionIds.includes(`${runId}:${agentId}`));

    while (true) {
      const pendingResults = kernelRuntimeContext.pendingAsyncAgentResults(params.parentAgentId, filter);
      const activeChildren = kernelRuntimeContext
        .activeBackgroundChildIds(params.parentAgentId)
        .filter((agentId) => isSelectedActiveChild(agentId));
      if (requireAll) {
        if (activeChildren.length === 0) {
          break;
        }
      } else if (pendingResults.length > 0 || activeChildren.length === 0) {
        break;
      }
      await kernelRuntimeContext.waitForBackgroundProgress(params.parentAgentId);
    }

    const results = kernelRuntimeContext.drainAsyncAgentResults(params.parentAgentId, filter);
    return {
      status: results.length > 0 ? "completed" : "idle",
      require_all: requireAll,
      waited_for: {
        agent_ids: filter.agentIds ?? [],
        child_session_ids: filter.childSessionIds ?? [],
      },
      results: results.map((result) => ({
        child_session_id: result.childSessionId,
        agent_id: result.sourceAgentId,
        title: kernelRuntimeContext.childSession(result.sourceAgentId)?.label ?? result.sourceAgentId,
        tool_bundle: result.toolBundleId,
        resolved_tool_ids: result.resolvedToolIds,
        spawn_contract: result.spawnContract,
        spawn_validation: result.spawnValidation,
        result_contract: result.resultContract,
        status: kernelRuntimeContext.childSession(result.sourceAgentId)?.status ?? "succeeded",
        delivery_status: "consumed",
        result_text: result.result,
        used_tool_count: result.usedToolCount,
        artifact_ids: result.artifactIds,
        duration_ms: result.durationMs,
        completed_at: result.completedAt,
      })),
    };
  };

  runtimeToolExecutor.setEnqueueMessage(({ to, message, invokingAgentId }) => {
    kernelRuntimeContext.enqueueAgentMessage(to, message);
    const agentMsg = AgentConversationMessageSchema.parse({
      id: `${runId}:agent-message:${kernelRuntimeContext.agentMessageCount()}`,
      runId,
      createdAt: now(),
      fromAgentId: invokingAgentId || "agent",
      toAgentIds: [to],
      kind: "mention",
      status: "sent",
      content: message,
    });
    kernelRuntimeContext.appendAgentMessage(agentMsg);
    emit(
      "agent.message",
      { message: agentMsg },
      { agentId: agentMsg.fromAgentId, nodeId: agentMsg.fromAgentId },
    );
  });

  runtimeToolExecutor.setWaitForAgents(async ({ agentIds, childSessionIds, requireAll, invokingAgentId }) =>
    waitForSelectedBackgroundChildren({
      parentAgentId: invokingAgentId || ORA_ROOT_AGENT_ID,
      agentIds,
      childSessionIds,
      requireAll,
    })
  );

  runtimeToolExecutor.setSpawnAgent(async ({ description, prompt, agentType, runInBackground, inheritContext, systemPrompt: customSystemPrompt, toolBundle, toolIds: requestedToolIds, resultContract, spawnContract, invokingAgentId }) => {
    const agentId = agentType ?? ORA_ROOT_AGENT_ID;
    if (agentId !== ORA_ROOT_AGENT_ID && !profilesById.has(agentId)) {
      throw new Error(`agent.spawn: unknown agent profile "${agentId}". Available: ${[...profilesById.keys()].join(", ")}`);
    }
    const parentAgentId = invokingAgentId || ORA_ROOT_AGENT_ID;
    const spawnTooling = resolvedSpawnTooling({
      agentId,
      parentAgentId,
      description,
      prompt,
      toolBundle,
      toolIds: requestedToolIds,
      resultContract,
      spawnContract,
    });
    const customToolIds = spawnTooling.resolvedToolIds;
    if (spawnTooling.blockedResult) {
      return spawnTooling.blockedResult;
    }

    if (runInBackground) {
      if (spawnDepth + 1 > MAX_SPAWN_DEPTH) {
        throw new Error(`agent.spawn depth limit (${MAX_SPAWN_DEPTH}) exceeded.`);
      }
      subAgentCounter += 1;
      const queuedAgentId = agentType
        ? `${agentId}#bg-${subAgentCounter}`
        : `ora-sub-async-${subAgentCounter}`;
      const sessionClass = agentType ? "mode_subagent" : "temporary_spawn";
      ensureSpawnProfile({
        effectiveAgentId: queuedAgentId,
        sourceAgentId: agentId,
        description,
        customToolIds,
        defaultLabelPrefix: "Async sub-agent",
      });
      const effectiveAsyncPrompt = buildInheritedPrompt({
        prompt,
        parentAgentId,
        inheritContext,
      });
      const effectiveAsyncPromptWithPreflight = applySpawnContractContext(
        applySpawnPreflightContext(
          effectiveAsyncPrompt,
          spawnTooling.spawnPreflight,
        ),
        spawnTooling.spawnContract,
      );
      updateCollaborationState({
        agentId: queuedAgentId,
        label: description || agentLabel(queuedAgentId),
        sessionClass,
        status: "queued",
        coordinationBarrier: "independent",
        summary: "已进入后台协作队列。",
        delegationKind: "dynamic_spawn",
        authoritySource: "dynamic_spawn",
        toolBundleId: spawnTooling.toolBundleId,
        requestedToolPreset: spawnTooling.spawnPreflight?.requestedPreset,
        resolvedToolPreset: spawnTooling.spawnPreflight?.resolvedPreset,
        resolvedToolIds: customToolIds,
        spawnContract: spawnTooling.spawnContract,
        spawnPreflight: spawnTooling.spawnPreflight,
        resultContract: spawnTooling.resultContract,
      });
      kernelRuntimeContext.registerBackgroundChild(parentAgentId, queuedAgentId);
      launchBackgroundSpawn({
        effectiveAgentId: queuedAgentId,
        parentAgentId,
        description,
        prompt: effectiveAsyncPromptWithPreflight,
        sessionClass,
        toolBundleId: spawnTooling.toolBundleId,
        spawnContract: spawnTooling.spawnContract,
        spawnPreflight: spawnTooling.spawnPreflight,
        resultContract: spawnTooling.resultContract,
        resolvedToolIds: customToolIds,
        customSystemPrompt,
        customToolIds,
      });
      return {
        status: "async_launched",
        agent_id: agentId,
        child_agent_id: queuedAgentId,
        child_session_id: `${runId}:${queuedAgentId}`,
        description,
        tool_bundle: spawnTooling.toolBundleId,
        resolved_tool_ids: customToolIds ?? [],
        spawn_contract: spawnTooling.spawnContract,
        preflight: spawnTooling.spawnPreflight,
        result_contract: spawnTooling.resultContract,
      };
    }

    // Assign a unique agent ID so the sub-agent's guard doesn't see the
    // parent's in-progress agent.spawn tool call as pending work.
    subAgentCounter += 1;
    const effectiveAgentId = agentType
      ? `${agentId}#sync-${subAgentCounter}`
      : `ora-sub-${subAgentCounter}`;
    if (agentType && agentId !== ORA_ROOT_AGENT_ID && !profilesById.has(agentId)) {
      throw new Error(`agent.spawn: unknown agent profile "${agentId}". Available: ${[...profilesById.keys()].join(", ")}`);
    }
    ensureSpawnProfile({
      effectiveAgentId,
      sourceAgentId: agentId,
      description,
      customToolIds,
      defaultLabelPrefix: "Sub-agent",
    });
    updateCollaborationState({
      agentId: effectiveAgentId,
      label: description || agentLabel(effectiveAgentId),
      sessionClass: agentType ? "mode_subagent" : "temporary_spawn",
      status: "running",
      coordinationBarrier: "required",
      summary: "子 Agent 正在执行任务。",
      delegationKind: "dynamic_spawn",
      authoritySource: "dynamic_spawn",
      toolBundleId: spawnTooling.toolBundleId,
      requestedToolPreset: spawnTooling.spawnPreflight?.requestedPreset,
      resolvedToolPreset: spawnTooling.spawnPreflight?.resolvedPreset,
      resolvedToolIds: customToolIds,
      spawnContract: spawnTooling.spawnContract,
      spawnPreflight: spawnTooling.spawnPreflight,
      resultContract: spawnTooling.resultContract,
    });

    spawnDepth += 1;
    if (spawnDepth > MAX_SPAWN_DEPTH) {
      spawnDepth -= 1;
      throw new Error(`agent.spawn depth limit (${MAX_SPAWN_DEPTH}) exceeded.`);
    }
    const prevNestedSpawn = isNestedAgentSpawn;
    isNestedAgentSpawn = true;
    const startedAt = now();
    try {
      const wasAlreadyActive = kernelRuntimeContext.activeAgents.includes(effectiveAgentId);
      const runtimeCtx = withAgentRuntimeContext(
        customSystemPrompt ?? "",
        { agentId: effectiveAgentId },
        customToolIds,
      );
      const MAX_TITLE_LENGTH = 200;
      const safeTitle = description.length > MAX_TITLE_LENGTH
        ? description.slice(0, MAX_TITLE_LENGTH)
        : description;

      const effectiveSubPrompt = buildInheritedPrompt({
        prompt,
        parentAgentId,
        inheritContext,
      });
      const effectiveSubPromptWithPreflight = applySpawnContractContext(
        applySpawnPreflightContext(
          effectiveSubPrompt,
          spawnTooling.spawnPreflight,
        ),
        spawnTooling.spawnContract,
      );

      let result: unknown;
      try {
        result = await callAgent({
          agentId: effectiveAgentId,
          title: safeTitle,
          prompt: effectiveSubPromptWithPreflight,
          system: customSystemPrompt || runtimeCtx.system,
          riskLevel: "low",
          toolIds: customToolIds,
        });
      } catch (caught) {
        if (isAgentDegradedError(caught)) {
          result = caught.degradedOutput;
        } else {
          updateCollaborationState({
            agentId: effectiveAgentId,
            label: description || agentLabel(effectiveAgentId),
            sessionClass: agentType ? "mode_subagent" : "temporary_spawn",
            status: "failed",
            coordinationBarrier: "required",
            summary: caught instanceof Error ? caught.message : String(caught),
            lastMessage: caught instanceof Error ? caught.message : String(caught),
            delegationKind: "dynamic_spawn",
            authoritySource: "dynamic_spawn",
            toolBundleId: spawnTooling.toolBundleId,
            requestedToolPreset: spawnTooling.spawnPreflight?.requestedPreset,
            resolvedToolPreset: spawnTooling.spawnPreflight?.resolvedPreset,
            resolvedToolIds: customToolIds,
            spawnContract: spawnTooling.spawnContract,
            spawnPreflight: spawnTooling.spawnPreflight,
            resultContract: spawnTooling.resultContract,
            usedToolCount: collectChildExecutionStats(effectiveAgentId).usedToolCount,
            durationMs: Math.max(0, now() - startedAt),
          });
          throw caught;
        }
      }
      if (wasAlreadyActive) {
        kernelRuntimeContext.activateAgent(effectiveAgentId);
      }
      const rawText = typeof result === "string" ? result : String(result ?? "");
      const stats = collectChildExecutionStats(effectiveAgentId);
      const durationMs = Math.max(0, now() - startedAt);
      try {
        const validated = validateChildResult({
          agentId: effectiveAgentId,
          description,
          resultText: rawText,
          resultContract: spawnTooling.resultContract,
          spawnContract: spawnTooling.spawnContract,
          toolBundleId: spawnTooling.toolBundleId,
          resolvedToolIds: customToolIds,
          usedToolCount: stats.usedToolCount,
        });
        updateCollaborationState({
          agentId: effectiveAgentId,
          label: description || agentLabel(effectiveAgentId),
          sessionClass: agentType ? "mode_subagent" : "temporary_spawn",
          status: "succeeded",
          coordinationBarrier: "required",
          summary: validated.text.trim() || "子 Agent 已完成。",
          lastMessage: validated.text.trim() || undefined,
          delegationKind: "dynamic_spawn",
          authoritySource: "dynamic_spawn",
          toolBundleId: spawnTooling.toolBundleId,
          requestedToolPreset: spawnTooling.spawnPreflight?.requestedPreset,
          resolvedToolPreset: spawnTooling.spawnPreflight?.resolvedPreset,
          resolvedToolIds: customToolIds,
          spawnContract: spawnTooling.spawnContract,
          spawnPreflight: spawnTooling.spawnPreflight,
          spawnValidation: validated.spawnValidation,
          resultContract: spawnTooling.resultContract,
          usedToolCount: stats.usedToolCount,
          artifactIds: stats.artifactIds,
          durationMs,
        });
        return validated.text;
      } catch (caught) {
        updateCollaborationState({
          agentId: effectiveAgentId,
          label: description || agentLabel(effectiveAgentId),
          sessionClass: agentType ? "mode_subagent" : "temporary_spawn",
          status: "failed",
          coordinationBarrier: "required",
          summary: caught instanceof Error ? caught.message : String(caught),
          lastMessage: caught instanceof Error ? caught.message : String(caught),
          delegationKind: "dynamic_spawn",
          authoritySource: "dynamic_spawn",
          toolBundleId: spawnTooling.toolBundleId,
          requestedToolPreset: spawnTooling.spawnPreflight?.requestedPreset,
          resolvedToolPreset: spawnTooling.spawnPreflight?.resolvedPreset,
          resolvedToolIds: customToolIds,
          spawnContract: spawnTooling.spawnContract,
          spawnPreflight: spawnTooling.spawnPreflight,
          resultContract: spawnTooling.resultContract,
          usedToolCount: stats.usedToolCount,
          artifactIds: stats.artifactIds,
          durationMs,
        });
        throw caught;
      }
    } finally {
      spawnDepth -= 1;
      isNestedAgentSpawn = prevNestedSpawn;
    }
  });

  const continuationWithActiveFrameStatus = (status: "completed" | "failed" | "resuming" | "awaiting_model") => {
    const continuation = options.resumeState?.continuation;
    const activeFrameId = continuation?.activeFrameId;
    if (!continuation || !activeFrameId) {
      return continuation;
    }
    return {
      activeFrameId,
      frames: continuation.frames.map((frame) =>
        frame.id === activeFrameId
          ? {
              ...frame,
              status,
              pendingActionIds: status === "completed" ? [] : frame.pendingActionIds,
              pendingToolCallIds: status === "completed" ? [] : frame.pendingToolCallIds,
              pendingClarificationIds: status === "completed" ? [] : frame.pendingClarificationIds,
              approvedActionIds: [
                ...new Set([
                  ...frame.approvedActionIds,
                  ...(options.resumeContext?.approvedActionIds ?? []),
                ]),
              ],
              updatedAt: now(),
            }
          : frame
      ),
    };
  };

  const resumeSuspendedRuntimeFrame = async (params?: { title?: string }): Promise<{
    frame: NonNullable<typeof suspendedFrameDecision>["frame"];
    agentId: string;
    nodeId: string;
    text: string;
  } | undefined> => {
    const decision = suspendedFrameDecision;
    if (!decision) {
      return undefined;
    }

    const frame = decision.frame;
    const agentId = decision.agentId;
    const nodeId = decision.nodeId;
    const title = params?.title ?? `Continue ${agentLabel(agentId)}`;
    kernelRuntimeContext.activateAgent(agentId);
    setTopologyStatus(agentId, "running");
    emit("agent.started", { title, planItemId: frame.planItemId }, { agentId, nodeId });
    const runtimePromptContext = withAgentRuntimeContext(
      [
        "You are resuming a paused Ora runtime frame.",
        "Continue from the provided conversation and tool results.",
        "Do not restart earlier mode stages or repeat completed work.",
      ].join("\n"),
      { agentId, nodeId },
    );
    const response = await runNodeRuntimeLoopForAgent({
      runId,
      agentId,
      nodeId,
      title,
      prompt: promptWithTurnLocalMetadata([
        "Continue the suspended runtime frame.",
        "Use the conversation follow-up and runtime state to complete only the remaining work.",
        "If the plan list is incomplete, update it with plan.update before finishing.",
      ].join("\n"), turnLocalMetadata),
      system: runtimePromptContext.system,
      providerCache: runtimePromptContext.stablePrefix
        ? { stableSystemPrefix: runtimePromptContext.stablePrefix }
        : undefined,
      cacheDiagnosticsContext: {
        derivedContextBlocks: runtimePromptContext.cacheDiagnosticsContext.derivedContextBlocks,
      },
      toolIds: effectiveAgentToolIds(agentId, nodeId),
      timeoutMs:
        resolvedModeSpec.nodes.find((n) => n.id === nodeId)?.config.timeoutMs ??
        DEFAULT_NODE_TIMEOUT_MS,
    });

    emit(
      "message.delta",
      {
        role: "assistant",
        messageId: assistantMessageId({ agentId, nodeId, suffix: "continuation" }),
        content: response.text,
        streaming: false,
        phase: "final",
      },
      { agentId, nodeId },
    );
    emit("agent.completed", { title }, { agentId, nodeId });
    kernelRuntimeContext.deactivateAgent(agentId);
    setTopologyStatus(agentId, "done");
    const memoryRecord = memoryService.remember({
      id: `${agentId}-continuation-memory`,
      namespace: ["session", projectId, resolvedModeSpec.family, "continuation", agentId],
      kind: "session",
      value: { summary: response.text, resumedFrameId: frame.id },
    });
    emit("memory.updated", { record: memoryRecord });
    return { frame, agentId, nodeId, text: response.text };
  };

  const resumeSuspendedFrameIfNeeded = async (): Promise<StateSnapshot | undefined> => {
    if (!suspendedFrameDecision || shouldResumeSuspendedFrameInModeDriver) {
      return undefined;
    }

    let resumed;
    try {
      resumed = await resumeSuspendedRuntimeFrame();
    } catch (error) {
      if (
        isApprovalInterruptError(error) ||
        isClarificationInterruptError(error)
      ) {
        const reason =
          isClarificationInterruptError(error)
            ? "clarification_required"
            : "approval_required";
        setTopologyStatus(ORA_ROOT_AGENT_ID, "blocked");
        emit("run.interrupted", {
          error: error instanceof Error ? error.message : String(error),
          status: "interrupted",
          reason,
          clarificationId:
            isClarificationInterruptError(error) && error.clarifications.length === 1
              ? error.clarification.id
              : undefined,
          clarificationIds:
            isClarificationInterruptError(error)
              ? error.clarifications.map((c) => c.id)
              : undefined,
          actionId:
            isApprovalInterruptError(error) ? error.actionId : undefined,
        });
        skillRegistry.flushTelemetry();
        skillRegistry.evaluateCuratorIfDue();
        autoGenService.analyzeRun(runId, "interrupted", kernelRuntimeContext.toolCalls);
        promptCache.saveSnapshot();
        return kernelRuntimeContext.assembleFinalSnapshot({
          status: "interrupted",
          input,
          config,
          modeSpec: resolvedModeSpec,
          profiles,
          memory: memoryService.list(),
          plan: planService.list(),
          todos: todoService.list(),
          actions: actionLedger.list(),
          conversation: options.resumeState?.conversation ?? [],
          toolResults: options.resumeState?.toolResults ?? [],
          checkpoint: createResumeCheckpoint({
            runId,
            index: 0,
            now: now(),
            eventSeq: kernelRuntimeContext.eventCount(),
            stateHash: undefined,
          }),
          previousContinuation: continuationWithActiveFrameStatus("awaiting_model") ?? options.resumeState?.continuation,
          conversationCursor: options.resumeState?.conversation.length ?? 0,
          output: { text: "", pattern: resolvedModeSpec.family, modeId: resolvedModeSpec.id },
          updatedAt: now(),
        });
      }
      throw error;
    }
    if (!resumed) {
      return undefined;
    }
    const { text } = resumed;
    const output = {
      text,
      pattern: resolvedModeSpec.family,
      modeId: resolvedModeSpec.id,
      ...(resolvedModeSpec.family === "orchestrator_subagent"
        ? { orchestrator: { plan: text } }
        : {}),
    };
    // Shared terminal-state integrity gate for the resumed-frame path:
    // refuse to finalize if unresolved approvals, tool calls, or
    // continuation frames remain.
    const pendingApprovalActions = actionLedger.list()
      .filter((action) => action.status === "approval_required");
    const resumeGates: { gateId: string; kind: "clarification" | "approval" | "plan_decision"; status: "open" | "resolved" }[] = [];
    for (const pc of kernelRuntimeContext.pendingClarifications) {
      resumeGates.push({ gateId: pc.id, kind: "clarification" as const, status: "open" as const });
    }
    if (pendingApprovalActions.length > 0) {
      resumeGates.push({ gateId: `${runId}:approval`, kind: "approval" as const, status: "open" as const });
    }
    const resumeAssertInput = {
      actions: actionLedger.list(),
      toolCalls: kernelRuntimeContext.toolCalls,
      pendingApprovals: pendingApprovalActions.map((action) => action.id),
      pendingClarifications: kernelRuntimeContext.pendingClarifications,
      continuation: continuationWithActiveFrameStatus("completed") ?? options.resumeState?.continuation ?? { frames: [] },
      planList: kernelRuntimeContext.planList,
      plan: planService.list(),
      todos: todoService.list(),
      gates: resumeGates,
    };
    try {
      assertRunCanBecomeTerminal(resumeAssertInput);
    } catch (caught) {
      if (caught instanceof TerminalStateIntegrityError) {
        emit("run.failed", {
          status: "failed",
          error: caught.message,
          output: { text: caught.message, pattern: resolvedModeSpec.family, modeId: resolvedModeSpec.id },
        });
        return kernelRuntimeContext.assembleFinalSnapshot({
          status: "failed",
          input,
          config,
          modeSpec: resolvedModeSpec,
          profiles,
          memory: memoryService.list(),
          plan: planService.list(),
          todos: todoService.list(),
          actions: actionLedger.list(),
          conversation: options.resumeState?.conversation ?? [],
          toolResults: options.resumeState?.toolResults ?? [],
          checkpoint: createResumeCheckpoint({
            runId,
            index: 0,
            now: now(),
            eventSeq: kernelRuntimeContext.eventCount(),
            stateHash: caught.message,
          }),
          previousContinuation: continuationWithActiveFrameStatus("completed"),
          conversationCursor: options.resumeState?.conversation.length ?? 0,
          output: { text: caught.message, pattern: resolvedModeSpec.family, modeId: resolvedModeSpec.id },
          updatedAt: now(),
        });
      }
      throw caught;
    }

    skillRegistry.flushTelemetry();
    skillRegistry.evaluateCuratorIfDue();
    const autoGenAction = autoGenService.analyzeRun(runId, "succeeded", kernelRuntimeContext.toolCalls);
    promptCache.saveSnapshot();
    emit("run.done", { status: "succeeded", output });
    if (autoGenAction) {
      autoGenService.executeCreation(autoGenAction, config).catch(() => {
        // fire-and-forget: errors are logged inside executeCreation
      });
    }
    const checkpoint = createResumeCheckpoint({
      runId,
      index: 0,
      now: now(),
      eventSeq: kernelRuntimeContext.eventCount(),
      stateHash: JSON.stringify(output),
    });
    emit(
      "checkpoint.created",
      {
        checkpoint,
        summary: "Runtime checkpoint captured from a resumed continuation frame.",
      },
      { checkpointId: checkpoint.id },
    );
    planService.attachCheckpoint(checkpoint.id);
    return kernelRuntimeContext.assembleFinalSnapshot({
      status: "succeeded",
      input,
      config,
      modeSpec: resolvedModeSpec,
      profiles,
      memory: memoryService.list(),
      plan: planService.list().map((item) => ({ ...item, status: "done" as const })),
      todos: todoService.list().map((item) => ({ ...item, status: "done" as const })),
      actions: actionLedger.list(),
      conversation: options.resumeState?.conversation ?? [],
      toolResults: options.resumeState?.toolResults ?? [],
      checkpoint,
      previousContinuation: continuationWithActiveFrameStatus("completed"),
      conversationCursor: options.resumeState?.conversation.length ?? 0,
      output,
      updatedAt: now(),
    });
  };

  const resumeSuspendedNode = async (params: { nodeId: string; agentId: string; title: string }): Promise<unknown | undefined> => {
    if (!shouldResumeSuspendedFrameInModeDriver || !suspendedFrameDecision || suspendedFrameConsumedByMode) {
      return undefined;
    }
    if (params.nodeId !== suspendedFrameDecision.nodeId) {
      return undefined;
    }
    suspendedFrameConsumedByMode = true;
    const resumed = await resumeSuspendedRuntimeFrame({ title: params.title });
    if (!resumed) {
      return undefined;
    }
    const completedContinuation = continuationWithActiveFrameStatus("completed");
    if (options.resumeState && completedContinuation) {
      options.resumeState = {
        ...options.resumeState,
        continuation: completedContinuation,
      };
    }
    return resumed.text;
  };

  const remember = (params: {
    id: string;
    namespace: string[];
    kind: "profile" | "project" | "session" | "worker" | "artifact";
    value: unknown;
    sourceActionId?: string;
  }) => {
    const record = memoryService.remember(params);
    emit("memory.updated", { record });
  };

  const captureMemory = (params: {
    id: string;
    namespace: string[];
    kind: MemoryKind;
    value: unknown;
    sourceActionId?: string;
  }) => {
    const queued = memoryCaptureQueue.enqueue(params);
    emit("memory.queued", {
      entry: {
        id: queued.id,
        namespace: queued.namespace,
        kind: queued.kind,
      },
      pending: memoryCaptureQueue.size(),
    });
  };

  const publishArtifact = (params: {
    id: string;
    label: string;
    kind?: "report" | "file" | "log";
    mimeType?: string;
    payload: unknown;
  }) => {
    const artifact = ArtifactRefSchema.parse({
      id: `${runId}:artifact:${params.id}`,
      runId,
      kind: params.kind ?? "log",
      label: params.label,
      mimeType: params.mimeType ?? "application/json",
      createdAt: now(),
      payload: params.payload,
    });
    kernelRuntimeContext.appendArtifact(artifact);
    emit("artifact.exported", { artifact });
  };

  const publishFileChangeArtifact = (
    fileChange: RuntimeFileChangeMetadata,
    context: { agentId?: string; nodeId?: string; actionId?: string },
  ) => {
    const artifact = fileChangeArtifact({
      runId,
      artifactIndex: kernelRuntimeContext.artifactCount(),
      fileChange,
      createdAt: now(),
    });
    kernelRuntimeContext.appendArtifact(artifact);
    emit(
      "artifact.exported",
      { artifact, actionId: context.actionId },
      { agentId: context.agentId, nodeId: context.nodeId },
    );
    return artifact;
  };

  const ensureClarification = async (params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options?: PendingClarificationOption[];
    narrate?: boolean;
  }) => {
    return ensureRuntimeClarification(params, {
      answer: clarificationAnswer,
      pendingClarifications: kernelRuntimeContext.pendingClarifications,
      now,
      emit,
      resumeClarifications: options.resumeContext?.clarifications,
    });
  };

  const ensureClarifications = async (
    requests: Array<{
      id: string;
      key: string;
      nodeId: string;
      nodeLabel: string;
      question: string;
      options?: PendingClarificationOption[];
      narrate?: boolean;
    }>,
  ) => {
    return ensureRuntimeClarifications(requests, {
      answer: clarificationAnswer,
      pendingClarifications: kernelRuntimeContext.pendingClarifications,
      now,
      emit,
      resumeClarifications: options.resumeContext?.clarifications,
    });
  };

  const runRecoverableNode = async <T>(
    params: {
      nodeId: string;
      nodeTemplate: string;
      nodeLabel: string;
      agentId?: string;
    },
    execute: () => Promise<T>,
  ): Promise<
    { status: "completed"; output: T } | { status: "skipped"; output?: unknown }
  > => {
    return runRecoverableRuntimeNode(params, execute, {
      recoveryCoordinator,
      emitRecoveryDecision,
      publishRecoveryArtifact,
      sleep,
      emit,
    });
  };

  const runDelegatedTask = async <T>(
    params: {
      taskId: string;
      nodeId: string;
      nodeLabel: string;
      agentId: string;
      title: string;
    },
    execute: () => Promise<T>,
  ): Promise<T> => {
    return runRuntimeDelegatedTask(params, execute, {
      emit,
    });
  };

  const checkpointNode = (params: {
    nodeId: string;
    nodeTemplate: string;
    nodeLabel: string;
    agentId?: string;
    status: "started" | "completed" | "failed" | "skipped";
    bag: Record<string, unknown>;
    output?: unknown;
  }) => {
    const checkpoint = {
      modeId: resolvedModeSpec.id,
      agentId: params.agentId,
      nodeId: params.nodeId,
      planItemId: params.nodeId,
      eventSeq: kernelRuntimeContext.latestEventSeq(),
      conversationCursor: options.resumeState?.conversation.length ?? 0,
      bag: params.bag,
    };
    emit("node.updated", {
      nodeId: params.nodeId,
      nodeTemplate: params.nodeTemplate,
      nodeLabel: params.nodeLabel,
      status: params.status,
      output: params.output,
      checkpoint,
    }, { agentId: params.agentId, nodeId: params.nodeId });
  };

  const publishMessage = (params: {
    agentId: string;
    topic: string;
    correlationId: string;
    summary: string;
    payload: unknown;
  }) => {
    const { queueSummary, busStats } = kernelRuntimeContext.recordBusPublished(params.topic);
    emit("message.published", params, {
      agentId: params.agentId,
      nodeId: params.agentId,
    });
    emit("queue.updated", { summary: queueSummary, busStats });
  };

  const routeMessage = (params: {
    agentId: string;
    fromTopic: string;
    toTopic: string;
    correlationId: string;
    summary: string;
  }) => {
    const { queueSummary, busStats } = kernelRuntimeContext.recordBusRouted(params.toTopic);
    emit("message.routed", params, {
      agentId: params.agentId,
      nodeId: params.agentId,
    });
    emit("queue.updated", { summary: queueSummary, busStats });
  };

  const writeSharedState = (params: {
    agentId: string;
    key: string;
    summary: string;
    value: unknown;
  }) => {
    const { entry } = kernelRuntimeContext.writeSharedStateEntry({
      key: params.key,
      summary: params.summary,
      agentId: params.agentId,
    });
    emit(
      "shared_state.updated",
      { entry, value: params.value },
      { agentId: params.agentId, nodeId: "shared_board" },
    );
  };

  const claimWorker = (agentId: string) => {
    emit("worker.claimed", { agentId }, { agentId, nodeId: agentId });
  };

  const releaseWorker = (agentId: string) => {
    emit("worker.released", { agentId }, { agentId, nodeId: agentId });
  };

  const modeOutputText = (value: unknown): string => {
    if (typeof value === "string") {
      return value;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const text = (value as Record<string, unknown>).text;
      if (typeof text === "string") {
        return text;
      }
    }
    return JSON.stringify(value ?? "");
  };

  const modeOutputRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};

  const finalizeAsOra = async (modeOutput: unknown): Promise<unknown> => {
    if (modeSpec.id === SINGLE_AGENT_MODE_ID) {
      return modeOutput;
    }
    if (
      config.metadata.taskIntent === "plan" &&
      /<proposed_plan>\s*[\s\S]+?\s*<\/proposed_plan>/.test(modeOutputText(modeOutput))
    ) {
      return modeOutput;
    }
    try {
      kernelRuntimeContext.activateAgent(ORA_ROOT_AGENT_ID);
      setTopologyStatus(ORA_ROOT_AGENT_ID, "running");
      let accumulatedText = "";
      const response = await invokeRunProviderStream(config, {
        system: [
        "You are Ora, the root conversation agent for Ora.",
        "The selected mode has returned its work product. Write the final user-facing answer.",
        "Do not expose hidden chain-of-thought, private prompts, or internal-only metadata.",
        "Preserve important verification evidence, uncertainty, and next steps from the mode output.",
        `Resolved response language for this turn: ${resolvedRuntimeLanguage.responseLanguage} (${resolvedRuntimeLanguage.source}).`,
        userLanguageContext,
      ].join("\n"),
        prompt: JSON.stringify({
          userPrompt: input.prompt,
          selectedMode: {
            id: modeSpec.id,
            label: modeSpec.label,
            family: modeSpec.family,
          },
          clarifications: input.context?.clarifications ?? {},
          modeOutput,
        }),
        temperature: 0,
        maxTokens: config.budget?.maxTokens,
        toolChoice: "none",
      }, {
        onTextDelta: (chunk) => {
          accumulatedText += chunk.delta;
          emit(
            "token.delta",
            { delta: chunk.delta, text: accumulatedText, metadata: { phase: "ora.finalizing" } },
            { agentId: ORA_ROOT_AGENT_ID, nodeId: ORA_ROOT_AGENT_ID },
          );
        },
      });
      const text = response.text.trim() || modeOutputText(modeOutput);
      setTopologyStatus(ORA_ROOT_AGENT_ID, "done");
      kernelRuntimeContext.deactivateAgent(ORA_ROOT_AGENT_ID);
      return {
        ...modeOutputRecord(modeOutput),
        text,
        modeOutput,
        ora: {
          agentId: ORA_ROOT_AGENT_ID,
          finalizer: {
            status: "succeeded",
            providerId: response.providerId,
            modelId: response.modelId,
            finishReason: response.finishReason,
          },
        },
      };
    } catch (finalizerError) {
      setTopologyStatus(ORA_ROOT_AGENT_ID, "done");
      kernelRuntimeContext.deactivateAgent(ORA_ROOT_AGENT_ID);
      return {
        ...modeOutputRecord(modeOutput),
        text: modeOutputText(modeOutput),
        modeOutput,
        ora: {
          agentId: ORA_ROOT_AGENT_ID,
          finalizer: {
            status: "fallback",
            error: finalizerError instanceof Error ? finalizerError.message : String(finalizerError),
          },
        },
      };
    }
  };

  const kernelPatternExecutionContextAdapter =
    createKernelPatternExecutionContextAdapter({
      projectId,
      queueSummary: () => kernelRuntimeContext.queueSummary,
      sharedStateSummary: () => kernelRuntimeContext.sharedStateSummary,
      busStats: () => kernelRuntimeContext.busStats,
      responseLanguage: () => resolvedRuntimeLanguage.responseLanguage,
      modeResume,
      systemPrompt,
      setPlanStatus,
      setQueueSummary: (patch) => {
        const queueSummary = kernelRuntimeContext.updateQueueSummary(patch);
        emit("queue.updated", { summary: queueSummary, busStats: kernelRuntimeContext.busStats });
      },
      checkpointNode,
      runRecoverableNode,
      runDelegatedTask,
      ensureClarification,
      claimWorker,
      releaseWorker,
      agentLabel,
      resumeSuspendedNode,
      callAgent,
      remember,
      captureMemory,
      publishArtifact,
      publishMessage,
      routeMessage,
      emitAgentMessage,
      writeSharedState,
      currentSharedState: () => kernelRuntimeContext.sharedStateSummary,
    });

  const suspendedSnapshot = await resumeSuspendedFrameIfNeeded();
  if (suspendedSnapshot) {
    return { snapshot: suspendedSnapshot, tools };
  }

  const snapshot = await new KernelRunner(createKernelRunnerDeps({
    request: {
      input,
      config,
      options,
    },
    runtime: {
      kernelRuntimeContext,
      emit,
    },
    start: {
      skills,
      tools,
      profiles,
    },
    progress: {
      emitPlanUpdated,
      emitTodoUpdated,
    },
    topology: {
      setTopologyStatus,
    },
    stores: {
      planService,
      todoService,
    },
    execution: {
      executeModeSpec,
      kernelPatternExecutionContextAdapter,
      resolvedModeSpec,
      resolvedDefinition,
    },
    preflight: {
      clarificationAnswer,
      requestIntentClarificationQuestion,
      extractCausalTaskState: (params: ExtractCausalTaskStateParams) => extractCausalTaskState(params, { invokeProvider: invokeRunProvider }),
      ensureClarification,
      rootTopology,
      emitOraObservation,
      agentLabel,
    },
    finalization: {
      inferCompletionStopReason,
      modeProgressFinalizationError,
      outputWithCompletionMetadata,
      completionMetadata,
      finalizeAsOra,
      incompleteForcedFinalError,
      assertTerminalState: () => {
        const actions = actionLedger.list();
        const pendingApprovalActions = actions.filter((action) => action.status === "approval_required");
        const pendingApprovals = pendingApprovalActions.map((action) => action.id);
        const pendingToolCalls = kernelRuntimeContext.toolCalls.filter((call) =>
          call.actionId && pendingApprovals.includes(call.actionId)
        );
        const previousContinuation = options.resumeState?.continuation;
        const { continuation } = kernelRuntimeContext.assembleContinuation({
          previous: previousContinuation,
          status: "running" as const,
          actions,
          conversationCursor: options.resumeState?.conversation.length ?? 0,
          now: now(),
        });
        const gateRecords: { gateId: string; kind: "clarification" | "approval" | "plan_decision"; status: "open" | "resolved" }[] = [];
        for (const pc of kernelRuntimeContext.pendingClarifications) {
          gateRecords.push({ gateId: pc.id, kind: "clarification" as const, status: "open" as const });
        }
        if (pendingApprovals.length > 0) {
          gateRecords.push({ gateId: `${runId}:approval`, kind: "approval" as const, status: "open" as const });
        }
        return {
          actions,
          toolCalls: kernelRuntimeContext.toolCalls,
          pendingApprovals,
          pendingClarifications: kernelRuntimeContext.pendingClarifications,
          continuation,
          planList: kernelRuntimeContext.planList,
          plan: planService.list(),
          todos: todoService.list(),
          activeBackgroundChildCount: kernelRuntimeContext.activeBackgroundChildCount(ORA_ROOT_AGENT_ID),
          pendingAsyncResultCount: kernelRuntimeContext.pendingAsyncAgentResultCount(ORA_ROOT_AGENT_ID),
          gates: gateRecords,
        };
      },
    },
    memory: {
      memoryCaptureQueue,
      memoryService,
    },
    checkpoint: {
      runId,
      checkpointLabelForStatus,
      now,
      actionLedger,
    },
  })).run();

  skillRegistry.flushTelemetry();
  skillRegistry.evaluateCuratorIfDue();
  const autoGenAction = autoGenService.analyzeRun(runId, snapshot.status, kernelRuntimeContext.toolCalls);
  promptCache.saveSnapshot();
  if (autoGenAction) {
    autoGenService.executeCreation(autoGenAction, config).catch(() => {
      // fire-and-forget: errors are logged inside executeCreation
    });
  }

  return {
    snapshot,
    tools,
  };
}
