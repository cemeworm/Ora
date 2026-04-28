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
  EvaluationFeedbackRecord,
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
  ProjectSummary,
  ProjectSummarySchema,
  RunConfig,
  RunConfigSchema,
  RunEventStream,
  RunForkParamsSchema,
  RunHandle,
  RunResumeParamsSchema,
  RunTrail,
  RunTrailParamsSchema,
  RunTrailSchema,
  RunSummary,
  SessionDetail,
  SessionSummary,
  SessionSummarySchema,
  SessionTranscriptMessage,
  SessionTranscriptMessageSchema,
  SessionTurn,
  SkillCheckNameResult,
  SkillCreateParams,
  SkillDetail,
  SkillRegistry,
  SkillSetEnabledParams,
  SkillUpdateParams,
  StateSnapshot,
  StateSnapshotSchema,
  SystemAgentOverride,
  SystemAgentOverrideResetParamsSchema,
  SystemAgentOverrideUpdateParamsSchema,
  SystemAgentOverrideUpdateParams,
  UserTaskInput,
  UserTaskInputSchema
} from "@ora/shared";
import { TodoService } from "./capabilities.js";
import { CustomAgentFileStore } from "./custom-agents.js";
import { SystemAgentOverrideFileStore } from "./custom-agents.js";
import { RuntimeSkillRegistry, RuntimeToolRegistry } from "./harness/capability-registries.js";
import {
  approvedFileWriteResumeActions,
  completeApprovedFileWriteResume,
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
import { readLangfuseRunTrace } from "./telemetry/langfuse.js";
import { mergeTrailObservations, synthesizeLocalTrail } from "./telemetry/trails.js";
import { LocalEvaluationStore } from "./evaluation-store.js";
import { LocalFeedbackLoopStore } from "./feedback-loop-store.js";
import {
  projectWorkspaceContext
} from "./project-workspace.js";
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
import {
  defaultCustomAgentsDir,
  defaultEvaluationStoreDir,
  defaultFeedbackLoopStoreDir,
  defaultMemoryDir,
  defaultModesDir,
  defaultPublicSkillsDir,
  defaultRuntimeStoreDir,
  defaultSkillsDir,
  defaultSystemAgentOverridesDir
} from "./runtime-store-paths.js";
import {
  DEFAULT_SESSION_TITLE,
  assistantTextForRun,
  defaultSessionTitle,
  generateSessionTitle
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
  createProject as createProjectOperation,
  createSession as createSessionOperation,
  getProject as getProjectOperation,
  getSession as getSessionOperation,
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
  private readonly customAgentStore: CustomAgentFileStore;
  private readonly systemAgentOverrideStore: SystemAgentOverrideFileStore;
  private readonly modeStore: ModeSpecFileStore;
  private readonly skillRegistry: RuntimeSkillRegistry;
  private readonly longTermMemory: LongTermMemoryManager;
  private readonly longTermMemoryQueue: LongTermMemoryUpdateQueue;
  private projects = new Map<string, StoredProject>();
  private sessions = new Map<string, StoredSession>();
  private runs = new Map<string, StoredRun>();
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
      clock: this.clock,
    });
    this.evaluationStore = new LocalEvaluationStore(defaultEvaluationStoreDir(dataDir), this.clock);
    this.feedbackLoopStore = new LocalFeedbackLoopStore(defaultFeedbackLoopStoreDir(dataDir), this.clock);
    this.longTermMemory = new LongTermMemoryManager(
      new FileLongTermMemoryStore(defaultMemoryDir(dataDir)),
      this.clock,
    );
    this.longTermMemoryQueue = new LongTermMemoryUpdateQueue((task) =>
      processLongTermMemoryUpdate(task, this.memoryUpdateDeps())
    );
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

  deleteSkill(params: unknown): { deleted: true; name: string } {
    return this.skillRegistry.delete(params);
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
    const fullConfig = withMemoryPrompt(resolved.fullConfig, this.modeSelectionDeps());
    const { modeSpec, definition } = resolved;
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
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
      customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
      customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
      systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.customAgentContextsForMode(modeSpec),
      conversationMessages: this.buildConversationMessages(session.sessionId, input.prompt),
    });
    const tracedSnapshot = attachTraceMetadata(sessionBoundSnapshot);
    await this.persistRunWithGeneratedTitle(tracedSnapshot);
    return toRunHandle(tracedSnapshot);
  }

  async startStreamingRun(params: unknown, options: StreamingRunOptions = {}): Promise<RunHandle> {
    const parsed = StartRunParamsSchema.parse(params);
    const session = this.ensureSessionForRun(parsed.sessionId, parsed.input);
    const input = this.enrichInputForSession(UserTaskInputSchema.parse({
      ...parsed.input,
      createdAt: parsed.input.createdAt ?? this.now()
    }), session);
    const resolved = await resolveModeSelection(parsed.config, input, session, this.modeSelectionDeps());
    const { modeSpec, definition } = resolved;
    const fullConfig = withMemoryPrompt(resolved.fullConfig, this.modeSelectionDeps());
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
    const conversationMessages = this.buildConversationMessages(session.sessionId, input.prompt);
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
    this.persistRun(liveSnapshot);

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
      customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
      customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
      systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.customAgentContextsForMode(modeSpec),
      conversationMessages,
      streamProvider: true,
      onEvent: applyLiveEvent,
    }).then(async (snapshot) => {
      const finalSnapshot = attachTraceMetadata(snapshot);
      await this.persistRunWithGeneratedTitle(finalSnapshot);
      publishStream([], finalSnapshot);
    }).catch(async (error) => {
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

    if (approvedFileWriteResumeActions(snapshot, approvedActionIds).length > 0) {
      void completeApprovedFileWriteResume(
        snapshot,
        approvedActionIds,
        { reason: parsed.reason, patch: parsed.patch },
        this.approvedFileWriteResumeDeps(),
        (event, nextSnapshot) => {
          liveSnapshot = nextSnapshot;
          this.cacheRun(liveSnapshot, shouldFlushStreamingEvent(event), {
            deferInitialTitle: true,
          });
          publishStream([event], liveSnapshot);
        },
      ).then(async (completed) => {
        if (!completed) {
          return;
        }
        liveSnapshot = completed;
        await this.persistRunWithGeneratedTitle(completed);
        publishStream([], completed);
      }).catch(async (error) => {
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
      customAgentOverlay: this.customAgentStore.personaOverlay(snapshot.config.customAgentId),
      customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
      systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.customAgentContextsForMode(modeSpec),
      conversationMessages: this.buildConversationMessages(sessionId, resumedInput.prompt, snapshot.runId),
      clarificationPatch,
      approvedActionIds,
      approvedActions,
      onEvent: applyLiveEvent,
    }).then(async (nextSnapshot) => {
      const finalSnapshot = attachTraceMetadata(nextSnapshot);
      await this.persistRunWithGeneratedTitle(finalSnapshot);
      publishStream([], finalSnapshot);
    }).catch(async (error) => {
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
    const fullConfig = withMemoryPrompt(resolved.fullConfig, this.modeSelectionDeps());
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
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
      customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
      customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
      systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.customAgentContextsForMode(modeSpec),
      forkedFrom,
      conversationMessages: this.buildConversationMessages(session.sessionId, input.prompt),
    });
    const tracedSnapshot = attachTraceMetadata(sessionBoundSnapshot);
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
    const fullConfig = withMemoryPrompt(resolved.fullConfig, this.modeSelectionDeps());
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
    const conversationMessages = this.buildConversationMessages(session.sessionId, input.prompt);
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

    const sessionBoundSnapshot = attachTraceMetadata(StateSnapshotSchema.parse({
      ...snapshot,
      sessionId: session.sessionId,
      turnIndex,
      coordinationKind: snapshot.coordinationKind ?? snapshot.pattern,
      modeId: snapshot.modeId ?? modeSpec.id,
      modeSpec: snapshot.modeSpec ?? modeSpec,
    }));
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
    const completedApprovedFileWrite = await completeApprovedFileWriteResume(
      snapshot,
      approvedActionIds,
      { reason: parsed.reason, patch: parsed.patch },
      this.approvedFileWriteResumeDeps(),
    );
    if (completedApprovedFileWrite) {
      await this.persistRunWithGeneratedTitle(completedApprovedFileWrite);
      return completedApprovedFileWrite;
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
        customAgentOverlay: this.customAgentStore.personaOverlay(snapshot.config.customAgentId),
        customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
        systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
        customAgentContexts: this.customAgentContextsForMode(modeSpec),
        conversationMessages: this.buildConversationMessages(sessionId, resumedInput.prompt, snapshot.runId),
        clarificationPatch,
        approvedActionIds,
        approvedActions,
      });
      const tracedSnapshot = attachTraceMetadata(resumedSnapshot);
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

    return this.startRunWithKernel({
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

  async startEvaluationRun(
    params: unknown,
    createRun: (params: { input: UserTaskInput; config: Partial<RunConfig> }) => Promise<StateSnapshot>
  ) {
    return this.evaluationStore.startRun(params, createRun);
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
    return this.evaluationStore.submitFeedback(
      params,
      sourceContext,
      ({ feedbackId, feedbackText, sourceContext }) => curateFeedbackDraft(snapshot.config, feedbackId, feedbackText, sourceContext)
    );
  }

  listEvaluationFeedback(params: unknown = {}) {
    return this.evaluationStore.listFeedback(params);
  }

  getEvaluationFeedback(params: unknown) {
    return this.evaluationStore.getFeedback(params);
  }

  updateEvaluationFeedback(params: unknown) {
    return this.evaluationStore.updateFeedback(params);
  }

  acceptEvaluationFeedback(params: unknown) {
    return this.evaluationStore.acceptFeedback(params);
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
    this.cacheRun(snapshot, true);
    scheduleLongTermMemoryUpdate(snapshot, this.memoryUpdateDeps());
  }

  private async persistRunWithGeneratedTitle(snapshot: StateSnapshot): Promise<void> {
    const titleOverride = await generateSessionTitle(
      snapshot,
      snapshot.sessionId ? this.sessions.get(snapshot.sessionId)?.title : undefined,
    );
    this.cacheRun(snapshot, true, { titleOverride });
    scheduleLongTermMemoryUpdate(snapshot, this.memoryUpdateDeps());
  }

  private cacheRun(
    snapshot: StateSnapshot,
    flush: boolean,
    options: { titleOverride?: string; deferInitialTitle?: boolean } = {}
  ): void {
    this.runs.set(snapshot.runId, snapshot);
    if (snapshot.sessionId) {
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

  private runsForSession(sessionId: string): StateSnapshot[] {
    return [...this.runs.values()]
      .filter((run) => run.sessionId === sessionId)
      .sort((a, b) => (a.turnIndex ?? 1) - (b.turnIndex ?? 1) || a.updatedAt - b.updatedAt || a.runId.localeCompare(b.runId));
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
      ?? (existing && existing.turnCount > 0
        ? existing.title
        : snapshot.status === "queued" || snapshot.status === "running" || options.deferInitialTitle
          ? existing?.title ?? DEFAULT_SESSION_TITLE
          : defaultSessionTitle(snapshot.input.prompt));
    return SessionSummarySchema.parse({
      sessionId,
      title,
      projectId: snapshot.input.projectId ?? existing?.projectId,
      status: snapshot.status,
      latestRunId: snapshot.runId,
      latestPattern: snapshot.pattern,
      latestModeId: snapshot.modeId ?? existing?.latestModeId,
      latestProviderId: typeof snapshot.config.providerId === "string" ? snapshot.config.providerId : existing?.latestProviderId,
      latestModelRef: snapshot.config.modelRef ?? existing?.latestModelRef,
      turnCount,
      createdAt: existing?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
      archivedAt: existing?.archivedAt,
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

  private buildConversationMessages(sessionId: string, currentPrompt: string, excludeRunId?: string): ModelMessage[] {
    const priorTurns = this.runsForSession(sessionId);
    const messages: ModelMessage[] = [];
    for (const turn of priorTurns) {
      if (turn.runId === excludeRunId) {
        continue;
      }
      const prompt = turn.input.prompt.trim();
      if (prompt) {
        messages.push({ role: "user", content: prompt });
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

  private feedbackLoopInput() {
    return {
      projects: [...this.projects.values()],
      sessions: [...this.sessions.values()],
      runs: [...this.runs.values()],
      evaluationRuns: this.evaluationStore.listRuns(),
      feedbackRecords: this.evaluationStore.listFeedback(),
    };
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

export class InMemoryRunStore extends LocalRunStore {}

export {
  defaultCustomAgentsDir,
  defaultEvaluationStoreDir,
  defaultFeedbackLoopStoreDir,
  defaultMemoryDir,
  defaultModesDir,
  defaultPublicSkillsDir,
  defaultRuntimeStoreDir,
  defaultSkillsDir,
  defaultSystemAgentOverridesDir
};
