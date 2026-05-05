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
  RunConfig,
  RunConfigSchema,
  RunEventStream,
  SINGLE_AGENT_MODE_ID,
  RunForkParamsSchema,
  RunHandle,
  type RunLatencyMark,
  RunResumeParamsSchema,
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
  SessionPlanDecisionResolveParamsSchema,
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
  snapshotContainsCompleteProposedPlan,
  StateSnapshot,
  StateSnapshotSchema,
  SystemAgentOverride,
  SystemAgentOverrideResetParamsSchema,
  SystemAgentOverrideUpdateParamsSchema,
  SystemAgentOverrideUpdateParams,
  UserTaskInput,
  UserTaskInputSchema
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
  completeApprovedToolContinuation,
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
import type {
  RuntimePersistenceBackend,
  StoreManifest,
  StoredProject,
  StoredRun,
  StoredSession
} from "./persistence/types.js";
import type { ModelMessage } from "./providers/index.js";
import { invokeRunProvider } from "./providers/index.js";
import { readLangfuseRunTrace } from "./telemetry/langfuse.js";
import { mergeTrailObservations, synthesizeLocalTrail } from "./telemetry/trails.js";
import { LocalEvaluationStore } from "./evaluation-store.js";
import { LocalFeedbackLoopStore } from "./feedback-loop-store.js";
import { LocalSelfIterationStore } from "./self-iteration-store.js";
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
  approvedActionsForResume,
  hasKernelResumeWork,
  parseResumePatch,
  rebaseRunEvent,
  resumedInputWithClarifications,
  runningSnapshotForApprovedActions
} from "./run-orchestration.js";
import {
  executeTracedKernelResume,
  executeTracedKernelRun
} from "./run-kernel-lifecycle.js";
import {
  applyStreamingRunEvent,
  createStreamingFailure,
  publishRunStream,
  shouldFlushStreamingEvent
} from "./run-streaming.js";
import {
  applyNonKernelResumeApprovals,
  beginNonKernelResume,
  completeNonKernelResumeMutation,
  interruptedNonKernelResumeSnapshot,
  nonKernelResumeNeedsInput,
  resolveNonKernelResumeClarifications
} from "./run-resume-mutation.js";
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
  generateSessionTitle,
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
  private readonly customAgentStore: CustomAgentFileStore;
  private readonly systemAgentOverrideStore: SystemAgentOverrideFileStore;
  private readonly modeStore: ModeSpecFileStore;
  private readonly skillRegistry: RuntimeSkillRegistry;
  private readonly longTermMemory: LongTermMemoryManager;
  private readonly longTermMemoryQueue: LongTermMemoryUpdateQueue;
  private readonly channelService: ChannelService;
  private readonly automationService: AutomationService;
  private readonly selfIterationCuratorTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private projects = new Map<string, StoredProject>();
  private sessions = new Map<string, StoredSession>();
  private runs = new Map<string, StoredRun>();
  private activeStreamingAbortControllers = new Map<string, AbortController>();
  private manifest: StoreManifest;

  constructor(options: LocalRunStoreOptions = {}) {
    this.clock = options.clock ?? Date.now;
    const dataDir = options.dataDir ?? process.env.ORA_RUNTIME_STORE_DIR ?? path.join(process.cwd(), ".ora", "runtime.db");

    if (dataDir.endsWith(".db")) {
      this.persistenceType = "sqlite";
      this.backend = new SqliteRuntimePersistence(dataDir);
    } else {
      this.persistenceType = "json-file";
      this.backend = new JsonFileRuntimePersistenceBackend(dataDir);
    }
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
    const loaded = this.backend.load();
    this.manifest = StoreManifestSchema.parse(loaded.manifest);
    this.projects = new Map(loaded.projects.map((project) => [project.projectId, project]));
    this.sessions = new Map(loaded.sessions.map((session) => [session.sessionId, session]));
    this.runs = new Map(loaded.runs.map((run) => [run.runId, run]));
    migrateLegacyRunsIntoSessions(this.migrationState());
    migrateLegacyOraMvpProjectPlaceholder(this.migrationState());
    for (const projectId of this.projects.keys()) {
      this.syncProjectSummary(projectId);
    }
    this.backend.saveManifest(this.manifest);
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
    return runRuntimeMaintenance(params, {
      runs: this.runs,
      backend: this.backend,
    });
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
    return listSessionsOperation(params, this.projectSessionOperationDeps());
  }

  archiveSession(params: unknown): SessionSummary {
    return archiveSessionOperation(params, this.projectSessionOperationDeps());
  }

  getSession(params: unknown): SessionDetail {
    return getSessionOperation(params, this.projectSessionOperationDeps());
  }

  listSessionBranchGroups(params: unknown): SessionBranchGroup[] {
    const parsed = SessionBranchGroupListParamsSchema.parse(params);
    this.getSessionOrThrow(parsed.sessionId);
    return branchGroupsForSession(parsed.sessionId, [...this.runs.values()]).slice(0, parsed.limit);
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

    for (const [index, candidate] of parsed.candidates.entries()) {
      await this.startStreamingRun({
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
    this.cacheRun(adopted, true);

    for (const runId of group.candidateRunIds) {
      if (runId === candidate.runId) continue;
      const other = this.getRunOrThrow(runId);
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
    for (const runId of group.candidateRunIds) {
      const run = this.getRunOrThrow(runId);
      if (run.config.metadata.branchRole === "adopted") continue;
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
    return this.getSessionBranchGroup(parsed);
  }

  resolvePlanDecision(params: unknown): SessionDetail {
    const parsed = SessionPlanDecisionResolveParamsSchema.parse(params);
    const session = this.getSessionOrThrow(parsed.sessionId);
    const latestRunId = session.latestRunId;
    if (!latestRunId) {
      throw new OraRuntimeError(`Session '${parsed.sessionId}' has no run to resolve.`, -32004, {
        sessionId: parsed.sessionId,
      });
    }
    const snapshot = this.getRunOrThrow(latestRunId);
    const existing = snapshot.planDecisions.find((decision) => decision.id === parsed.decisionId);
    if (!existing) {
      throw new OraRuntimeError(`Plan decision '${parsed.decisionId}' does not exist.`, -32004, {
        sessionId: parsed.sessionId,
        decisionId: parsed.decisionId,
      });
    }
    const now = this.now();
    const updatedSnapshot = this.normalizeSnapshotForPersistence(StateSnapshotSchema.parse({
      ...snapshot,
      planDecisions: snapshot.planDecisions.map((decision) =>
        decision.id === parsed.decisionId
          ? {
              ...decision,
              status: parsed.status,
              resolvedAt: now,
            }
          : decision
      ),
      updatedAt: Math.max(snapshot.updatedAt, now),
    }));
    this.cacheRun(updatedSnapshot, true);
    return this.getSession({ sessionId: parsed.sessionId });
  }

  listRuns(params: unknown = {}): RunSummary[] {
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
    const session = this.ensureSessionForRun(parsed.sessionId, parsed.input);
    const input = this.enrichInputForSession(UserTaskInputSchema.parse({
      ...parsed.input,
      createdAt: parsed.input.createdAt ?? this.now()
    }), session);
    const resolved = await resolveModeSelection(parsed.config, input, session, this.modeSelectionDeps());
    const fullConfig = withMemoryPrompt(resolved.fullConfig, input, session, this.modeSelectionDeps());
    const { modeSpec, definition } = resolved;
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
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
    );
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
          text: `Evaluation router-only run selected mode '${modeSpec.id}'.`,
          selectedModeId: modeSpec.id,
          autoModeRouter: fullConfig.metadata.autoModeRouter,
        },
        updatedAt: completedAt,
      });
      const tracedSnapshot = attachTraceMetadata(routerOnlySnapshot);
      this.persistRun(tracedSnapshot);
      return toRunHandle(tracedSnapshot);
    }
    const sessionBoundSnapshot = await executeTracedKernelRun({
      runId,
      input,
      config: fullConfig,
      modeSpec,
      definition,
      sessionId: session.sessionId,
      turnIndex,
      clock: this.clock,
      skillRegistry: this.skillRegistry,
      modeRegistry: this,
      selfIterationRegistry: this,
      automationRegistry: this,
      customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
      customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
      systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.customAgentContextsForMode(modeSpec),
      conversationMessages,
    });
    const tracedSnapshot = attachTraceMetadata(this.withSnapshotContextState(sessionBoundSnapshot));
    await this.persistRunWithGeneratedTitle(tracedSnapshot);
    return toRunHandle(tracedSnapshot);
  }

  async startStreamingRun(params: unknown, options: StreamingRunOptions = {}): Promise<RunHandle> {
    const latencyMarks: RunLatencyMark[] = [];
    const markRuntimeLatency = (name: string, detail: Record<string, unknown> = {}) => {
      latencyMarks.push(runLatencyMark("runtime", name, this.now(), detail));
    };
    markRuntimeLatency("startStreamingRun.enter");
    const parsed = StartRunParamsSchema.parse(params);
    const session = this.ensureSessionForRun(parsed.sessionId, parsed.input);
    const input = this.enrichInputForSession(UserTaskInputSchema.parse({
      ...parsed.input,
      createdAt: parsed.input.createdAt ?? this.now()
    }), session);
    const resolved = await resolveModeSelection(parsed.config, input, session, this.modeSelectionDeps());
    markRuntimeLatency("modeSelection.done", {
      modeSelection: resolved.fullConfig.modeSelection,
      modeId: resolved.modeSpec.id,
    });
    const { modeSpec, definition } = resolved;
    const fullConfig = withMemoryPrompt(resolved.fullConfig, input, session, this.modeSelectionDeps());
    markRuntimeLatency("memoryPrompt.done", {
      hasMemoryPromptOverlay: typeof fullConfig.metadata.memoryPromptOverlay === "string",
      activeMemoryDecision: isRecord(fullConfig.metadata.activeMemory) ? fullConfig.metadata.activeMemory.decision : undefined,
    });
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
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
    markRuntimeLatency("snapshot.created");
    liveSnapshot = withRunLatencyMarks(liveSnapshot, latencyMarks);
    this.persistRun(liveSnapshot);
    liveSnapshot = appendFirstRunLatencyMark(liveSnapshot, runLatencyMark("runtime", "snapshotPersisted", this.now()));
    liveSnapshot = appendFirstRunLatencyMark(liveSnapshot, runLatencyMark("runtime", "kernelScheduled", this.now()));
    this.cacheRun(liveSnapshot, false, { deferInitialTitle: true });
    const abortController = new AbortController();
    this.activeStreamingAbortControllers.set(runId, abortController);

    const publishStream = (events: OraEventEnvelope[], snapshot?: StateSnapshot) => {
      publishRunStream({
        onStream: options.onStream,
        runId,
        events,
        liveSnapshot,
        snapshot,
      });
    };

    const applyLiveEvent = (event: OraEventEnvelope) => {
      if (abortController.signal.aborted || this.isRunCancelled(runId)) {
        return;
      }
      liveSnapshot = markLatencyForRunEvent(liveSnapshot, event, this.now());
      liveSnapshot = applyStreamingRunEvent(liveSnapshot, event);
      this.cacheRun(liveSnapshot, shouldFlushStreamingEvent(event), {
        deferInitialTitle: true,
      });
      publishStream([event]);
    };

    void executeTracedKernelRun({
      runId,
      input,
      config: fullConfig,
      modeSpec,
      definition,
      sessionId: session.sessionId,
      turnIndex,
      clock: this.clock,
      skillRegistry: this.skillRegistry,
      modeRegistry: this,
      selfIterationRegistry: this,
      automationRegistry: this,
      customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
      customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
      systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.customAgentContextsForMode(modeSpec),
      conversationMessages,
      streamProvider: true,
      signal: abortController.signal,
      onEvent: applyLiveEvent,
    }).then(async (snapshot) => {
      this.activeStreamingAbortControllers.delete(runId);
      const cancelled = this.cancelledSnapshot(runId);
      if (cancelled) {
        liveSnapshot = cancelled;
        publishStream([], cancelled);
        return;
      }
      const finalSnapshot = attachTraceMetadata(this.withSnapshotContextState(withRunLatencyMarks(snapshot, liveSnapshot.latency?.marks ?? [])));
      await this.persistRunWithGeneratedTitle(finalSnapshot);
      publishStream([], finalSnapshot);
    }).catch(async (error) => {
      this.activeStreamingAbortControllers.delete(runId);
      const cancelled = this.cancelledSnapshot(runId);
      if (cancelled) {
        liveSnapshot = cancelled;
        publishStream([], cancelled);
        return;
      }
      const failure = createStreamingFailure({
        liveSnapshot,
        runId,
        pattern: fullConfig.pattern,
        error,
        failedAt: this.now(),
      });
      liveSnapshot = attachTraceMetadata(failure.snapshot);
      await this.persistRunWithGeneratedTitle(liveSnapshot);
      publishStream([failure.event], liveSnapshot);
    });

    return toRunHandle(liveSnapshot);
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

  async resumeStreamingRun(params: unknown, options: StreamingRunOptions = {}): Promise<RunHandle> {
    const parsed = RunResumeParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    const { clarificationPatch, approvedActionIds } = parseResumePatch(parsed.patch);
    const hasKernelWork = hasKernelResumeWork(snapshot);

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
    const abortController = new AbortController();
    this.activeStreamingAbortControllers.set(snapshot.runId, abortController);

    const publishStream = (events: OraEventEnvelope[], streamSnapshot?: StateSnapshot) => {
      publishRunStream({
        onStream: options.onStream,
        runId: snapshot.runId,
        events,
        liveSnapshot,
        snapshot: streamSnapshot,
      });
    };
    publishStream([], liveSnapshot);

    if (approvedToolContinuationActions(snapshot, approvedActionIds).length > 0) {
      void completeApprovedToolContinuation(
        snapshot,
        approvedActionIds,
        { reason: parsed.reason, patch: parsed.patch },
        this.approvedFileWriteResumeDeps(),
        (event, nextSnapshot) => {
          if (abortController.signal.aborted || this.isRunCancelled(snapshot.runId)) {
            return;
          }
          liveSnapshot = nextSnapshot;
          this.cacheRun(liveSnapshot, shouldFlushStreamingEvent(event), {
            deferInitialTitle: true,
          });
          publishStream([event], liveSnapshot);
        },
      ).then(async (completed) => {
        this.activeStreamingAbortControllers.delete(snapshot.runId);
        if (!completed) {
          return;
        }
        const cancelled = this.cancelledSnapshot(snapshot.runId);
        if (cancelled) {
          liveSnapshot = cancelled;
          publishStream([], cancelled);
          return;
        }
        liveSnapshot = completed;
        await this.persistRunWithGeneratedTitle(completed);
        publishStream([], completed);
      }).catch(async (error) => {
        this.activeStreamingAbortControllers.delete(snapshot.runId);
        const cancelled = this.cancelledSnapshot(snapshot.runId);
        if (cancelled) {
          liveSnapshot = cancelled;
          publishStream([], cancelled);
          return;
        }
        const failure = createStreamingFailure({
          liveSnapshot,
          runId: snapshot.runId,
          pattern: snapshot.config.pattern,
          error,
          failedAt: this.now(),
        });
        liveSnapshot = attachTraceMetadata(failure.snapshot);
        await this.persistRunWithGeneratedTitle(liveSnapshot);
        publishStream([failure.event], liveSnapshot);
      });
      return toRunHandle(liveSnapshot);
    }

    const approvedActions = approvedActionsForResume(snapshot, approvedActionIds);
    const resumedInput = resumedInputWithClarifications(snapshot.input, clarificationPatch);
    const definition = modeSpecToPatternDefinition(modeSpec);
    const baseSeq = snapshot.events.length;
    const applyLiveEvent = (event: OraEventEnvelope) => {
      if (abortController.signal.aborted || this.isRunCancelled(snapshot.runId)) {
        return;
      }
      const rebasedEvent = rebaseRunEvent(event, snapshot.runId, baseSeq);
      liveSnapshot = applyStreamingRunEvent(liveSnapshot, rebasedEvent);
      this.cacheRun(liveSnapshot, shouldFlushStreamingEvent(rebasedEvent), {
        deferInitialTitle: true,
      });
      publishStream([rebasedEvent]);
    };

    void executeTracedKernelResume({
      runId: snapshot.runId,
      input: resumedInput,
      config: snapshot.config,
      modeSpec,
      definition,
      sessionId,
      turnIndex: snapshot.turnIndex,
      clock: this.clock,
      skillRegistry: this.skillRegistry,
      modeRegistry: this,
      selfIterationRegistry: this,
      automationRegistry: this,
      customAgentOverlay: this.customAgentStore.personaOverlay(snapshot.config.customAgentId),
      customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
      systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.customAgentContextsForMode(modeSpec),
      conversationMessages: [
        ...this.buildConversationMessages(sessionId, resumedInput.prompt, snapshot.runId),
        ...runtimeConversationToModelMessages(snapshot.conversation),
      ],
      clarificationPatch,
      approvedActionIds,
      approvedActions,
      resumeSnapshot: snapshot,
      signal: abortController.signal,
      onEvent: applyLiveEvent,
    }).then(async (nextSnapshot) => {
      this.activeStreamingAbortControllers.delete(snapshot.runId);
      const cancelled = this.cancelledSnapshot(snapshot.runId);
      if (cancelled) {
        liveSnapshot = cancelled;
        publishStream([], cancelled);
        return;
      }
      const finalSnapshot = this.appendResolvedClarificationEvents(
        attachTraceMetadata(nextSnapshot),
        snapshot.pendingClarifications,
        clarificationPatch,
      );
      await this.persistRunWithGeneratedTitle(finalSnapshot);
      publishStream([], finalSnapshot);
    }).catch(async (error) => {
      this.activeStreamingAbortControllers.delete(snapshot.runId);
      const cancelled = this.cancelledSnapshot(snapshot.runId);
      if (cancelled) {
        liveSnapshot = cancelled;
        publishStream([], cancelled);
        return;
      }
      const failure = createStreamingFailure({
        liveSnapshot,
        runId: snapshot.runId,
        pattern: snapshot.config.pattern,
        error,
        failedAt: this.now(),
      });
      liveSnapshot = attachTraceMetadata(failure.snapshot);
      await this.persistRunWithGeneratedTitle(liveSnapshot);
      publishStream([failure.event], liveSnapshot);
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
    );
    const sessionBoundSnapshot = await executeTracedKernelRun({
      runId,
      input,
      config: fullConfig,
      modeSpec,
      definition,
      sessionId: session.sessionId,
      turnIndex,
      clock: this.clock,
      skillRegistry: this.skillRegistry,
      modeRegistry: this,
      selfIterationRegistry: this,
      automationRegistry: this,
      customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
      customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
      systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.customAgentContextsForMode(modeSpec),
      forkedFrom,
      conversationMessages,
    });
    const tracedSnapshot = attachTraceMetadata(this.withSnapshotContextState(sessionBoundSnapshot));
    await this.persistRunWithGeneratedTitle(tracedSnapshot);
    return toRunHandle(tracedSnapshot);
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
    );
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

    const sessionBoundSnapshot = attachTraceMetadata(this.withSnapshotContextState(StateSnapshotSchema.parse({
      ...snapshot,
      sessionId: session.sessionId,
      turnIndex,
      coordinationKind: snapshot.coordinationKind ?? snapshot.pattern,
      modeId: snapshot.modeId ?? modeSpec.id,
      modeSpec: snapshot.modeSpec ?? modeSpec,
    })));
    await this.persistRunWithGeneratedTitle(sessionBoundSnapshot);
    return toRunHandle(sessionBoundSnapshot);
  }

  streamRun(params: unknown): RunEventStream {
    return streamRun(params, this.runStateOperationDeps());
  }

  interruptRun(params: unknown): StateSnapshot {
    return interruptRun(params, this.runStateOperationDeps(), USER_INTERRUPTED_MESSAGE);
  }

  async resumeRun(params: unknown): Promise<StateSnapshot> {
    const parsed = RunResumeParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    const { clarificationPatch, approvedActionIds } = parseResumePatch(parsed.patch);
    const approvedActions = approvedActionsForResume(snapshot, approvedActionIds);
    const completedApprovedTool = await completeApprovedToolContinuation(
      snapshot,
      approvedActionIds,
      { reason: parsed.reason, patch: parsed.patch },
      this.approvedFileWriteResumeDeps(),
    );
    if (completedApprovedTool) {
      await this.persistRunWithGeneratedTitle(completedApprovedTool);
      return completedApprovedTool;
    }
    const hasKernelWork = hasKernelResumeWork(snapshot);

    if (hasKernelWork) {
      const modeSpec = snapshot.modeSpec;
      if (!modeSpec) {
        throw new OraRuntimeError("Cannot resume a kernel-backed run without modeSpec.", -32004, {
          runId: snapshot.runId,
        });
      }
      const resumedInput = resumedInputWithClarifications(snapshot.input, clarificationPatch);
      const definition = modeSpecToPatternDefinition(modeSpec);
      const sessionId = snapshot.sessionId;
      if (!sessionId) {
        throw new OraRuntimeError("Cannot resume a kernel-backed run without sessionId.", -32004, {
          runId: snapshot.runId,
        });
      }

      const resumedSnapshot = await executeTracedKernelResume({
        runId: snapshot.runId,
        input: resumedInput,
        config: snapshot.config,
        modeSpec,
        definition,
        sessionId,
        turnIndex: snapshot.turnIndex,
        clock: this.clock,
        skillRegistry: this.skillRegistry,
        modeRegistry: this,
        selfIterationRegistry: this,
        automationRegistry: this,
        customAgentOverlay: this.customAgentStore.personaOverlay(snapshot.config.customAgentId),
        customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
        systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
        customAgentContexts: this.customAgentContextsForMode(modeSpec),
        conversationMessages: [
          ...this.buildConversationMessages(sessionId, resumedInput.prompt, snapshot.runId),
          ...runtimeConversationToModelMessages(snapshot.conversation),
        ],
        clarificationPatch,
        approvedActionIds,
        approvedActions,
        resumeSnapshot: snapshot,
      });
      const tracedSnapshot = this.appendResolvedClarificationEvents(
        attachTraceMetadata(resumedSnapshot),
        snapshot.pendingClarifications,
        clarificationPatch,
      );
      await this.persistRunWithGeneratedTitle(tracedSnapshot);
      return tracedSnapshot;
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

    let working = beginNonKernelResume({
      snapshot,
      reason: parsed.reason ?? USER_RESUMED_MESSAGE,
      patch: parsed.patch,
      deps: resumeMutationDeps,
    });
    working = resolveNonKernelResumeClarifications({
      snapshot: working,
      clarificationPatch,
      appendEvent: resumeMutationDeps.appendEvent,
    });
    working = applyNonKernelResumeApprovals(working, resumeMutationDeps);

    if (nonKernelResumeNeedsInput(working)) {
      const updated = interruptedNonKernelResumeSnapshot(working, this.now());
      this.persistRun(updated);
      return updated;
    }

    const updated = completeNonKernelResumeMutation(working, resumeMutationDeps);
    const syncedTodos = this.syncSnapshotTodos(updated, "resume.completed");
    await this.persistRunWithGeneratedTitle(syncedTodos);
    return syncedTodos;
  }

  cancelRun(params: unknown): StateSnapshot {
    const runId = this.requireRunId(params);
    this.activeStreamingAbortControllers.get(runId)?.abort(USER_CANCELLED_MESSAGE);
    this.activeStreamingAbortControllers.delete(runId);
    return cancelRun(params, this.runStateOperationDeps(), USER_CANCELLED_MESSAGE);
  }

  getRunState(params: unknown): StateSnapshot {
    return getRunState(params, this.runStateOperationDeps());
  }

  persistExternalSnapshot(snapshot: StateSnapshot): StateSnapshot {
    return persistExternalSnapshot(snapshot, this.runStateOperationDeps());
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

  replayRun(params: unknown): RunEventStream {
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
    this.persistRun(updated);
    return toRunHandle(updated);
  }

  exportReport(params: unknown): ArtifactRef {
    return exportReport(params, this.runStateOperationDeps());
  }

  importEvaluationDataset(params: unknown) {
    return this.evaluationStore.importDataset(params);
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
    const detail = await this.evaluationStore.startRun(params, createRun);
    this.queueSelfIterationCurator("evaluation_run_completed");
    return detail;
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

  scanSelfIteration(params: unknown = {}) {
    return this.selfIterationStore.scan(params, this.selfIterationInput(), {
      applyEvaluationCandidate: (candidate) => this.applyEvaluationSelfIterationCandidate(candidate),
    });
  }

  listSelfIterationCandidates(params: unknown = {}) {
    return this.selfIterationStore.listCandidates(params);
  }

  getSelfIterationCandidate(params: unknown) {
    return this.selfIterationStore.getCandidate(params);
  }

  evaluateSelfIterationCandidate(params: unknown) {
    return this.selfIterationStore.evaluateCandidate(params, {
      evaluateCandidate: (candidate) => this.runSelfIterationEvaluation(candidate),
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
    });
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
      persistRun: (snapshot) => this.persistRun(snapshot),
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
      getProjectOrThrow: (projectId) => this.getProjectOrThrow(projectId),
      getSessionOrThrow: (sessionId) => this.getSessionOrThrow(sessionId),
      getRunOrThrow: (runId) => this.getRunOrThrow(runId),
      runsForSession: (sessionId) => this.runsForSession(sessionId),
      sessionTranscript: (sessionId) => this.sessionTranscript(sessionId),
    };
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
    const normalized = this.normalizeSnapshotForPersistence(snapshot);
    this.cacheRun(normalized, true);
    if (isUnadoptedBranchCandidate(normalized)) {
      return;
    }
    scheduleLongTermMemoryUpdate(normalized, this.memoryUpdateDeps());
    this.queueSelfIterationAfterTerminalRun(normalized);
  }

  private async persistRunWithGeneratedTitle(snapshot: StateSnapshot): Promise<void> {
    const normalized = this.normalizeSnapshotForPersistence(snapshot);
    const titleOverride = await generateSessionTitle(
      normalized,
      normalized.sessionId ? this.sessions.get(normalized.sessionId)?.title : undefined,
    );
    this.cacheRun(normalized, true, { titleOverride });
    if (isUnadoptedBranchCandidate(normalized)) {
      return;
    }
    scheduleLongTermMemoryUpdate(normalized, this.memoryUpdateDeps());
    this.queueSelfIterationAfterTerminalRun(normalized);
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

  private runSelfIterationCurator(trigger: SelfIterationCuratorTrigger, projectId?: string): void {
    try {
      this.selfIterationStore.triggerCuratorScan({ projectId, trigger }, this.selfIterationInput(), {
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
      const session = this.upsertSessionFromRun(snapshot, options);
      this.sessions.set(session.sessionId, session);
      if (flush) {
        this.backend.saveSession(session);
        if (session.projectId) {
          this.syncProjectSummary(session.projectId);
        }
      }
    }
    if (flush) {
      this.backend.saveRun(snapshot);
      this.backend.saveManifest(this.manifest);
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
      cacheRun: (snapshot, flush) => this.cacheRun(snapshot, flush),
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

  private cancelledSnapshot(runId: string): StateSnapshot | undefined {
    const snapshot = this.runs.get(runId);
    return snapshot?.status === "cancelled" ? snapshot : undefined;
  }

  private isRunCancelled(runId: string): boolean {
    return this.cancelledSnapshot(runId) !== undefined;
  }

  private getRunOrThrow(runId: string): StateSnapshot {
    const snapshot = this.runs.get(runId);
    if (!snapshot) {
      throw new OraRuntimeError(`Run not found: ${runId}`, -32004, { runId });
    }
    return snapshot;
  }

  private getSessionOrThrow(sessionId: string): SessionSummary {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new OraRuntimeError(`Session not found: ${sessionId}`, -32004, { sessionId });
    }
    return session;
  }

  private getProjectOrThrow(projectId: string): ProjectSummary {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new OraRuntimeError(`Project not found: ${projectId}`, -32004, { projectId });
    }
    return project;
  }

  private persistSession(session: SessionSummary): void {
    this.sessions.set(session.sessionId, session);
    this.backend.saveSession(session);
    if (session.projectId) {
      this.syncProjectSummary(session.projectId);
    }
    this.backend.saveManifest(this.manifest);
  }

  private persistProject(project: ProjectSummary): void {
    this.projects.set(project.projectId, project);
    this.backend.saveProject(project);
    this.backend.saveManifest(this.manifest);
  }

  private allRunsForSession(sessionId: string): StateSnapshot[] {
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
    return this.createSession({ projectId: input.projectId });
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
    this.sessions.set(sessionId, updated);
    this.backend.saveSession(updated);
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
    return SessionSummarySchema.parse({
      sessionId,
      title,
      projectId: snapshot.input.projectId ?? existing?.projectId,
      status: snapshot.status,
      attention: deriveRunAttention(snapshot),
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
      normalized = StateSnapshotSchema.parse({
        ...normalized,
        planDecisions: [{
          id: `${normalized.runId}:plan-decision`,
          runId: normalized.runId,
          sessionId: normalized.sessionId,
          status: "pending",
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
  ): Promise<ModelMessage[]> {
    const session = this.getSessionOrThrow(sessionId);
    const provider = resolveRunProviderConfig(config);
    const excludeRunId = config.metadata.branchTarget === "replace_latest" && typeof config.metadata.branchReplaceRunId === "string"
      ? config.metadata.branchReplaceRunId
      : undefined;
    const priorMessages = this.buildConversationMessages(sessionId, "", excludeRunId);
    let messages = this.buildConversationMessages(sessionId, currentPrompt, excludeRunId);
    const check = shouldCompactContext({
      contextState: session.contextState,
      provider,
      messages,
    });
    const branchCandidate = config.metadata.branchRole === "candidate";
    if (!branchCandidate) {
      this.persistSessionContextState(sessionId, {
        ...normalizeContextState(session.contextState),
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
      previousState: session.contextState,
      compactedThroughTurnIndex: Math.max(0, turnIndex - 1),
      now: this.now(),
    });
    this.persistSessionContextState(sessionId, compacted.contextState);
    messages = [
      ...compacted.messages,
      ...(currentPrompt.trim() ? [{ role: "user" as const, content: currentPrompt.trim() }] : []),
    ];
    return messages;
  }

  private persistSessionContextState(sessionId: string, contextState: SessionSummary["contextState"]): void {
    const existing = this.getSessionOrThrow(sessionId);
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
        messages.push(...runtimeConversationToModelMessages(turn.conversation));
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
    };
  }

  private async runSelfIterationEvaluation(candidate: SelfIterationCandidate) {
    const modeDraft = candidate.targetKind === "mode"
      ? this.generateSelfIterationModeDraft(candidate)
      : undefined;
    const datasetId = this.selfIterationEvaluationDatasetId(candidate);
    const modeId = candidate.targetRef.modeId ?? SINGLE_AGENT_MODE_ID;
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
          providerId: "local-smoke",
          modelRef: "local/smoke-model",
          metadata: {
            evaluationRouterOnly: true,
            selfIterationCandidateId: candidate.id,
            selfIterationTargetKind: candidate.targetKind,
            selfIterationScorePhase: phase,
          },
        },
      })),
      repetitions: 1,
      concurrency: 1,
      metadata: {
        source: "self_iteration",
        candidateId: candidate.id,
        targetKind: candidate.targetKind,
      },
    });
    const detail = await this.startEvaluationRun(spec, async ({ input, config }) => {
      const handle = await this.startRun({ input, config });
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
        score: scorecard.overallScore,
        passRate: scorecard.passRate,
        regressionCount: scorecard.regressionCount,
        totalAttempts: detail.run.totalAttempts,
        scoreEvidence,
      },
      proposedChangeAfter: modeDraft ?? candidate.proposedChange.after,
      proposedChangeMetadata: modeDraft
        ? { modeStudioDraftGenerated: true, modeStudioDraftNeedsInput: modeDraft.needsInput, modeStudioDraftValid: modeDraft.validation.valid }
        : undefined,
    };
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
    const caseRecord = selfIterationEvaluationCase(candidate);
    const dataset = this.evaluationStore.importDataset({
      name: `Self-Iteration Gate · ${candidate.targetKind}`,
      description: `Synthetic gate dataset for candidate ${candidate.id}.`,
      sourceFormat: "inline",
      content: JSON.stringify([caseRecord]),
      tags: ["self-iteration", candidate.targetKind],
    });
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
  const expectedText = `Evaluation router-only run selected mode '${modeId}'.`;
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

function selfIterationScoreEvidence(evaluationRunId: string, summaries: readonly EvaluationConfigSummary[]) {
  const before = summaries.find((summary) => summary.configId === "self-iteration-before") ?? summaries[0];
  const after = summaries.find((summary) => summary.configId === "self-iteration-after") ?? before;
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
