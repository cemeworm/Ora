import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ArtifactRef,
  CheckpointMeta,
  AgentCatalogResult,
  CustomAgentCheckNameResult,
  CustomAgentCreateParams,
  CustomAgentDetail,
  CustomAgentGenerateDraftParams,
  CustomAgentGenerateDraftResult,
  CustomAgentSummary,
  CustomAgentUpdateParams,
  CustomAgentCreateParamsSchema,
  deriveRunAttention,
  EvaluationConfigSummary,
  EvaluationFeedbackRecord,
  EvaluationSpecSchema,
  SelfIterationCandidate,
  SelfIterationCuratorTrigger,
  MODE_STUDIO_BUILDER_MODE_ID,
  ModeStudioApplyDraftParamsSchema,
  ModeStudioApplyDraftResult,
  ModeStudioApplyDraftResultSchema,
  ModeStudioBuilderResult,
  ModeStudioBuilderResultParamsSchema,
  ModeStudioContextResult,
  ModeStudioContextResultSchema,
  ModeStudioDraftBundle,
  ModeStudioGenerateDraftParams,
  ModeStudioGenerateDraftParamsSchema,
  ModeStudioRefineDraftParamsSchema,
  ModeStudioStartBuilderRunParams,
  ModeStudioStartBuilderRunParamsSchema,
  ModeStudioValidateDraftParamsSchema,
  modeSpecToPatternDefinition,
  MVP_MODE_RUNTIME_ATOMS,
  MVP_PATTERNS,
  type ModeCreateParams,
  type ModeSpec,
  type ModeUpdateParams,
  type ModeValidationResult,
  OraEventEnvelope,
  OraEventEnvelopeSchema,
  PatternDefinition,
  ProjectDetail,
  ProjectFileReadResult,
  ProjectFilesResult,
  ProjectSignal,
  ProjectSignalSchema,
  ProjectSummary,
  ProjectSummarySchema,
  RuntimeMaintenanceParamsSchema,
  RuntimeWorkbenchBootstrapSchema,
  type RuntimeBootstrap,
  type RuntimeWorkbenchBootstrap,
  type RuntimeAcceptedPlanHandoff,
  RunConfig,
  RunConfigSchema,
  RunEventStream,
  RunEventStreamSchema,
  RunReplayParamsSchema,
  SINGLE_AGENT_MODE_ID,
  RunForkParamsSchema,
  RunHandle,
  type RunLatencyMark,
  RunStreamParamsSchema,
  RunTrail,
  RunTrailParamsSchema,
  RunTrailSchema,
  RunSummary,
  SessionBranchGroup,
  SessionBranchGroupAdoptParamsSchema,
  SessionBranchGroupCreateParamsSchema,
  SessionBranchGroupDismissParamsSchema,
  SessionBranchGroupGetParamsSchema,
  SessionBranchGroupListParamsSchema,
  SessionBranchGroupSchema,
  SessionDetail,
  SessionSummary,
  SessionSummarySchema,
  SessionTranscriptMessage,
  SessionTranscriptMessageSchema,
  SessionTurn,
  SkillCheckNameResult,
  SkillCreateParams,
  SkillDetail,
  SkillFileDeleteParams,
  SkillFileGetParams,
  SkillFileUpsertParams,
  SkillPackageFileContent,
  SkillRegistry,
  SkillSetEnabledParams,
  SkillUpdateParams,
  SelfIterationEnvironmentObserverPolicy,
  extractCompleteProposedPlanContent,
  snapshotContainsCompleteProposedPlan,
  StateSnapshot,
  StateSnapshotSchema,
  SystemAgentOverride,
  SystemAgentOverrideResetParamsSchema,
  SystemAgentOverrideUpdateParamsSchema,
  SystemAgentOverrideUpdateParams,
  UserTaskInput,
  UserTaskInputSchema,
  deriveRunSnapshot,
  deriveSessionProjection,
  type RuntimeSessionEntry,
  type RuntimeSessionEntryType,
  type RuntimeSessionLedger,
} from "@cemeworm/shared";
import { AutomationService } from "./automation-service.js";
import { TodoService } from "./capabilities.js";
import type { ChannelSessionUpdateEvent } from "./channels/manager.js";
import { ChannelService } from "./channels/service.js";
import {
  activeUsageForMessages,
  buildLocalCompactionRequest,
  compactedContextFromSummary,
  contextMessages,
  normalizeContextState,
  resolveAutoCompactTokenLimit,
  resolvedContextWindow,
  resolveRunProviderConfig,
  shouldCompactContext,
} from "./context-manager.js";
import { CustomAgentFileStore } from "./custom-agents.js";
import { SystemAgentOverrideFileStore } from "./custom-agents.js";
import { RuntimeSkillRegistry, RuntimeToolRegistry } from "./harness/capability-registries.js";
import {
  approvedToolContinuationActions,
  type ApprovedFileWriteResumeDeps
} from "./approved-file-write-resume.js";
import {
  applySystemAgentOverridesToMode,
  buildAgentCatalog,
  customAgentContextsForMode,
  customAgentOverlaysForMode,
  systemAgentIds,
  systemAgentOverlaysForMode
} from "./agent-catalog.js";
import { FileLongTermMemoryStore, LongTermMemoryManager, LongTermMemoryUpdateQueue } from "./memory.js";
import { ModeSpecFileStore } from "./modes.js";
import { JsonFileRuntimePersistenceBackend } from "./persistence/json-file-backend.js";
import { SqliteRuntimePersistence } from "./persistence/sqlite-backend.js";
import { StoreManifestSchema } from "./persistence/types.js";
import { PlanDecisionService } from "./plan-decision-service.js";
import { RuntimeGateLedgerService } from "./runtime-gate-ledger-service.js";
import { createRuntimeGateRunAppendAdapter } from "./runtime-gate-run-append-adapter.js";
import type { RuntimeGateAppendAdapter, RuntimeGateResolution } from "./runtime-gate-service.js";
import {
  executeApprovedToolContinuationStrategy,
  executeNonKernelResumeStrategy,
  RunResumeService,
  type RunResumeStrategy,
} from "./run-resume-service.js";
import { RunResumeFinalizationService } from "./run-resume-finalization-service.js";
import { RunStartService } from "./run-start-service.js";
import type {
  RuntimePersistenceBackend,
  StoreManifest,
  StoredProject,
  RuntimeRunReadModel,
  RuntimeSessionReadModel
} from "./persistence/types.js";
import type { ModelMessage } from "./providers/index.js";
import { invokeRunProvider } from "./providers/index.js";
import { readLangfuseRunTrace } from "./telemetry/langfuse.js";
import { mergeTrailObservations, synthesizeLocalTrail } from "./telemetry/trails.js";
import { LocalEvaluationStore } from "./evaluation-store.js";
import { LocalFeedbackLoopStore } from "./feedback-loop-store.js";
import { LocalSelfIterationStore, type SelfIterationDerivationInput } from "./self-iteration-store.js";
import {
  projectWorkspaceContext
} from "./project-workspace.js";
import { runtimeConversationToModelMessages } from "./runtime-conversation.js";
import { OraRuntimeError } from "./runtime-errors.js";
import { generateCustomAgentDraft } from "./agent-draft.js";
import { modeCreateParamsFromSpec } from "./mode-studio-draft.js";
import {
  buildModeStudioDraft,
  createModeStudioBuilderResult,
  withModeStudioValidation,
  type ModeStudioStoreDeps
} from "./mode-studio-store.js";
import {
  currentPendingClarifications,
  rebaseRunEvent,
  resumedInputWithClarifications,
  runningSnapshotForApprovedActions
} from "./run-orchestration.js";
import { RunKernelExecutionService } from "./run-kernel-execution-service.js";
import { RunLedgerBranchService } from "./run-ledger-branch-service.js";
import { RunLedgerService } from "./run-ledger-service.js";
import { RunPersistenceService } from "./run-persistence-service.js";
import {
  applyStreamingRunEvent,
  createStreamingFailure,
  publishRunStream
} from "./run-streaming.js";
import { RunStreamingService } from "./run-streaming-service.js";
import {
  createRunningRunSnapshot,
  createStandaloneRunSnapshot
} from "./run-snapshots.js";
import {
  completeModeStudioBuilderSnapshot,
  createModeStudioBuilderConfig,
  createModeStudioBuilderInput,
  modeStudioBuilderResultFromSnapshot,
  startModeStudioBuilderSnapshot
} from "./mode-studio-builder-run.js";
import { runRuntimeMaintenance } from "./run-maintenance.js";
import {
  defaultCustomAgentsDir,
  defaultEvaluationStoreDir,
  defaultFeedbackLoopStoreDir,
  defaultAutomationsDir,
  defaultSelfIterationStoreDir,
  defaultMemoryDir,
  defaultModesDir,
  defaultPublicSkillsDir,
  defaultRuntimeStoreDir,
  defaultSkillsDir,
  defaultSystemAgentOverridesDir,
  defaultBundledSkillsDir
} from "./runtime-store-paths.js";
import {
  DEFAULT_SESSION_TITLE,
  assistantTextForRun,
  defaultSessionTitle,
  generateSessionTitleFromPrompt,
} from "./session-title.js";
import {
  resolveModeSelection,
  withMemoryPrompt,
  type ModeSelectionDeps
} from "./mode-selection.js";
import {
  processLongTermMemoryUpdate,
  scheduleLongTermMemoryUpdate,
  type MemoryUpdateDeps
} from "./memory-updates.js";
import {
  migrateLegacyOraMvpProjectPlaceholder,
  migrateLegacyRunsIntoSessions
} from "./runtime-migrations.js";
import {
  cancelRun,
  exportReport,
  getRunState,
  interruptRun,
  listCheckpoints,
  persistExternalSnapshot,
  replayRun,
  streamRun,
  type RunStateOperationDeps
} from "./run-state-operations.js";
import {
  archiveSession as archiveSessionOperation,
  branchGroupsForSession,
  createProject as createProjectOperation,
  createSession as createSessionOperation,
  getProject as getProjectOperation,
  getSession as getSessionOperation,
  isUnadoptedBranchCandidate,
  isVisibleMainlineRun,
  listProjectFiles as listProjectFilesOperation,
  listProjects as listProjectsOperation,
  listRuns as listRunsOperation,
  listSessions as listSessionsOperation,
  readProjectFile as readProjectFileOperation,
  type ProjectSessionOperationDeps
} from "./project-session-operations.js";
import {
  attachTraceMetadata,
  buildRunTrailMetrics,
  toFlowRunDetail,
  toFlowRunHandle,
  toRunHandle,
  toRunSummary
} from "./run-projections.js";
import {
  buildFeedbackSourceContext,
  curateFeedbackDraft,
  type FeedbackSourceContextDeps
} from "./feedback-curation.js";
import { generateEvaluationBlueprintDraftWithProvider } from "./evaluation-blueprint-draft.js";

const StartRunParamsSchema = z.object({
  input: UserTaskInputSchema,
  config: RunConfigSchema.partial().optional(),
  sessionId: z.string().min(1).optional(),
});

type AcceptedPlanHandoff = {
  decisionId: string;
  sourceRunId: string;
  planContent: string;
};

const RunIdParamsSchema = z.object({
  runId: z.string().min(1)
});

const USER_CANCELLED_MESSAGE = "Stopped processing as instructed.";
const USER_INTERRUPTED_MESSAGE = "Paused as instructed.";
const USER_RESUMED_MESSAGE = "Confirmed. Continuing.";

export interface LocalRunStoreOptions {
  dataDir?: string;
  clock?: () => number;
  fetchImpl?: typeof fetch;
  onChannelSessionUpdate?: (event: ChannelSessionUpdateEvent) => void;
  autoStartChannels?: boolean;
  autoStartAutomations?: boolean;
  maxCachedSessions?: number;
  autoArchiveThresholdDays?: number;
}

interface StreamingRunOptions {
  onStream?: (stream: RunEventStream) => void;
}

export class LocalRunStore {
  private readonly backend: RuntimePersistenceBackend;
  private readonly clock: () => number;
  private readonly persistenceType: "sqlite" | "json-file";
  private readonly evaluationStore: LocalEvaluationStore;
  private readonly feedbackLoopStore: LocalFeedbackLoopStore;
  private readonly selfIterationStore: LocalSelfIterationStore;
  private readonly selfIterationDatasetCache = new Map<string, string>();
  private readonly customAgentStore: CustomAgentFileStore;
  private readonly systemAgentOverrideStore: SystemAgentOverrideFileStore;
  private readonly modeStore: ModeSpecFileStore;
  private readonly skillRegistry: RuntimeSkillRegistry;
  private readonly longTermMemory: LongTermMemoryManager;
  private readonly longTermMemoryQueue: LongTermMemoryUpdateQueue;
  private readonly channelService: ChannelService;
  private readonly automationService: AutomationService;
  private readonly planDecisionService: PlanDecisionService;
  private readonly runResumeFinalizationService: RunResumeFinalizationService;
  private readonly runResumeService: RunResumeService;
  private readonly runStartService: RunStartService;
  private readonly runStreamingService: RunStreamingService;
  private readonly runKernelExecutionService: RunKernelExecutionService;
  private readonly runLedgerBranchService = new RunLedgerBranchService();
  private readonly runLedgerService: RunLedgerService;
  private readonly runPersistenceService: RunPersistenceService;
  private readonly runtimeGateLedgerService = new RuntimeGateLedgerService();
  private readonly selfIterationCuratorTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private projects = new Map<string, StoredProject>();
  private sessions = new Map<string, RuntimeSessionReadModel>();
  private runs = new Map<string, RuntimeRunReadModel>();
  private allSessionIds = new Set<string>();
  private readonly maxCachedSessions: number;
  private readonly autoArchiveThresholdDays: number;
  private manifest: StoreManifest;
  private sessionLedgerRevision: string | undefined;
  private sessionLedgerLeafEntryIds = new Map<string, string | undefined>();
  private sessionRunProjectionModes = new Map<string, "slim" | "full">();

  constructor(options: LocalRunStoreOptions = {}) {
    this.maxCachedSessions = options.maxCachedSessions ?? 50;
    this.autoArchiveThresholdDays = options.autoArchiveThresholdDays ?? 90;
    this.clock = options.clock ?? Date.now;
    const dataDir = options.dataDir ?? process.env.ORA_RUNTIME_STORE_DIR ?? path.join(process.cwd(), ".ora", "runtime.db");

    if (dataDir.endsWith(".db")) {
      this.persistenceType = "sqlite";
      this.backend = new SqliteRuntimePersistence(dataDir);
    } else {
      this.persistenceType = "json-file";
      this.backend = new JsonFileRuntimePersistenceBackend(dataDir);
    }
    this.runLedgerService = new RunLedgerService({
      backend: this.backend,
      branchService: this.runLedgerBranchService,
    });
    this.runPersistenceService = new RunPersistenceService({
      normalizeSnapshotForPersistence: (snapshot) => this.normalizeSnapshotForPersistence(snapshot),
      cacheRun: (snapshot, flush, cacheOptions) => this.cacheRun(snapshot, flush, cacheOptions),
      currentSessionTitle: (sessionId) => this.sessions.get(sessionId)?.title,
      isLedgerBackedSession: (sessionId) => this.isLedgerBackedSession(sessionId),
      updateSessionTitle: (sessionId, title) => this.updateSessionTitle(sessionId, title),
      scheduleLongTermMemoryUpdate: (snapshot) => scheduleLongTermMemoryUpdate(snapshot, this.memoryUpdateDeps()),
      queueSelfIterationAfterTerminalRun: (snapshot) => this.queueSelfIterationAfterTerminalRun(snapshot),
    });
    this.runResumeFinalizationService = new RunResumeFinalizationService({
      withResumeResolutionEvents: (snapshot, original, clarificationPatch, approvedActionIds) =>
        this.withResumeResolutionEvents(snapshot, original, clarificationPatch, approvedActionIds),
      normalizeSnapshotForPersistence: (snapshot) => this.normalizeSnapshotForPersistence(snapshot),
      appendRunSnapshotUpdateToLedger: (snapshot) => this.appendRunSnapshotUpdateToLedger(snapshot),
      persistRun: (snapshot) => this.persistRun(snapshot),
      persistRunWithGeneratedTitle: (snapshot) => this.persistRunWithGeneratedTitle(snapshot),
    });
    this.customAgentStore = new CustomAgentFileStore(defaultCustomAgentsDir(dataDir), this.clock);
    this.systemAgentOverrideStore = new SystemAgentOverrideFileStore(defaultSystemAgentOverridesDir(dataDir), this.clock);
    this.modeStore = new ModeSpecFileStore(defaultModesDir(dataDir), this.clock);
    this.skillRegistry = new RuntimeSkillRegistry({
      privateRootDir: defaultSkillsDir(dataDir),
      publicRootDir: defaultPublicSkillsDir(dataDir),
      bundledPublicRootDir: defaultBundledSkillsDir(),
      clock: this.clock,
    });
    this.evaluationStore = new LocalEvaluationStore(
      this.persistenceType === "sqlite" ? dataDir : defaultEvaluationStoreDir(dataDir),
      this.clock,
    );
    this.feedbackLoopStore = new LocalFeedbackLoopStore(defaultFeedbackLoopStoreDir(dataDir), this.clock);
    this.selfIterationStore = new LocalSelfIterationStore(defaultSelfIterationStoreDir(dataDir), this.clock);
    this.longTermMemory = new LongTermMemoryManager(
      new FileLongTermMemoryStore(defaultMemoryDir(dataDir)),
      this.clock,
    );
    this.longTermMemoryQueue = new LongTermMemoryUpdateQueue((task) =>
      processLongTermMemoryUpdate(task, this.memoryUpdateDeps())
    );
    this.channelService = new ChannelService(this.backend, this, {
      clock: this.clock,
      fetchImpl: options.fetchImpl,
      onSessionUpdate: options.onChannelSessionUpdate,
      autoStartAdapters: options.autoStartChannels ?? false,
    });
    this.automationService = new AutomationService({
      rootDir: defaultAutomationsDir(dataDir),
      clock: this.clock,
      createSession: (params) => this.createSession(params),
      startStreamingRun: (params, options) => this.startStreamingRun(params, options),
      listProjects: () => this.listProjects(),
      agentExists: (agentId) => this.agentExists(agentId),
    });
    this.runKernelExecutionService = new RunKernelExecutionService({
      clock: this.clock,
      skillRegistry: this.skillRegistry,
      modeRegistry: this,
      selfIterationRegistry: this,
      automationRegistry: this,
      customAgentOverlay: (customAgentId) => this.customAgentStore.personaOverlay(customAgentId),
      customAgentOverlaysForMode: (modeSpec) => this.customAgentOverlaysForMode(modeSpec),
      systemAgentOverlaysForMode: (modeSpec) => this.systemAgentOverlaysForMode(modeSpec),
      customAgentContextsForMode: (modeSpec) => this.customAgentContextsForMode(modeSpec),
      buildConversationMessages: (sessionId, currentPrompt, excludeRunId) =>
        this.buildConversationMessages(sessionId, currentPrompt, excludeRunId),
    });
    this.planDecisionService = new PlanDecisionService({
      now: () => this.now(),
      getSessionOrThrow: (sessionId) => this.getSessionOrThrow(sessionId),
      getRunOrThrow: (runId) => this.getRunOrThrow(runId),
      normalizeSnapshotForPersistence: (snapshot) => this.normalizeSnapshotForPersistence(snapshot),
      isLedgerBackedSession: (sessionId) => this.isLedgerBackedSession(sessionId),
      appendSessionLedgerEntry: (sessionId, entry) => this.appendSessionLedgerEntry(sessionId, entry),
      refreshSessionFromLedger: (sessionId) => this.refreshSessionFromLedger(sessionId),
      saveManifest: () => this.backend.saveManifest(this.manifest),
      cacheRun: (snapshot, syncSession) => this.cacheRun(snapshot, syncSession),
      getSession: (params) => this.getSession(params),
    });
    this.runResumeService = new RunResumeService({
      getRunOrThrow: (runId) => this.getRunOrThrow(runId),
    });
    this.runStartService = new RunStartService({
      now: () => this.now(),
      ensureSessionForRun: (sessionId, input) => this.ensureSessionForRun(sessionId, input),
      enrichInputForSession: (input, session) => this.enrichInputForSession(input, session),
      modeSelectionDeps: () => this.modeSelectionDeps(),
      nextRunId: () => this.nextRunId(),
      nextTurnIndex: (sessionId) => this.nextTurnIndex(sessionId),
    });
    this.runStreamingService = new RunStreamingService({
      cacheRun: (snapshot, flush) => this.cacheRun(snapshot, flush, { deferInitialTitle: true }),
      cacheRunDelta: (snapshot) => this.cacheRunDelta(snapshot),
      appendRuntimeEventBatchToLedger: (snapshot, events, status) =>
        this.appendRuntimeEventBatchToLedger(snapshot, events, status),
    });
    const maxBootSessions = this.persistenceType === "sqlite" ? 50 : undefined;
    const loaded = this.backend.load(
      this.persistenceType === "sqlite" ? { includeRuns: false, maxSessions: maxBootSessions } : undefined,
    );
    this.manifest = StoreManifestSchema.parse(loaded.manifest);
    this.projects = new Map(loaded.projects.map((project) => [project.projectId, project]));
    this.sessions = new Map(loaded.sessions.map((session) => [session.sessionId, session]));
    this.runs = new Map(loaded.runs.map((run) => [run.runId, run]));
    // Track all session IDs (including those not loaded into memory)
    const allIds = this.backend.listAllSessionIds?.() ?? loaded.sessions.map((s) => s.sessionId);
    this.allSessionIds = new Set(allIds);
    migrateLegacyRunsIntoSessions(this.migrationState());
    migrateLegacyOraMvpProjectPlaceholder(this.migrationState());
    for (const projectId of this.projects.keys()) {
      this.syncProjectSummary(projectId);
    }
    this.backend.saveManifest(this.manifest);
    this.sessionLedgerRevision = this.backend.ledgerRevision?.();
    for (const sessionId of this.sessions.keys()) {
      this.sessionLedgerLeafEntryIds.set(
        sessionId,
        this.backend.getSessionLedgerLeafEntryId?.(sessionId) ?? undefined,
      );
    }
    if (options.autoStartChannels) {
      this.channelService.startAll().catch((err) => {
        console.error("[LocalRunStore] channel 自动启动失败:", err instanceof Error ? err.message : err);
      });
    } else {
      this.channelService.prepareAll();
    }
    if (options.autoStartAutomations) {
      this.automationService.start();
    }
    this.cleanupOrphanedImpactResources();
  }

  health() {
    return {
      ok: true,
      service: "ora-runtime",
      version: "0.1.0",
      deterministic: false,
      persistence: this.persistenceType
    };
  }

  runtimeMaintenance(params: unknown = {}) {
    const parsed = RuntimeMaintenanceParamsSchema.parse(params ?? {});
    const autoArchiveThresholdMs = parsed.autoArchiveThresholdMs > 0
      ? parsed.autoArchiveThresholdMs
      : this.autoArchiveThresholdDays > 0
        ? this.autoArchiveThresholdDays * 86400000
        : 0;
    return runRuntimeMaintenance(
      { ...parsed, autoArchiveThresholdMs },
      {
        runs: this.runs,
        backend: this.backend,
        now: () => this.now(),
      },
    );
  }

  listPatterns(): PatternDefinition[] {
    return MVP_PATTERNS;
  }

  listModes(): ModeSpec[] {
    return this.modeStore.list()
      .filter((mode) => mode.visibility !== "internal")
      .map((mode) => this.applySystemAgentOverridesToMode(mode));
  }

  getMode(params: unknown): ModeSpec {
    return this.applySystemAgentOverridesToMode(this.modeStore.get(params));
  }

  createMode(params: ModeCreateParams | unknown): ModeSpec {
    return this.applySystemAgentOverridesToMode(this.modeStore.create(params));
  }

  private applySystemAgentOverridesToMode(modeSpec: ModeSpec): ModeSpec {
    return applySystemAgentOverridesToMode(modeSpec, this.systemAgentOverrideStore);
  }

  private customAgentOverlaysForMode(modeSpec: ModeSpec): Record<string, string> {
    return customAgentOverlaysForMode(modeSpec, this.customAgentStore);
  }

  private customAgentContextsForMode(modeSpec: ModeSpec): Record<string, Pick<CustomAgentDetail, "model" | "skillIds" | "toolIds"> & { overlay: string }> {
    return customAgentContextsForMode(modeSpec, this.customAgentStore);
  }

  private systemAgentOverlaysForMode(modeSpec: ModeSpec): Record<string, string> {
    return systemAgentOverlaysForMode(modeSpec, this.systemAgentOverrideStore);
  }

  updateMode(params: ModeUpdateParams | unknown): ModeSpec {
    return this.applySystemAgentOverridesToMode(this.modeStore.update(params));
  }

  deleteMode(params: unknown): { deleted: true; modeId: string } {
    return this.modeStore.delete(params);
  }

  validateMode(params: unknown): ModeValidationResult {
    return this.modeStore.validate(params);
  }

  cloneModeFromPreset(params: unknown): ModeSpec {
    return this.applySystemAgentOverridesToMode(this.modeStore.cloneFromPreset(params));
  }

  modeStudioContext(): ModeStudioContextResult {
    return ModeStudioContextResultSchema.parse({
      modes: this.listModes(),
      agents: this.listAgents(),
      tools: new RuntimeToolRegistry().snapshot(),
      skills: this.listSkills(),
      atoms: MVP_MODE_RUNTIME_ATOMS,
    });
  }

  generateModeStudioDraft(params: ModeStudioGenerateDraftParams | unknown): ModeStudioDraftBundle {
    const parsed = ModeStudioGenerateDraftParamsSchema.parse(params);
    return buildModeStudioDraft(parsed, this.modeStudioDeps());
  }

  refineModeStudioDraft(params: unknown): ModeStudioDraftBundle {
    const parsed = ModeStudioRefineDraftParamsSchema.parse(params);
    return buildModeStudioDraft({
      ...parsed,
      currentDraft: parsed.draftBundle.modeDraft,
    }, this.modeStudioDeps());
  }

  async startModeStudioBuilderRun(params: ModeStudioStartBuilderRunParams | unknown): Promise<RunHandle> {
    const parsed = ModeStudioStartBuilderRunParamsSchema.parse(params);
    const runId = this.nextRunId();
    const createdAt = this.now();
    const input = createModeStudioBuilderInput(parsed, createdAt);
    const modeSpec = this.modeStore.get({ modeId: MODE_STUDIO_BUILDER_MODE_ID });
    const definition = modeSpecToPatternDefinition(modeSpec);
    const config = createModeStudioBuilderConfig(parsed, modeSpec);

    let snapshot = createStandaloneRunSnapshot({ runId, input, config, modeSpec, definition, clock: this.clock });
    const appendEvent = (
      target: StateSnapshot,
      type: OraEventEnvelope["type"],
      payload: unknown,
      extra?: Partial<OraEventEnvelope>,
    ) => this.appendEvent(target, type, payload, extra);
    snapshot = startModeStudioBuilderSnapshot({
      snapshot,
      builderParams: parsed,
      appendEvent,
    });

    const result = await createModeStudioBuilderResult(parsed, config, this.modeStudioDeps());
    snapshot = completeModeStudioBuilderSnapshot({
      snapshot,
      result,
      runId,
      definition,
      createdAt: this.now(),
      appendEvent,
    });
    this.cacheRun(attachTraceMetadata(snapshot), true);
    return toRunHandle(snapshot);
  }

  modeStudioBuilderResult(params: unknown): ModeStudioBuilderResult {
    const parsed = ModeStudioBuilderResultParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    return modeStudioBuilderResultFromSnapshot(snapshot);
  }

  validateModeStudioDraft(params: unknown): ModeStudioDraftBundle {
    const parsed = ModeStudioValidateDraftParamsSchema.parse(params);
    return withModeStudioValidation(parsed.draftBundle, this.modeStudioDeps());
  }

  applyModeStudioDraft(params: unknown): ModeStudioApplyDraftResult {
    const parsed = ModeStudioApplyDraftParamsSchema.parse(params);
    const bundle = withModeStudioValidation(parsed.draftBundle, this.modeStudioDeps());
    if (bundle.needsInput) {
      throw new Error("Mode Studio draft still needs input before it can be applied.");
    }
    if (!bundle.validation.valid) {
      throw new Error(`Mode Studio draft is invalid: ${bundle.validation.errors.join(" ")}`);
    }
    const savedAgents: CustomAgentSummary[] = [];
    if (parsed.saveAgentDrafts) {
      for (const draft of bundle.agentDrafts) {
        const creatable = CustomAgentCreateParamsSchema.safeParse(draft);
        if (!creatable.success) {
          throw new Error(`Agent draft '${draft.name || "unnamed"}' is invalid: ${creatable.error.issues.map((issue) => issue.message).join(" ")}`);
        }
        const existing = this.customAgentStore.checkName({ name: creatable.data.name });
        const saved = existing.available
          ? this.customAgentStore.create(creatable.data)
          : this.customAgentStore.update({
              name: creatable.data.name,
              description: creatable.data.description,
              model: creatable.data.model ?? null,
              toolGroups: creatable.data.toolGroups,
              toolIds: creatable.data.toolIds,
              skillIds: creatable.data.skillIds,
              soul: creatable.data.soul,
            });
        const { soul: _soul, ...summary } = saved;
        savedAgents.push(summary);
      }
    }
    const modeParams = modeCreateParamsFromSpec(bundle.modeDraft);
    const mode = parsed.updateModeId
      ? this.updateMode({ modeId: parsed.updateModeId, spec: modeParams })
      : this.createMode(modeParams);
    return ModeStudioApplyDraftResultSchema.parse({ mode, agents: savedAgents });
  }

  private modeStudioDeps(): ModeStudioStoreDeps {
    return {
      now: () => this.now(),
      listAgents: () => this.listAgents(),
      listModes: () => this.listModes(),
      getMode: (params) => this.getMode(params),
      validateMode: (params) => this.validateMode(params),
      modeStudioContext: () => this.modeStudioContext(),
    };
  }



  createChannel(params: unknown) {
    return this.channelService.create(params);
  }

  listChannels(params: unknown = {}) {
    return this.channelService.list(params);
  }

  getChannel(params: unknown, options: { redact?: boolean } = {}) {
    return this.channelService.get(params, options);
  }

  updateChannel(params: unknown) {
    return this.channelService.update(params);
  }

  deleteChannel(params: unknown) {
    return this.channelService.delete(params);
  }

  startChannel(params: unknown) {
    return this.channelService.start(params);
  }

  stopChannel(params: unknown) {
    return this.channelService.stop(params);
  }

  restartChannel(params: unknown) {
    return this.channelService.restart(params);
  }

  channelStatus() {
    return this.channelService.status();
  }

  ingestChannel(params: unknown) {
    return this.channelService.ingest(params);
  }

  listChannelBindings(params: unknown = {}) {
    return this.channelService.listBindings(params);
  }

  listChannelDeliveries(params: unknown = {}) {
    return this.channelService.listDeliveries(params);
  }

  retryChannelDelivery(params: unknown) {
    return this.channelService.retryDelivery(params);
  }

  wechatRequestQrCode(params: unknown) {
    return this.channelService.wechatRequestQrCode(params);
  }

  wechatPollQrCodeStatus(params: unknown) {
    return this.channelService.wechatPollQrCodeStatus(params);
  }


  createProject(params: unknown = {}): ProjectSummary {
    return createProjectOperation(params, this.projectSessionOperationDeps());
  }

  listProjects(params: unknown = {}): ProjectSummary[] {
    return listProjectsOperation(params, this.projectSessionOperationDeps());
  }

  getProject(params: unknown): ProjectDetail {
    this.refreshSessionSummariesIfStale();
    return getProjectOperation(params, this.projectSessionOperationDeps());
  }

  listProjectFiles(params: unknown): ProjectFilesResult {
    return listProjectFilesOperation(params, this.projectSessionOperationDeps());
  }

  readProjectFile(params: unknown): ProjectFileReadResult {
    return readProjectFileOperation(params, this.projectSessionOperationDeps());
  }

  createSession(params: unknown = {}): SessionSummary {
    return createSessionOperation(params, this.projectSessionOperationDeps());
  }

  listSessions(params: unknown = {}): SessionSummary[] {
    this.refreshSessionSummariesIfStale();
    return listSessionsOperation(params, this.projectSessionOperationDeps());
  }

  archiveSession(params: unknown): SessionSummary {
    return archiveSessionOperation(params, this.projectSessionOperationDeps());
  }

  getSession(params: unknown): SessionDetail {
    const t0 = Date.now();
    const sessionId = (params as Record<string, unknown>)?.sessionId as string;
    this.refreshSessionIfStale(sessionId);
    this.ensureSessionRunsLoaded(sessionId, { includeEvents: true });
    const t1 = Date.now();
    const result = getSessionOperation(params, this.projectSessionOperationDeps());
    const t2 = Date.now();
    if (t2 - t0 > 500) {
      try {
        const line = JSON.stringify({ refresh: t1 - t0, operation: t2 - t1, total: t2 - t0, sessionId: (params as any)?.sessionId }) + "\n";
        require("node:fs").appendFileSync("/tmp/ora-session-timing.txt", line);
      } catch (_) { /* best effort */ }
    }
    return result;
  }

  setSessionProject(params: unknown): SessionSummary {
    const parsed = z.object({
      sessionId: z.string().min(1),
      projectId: z.string().min(1),
    }).parse(params);
    this.getProjectOrThrow(parsed.projectId);
    const existing = this.getSessionOrThrow(parsed.sessionId);
    const previousProjectId = existing.projectId;
    const updated = SessionSummarySchema.parse({
      ...existing,
      projectId: parsed.projectId,
      updatedAt: this.now(),
    });
    this.persistSession(updated);
    if (previousProjectId && previousProjectId !== parsed.projectId) {
      this.syncProjectSummary(previousProjectId);
    }
    return this.getSessionOrThrow(parsed.sessionId);
  }

  workbenchBootstrap(bootstrap: RuntimeBootstrap): RuntimeWorkbenchBootstrap {
    this.refreshSessionSummariesIfStale();
    const deps = this.projectSessionOperationDeps();
    const projects = listProjectsOperation({}, deps);
    const sessions = listSessionsOperation({}, deps);
    const activeSession = this.createSession({});
    const activeSessionDetail = getSessionOperation(
      { sessionId: activeSession.sessionId, includeLatestSnapshot: false },
      this.projectSessionOperationDeps(),
    );

    return RuntimeWorkbenchBootstrapSchema.parse({
      bootstrap,
      projects,
      sessions: [activeSession, ...sessions],
      activeSessionDetail,
    });
  }

  listSessionBranchGroups(params: unknown): SessionBranchGroup[] {
    const parsed = SessionBranchGroupListParamsSchema.parse(params);
    this.getSessionOrThrow(parsed.sessionId);
    return this.mergedSessionBranchGroups(parsed.sessionId).slice(0, parsed.limit);
  }

  private mergedSessionBranchGroups(sessionId: string): SessionBranchGroup[] {
    const runtimeGroups = branchGroupsForSession(sessionId, [...this.runs.values()]);
    const runtimeGroupIds = new Set(runtimeGroups.map((group) => group.branchGroupId));
    const ledger = this.backend.getSessionLedger(sessionId);
    const ledgerGroups = ledger
      ? deriveSessionProjection(ledger).branchGroups.filter((group) => !runtimeGroupIds.has(group.branchGroupId))
      : [];
    return [...runtimeGroups, ...ledgerGroups];
  }

  getSessionBranchGroup(params: unknown): SessionBranchGroup {
    const parsed = SessionBranchGroupGetParamsSchema.parse(params);
    const group = this.listSessionBranchGroups({ sessionId: parsed.sessionId })
      .find((candidate) => candidate.branchGroupId === parsed.branchGroupId);
    if (!group) {
      throw new OraRuntimeError(`Branch group not found: ${parsed.branchGroupId}`, -32004, parsed);
    }
    return group;
  }

  async createAndRunSessionBranchGroup(params: unknown): Promise<SessionBranchGroup> {
    const parsed = SessionBranchGroupCreateParamsSchema.parse(params);
    const session = this.getSessionOrThrow(parsed.sessionId);
    const latestRun = session.latestRunId ? this.getRunOrThrow(session.latestRunId) : undefined;
    const replaceRunId = parsed.target === "replace_latest"
      ? parsed.replaceRunId ?? latestRun?.runId
      : undefined;
    const replaceRun = replaceRunId ? this.getRunOrThrow(replaceRunId) : undefined;
    if (parsed.target === "empty_start" && session.turnCount !== 0) {
      throw new OraRuntimeError("empty_start branch groups require an empty session.", -32004, { sessionId: session.sessionId });
    }
    if ((parsed.target === "append_after_latest" || parsed.target === "replace_latest") && !latestRun) {
      throw new OraRuntimeError(`${parsed.target} requires an existing latest run.`, -32004, { sessionId: session.sessionId });
    }
    const baseRunId = parsed.target === "append_after_latest"
      ? parsed.baseRunId ?? latestRun?.runId
      : parsed.target === "replace_latest"
        ? previousMainlineRunBefore(session.sessionId, replaceRunId!, this.runsForSession(session.sessionId))?.runId
        : undefined;
    if (parsed.target === "append_after_latest" && baseRunId !== latestRun?.runId) {
      throw new OraRuntimeError("append_after_latest can only branch from the current latest run.", -32004, { sessionId: session.sessionId, baseRunId });
    }
    if (parsed.target === "replace_latest" && replaceRun?.runId !== latestRun?.runId) {
      throw new OraRuntimeError("replace_latest can only replace the current latest run.", -32004, { sessionId: session.sessionId, replaceRunId });
    }
    if (latestRun && (latestRun.status === "queued" || latestRun.status === "running")) {
      throw new OraRuntimeError("Wait for the latest run to finish before creating branch candidates.", -32004, {
        sessionId: session.sessionId,
        runId: latestRun.runId,
      });
    }

    const prompt = parsed.prompt ?? replaceRun?.input.prompt;
    if (!prompt?.trim()) {
      throw new OraRuntimeError("Branch group prompt is required.", -32004, { sessionId: session.sessionId });
    }
    const now = this.now();
    const branchGroupId = `${session.sessionId}:branch-${now}-${String(this.manifest.nextRunNumber).padStart(4, "0")}`;
    const baseTurnIndex = parsed.target === "replace_latest"
      ? Math.max(0, (replaceRun?.turnIndex ?? 1) - 1)
      : latestRun?.turnIndex ?? 0;
    const initialBranchGroup = SessionBranchGroupSchema.parse({
      branchGroupId,
      sessionId: session.sessionId,
      target: parsed.target,
      baseRunId,
      replaceRunId,
      baseTurnIndex,
      prompt,
      status: "running",
      candidateRunIds: [],
      candidates: [],
      createdAt: now,
      updatedAt: now,
    });
    this.appendBranchLifecycleEntry(session.sessionId, "branch.created", initialBranchGroup, now);
    let projectedBranchGroup = initialBranchGroup;

    for (const [index, candidate] of parsed.candidates.entries()) {
      const handle = await this.startStreamingRun({
        sessionId: session.sessionId,
        input: {
          ...candidate.input,
          prompt: candidate.input?.prompt ?? prompt,
          projectId: candidate.input?.projectId ?? session.projectId,
          context: {
            ...(candidate.input?.context ?? {}),
            branchGroupId,
            branchTarget: parsed.target,
            ...(baseRunId ? { branchBaseRunId: baseRunId } : {}),
            ...(replaceRunId ? { branchReplaceRunId: replaceRunId } : {}),
          },
        },
        config: {
          ...candidate.config,
          metadata: {
            ...(candidate.config.metadata ?? {}),
            branchGroupId,
            branchRole: "candidate",
            branchTarget: parsed.target,
            branchPrompt: prompt,
            branchBaseTurnIndex: baseTurnIndex,
            branchGroupCreatedAt: now,
            branchCandidateLabel: candidate.label ?? `Candidate ${index + 1}`,
            ...(baseRunId ? { branchBaseRunId: baseRunId } : {}),
            ...(replaceRunId ? { branchReplaceRunId: replaceRunId } : {}),
          },
        },
      });
      projectedBranchGroup = SessionBranchGroupSchema.parse({
        ...projectedBranchGroup,
        candidateRunIds: [...projectedBranchGroup.candidateRunIds, handle.runId],
        candidates: [
          ...projectedBranchGroup.candidates,
          {
            runId: handle.runId,
            status: handle.status,
            label: candidate.label ?? `Candidate ${index + 1}`,
            modeId: handle.modeId,
            modelRef: candidate.config.modelRef,
            prompt: candidate.input?.prompt ?? prompt,
            updatedAt: handle.startedAt,
          },
        ],
        updatedAt: Math.max(projectedBranchGroup.updatedAt, handle.startedAt),
      });
      this.appendBranchLifecycleEntry(session.sessionId, "branch.candidate_started", projectedBranchGroup, this.now(), handle.runId);
    }

    return this.getSessionBranchGroup({ sessionId: session.sessionId, branchGroupId });
  }

  adoptSessionBranchGroup(params: unknown): SessionDetail {
    const parsed = SessionBranchGroupAdoptParamsSchema.parse(params);
    const session = this.getSessionOrThrow(parsed.sessionId);
    const group = this.getSessionBranchGroup(parsed);
    const candidate = this.getRunOrThrow(parsed.runId);
    if (candidate.sessionId !== session.sessionId || candidate.config.metadata.branchGroupId !== parsed.branchGroupId) {
      throw new OraRuntimeError("Run does not belong to the selected branch group.", -32004, parsed);
    }
    if (candidate.status === "queued" || candidate.status === "running" || candidate.status === "failed" || candidate.status === "cancelled") {
      throw new OraRuntimeError("Only completed branch candidates can be adopted.", -32004, { runId: candidate.runId, status: candidate.status });
    }
    if (group.target === "append_after_latest" && session.latestRunId !== group.baseRunId) {
      throw new OraRuntimeError("Cannot adopt append branch because the session latest run has changed.", -32004, {
        sessionId: session.sessionId,
        latestRunId: session.latestRunId,
        baseRunId: group.baseRunId,
      });
    }
    if (group.target === "replace_latest" && session.latestRunId !== group.replaceRunId) {
      throw new OraRuntimeError("Cannot adopt replacement branch because the session latest run has changed.", -32004, {
        sessionId: session.sessionId,
        latestRunId: session.latestRunId,
        replaceRunId: group.replaceRunId,
      });
    }
    if (group.target === "empty_start" && session.turnCount !== 0) {
      throw new OraRuntimeError("Cannot adopt empty_start branch after the session has advanced.", -32004, {
        sessionId: session.sessionId,
        turnCount: session.turnCount,
      });
    }

    const now = this.now();
    if (group.target === "replace_latest" && group.replaceRunId) {
      const replaced = this.getRunOrThrow(group.replaceRunId);
      const superseded = StateSnapshotSchema.parse({
        ...replaced,
        config: {
          ...replaced.config,
          metadata: {
            ...replaced.config.metadata,
            supersededByRunId: candidate.runId,
            supersededAt: now,
          },
        },
        updatedAt: Math.max(replaced.updatedAt, now),
      });
      this.cacheRun(superseded, true);
    }

    const turnIndex = group.target === "replace_latest" && group.replaceRunId
      ? this.getRunOrThrow(group.replaceRunId).turnIndex
      : candidate.turnIndex;
    const adopted = StateSnapshotSchema.parse({
      ...candidate,
      turnIndex,
      config: {
        ...candidate.config,
        metadata: {
          ...candidate.config.metadata,
          branchRole: "adopted",
          branchAdoptedAt: now,
        },
      },
      updatedAt: Math.max(candidate.updatedAt, now),
    });
    let adoptedSnapshot = adopted;
    if (this.isLedgerBackedSession(session.sessionId)) {
      this.appendRunStartedToLedger({
        sessionId: session.sessionId,
        runId: adopted.runId,
        turnIndex: adopted.turnIndex ?? turnIndex ?? 1,
        input: adopted.input,
        config: adopted.config,
        modeId: adopted.modeId,
        createdAt: adopted.input.createdAt,
      });
      adoptedSnapshot = this.appendRunSnapshotUpdateToLedger(adopted);
      this.appendSessionLedgerEntry(session.sessionId, {
        id: `${adopted.runId}:assistant:adopted-${now}`,
        type: "assistant.message",
        runId: adopted.runId,
        turnIndex: adopted.turnIndex ?? turnIndex ?? 1,
        createdAt: now,
        payload: {
          content: assistantTextForRun(adoptedSnapshot),
          status: adoptedSnapshot.status,
          output: adoptedSnapshot.output,
          error: adoptedSnapshot.error,
          snapshot: adoptedSnapshot,
        },
      });
      this.appendSessionLedgerEntry(session.sessionId, {
        id: `${group.branchGroupId}:adopted:${adopted.runId}`,
        type: "branch.adopted",
        turnIndex: adopted.turnIndex ?? turnIndex ?? 1,
        createdAt: now,
        payload: {
          ...group,
          status: "adopted",
          adoptedRunId: adopted.runId,
          supersededRunId: group.target === "replace_latest" ? group.replaceRunId : undefined,
          notifiedCandidateRunIds: group.candidateRunIds.filter((runId) => runId !== candidate.runId),
          updatedAt: now,
        },
      });
      this.refreshSessionFromLedger(session.sessionId);
      this.backend.saveManifest(this.manifest);
    }
    this.cacheRun(adoptedSnapshot, true);

    for (const runId of group.candidateRunIds) {
      if (runId === candidate.runId) continue;
      const other = this.runs.get(runId);
      if (!other) continue;
      this.cacheRun(StateSnapshotSchema.parse({
        ...other,
        config: {
          ...other.config,
          metadata: {
            ...other.config.metadata,
            branchGroupAdoptedRunId: candidate.runId,
          },
        },
        updatedAt: Math.max(other.updatedAt, now),
      }), true);
    }

    return this.getSession({ sessionId: session.sessionId });
  }

  dismissSessionBranchGroup(params: unknown): SessionBranchGroup {
    const parsed = SessionBranchGroupDismissParamsSchema.parse(params);
    const group = this.getSessionBranchGroup(parsed);
    const now = this.now();
    const dismissedRunIds: string[] = [];
    for (const runId of group.candidateRunIds) {
      const run = this.getRunOrThrow(runId);
      if (run.config.metadata.branchRole === "adopted") continue;
      dismissedRunIds.push(runId);
      this.cacheRun(StateSnapshotSchema.parse({
        ...run,
        config: {
          ...run.config,
          metadata: {
            ...run.config.metadata,
            branchDismissed: true,
            branchDismissedAt: now,
          },
        },
        updatedAt: Math.max(run.updatedAt, now),
      }), true);
    }
    const dismissed = this.getSessionBranchGroup(parsed);
    this.appendBranchLifecycleEntry(parsed.sessionId, "branch.dismissed", {
      ...dismissed,
      dismissedRunIds,
    } as SessionBranchGroup, now);
    return dismissed;
  }

  resolvePlanDecision(params: unknown): SessionDetail {
    return this.planDecisionService.resolve(params);
  }

  listRuns(params: unknown = {}): RunSummary[] {
    const sessionId = (params as Record<string, unknown> | undefined)?.sessionId;
    if (typeof sessionId === "string") {
      this.ensureSessionRunsLoaded(sessionId, { includeEvents: false });
    }
    return listRunsOperation(params, this.projectSessionOperationDeps());
  }

  listAgents(): CustomAgentSummary[] {
    return this.customAgentStore.list();
  }

  agentCatalog(): AgentCatalogResult {
    return buildAgentCatalog({
      modeStore: this.modeStore,
      systemAgentOverrideStore: this.systemAgentOverrideStore,
      agents: this.listAgents(),
    });
  }

  private agentExists(agentId: string): boolean {
    const catalog = this.agentCatalog();
    return catalog.customAgents.some((agent) => agent.name === agentId)
      || catalog.systemAgents.some((agent) => agent.id === agentId);
  }

  listAutomations(params: unknown = {}) {
    return this.automationService.list(params);
  }

  getAutomation(params: unknown) {
    return this.automationService.get(params);
  }

  createAutomation(params: unknown) {
    return this.automationService.create(params);
  }

  updateAutomation(params: unknown) {
    return this.automationService.update(params);
  }

  deleteAutomation(params: unknown) {
    return this.automationService.delete(params);
  }

  pauseAutomation(params: unknown) {
    return this.automationService.pause(params);
  }

  resumeAutomation(params: unknown) {
    return this.automationService.resume(params);
  }

  runAutomationNow(params: unknown) {
    return this.automationService.runNow(params);
  }

  previewAutomationSchedule(params: unknown) {
    return this.automationService.previewSchedule(params);
  }

  updateSystemAgentOverride(params: SystemAgentOverrideUpdateParams | unknown): SystemAgentOverride {
    const parsed = SystemAgentOverrideUpdateParamsSchema.parse(params);
    if (!this.systemAgentIds().has(parsed.agentId)) {
      throw new Error(`System agent '${parsed.agentId}' does not exist.`);
    }
    return this.systemAgentOverrideStore.update(parsed);
  }

  resetSystemAgentOverride(params: unknown): { reset: true; agentId: string } {
    const parsed = SystemAgentOverrideResetParamsSchema.parse(params);
    if (!this.systemAgentIds().has(parsed.agentId)) {
      throw new Error(`System agent '${parsed.agentId}' does not exist.`);
    }
    return this.systemAgentOverrideStore.reset(parsed);
  }

  private systemAgentIds(): Set<string> {
    return systemAgentIds(this.modeStore);
  }

  getAgent(params: unknown): CustomAgentDetail {
    return this.customAgentStore.get(params);
  }

  createAgent(params: CustomAgentCreateParams | unknown): CustomAgentDetail {
    const parsed = CustomAgentCreateParamsSchema.parse(params);
    if (this.systemAgentIds().has(parsed.name.trim().toLowerCase())) {
      throw new Error(`Custom agent '${parsed.name}' conflicts with a built-in system agent.`);
    }
    return this.customAgentStore.create(parsed);
  }

  updateAgent(params: CustomAgentUpdateParams | unknown): CustomAgentDetail {
    return this.customAgentStore.update(params);
  }

  deleteAgent(params: unknown): { deleted: true; name: string } {
    return this.customAgentStore.delete(params);
  }

  checkAgentName(params: unknown): CustomAgentCheckNameResult {
    const result = this.customAgentStore.checkName(params);
    return {
      ...result,
      available: result.available && !this.systemAgentIds().has(result.name),
    };
  }

  async generateAgentDraft(params: CustomAgentGenerateDraftParams | unknown): Promise<CustomAgentGenerateDraftResult> {
    return generateCustomAgentDraft(params, {
      existingNames: this.listAgents().map((agent) => agent.name),
      checkName: (candidate) => this.checkAgentName(candidate),
    });
  }

  listSkills(params?: unknown): SkillRegistry {
    return this.skillRegistry.snapshot(params as Parameters<RuntimeSkillRegistry["snapshot"]>[0]);
  }

  getSkill(params: unknown): SkillDetail {
    return this.skillRegistry.get(params);
  }

  getSkillFile(params: SkillFileGetParams | unknown): SkillPackageFileContent {
    return this.skillRegistry.getFile(params);
  }

  getLongTermMemory() {
    return this.longTermMemory.get();
  }

  clearLongTermMemory() {
    return this.longTermMemory.clear();
  }

  async flushLongTermMemoryUpdates(): Promise<void> {
    await this.longTermMemoryQueue.flush();
  }

  createSkill(params: SkillCreateParams | unknown): SkillDetail {
    return this.skillRegistry.create(params);
  }

  updateSkill(params: SkillUpdateParams | unknown): SkillDetail {
    return this.skillRegistry.update(params);
  }

  upsertSkillFile(params: SkillFileUpsertParams | unknown): SkillDetail {
    return this.skillRegistry.upsertFile(params);
  }

  deleteSkill(params: unknown): { deleted: true; name: string } {
    return this.skillRegistry.delete(params);
  }

  deleteSkillFile(params: SkillFileDeleteParams | unknown): SkillDetail {
    return this.skillRegistry.deleteFile(params);
  }

  checkSkillName(params: unknown): SkillCheckNameResult {
    return this.skillRegistry.checkName(params);
  }

  setSkillEnabled(params: SkillSetEnabledParams | unknown): SkillDetail {
    return this.skillRegistry.setEnabled(params);
  }

  async startRun(params: unknown): Promise<RunHandle> {
    const parsed = StartRunParamsSchema.parse(params);
    const {
      session,
      input,
      fullConfig,
      modeSpec,
      definition,
      runId,
      turnIndex,
    } = await this.runStartService.prepare({
      sessionId: parsed.sessionId,
      input: parsed.input,
      config: parsed.config,
    });
    if (turnIndex === 1) {
      const earlyTitle = await generateSessionTitleFromPrompt(input.prompt, fullConfig, session.title);
      if (earlyTitle) {
        this.updateSessionTitle(session.sessionId, earlyTitle);
      }
    }
    const conversationMessages = await this.prepareConversationMessagesForRun(
      session.sessionId,
      input.prompt,
      fullConfig,
      turnIndex,
      runId,
    );
    this.appendRunStartedToLedger({
      sessionId: session.sessionId,
      runId,
      turnIndex,
      input,
      config: fullConfig,
      modeId: modeSpec.id,
      createdAt: input.createdAt,
    });
    this.consumeAcceptedPlanHandoffForStartedRun(session.sessionId, fullConfig, runId);
    if (fullConfig.metadata.evaluationRouterOnly === true) {
      const baseSnapshot = createRunningRunSnapshot({
        runId,
        sessionId: session.sessionId,
        turnIndex,
        input,
        config: fullConfig,
        modeSpec,
        definition,
        clock: this.clock,
      });
      const completedAt = this.now();
      const routerOnlySnapshot = StateSnapshotSchema.parse({
        ...baseSnapshot,
        status: "succeeded",
        plan: baseSnapshot.plan.map((item) => ({ ...item, status: "skipped" as const })),
        todos: baseSnapshot.todos.map((item) => ({ ...item, status: "skipped" as const, updatedAt: completedAt })),
        activeAgents: [],
        queueSummary: {
          ...baseSnapshot.queueSummary,
          pending: 0,
          inProgress: 0,
          completed: definition.planTemplate.length,
        },
        output: {
          text: routerOnlyRunOutputText(modeSpec.id),
          selectedModeId: modeSpec.id,
          autoModeRouter: fullConfig.metadata.autoModeRouter,
        },
        updatedAt: completedAt,
      });
      const tracedSnapshot = this.normalizeSnapshotForPersistence(attachTraceMetadata(routerOnlySnapshot));
      this.appendRuntimeEventBatchToLedger(tracedSnapshot, tracedSnapshot.events, tracedSnapshot.status);
      const projectedSnapshot = this.appendAssistantMessageToLedger(tracedSnapshot);
      this.persistRun(projectedSnapshot);
      return toRunHandle(projectedSnapshot);
    }
    const sessionBoundSnapshot = await this.runKernelExecutionService.executePreparedRun({
      runId,
      input,
      config: fullConfig,
      modeSpec,
      definition,
      sessionId: session.sessionId,
      turnIndex,
      conversationMessages,
    });
    const tracedSnapshot = this.normalizeSnapshotForPersistence(attachTraceMetadata(this.withSnapshotContextState(sessionBoundSnapshot)));
    this.appendRuntimeEventBatchToLedger(tracedSnapshot, tracedSnapshot.events, tracedSnapshot.status);
    const projectedSnapshot = this.appendAssistantMessageToLedger(tracedSnapshot);
    await this.persistRunWithGeneratedTitle(projectedSnapshot);
    return toRunHandle(projectedSnapshot);
  }

  async createFlow(params: unknown) {
    const handle = await this.startRun(params);
    return toFlowRunHandle(this.getRunState({ runId: handle.runId }));
  }

  async startStreamingRun(params: unknown, options: StreamingRunOptions = {}): Promise<RunHandle> {
    const latencyMarks: RunLatencyMark[] = [];
    const markRuntimeLatency = (name: string, detail: Record<string, unknown> = {}) => {
      latencyMarks.push(runLatencyMark("runtime", name, this.now(), detail));
    };
    markRuntimeLatency("startStreamingRun.enter");
    const parsed = StartRunParamsSchema.parse(params);
    const {
      session,
      input,
      resolved,
      fullConfig,
      modeSpec,
      definition,
      runId,
      turnIndex,
    } = await this.runStartService.prepare({
      sessionId: parsed.sessionId,
      input: parsed.input,
      config: parsed.config,
    });
    markRuntimeLatency("modeSelection.done", {
      modeSelection: resolved.fullConfig.modeSelection,
      modeId: modeSpec.id,
    });
    markRuntimeLatency("memoryPrompt.done", {
      hasMemoryPromptOverlay: typeof fullConfig.metadata.memoryPromptOverlay === "string",
      activeMemoryDecision: isRecord(fullConfig.metadata.activeMemory) ? fullConfig.metadata.activeMemory.decision : undefined,
    });
    if (turnIndex === 1 && fullConfig.metadata.branchRole !== "candidate") {
      generateSessionTitleFromPrompt(input.prompt, fullConfig, session.title).then((earlyTitle) => {
        if (earlyTitle) this.updateSessionTitle(session.sessionId, earlyTitle);
      });
    }
    const conversationMessages = await this.prepareConversationMessagesForRun(
      session.sessionId,
      input.prompt,
      fullConfig,
      turnIndex,
      runId,
    );
    markRuntimeLatency("conversationMessages.done", { messageCount: conversationMessages.length });
    let liveSnapshot = createRunningRunSnapshot({
      runId,
      sessionId: session.sessionId,
      turnIndex,
      input,
      config: fullConfig,
      modeSpec,
      definition,
      clock: this.clock,
    });
    this.appendRunStartedToLedger({
      sessionId: session.sessionId,
      runId,
      turnIndex,
      input,
      config: fullConfig,
      modeId: modeSpec.id,
      createdAt: input.createdAt,
    });
    this.consumeAcceptedPlanHandoffForStartedRun(session.sessionId, fullConfig, runId);
    markRuntimeLatency("snapshot.created");
    liveSnapshot = withRunLatencyMarks(liveSnapshot, latencyMarks);
    const sessionCtx = this.sessions.get(session.sessionId)?.contextState;
    if (sessionCtx) {
      liveSnapshot = { ...liveSnapshot, contextState: normalizeContextState(sessionCtx) };
    }
    this.persistRun(liveSnapshot);
    liveSnapshot = appendFirstRunLatencyMark(liveSnapshot, runLatencyMark("runtime", "snapshotPersisted", this.now()));
    liveSnapshot = appendFirstRunLatencyMark(liveSnapshot, runLatencyMark("runtime", "kernelScheduled", this.now()));
    this.cacheRun(liveSnapshot, false, { deferInitialTitle: true });
    const abortController = this.runStreamingService.createAbortController(runId);
    const streamingSession = this.runStreamingService.createSession({
      runId,
      liveSnapshot,
      ledgeredEventCount: 0,
      onStream: options.onStream,
      shouldIgnoreEvent: () => abortController.signal.aborted || this.isRunCancelled(runId),
      applyEvent: (snapshot, event) => applyStreamingRunEvent(
        markLatencyForRunEvent(snapshot, event, this.now()),
        event,
      ),
    });
    streamingSession.publish([], liveSnapshot);

    const applyLiveEvent = (event: OraEventEnvelope) => {
      liveSnapshot = streamingSession.applyLiveEvent(event) ?? liveSnapshot;
    };

    const runKernel = () => this.runKernelExecutionService.executePreparedRun({
      runId,
      input,
      config: fullConfig,
      modeSpec,
      definition,
      sessionId: session.sessionId,
      turnIndex,
      conversationMessages,
      streamProvider: true,
      signal: abortController.signal,
      onEvent: applyLiveEvent,
    });
    setTimeout(() => {
      (globalThis as any).__latencyKernelStart = Date.now();
      void runKernel().then(async (snapshot) => {
      this.runStreamingService.deleteAbortController(runId);
      const cancelled = this.cancelledSnapshot(runId);
      if (cancelled) {
        liveSnapshot = streamingSession.replaceSnapshot(cancelled);
        streamingSession.publish([], cancelled);
        return;
      }
      const finalSnapshot = this.normalizeSnapshotForPersistence(
        attachTraceMetadata(this.withSnapshotContextState(withRunLatencyMarks(snapshot, liveSnapshot.latency?.marks ?? []))),
      );
      liveSnapshot = streamingSession.replaceSnapshot(finalSnapshot);
      liveSnapshot = streamingSession.flushLedgerEvents(finalSnapshot.status);
      const projectedSnapshot = this.appendAssistantMessageToLedger(finalSnapshot);
      await this.persistRunWithGeneratedTitle(projectedSnapshot);
      liveSnapshot = streamingSession.replaceSnapshot(projectedSnapshot);
      streamingSession.publish([], projectedSnapshot);
    }).catch(async (error) => {
      this.runStreamingService.deleteAbortController(runId);
      const cancelled = this.cancelledSnapshot(runId);
      if (cancelled) {
        liveSnapshot = streamingSession.replaceSnapshot(cancelled);
        streamingSession.publish([], cancelled);
        return;
      }
      const failure = createStreamingFailure({
        liveSnapshot,
        runId,
        pattern: fullConfig.pattern,
        error,
        failedAt: this.now(),
      });
      liveSnapshot = streamingSession.replaceSnapshot(attachTraceMetadata(failure.snapshot));
      liveSnapshot = streamingSession.flushLedgerEvents(liveSnapshot.status);
      const projectedSnapshot = this.appendAssistantMessageToLedger(liveSnapshot);
      await this.persistRunWithGeneratedTitle(projectedSnapshot);
      liveSnapshot = streamingSession.replaceSnapshot(projectedSnapshot);
      streamingSession.publish([failure.event], projectedSnapshot);
      });
    }, 0);

    return toRunHandle(liveSnapshot);
  }

  async createStreamingFlow(params: unknown, options: StreamingRunOptions = {}) {
    const handle = await this.startStreamingRun(params, options);
    return toFlowRunHandle(this.getRunState({ runId: handle.runId }));
  }

  private approvedFileWriteResumeDeps(): ApprovedFileWriteResumeDeps {
    return {
      skillRegistry: this.skillRegistry,
      now: () => this.now(),
      appendEvent: (snapshot, type, payload, extra) => this.appendEvent(snapshot, type, payload, extra),
      attachTraceMetadata: (snapshot) => attachTraceMetadata(snapshot),
      buildConversationMessages: (sessionId, currentPrompt, excludeRunId) =>
        this.buildConversationMessages(sessionId, currentPrompt, excludeRunId),
    };
  }

  private assertResumeStrategyBoundary(params: {
    snapshot: StateSnapshot;
    approvedActionIds: string[];
    hasKernelWork: boolean;
    strategy: RunResumeStrategy;
  }): void {
    const continuationActionIds = approvedToolContinuationActions(
      params.snapshot,
      params.approvedActionIds,
    ).map((action) => action.id);
    const sameIds = (left: string[], right: string[]) =>
      left.length === right.length && left.every((value, index) => value === right[index]);
    if (!sameIds(params.strategy.approvedActionIds, params.approvedActionIds)) {
      throw new OraRuntimeError("Run resume strategy approved actions diverged from LocalRunStore sources.", -32004, {
        runId: params.snapshot.runId,
      });
    }
    if (continuationActionIds.length > 0) {
      if (
        params.strategy.kind !== "approved_tool_continuation" ||
        !sameIds(params.strategy.continuationActionIds, continuationActionIds) ||
        params.strategy.continueKernelAfterTool !== params.hasKernelWork
      ) {
        throw new OraRuntimeError("Run resume strategy approved-tool boundary diverged from LocalRunStore sources.", -32004, {
          runId: params.snapshot.runId,
        });
      }
      return;
    }
    const expectedKind = params.hasKernelWork ? "kernel" : "non_kernel";
    if (params.strategy.kind !== expectedKind) {
      throw new OraRuntimeError("Run resume strategy kind diverged from LocalRunStore sources.", -32004, {
        runId: params.snapshot.runId,
      });
    }
  }

  async resumeStreamingRun(params: unknown, options: StreamingRunOptions = {}): Promise<RunHandle> {
    const {
      parsed,
      snapshot,
      clarificationPatch,
      approvedActionIds,
      approvedActions,
      gateResolutions,
      hasKernelWork,
      strategy,
    } = this.runResumeService.prepare(params);
    this.assertResumeStrategyBoundary({ snapshot, approvedActionIds, hasKernelWork, strategy });

    if (!hasKernelWork) {
      const resumed = await this.resumeRun(params);
      publishRunStream({
        onStream: options.onStream,
        runId: resumed.runId,
        events: [],
        liveSnapshot: resumed,
        snapshot: resumed,
      });
      return toRunHandle(resumed);
    }
    this.appendGateResolutionsForResume(snapshot, gateResolutions);

    const modeSpec = snapshot.modeSpec;
    if (!modeSpec) {
      throw new OraRuntimeError("Cannot resume a kernel-backed run without modeSpec.", -32004, {
        runId: snapshot.runId,
      });
    }
    const sessionId = snapshot.sessionId;
    if (!sessionId) {
      throw new OraRuntimeError("Cannot resume a kernel-backed run without sessionId.", -32004, {
        runId: snapshot.runId,
      });
    }

    let liveSnapshot = runningSnapshotForApprovedActions(snapshot, approvedActionIds, this.now());
    this.persistRun(liveSnapshot);
    const abortController = this.runStreamingService.createAbortController(snapshot.runId);
    const streamingSession = this.runStreamingService.createSession({
      runId: snapshot.runId,
      liveSnapshot,
      ledgeredEventCount: snapshot.events.length,
      onStream: options.onStream,
      shouldIgnoreEvent: () => abortController.signal.aborted || this.isRunCancelled(snapshot.runId),
    });
    streamingSession.publish([], liveSnapshot);

    if (approvedToolContinuationActions(snapshot, approvedActionIds).length > 0) {
      void executeApprovedToolContinuationStrategy({
        snapshot,
        approvedActionIds,
        reason: parsed.reason,
        patch: parsed.patch,
        deps: this.approvedFileWriteResumeDeps(),
        onEvent: (event, nextSnapshot) => {
          liveSnapshot = streamingSession.acceptSnapshotForEvent(event, nextSnapshot) ?? liveSnapshot;
        },
      }).then(async (result) => {
        if (!result) {
          this.runStreamingService.deleteAbortController(snapshot.runId);
          return;
        }
        const cancelled = this.cancelledSnapshot(snapshot.runId);
        if (cancelled) {
          this.runStreamingService.deleteAbortController(snapshot.runId);
          liveSnapshot = streamingSession.replaceSnapshot(cancelled);
          streamingSession.publish([], cancelled);
          return;
        }
        let completedSnapshot: StateSnapshot;
        if (result.kind === "continue") {
          const continuationSnapshot = result.snapshot;
          liveSnapshot = streamingSession.replaceSnapshot(continuationSnapshot);
          completedSnapshot = await this.runKernelExecutionService.continueAfterApprovedTool({
            originalSnapshot: snapshot,
            continuationSnapshot,
            clarificationPatch,
            approvedActionIds,
            signal: abortController.signal,
            onEvent: (event, baseSeq) => {
              const rebasedEvent = rebaseRunEvent(event, snapshot.runId, baseSeq);
              liveSnapshot = streamingSession.applyLiveEvent(rebasedEvent) ?? liveSnapshot;
            },
          });
        } else {
          completedSnapshot = result.snapshot;
        }
        this.runStreamingService.deleteAbortController(snapshot.runId);
        const cancelledAfterContinuation = this.cancelledSnapshot(snapshot.runId);
        if (cancelledAfterContinuation) {
          liveSnapshot = streamingSession.replaceSnapshot(cancelledAfterContinuation);
          streamingSession.publish([], cancelledAfterContinuation);
          return;
        }
        liveSnapshot = await this.runResumeFinalizationService.persistStreamingTerminal({
          snapshot: completedSnapshot,
          original: snapshot,
          clarificationPatch,
          approvedActionIds,
          stream: streamingSession,
        });
      }).catch(async (error) => {
        this.runStreamingService.deleteAbortController(snapshot.runId);
        const cancelled = this.cancelledSnapshot(snapshot.runId);
        if (cancelled) {
          liveSnapshot = streamingSession.replaceSnapshot(cancelled);
          streamingSession.publish([], cancelled);
          return;
        }
        const failure = createStreamingFailure({
          liveSnapshot,
          runId: snapshot.runId,
          pattern: snapshot.config.pattern,
          error,
          failedAt: this.now(),
        });
        liveSnapshot = await this.runResumeFinalizationService.persistStreamingFailure({
          snapshot: attachTraceMetadata(failure.snapshot),
          events: [failure.event],
          stream: streamingSession,
        });
      });
      return toRunHandle(liveSnapshot);
    }

    const baseSeq = snapshot.events.length;
    const applyLiveEvent = (event: OraEventEnvelope) => {
      const rebasedEvent = rebaseRunEvent(event, snapshot.runId, baseSeq);
      liveSnapshot = streamingSession.applyLiveEvent(rebasedEvent) ?? liveSnapshot;
    };

    void this.runKernelExecutionService.executeKernelResumeWork({
      snapshot,
      clarificationPatch,
      approvedActionIds,
      approvedActions,
      signal: abortController.signal,
      onEvent: applyLiveEvent,
    }).then(async (nextSnapshot) => {
      this.runStreamingService.deleteAbortController(snapshot.runId);
      const cancelled = this.cancelledSnapshot(snapshot.runId);
      if (cancelled) {
        liveSnapshot = streamingSession.replaceSnapshot(cancelled);
        streamingSession.publish([], cancelled);
        return;
      }
      const finalSnapshot = this.normalizeSnapshotForPersistence(this.appendResolvedClarificationEvents(
        attachTraceMetadata(nextSnapshot),
        currentPendingClarifications(snapshot),
        clarificationPatch,
      ));
      liveSnapshot = await this.runResumeFinalizationService.persistStreamingTerminal({
        snapshot: finalSnapshot,
        original: snapshot,
        clarificationPatch,
        approvedActionIds,
        stream: streamingSession,
        markLedgerSynced: true,
      });
    }).catch(async (error) => {
      this.runStreamingService.deleteAbortController(snapshot.runId);
      const cancelled = this.cancelledSnapshot(snapshot.runId);
      if (cancelled) {
        liveSnapshot = streamingSession.replaceSnapshot(cancelled);
        streamingSession.publish([], cancelled);
        return;
      }
      const failure = createStreamingFailure({
        liveSnapshot,
        runId: snapshot.runId,
        pattern: snapshot.config.pattern,
        error,
        failedAt: this.now(),
      });
      liveSnapshot = await this.runResumeFinalizationService.persistStreamingFailure({
        snapshot: attachTraceMetadata(failure.snapshot),
        events: [failure.event],
        stream: streamingSession,
      });
    });

    return toRunHandle(liveSnapshot);
  }

  async startRunWithKernel(
    params: unknown,
    forkedFrom?: { runId: string; checkpointId: string; eventSeq: number }
  ): Promise<RunHandle> {
    const parsed = StartRunParamsSchema.parse(params);
    const session = this.ensureSessionForRun(parsed.sessionId, parsed.input);
    const input = this.enrichInputForSession(UserTaskInputSchema.parse({
      ...parsed.input,
      createdAt: parsed.input.createdAt ?? this.now()
    }), session);
    const resolved = await resolveModeSelection(parsed.config, input, session, this.modeSelectionDeps());
    const { modeSpec, definition } = resolved;
    const fullConfig = withMemoryPrompt(resolved.fullConfig, input, session, this.modeSelectionDeps());
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
    if (turnIndex === 1 && fullConfig.metadata.branchRole !== "candidate") {
      const earlyTitle = await generateSessionTitleFromPrompt(input.prompt, fullConfig, session.title);
      if (earlyTitle) {
        this.updateSessionTitle(session.sessionId, earlyTitle);
      }
    }
    const conversationMessages = await this.prepareConversationMessagesForRun(
      session.sessionId,
      input.prompt,
      fullConfig,
      turnIndex,
      runId,
    );
    this.appendRunStartedToLedger({
      sessionId: session.sessionId,
      runId,
      turnIndex,
      input,
      config: fullConfig,
      modeId: modeSpec.id,
      createdAt: input.createdAt,
    });
    this.consumeAcceptedPlanHandoffForStartedRun(session.sessionId, fullConfig, runId);
    const sessionBoundSnapshot = await this.runKernelExecutionService.executePreparedRun({
      runId,
      input,
      config: fullConfig,
      modeSpec,
      definition,
      sessionId: session.sessionId,
      turnIndex,
      forkedFrom,
      conversationMessages,
    });
    const tracedSnapshot = this.normalizeSnapshotForPersistence(attachTraceMetadata(this.withSnapshotContextState(sessionBoundSnapshot)));
    this.appendRuntimeEventBatchToLedger(tracedSnapshot, tracedSnapshot.events, tracedSnapshot.status);
    const projectedSnapshot = this.appendAssistantMessageToLedger(tracedSnapshot);
    await this.persistRunWithGeneratedTitle(projectedSnapshot);
    return toRunHandle(projectedSnapshot);
  }

  async startRunWithSnapshot(
    params: unknown,
    createSnapshot: (args: {
      runId: string;
      input: UserTaskInput;
      config: RunConfig;
      modeSpec: ModeSpec;
      definition: PatternDefinition;
      sessionId: string;
      turnIndex: number;
      conversationMessages: ModelMessage[];
      customAgentOverlay?: string;
      systemAgentOverlays?: Record<string, string>;
      customAgentContexts?: Record<string, Pick<CustomAgentDetail, "model" | "skillIds" | "toolIds"> & { overlay: string }>;
    }) => Promise<StateSnapshot | undefined>
  ): Promise<RunHandle | undefined> {
    const parsed = StartRunParamsSchema.parse(params);
    const session = this.ensureSessionForRun(parsed.sessionId, parsed.input);
    const input = this.enrichInputForSession(UserTaskInputSchema.parse({
      ...parsed.input,
      createdAt: parsed.input.createdAt ?? this.now()
    }), session);
    const resolved = await resolveModeSelection(parsed.config, input, session, this.modeSelectionDeps());
    const { modeSpec, definition } = resolved;
    const fullConfig = withMemoryPrompt(resolved.fullConfig, input, session, this.modeSelectionDeps());
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
    const conversationMessages = await this.prepareConversationMessagesForRun(
      session.sessionId,
      input.prompt,
      fullConfig,
      turnIndex,
      runId,
    );
    this.appendRunStartedToLedger({
      sessionId: session.sessionId,
      runId,
      turnIndex,
      input,
      config: fullConfig,
      modeId: modeSpec.id,
      createdAt: input.createdAt,
    });
    this.consumeAcceptedPlanHandoffForStartedRun(session.sessionId, fullConfig, runId);
    const snapshot = await createSnapshot({
      runId,
      input,
      config: fullConfig,
      modeSpec,
      definition,
      sessionId: session.sessionId,
      turnIndex,
      conversationMessages,
      customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
      systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.customAgentContextsForMode(modeSpec),
    });
    if (!snapshot) {
      return undefined;
    }

    const sessionBoundSnapshot = this.normalizeSnapshotForPersistence(attachTraceMetadata(this.withSnapshotContextState(StateSnapshotSchema.parse({
      ...snapshot,
      sessionId: session.sessionId,
      turnIndex,
      coordinationKind: snapshot.coordinationKind ?? snapshot.pattern,
      modeId: snapshot.modeId ?? modeSpec.id,
      modeSpec: snapshot.modeSpec ?? modeSpec,
    }))));
    this.appendRuntimeEventBatchToLedger(sessionBoundSnapshot, sessionBoundSnapshot.events, sessionBoundSnapshot.status);
    const projectedSnapshot = this.appendAssistantMessageToLedger(sessionBoundSnapshot);
    await this.persistRunWithGeneratedTitle(projectedSnapshot);
    return toRunHandle(projectedSnapshot);
  }

  streamRun(params: unknown): RunEventStream {
    const parsed = RunStreamParamsSchema.parse(params);
    const projected = this.ledgerRebasedRunSnapshot(parsed.runId);
    if (projected) {
      const fromSeq = parsed.afterSeq === undefined ? 0 : parsed.afterSeq + 1;
      const normalized = attachTraceMetadata(projected);
      const settled = normalized.status !== "queued" && normalized.status !== "running";
      return RunEventStreamSchema.parse({
        runId: normalized.runId,
        fromSeq,
        events: normalized.events.filter((event) => event.seq >= fromSeq).sort((a, b) => a.seq - b.seq),
        nextSeq: normalized.events.length,
        status: normalized.status,
        snapshot: settled ? normalized : undefined,
      });
    }
    return streamRun(params, this.runStateOperationDeps());
  }

  interruptRun(params: unknown): StateSnapshot {
    const runId = this.requireRunId(params);
    this.runStreamingService.abort(runId, USER_INTERRUPTED_MESSAGE);
    return interruptRun(params, this.runStateOperationDeps(), USER_INTERRUPTED_MESSAGE);
  }

  async resumeRun(params: unknown): Promise<StateSnapshot> {
    const {
      parsed,
      snapshot,
      clarificationPatch,
      approvedActionIds,
      approvedActions,
      gateResolutions,
      hasKernelWork,
      strategy,
    } = this.runResumeService.prepare(params);
    this.assertResumeStrategyBoundary({ snapshot, approvedActionIds, hasKernelWork, strategy });
    this.appendGateResolutionsForResume(snapshot, gateResolutions);
    let liveSnapshot = this.markResumeRunning(snapshot, approvedActionIds);

    try {
      const approvedToolContinuation = await executeApprovedToolContinuationStrategy({
        snapshot,
        approvedActionIds,
        reason: parsed.reason,
        patch: parsed.patch,
        deps: this.approvedFileWriteResumeDeps(),
      });
      if (approvedToolContinuation) {
        const completedApprovedTool = approvedToolContinuation.kind === "continue"
          ? await this.runKernelExecutionService.continueAfterApprovedTool({
            originalSnapshot: snapshot,
            continuationSnapshot: approvedToolContinuation.snapshot,
            clarificationPatch,
            approvedActionIds,
          })
          : approvedToolContinuation.snapshot;
        return this.runResumeFinalizationService.persistTerminal({
          snapshot: completedApprovedTool,
          original: snapshot,
          clarificationPatch,
          approvedActionIds,
        });
      }
      if (hasKernelWork) {
        const resumedSnapshot = await this.runKernelExecutionService.executeKernelResumeWork({
          snapshot,
          clarificationPatch,
          approvedActionIds,
          approvedActions,
        });
        const tracedSnapshot = this.appendResolvedClarificationEvents(
          attachTraceMetadata(resumedSnapshot),
          currentPendingClarifications(snapshot),
          clarificationPatch,
        );
        return this.runResumeFinalizationService.persistTerminal({
          snapshot: tracedSnapshot,
          original: snapshot,
          clarificationPatch,
          approvedActionIds,
        });
      }

      const resumeMutationDeps = {
        appendEvent: (
          target: StateSnapshot,
          type: OraEventEnvelope["type"],
          payload: unknown,
          extra?: Partial<OraEventEnvelope>,
        ) => this.appendEvent(target, type, payload, extra),
        now: () => this.now(),
        syncTodos: (target: StateSnapshot, reason: string) => this.syncSnapshotTodos(target, reason),
      };

      const nonKernelResume = executeNonKernelResumeStrategy({
        snapshot,
        reason: parsed.reason ?? USER_RESUMED_MESSAGE,
        patch: parsed.patch,
        clarificationPatch,
        deps: resumeMutationDeps,
      });

      if (nonKernelResume.kind === "needs_input") {
        return this.runResumeFinalizationService.persistInterrupted({
          snapshot: nonKernelResume.snapshot,
          original: snapshot,
          clarificationPatch,
          approvedActionIds,
        });
      }

      return this.runResumeFinalizationService.persistTerminal({
        snapshot: nonKernelResume.snapshot,
        original: snapshot,
        clarificationPatch,
        approvedActionIds,
      });
    } catch (error) {
      const failure = createStreamingFailure({
        liveSnapshot,
        runId: snapshot.runId,
        pattern: snapshot.config.pattern,
        error,
        failedAt: this.now(),
      });
      liveSnapshot = await this.runResumeFinalizationService.persistTerminal({
        snapshot: attachTraceMetadata(failure.snapshot),
        original: snapshot,
        clarificationPatch,
        approvedActionIds,
      });
      return liveSnapshot;
    }
  }

  cancelRun(params: unknown): StateSnapshot {
    const runId = this.requireRunId(params);
    this.runStreamingService.abort(runId, USER_CANCELLED_MESSAGE);
    return cancelRun(params, this.runStateOperationDeps(), USER_CANCELLED_MESSAGE);
  }

  getRunState(params: unknown): StateSnapshot {
    const runId = this.requireRunId(params);
    const projected = this.ledgerRebasedRunSnapshot(runId);
    if (projected) {
      this.runs.set(runId, projected);
      return attachTraceMetadata(projected);
    }
    return getRunState(params, this.runStateOperationDeps());
  }

  getFlowRun(params: unknown) {
    const runId = this.requireFlowRunId(params);
    return toFlowRunDetail(this.getRunState({ runId }));
  }

  persistExternalSnapshot(snapshot: StateSnapshot): StateSnapshot {
    const parsed = StateSnapshotSchema.parse(snapshot);
    if (parsed.sessionId && this.isLedgerBackedSession(parsed.sessionId)) {
      const ledger = this.backend.getSessionLedger(parsed.sessionId);
      if (!ledger || !deriveRunSnapshot(ledger, parsed.runId)) {
        this.appendRunStartedToLedger({
          sessionId: parsed.sessionId,
          runId: parsed.runId,
          turnIndex: parsed.turnIndex,
          input: parsed.input,
          config: parsed.config,
          modeId: parsed.modeId,
          createdAt: parsed.input.createdAt ?? parsed.updatedAt,
        });
      }
      const projected = this.appendRunSnapshotUpdateToLedger(this.normalizeSnapshotForPersistence(parsed));
      this.persistRun(projected);
      return projected;
    }
    return persistExternalSnapshot(parsed, this.runStateOperationDeps());
  }

  async getRunTrail(params: unknown): Promise<RunTrail> {
    const parsed = RunTrailParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    const localTrail = synthesizeLocalTrail(snapshot, snapshot.trace);
    const langfuseTrail = await readLangfuseRunTrace(snapshot.runId, snapshot.trace);
    const useLangfuseTrace =
      langfuseTrail.trace.enabled
      && (langfuseTrail.trace.source === "managed_local" || langfuseTrail.trace.provider === "langfuse")
      && (langfuseTrail.observations.length > 0 || langfuseTrail.trace.traceId !== undefined);
    const trace = useLangfuseTrace ? langfuseTrail.trace : localTrail.trace;
    const observations = useLangfuseTrace
      ? mergeTrailObservations(localTrail.observations, langfuseTrail.observations)
      : localTrail.observations;
    return RunTrailSchema.parse({
      run: toRunSummary(snapshot),
      trace,
      observations,
      liveMetrics: buildRunTrailMetrics(snapshot, trace, observations),
    });
  }

  listCheckpoints(params: unknown): CheckpointMeta[] {
    return listCheckpoints(params, this.runStateOperationDeps());
  }

  listFlowCheckpoints(params: unknown): CheckpointMeta[] {
    return this.listCheckpoints({ runId: this.requireFlowRunId(params) });
  }

  replayRun(params: unknown): RunEventStream {
    const parsed = RunReplayParamsSchema.parse(params);
    const projected = this.ledgerProjectedRunSnapshot(parsed.runId);
    if (projected) {
      return this.replayRunFromSnapshot(projected, parsed.checkpointId);
    }
    return replayRun(params, this.runStateOperationDeps());
  }

  async forkRun(params: unknown): Promise<RunHandle> {
    const parsed = RunForkParamsSchema.parse(params);
    const source = this.getRunOrThrow(parsed.runId);
    const checkpoint = source.checkpoints.find((candidate) => candidate.id === parsed.checkpointId);
    if (!checkpoint) {
      throw new OraRuntimeError(`Checkpoint not found: ${parsed.checkpointId}`, -32004, {
        runId: parsed.runId,
        checkpointId: parsed.checkpointId
      });
    }

    const forkHandle = await this.startRunWithKernel({
      sessionId: source.sessionId,
      input: {
        ...source.input,
        ...parsed.input,
        context: {
          ...source.input.context,
          ...(parsed.input?.context ?? {}),
          forkedFrom: {
            runId: source.runId,
            checkpointId: checkpoint.id,
            eventSeq: checkpoint.eventSeq
          }
        },
        createdAt: undefined
      },
      config: {
        ...source.config,
        ...parsed.config,
        metadata: {
          ...source.config.metadata,
          ...(parsed.config?.metadata ?? {}),
          forkedFromRunId: source.runId,
          forkedFromCheckpointId: checkpoint.id
        }
      }
    }, {
      runId: source.runId,
      checkpointId: checkpoint.id,
      eventSeq: checkpoint.eventSeq
    });
    const continuationFrames = source.continuation.frames.filter((frame) => frame.createdAt <= checkpoint.createdAt);
    if (continuationFrames.length === 0) {
      return forkHandle;
    }

    const forkSnapshot = this.getRunOrThrow(forkHandle.runId);
    const updated = StateSnapshotSchema.parse({
      ...forkSnapshot,
      continuation: {
        frames: continuationFrames.map((frame, index) => ({
          ...frame,
          id: `${forkSnapshot.runId}:forked-continuation:${index}`,
          runId: forkSnapshot.runId,
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
          resumedFromFrameId: frame.id,
        })),
      },
      updatedAt: this.now(),
    });
    const projected = this.appendRunSnapshotUpdateToLedger(updated);
    this.persistRun(projected);
    return toRunHandle(projected);
  }

  async forkFlow(params: unknown) {
    const parsed = RunForkParamsSchema.parse(this.withRunIdFromFlowRunId(params));
    const handle = await this.forkRun(parsed);
    return toFlowRunHandle(this.getRunState({ runId: handle.runId }));
  }

  exportReport(params: unknown): ArtifactRef {
    return exportReport(params, this.runStateOperationDeps());
  }

  importEvaluationDataset(params: unknown) {
    return this.evaluationStore.importDataset(params);
  }

  importEvaluationDatasetFromLangfuse(params: unknown) {
    return this.evaluationStore.importDatasetFromLangfuse(params);
  }

  exportEvaluationDatasetToLangfuse(params: unknown) {
    return this.evaluationStore.exportDatasetToLangfuse(params);
  }

  listEvaluationDatasets(params: unknown = {}) {
    return this.evaluationStore.listDatasets(params);
  }

  getEvaluationDataset(params: unknown) {
    return this.evaluationStore.getDataset(params);
  }

  createEvaluationBlueprint(params: unknown) {
    return this.evaluationStore.createBlueprint(params);
  }

  updateEvaluationBlueprint(params: unknown) {
    return this.evaluationStore.updateBlueprint(params);
  }

  listEvaluationBlueprints(params: unknown = {}) {
    return this.evaluationStore.listBlueprints(params);
  }

  getEvaluationBlueprint(params: unknown) {
    return this.evaluationStore.getBlueprint(params);
  }

  compileEvaluationBlueprint(params: unknown) {
    return this.evaluationStore.compileBlueprint(params);
  }

  generateEvaluationBlueprintDraft(params: unknown) {
    return this.evaluationStore.generateBlueprintDraft(params, generateEvaluationBlueprintDraftWithProvider);
  }

  planEvaluationBlueprintTurn(params: unknown) {
    return this.evaluationStore.planBlueprintTurn(params);
  }

  async startEvaluationRun(
    params: unknown,
    createRun: (params: { input: UserTaskInput; config: Partial<RunConfig> }) => Promise<StateSnapshot>
  ) {
    const evalSession = this.createSession({});
    const evalSessionId = evalSession.sessionId;

    try {
      const detail = await this.evaluationStore.startRun(params, async (runParams) => {
        return createRun({
          input: runParams.input,
          config: {
            ...runParams.config,
            metadata: {
              ...(runParams.config?.metadata ?? {}),
              evalSessionId,
            },
          },
        });
      });

      this.queueSelfIterationCurator("evaluation_run_completed");
      return detail;
    } finally {
      this.archiveSession({ sessionId: evalSessionId });
    }
  }

  listEvaluationRuns(params: unknown = {}) {
    return this.evaluationStore.listRuns(params);
  }

  getEvaluationRun(params: unknown) {
    return this.evaluationStore.getRun(params);
  }

  streamEvaluationRun(params: unknown) {
    return this.evaluationStore.streamRun(params);
  }

  promoteEvaluationBaseline(params: unknown) {
    return this.evaluationStore.promoteBaseline(params);
  }

  listEvaluationBaselines(params: unknown = {}) {
    return this.evaluationStore.listBaselines(params);
  }

  exportEvaluationRun(params: unknown) {
    return this.evaluationStore.exportRun(params);
  }

  cancelEvaluationRun(params: unknown) {
    return this.evaluationStore.cancelEvaluationRun(params);
  }

  resumeEvaluationRun(params: unknown) {
    return this.evaluationStore.resumeEvaluationRun(params);
  }

  generateEvaluationReport(params: unknown) {
    return this.evaluationStore.generateReport(params);
  }

  formatEvaluationReport(params: unknown) {
    return this.evaluationStore.formatReport(params);
  }

  async submitEvaluationFeedback(params: unknown): Promise<EvaluationFeedbackRecord> {
    const runId = this.requireRunId(params);
    const snapshot = attachTraceMetadata(this.getRunOrThrow(runId));
    const sourceContext = await buildFeedbackSourceContext(snapshot, this.feedbackSourceContextDeps());
    const feedback = await this.evaluationStore.submitFeedback(
      params,
      sourceContext,
      ({ feedbackId, feedbackText, sourceContext }) => curateFeedbackDraft(snapshot.config, feedbackId, feedbackText, sourceContext)
    );
    this.queueSelfIterationCurator("feedback_submitted", snapshot.input.projectId);
    return feedback;
  }

  listEvaluationFeedback(params: unknown = {}) {
    return this.evaluationStore.listFeedback(params);
  }

  listEvaluationAnnotations(params: unknown = {}) {
    return this.evaluationStore.listAnnotations(params);
  }

  submitEvaluationAnnotation(params: unknown) {
    return this.evaluationStore.submitAnnotation(params);
  }

  getEvaluationFeedback(params: unknown) {
    return this.evaluationStore.getFeedback(params);
  }

  updateEvaluationFeedback(params: unknown) {
    return this.evaluationStore.updateFeedback(params);
  }

  acceptEvaluationFeedback(params: unknown) {
    const feedback = this.evaluationStore.getFeedback(params);
    const result = this.evaluationStore.acceptFeedback(params);
    this.queueSelfIterationCurator("feedback_accepted", feedback.sourceRunId ? this.runs.get(feedback.sourceRunId)?.input.projectId : undefined);
    return result;
  }

  rejectEvaluationFeedback(params: unknown) {
    return this.evaluationStore.rejectFeedback(params);
  }

  listProjectSignals(params: unknown = {}) {
    return this.feedbackLoopStore.listSignals(params, this.feedbackLoopInput());
  }

  listProjectInsights(params: unknown = {}) {
    return this.feedbackLoopStore.listInsights(params, this.feedbackLoopInput());
  }

  getProjectInsight(params: unknown) {
    return this.feedbackLoopStore.getInsight(params, this.feedbackLoopInput());
  }

  dismissProjectInsight(params: unknown) {
    return this.feedbackLoopStore.dismissInsight(params, this.feedbackLoopInput());
  }

  previewProjectSignalAction(params: unknown) {
    return this.feedbackLoopStore.previewAction(params, this.feedbackLoopInput());
  }

  applyProjectSignalAction(params: unknown) {
    return this.feedbackLoopStore.applyAction(params, this.feedbackLoopInput());
  }

  listFeedbackLoopRules(params: unknown = {}) {
    return this.feedbackLoopStore.listRules(params, this.feedbackLoopInput());
  }

  updateFeedbackLoopRule(params: unknown) {
    return this.feedbackLoopStore.updateRule(params);
  }

  async scanSelfIteration(params: unknown = {}) {
    const result = await this.selfIterationStore.scan(params, this.selfIterationInput(), {
      applyEvaluationCandidate: (candidate) => this.applyEvaluationSelfIterationCandidate(candidate),
    });
    await this.verifyPendingSelfIterationCandidates();
    return result;
  }

  private async verifyPendingSelfIterationCandidates(): Promise<void> {
    const now = this.clock();
    const pending = this.selfIterationStore.listCandidates({ status: "applied" })
      .filter((candidate) => candidate.verification?.status === "pending")
      .filter((candidate) => {
        const hoursSinceApply = (now - candidate.updatedAt) / (60 * 60 * 1000);
        return hoursSinceApply >= 1;
      });
    for (const candidate of pending) {
      if (this.selfIterationStore.isEvaluating(candidate.id)) continue;
      try {
        const impactResult = await this.runSelfIterationImpactEvaluation(candidate);
        const result = impactResult ?? await this.runSelfIterationEvaluation(candidate);
        this.selfIterationStore.updateCandidateVerification(candidate.id, {
          status: result.passed ? "verified" : "regressed",
          lastVerifiedAt: now,
          verifiedRunId: result.evaluationRunId,
        });
      } catch {
        // Verification is best-effort
      }
    }
  }

  listSelfIterationCandidates(params: unknown = {}) {
    return this.selfIterationStore.listCandidates(params);
  }

  getSelfIterationCandidate(params: unknown) {
    return this.selfIterationStore.getCandidate(params);
  }

  evaluateSelfIterationCandidate(params: unknown) {
    return this.selfIterationStore.evaluateCandidate(params, {
      evaluateCandidate: async (candidate) => {
        const safetyResult = await this.runSelfIterationEvaluation(candidate);
        if (candidate.targetKind === "evaluation" || !safetyResult.passed) {
          return safetyResult;
        }
        const impactResult = await this.runSelfIterationImpactEvaluation(candidate);
        if (!impactResult) return safetyResult;
        return {
          ...safetyResult,
          passed: impactResult.passed,
          message: impactResult.message,
          metadata: {
            ...safetyResult.metadata,
            ...(impactResult.impactEvaluation ? { impactEvaluation: impactResult.impactEvaluation } : {}),
          },
        };
      },
    });
  }

  rejectSelfIterationCandidate(params: unknown) {
    return this.selfIterationStore.rejectCandidate(params);
  }

  applySelfIterationCandidate(params: unknown) {
    return this.selfIterationStore.applyCandidate(params, {
      applyEvaluationCandidate: (candidate) => this.applyEvaluationSelfIterationCandidate(candidate),
      applyPromptCandidate: (candidate) => this.applyPromptSelfIterationCandidate(candidate),
      applySkillCandidate: (candidate) => this.applySkillSelfIterationCandidate(candidate),
      applyModeCandidate: (candidate) => this.applyModeSelfIterationCandidate(candidate),
      captureBeforeSnapshot: (candidate) => this.captureSelfIterationBeforeSnapshot(candidate),
    });
  }

  rollbackSelfIterationCandidate(params: unknown) {
    return this.selfIterationStore.rollbackCandidate(params, {
      applyEvaluationCandidate: (candidate) => this.applyEvaluationSelfIterationCandidate(candidate),
      applyPromptCandidate: (candidate) => this.applyPromptSelfIterationCandidate(candidate),
      applySkillCandidate: (candidate) => this.applySkillSelfIterationCandidate(candidate),
      applyModeCandidate: (candidate) => this.applyModeSelfIterationCandidate(candidate),
      rollbackSnapshot: (candidate) => this.rollbackSelfIterationSnapshot(candidate),
    });
  }

  private captureSelfIterationBeforeSnapshot(candidate: SelfIterationCandidate): unknown {
    if (candidate.targetKind === "prompt") {
      const modeId = candidate.targetRef.modeId ?? SINGLE_AGENT_MODE_ID;
      const mode = this.modeStore.get({ modeId });
      const nodeId = candidate.targetRef.nodeId;
      const targetNode = mode.nodes.find((node) => node.id === nodeId) ?? mode.nodes.find((node) => node.enabled) ?? mode.nodes[0];
      return { kind: "prompt", modeId, nodeId: targetNode?.id, prompt: targetNode?.prompt ?? targetNode?.instructions ?? "" };
    }
    if (candidate.targetKind === "mode") {
      const modeId = candidate.targetRef.modeId ?? SINGLE_AGENT_MODE_ID;
      const mode = this.modeStore.get({ modeId });
      return { kind: "mode", modeId, spec: mode };
    }
    if (candidate.targetKind === "skill") {
      const skillName = candidate.targetRef.skillName ?? String(candidate.proposedChange.metadata.skillName ?? "");
      const skill = skillName ? this.skillRegistry.get({ name: skillName }) : undefined;
      return { kind: "skill", skillName, content: skill?.content };
    }
    return { kind: candidate.targetKind };
  }

  private rollbackSelfIterationSnapshot(candidate: SelfIterationCandidate): void {
    const snapshot = candidate.beforeSnapshot as Record<string, unknown> | undefined;
    if (!snapshot) return;
    if (snapshot.kind === "prompt" && typeof snapshot.modeId === "string") {
      const mode = this.modeStore.get({ modeId: snapshot.modeId });
      const nodeId = snapshot.nodeId as string | undefined;
      const targetNode = mode.nodes.find((node) => node.id === nodeId);
      if (!targetNode) return; // mode structure changed, cannot safely rollback
      if (typeof snapshot.prompt === "string") {
        this.modeStore.update({
          modeId: snapshot.modeId,
          spec: modeCreateParamsFromSpec({
            ...mode,
            nodes: mode.nodes.map((node) => node.id === targetNode.id ? { ...node, prompt: snapshot.prompt as string } : node),
          }),
        });
      }
    }
    if (snapshot.kind === "skill" && typeof snapshot.skillName === "string" && typeof snapshot.content === "string") {
      try { this.skillRegistry.delete({ name: snapshot.skillName }); } catch { /* ignore */ }
      this.skillRegistry.create({
        name: snapshot.skillName,
        content: snapshot.content,
        enabled: true,
      });
    }
    if (snapshot.kind === "mode" && typeof snapshot.modeId === "string" && snapshot.spec) {
      const tempId = `${snapshot.modeId}-rollback-tmp-${this.now()}`;
      try {
        this.modeStore.create(modeCreateParamsFromSpec({ ...(snapshot.spec as ModeSpec), id: tempId } as ModeSpec));
        try { this.modeStore.delete({ modeId: snapshot.modeId }); } catch { /* ignore */ }
        this.modeStore.create(modeCreateParamsFromSpec(snapshot.spec as ModeSpec));
      } catch {
        // If create-from-snapshot fails, temp copy preserves the data
      } finally {
        try { this.modeStore.delete({ modeId: tempId }); } catch { /* ignore */ }
      }
    }
  }

  getSelfIterationPolicy(params: unknown = {}) {
    return this.selfIterationStore.getPolicy(params);
  }

  updateSelfIterationPolicy(params: unknown) {
    return this.selfIterationStore.updatePolicy(params);
  }

  private modeSelectionDeps(): ModeSelectionDeps {
    return {
      modeStore: this.modeStore,
      skillRegistry: this.skillRegistry,
      longTermMemory: this.longTermMemory,
      applySystemAgentOverridesToMode: (modeSpec) => this.applySystemAgentOverridesToMode(modeSpec),
      buildConversationMessages: (sessionId, currentPrompt) =>
        this.buildConversationMessages(sessionId, currentPrompt),
    };
  }

  private runStateOperationDeps(): RunStateOperationDeps {
    return {
      backend: this.backend,
      now: () => this.now(),
      requireRunId: (params) => this.requireRunId(params),
      getRunOrThrow: (runId) => this.getRunOrThrow(runId),
      appendEvent: (snapshot, type, payload) => this.appendEvent(snapshot, type, payload),
      persistRun: (snapshot) => {
        const normalized = this.normalizeSnapshotForPersistence(snapshot);
        const projected = this.appendRunSnapshotUpdateToLedger(normalized);
        this.persistRun(projected);
      },
    };
  }

  private projectSessionOperationDeps(): ProjectSessionOperationDeps {
    return {
      projects: this.projects,
      sessions: this.sessions,
      runs: this.runs,
      now: () => this.now(),
      nextProjectId: () => this.nextProjectId(),
      nextSessionId: () => this.nextSessionId(),
      persistProject: (project) => this.persistProject(project),
      persistSession: (session) => this.persistSession(session),
      persistSessionCreated: (session) => this.persistSessionCreated(session),
      getProjectOrThrow: (projectId) => this.getProjectOrThrow(projectId),
      getSessionOrThrow: (sessionId) => this.getSessionOrThrow(sessionId),
      getRunOrThrow: (runId) => this.getRunOrThrow(runId),
      runsForSession: (sessionId) => this.runsForSession(sessionId),
      sessionTranscript: (sessionId) => this.sessionTranscript(sessionId),
      branchGroupsForSession: (sessionId) => this.mergedSessionBranchGroups(sessionId),
    };
  }

  private persistSessionCreated(session: SessionSummary): SessionSummary {
    const entry = this.appendSessionLedgerEntry(session.sessionId, {
      id: `${session.sessionId}:session-created`,
      type: "session.created",
      turnIndex: 0,
      createdAt: session.createdAt,
      payload: {
        title: session.title,
        projectId: session.projectId,
      },
    });
    const projection = this.refreshSessionFromLedger(session.sessionId, entry.id);
    this.backend.saveManifest(this.manifest);
    if (projection.projectId) {
      this.syncProjectSummary(projection.projectId);
    }
    return projection;
  }

  private appendRunStartedToLedger(args: {
    sessionId: string;
    runId: string;
    turnIndex: number;
    input: UserTaskInput;
    config: RunConfig;
    modeId?: string;
    createdAt?: number;
  }): void {
    const createdAt = args.createdAt ?? args.input.createdAt ?? this.now();
    const candidate = args.config.metadata.branchRole === "candidate";
    const entries = this.appendSessionLedgerEntries(args.sessionId, [
      {
        id: `${args.runId}:user`,
        type: "user.message",
        runId: args.runId,
        turnIndex: args.turnIndex,
        createdAt,
        payload: { content: args.input.prompt.trim() || args.input.prompt || " " },
      },
      {
        id: `${args.runId}:started`,
        type: "run.started",
        runId: args.runId,
        turnIndex: args.turnIndex,
        createdAt,
        payload: {
          input: args.input,
          config: args.config,
          modeId: args.modeId,
          status: "running",
        },
      },
    ], { updateLeaf: !candidate, parentId: candidate ? this.backend.getSessionLedger(args.sessionId)?.leafEntryId : undefined });
    if (candidate) {
      const leaf = entries.at(-1)?.id;
      if (leaf) {
        this.runLedgerBranchService.recordCandidateLeaf(args.runId, leaf);
      }
      return;
    }
    this.refreshSessionFromLedger(args.sessionId);
  }

  private appendBranchLifecycleEntry(
    sessionId: string,
    type: Extract<RuntimeSessionEntryType, "branch.created" | "branch.candidate_started" | "branch.dismissed">,
    group: SessionBranchGroup,
    createdAt: number,
    runId?: string,
  ): void {
    if (!this.isLedgerBackedSession(sessionId)) {
      return;
    }
    const suffix = runId ? `${type}:${runId}` : type;
    this.appendSessionLedgerEntry(sessionId, {
      id: `${group.branchGroupId}:${suffix}`,
      type,
      runId,
      turnIndex: group.baseTurnIndex,
      createdAt,
      payload: group,
    });
    this.refreshSessionFromLedger(sessionId);
    this.backend.saveManifest(this.manifest);
  }

  private appendRuntimeEventBatchToLedger(snapshot: StateSnapshot, events: OraEventEnvelope[], status = snapshot.status): StateSnapshot {
    if (!snapshot.sessionId || events.length === 0) {
      return snapshot;
    }
    const ledgerSnapshot = compactRuntimeEventBatchSnapshot(snapshot);
    const entry = this.appendRunLedgerEntry(snapshot, {
      id: `${snapshot.runId}:events-${events[0]?.seq ?? snapshot.events.length}-${events.at(-1)?.seq ?? snapshot.events.length}`,
      type: "runtime.event_batch",
      runId: snapshot.runId,
      turnIndex: snapshot.turnIndex ?? 1,
      createdAt: events.at(-1)?.createdAt ?? snapshot.updatedAt,
      payload: {
        events,
        eventCount: events.length,
        status,
        output: snapshot.output,
        error: snapshot.error,
        snapshot: ledgerSnapshot,
      },
    });
    if (snapshot.config.metadata.branchRole === "candidate") {
      const projected = this.ledgerSnapshotOrFallback(snapshot, entry.id);
      this.runs.set(projected.runId, projected);
      return projected;
    }
    this.refreshSessionFromLedger(snapshot.sessionId);
    const projected = this.ledgerSnapshotOrFallback(snapshot);
    this.runs.set(projected.runId, projected);
    return projected;
  }

  private appendRunSnapshotUpdateToLedger(snapshot: StateSnapshot): StateSnapshot {
    if (!snapshot.sessionId) {
      return snapshot;
    }
    const candidate = snapshot.config.metadata.branchRole === "candidate";
    const ledger = this.backend.getSessionLedger(snapshot.sessionId);
    const candidateLeaf = candidate ? this.candidateLedgerLeaf(snapshot) : undefined;
    const existing = ledger ? deriveRunSnapshot(ledger, snapshot.runId, candidateLeaf ?? ledger.leafEntryId) : undefined;
    const existingEventCount = existing?.events.length ?? 0;
    const events = snapshot.events.slice(existingEventCount);
    const ledgerSnapshot = compactRuntimeEventBatchSnapshot(snapshot);
    const entry = this.appendRunLedgerEntry(snapshot, {
      id: `${snapshot.runId}:update-${snapshot.updatedAt}-${this.ledgerEntryOrdinal(snapshot.sessionId)}`,
      type: "runtime.event_batch",
      runId: snapshot.runId,
      turnIndex: snapshot.turnIndex ?? 1,
      createdAt: snapshot.updatedAt,
      payload: {
        events,
        eventCount: events.length,
        status: snapshot.status,
        output: snapshot.output,
        error: snapshot.error,
        snapshot: ledgerSnapshot,
      },
    }, { candidateParentId: candidateLeaf });
    if (candidate) {
      const factLeafEntryId = this.appendSnapshotBusinessFactsToLedger(snapshot);
      return this.ledgerSnapshotOrFallback(snapshot, factLeafEntryId ?? entry.id);
    }
    this.appendSnapshotBusinessFactsToLedger(snapshot);
    return this.ledgerSnapshotOrFallback(snapshot);
  }

  private markResumeRunning(snapshot: StateSnapshot, approvedActionIds: string[]): StateSnapshot {
    if (!snapshot.sessionId || !this.isLedgerBackedSession(snapshot.sessionId)) {
      return snapshot;
    }
    return this.appendRunSnapshotUpdateToLedger(this.normalizeSnapshotForPersistence(
      runningSnapshotForApprovedActions(snapshot, approvedActionIds, this.now()),
    ));
  }

  private appendGateResolutionsForResume(
    snapshot: StateSnapshot,
    gateResolutions: RuntimeGateResolution[],
  ): void {
    if (!snapshot.sessionId || !this.isLedgerBackedSession(snapshot.sessionId)) {
      return;
    }
    this.runtimeGateLedgerService.appendResumeResolveLifecycle({
      snapshot,
      resolutions: gateResolutions,
      resolvedAt: this.now(),
      appendAdapter: this.gateLifecycleAppendAdapter(snapshot),
    });
  }

  private withResumeResolutionEvents(
    snapshot: StateSnapshot,
    original: StateSnapshot,
    clarificationPatch: Record<string, unknown>,
    approvedActionIds: string[],
  ): StateSnapshot {
    let working = snapshot;
    working = this.appendResolvedClarificationEvents(working, currentPendingClarifications(original), clarificationPatch);
    for (const actionId of approvedActionIds) {
      const hasApprovalResolved = working.events.some((event) =>
        event.type === "approval.resolved" &&
        event.payload &&
        typeof event.payload === "object" &&
        (event.payload as Record<string, unknown>).actionId === actionId
      );
      if (!hasApprovalResolved) {
        working = this.appendEvent(working, "approval.resolved", {
          actionId,
          decision: "approved",
          mode: "resume",
        });
      }
      const action = working.actions.find((candidate) => candidate.id === actionId);
      const call = working.toolCalls.find((candidate) => candidate.actionId === actionId);
      const terminalStatus = action?.status === "succeeded" || action?.status === "failed"
        ? action.status
        : call?.status === "succeeded" || call?.status === "failed"
          ? call.status
          : undefined;
      if (!action || !terminalStatus) {
        continue;
      }
      const hasToolCalled = working.events.some((event) =>
        event.type === "tool.called" &&
        event.payload &&
        typeof event.payload === "object" &&
        (event.payload as Record<string, unknown>).actionId === actionId &&
        (event.payload as Record<string, unknown>).status === terminalStatus
      );
      if (hasToolCalled) {
        continue;
      }
      working = this.appendEvent(working, "tool.called", {
        toolCallId: call?.id,
        actionId,
        toolId: action.type,
        source: "resume",
        status: terminalStatus,
        input: action.input,
        output: action.output,
        error: action.error,
        cacheHit: false,
      });
    }
    return working;
  }

  private appendAssistantMessageToLedger(snapshot: StateSnapshot): StateSnapshot {
    if (!snapshot.sessionId) {
      return snapshot;
    }
    this.appendSnapshotBusinessFactsToLedger(snapshot);
    const content = assistantTextForRun(snapshot);
    const entry = this.appendRunLedgerEntry(snapshot, {
      id: `${snapshot.runId}:assistant`,
      type: "assistant.message",
      runId: snapshot.runId,
      turnIndex: snapshot.turnIndex ?? 1,
      createdAt: snapshot.updatedAt,
      payload: {
        content,
        status: snapshot.status,
        output: snapshot.output ?? (content ? { text: content } : undefined),
        error: snapshot.error,
        snapshot,
      },
    });
    if (snapshot.config.metadata.branchRole === "candidate") {
      return this.ledgerSnapshotOrFallback(snapshot, entry.id);
    }
    return this.ledgerSnapshotOrFallback(snapshot);
  }

  private appendSnapshotBusinessFactsToLedger(snapshot: StateSnapshot): string | undefined {
    if (!snapshot.sessionId) {
      return undefined;
    }
    this.appendOpenedGateFactsForSnapshot(snapshot);
    return snapshot.config.metadata.branchRole === "candidate"
      ? this.runLedgerBranchService.cachedCandidateLeaf(snapshot.runId)
      : undefined;
  }

  private appendOpenedGateFactsForSnapshot(snapshot: StateSnapshot): void {
    if (!snapshot.sessionId) {
      return;
    }
    const ledger = this.backend.getSessionLedger(snapshot.sessionId);
    this.runtimeGateLedgerService.appendSnapshotOpenLifecycle({
      snapshot,
      existingEntryIds: ledger?.entries.map((entry) => entry.id),
      appendAdapter: this.gateLifecycleAppendAdapter(snapshot),
    });
  }

  private gateLifecycleAppendAdapter(snapshot: StateSnapshot): RuntimeGateAppendAdapter {
    return createRuntimeGateRunAppendAdapter({
      snapshot,
      candidateParentId: () => this.candidateLedgerLeaf(snapshot),
      appendRunLedgerEntry: (runSnapshot, entry, options) => this.appendRunLedgerEntry(runSnapshot, entry, options),
    });
  }

  private appendRunLedgerEntry(
    snapshot: Pick<StateSnapshot, "runId" | "sessionId" | "config">,
    entry: Omit<RuntimeSessionEntry, "sessionId" | "seq"> & { type: RuntimeSessionEntryType },
    options: { candidateParentId?: string } = {},
  ): RuntimeSessionEntry {
    return this.runLedgerService.appendRunLedgerEntry(snapshot, entry, options);
  }

  private appendSessionLedgerEntry(
    sessionId: string,
    entry: Omit<RuntimeSessionEntry, "sessionId" | "seq"> & { type: RuntimeSessionEntryType },
    options: { updateLeaf?: boolean; parentId?: string } = {},
  ): RuntimeSessionEntry {
    return this.runLedgerService.appendSessionLedgerEntry(sessionId, entry, options);
  }

  private appendSessionLedgerEntries(
    sessionId: string,
    entries: Array<Omit<RuntimeSessionEntry, "sessionId" | "seq"> & { type: RuntimeSessionEntryType }>,
    options: { updateLeaf?: boolean; parentId?: string } = {},
  ): RuntimeSessionEntry[] {
    return this.runLedgerService.appendSessionLedgerEntries(sessionId, entries, options);
  }

  private applyLedgerToStore(sessionId: string, ledger: RuntimeSessionLedger, leafEntryId?: string): SessionSummary {
    const projection = deriveSessionProjection(ledger, leafEntryId ?? ledger.leafEntryId);
    this.sessions.set(sessionId, projection.session);
    this.sessionLedgerLeafEntryIds.set(sessionId, projection.leafEntryId);
    this.evictOldSessionsIfNeeded();
    const projectedRunIds = new Set(projection.runs.map((run) => run.runId));
    for (const [runId, snapshot] of this.runs.entries()) {
      if (snapshot.sessionId === sessionId && !projectedRunIds.has(runId)) {
        this.runs.delete(runId);
      }
    }
    for (const run of projection.runs) {
      const snapshot = deriveRunSnapshot(ledger, run.runId, projection.leafEntryId);
      if (snapshot) {
        const cached = this.runs.get(snapshot.runId);
        // When the ledger excludes event batches, the derived snapshot has
        // empty events. Preserve streaming fields from the in-memory cache
        // so consumers don't observe truncated run histories.
        if (cached && cached.events.length > 0 && snapshot.events.length === 0) {
          snapshot.events = cached.events;
          snapshot.checkpoints = cached.checkpoints;
          snapshot.toolResults = cached.toolResults;
        }
        this.runs.set(snapshot.runId, snapshot);
      }
    }
    return projection.session;
  }

  private refreshSessionFromLedger(
    sessionId: string,
    leafEntryId?: string,
    options: { excludeEvents?: boolean } = {},
  ): SessionSummary {
    const ledger = options.excludeEvents
      ? this.backend.getSessionLedgerExcludingEvents?.(sessionId)
      : this.backend.getSessionLedger(sessionId);
    if (!ledger) {
      return this.getSessionOrThrow(sessionId);
    }
    const session = this.applyLedgerToStore(sessionId, ledger, leafEntryId ?? ledger.leafEntryId);
    this.sessionRunProjectionModes.set(sessionId, options.excludeEvents ? "slim" : "full");
    return session;
  }

  private applyLedgerSessionSummaryToStore(sessionId: string, ledger: RuntimeSessionLedger, leafEntryId?: string): SessionSummary {
    const projection = deriveSessionProjection(ledger, leafEntryId ?? ledger.leafEntryId);
    const session = this.mergeActiveCachedSessionSummary(projection.session);
    this.sessions.set(sessionId, session);
    this.sessionLedgerLeafEntryIds.set(sessionId, projection.leafEntryId);
    this.sessionRunProjectionModes.delete(sessionId);
    return session;
  }

  private mergeActiveCachedSessionSummary(projected: SessionSummary): SessionSummary {
    const cached = this.sessions.get(projected.sessionId);
    if (
      !cached?.latestRunId ||
      cached.latestRunId !== projected.latestRunId ||
      cached.updatedAt < projected.updatedAt ||
      (cached.status !== "queued" && cached.status !== "running")
    ) {
      return projected;
    }

    const cachedRun = this.runs.get(cached.latestRunId);
    if (
      !cachedRun ||
      cachedRun.sessionId !== projected.sessionId ||
      (cachedRun.status !== "queued" && cachedRun.status !== "running")
    ) {
      return projected;
    }

    return SessionSummarySchema.parse({
      ...projected,
      status: cached.status,
      attention: cached.attention,
      latestRunId: cached.latestRunId,
      latestPattern: cached.latestPattern ?? projected.latestPattern,
      latestModeId: cached.latestModeId ?? projected.latestModeId,
      latestProviderId: cached.latestProviderId ?? projected.latestProviderId,
      latestModelRef: cached.latestModelRef ?? projected.latestModelRef,
      turnCount: Math.max(projected.turnCount, cached.turnCount),
      updatedAt: cached.updatedAt,
    });
  }

  private ensureSessionRunsLoaded(
    sessionId: string,
    options: { includeEvents?: boolean } = {},
  ): void {
    if (!this.isLedgerBackedSession(sessionId)) {
      return;
    }
    const requestedMode = options.includeEvents ? "full" : "slim";
    const currentMode = this.sessionRunProjectionModes.get(sessionId);
    if (
      !this.isSessionLedgerStale(sessionId)
      && (currentMode === "full" || currentMode === requestedMode)
    ) {
      return;
    }
    const ledger = options.includeEvents
      ? this.backend.getSessionLedger(sessionId)
      : this.backend.getSessionLedgerExcludingEvents?.(sessionId) ?? this.backend.getSessionLedger(sessionId);
    if (!ledger) {
      return;
    }
    this.applyLedgerToStore(sessionId, ledger, ledger.leafEntryId);
    this.sessionRunProjectionModes.set(sessionId, requestedMode);
  }

  private refreshSessionSummariesIfStale(): void {
    const revision = this.backend.ledgerRevision?.();
    if (revision && revision === this.sessionLedgerRevision) {
      return;
    }
    const cachedIds = [...this.sessions.keys()];
    if (cachedIds.length === 0) return;
    const ledgers = this.backend.listLedgersExcludingEventsForSessions?.(cachedIds)
      ?? this.backend.listLedgersExcludingEvents?.()
      ?? this.backend.listSessionLedgers();
    for (const ledger of ledgers) {
      this.applyLedgerSessionSummaryToStore(ledger.sessionId, ledger, ledger.leafEntryId);
    }
    this.sessionLedgerRevision = revision ?? this.backend.ledgerRevision?.();
  }

  private refreshAllSessionLedgerProjections(): void {
    const revision = this.backend.ledgerRevision?.();
    if (revision && revision === this.sessionLedgerRevision) {
      return;
    }
    const cachedIds = [...this.sessions.keys()];
    const ledgers = cachedIds.length > 0
      ? (this.backend.listLedgersExcludingEventsForSessions?.(cachedIds)
        ?? this.backend.listLedgersExcludingEvents?.()
        ?? this.backend.listSessionLedgers())
      : [];
    for (const ledger of ledgers) {
      this.applyLedgerToStore(ledger.sessionId, ledger, ledger.leafEntryId);
      this.sessionRunProjectionModes.set(ledger.sessionId, "slim");
    }
    this.sessionLedgerRevision = revision ?? this.backend.ledgerRevision?.();
  }

  private isSessionLedgerStale(sessionId: string): boolean {
    const currentLeafId = this.backend.getSessionLedgerLeafEntryId?.(sessionId) ?? undefined;
    const cachedLeafId = this.sessionLedgerLeafEntryIds.get(sessionId);
    return currentLeafId !== cachedLeafId;
  }

  private sessionNeedsLedgerRepair(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.latestRunId) {
      return false;
    }
    const cached = this.runs.get(session.latestRunId);
    if (!cached) {
      return false;
    }
    const projected = this.ledgerProjectedRunSnapshotForCachedRun(cached);
    if (!projected) {
      return false;
    }
    // Exclude streaming-only fields that are expected to differ between
    // the in-memory cache and the ledger projection for active runs.
    const stripStreamingFields = (s: StateSnapshot) => ({
      ...s,
      events: [],
      checkpoints: [],
      toolResults: [],
    });
    return JSON.stringify(stripStreamingFields(cached)) !== JSON.stringify(stripStreamingFields(projected));
  }

  private refreshSessionIfStale(sessionId: string): void {
    if (!this.isSessionLedgerStale(sessionId) && !this.sessionNeedsLedgerRepair(sessionId)) return;
    const leafEntryId = this.backend.getSessionLedgerLeafEntryId?.(sessionId) ?? undefined;
    this.refreshSessionFromLedger(sessionId, leafEntryId, { excludeEvents: true });
  }

  private ledgerSnapshotOrFallback(snapshot: StateSnapshot, leafEntryId?: string): StateSnapshot {
    if (!snapshot.sessionId) {
      return snapshot;
    }
    const ledger = this.backend.getSessionLedger(snapshot.sessionId);
    const projected = ledger ? deriveRunSnapshot(ledger, snapshot.runId, leafEntryId ?? ledger.leafEntryId) : undefined;
    if (!projected) {
      return snapshot;
    }
    this.runs.set(projected.runId, projected);
    this.refreshSessionFromLedger(snapshot.sessionId);
    return projected;
  }

  private ledgerRebasedRunSnapshot(runId: string): StateSnapshot | undefined {
    const cached = this.runs.get(runId);
    const projected = cached
      ? this.ledgerProjectedRunSnapshotForCachedRun(cached)
      : this.ledgerProjectedRunSnapshot(runId);
    if (!projected) {
      return undefined;
    }
    return this.rebaseActiveRunSnapshot(projected, cached);
  }

  private rebaseActiveRunSnapshot(projected: StateSnapshot, cached?: StateSnapshot): StateSnapshot {
    if (projected.status !== "queued" && projected.status !== "running") {
      return projected;
    }
    if (!cached) {
      return projected;
    }
    const lastLedgerSeq = projected.events.reduce((max, event) => Math.max(max, event.seq), -1);
    const unledgeredEvents = cached.events
      .filter((event) => event.seq > lastLedgerSeq)
      .sort((left, right) => left.seq - right.seq);
    if (unledgeredEvents.length === 0) {
      return projected;
    }
    return unledgeredEvents.reduce(
      (snapshot, event) => applyStreamingRunEvent(snapshot, event),
      projected,
    );
  }

  private ledgerProjectedRunSnapshotForCachedRun(cached: StateSnapshot): StateSnapshot | undefined {
    if (!cached.sessionId) {
      return undefined;
    }
    const ledger = this.backend.getSessionLedger(cached.sessionId);
    if (!ledger) {
      return undefined;
    }
    const leafEntryId = cached.config.metadata.branchRole === "candidate"
      ? this.candidateLedgerLeaf(cached)
      : ledger.leafEntryId;
    return deriveRunSnapshot(ledger, cached.runId, leafEntryId);
  }

  private candidateLedgerLeaf(snapshot: Pick<StateSnapshot, "runId" | "sessionId">): string | undefined {
    return this.runLedgerService.candidateLedgerLeaf(snapshot);
  }

  private ledgerProjectedRunSnapshot(runId: string): StateSnapshot | undefined {
    const cached = this.runs.get(runId);
    if (cached?.sessionId) {
      return this.ledgerProjectedRunSnapshotForCachedRun(cached);
    }
    for (const ledger of this.backend.listSessionLedgers()) {
      const projected = deriveRunSnapshot(ledger, runId);
      if (projected) {
        return projected;
      }
    }
    return undefined;
  }

  private ledgerProjectedRunSnapshotFromAnyLeaf(runId: string): StateSnapshot | undefined {
    for (const ledger of this.backend.listSessionLedgers()) {
      const runEntries = ledger.entries
        .filter((entry) => entry.runId === runId)
        .sort((a, b) => b.seq - a.seq || b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      for (const entry of runEntries) {
        const projected = deriveRunSnapshot(ledger, runId, entry.id);
        if (projected) {
          return projected;
        }
      }
    }
    return undefined;
  }


  private replayRunFromSnapshot(snapshot: StateSnapshot, checkpointId?: string): RunEventStream {
    const checkpoint = checkpointId
      ? snapshot.checkpoints.find((candidate) => candidate.id === checkpointId)
      : snapshot.checkpoints.at(-1);
    if (!checkpoint) {
      throw new OraRuntimeError("Checkpoint not found for replay.", -32004, {
        runId: snapshot.runId,
        checkpointId,
      });
    }
    const replayableEvents = snapshot.events
      .filter((event) => event.seq <= checkpoint.eventSeq)
      .sort((a, b) => a.seq - b.seq);
    const replayed = this.appendRunSnapshotUpdateToLedger(this.appendEvent(snapshot, "run.replayed", {
      checkpointId: checkpoint.id,
      replayedEventCount: replayableEvents.length,
      events: replayableEvents,
      continuation: continuationSummary(snapshot),
    }));
    this.persistRun(replayed);
    return RunEventStreamSchema.parse({
      runId: snapshot.runId,
      fromSeq: 0,
      events: replayableEvents,
      nextSeq: replayed.events.length,
    });
  }

  private isLedgerBackedSession(sessionId: string | undefined): boolean {
    if (!sessionId) {
      return false;
    }
    return this.backend.getSessionLedgerCursor?.(sessionId) !== undefined
      || Boolean(this.backend.getSessionLedger(sessionId));
  }



  private appendResolvedClarificationEvents(
    snapshot: StateSnapshot,
    pendingClarifications: StateSnapshot["pendingClarifications"],
    clarificationPatch: Record<string, unknown>,
  ): StateSnapshot {
    let working = snapshot;
    for (const clarification of pendingClarifications) {
      const answer = clarificationPatch[clarification.id] ?? clarificationPatch[clarification.key];
      if (answer === undefined) {
        continue;
      }
      const alreadyEmitted = working.events.some((event) => {
        if (event.type !== "clarification.resolved" || !event.payload || typeof event.payload !== "object") {
          return false;
        }
        return (event.payload as Record<string, unknown>).clarificationId === clarification.id;
      });
      if (alreadyEmitted) {
        continue;
      }
      working = this.appendEvent(working, "clarification.resolved", {
        clarificationId: clarification.id,
        nodeId: clarification.nodeId,
        answer,
        mode: "resume",
      }, { nodeId: clarification.nodeId, agentId: clarification.nodeId });
    }
    return working;
  }

  private appendEvent(
    snapshot: StateSnapshot,
    type: OraEventEnvelope["type"],
    payload: unknown,
    extra: Partial<OraEventEnvelope> = {}
  ): StateSnapshot {
    const seq = snapshot.events.length;
    const updatedAt = this.now();
    const event = OraEventEnvelopeSchema.parse({
      id: `${snapshot.runId}:evt-${seq}`,
      runId: snapshot.runId,
      seq,
      type,
      createdAt: updatedAt,
      pattern: snapshot.pattern,
      payload,
      ...extra
    });
    return StateSnapshotSchema.parse({
      ...snapshot,
      events: [...snapshot.events, event],
      updatedAt
    });
  }

  private syncSnapshotTodos(snapshot: StateSnapshot, reason: string): StateSnapshot {
    const nextTodos = new TodoService(snapshot.runId, () => this.now(), snapshot.plan, snapshot.todos).list();
    if (this.sameTodoList(snapshot.todos, nextTodos)) {
      return snapshot;
    }
    return this.appendEvent(
      {
        ...snapshot,
        todos: nextTodos,
      },
      "todo.updated",
      { items: nextTodos, reason },
    );
  }

  private sameTodoList(left: StateSnapshot["todos"], right: StateSnapshot["todos"]): boolean {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => {
      const candidate = right[index];
      return candidate
        && item.id === candidate.id
        && item.runId === candidate.runId
        && item.sourcePlanItemId === candidate.sourcePlanItemId
        && item.status === candidate.status
        && item.label === candidate.label
        && item.detail === candidate.detail
        && item.createdAt === candidate.createdAt
        && item.updatedAt === candidate.updatedAt;
    });
  }

  private persistRun(snapshot: StateSnapshot): void {
    this.runPersistenceService.persistRun(snapshot);
  }

  private async persistRunWithGeneratedTitle(snapshot: StateSnapshot): Promise<void> {
    await this.runPersistenceService.persistRunWithGeneratedTitle(snapshot);
  }

  private queueSelfIterationAfterTerminalRun(snapshot: StateSnapshot): void {
    if (!isTerminalRunStatus(snapshot.status)) return;
    if (snapshot.events.some((event) => event.type === "recovery.exhausted") || snapshot.status === "failed") {
      this.queueSelfIterationCurator("recovery_insight_created", snapshot.input.projectId);
    }
    this.queueSelfIterationCurator("run_completed_idle", snapshot.input.projectId);
  }

  private queueSelfIterationCurator(trigger: SelfIterationCuratorTrigger, projectId?: string): void {
    const policy = this.selfIterationStore.getPolicy({ projectId });
    if (!policy.curatorEnabled) return;
    const delayMs = trigger === "run_completed_idle" ? policy.idleScanDelayMs : 0;
    const key = `${projectId ?? "default"}:${trigger}`;
    const existing = this.selfIterationCuratorTimers.get(key);
    if (existing) clearTimeout(existing);
    const run = () => {
      this.selfIterationCuratorTimers.delete(key);
      this.runSelfIterationCurator(trigger, projectId);
    };
    if (delayMs === 0) {
      run();
      return;
    }
    const timer = setTimeout(run, delayMs);
    timer.unref?.();
    this.selfIterationCuratorTimers.set(key, timer);
  }

  private async runSelfIterationCurator(trigger: SelfIterationCuratorTrigger, projectId?: string): Promise<void> {
    try {
      await this.selfIterationStore.triggerCuratorScan({ projectId, trigger }, this.selfIterationInput(), {
        applyEvaluationCandidate: (candidate) => this.applyEvaluationSelfIterationCandidate(candidate),
      });
    } catch {
      // Curator scans are opportunistic and must not affect the foreground run.
    }
  }

  private cacheRun(
    snapshot: StateSnapshot,
    flush: boolean,
    options: { titleOverride?: string; deferInitialTitle?: boolean } = {}
  ): void {
    snapshot = this.normalizeSnapshotForPersistence(snapshot);
    this.runs.set(snapshot.runId, snapshot);
    if (snapshot.sessionId && !isUnadoptedBranchCandidate(snapshot)) {
      const useLedgerHotPathBypass = this.isLedgerBackedSession(snapshot.sessionId)
        && !flush
        && (snapshot.status === "queued" || snapshot.status === "running");
      const session = useLedgerHotPathBypass
        ? this.upsertSessionFromRun(snapshot, options)
        : this.isLedgerBackedSession(snapshot.sessionId)
          ? this.refreshSessionFromLedger(snapshot.sessionId)
          : this.upsertSessionFromRun(snapshot, options);
      if (useLedgerHotPathBypass) {
        const currentLeafEntryId = this.backend.getSessionLedgerLeafEntryId?.(snapshot.sessionId) ?? undefined;
        this.sessionLedgerLeafEntryIds.set(snapshot.sessionId, currentLeafEntryId);
      }
      this.sessions.set(session.sessionId, session);
      if (flush && session.projectId) {
        this.syncProjectSummary(session.projectId);
      }
    }
    if (flush) {
      this.backend.saveManifest(this.manifest);
      this.evictOldSessionsIfNeeded();
    }
  }

  private cacheRunDelta(snapshot: StateSnapshot): void {
    this.runs.set(snapshot.runId, snapshot);
    if (snapshot.sessionId && !isUnadoptedBranchCandidate(snapshot)) {
      const session = this.upsertSessionFromRun(snapshot, { deferInitialTitle: true });
      this.sessions.set(session.sessionId, session);
    }
  }

  private memoryUpdateDeps(): MemoryUpdateDeps {
    return {
      longTermMemory: this.longTermMemory,
      longTermMemoryQueue: this.longTermMemoryQueue,
      modeSelectionDeps: () => this.modeSelectionDeps(),
      buildConversationMessages: (sessionId, currentPrompt, excludeRunId) =>
        this.buildConversationMessages(sessionId, currentPrompt, excludeRunId),
      getCachedRun: (runId) => this.runs.get(runId),
      appendEvent: (snapshot, type, payload, extra) => this.appendEvent(snapshot, type, payload, extra),
      cacheRun: (snapshot, flush) => {
        const normalized = this.normalizeSnapshotForPersistence(snapshot);
        const projected = this.appendRunSnapshotUpdateToLedger(normalized);
        this.cacheRun(projected, flush);
      },
    };
  }

  private nextRunId(): string {
    const runId = `run-${String(this.manifest.nextRunNumber).padStart(4, "0")}`;
    this.manifest = {
      ...this.manifest,
      nextRunNumber: this.manifest.nextRunNumber + 1
    };
    return runId;
  }

  private nextSessionId(): string {
    const sessionId = `session-${String(this.manifest.nextSessionNumber).padStart(4, "0")}`;
    this.manifest = {
      ...this.manifest,
      nextSessionNumber: this.manifest.nextSessionNumber + 1,
    };
    return sessionId;
  }

  private nextProjectId(): string {
    const projectId = `project-${String(this.manifest.nextProjectNumber).padStart(4, "0")}`;
    this.manifest = {
      ...this.manifest,
      nextProjectNumber: this.manifest.nextProjectNumber + 1,
    };
    return projectId;
  }

  private requireRunId(params: unknown): string {
    return RunIdParamsSchema.parse(params).runId;
  }

  private requireFlowRunId(params: unknown): string {
    const record = params && typeof params === "object" ? params as Record<string, unknown> : {};
    const flowRunId = typeof record.flowRunId === "string" && record.flowRunId.length > 0 ? record.flowRunId : undefined;
    const runId = typeof record.runId === "string" && record.runId.length > 0 ? record.runId : undefined;
    if (!flowRunId && !runId) {
      throw new OraRuntimeError("Expected flowRunId or runId.", -32602, { params });
    }
    return flowRunId ?? runId!;
  }

  private withRunIdFromFlowRunId(params: unknown): Record<string, unknown> {
    const record = params && typeof params === "object" ? params as Record<string, unknown> : {};
    return {
      ...record,
      runId: this.requireFlowRunId(params),
    };
  }

  private cancelledSnapshot(runId: string): StateSnapshot | undefined {
    const snapshot = this.ledgerRebasedRunSnapshot(runId) ?? this.runs.get(runId);
    if (snapshot?.status === "cancelled") {
      return snapshot;
    }
    return undefined;
  }

  private isRunCancelled(runId: string): boolean {
    return this.cancelledSnapshot(runId) !== undefined;
  }

  private getRunOrThrow(runId: string): StateSnapshot {
    const snapshot = this.runs.get(runId);
    if (snapshot) {
      if (snapshot.status === "queued" || snapshot.status === "running") {
        return snapshot;
      }
      const projected = this.ledgerProjectedRunSnapshotForCachedRun(snapshot);
      if (projected) {
        const rebased = this.rebaseActiveRunSnapshot(projected, snapshot);
        this.runs.set(runId, rebased);
        return rebased;
      }
      return snapshot;
    }
    const projected = this.ledgerProjectedRunSnapshotFromAnyLeaf(runId);
    if (projected) {
      this.runs.set(runId, projected);
      if (projected.config.metadata.branchRole === "candidate" && projected.sessionId) {
        const ledger = this.backend.getSessionLedger(projected.sessionId);
        const leaf = ledger?.entries
          .filter((entry) => entry.runId === runId && entry.type !== "branch.candidate_started")
          .sort((a, b) => b.seq - a.seq || b.createdAt - a.createdAt || b.id.localeCompare(a.id))
          .at(0)?.id;
        if (leaf) {
          this.runLedgerBranchService.recordCandidateLeaf(runId, leaf);
        }
      }
      return projected;
    }
    throw new OraRuntimeError(`Run not found: ${runId}`, -32004, { runId });
  }

  private getSessionOrThrow(sessionId: string): SessionSummary {
    const session = this.sessions.get(sessionId);
    if (session) return session;
    // Lazy-load from ledger if the session exists but wasn't loaded at boot
    if (this.allSessionIds.has(sessionId) && this.isLedgerBackedSession(sessionId)) {
      return this.refreshSessionFromLedger(sessionId, undefined, { excludeEvents: true });
    }
    throw new OraRuntimeError(`Session not found: ${sessionId}`, -32004, { sessionId });
  }

  private getProjectOrThrow(projectId: string): ProjectSummary {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new OraRuntimeError(`Project not found: ${projectId}`, -32004, { projectId });
    }
    return project;
  }

  private persistSession(session: SessionSummary): void {
    if (this.isLedgerBackedSession(session.sessionId)) {
      this.appendSessionLedgerEntry(session.sessionId, {
        id: `${session.sessionId}:info-${session.updatedAt}-${this.ledgerEntryOrdinal(session.sessionId)}`,
        type: "session.info",
        turnIndex: 0,
        createdAt: session.updatedAt,
        payload: {
          title: session.title,
          projectId: session.projectId,
          archivedAt: session.archivedAt,
        },
      });
      const projection = this.refreshSessionFromLedger(session.sessionId);
      if (projection.projectId) {
        this.syncProjectSummary(projection.projectId);
      }
      this.backend.saveManifest(this.manifest);
      return;
    }
    this.sessions.set(session.sessionId, session);
    this.allSessionIds.add(session.sessionId);
    if (session.projectId) {
      this.syncProjectSummary(session.projectId);
    }
    this.backend.saveManifest(this.manifest);
    this.evictOldSessionsIfNeeded();
  }

  private evictOldSessionsIfNeeded(): void {
    if (this.sessions.size <= this.maxCachedSessions) return;
    const maxCached = this.maxCachedSessions;
    const sorted = [...this.sessions.entries()]
      .sort(([, a], [, b]) => a.updatedAt - b.updatedAt);
    const toEvict = sorted.slice(0, this.sessions.size - maxCached);
    for (const [id] of toEvict) {
      this.sessions.delete(id);
      this.sessionRunProjectionModes.delete(id);
      this.sessionLedgerLeafEntryIds.delete(id);
    }
  }

  private persistProject(project: ProjectSummary): void {
    this.projects.set(project.projectId, project);
    this.backend.saveProject(project);
    this.backend.saveManifest(this.manifest);
  }

  private allRunsForSession(sessionId: string): StateSnapshot[] {
    this.ensureSessionRunsLoaded(sessionId, { includeEvents: false });
    return [...this.runs.values()]
      .filter((run) => run.sessionId === sessionId)
      .sort((a, b) => (a.turnIndex ?? 1) - (b.turnIndex ?? 1) || a.updatedAt - b.updatedAt || a.runId.localeCompare(b.runId));
  }

  private runsForSession(sessionId: string): StateSnapshot[] {
    return this.allRunsForSession(sessionId).filter(isVisibleMainlineRun);
  }

  private nextTurnIndex(sessionId: string): number {
    const last = this.runsForSession(sessionId).at(-1);
    return (last?.turnIndex ?? 0) + 1;
  }

  private ensureSessionForRun(sessionId: string | undefined, input: UserTaskInput): SessionSummary {
    if (sessionId) {
      return this.getSessionOrThrow(sessionId);
    }
    return this.createSession({
      projectId: input.projectId,
    });
  }

  private enrichInputForSession(input: UserTaskInput, session: SessionSummary): UserTaskInput {
    const projectId = input.projectId ?? session.projectId;
    if (!projectId) {
      return input;
    }

    const project = this.getProjectOrThrow(projectId);
    return UserTaskInputSchema.parse({
      ...input,
      projectId,
      context: {
        ...input.context,
        projectWorkspace: projectWorkspaceContext(project),
      },
    });
  }

  private updateSessionTitle(sessionId: string, title: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const updated = SessionSummarySchema.parse({
      ...session,
      title,
      updatedAt: this.now(),
    });
    this.persistSession(updated);
  }

  private upsertSessionFromRun(
    snapshot: StateSnapshot,
    options: { titleOverride?: string; deferInitialTitle?: boolean } = {}
  ): SessionSummary {
    const sessionId = snapshot.sessionId;
    if (!sessionId) {
      throw new OraRuntimeError("Cannot persist run without sessionId.", -32004, { runId: snapshot.runId });
    }
    const existing = this.sessions.get(sessionId);
    const turnCount = this.runsForSession(sessionId).filter((run) => run.runId !== snapshot.runId).length + 1;
    const title = options.titleOverride
      ?? (existing && existing.title !== DEFAULT_SESSION_TITLE
        ? existing.title
        : snapshot.status === "queued" || snapshot.status === "running" || options.deferInitialTitle
          ? existing?.title ?? DEFAULT_SESSION_TITLE
          : defaultSessionTitle(snapshot.input.prompt));
    const snapshotAttention = deriveRunAttention(snapshot);
    // Hot-path guard: preserve a blocking attention from the cache only when
    // the snapshot may not yet reflect a gate that was written to the ledger.
    // Conditions: same run, snapshot not updated since last session write.
    // When the snapshot is from a different run or fresher than the session
    // (user just resolved a gate), trust the snapshot's own pending arrays.
    const attention = existing?.attention?.blocking
      && !snapshotAttention.blocking
      && existing.latestRunId === snapshot.runId
      && snapshot.updatedAt <= (existing.updatedAt ?? 0)
      ? existing.attention
      : snapshotAttention;
    return SessionSummarySchema.parse({
      sessionId,
      title,
      projectId: snapshot.input.projectId ?? existing?.projectId,
      status: snapshot.status,
      attention,
      latestRunId: snapshot.runId,
      latestPattern: snapshot.pattern,
      latestModeId: snapshot.modeId ?? existing?.latestModeId,
      latestProviderId: typeof snapshot.config.providerId === "string" ? snapshot.config.providerId : existing?.latestProviderId,
      latestModelRef: snapshot.config.modelRef ?? existing?.latestModelRef,
      turnCount,
      contextState: snapshot.contextState ?? existing?.contextState,
      createdAt: existing?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
      archivedAt: existing?.archivedAt,
    });
  }

  private normalizeSnapshotForPersistence(snapshot: StateSnapshot): StateSnapshot {
    let normalized = StateSnapshotSchema.parse(snapshot);
    if (
      normalized.sessionId &&
      normalized.status === "succeeded" &&
      normalized.config.metadata.taskIntent === "plan" &&
      snapshotContainsCompleteProposedPlan(normalized) &&
      normalized.planDecisions.length === 0
    ) {
      const planContent = extractCompleteProposedPlanContent(normalized);
      normalized = StateSnapshotSchema.parse({
        ...normalized,
        planDecisions: [{
          id: `${normalized.runId}:plan-decision`,
          runId: normalized.runId,
          sessionId: normalized.sessionId,
          status: "pending",
          ...(planContent ? { planContent, planSourceRunId: normalized.runId } : {}),
          createdAt: normalized.updatedAt,
        }],
      });
    }
    return StateSnapshotSchema.parse({
      ...normalized,
      attention: deriveRunAttention(normalized),
    });
  }

  private syncProjectSummary(projectId: string): void {
    const existing = this.projects.get(projectId);
    if (!existing) {
      return;
    }
    const sessions = [...this.sessions.values()].filter((session) =>
      session.projectId === projectId && session.archivedAt === undefined
    );
    const updatedAt = sessions.reduce((max, session) => Math.max(max, session.updatedAt), existing.createdAt);
    const nextProject = ProjectSummarySchema.parse({
      ...existing,
      sessionCount: sessions.length,
      updatedAt,
    });
    this.projects.set(projectId, nextProject);
    this.backend.saveProject(nextProject);
  }

  private async prepareConversationMessagesForRun(
    sessionId: string,
    currentPrompt: string,
    config: RunConfig,
    turnIndex: number,
    runId: string,
  ): Promise<ModelMessage[]> {
    const session = this.getSessionOrThrow(sessionId);
    const provider = resolveRunProviderConfig(config);
    const excludeRunId = config.metadata.branchTarget === "replace_latest" && typeof config.metadata.branchReplaceRunId === "string"
      ? config.metadata.branchReplaceRunId
      : undefined;
    const acceptedPlanHandoff = this.acceptedPlanHandoffForNextImplementationRun(sessionId, config, runId, excludeRunId);
    if (acceptedPlanHandoff) {
      config.metadata = {
        ...config.metadata,
        acceptedPlanDecisionId: acceptedPlanHandoff.decisionId,
        acceptedPlanRunId: acceptedPlanHandoff.sourceRunId,
      };
    }
    const priorMessages = this.buildConversationMessages(sessionId, "", excludeRunId);
    const contextState = normalizeContextState(this.contextStateForModelContext(sessionId));
    const currentPromptMessage = currentPrompt.trim()
      ? [{ role: "user" as const, content: currentPrompt.trim() }]
      : [];
    const handoffMessages = acceptedPlanHandoff
      ? [acceptedPlanHandoffMessage(acceptedPlanHandoff)]
      : [];
    let messages = [
      ...priorMessages,
      ...handoffMessages,
      ...currentPromptMessage,
    ];
    const check = shouldCompactContext({
      contextState,
      provider,
      messages,
    });
    const branchCandidate = config.metadata.branchRole === "candidate";
    if (!branchCandidate) {
      this.persistSessionContextState(sessionId, {
        ...contextState,
        activeTokenUsage: check.usage,
        contextWindow: check.contextWindow,
        autoCompactTokenLimit: check.limit,
      });
    }
    if (!check.shouldCompact || !check.limit || priorMessages.length === 0) {
      return messages;
    }
    if (branchCandidate) {
      return messages;
    }

    const compactRequest = buildLocalCompactionRequest(priorMessages, check.limit);
    const response = await invokeRunProvider(config, compactRequest);
    const compacted = compactedContextFromSummary({
      summary: response.text,
      phase: "pre_turn",
      beforeTokens: check.usage.totalTokens,
      limit: check.limit,
      contextWindow: check.contextWindow,
      previousState: contextState,
      compactedThroughTurnIndex: Math.max(0, turnIndex - 1),
      now: this.now(),
    });
    this.persistSessionContextState(sessionId, compacted.contextState);
    messages = [
      ...compacted.messages,
      ...handoffMessages,
      ...currentPromptMessage,
    ];
    return messages;
  }

  private acceptedPlanHandoffForNextImplementationRun(
    sessionId: string,
    config: RunConfig,
    runId: string,
    excludeRunId?: string,
  ): AcceptedPlanHandoff | undefined {
    if (config.metadata.taskIntent !== "implement" || config.metadata.branchRole === "candidate") {
      return undefined;
    }
    if (this.isSessionLedgerStale(sessionId)) {
      const ledger = this.backend.getSessionLedger(sessionId);
      if (ledger) {
        const projection = deriveSessionProjection(ledger);
        const handoff = [...projection.acceptedPlanHandoffs]
          .reverse()
          .find((candidate) =>
            !candidate.consumedByRunId &&
            candidate.sourceRunId !== excludeRunId &&
            candidate.planContent.trim().length > 0
          );
        if (!handoff) {
          return undefined;
        }
        return {
          decisionId: handoff.decisionId,
          sourceRunId: handoff.sourceRunId,
          planContent: handoff.planContent.trim(),
        };
      }
    }
    const priorTurns = this.runsForSession(sessionId)
      .filter((turn) => turn.runId !== excludeRunId);
    const latestPriorTurn = priorTurns.at(-1);
    if (!latestPriorTurn) {
      return undefined;
    }
    const decision = latestPriorTurn.planDecisions.find(
      (candidate) =>
        candidate.status === "accepted" &&
        candidate.runId === latestPriorTurn.runId &&
        typeof candidate.planContent === "string" &&
        candidate.planContent.trim().length > 0,
    );
    if (!decision?.planContent) {
      return undefined;
    }
    return {
      decisionId: decision.id,
      sourceRunId: latestPriorTurn.runId,
      planContent: decision.planContent.trim(),
    };
  }

  private ledgerEntryOrdinal(sessionId: string): number {
    const cursor = this.backend.getSessionLedgerCursor?.(sessionId);
    if (cursor) {
      return Math.max(0, cursor.maxSeq + 1);
    }
    return this.backend.getSessionLedger(sessionId)?.entries.length ?? 0;
  }

  private consumeAcceptedPlanHandoffForStartedRun(sessionId: string, config: RunConfig, runId: string): void {
    const decisionId = config.metadata.acceptedPlanDecisionId;
    const sourceRunId = config.metadata.acceptedPlanRunId;
    if (typeof decisionId !== "string" || typeof sourceRunId !== "string") {
      return;
    }
    const ledger = this.backend.getSessionLedger(sessionId);
    if (!ledger) {
      return;
    }
    const projection = deriveSessionProjection(ledger);
    const handoff = projection.acceptedPlanHandoffs.find((candidate) =>
      candidate.decisionId === decisionId &&
      candidate.sourceRunId === sourceRunId &&
      !candidate.consumedByRunId
    );
    if (!handoff) {
      return;
    }
    const consumed = {
      ...handoff,
      consumedByRunId: runId,
    } satisfies RuntimeAcceptedPlanHandoff;
    this.appendSessionLedgerEntry(sessionId, {
      id: `${runId}:handoff-consumed:${handoff.decisionId}`,
      type: "handoff.accepted_plan",
      runId,
      turnIndex: 0,
      createdAt: this.now(),
      payload: consumed,
    });
    this.refreshSessionFromLedger(sessionId);
  }

  private persistSessionContextState(sessionId: string, contextState: SessionSummary["contextState"]): void {
    const existing = this.getSessionOrThrow(sessionId);
    if (this.isLedgerBackedSession(sessionId)) {
      const now = this.now();
      this.appendSessionLedgerEntry(sessionId, {
        id: `${sessionId}:compaction-${now}-${this.ledgerEntryOrdinal(sessionId)}`,
        type: "compaction.summary",
        turnIndex: 0,
        createdAt: now,
        payload: { contextState },
      });
      this.refreshSessionFromLedger(sessionId);
      this.backend.saveManifest(this.manifest);
      return;
    }
    this.persistSession(SessionSummarySchema.parse({
      ...existing,
      contextState,
      updatedAt: Math.max(existing.updatedAt, this.now()),
    }));
  }

  private withSnapshotContextState(snapshot: StateSnapshot): StateSnapshot {
    if (!snapshot.sessionId) {
      return snapshot;
    }
    const provider = resolveRunProviderConfig(snapshot.config);
    const existing = this.sessions.get(snapshot.sessionId)?.contextState;
    const messages = this.buildCompletedSnapshotMessages(snapshot);
    const usage = activeUsageForMessages(messages);
    const contextState = {
      ...normalizeContextState(existing),
      activeTokenUsage: usage,
      contextWindow: resolvedContextWindow(provider),
      autoCompactTokenLimit: resolveAutoCompactTokenLimit(provider),
    };
    return StateSnapshotSchema.parse({
      ...snapshot,
      contextState,
    });
  }

  private buildCompletedSnapshotMessages(snapshot: StateSnapshot): ModelMessage[] {
    if (!snapshot.sessionId) {
      return [];
    }
    const messages = this.buildConversationMessages(snapshot.sessionId, snapshot.input.prompt, snapshot.runId);
    if (snapshot.conversation.length > 0) {
      messages.push(...runtimeConversationToModelMessages(snapshot.conversation));
    }
    const assistant = assistantTextForRun(snapshot);
    if (assistant) {
      messages.push({ role: "assistant", content: assistant });
    }
    return messages;
  }

  private buildConversationMessages(sessionId: string, currentPrompt: string, excludeRunId?: string): ModelMessage[] {
    const cachedMessages = this.buildConversationMessagesFromCachedRuns(sessionId, currentPrompt, excludeRunId);
    if (!this.isLedgerBackedSession(sessionId) || !this.isSessionLedgerStale(sessionId)) {
      return cachedMessages;
    }
    const ledgerMessages = this.buildModelContextFromLedger(sessionId, currentPrompt, excludeRunId);
    if (ledgerMessages) {
      return ledgerMessages;
    }
    return cachedMessages;
  }

  private buildConversationMessagesFromCachedRuns(sessionId: string, currentPrompt: string, excludeRunId?: string): ModelMessage[] {
    const session = this.sessions.get(sessionId);
    const contextState = normalizeContextState(session?.contextState);
    const priorTurns = this.runsForSession(sessionId);
    const messages: ModelMessage[] = contextMessages(contextState);
    for (const turn of priorTurns) {
      if (turn.runId === excludeRunId) {
        continue;
      }
      if (turn.turnIndex <= contextState.compactedThroughTurnIndex) {
        continue;
      }
      const prompt = turn.input.prompt.trim();
      if (prompt) {
        messages.push({ role: "user", content: prompt });
      }
      if (turn.conversation.length > 0) {
        messages.push(...priorTurnConversationMessages(turn.conversation));
      }
      const assistant = assistantTextForRun(turn);
      if (assistant) {
        messages.push({ role: "assistant", content: assistant });
      }
    }
    if (currentPrompt.trim()) {
      messages.push({ role: "user", content: currentPrompt.trim() });
    }
    return messages;
  }

  private buildModelContextFromLedger(sessionId: string, currentPrompt: string, excludeRunId?: string): ModelMessage[] | undefined {
    const ledger = this.backend.getSessionLedger(sessionId);
    if (!ledger) {
      return undefined;
    }
    const projection = deriveSessionProjection(ledger);
    const contextState = normalizeContextState(projection.contextState);
    const messages: ModelMessage[] = contextMessages(contextState);
    for (const run of projection.runs) {
      if (run.runId === excludeRunId) {
        continue;
      }
      if (run.turnIndex <= contextState.compactedThroughTurnIndex) {
        continue;
      }
      const snapshot = deriveRunSnapshot(ledger, run.runId, projection.leafEntryId);
      if (!snapshot) {
        continue;
      }
      const prompt = snapshot.input.prompt.trim();
      if (prompt) {
        messages.push({ role: "user", content: prompt });
      }
      if (snapshot.conversation.length > 0) {
        messages.push(...priorTurnConversationMessages(snapshot.conversation));
      }
      const assistant = assistantTextForRun(snapshot);
      if (assistant) {
        messages.push({ role: "assistant", content: assistant });
      }
    }
    if (currentPrompt.trim()) {
      messages.push({ role: "user", content: currentPrompt.trim() });
    }
    return messages;
  }

  private contextStateForModelContext(sessionId: string): SessionSummary["contextState"] {
    if (!this.isLedgerBackedSession(sessionId) || !this.isSessionLedgerStale(sessionId)) {
      return this.sessions.get(sessionId)?.contextState;
    }
    const ledger = this.backend.getSessionLedger(sessionId);
    if (ledger) {
      return deriveSessionProjection(ledger).contextState;
    }
    return this.sessions.get(sessionId)?.contextState;
  }

  private feedbackSourceContextDeps(): FeedbackSourceContextDeps {
    return {
      getRunTrail: (params) => this.getRunTrail(params),
      sessionTranscript: (sessionId) => this.sessionTranscript(sessionId),
    };
  }

  private sessionTranscript(sessionId: string): SessionTranscriptMessage[] {
    const transcript: SessionTranscriptMessage[] = [];
    for (const run of this.runsForSession(sessionId)) {
      const createdAt = run.input.createdAt ?? run.updatedAt;
      const prompt = run.input.prompt.trim();
      if (prompt) {
        transcript.push(SessionTranscriptMessageSchema.parse({
          id: `${run.runId}:user`,
          sessionId,
          runId: run.runId,
          turnIndex: run.turnIndex ?? 1,
          role: "user",
          content: prompt,
          pattern: run.pattern,
          modeId: run.modeId,
          createdAt,
        }));
      }
      const assistant = assistantTextForRun(run);
      if (assistant) {
        transcript.push(SessionTranscriptMessageSchema.parse({
          id: `${run.runId}:assistant`,
          sessionId,
          runId: run.runId,
          turnIndex: run.turnIndex ?? 1,
          role: "assistant",
          content: assistant,
          pattern: run.pattern,
          modeId: run.modeId,
          createdAt: run.updatedAt,
        }));
      }
    }
    return transcript;
  }

  private environmentObserverSignals(projects: ProjectSummary[]): ProjectSignal[] {
    return projects.flatMap((project) => {
      const policy = this.selfIterationStore.getPolicy({ projectId: project.projectId }).environmentObserver;
      if (!policy.enabled || policy.paused) return [];
      try {
        return [this.environmentObserverSignal(project, policy)];
      } catch {
        return [];
      }
    });
  }

  private environmentObserverSignal(project: ProjectSummary, policy: SelfIterationEnvironmentObserverPolicy): ProjectSignal {
    const summary = summarizeProjectEnvironment(project, policy, [...this.runs.values()].filter((run) => projectIdForSnapshotLocal(run, this.sessions) === project.projectId));
    const now = this.now();
    return ProjectSignalSchema.parse({
      id: `${project.projectId}:signal:project_file:environment_observer`,
      projectId: project.projectId,
      source: "project_file",
      sourceRef: `environment-observer:${project.projectId}`,
      title: "Environment observer snapshot",
      summary: `Scoped observer scanned ${summary.observedFiles} file${summary.observedFiles === 1 ? "" : "s"} under ${summary.watchedPaths.join(", ")} without reading raw content.`,
      severity: summary.truncated ? "warning" : "info",
      confidence: 0.72,
      createdAt: now,
      updatedAt: now,
      evidence: summary.recentFiles.slice(0, 5).map((file) => ({
        id: `${project.projectId}:file:${file.path}`,
        label: "Observed project file",
        summary: `${file.path} · ${file.sizeBytes} bytes`,
        target: { kind: "project_file", id: file.path, projectFilePath: file.path },
      })),
      metadata: {
        observerKind: "environment_snapshot",
        privacy: "metadata_only_no_raw_content",
        watchedPaths: summary.watchedPaths,
        excludedGlobs: policy.excludedGlobs,
        scanBudgetFiles: policy.scanBudgetFiles,
        maxFileBytes: policy.maxFileBytes,
        observedFiles: summary.observedFiles,
        skippedLargeFiles: summary.skippedLargeFiles,
        truncated: summary.truncated,
        extensionCounts: summary.extensionCounts,
        recentFiles: summary.recentFiles,
        largestFiles: summary.largestFiles,
        runContext: summary.runContext,
      },
    });
  }

  private feedbackLoopInput() {
    const projects = [...this.projects.values()];
    return {
      projects,
      sessions: [...this.sessions.values()],
      runs: [...this.runs.values()],
      evaluationRuns: this.evaluationStore.listRuns(),
      feedbackRecords: this.evaluationStore.listFeedback(),
      environmentSignals: this.environmentObserverSignals(projects),
    };
  }

  private selfIterationInput() {
    const feedbackLoopInput = this.feedbackLoopInput();
    return {
      signals: this.feedbackLoopStore.listSignals({}, feedbackLoopInput),
      insights: this.feedbackLoopStore.listInsights({}, feedbackLoopInput),
      runs: feedbackLoopInput.runs,
      evaluationRuns: feedbackLoopInput.evaluationRuns,
      feedbackRecords: feedbackLoopInput.feedbackRecords,
      enrichCandidate: (candidate: SelfIterationCandidate, _input: SelfIterationDerivationInput) => this.enrichSelfIterationCandidate(candidate),
    };
  }

  private async enrichSelfIterationCandidate(candidate: SelfIterationCandidate): Promise<SelfIterationCandidate> {
    const policy = this.selfIterationStore.getPolicy({ projectId: candidate.projectId });
    if (!(policy as Record<string, unknown>).candidateGenerationLLM) return candidate;

    const modeId = candidate.targetRef.modeId ?? SINGLE_AGENT_MODE_ID;
    const mode = this.modeStore.get({ modeId });
    const enrichmentModelRef = (policy as Record<string, unknown>).enrichmentModelRef as string | undefined;
    const modelRef = enrichmentModelRef ?? resolveProfileModelRef(mode);
    if (!modelRef) return candidate;

    const prompt = [
      "You are improving an Ora self-iteration candidate. Based on the evidence below, rewrite the candidate to be more specific and actionable.",
      `Current title: ${candidate.title}`,
      `Current summary: ${candidate.summary}`,
      `Target kind: ${candidate.targetKind}`,
      `Proposed operation: ${candidate.proposedChange.operation}`,
      "Evidence:",
      ...candidate.evidence.map((e, i) => `${i + 1}. ${e.label}: ${e.summary ?? ""}`).filter(Boolean),
      "Output ONLY a JSON object with keys: title (under 100 chars), summary (under 300 chars, specific to the evidence), after (a short string describing the concrete change to apply). Do not include any other text.",
    ].join("\n");

    try {
      const response = await invokeRunProvider(RunConfigSchema.parse({
        modeId,
        modeSelection: "manual",
        modelRef,
      }), {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 512,
      });

      const text = response.text.replace(/```json\s*|\s*```/g, "").trim();
      const parsed = JSON.parse(text) as { title?: string; summary?: string; after?: string };
      if (parsed.title && parsed.summary) {
        return {
          ...candidate,
          title: parsed.title.slice(0, 100),
          summary: parsed.summary.slice(0, 300),
          proposedChange: {
            ...candidate.proposedChange,
            after: parsed.after ?? candidate.proposedChange.after,
            metadata: { ...candidate.proposedChange.metadata, llmEnriched: true },
          },
        } as SelfIterationCandidate;
      }
    } catch {
      // LLM enrichment is best-effort; silently fall back to template candidate
    }
    return candidate;
  }

  private async runSelfIterationEvaluation(candidate: SelfIterationCandidate) {
    const modeDraft = candidate.targetKind === "mode"
      ? this.generateSelfIterationModeDraft(candidate)
      : undefined;
    const datasetId = this.selfIterationEvaluationDatasetId(candidate);
    const modeId = candidate.targetRef.modeId ?? SINGLE_AGENT_MODE_ID;
    const safetyMode = this.modeStore.get({ modeId });
    const modelRef = resolveProfileModelRef(safetyMode);
    const spec = EvaluationSpecSchema.parse({
      datasetId,
      profileId: "outcome",
      objective: {
        kind: "assertions",
        target: "runtime.mode_selection",
        metrics: ["assertion_pass_rate"],
        assertions: [{
          type: "equals",
          path: "runtime.modeId",
          value: modeId,
          rationale: "Self-Iteration gate verifies the candidate's target mode can still be selected by Evaluation Studio.",
        }],
      },
      configs: ["before", "after"].map((phase) => ({
        id: `self-iteration-${phase}`,
        label: phase === "before" ? "Current Ora behavior" : "Proposed Self-Iteration behavior",
        description: `Self-Iteration ${phase} gate for ${candidate.targetKind} candidate ${candidate.id}.`,
        runConfig: {
          pattern: "orchestrator_subagent",
          modeId,
          modeSelection: "manual",
          ...(modelRef ? { modelRef } : {}),
          metadata: {
            evaluationKind: "self_iteration_safety",
            evaluationRouterOnly: true,
            selfIterationCandidateId: candidate.id,
            selfIterationTargetKind: candidate.targetKind,
            selfIterationScorePhase: phase,
          },
        },
      })),
      repetitions: 3,
      concurrency: 1,
      metadata: {
        source: "self_iteration",
        candidateId: candidate.id,
        targetKind: candidate.targetKind,
      },
    });
    const detail = await this.startEvaluationRun(spec, async ({ input, config }) => {
      const sessionId = config?.metadata?.evalSessionId as string | undefined;
      const handle = await this.startRun({ input, config, sessionId });
      return this.getRunState({ runId: handle.runId });
    });
    const scorecard = detail.run.scorecard;
    const passed = detail.run.status === "succeeded" && scorecard.passRate >= 1 && scorecard.regressionCount === 0;
    const scoreEvidence = selfIterationScoreEvidence(detail.run.id, scorecard.configSummaries);
    return {
      evaluationRunId: detail.run.id,
      passed,
      message: passed
        ? `Evaluation Studio run ${detail.run.id} passed for candidate ${candidate.id}.`
        : `Evaluation Studio run ${detail.run.id} did not pass the self-iteration gate.`,
      metadata: {
        gateKind: "safety",
        safetyGate: {
          evaluationRunId: detail.run.id,
          passed,
          scoreEvidence,
        },
      },
      proposedChangeAfter: modeDraft ?? candidate.proposedChange.after,
      proposedChangeMetadata: modeDraft
        ? { modeStudioDraftGenerated: true, modeStudioDraftNeedsInput: modeDraft.needsInput, modeStudioDraftValid: modeDraft.validation.valid }
        : undefined,
    };
  }

  private async runSelfIterationImpactEvaluation(candidate: SelfIterationCandidate) {
    if (candidate.targetKind === "evaluation") return undefined;
    if (candidate.targetKind === "mode") return this.runModeImpactEvaluation(candidate);
    if (candidate.targetKind === "skill") return this.runSkillImpactEvaluation(candidate);
    return this.runPromptImpactEvaluation(candidate);
  }

  private async runPromptImpactEvaluation(candidate: SelfIterationCandidate) {
    const modeId = candidate.targetRef.modeId ?? SINGLE_AGENT_MODE_ID;
    const originalMode = this.modeStore.get({ modeId });
    const nodeId = candidate.targetRef.nodeId;
    const targetNode = originalMode.nodes.find((node) => node.id === nodeId)
      ?? originalMode.nodes.find((node) => node.enabled)
      ?? originalMode.nodes[0];
    if (!targetNode) return undefined;

    const addition = typeof candidate.proposedChange.after === "string"
      ? candidate.proposedChange.after
      : candidate.proposedChange.summary;
    const nextPrompt = [targetNode.prompt ?? targetNode.instructions ?? "", addition]
      .filter(Boolean)
      .join("\n\nSelf-Iteration guidance: ");
    const tempModeId = `self-iteration-impact-${safeSelfIterationId(candidate.id)}-${this.now()}`;
    const tempMode = this.modeStore.create(modeCreateParamsFromSpec({
      ...originalMode,
      id: tempModeId,
      label: `${originalMode.label} (Impact)`,
      nodes: originalMode.nodes.map((node) =>
        node.id === targetNode.id ? { ...node, prompt: nextPrompt } : node),
    }));

    try {
      return await this.executeImpactEvaluationRun(candidate, originalMode.id, tempMode.id);
    } finally {
      try { this.modeStore.delete({ modeId: tempMode.id }); } catch { /* ignore cleanup failures */ }
    }
  }

  private async runSkillImpactEvaluation(candidate: SelfIterationCandidate) {
    const after = candidate.proposedChange.after;
    if (!after || typeof after !== "object") return undefined;
    const draft = after as { name?: unknown; description?: unknown; content?: unknown };
    const skillContent = typeof draft.content === "string" ? draft.content : undefined;
    if (!skillContent) return undefined;

    const created = this.skillRegistry.create({
      name: String(draft.name ?? candidate.targetRef.skillName ?? "learned-workflow"),
      description: String(draft.description ?? candidate.proposedChange.summary),
      content: skillContent,
      enabled: true,
    });

    try {
      const modeId = candidate.targetRef.modeId ?? SINGLE_AGENT_MODE_ID;
      const skillMode = this.modeStore.get({ modeId });
      const modelRef = resolveProfileModelRef(skillMode);
      const datasetId = this.selfIterationEvaluationDatasetId(candidate);

      const spec = EvaluationSpecSchema.parse({
        datasetId,
        profileId: "outcome",
        configs: [
          {
            id: "self-iteration-before-impact",
            label: "Current behavior",
            description: `Before impact evaluation for skill candidate ${candidate.id}.`,
            runConfig: {
              pattern: "orchestrator_subagent",
              modeId,
              modeSelection: "manual",
              ...(modelRef ? { modelRef } : {}),
              metadata: {
                evaluationKind: "self_iteration_impact",
                selfIterationCandidateId: candidate.id,
                selfIterationTargetKind: candidate.targetKind,
                selfIterationScorePhase: "before",
              },
            },
          },
          {
            id: "self-iteration-after-impact",
            label: "With proposed skill",
            description: `After impact evaluation for skill candidate ${candidate.id}.`,
            runConfig: {
              pattern: "orchestrator_subagent",
              modeId,
              modeSelection: "manual",
              ...(modelRef ? { modelRef } : {}),
              skillIds: [created.name],
              metadata: {
                evaluationKind: "self_iteration_impact",
                selfIterationCandidateId: candidate.id,
                selfIterationTargetKind: candidate.targetKind,
                selfIterationScorePhase: "after",
              },
            },
          },
        ],
        repetitions: 3,
        concurrency: 1,
        metadata: {
          source: "self_iteration",
          candidateId: candidate.id,
          targetKind: candidate.targetKind,
          evaluationKind: "self_iteration_impact",
        },
      });

      const detail = await this.startEvaluationRun(spec, async ({ input, config }) => {
        const sessionId = config?.metadata?.evalSessionId as string | undefined;
        const handle = await this.startRun({ input, config, sessionId });
        return this.getRunState({ runId: handle.runId });
      });

      return this.buildImpactEvaluationResult(detail, candidate);
    } finally {
      try { this.skillRegistry.delete({ name: created.name }); } catch { /* ignore cleanup failures */ }
    }
  }

  private async runModeImpactEvaluation(candidate: SelfIterationCandidate) {
    const after = candidate.proposedChange.after;
    const draftBundle = after && typeof after === "object" && "modeDraft" in after
      ? after as ModeStudioDraftBundle
      : undefined;
    if (!draftBundle?.validation?.valid) return undefined;

    const baseModeId = candidate.targetRef.modeId ?? SINGLE_AGENT_MODE_ID;
    const baseMode = this.modeStore.get({ modeId: baseModeId });
    const draftSpec = draftBundle.modeDraft as Record<string, unknown>;
    const tempModeId = `self-iteration-impact-${safeSelfIterationId(candidate.id)}-${this.now()}`;
    const tempMode = this.modeStore.create(modeCreateParamsFromSpec({
      ...baseMode,
      nodes: (draftSpec.nodes as typeof baseMode.nodes) ?? baseMode.nodes,
      edges: (draftSpec.edges as typeof baseMode.edges) ?? baseMode.edges,
      id: tempModeId,
      label: `${baseMode.label} (Impact)`,
    }));

    try {
      return await this.executeImpactEvaluationRun(candidate, baseMode.id, tempMode.id);
    } finally {
      try { this.modeStore.delete({ modeId: tempMode.id }); } catch { /* ignore cleanup failures */ }
    }
  }

  private async executeImpactEvaluationRun(
    candidate: SelfIterationCandidate,
    beforeModeId: string,
    afterModeId: string,
  ) {
    const beforeMode = this.modeStore.get({ modeId: beforeModeId });
    const modelRef = resolveProfileModelRef(beforeMode);
    const datasetId = this.selfIterationEvaluationDatasetId(candidate);

    const spec = EvaluationSpecSchema.parse({
      datasetId,
      profileId: "outcome",
      configs: [
        {
          id: "self-iteration-before-impact",
          label: "Current behavior",
          description: `Before impact evaluation for ${candidate.targetKind} candidate ${candidate.id}.`,
          runConfig: {
            pattern: "orchestrator_subagent",
            modeId: beforeModeId,
            modeSelection: "manual",
            ...(modelRef ? { modelRef } : {}),
            metadata: {
              evaluationKind: "self_iteration_impact",
              selfIterationCandidateId: candidate.id,
              selfIterationTargetKind: candidate.targetKind,
              selfIterationScorePhase: "before",
            },
          },
        },
        {
          id: "self-iteration-after-impact",
          label: "With proposed change",
          description: `After impact evaluation for ${candidate.targetKind} candidate ${candidate.id}.`,
          runConfig: {
            pattern: "orchestrator_subagent",
            modeId: afterModeId,
            modeSelection: "manual",
            ...(modelRef ? { modelRef } : {}),
            metadata: {
              evaluationKind: "self_iteration_impact",
              selfIterationCandidateId: candidate.id,
              selfIterationTargetKind: candidate.targetKind,
              selfIterationScorePhase: "after",
            },
          },
        },
      ],
      repetitions: 3,
      concurrency: 1,
      metadata: {
        source: "self_iteration",
        candidateId: candidate.id,
        targetKind: candidate.targetKind,
        evaluationKind: "self_iteration_impact",
      },
    });

    const detail = await this.startEvaluationRun(spec, async ({ input, config }) => {
      const sessionId = config?.metadata?.evalSessionId as string | undefined;
      const handle = await this.startRun({ input, config, sessionId });
      return this.getRunState({ runId: handle.runId });
    });

    return this.buildImpactEvaluationResult(detail, candidate);
  }

  private buildImpactEvaluationResult(detail: Awaited<ReturnType<typeof this.startEvaluationRun>>, candidate: SelfIterationCandidate) {
    const scorecard = detail.run.scorecard;
    const passed = detail.run.status === "succeeded" && scorecard.passRate >= 1 && scorecard.regressionCount === 0;
    const scoreEvidence = selfIterationScoreEvidence(detail.run.id, scorecard.configSummaries);
    return {
      evaluationRunId: detail.run.id,
      passed,
      message: passed
        ? `Impact evaluation ${detail.run.id} passed for ${candidate.targetKind} candidate ${candidate.id}.`
        : `Impact evaluation ${detail.run.id} shows regression for ${candidate.targetKind} candidate ${candidate.id}.`,
      impactEvaluation: {
        targetKind: candidate.targetKind,
        ...scoreEvidence,
      },
    };
  }

  private cleanupOrphanedImpactResources() {
    const prefix = "self-iteration-impact-";
    try {
      for (const mode of this.modeStore.list()) {
        if (mode.id.startsWith(prefix) && !mode.systemPreset) {
          try { this.modeStore.delete({ modeId: mode.id }); } catch { /* ignore */ }
        }
      }
    } catch { /* mode listing may not be available */ }
  }

  private selfIterationEvaluationDatasetId(candidate: SelfIterationCandidate): string {
    if (candidate.targetKind === "evaluation") {
      const feedbackId = candidate.targetRef.feedbackId ?? String(candidate.proposedChange.metadata.feedbackId ?? "");
      if (feedbackId) {
        const feedback = this.evaluationStore.getFeedback({ feedbackId });
        if (feedback.datasetId && feedback.acceptedCaseId) {
          const detail = this.evaluationStore.getDataset({ datasetId: feedback.datasetId });
          if (detail.cases.some((evaluationCase) => evaluationCase.id === feedback.acceptedCaseId)) {
            return feedback.datasetId;
          }
        }
      }
    }
    const cached = this.selfIterationDatasetCache.get(candidate.id);
    if (cached) return cached;
    const caseRecord = selfIterationEvaluationCase(candidate);
    const dataset = this.evaluationStore.importDataset({
      name: `Self-Iteration Gate · ${candidate.targetKind}`,
      description: `Synthetic gate dataset for candidate ${candidate.id}.`,
      sourceFormat: "inline",
      content: JSON.stringify([caseRecord]),
      tags: ["self-iteration", candidate.targetKind],
    });
    this.selfIterationDatasetCache.set(candidate.id, dataset.dataset.id);
    return dataset.dataset.id;
  }

  private generateSelfIterationModeDraft(candidate: SelfIterationCandidate): ModeStudioDraftBundle | undefined {
    const bundle = this.generateModeStudioDraft({
      messages: [{ role: "user", content: selfIterationModeDraftPrompt(candidate) }],
      baseModeId: candidate.targetRef.modeId,
    });
    return bundle;
  }

  private applyEvaluationSelfIterationCandidate(candidate: SelfIterationCandidate) {
    const feedbackId = candidate.targetRef.feedbackId ?? String(candidate.proposedChange.metadata.feedbackId ?? "");
    if (!feedbackId) return { applied: false, reason: "No feedback id was attached." };
    return this.evaluationStore.acceptFeedback({ feedbackId });
  }

  private applyPromptSelfIterationCandidate(candidate: SelfIterationCandidate) {
    const modeId = candidate.targetRef.modeId ?? String(candidate.proposedChange.metadata.modeId ?? "");
    if (!modeId) return { applied: false, reason: "No mode id was attached." };
    const mode = this.modeStore.get({ modeId });
    const nodeId = candidate.targetRef.nodeId;
    const targetNode = mode.nodes.find((node) => node.id === nodeId) ?? mode.nodes.find((node) => node.enabled) ?? mode.nodes[0];
    if (!targetNode) return { applied: false, reason: "Mode has no editable node." };
    const addition = typeof candidate.proposedChange.after === "string"
      ? candidate.proposedChange.after
      : candidate.proposedChange.summary;
    const nextPrompt = [targetNode.prompt ?? targetNode.instructions ?? "", addition]
      .filter(Boolean)
      .join("\n\nSelf-Iteration guidance: ");
    const nextMode = this.modeStore.update({
      modeId,
      spec: modeCreateParamsFromSpec({
        ...mode,
        nodes: mode.nodes.map((node) => node.id === targetNode.id ? { ...node, prompt: nextPrompt } : node),
      }),
    });
    return { applied: true, modeId: nextMode.id, nodeId: targetNode.id };
  }

  private applySkillSelfIterationCandidate(candidate: SelfIterationCandidate) {
    const after = candidate.proposedChange.after;
    if (!after || typeof after !== "object") return { applied: false, reason: "Skill candidate has no package draft." };
    const draft = after as { name?: unknown; description?: unknown; content?: unknown };
    return this.skillRegistry.create({
      name: String(draft.name ?? candidate.targetRef.skillName ?? "learned-workflow"),
      description: String(draft.description ?? candidate.proposedChange.summary),
      content: typeof draft.content === "string" ? draft.content : undefined,
      enabled: true,
    });
  }

  private applyModeSelfIterationCandidate(candidate: SelfIterationCandidate) {
    const after = candidate.proposedChange.after;
    const draftBundle = after && typeof after === "object" && "modeDraft" in after
      ? after as ModeStudioDraftBundle
      : undefined;
    if (!draftBundle) {
      return {
        applied: false,
        handoff: "mode_studio",
        insightId: candidate.proposedChange.metadata.insightId,
        message: "Mode candidates must be evaluated into a Mode Studio draft bundle before apply.",
      };
    }
    return this.applyModeStudioDraft({ draftBundle, saveAgentDrafts: false });
  }

  private migrationState() {
    return {
      projects: this.projects,
      sessions: this.sessions,
      runs: this.runs,
      backend: this.backend,
      manifest: this.manifest,
    };
  }

  private now(): number {
    return this.clock();
  }
}

function summarizeProjectEnvironment(project: ProjectSummary, policy: SelfIterationEnvironmentObserverPolicy, runs: StateSnapshot[]) {
  const rootPath = path.resolve(project.rootPath);
  const excludes = policy.excludedGlobs.map(globToRegExp);
  const watchedPaths = policy.watchedPaths.map((entry) => entry.trim()).filter(Boolean);
  const files: Array<{ path: string; sizeBytes: number; modifiedAt: number; extension: string }> = [];
  let observedFiles = 0;
  let skippedLargeFiles = 0;
  let truncated = false;

  for (const watchPath of watchedPaths) {
    if (truncated) break;
    const absoluteWatchPath = path.resolve(rootPath, watchPath);
    const relativeWatchPath = path.relative(rootPath, absoluteWatchPath);
    if (relativeWatchPath.startsWith("..") || path.isAbsolute(relativeWatchPath)) {
      continue;
    }
    visitEnvironmentPath(rootPath, absoluteWatchPath, excludes, policy, files, () => {
      observedFiles += 1;
      if (observedFiles >= policy.scanBudgetFiles) truncated = true;
      return truncated;
    }, () => {
      skippedLargeFiles += 1;
    });
  }

  const extensionCounts = files.reduce<Record<string, number>>((acc, file) => {
    acc[file.extension] = (acc[file.extension] ?? 0) + 1;
    return acc;
  }, {});
  const recentFiles = [...files]
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path))
    .slice(0, 12)
    .map(({ path: filePath, sizeBytes, modifiedAt }) => ({ path: filePath, sizeBytes, modifiedAt }));
  const largestFiles = [...files]
    .sort((left, right) => right.sizeBytes - left.sizeBytes || left.path.localeCompare(right.path))
    .slice(0, 8)
    .map(({ path: filePath, sizeBytes, modifiedAt }) => ({ path: filePath, sizeBytes, modifiedAt }));

  return {
    watchedPaths,
    observedFiles: files.length,
    skippedLargeFiles,
    truncated,
    extensionCounts,
    recentFiles,
    largestFiles,
    runContext: summarizeObserverRunContext(runs),
  };
}

function visitEnvironmentPath(
  rootPath: string,
  absolutePath: string,
  excludes: RegExp[],
  policy: SelfIterationEnvironmentObserverPolicy,
  files: Array<{ path: string; sizeBytes: number; modifiedAt: number; extension: string }>,
  didObserve: () => boolean,
  didSkipLarge: () => void,
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return;
  }
  const relativePath = path.relative(rootPath, absolutePath) || ".";
  const normalizedRelativePath = relativePath.split(path.sep).join("/");
  if (excludes.some((exclude) => exclude.test(normalizedRelativePath) || exclude.test(`${normalizedRelativePath}/`))) {
    return;
  }
  if (stat.isDirectory()) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absolutePath, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= policy.scanBudgetFiles) return;
      visitEnvironmentPath(rootPath, path.join(absolutePath, entry.name), excludes, policy, files, didObserve, didSkipLarge);
    }
    return;
  }
  if (!stat.isFile()) return;
  if (stat.size > policy.maxFileBytes) {
    didSkipLarge();
    return;
  }
  files.push({
    path: normalizedRelativePath,
    sizeBytes: stat.size,
    modifiedAt: Math.max(0, Math.floor(stat.mtimeMs)),
    extension: path.extname(absolutePath).toLowerCase() || "[no extension]",
  });
  didObserve();
}

function summarizeObserverRunContext(runs: StateSnapshot[]) {
  const recentRuns = [...runs]
    .sort((left, right) => right.updatedAt - left.updatedAt || left.runId.localeCompare(right.runId))
    .slice(0, 5)
    .map((run) => ({
      runId: run.runId,
      status: run.status,
      modeId: run.modeId ?? run.pattern,
      toolFailures: run.toolCalls.filter((toolCall) => toolCall.status === "failed" || toolCall.status === "interrupted").length,
      updatedAt: run.updatedAt,
    }));
  return {
    totalRuns: runs.length,
    failedRuns: runs.filter((run) => run.status === "failed").length,
    interruptedRuns: runs.filter((run) => run.status === "interrupted" || run.status === "cancelled").length,
    recentRuns,
  };
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.split(path.sep).join("/");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = escaped.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
  return new RegExp(`^${regex}$`);
}

function projectIdForSnapshotLocal(run: StateSnapshot, sessions: Map<string, SessionSummary>): string {
  if (run.sessionId) {
    const projectId = sessions.get(run.sessionId)?.projectId;
    if (projectId) return projectId;
  }
  const contextProjectId = run.input.context.projectId;
  return typeof contextProjectId === "string" && contextProjectId.trim() ? contextProjectId : "local-project";
}

function selfIterationEvaluationCase(candidate: SelfIterationCandidate) {
  const modeId = candidate.targetRef.modeId ?? SINGLE_AGENT_MODE_ID;
  const expectedText = routerOnlyRunOutputText(modeId);
  return {
    id: `self-iteration-${safeSelfIterationId(candidate.id)}`,
    input: {
      prompt: [
        candidate.title,
        candidate.summary,
        candidate.evidence.map((item) => item.summary ?? item.label).filter(Boolean).join("\n"),
      ].filter(Boolean).join("\n\n"),
      context: {
        selfIterationCandidateId: candidate.id,
        selfIterationTargetKind: candidate.targetKind,
      },
    },
    expected: { text: expectedText },
    metadata: {
      source: "self_iteration",
      candidateId: candidate.id,
      targetKind: candidate.targetKind,
      modeId,
    },
  };
}

function selfIterationModeDraftPrompt(candidate: SelfIterationCandidate): string {
  return [
    "Create a Mode Studio draft that improves Ora's mode orchestration from this evidence cluster.",
    `Candidate: ${candidate.title}`,
    `Summary: ${candidate.summary}`,
    `Operation: ${candidate.proposedChange.operation}`,
    "Evidence:",
    ...candidate.evidence.map((item) => `- ${item.label}: ${item.summary ?? item.target.id}`),
    "Keep the draft conservative, reviewable, and behind Mode Studio apply confirmation.",
  ].join("\n");
}

function resolveProfileModelRef(mode: { profiles: readonly { modelRef?: string | null }[] }): string | undefined {
  for (const profile of mode.profiles) {
    if (typeof profile.modelRef === "string" && profile.modelRef.length > 0) {
      return profile.modelRef;
    }
  }
  return undefined;
}

function selfIterationScoreEvidence(evaluationRunId: string, summaries: readonly EvaluationConfigSummary[]) {
  const before = summaries.find((summary) => summary.configId.startsWith("self-iteration-before")) ?? summaries[0];
  const after = summaries.find((summary) => summary.configId.startsWith("self-iteration-after")) ?? summaries[summaries.length - 1];
  if (!before || !after) {
    return { evaluationRunId };
  }
  return {
    evaluationRunId,
    before: selfIterationScoreSnapshot(before),
    after: selfIterationScoreSnapshot(after),
    delta: {
      overallScore: roundSelfIterationScore(after.overallScore - before.overallScore),
      passRate: roundSelfIterationScore(after.passRate - before.passRate),
      regressionCount: after.regressionCount - before.regressionCount,
    },
  };
}

function selfIterationScoreSnapshot(summary: EvaluationConfigSummary) {
  return {
    configId: summary.configId,
    overallScore: summary.overallScore,
    passRate: summary.passRate,
    regressionCount: summary.regressionCount,
    caseCount: summary.caseCount,
  };
}

function roundSelfIterationScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function routerOnlyRunOutputText(modeId: string): string {
  return `Evaluation router-only run selected mode '${modeId}'.`;
}

function safeSelfIterationId(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "candidate";
}

function runLatencyMark(
  source: RunLatencyMark["source"],
  name: string,
  at: number,
  detail: Record<string, unknown> = {},
): RunLatencyMark {
  return {
    name,
    at,
    source,
    detail,
  };
}

function withRunLatencyMarks(snapshot: StateSnapshot, marks: readonly RunLatencyMark[]): StateSnapshot {
  if (marks.length === 0) {
    return snapshot;
  }
  const existing = snapshot.latency?.marks ?? [];
  return StateSnapshotSchema.parse({
    ...snapshot,
    latency: { marks: [...existing, ...marks] },
  });
}

function appendFirstRunLatencyMark(snapshot: StateSnapshot, mark: RunLatencyMark): StateSnapshot {
  if (snapshot.latency?.marks.some((candidate) => candidate.name === mark.name)) {
    return snapshot;
  }
  return withRunLatencyMarks(snapshot, [mark]);
}

function markLatencyForRunEvent(snapshot: StateSnapshot, event: OraEventEnvelope, at: number): StateSnapshot {
  let next = appendFirstRunLatencyMark(
    snapshot,
    runLatencyMark("runtime", "firstApplyLiveEvent", at, { eventType: event.type, seq: event.seq }),
  );
  if (event.type === "message.delta" || event.type === "token.delta") {
    next = appendFirstRunLatencyMark(
      next,
      runLatencyMark("runtime", "firstTextDelta", at, { eventType: event.type, seq: event.seq }),
    );
  }
  if (event.type === "message.delta" && isRecord(event.payload) && typeof event.payload.content === "string" && event.payload.content.trim()) {
    next = appendFirstRunLatencyMark(
      next,
      runLatencyMark("runtime", "firstUserReadableAssistantTextProduced", at, { seq: event.seq }),
    );
  }
  if (event.type === "task.progress" && isRecord(event.payload) && event.payload.source === "progress_narrator") {
    next = appendFirstRunLatencyMark(
      next,
      runLatencyMark("runtime", "firstProgressNarration", at, { seq: event.seq }),
    );
  }
  if (event.type === "node.updated" && isRecord(event.payload)) {
    const state = typeof event.payload.state === "string" ? event.payload.state : undefined;
    if (state === "running_model") {
      next = appendFirstRunLatencyMark(
        next,
        runLatencyMark("runtime", "providerCallStarted", at, { agentId: event.agentId, seq: event.seq }),
      );
    }
    if (state === "tool_requested") {
      next = appendFirstRunLatencyMark(
        next,
        runLatencyMark("runtime", "firstToolCallDetected", at, { agentId: event.agentId, toolId: event.payload.toolId, seq: event.seq }),
      );
    }
    if (state === "sse_frame" || state === "local_stream_started") {
      next = appendFirstRunLatencyMark(
        next,
        runLatencyMark("provider", "firstProviderStreamFrame", at, { streamMode: event.payload.streamMode, seq: event.seq }),
      );
    }
    if (state === "fallback_started") {
      next = appendFirstRunLatencyMark(
        next,
        runLatencyMark("provider", "providerFallbackStarted", at, { streamMode: event.payload.streamMode, seq: event.seq }),
      );
    }
    if (state === "fallback_response") {
      next = appendFirstRunLatencyMark(
        next,
        runLatencyMark("provider", "providerFallbackResponse", at, { streamMode: event.payload.streamMode, seq: event.seq }),
      );
    }
  }
  if (event.type === "action.updated" && isRecord(event.payload) && event.payload.status === "proposed") {
    next = appendFirstRunLatencyMark(
      next,
      runLatencyMark("runtime", "firstToolCallDetected", at, { actionId: event.payload.actionId, seq: event.seq }),
    );
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTerminalRunStatus(status: StateSnapshot["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function acceptedPlanHandoffMessage(handoff: AcceptedPlanHandoff): ModelMessage {
  return {
    role: "system",
    content: [
      "The user accepted the following implementation plan in the immediately preceding plan-mode turn.",
      "Treat this accepted plan as a runtime handoff contract for the current implementation run.",
      "Execute it unless direct repository evidence requires a small adjustment; if you adjust it, explain why in the final response.",
      "",
      `Accepted plan decision: ${handoff.decisionId}`,
      `Accepted plan source run: ${handoff.sourceRunId}`,
      "",
      "<accepted_plan>",
      handoff.planContent,
      "</accepted_plan>",
    ].join("\n"),
  };
}

function priorTurnConversationMessages(entries: StateSnapshot["conversation"]): ModelMessage[] {
  return runtimeConversationToModelMessages(entries).filter((message) =>
    message.role !== "system" || !isAcceptedPlanHandoffMessage(message.content)
  );
}

function isAcceptedPlanHandoffMessage(content: string): boolean {
  return content.includes("<accepted_plan>") && content.includes("Accepted plan decision:");
}

function continuationSummary(snapshot: StateSnapshot) {
  return {
    activeFrameId: snapshot.continuation.activeFrameId,
    frameCount: snapshot.continuation.frames.length,
    frames: snapshot.continuation.frames.map((frame) => ({
      id: frame.id,
      status: frame.status,
      reason: frame.reason,
      agentId: frame.agentId,
      nodeId: frame.nodeId,
      planItemId: frame.planItemId,
      pendingActionIds: frame.pendingActionIds,
      pendingToolCallIds: frame.pendingToolCallIds,
      pendingClarificationIds: frame.pendingClarificationIds,
      approvedActionIds: frame.approvedActionIds,
      resolvedClarificationIds: frame.resolvedClarificationIds,
      resumedFromFrameId: frame.resumedFromFrameId,
      createdAt: frame.createdAt,
      updatedAt: frame.updatedAt,
    })),
    conversationEntryCount: snapshot.conversation.length,
    toolResultCount: snapshot.toolResults.length,
  };
}

function compactRuntimeEventBatchSnapshot(snapshot: StateSnapshot): StateSnapshot {
  return StateSnapshotSchema.parse({
    ...snapshot,
    events: [],
  });
}

function previousMainlineRunBefore(
  sessionId: string,
  runId: string,
  runs: StateSnapshot[],
): StateSnapshot | undefined {
  const index = runs.findIndex((run) => run.sessionId === sessionId && run.runId === runId);
  return index > 0 ? runs[index - 1] : undefined;
}

export class InMemoryRunStore extends LocalRunStore {}

export {
  defaultCustomAgentsDir,
  defaultEvaluationStoreDir,
  defaultFeedbackLoopStoreDir,
  defaultMemoryDir,
  defaultModesDir,
  defaultPublicSkillsDir,
  defaultRuntimeStoreDir,
  defaultSelfIterationStoreDir,
  defaultSkillsDir,
  defaultSystemAgentOverridesDir
};
