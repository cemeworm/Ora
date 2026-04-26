import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ArtifactRef,
  ArtifactRefSchema,
  CheckpointMeta,
  CoordinationPattern,
  CustomAgentCheckNameResult,
  CustomAgentCreateParams,
  CustomAgentDetail,
  CustomAgentSummary,
  CustomAgentUpdateParams,
  DEFAULT_SKILL_TOOL_IDS,
  DEFAULT_WEB_TOOL_IDS,
  DEFAULT_RESOURCE_BUDGETS,
  EvaluationFeedbackDraftCaseSchema,
  EvaluationFeedbackRecord,
  createModeSpecFromPattern,
  getPatternDefinition,
  modeSpecToPatternDefinition,
  MVP_PATTERNS,
  orderedEnabledModeNodes,
  type ModeCreateParams,
  type ModeSpec,
  type ModeUpdateParams,
  type ModeValidationResult,
  OraEventEnvelope,
  OraEventEnvelopeSchema,
  PatternDefinition,
  PolicyDecision,
  ProjectCreateParamsSchema,
  ProjectDetail,
  ProjectDetailSchema,
  ProjectFileReadParamsSchema,
  ProjectFileReadResult,
  ProjectFileReadResultSchema,
  ProjectFilesParamsSchema,
  ProjectFilesResult,
  ProjectFilesResultSchema,
  ProjectGetParamsSchema,
  ProjectListParamsSchema,
  ProjectSummary,
  ProjectSummarySchema,
  RunConfig,
  RunConfigSchema,
  RunEventStream,
  RunEventStreamSchema,
  RunForkParamsSchema,
  RunReplayParamsSchema,
  RunHandle,
  RunHandleSchema,
  RunResumeParamsSchema,
  RunTraceMetadata,
  RunTrail,
  RunTrailMetrics,
  RunTrailParamsSchema,
  RunTrailSchema,
  RunStreamParamsSchema,
  RunSummary,
  RunSummarySchema,
  RunsListParamsSchema,
  SessionCreateParamsSchema,
  SessionDetail,
  SessionDetailSchema,
  SessionGetParamsSchema,
  SessionListParamsSchema,
  SessionSummary,
  SessionSummarySchema,
  SessionTranscriptMessage,
  SessionTranscriptMessageSchema,
  SessionTurn,
  SessionTurnSchema,
  SINGLE_AGENT_MODE_ID,
  SkillCheckNameResult,
  SkillCreateParams,
  SkillDetail,
  SkillRegistry,
  SkillSetEnabledParams,
  SkillUpdateParams,
  StateSnapshot,
  StateSnapshotSchema,
  UserTaskInput,
  UserTaskInputSchema,
  withDefaultWebToolIds
} from "@ora/shared";
import {
  ActionLedger,
  AgentProfileRegistry,
  MemoryService,
  PlanService,
  PolicyService,
  TodoService,
} from "./capabilities.js";
import { CustomAgentFileStore } from "./custom-agents.js";
import { RuntimeSkillRegistry } from "./harness/capability-registries.js";
import { executeRuntimeKernel } from "./harness/runtime-kernel.js";
import { FileLongTermMemoryStore, LongTermMemoryManager, LongTermMemoryUpdateQueue } from "./memory.js";
import type { LongTermMemoryUpdateTask } from "./memory.js";
import { ModeSpecFileStore } from "./modes.js";
import { SqliteRuntimePersistence } from "./persistence/sqlite-backend.js";
import type { RuntimePersistenceBackend } from "./persistence/sqlite-backend.js";
import { invokeRunProvider, type ModelMessage } from "./providers/index.js";
import {
  getLangfuseRunTraceMetadata,
  readLangfuseRunTrace,
  withLangfuseRunTrace
} from "./telemetry/langfuse.js";
import { mergeTrailObservations, synthesizeLocalTrail } from "./telemetry/trails.js";
import { LocalEvaluationStore } from "./evaluation-store.js";
import { LocalFeedbackLoopStore } from "./feedback-loop-store.js";

const StartRunParamsSchema = z.object({
  input: UserTaskInputSchema,
  config: RunConfigSchema.partial().optional(),
  sessionId: z.string().min(1).optional(),
});

const RunIdParamsSchema = z.object({
  runId: z.string().min(1)
});

const InterruptParamsSchema = RunIdParamsSchema.extend({
  reason: z.string().optional()
});

const CancelParamsSchema = RunIdParamsSchema.extend({
  reason: z.string().optional()
});

const USER_CANCELLED_MESSAGE = "Stopped processing as instructed.";
const USER_INTERRUPTED_MESSAGE = "Paused as instructed.";
const USER_RESUMED_MESSAGE = "Confirmed. Continuing.";

const StoreManifestSchema = z.object({
  schemaVersion: z.literal(3).default(3),
  nextRunNumber: z.number().int().positive(),
  nextSessionNumber: z.number().int().positive().default(1),
  nextProjectNumber: z.number().int().positive().default(1),
});

type StoreManifest = z.infer<typeof StoreManifestSchema>;
type StoredRun = StateSnapshot;
type StoredSession = SessionSummary;
type StoredProject = ProjectSummary;

const PROJECT_WORKSPACE_MAX_FILES = 20_000;
const PROJECT_WORKSPACE_SAMPLE_LIMIT = 120;
const PROJECT_FILE_PREVIEW_MAX_BYTES = 1024 * 1024;
const AUTO_MODE_ROUTER_CONFIDENCE_THRESHOLD = 0.55;
const DEFAULT_SESSION_TITLE = "New Chat";
const SESSION_TITLE_MAX_INPUT_CHARS = 500;
const SESSION_TITLE_MAX_CHARS = 60;
const SESSION_TITLE_FALLBACK_CHARS = 50;
const PROJECT_WORKSPACE_SKIPPED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

const AutoModeRouterResponseSchema = z.object({
  modeId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export interface LocalRunStoreOptions {
  dataDir?: string;
  clock?: () => number;
}

interface PersistedArtifact {
  ref: ArtifactRef;
  payload: unknown;
}

interface StreamingRunOptions {
  onStream?: (stream: RunEventStream) => void;
}

// RuntimePersistenceBackend is imported from ./persistence/sqlite-backend.js

export class OraRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code = -32000,
    public readonly data?: unknown
  ) {
    super(message);
  }
}

class JsonFileRuntimePersistenceBackend implements RuntimePersistenceBackend {
  private readonly manifestPath: string;
  private readonly sessionsDir: string;
  private readonly projectsDir: string;
  private readonly runsDir: string;
  private readonly artifactsDir: string;

  constructor(private readonly dataDir: string) {
    this.manifestPath = path.join(dataDir, "manifest.json");
    this.sessionsDir = path.join(dataDir, "sessions");
    this.projectsDir = path.join(dataDir, "projects");
    this.runsDir = path.join(dataDir, "runs");
    this.artifactsDir = path.join(dataDir, "artifacts");
  }

  load(): { manifest: StoreManifest; runs: StoredRun[]; sessions: StoredSession[]; projects: StoredProject[] } {
    this.ensureDirs();

    const manifest = this.readJsonFile(this.manifestPath, StoreManifestSchema, StoreManifestSchema.parse({
      schemaVersion: 3,
      nextRunNumber: 1,
      nextSessionNumber: 1,
      nextProjectNumber: 1,
    }));
    const sessions: StoredSession[] = fs
      .readdirSync(this.sessionsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.readJsonFile(path.join(this.sessionsDir, name), SessionSummarySchema))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
    const projects: StoredProject[] = fs
      .readdirSync(this.projectsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.readJsonFile(path.join(this.projectsDir, name), ProjectSummarySchema))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.projectId.localeCompare(b.projectId));
    const runs: StoredRun[] = fs
      .readdirSync(this.runsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.readJsonFile(path.join(this.runsDir, name), StateSnapshotSchema))
      .sort((a, b) => a.runId.localeCompare(b.runId));

    return {
      manifest: {
        ...manifest,
        nextRunNumber: Math.max(manifest.nextRunNumber, this.nextRunNumberAfter(runs)),
        nextSessionNumber: Math.max(manifest.nextSessionNumber, this.nextSessionNumberAfter(sessions)),
        nextProjectNumber: Math.max(manifest.nextProjectNumber, this.nextProjectNumberAfter(projects)),
      },
      runs,
      sessions,
      projects,
    };
  }

  saveManifest(manifest: StoreManifest): void {
    this.ensureDirs();
    this.writeJsonFile(this.manifestPath, StoreManifestSchema.parse(manifest));
  }

  saveRun(run: StoredRun): void {
    this.ensureDirs();
    this.writeJsonFile(path.join(this.runsDir, `${this.fileSafeId(run.runId)}.json`), run);
  }

  saveSession(session: StoredSession): void {
    this.ensureDirs();
    this.writeJsonFile(path.join(this.sessionsDir, `${this.fileSafeId(session.sessionId)}.json`), session);
  }

  saveProject(project: StoredProject): void {
    this.ensureDirs();
    this.writeJsonFile(path.join(this.projectsDir, `${this.fileSafeId(project.projectId)}.json`), project);
  }

  saveArtifact(artifact: PersistedArtifact): ArtifactRef {
    this.ensureDirs();
    const runArtifactsDir = path.join(this.artifactsDir, this.fileSafeId(artifact.ref.runId));
    fs.mkdirSync(runArtifactsDir, { recursive: true });
    const artifactPath = path.join(runArtifactsDir, `${this.fileSafeId(artifact.ref.id)}.json`);
    const payloadText = `${JSON.stringify(artifact.payload, null, 2)}\n`;
    this.writeTextFile(artifactPath, payloadText);

    return ArtifactRefSchema.parse({
      ...artifact.ref,
      uri: pathToFileURL(artifactPath).href,
      sizeBytes: Buffer.byteLength(payloadText)
    });
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    fs.mkdirSync(this.projectsDir, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });
    fs.mkdirSync(this.artifactsDir, { recursive: true });
  }

  private readJsonFile<T>(
    filePath: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    fallback?: T
  ): T {
    if (!fs.existsSync(filePath)) {
      if (fallback !== undefined) {
        return fallback;
      }
      throw new OraRuntimeError(`Persisted runtime file is missing: ${filePath}`, -32005, {
        filePath
      });
    }

    try {
      return schema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (error) {
      throw new OraRuntimeError(`Persisted runtime file is invalid: ${filePath}`, -32006, {
        filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private writeJsonFile(filePath: string, value: unknown): void {
    this.writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  private writeTextFile(filePath: string, value: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, value, "utf8");
    fs.renameSync(tmpPath, filePath);
  }

  private nextRunNumberAfter(runs: StoredRun[]): number {
    return (
      runs.reduce((max, run) => {
        const match = /^run-(\d+)$/.exec(run.runId);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1
    );
  }

  private nextSessionNumberAfter(sessions: StoredSession[]): number {
    return (
      sessions.reduce((max, session) => {
        const match = /^session-(\d+)$/.exec(session.sessionId);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1
    );
  }

  private nextProjectNumberAfter(projects: StoredProject[]): number {
    return (
      projects.reduce((max, project) => {
        const match = /^project-(\d+)$/.exec(project.projectId);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1
    );
  }

  private fileSafeId(id: string): string {
    return encodeURIComponent(id);
  }
}

export class LocalRunStore {
  private readonly backend: RuntimePersistenceBackend;
  private readonly clock: () => number;
  private readonly persistenceType: "sqlite" | "json-file";
  private readonly evaluationStore: LocalEvaluationStore;
  private readonly feedbackLoopStore: LocalFeedbackLoopStore;
  private readonly customAgentStore: CustomAgentFileStore;
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
    this.longTermMemoryQueue = new LongTermMemoryUpdateQueue((task) => this.processLongTermMemoryUpdate(task));
    const loaded = this.backend.load();
    this.manifest = StoreManifestSchema.parse(loaded.manifest);
    this.projects = new Map(loaded.projects.map((project) => [project.projectId, project]));
    this.sessions = new Map(loaded.sessions.map((session) => [session.sessionId, session]));
    this.runs = new Map(loaded.runs.map((run) => [run.runId, run]));
    this.migrateLegacyRunsIntoSessions();
    this.migrateLegacyOraMvpProjectPlaceholder();
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
    return this.modeStore.list();
  }

  getMode(params: unknown): ModeSpec {
    return this.modeStore.get(params);
  }

  createMode(params: ModeCreateParams | unknown): ModeSpec {
    return this.modeStore.create(params);
  }

  private customAgentOverlaysForMode(modeSpec: ModeSpec): Record<string, string> {
    const overlays: Record<string, string> = {};
    for (const node of modeSpec.nodes) {
      const customAgentId = typeof node.config?.customAgentId === "string"
        ? node.config.customAgentId.trim()
        : "";
      if (!customAgentId || overlays[customAgentId]) {
        continue;
      }
      try {
        const overlay = this.customAgentStore.personaOverlay(customAgentId);
        if (overlay) {
          overlays[customAgentId] = overlay;
        }
      } catch {
        // A deleted custom agent should not make an otherwise valid mode unusable.
      }
    }
    return overlays;
  }

  updateMode(params: ModeUpdateParams | unknown): ModeSpec {
    return this.modeStore.update(params);
  }

  deleteMode(params: unknown): { deleted: true; modeId: string } {
    return this.modeStore.delete(params);
  }

  validateMode(params: unknown): ModeValidationResult {
    return this.modeStore.validate(params);
  }

  cloneModeFromPreset(params: unknown): ModeSpec {
    return this.modeStore.cloneFromPreset(params);
  }

  createProject(params: unknown = {}): ProjectSummary {
    const parsed = ProjectCreateParamsSchema.parse(params ?? {});
    const normalizedRootPath = this.normalizeProjectRootPath(parsed.rootPath);
    const existing = [...this.projects.values()].find((project) => project.rootPath === normalizedRootPath);
    if (existing) {
      return ProjectSummarySchema.parse(existing);
    }

    const now = this.now();
    const project = ProjectSummarySchema.parse({
      projectId: this.nextProjectId(),
      label: parsed.label?.trim() || path.basename(normalizedRootPath) || normalizedRootPath,
      rootPath: normalizedRootPath,
      sessionCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    this.persistProject(project);
    return project;
  }

  listProjects(params: unknown = {}): ProjectSummary[] {
    const parsed = ProjectListParamsSchema.parse(params ?? {});
    return [...this.projects.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt || a.projectId.localeCompare(b.projectId))
      .slice(0, parsed.limit)
      .map((project) => ProjectSummarySchema.parse(project));
  }

  getProject(params: unknown): ProjectDetail {
    const parsed = ProjectGetParamsSchema.parse(params);
    const project = this.getProjectOrThrow(parsed.projectId);
    return ProjectDetailSchema.parse({
      project,
      sessions: this.listSessions({ projectId: parsed.projectId }),
    });
  }

  listProjectFiles(params: unknown): ProjectFilesResult {
    const parsed = ProjectFilesParamsSchema.parse(params);
    const project = this.getProjectOrThrow(parsed.projectId);
    const rootPath = this.requireProjectRootDirectory(project);
    const files: ProjectFilesResult["files"] = [];
    let totalFiles = 0;
    let truncated = false;

    const visit = (directory: string) => {
      if (truncated) {
        return;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }

      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (truncated) {
          return;
        }

        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!PROJECT_WORKSPACE_SKIPPED_DIRS.has(entry.name)) {
            visit(absolutePath);
          }
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }

        totalFiles += 1;
        try {
          const stat = fs.statSync(absolutePath);
          files.push({
            path: this.relativeProjectFilePath(rootPath, absolutePath),
            name: entry.name,
            sizeBytes: stat.size,
            modifiedAt: Math.max(0, Math.floor(stat.mtimeMs)),
            mimeType: mimeTypeForPath(absolutePath),
          });
        } catch {
          // Ignore files that disappear or become unreadable during the scan.
        }
        if (totalFiles >= PROJECT_WORKSPACE_MAX_FILES) {
          truncated = true;
        }
      }
    };

    visit(rootPath);

    return ProjectFilesResultSchema.parse({
      projectId: project.projectId,
      rootPath,
      totalFiles,
      files: files.sort((left, right) => left.path.localeCompare(right.path)),
      truncated,
      skippedDirs: [...PROJECT_WORKSPACE_SKIPPED_DIRS].sort(),
    });
  }

  readProjectFile(params: unknown): ProjectFileReadResult {
    const parsed = ProjectFileReadParamsSchema.parse(params);
    const project = this.getProjectOrThrow(parsed.projectId);
    const rootPath = this.requireProjectRootDirectory(project);
    const absolutePath = this.resolveProjectFilePath(rootPath, parsed.path);
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new OraRuntimeError("Project file preview target must be a file.", -32004, { path: parsed.path });
    }

    const mimeType = mimeTypeForPath(absolutePath);
    const previewKind = projectFilePreviewKind(mimeType);
    const payload = previewKind === "text" && stat.size <= PROJECT_FILE_PREVIEW_MAX_BYTES
      ? fs.readFileSync(absolutePath, "utf8")
      : previewKind === "json" && stat.size <= PROJECT_FILE_PREVIEW_MAX_BYTES
        ? readJsonPreviewPayload(absolutePath)
        : undefined;

    return ProjectFileReadResultSchema.parse({
      projectId: project.projectId,
      rootPath,
      path: this.relativeProjectFilePath(rootPath, absolutePath),
      label: path.basename(absolutePath),
      mimeType,
      previewKind,
      sizeBytes: stat.size,
      modifiedAt: Math.max(0, Math.floor(stat.mtimeMs)),
      uri: previewKind === "image" ? pathToFileURL(absolutePath).toString() : undefined,
      payload,
    });
  }

  createSession(params: unknown = {}): SessionSummary {
    const parsed = SessionCreateParamsSchema.parse(params ?? {});
    if (parsed.projectId) {
      this.getProjectOrThrow(parsed.projectId);
    }
    const now = this.now();
    const session = SessionSummarySchema.parse({
      sessionId: this.nextSessionId(),
      title: parsed.label?.trim() || DEFAULT_SESSION_TITLE,
      projectId: parsed.projectId,
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    this.persistSession(session);
    return session;
  }

  listSessions(params: unknown = {}): SessionSummary[] {
    const parsed = SessionListParamsSchema.parse(params ?? {});
    return [...this.sessions.values()]
      .filter((session) => (parsed.projectId ? session.projectId === parsed.projectId : true))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
      .slice(0, parsed.limit)
      .map((session) => SessionSummarySchema.parse(session));
  }

  getSession(params: unknown): SessionDetail {
    const parsed = SessionGetParamsSchema.parse(params);
    const session = this.getSessionOrThrow(parsed.sessionId);
    const turns = this.runsForSession(parsed.sessionId).map((run) => this.toSessionTurn(this.attachTraceMetadata(run)));
    const latestSnapshot = turns.length > 0
      ? this.attachTraceMetadata(this.getRunOrThrow(turns.at(-1)!.runId))
      : undefined;
    return SessionDetailSchema.parse({
      session,
      turns,
      transcript: this.sessionTranscript(parsed.sessionId),
      latestSnapshot,
    });
  }

  listRuns(params: unknown = {}): RunSummary[] {
    const parsed = RunsListParamsSchema.parse(params ?? {});
    return [...this.runs.values()]
      .filter((run) => (parsed.status ? run.status === parsed.status : true))
      .filter((run) => (parsed.sessionId ? run.sessionId === parsed.sessionId : true))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.runId.localeCompare(b.runId))
      .slice(0, parsed.limit)
      .map((run) => this.toRunSummary(run));
  }

  listAgents(): CustomAgentSummary[] {
    return this.customAgentStore.list();
  }

  getAgent(params: unknown): CustomAgentDetail {
    return this.customAgentStore.get(params);
  }

  createAgent(params: CustomAgentCreateParams | unknown): CustomAgentDetail {
    return this.customAgentStore.create(params);
  }

  updateAgent(params: CustomAgentUpdateParams | unknown): CustomAgentDetail {
    return this.customAgentStore.update(params);
  }

  deleteAgent(params: unknown): { deleted: true; name: string } {
    return this.customAgentStore.delete(params);
  }

  checkAgentName(params: unknown): CustomAgentCheckNameResult {
    return this.customAgentStore.checkName(params);
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
    const resolved = await this.resolveModeSelection(parsed.config, input, session);
    const fullConfig = this.withMemoryPrompt(resolved.fullConfig);
    const { modeSpec, definition } = resolved;
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
    const sessionBoundSnapshot = await withLangfuseRunTrace(
      { runId, input, config: fullConfig },
      async () => {
        const { snapshot } = await executeRuntimeKernel(runId, input, fullConfig, {
          clock: this.clock,
          modeSpec,
          definition,
          skillRegistry: this.skillRegistry,
          customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
          customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
          conversationMessages: this.buildConversationMessages(session.sessionId, input.prompt),
        });
        return StateSnapshotSchema.parse({
          ...snapshot,
          sessionId: session.sessionId,
          turnIndex,
        });
      },
    );
    const tracedSnapshot = this.attachTraceMetadata(sessionBoundSnapshot);
    await this.persistRunWithGeneratedTitle(tracedSnapshot);
    return this.toRunHandle(tracedSnapshot);
  }

  async startStreamingRun(params: unknown, options: StreamingRunOptions = {}): Promise<RunHandle> {
    const parsed = StartRunParamsSchema.parse(params);
    const session = this.ensureSessionForRun(parsed.sessionId, parsed.input);
    const input = this.enrichInputForSession(UserTaskInputSchema.parse({
      ...parsed.input,
      createdAt: parsed.input.createdAt ?? this.now()
    }), session);
    const resolved = await this.resolveModeSelection(parsed.config, input, session);
    const { modeSpec, definition } = resolved;
    const fullConfig = this.withMemoryPrompt(resolved.fullConfig);
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
    const conversationMessages = this.buildConversationMessages(session.sessionId, input.prompt);
    let liveSnapshot = this.createRunningSnapshot({
      runId,
      sessionId: session.sessionId,
      turnIndex,
      input,
      config: fullConfig,
      modeSpec,
      definition,
    });
    this.persistRun(liveSnapshot);

    const publishStream = (events: OraEventEnvelope[], snapshot?: StateSnapshot) => {
      if (events.length === 0 && !snapshot) {
        return;
      }
      const firstSeq = events[0]?.seq ?? liveSnapshot.events.length;
      options.onStream?.(RunEventStreamSchema.parse({
        runId,
        fromSeq: firstSeq,
        events,
        nextSeq: events.length > 0 ? firstSeq + events.length : liveSnapshot.events.length,
        status: snapshot?.status ?? liveSnapshot.status,
        snapshot,
      }));
    };

    const applyLiveEvent = (event: OraEventEnvelope) => {
      const status = event.type === "run.done"
        ? "succeeded"
        : event.type === "run.failed"
          ? "failed"
          : event.type === "run.cancelled"
            ? "cancelled"
            : event.type === "run.interrupted"
              ? "interrupted"
              : liveSnapshot.status;
      liveSnapshot = StateSnapshotSchema.parse({
        ...liveSnapshot,
        status,
        events: [...liveSnapshot.events, event],
        updatedAt: event.createdAt,
      });
      this.cacheRun(liveSnapshot, event.seq % 8 === 0 || event.type.startsWith("run."), {
        deferInitialTitle: true,
      });
      publishStream([event]);
    };

    void withLangfuseRunTrace(
      { runId, input, config: fullConfig },
      async () => {
        const { snapshot } = await executeRuntimeKernel(runId, input, fullConfig, {
          clock: this.clock,
          modeSpec,
          definition,
          skillRegistry: this.skillRegistry,
          customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
          customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
          conversationMessages,
          streamProvider: true,
          onEvent: applyLiveEvent,
        });
        const finalSnapshot = this.attachTraceMetadata(StateSnapshotSchema.parse({
          ...snapshot,
          sessionId: session.sessionId,
          turnIndex,
        }));
        await this.persistRunWithGeneratedTitle(finalSnapshot);
        publishStream([], finalSnapshot);
      },
    ).catch(async (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      const failedAt = this.now();
      const failedEvent = OraEventEnvelopeSchema.parse({
        id: `${runId}:evt-${liveSnapshot.events.length}`,
        runId,
        seq: liveSnapshot.events.length,
        type: "run.failed",
        createdAt: failedAt,
        pattern: fullConfig.pattern,
        payload: { status: "failed", error: detail },
      });
      liveSnapshot = this.attachTraceMetadata(StateSnapshotSchema.parse({
        ...liveSnapshot,
        status: "failed",
        error: detail,
        events: [...liveSnapshot.events, failedEvent],
        updatedAt: failedAt,
      }));
      await this.persistRunWithGeneratedTitle(liveSnapshot);
      publishStream([failedEvent], liveSnapshot);
    });

    return this.toRunHandle(liveSnapshot);
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
    const resolved = await this.resolveModeSelection(parsed.config, input, session);
    const { modeSpec, definition } = resolved;
    const fullConfig = this.withMemoryPrompt(resolved.fullConfig);
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
    const sessionBoundSnapshot = await withLangfuseRunTrace(
      { runId, input, config: fullConfig },
      async () => {
        const { snapshot } = await executeRuntimeKernel(runId, input, fullConfig, {
          clock: this.clock,
          modeSpec,
          definition,
          skillRegistry: this.skillRegistry,
          customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
          customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
          forkedFrom,
          conversationMessages: this.buildConversationMessages(session.sessionId, input.prompt),
        });
        return StateSnapshotSchema.parse({
          ...snapshot,
          sessionId: session.sessionId,
          turnIndex,
        });
      },
    );
    const tracedSnapshot = this.attachTraceMetadata(sessionBoundSnapshot);
    await this.persistRunWithGeneratedTitle(tracedSnapshot);
    return this.toRunHandle(tracedSnapshot);
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
    }) => Promise<StateSnapshot | undefined>
  ): Promise<RunHandle | undefined> {
    const parsed = StartRunParamsSchema.parse(params);
    const session = this.ensureSessionForRun(parsed.sessionId, parsed.input);
    const input = this.enrichInputForSession(UserTaskInputSchema.parse({
      ...parsed.input,
      createdAt: parsed.input.createdAt ?? this.now()
    }), session);
    const resolved = await this.resolveModeSelection(parsed.config, input, session);
    const { modeSpec, definition } = resolved;
    const fullConfig = this.withMemoryPrompt(resolved.fullConfig);
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
    });
    if (!snapshot) {
      return undefined;
    }

    const sessionBoundSnapshot = this.attachTraceMetadata(StateSnapshotSchema.parse({
      ...snapshot,
      sessionId: session.sessionId,
      turnIndex,
      coordinationKind: snapshot.coordinationKind ?? snapshot.pattern,
      modeId: snapshot.modeId ?? modeSpec.id,
      modeSpec: snapshot.modeSpec ?? modeSpec,
    }));
    await this.persistRunWithGeneratedTitle(sessionBoundSnapshot);
    return this.toRunHandle(sessionBoundSnapshot);
  }

  streamRun(params: unknown): RunEventStream {
    const parsed = RunStreamParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    const fromSeq = parsed.afterSeq === undefined ? 0 : parsed.afterSeq + 1;
    return RunEventStreamSchema.parse({
      runId: snapshot.runId,
      fromSeq,
      events: snapshot.events.filter((event) => event.seq >= fromSeq).sort((a, b) => a.seq - b.seq),
      nextSeq: snapshot.events.length
    });
  }

  interruptRun(params: unknown): StateSnapshot {
    const parsed = InterruptParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    return this.transitionRun(snapshot, "interrupted", "run.interrupted", {
      reason: parsed.reason ?? USER_INTERRUPTED_MESSAGE
    });
  }

  async resumeRun(params: unknown): Promise<StateSnapshot> {
    const parsed = RunResumeParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    const patchRecord = parsed.patch && typeof parsed.patch === "object" && parsed.patch !== null
      ? parsed.patch
      : {};
    const clarificationPatch = "clarifications" in patchRecord &&
      typeof patchRecord.clarifications === "object" &&
      patchRecord.clarifications !== null
      ? patchRecord.clarifications as Record<string, unknown>
      : {};
    const approvedActionIds = Array.isArray(patchRecord.approvedActionIds)
      ? patchRecord.approvedActionIds.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    const approvedActions = approvedActionIds
      .map((actionId) => snapshot.actions.find((action) => action.id === actionId))
      .filter((action): action is NonNullable<typeof action> => action !== undefined)
      .map((action) => ({
        type: action.type,
        riskLevel: action.riskLevel,
        input: action.input,
        agentId: action.agentId,
      }));
    const hasKernelResumeWork = snapshot.modeSpec !== undefined
      && (snapshot.pendingClarifications.length > 0 || snapshot.actions.some((action) => action.status === "approval_required"));

    if (hasKernelResumeWork) {
      const modeSpec = snapshot.modeSpec;
      if (!modeSpec) {
        throw new OraRuntimeError("Cannot resume a kernel-backed run without modeSpec.", -32004, {
          runId: snapshot.runId,
        });
      }
      const nextClarifications = Object.keys(clarificationPatch).length > 0
        ? {
            ...(
              snapshot.input.context?.clarifications
              && typeof snapshot.input.context.clarifications === "object"
              && snapshot.input.context.clarifications !== null
                ? snapshot.input.context.clarifications
                : {}
            ),
            ...clarificationPatch,
          }
        : snapshot.input.context?.clarifications;
      const resumedInput = UserTaskInputSchema.parse({
        ...snapshot.input,
        context: {
          ...snapshot.input.context,
          ...(nextClarifications ? { clarifications: nextClarifications } : {}),
        },
      });
      const definition = modeSpecToPatternDefinition(modeSpec);
      const sessionId = snapshot.sessionId;
      if (!sessionId) {
        throw new OraRuntimeError("Cannot resume a kernel-backed run without sessionId.", -32004, {
          runId: snapshot.runId,
        });
      }

      const resumedSnapshot = await withLangfuseRunTrace(
        { runId: snapshot.runId, input: resumedInput, config: snapshot.config },
        async () => {
          const { snapshot: nextSnapshot } = await executeRuntimeKernel(snapshot.runId, resumedInput, snapshot.config, {
            clock: this.clock,
            modeSpec,
            definition,
            skillRegistry: this.skillRegistry,
            customAgentOverlay: this.customAgentStore.personaOverlay(snapshot.config.customAgentId),
            customAgentOverlays: this.customAgentOverlaysForMode(modeSpec),
            conversationMessages: this.buildConversationMessages(sessionId, resumedInput.prompt, snapshot.runId),
            resumeContext: {
              clarifications: clarificationPatch,
              approvedActionIds,
              approvedActions,
            },
          });
          return StateSnapshotSchema.parse({
            ...nextSnapshot,
            sessionId,
            turnIndex: snapshot.turnIndex,
          });
        },
      );
      const tracedSnapshot = this.attachTraceMetadata(resumedSnapshot);
      await this.persistRunWithGeneratedTitle(tracedSnapshot);
      return tracedSnapshot;
    }

    let working = this.appendEvent(snapshot, "run.resumed", {
      reason: parsed.reason ?? USER_RESUMED_MESSAGE,
      patch: parsed.patch ?? {}
    });
    working = this.syncSnapshotTodos(working, "resume.sync");

    if (working.pendingClarifications.length > 0) {
      const resolvedIds = new Set<string>();
      for (const clarification of working.pendingClarifications) {
        const answer = clarificationPatch[clarification.id] ?? clarificationPatch[clarification.key];
        if (answer === undefined) {
          continue;
        }
        working = this.appendEvent(working, "clarification.resolved", {
          clarificationId: clarification.id,
          nodeId: clarification.nodeId,
          answer,
          mode: "resume",
        });
        resolvedIds.add(clarification.id);
      }
      if (resolvedIds.size > 0) {
        const existingClarifications = working.input.context?.clarifications;
        const nextClarifications = typeof existingClarifications === "object" && existingClarifications !== null
          ? { ...existingClarifications, ...clarificationPatch }
          : { ...clarificationPatch };
        working = StateSnapshotSchema.parse({
          ...working,
          input: {
            ...working.input,
            context: {
              ...working.input.context,
              clarifications: nextClarifications,
            },
          },
          pendingClarifications: working.pendingClarifications.filter((clarification) => !resolvedIds.has(clarification.id)),
        });
      }
    }

    const pendingApprovalActions = working.actions.filter((action) => action.status === "approval_required");
    for (const action of pendingApprovalActions) {
      working = this.appendEvent(working, "approval.resolved", {
        actionId: action.id,
        decision: "approved",
        mode: "resume"
      });

      const approved = { ...action, status: "approved" as const };
      working = this.appendEvent(
        { ...working, actions: working.actions.map((item) => (item.id === action.id ? approved : item)) },
        "action.updated",
        { actionId: action.id, status: "approved", record: approved }
      );

      const running = { ...approved, status: "running" as const };
      working = this.appendEvent(
        { ...working, actions: working.actions.map((item) => (item.id === action.id ? running : item)) },
        "action.updated",
        { actionId: action.id, status: "running", record: running }
      );

      const workingModeSpec = working.modeSpec ?? createModeSpecFromPattern(working.pattern);
      const output = this.patternOutput(working.pattern, working.input.prompt, workingModeSpec);
      const memory = {
        id: `${working.runId}:memory:resumed-pattern-state`,
        namespace: this.patternMemoryNamespace(working.pattern, working.input.projectId, workingModeSpec),
        kind: working.pattern === "agent_teams" ? "worker" as const : "session" as const,
        value: output.state,
        sourceRunId: working.runId,
        sourceActionId: action.id,
        createdAt: this.now(),
        updatedAt: this.now()
      };
      working = this.appendEvent(
        { ...working, memory: [...working.memory, memory] },
        "memory.updated",
        { record: memory }
      );

      const succeeded = {
        ...running,
        status: "succeeded" as const,
        output: output.state
      };
      working = this.appendEvent(
        {
          ...working,
          actions: working.actions.map((item) => (item.id === action.id ? succeeded : item)),
          output: output.state
        },
        "action.updated",
        { actionId: action.id, status: "succeeded", record: succeeded }
      );
    }

    if (working.pendingClarifications.length > 0 || working.actions.some((action) => action.status === "approval_required")) {
      const updated = StateSnapshotSchema.parse({
        ...working,
        status: "interrupted",
        updatedAt: this.now(),
      });
      this.persistRun(updated);
      return updated;
    }

    const checkpoint: CheckpointMeta = {
      id: `${working.runId}:checkpoint-${working.checkpoints.length}`,
      runId: working.runId,
      label: "Resume checkpoint",
      createdAt: this.now(),
      eventSeq: working.events.length,
      stateHash: `${working.pattern}:resume:${working.events.length}`
    };
    working = this.appendEvent(
      {
        ...working,
        checkpoints: [...working.checkpoints, checkpoint],
        plan: working.plan.map((item) => ({
          ...item,
          status: "done",
          checkpointIds: [...new Set([...item.checkpointIds, checkpoint.id])]
        }))
      },
      "checkpoint.created",
      {
        checkpoint,
        summary: "Checkpoint captured after deterministic resume."
      },
      { checkpointId: checkpoint.id }
    );

    const completed = this.appendEvent(
      {
        ...working,
        status: "running",
        topology: this.withTopologyStatus(working, "running")
      },
      "run.done",
      {
        status: "succeeded",
        summary: "Deterministic MVP run resumed and completed."
      }
    );
    const updated = StateSnapshotSchema.parse({
      ...completed,
      status: "succeeded",
      topology: this.withTopologyStatus(completed, "done"),
      plan: completed.plan.map((item) => ({ ...item, status: "done" })),
      updatedAt: completed.updatedAt
    });
    const syncedTodos = this.syncSnapshotTodos(updated, "resume.completed");
    await this.persistRunWithGeneratedTitle(syncedTodos);
    return syncedTodos;
  }

  cancelRun(params: unknown): StateSnapshot {
    const parsed = CancelParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    return this.transitionRun(snapshot, "cancelled", "run.cancelled", {
      reason: parsed.reason ?? USER_CANCELLED_MESSAGE
    });
  }

  getRunState(params: unknown): StateSnapshot {
    return this.attachTraceMetadata(this.getRunOrThrow(this.requireRunId(params)));
  }

  persistExternalSnapshot(snapshot: StateSnapshot): StateSnapshot {
    const tracedSnapshot = this.attachTraceMetadata(StateSnapshotSchema.parse(snapshot));
    this.persistRun(tracedSnapshot);
    return tracedSnapshot;
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
      run: this.toRunSummary(snapshot),
      trace,
      observations,
      liveMetrics: this.buildRunTrailMetrics(snapshot, trace, observations),
    });
  }

  listCheckpoints(params: unknown): CheckpointMeta[] {
    return this.getRunOrThrow(this.requireRunId(params)).checkpoints;
  }

  replayRun(params: unknown): RunEventStream {
    const parsed = RunReplayParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    const checkpoint = parsed.checkpointId
      ? snapshot.checkpoints.find((candidate) => candidate.id === parsed.checkpointId)
      : snapshot.checkpoints.at(-1);

    if (!checkpoint) {
      throw new OraRuntimeError("Checkpoint not found for replay.", -32004, {
        runId: parsed.runId,
        checkpointId: parsed.checkpointId
      });
    }

    const replayableEvents = snapshot.events
      .filter((event) => event.seq <= checkpoint.eventSeq)
      .sort((a, b) => a.seq - b.seq);
    const replayed = this.appendEvent(snapshot, "run.replayed", {
      checkpointId: checkpoint.id,
      replayedEventCount: replayableEvents.length,
      events: replayableEvents
    });
    this.persistRun(replayed);

    return RunEventStreamSchema.parse({
      runId: snapshot.runId,
      fromSeq: 0,
      events: replayableEvents,
      nextSeq: replayed.events.length
    });
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
    const snapshot = this.getRunOrThrow(this.requireRunId(params));
    const reportIndex = snapshot.artifacts.filter((artifact) => artifact.kind === "report").length;
    const payload = {
      runId: snapshot.runId,
      status: snapshot.status,
      pattern: snapshot.pattern,
      eventCount: snapshot.events.length,
      checkpointCount: snapshot.checkpoints.length,
      output: snapshot.output
    };
    const persistedRef = this.backend.saveArtifact({
      ref: ArtifactRefSchema.parse({
        id: `${snapshot.runId}:report-${reportIndex}`,
        runId: snapshot.runId,
        kind: "report",
        label: reportIndex === 0 ? "Smoke run report" : `Smoke run report ${reportIndex + 1}`,
        mimeType: "application/json",
        createdAt: this.now(),
        payload
      }),
      payload
    });
    const updated = this.appendEvent(
      {
        ...snapshot,
        artifacts: [...snapshot.artifacts, persistedRef]
      },
      "artifact.exported",
      {
        artifact: persistedRef
      }
    );
    this.persistRun(updated);
    return persistedRef;
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
    const snapshot = this.attachTraceMetadata(this.getRunOrThrow(runId));
    const sourceContext = await this.buildFeedbackSourceContext(snapshot);
    return this.evaluationStore.submitFeedback(
      params,
      sourceContext,
      ({ feedbackId, feedbackText, sourceContext }) => this.curateFeedbackDraft(snapshot.config, feedbackId, feedbackText, sourceContext)
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

  private async resolveModeSelection(
    config?: Partial<RunConfig>,
    input?: UserTaskInput,
    session?: SessionSummary,
  ): Promise<{
    modeSpec: ModeSpec;
    definition: PatternDefinition;
    fullConfig: RunConfig;
  }> {
    const parsed = RunConfigSchema.parse(config ?? {});
    const autoRoute = parsed.modeSelection === "auto" && input
      ? await this.routeAutoMode(parsed, input, session)
      : undefined;
    const requestedModeId = autoRoute?.modeId
      ?? (typeof config?.modeId === "string" ? config.modeId : parsed.modeId ?? parsed.pattern);
    const modeSpec = this.modeStore.resolve(requestedModeId, parsed.pattern);
    const definition = modeSpecToPatternDefinition(modeSpec);
    const metadataApprovalMode = parsed.metadata.approvalMode;
    const resolvedApprovalMode =
      config?.approvalMode
      ?? (metadataApprovalMode === "manual" || parsed.metadata.requireApproval === true
        ? "manual"
        : metadataApprovalMode === "auto" || metadataApprovalMode === "high_risk_only"
          ? metadataApprovalMode
          : modeSpec.capabilityFlags.approvalMode);
    const skillIds = Array.isArray(config?.skillIds) ? config.skillIds : modeSpec.capabilityFlags.skillIds;
    const modeDisablesDefaultWebTools = DEFAULT_WEB_TOOL_IDS.some((toolId) => !modeSpec.capabilityFlags.toolIds.includes(toolId));
    const defaultWebToolsDisabled = parsed.metadata.disableDefaultWebTools === true || modeDisablesDefaultWebTools;
    const configuredToolIds = Array.isArray(config?.toolIds)
      ? (parsed.modeSelection === "auto"
        ? [...modeSpec.capabilityFlags.toolIds, ...config.toolIds]
        : config.toolIds)
      : modeSpec.capabilityFlags.toolIds;
    const explicitRunToolIds = Array.isArray(config?.toolIds);
    const webDisabledToolIds = parsed.metadata.disableDefaultWebTools === true && !explicitRunToolIds
      ? configuredToolIds.filter((toolId) => !DEFAULT_WEB_TOOL_IDS.includes(toolId as typeof DEFAULT_WEB_TOOL_IDS[number]))
      : configuredToolIds;
    const toolIds = defaultWebToolsDisabled
      ? [...new Set([...webDisabledToolIds, ...DEFAULT_SKILL_TOOL_IDS])]
      : withDefaultWebToolIds(configuredToolIds);
    const skillWarnings = this.skillRegistry.warnings(skillIds);
    const skillPromptOverlay = this.skillRegistry.promptSnippets(skillIds).join("\n\n");
    const fullConfig = RunConfigSchema.parse({
      ...parsed,
      pattern: modeSpec.family,
      modeId: modeSpec.id,
      modeSelection: parsed.modeSelection,
      budget: parsed.budget ?? modeSpec.defaultBudget ?? DEFAULT_RESOURCE_BUDGETS[modeSpec.family],
      completionPolicy: parsed.completionPolicy ?? modeSpec.completionPolicy,
      approvalMode: resolvedApprovalMode,
      skillIds,
      toolIds,
      metadata: {
        ...parsed.metadata,
        modeId: modeSpec.id,
        ...(autoRoute ? { autoModeRouter: autoRoute.metadata } : {}),
        ...(skillPromptOverlay ? { skillPromptOverlay } : {}),
        ...(skillWarnings.length > 0 ? { skillWarnings } : {}),
      },
    });
    return {
      modeSpec,
      definition,
      fullConfig,
    };
  }

  private async routeAutoMode(
    config: RunConfig,
    input: UserTaskInput,
    session?: SessionSummary,
  ): Promise<{ modeId: string; metadata: Record<string, unknown> }> {
    const candidates = this.modeStore.list().map((mode) => ({
      id: mode.id,
      label: mode.label,
      family: mode.family,
      summary: mode.summary,
      recommendedUse: mode.recommendedUse,
      failureMode: mode.failureMode,
      systemPreset: mode.systemPreset,
    }));
    const candidateIds = new Set(candidates.map((mode) => mode.id));
    const fallbackModeId = candidateIds.has(SINGLE_AGENT_MODE_ID)
      ? SINGLE_AGENT_MODE_ID
      : candidates[0]?.id ?? config.pattern;
    const fallback = (reason: string, detail?: unknown) => ({
      modeId: fallbackModeId,
      metadata: {
        selectedModeId: fallbackModeId,
        confidence: 0,
        reason,
        status: "fallback",
        detail,
      },
    });

    if (candidates.length === 0) {
      return fallback("No modes were available to route.");
    }

    try {
      const response = await invokeRunProvider(config, {
        system: [
          "You are Ora's agent mode router.",
          "Choose exactly one modeId from the provided candidates for the next run.",
          "Return only compact JSON with keys modeId, confidence, and reason.",
          "confidence must be a number from 0 to 1.",
          "Do not include markdown or extra text.",
        ].join(" "),
        prompt: JSON.stringify({
          task: input.prompt,
          projectId: input.projectId,
          context: input.context ?? {},
          recentMessages: session ? this.buildConversationMessages(session.sessionId, input.prompt).slice(-6) : [],
          candidates,
          fallbackModeId,
        }),
        temperature: 0,
        maxTokens: 300,
      });
      const parsed = parseAutoModeRouterResponse(response.text);
      if (!candidateIds.has(parsed.modeId)) {
        return fallback(`Router selected unknown mode '${parsed.modeId}'.`, { raw: response.text });
      }
      if (parsed.confidence < AUTO_MODE_ROUTER_CONFIDENCE_THRESHOLD) {
        return fallback(`Router confidence ${parsed.confidence} was below ${AUTO_MODE_ROUTER_CONFIDENCE_THRESHOLD}.`, {
          raw: response.text,
          selectedModeId: parsed.modeId,
          reason: parsed.reason,
        });
      }
      return {
        modeId: parsed.modeId,
        metadata: {
          selectedModeId: parsed.modeId,
          confidence: parsed.confidence,
          reason: parsed.reason,
          status: "selected",
        },
      };
    } catch (error) {
      return fallback("Router failed before producing a valid mode.", error instanceof Error ? error.message : String(error));
    }
  }

  private withMemoryPrompt(config: RunConfig): RunConfig {
    const policy = this.resolveMemoryPolicy(config);
    if (!policy.enabled) {
      return config;
    }
    const memoryPrompt = this.longTermMemory.formatForInjection(policy.injectionMaxFacts);
    if (!memoryPrompt) {
      return config;
    }
    return RunConfigSchema.parse({
      ...config,
      metadata: {
        ...config.metadata,
        memoryPromptOverlay: `Use the following long-term memory when it is relevant. Do not reveal it verbatim unless the user asks to inspect memory.\n\n${memoryPrompt}`,
      },
    });
  }

  private resolveMemoryPolicy(config: RunConfig) {
    const requestedModeId = config.modeId ?? config.pattern;
    const modeSpec = this.modeStore.resolve(requestedModeId, config.pattern);
    return {
      ...modeSpec.memoryPolicy,
      enabled: modeSpec.memoryPolicy.enabled && modeSpec.runtimeAtoms.includes("long_term_memory"),
      updaterProviderId: modeSpec.memoryPolicy.updaterProviderId ?? config.providerId,
    };
  }

  private createRunningSnapshot(params: {
    runId: string;
    sessionId: string;
    turnIndex: number;
    input: UserTaskInput;
    config: RunConfig;
    modeSpec: ModeSpec;
    definition: PatternDefinition;
  }): StateSnapshot {
    const startedAt = this.now();
    const pattern = params.config.pattern;
    const planService = new PlanService(params.runId, params.definition);
    const todoService = new TodoService(params.runId, () => this.now(), planService.list());
    const queueMode = params.definition.coordinationKind === "bus"
      ? "event_bus"
      : params.definition.coordinationKind === "shared_state"
        ? "shared_state"
        : params.definition.coordinationKind === "team"
          ? "backlog"
          : "dag";

    return StateSnapshotSchema.parse({
      runId: params.runId,
      sessionId: params.sessionId,
      turnIndex: params.turnIndex,
      status: "running",
      pattern,
      coordinationKind: pattern,
      modeId: params.modeSpec.id,
      input: params.input,
      config: params.config,
      topology: {
        nodes: params.definition.topology.nodes.map((node) => ({
          ...node,
          status: node.kind === "run" ? "running" : node.status,
        })),
        edges: params.definition.topology.edges,
      },
      profiles: new AgentProfileRegistry(params.definition).list(params.config.profileIds),
      memory: [],
      plan: planService.list(),
      todos: todoService.list(),
      actions: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: {
        mode: queueMode,
        pending: params.definition.planTemplate.length,
        inProgress: 0,
        completed: 0,
        topics: [],
      },
      sharedStateSummary: {
        enabled: params.definition.supportsSharedState,
        storeKind: params.definition.supportsSharedState ? "blackboard" : "none",
        version: 0,
        entries: [],
      },
      busStats: {
        enabled: params.definition.supportsEventRouting,
        publishedCount: 0,
        routedCount: 0,
        topicCounts: {},
      },
      pendingClarifications: [],
      pendingApprovals: [],
      modeSpec: params.modeSpec,
      updatedAt: startedAt,
    });
  }

  private async createCompletedRun(params: {
    input: UserTaskInput;
    config?: Partial<RunConfig>;
    session: SessionSummary;
    forkedFrom?: { runId: string; checkpointId: string; eventSeq: number };
  }): Promise<StoredRun> {
    const input = UserTaskInputSchema.parse({
      ...params.input,
      createdAt: params.input.createdAt ?? this.now()
    });
    const { modeSpec, definition, fullConfig } = await this.resolveModeSelection(params.config, input, params.session);
    const pattern = fullConfig.pattern;
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(params.session.sessionId);
    const startedAt = this.now();
    const budget = fullConfig.budget ?? DEFAULT_RESOURCE_BUDGETS[pattern];
    const manualApproval =
      fullConfig.approvalMode === "manual" ||
      fullConfig.metadata.approvalMode === "manual" ||
      fullConfig.metadata.requireApproval === true;
    const checkpoints: CheckpointMeta[] = [];
    const events: OraEventEnvelope[] = [];
    const profiles = new AgentProfileRegistry(definition).list(fullConfig.profileIds);
    const memoryService = new MemoryService(runId, () => startedAt + events.length);
    const planService = new PlanService(runId, definition);
    const todoService = new TodoService(runId, () => startedAt + events.length, planService.list());
    const actionLedger = new ActionLedger(runId);
    const policyService = new PolicyService(runId, () => startedAt + events.length);
    const policyDecisions: PolicyDecision[] = [];
    const baseTopology = {
      nodes: definition.topology.nodes.map((node) => ({
        ...node,
        status: node.kind === "run" ? "running" : node.status
      })),
      edges: definition.topology.edges
    };
    const appendEvent = (
      type: OraEventEnvelope["type"],
      payload: unknown,
      extra: Partial<OraEventEnvelope> = {}
    ) => {
      const seq = events.length;
      const event = OraEventEnvelopeSchema.parse({
        id: `${runId}:evt-${seq}`,
        runId,
        seq,
        type,
        createdAt: startedAt + seq,
        pattern,
        payload,
        ...extra
      });
      events.push(event);
      return event;
    };
    const appendActionEvent = (actionId: string, status: string, record: unknown) => {
      appendEvent("action.updated", {
        actionId,
        status,
        record
      });
    };
    const createCheckpoint = (label: string, stateHash: string) => {
      const checkpoint: CheckpointMeta = {
        id: `${runId}:checkpoint-${checkpoints.length}`,
        runId,
        label,
        createdAt: startedAt + events.length,
        eventSeq: events.length,
        stateHash
      };
      checkpoints.push(checkpoint);
      appendEvent(
        "checkpoint.created",
        {
          checkpoint,
          summary: `${label} captured for deterministic ${definition.label} execution.`
        },
        { checkpointId: checkpoint.id }
      );
      return checkpoint;
    };

    appendEvent("run.started", {
      input,
      config: fullConfig,
      message: "Deterministic Ora MVP pattern run started."
    });
    if (params.forkedFrom) {
      appendEvent("run.forked", {
        sourceRunId: params.forkedFrom.runId,
        checkpointId: params.forkedFrom.checkpointId,
        eventSeq: params.forkedFrom.eventSeq
      });
    }
    appendEvent("topology.updated", baseTopology);
    appendEvent("profile.updated", { profiles });
    appendEvent("plan.updated", { items: planService.list() });
    appendEvent("todo.updated", { items: todoService.list() });

    const firstPlanItem = planService.firstItem();
    const highRiskAction = actionLedger.propose({
      id: "external-effect",
      type: this.patternActionType(pattern, modeSpec),
      riskLevel: "high",
      planItemId: firstPlanItem.id,
      agentId: firstPlanItem.ownerAgentId,
      input: {
        prompt: input.prompt,
        effect: "deterministic-runtime-side-effect"
      }
    });
    planService.linkAction(firstPlanItem.id, highRiskAction.id);
    appendActionEvent(highRiskAction.id, "proposed", highRiskAction);

    const decision = policyService.evaluate(highRiskAction);
    policyDecisions.push(decision);
    const approvalRequired = actionLedger.transition(highRiskAction.id, "approval_required");
    appendEvent("approval.required", {
      actionId: highRiskAction.id,
      decision
    });
    appendActionEvent(highRiskAction.id, "approval_required", approvalRequired);

    if (manualApproval) {
      planService.markAll("blocked");
      todoService.markAll("blocked");
      appendEvent("plan.updated", { items: planService.list() });
      appendEvent("todo.updated", { items: todoService.list() });
      const checkpoint = createCheckpoint(
        "Approval checkpoint",
        `${pattern}:approval_required:${planService.list().length}`
      );
      appendEvent("run.interrupted", {
        reason: "High-risk action requires approval before deterministic execution can continue.",
        actionId: highRiskAction.id,
        checkpointId: checkpoint.id
      });

      return StateSnapshotSchema.parse({
      runId,
      sessionId: params.session.sessionId,
      turnIndex,
      status: "interrupted",
        pattern,
        coordinationKind: pattern,
        modeId: modeSpec.id,
        input,
        config: fullConfig,
        topology: {
          nodes: baseTopology.nodes.map((node) => ({
            ...node,
            status: node.kind === "run" ? "blocked" : node.status
          })),
          edges: baseTopology.edges
        },
        profiles,
        memory: memoryService.list(),
        plan: planService.list(),
        todos: todoService.list(),
        actions: actionLedger.list(),
        policyDecisions,
        checkpoints,
        events,
        artifacts: [],
        modeSpec,
        updatedAt: startedAt + events.length
      });
    }

    appendEvent("approval.resolved", {
      actionId: highRiskAction.id,
      decision: "approved",
      mode: "auto"
    });
    const approved = actionLedger.transition(highRiskAction.id, "approved");
    appendActionEvent(highRiskAction.id, "approved", approved);
    const running = actionLedger.transition(highRiskAction.id, "running");
    appendActionEvent(highRiskAction.id, "running", running);

    const patternOutput = this.patternOutput(pattern, input.prompt, modeSpec);
    const memory = memoryService.remember({
      id: "pattern-state",
      namespace: this.patternMemoryNamespace(pattern, input.projectId, modeSpec),
      kind: pattern === "agent_teams" ? "worker" : "session",
      sourceActionId: highRiskAction.id,
      value: patternOutput.state
    });
    appendEvent("memory.updated", { record: memory });
    planService.markAll("done");
    todoService.markAll("done");
    appendEvent("plan.updated", { items: planService.list() });
    appendEvent("todo.updated", { items: todoService.list() });
    appendEvent("message.delta", {
      role: "assistant",
      content: patternOutput.message
    });
    appendEvent("token.delta", {
      text: patternOutput.token,
      tokenCount: patternOutput.tokenCount,
      budget
    });

    const succeeded = actionLedger.transition(highRiskAction.id, "succeeded", {
      output: patternOutput.state
    });
    appendActionEvent(highRiskAction.id, "succeeded", succeeded);
    const checkpoint = createCheckpoint(
      params.forkedFrom ? "Fork checkpoint" : "Pattern checkpoint",
      `${pattern}:${planService.list().length}:${baseTopology.nodes.length}:${actionLedger.list().length}`
    );
    planService.attachCheckpoint(checkpoint.id);
    appendEvent("run.done", {
      status: "succeeded",
      summary: `Deterministic ${definition.label} run completed.`
    });

    return StateSnapshotSchema.parse({
      runId,
      sessionId: params.session.sessionId,
      turnIndex,
      status: "succeeded",
      pattern,
      coordinationKind: pattern,
      modeId: modeSpec.id,
      input,
      config: fullConfig,
      topology: {
        nodes: baseTopology.nodes.map((node) => ({
          ...node,
          status: "done"
        })),
        edges: baseTopology.edges
      },
      profiles,
      memory: memoryService.list(),
      plan: planService.list(),
      todos: todoService.list(),
      actions: actionLedger.list(),
      policyDecisions,
      checkpoints,
      events,
      artifacts: [],
      modeSpec,
      output: patternOutput.state,
      updatedAt: startedAt + events.length
    });
  }

  private modeUsesSingleOwner(modeSpec: ModeSpec): boolean {
    const nodes = orderedEnabledModeNodes(modeSpec);
    const fallbackAgentId = modeSpec.profiles[0]?.id;
    const ownerIds = new Set(
      nodes.map((node) => node.ownerAgentId ?? fallbackAgentId).filter((id): id is string => typeof id === "string"),
    );
    return ownerIds.size <= 1 && !nodes.some((node) => {
      const atoms = Array.isArray(node.config?.atoms) ? node.config.atoms : [];
      return atoms.includes("subagent_delegate");
    });
  }

  private primaryOwnerAgentId(modeSpec: ModeSpec): string {
    return orderedEnabledModeNodes(modeSpec).find((node) => node.ownerAgentId)?.ownerAgentId ?? modeSpec.profiles[0]?.id ?? "agent";
  }

  private patternActionType(pattern: CoordinationPattern, modeSpec: ModeSpec): string {
    if (this.modeUsesSingleOwner(modeSpec)) {
      return `mode.${modeSpec.id}.respond`;
    }
    switch (pattern) {
      case "generator_verifier":
        return "pattern.generator_verifier.verify_candidate";
      case "orchestrator_subagent":
        return "pattern.orchestrator_subagent.dispatch_subagent";
      case "agent_teams":
        return "pattern.agent_teams.assign_worker";
      case "message_bus":
        return "pattern.message_bus.publish_event";
      case "shared_state":
        return "pattern.shared_state.write_board";
    }
    throw new OraRuntimeError(`Unsupported pattern action type: ${pattern}`, -32002, { pattern });
  }

  private patternMemoryNamespace(pattern: CoordinationPattern, projectId: string | undefined, modeSpec: ModeSpec): string[] {
    const projectNamespace = projectId ?? "local-project";
    switch (pattern) {
      case "generator_verifier":
        return ["session", projectNamespace, modeSpec.id];
      case "orchestrator_subagent":
        return ["session", projectNamespace, modeSpec.id];
      case "agent_teams":
        return ["worker", projectNamespace, modeSpec.id];
      case "message_bus":
        return ["session", projectNamespace, modeSpec.id];
      case "shared_state":
        return ["project", projectNamespace, modeSpec.id];
    }
    throw new OraRuntimeError(`Unsupported pattern memory namespace: ${pattern}`, -32002, { pattern });
  }

  private patternOutput(pattern: CoordinationPattern, prompt: string, modeSpec: ModeSpec) {
    if (this.modeUsesSingleOwner(modeSpec)) {
      const agentId = this.primaryOwnerAgentId(modeSpec);
      return {
        token: "answered",
        tokenCount: 1,
        message: `${modeSpec.label} framed "${prompt}" and completed the response without delegation.`,
        state: {
          text: `Single-agent result: ${prompt}`,
          pattern,
          modeId: modeSpec.id,
          agent: {
            id: agentId,
            plan: `Compact plan for: ${prompt}`,
            response: `Direct answer for: ${prompt}`
          }
        }
      };
    }
    switch (pattern) {
      case "generator_verifier":
        return {
          token: "verified",
          tokenCount: 1,
          message: `Generator produced a candidate for "${prompt}" and verifier accepted it against the MVP rubric.`,
          state: {
            text: `Verified candidate: ${prompt}`,
            pattern,
            modeId: modeSpec.id,
            generator: {
              candidate: `Candidate answer for: ${prompt}`
            },
            verifier: {
              verdict: "pass",
              rubric: ["addresses prompt", "bounded deterministic output"]
            }
          }
        };
      case "orchestrator_subagent":
        return {
          token: "delegated",
          tokenCount: 1,
          message: `Orchestrator decomposed "${prompt}", dispatched subagents, and synthesized their deterministic findings.`,
          state: {
            text: `Orchestrated result: ${prompt}`,
            pattern,
            modeId: modeSpec.id,
            orchestrator: {
              decomposition: ["research", "review", "synthesize"]
            },
            subagents: {
              researcher: "focused context gathered",
              reviewer: "risks checked"
            }
          }
        };
      case "agent_teams":
        return {
          token: "assigned",
          tokenCount: 1,
          message: `Team lead assigned "${prompt}" to persistent workers and recorded the handoff.`,
          state: {
            text: `Team result: ${prompt}`,
            pattern,
            modeId: modeSpec.id,
            backlog: ["triage", "build", "check", "handoff"],
            workers: {
              builder: "completed assigned work",
              checker: "validated output"
            }
          }
        };
      case "message_bus":
        return {
          token: "published",
          tokenCount: 1,
          message: `Router published "${prompt}" onto the bus, routed it, and the responder emitted the final message.`,
          state: {
            text: `Bus response: ${prompt}`,
            pattern,
            modeId: modeSpec.id,
            correlationId: `${prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-corr`,
            routingPlan: "task.input -> task.findings -> task.response",
          }
        };
      case "shared_state":
        return {
          token: "converged",
          tokenCount: 1,
          message: `Agents updated the shared board for "${prompt}" until the critic declared convergence.`,
          state: {
            text: `Shared-state result: ${prompt}`,
            pattern,
            modeId: modeSpec.id,
            board: [
              { key: "seed", summary: `Seeded board for ${prompt}` },
              { key: "finding-1", summary: "Added supporting evidence" },
              { key: "convergence", summary: "Board converged" }
            ]
          }
        };
    }
    throw new OraRuntimeError(`Unsupported pattern output: ${pattern}`, -32002, { pattern });
  }

  private transitionRun(
    snapshot: StateSnapshot,
    status: StateSnapshot["status"],
    type: "run.interrupted" | "run.cancelled",
    payload: unknown
  ): StateSnapshot {
    const withEvent = this.appendEvent(snapshot, type, payload);
    const updated = StateSnapshotSchema.parse(status === "cancelled"
      ? this.cancelledSnapshot(withEvent, payload)
      : {
          ...withEvent,
          status
        });
    this.persistRun(updated);
    return updated;
  }

  private cancelledSnapshot(snapshot: StateSnapshot, payload: unknown): StateSnapshot {
    const updatedAt = this.now();
    const reason = payload && typeof payload === "object" && "reason" in payload && typeof (payload as { reason?: unknown }).reason === "string"
      ? (payload as { reason: string }).reason
      : USER_CANCELLED_MESSAGE;
    const plan = snapshot.plan.map((item) => ({
      ...item,
      status: item.status === "done" || item.status === "skipped" ? item.status : "blocked" as const,
    }));
    const todos = snapshot.todos.map((item) => ({
      ...item,
      status: item.status === "done" || item.status === "skipped" ? item.status : "blocked" as const,
      updatedAt,
    }));
    return {
      ...snapshot,
      status: "cancelled",
      topology: {
        nodes: snapshot.topology.nodes.map((node) => ({ ...node, status: "failed" as const })),
        edges: snapshot.topology.edges,
      },
      plan,
      todos,
      actions: snapshot.actions.map((action) =>
        action.status === "approval_required" || action.status === "running" || action.status === "proposed" || action.status === "approved"
          ? { ...action, status: "denied" as const, error: reason }
          : action,
      ),
      toolCalls: snapshot.toolCalls.map((call) =>
        call.status === "running" || call.status === "proposed" || call.status === "approval_required" || call.status === "approved"
          ? {
              ...call,
              status: "denied" as const,
              updatedAt,
              error: reason,
              result: {
                status: "denied" as const,
                error: reason,
                content: reason,
                createdAt: updatedAt,
                updatedAt,
              },
            }
          : call,
      ),
      pendingApprovals: [],
      activeAgents: [],
      queueSummary: {
        ...snapshot.queueSummary,
        inProgress: 0,
        pending: plan.filter((item) => item.status !== "done" && item.status !== "skipped").length,
        completed: plan.filter((item) => item.status === "done" || item.status === "skipped").length,
      },
      error: reason,
      updatedAt,
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

  private withTopologyStatus(snapshot: StateSnapshot, status: "running" | "done") {
    return {
      nodes: snapshot.topology.nodes.map((node) => ({
        ...node,
        status
      })),
      edges: snapshot.topology.edges
    };
  }

  private toRunHandle(snapshot: StateSnapshot): RunHandle {
    return RunHandleSchema.parse({
      runId: snapshot.runId,
      sessionId: snapshot.sessionId,
      turnIndex: snapshot.turnIndex,
      status: snapshot.status,
      pattern: snapshot.pattern,
      modeId: snapshot.modeId,
      startedAt: snapshot.events[0]?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt
    });
  }

  private toRunSummary(snapshot: StateSnapshot): RunSummary {
    return RunSummarySchema.parse({
      runId: snapshot.runId,
      sessionId: snapshot.sessionId,
      turnIndex: snapshot.turnIndex,
      status: snapshot.status,
      pattern: snapshot.pattern,
      modeId: snapshot.modeId,
      prompt: snapshot.input.prompt,
      startedAt: snapshot.events[0]?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
      eventCount: snapshot.events.length,
      checkpointCount: snapshot.checkpoints.length,
      artifactCount: snapshot.artifacts.length
    });
  }

  private toSessionTurn(snapshot: StateSnapshot): SessionTurn {
    return SessionTurnSchema.parse({
      runId: snapshot.runId,
      sessionId: snapshot.sessionId,
      turnIndex: snapshot.turnIndex,
      status: snapshot.status,
      pattern: snapshot.pattern,
      modeId: snapshot.modeId,
      providerId: typeof snapshot.config.providerId === "string" ? snapshot.config.providerId : undefined,
      modelRef: snapshot.config.modelRef,
      prompt: snapshot.input.prompt,
      startedAt: snapshot.events[0]?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
      eventCount: snapshot.events.length,
      checkpointCount: snapshot.checkpoints.length,
      artifactCount: snapshot.artifacts.length,
      trace: snapshot.trace,
    });
  }

  private attachTraceMetadata(snapshot: StateSnapshot): StateSnapshot {
    const trace = this.mergeTraceMetadata(snapshot.runId, snapshot.trace);
    if (!trace) {
      return snapshot;
    }
    return StateSnapshotSchema.parse({
      ...snapshot,
      trace,
    });
  }

  private mergeTraceMetadata(runId: string, current?: RunTraceMetadata): RunTraceMetadata | undefined {
    const registered = getLangfuseRunTraceMetadata(runId);
    if (!registered) {
      return current;
    }
    if (!current) {
      return registered;
    }
    return {
      ...current,
      ...registered,
      generationRefs: registered.generationRefs.length > 0 ? registered.generationRefs : current.generationRefs,
    };
  }

  private buildRunTrailMetrics(snapshot: StateSnapshot, trace: RunTraceMetadata, observations: readonly { level?: string }[]): RunTrailMetrics {
    const runtimeMs = Math.max(0, snapshot.updatedAt - (snapshot.events[0]?.createdAt ?? snapshot.updatedAt));
    const topologyChangeCount = snapshot.events.filter((event) => event.type === "topology.updated").length;
    const messageCount = snapshot.events.filter((event) => event.type === "message.delta").length;
    const warningCount = observations.filter((observation) => observation.level === "WARNING").length;
    const errorCount = observations.filter((observation) => observation.level === "ERROR").length;
    const tracedCost = trace.generationRefs.reduce((sum, ref) => sum + (ref.totalCostUsd ?? 0), 0);
    return {
      runtimeMs,
      eventCount: snapshot.events.length,
      checkpointCount: snapshot.checkpoints.length,
      topologyChangeCount,
      messageCount,
      activeAgentCount: snapshot.activeAgents.length,
      warningCount,
      errorCount,
      estimatedCostUsd: Number((tracedCost > 0 ? tracedCost : snapshot.events.length * 0.0002).toFixed(4)),
    };
  }

  private persistRun(snapshot: StateSnapshot): void {
    this.cacheRun(snapshot, true);
    this.scheduleLongTermMemoryUpdate(snapshot);
  }

  private async persistRunWithGeneratedTitle(snapshot: StateSnapshot): Promise<void> {
    const titleOverride = await this.generateSessionTitle(snapshot);
    this.cacheRun(snapshot, true, { titleOverride });
    this.scheduleLongTermMemoryUpdate(snapshot);
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

  private async generateSessionTitle(snapshot: StateSnapshot): Promise<string | undefined> {
    if (!this.shouldGenerateSessionTitle(snapshot)) {
      return undefined;
    }

    const userMsg = snapshot.input.prompt.trim();
    const assistantMsg = this.assistantTextForRun(snapshot);
    try {
      const response = await invokeRunProvider(snapshot.config, {
        system: [
          "You are Ora's conversation title generator.",
          "Generate a concise title in the same language as the user message.",
          "Use at most 6 English words or roughly 16 Chinese characters, and never exceed 60 characters.",
          "Return only the title, with no quotes, markdown, label, or explanation.",
        ].join(" "),
        messages: [{
          role: "user",
          content: [
            "User message:",
            truncateForTitlePrompt(userMsg),
            "",
            "Assistant response:",
            truncateForTitlePrompt(assistantMsg),
          ].join("\n"),
        }],
        temperature: 0,
        maxTokens: 80,
        toolChoice: "none",
      });
      return this.parseGeneratedSessionTitle(response.text) ?? this.fallbackSessionTitle(userMsg);
    } catch {
      return this.fallbackSessionTitle(userMsg);
    }
  }

  private shouldGenerateSessionTitle(snapshot: StateSnapshot): boolean {
    if (!snapshot.sessionId || snapshot.status === "queued" || snapshot.status === "running") {
      return false;
    }
    if ((snapshot.turnIndex ?? 1) !== 1) {
      return false;
    }
    const existing = this.sessions.get(snapshot.sessionId);
    if (existing?.title && existing.title !== DEFAULT_SESSION_TITLE) {
      return false;
    }
    return snapshot.input.prompt.trim().length > 0 && this.assistantTextForRun(snapshot).length > 0;
  }

  private parseGeneratedSessionTitle(content: string): string | undefined {
    const line = content
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.length > 0);
    if (!line) {
      return undefined;
    }
    const title = line
      .replace(/^#+\s*/, "")
      .replace(/^[*-]\s*/, "")
      .replace(/^title\s*:\s*/i, "")
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .trim();
    if (!title) {
      return undefined;
    }
    return title.length > SESSION_TITLE_MAX_CHARS
      ? title.slice(0, SESSION_TITLE_MAX_CHARS).trim()
      : title;
  }

  private fallbackSessionTitle(prompt: string): string {
    const trimmed = prompt.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      return DEFAULT_SESSION_TITLE;
    }
    return trimmed.length > SESSION_TITLE_FALLBACK_CHARS
      ? `${trimmed.slice(0, SESSION_TITLE_FALLBACK_CHARS).trim()}...`
      : trimmed;
  }

  private scheduleLongTermMemoryUpdate(snapshot: StateSnapshot): void {
    if (snapshot.status === "queued" || snapshot.status === "running") {
      return;
    }
    const policy = this.resolveMemoryPolicy(snapshot.config);
    if (!policy.enabled) {
      return;
    }
    const conversationMessages = this.buildConversationMessages(snapshot.sessionId ?? "", snapshot.input.prompt, snapshot.runId)
      .filter((message): message is typeof message & { role: "system" | "developer" | "user" | "assistant" } => message.role !== "tool")
      .map((message) => ({ role: message.role, content: message.content }));
    this.longTermMemoryQueue.enqueue({
      snapshot,
      assistantText: this.assistantTextForRun(snapshot),
      conversationMessages,
      policy,
      invokeModel: policy.updater === "provider"
        ? async (request) => {
            const response = await invokeRunProvider({
              ...snapshot.config,
              providerId: policy.updaterProviderId ?? snapshot.config.providerId,
            }, request);
            return response.text;
          }
        : undefined,
    }, policy.debounceMs);
  }

  private async processLongTermMemoryUpdate(task: LongTermMemoryUpdateTask): Promise<void> {
    const { factsAdded } = await this.longTermMemory.updateFromRunWithProvider(task);
    const snapshot = this.runs.get(task.snapshot.runId) ?? task.snapshot;
    const records = this.longTermMemory.createRunMemoryRecords(snapshot, factsAdded);
    if (records.length === 0) {
      return;
    }

    let updated = StateSnapshotSchema.parse({
      ...snapshot,
      memory: [...snapshot.memory, ...records],
    });
    for (const record of records) {
      updated = this.appendEvent(updated, "memory.updated", {
        record,
        durability: "long_term",
      });
    }
    this.cacheRun(updated, true);
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
        projectWorkspace: this.projectWorkspaceContext(project),
      },
    });
  }

  private projectWorkspaceContext(project: ProjectSummary): Record<string, unknown> {
    const extensionCounts: Record<string, number> = {};
    const samplePaths: string[] = [];
    let totalFiles = 0;
    let markdownFiles = 0;
    let truncated = false;

    const visit = (directory: string) => {
      if (truncated) {
        return;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (truncated) {
          return;
        }
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!PROJECT_WORKSPACE_SKIPPED_DIRS.has(entry.name)) {
            visit(absolutePath);
          }
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }

        totalFiles += 1;
        const extension = path.extname(entry.name).toLowerCase() || "[no extension]";
        extensionCounts[extension] = (extensionCounts[extension] ?? 0) + 1;
        if (extension === ".md") {
          markdownFiles += 1;
        }
        if (samplePaths.length < PROJECT_WORKSPACE_SAMPLE_LIMIT) {
          samplePaths.push(path.relative(project.rootPath, absolutePath));
        }
        if (totalFiles >= PROJECT_WORKSPACE_MAX_FILES) {
          truncated = true;
        }
      }
    };

    visit(project.rootPath);

    return {
      projectId: project.projectId,
      label: project.label,
      rootPath: project.rootPath,
      totalFiles,
      markdownFiles,
      extensionCounts,
      samplePaths,
      truncated,
    };
  }

  private requireProjectRootDirectory(project: ProjectSummary): string {
    const rootPath = path.resolve(project.rootPath);
    const stat = fs.statSync(rootPath);
    if (!stat.isDirectory()) {
      throw new OraRuntimeError("Project root path must be a directory.", -32004, { projectId: project.projectId });
    }
    return rootPath;
  }

  private resolveProjectFilePath(rootPath: string, requestedPath: string): string {
    const absolutePath = path.resolve(rootPath, requestedPath);
    const relative = path.relative(rootPath, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new OraRuntimeError("Project file path must stay inside the project root.", -32602, { path: requestedPath });
    }
    return absolutePath;
  }

  private relativeProjectFilePath(rootPath: string, absolutePath: string): string {
    return path.relative(rootPath, absolutePath) || ".";
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
          : this.defaultSessionTitle(snapshot.input.prompt));
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
    });
  }

  private defaultSessionTitle(prompt: string): string {
    const trimmed = prompt.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 120) : DEFAULT_SESSION_TITLE;
  }

  private normalizeProjectRootPath(rootPath: string): string {
    return path.resolve(rootPath.trim());
  }

  private syncProjectSummary(projectId: string): void {
    const existing = this.projects.get(projectId);
    if (!existing) {
      return;
    }
    const sessions = [...this.sessions.values()].filter((session) => session.projectId === projectId);
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
      const assistant = this.assistantTextForRun(turn);
      if (assistant) {
        messages.push({ role: "assistant", content: assistant });
      }
    }
    if (currentPrompt.trim()) {
      messages.push({ role: "user", content: currentPrompt.trim() });
    }
    return messages;
  }

  private async buildFeedbackSourceContext(snapshot: StateSnapshot): Promise<Record<string, unknown>> {
    const trail = await this.getRunTrail({ runId: snapshot.runId }).catch(() => undefined);
    const transcript = snapshot.sessionId
      ? this.sessionTranscript(snapshot.sessionId).slice(-8).map((message) => ({
          role: message.role,
          content: message.content,
          runId: message.runId,
          turnIndex: message.turnIndex,
        }))
      : [];
    return {
      runId: snapshot.runId,
      sessionId: snapshot.sessionId,
      turnIndex: snapshot.turnIndex,
      userPrompt: snapshot.input.prompt,
      assistantOutput: this.assistantTextForRun(snapshot),
      transcript,
      pattern: snapshot.pattern,
      modeId: snapshot.modeId,
      providerId: typeof snapshot.config.providerId === "string" ? snapshot.config.providerId : undefined,
      modelRef: typeof snapshot.config.modelRef === "string" ? snapshot.config.modelRef : undefined,
      status: snapshot.status,
      trail: trail
        ? {
            liveMetrics: trail.liveMetrics,
            trace: {
              enabled: trail.trace.enabled,
              available: trail.trace.available,
              traceId: trail.trace.traceId,
              source: trail.trace.source,
              generationCount: trail.trace.generationRefs.length,
            },
            observations: trail.observations.slice(0, 12).map((observation) => ({
              id: observation.id,
              type: observation.type,
              name: observation.name,
              level: observation.level,
              statusMessage: observation.statusMessage,
              model: observation.model,
            })),
          }
        : undefined,
      topology: {
        nodes: snapshot.topology.nodes.map((node) => ({
          id: node.id,
          label: node.label,
          kind: node.kind,
          role: typeof node.metadata.role === "string" ? node.metadata.role : node.kind,
          status: node.status,
        })),
        edges: snapshot.topology.edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          label: edge.label,
          kind: edge.kind,
        })),
      },
      events: snapshot.events.slice(-20).map((event) => ({
        type: event.type,
        seq: event.seq,
        nodeId: event.nodeId,
        agentId: event.agentId,
        payload: summarizeEventPayload(event.payload),
      })),
    };
  }

  private async curateFeedbackDraft(
    config: RunConfig,
    feedbackId: string,
    feedbackText: string,
    sourceContext: Record<string, unknown>
  ) {
    const response = await invokeRunProvider(config, {
      system: [
        "You are Ora's independent evaluation dataset curator.",
        "Convert natural-language user feedback about an assistant reply into one JSON evaluation draft.",
        "Do not grade the original run. Produce a future-facing evaluation case.",
        "Return only JSON with keys: case, curatorRationale.",
        "The case must match Ora EvaluationCase: { id, input: { prompt, context }, expected, metadata }.",
        "Put failureMode, severity, idealBehavior, mustAddress, shouldAvoid, rubric in expected.structured.",
        "Use metadata.source='chat_feedback' and include feedbackId, sourceRunId, failureMode, severity, tags.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: JSON.stringify({
          feedbackId,
          feedbackText,
          sourceContext,
        }, null, 2),
      }],
      temperature: 0,
      maxTokens: 1400,
      toolChoice: "none",
    });
    const parsed = parseJsonObject(response.text);
    const draftSource = parsed.case
      ? {
          case: parsed.case,
          curatorRationale: typeof parsed.curatorRationale === "string" ? parsed.curatorRationale : undefined,
        }
      : {
          case: parsed,
          curatorRationale: "Curator returned an EvaluationCase object.",
        };
    return EvaluationFeedbackDraftCaseSchema.parse({
      ...draftSource,
      curatorStatus: "generated",
    });
  }

  private assistantTextForRun(snapshot: StateSnapshot): string {
    if (typeof snapshot.output === "string") {
      return snapshot.output.trim();
    }
    if (snapshot.output && typeof snapshot.output === "object") {
      const candidate = (snapshot.output as Record<string, unknown>).text;
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
      const event = snapshot.events[index];
      if (!event || event.type !== "message.delta" || !event.payload || typeof event.payload !== "object") {
        continue;
      }
      const content = (event.payload as Record<string, unknown>).content;
      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }
    }
    return "";
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
      const assistant = this.assistantTextForRun(run);
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

  private migrateLegacyRunsIntoSessions(): void {
    let mutated = false;
    for (const [runId, existing] of this.runs.entries()) {
      if (existing.sessionId) {
        continue;
      }
      const sessionId = `session-legacy-${runId}`;
      const migrated = StateSnapshotSchema.parse({
        ...existing,
        sessionId,
        turnIndex: 1,
      });
      this.runs.set(runId, migrated);
      this.backend.saveRun(migrated);
      if (!this.sessions.has(sessionId)) {
        this.sessions.set(sessionId, SessionSummarySchema.parse({
          sessionId,
          title: this.defaultSessionTitle(migrated.input.prompt),
          projectId: migrated.input.projectId,
          status: migrated.status,
          latestRunId: migrated.runId,
          latestPattern: migrated.pattern,
          latestProviderId: typeof migrated.config.providerId === "string" ? migrated.config.providerId : undefined,
          latestModelRef: migrated.config.modelRef,
          turnCount: 1,
          createdAt: migrated.input.createdAt ?? migrated.updatedAt,
          updatedAt: migrated.updatedAt,
        }));
      }
      mutated = true;
    }
    if (mutated) {
      for (const session of this.sessions.values()) {
        this.backend.saveSession(session);
      }
      this.backend.saveManifest(this.manifest);
    }
  }

  private migrateLegacyOraMvpProjectPlaceholder(): void {
    if (this.projects.has("ora-mvp")) {
      return;
    }

    let mutated = false;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.projectId !== "ora-mvp") {
        continue;
      }
      const nextSession = SessionSummarySchema.parse({
        ...session,
        projectId: undefined,
      });
      this.sessions.set(sessionId, nextSession);
      this.backend.saveSession(nextSession);
      mutated = true;
    }

    for (const [runId, run] of this.runs.entries()) {
      if (run.input.projectId !== "ora-mvp") {
        continue;
      }
      const nextRun = StateSnapshotSchema.parse({
        ...run,
        input: {
          ...run.input,
          projectId: undefined,
        },
      });
      this.runs.set(runId, nextRun);
      this.backend.saveRun(nextRun);
      mutated = true;
    }

    if (mutated) {
      this.backend.saveManifest(this.manifest);
    }
  }

  private now(): number {
    return this.clock();
  }
}

export class InMemoryRunStore extends LocalRunStore {}

function parseAutoModeRouterResponse(text: string): z.infer<typeof AutoModeRouterResponseSchema> {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  return AutoModeRouterResponseSchema.parse(JSON.parse(jsonText));
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".css":
      return "text/css";
    case ".csv":
      return "text/csv";
    case ".gif":
      return "image/gif";
    case ".htm":
    case ".html":
      return "text/html";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "text/javascript";
    case ".json":
    case ".jsonc":
      return "application/json";
    case ".md":
    case ".mdx":
      return "text/markdown";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".rs":
      return "text/rust";
    case ".svg":
      return "image/svg+xml";
    case ".toml":
      return "text/toml";
    case ".ts":
    case ".tsx":
      return "text/typescript";
    case ".txt":
      return "text/plain";
    case ".webp":
      return "image/webp";
    case ".yaml":
    case ".yml":
      return "text/yaml";
    default:
      return "application/octet-stream";
  }
}

function projectFilePreviewKind(mimeType: string): ProjectFileReadResult["previewKind"] {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.includes("json")) {
    return "json";
  }
  if (mimeType.startsWith("text/")) {
    return "text";
  }
  return "binary";
}

function readJsonPreviewPayload(filePath: string): unknown {
  const text = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function summarizeEventPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ["summary", "message", "content", "status", "label", "detail", "error"]) {
    if (typeof record[key] === "string") {
      summary[key] = String(record[key]).slice(0, 500);
    }
  }
  for (const key of ["actionId", "toolId", "checkpointId", "artifactId"]) {
    if (typeof record[key] === "string") {
      summary[key] = record[key];
    }
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function truncateForTitlePrompt(value: string): string {
  return value.length > SESSION_TITLE_MAX_INPUT_CHARS
    ? value.slice(0, SESSION_TITLE_MAX_INPUT_CHARS)
    : value;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Curator returned an empty response.");
  }
  try {
    return parseJsonRecord(JSON.parse(trimmed));
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fenced?.[1]) {
      return parseJsonRecord(JSON.parse(fenced[1]));
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return parseJsonRecord(JSON.parse(trimmed.slice(start, end + 1)));
    }
    throw new Error("Curator response did not contain a JSON object.");
  }
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Curator JSON must be an object.");
  }
  return value as Record<string, unknown>;
}

export function defaultRuntimeStoreDir(): string {
  return fileURLToPath(pathToFileURL(path.join(process.cwd(), ".ora", "runtime.db")));
}

export function defaultEvaluationStoreDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "evaluation-store")
    : path.join(runtimeDataDir, "evaluation-store");
}

export function defaultFeedbackLoopStoreDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "feedback-loop-store")
    : path.join(runtimeDataDir, "feedback-loop-store");
}

export function defaultCustomAgentsDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "agents")
    : path.join(runtimeDataDir, "agents");
}

export function defaultModesDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "modes")
    : path.join(runtimeDataDir, "modes");
}

export function defaultSkillsDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "skills", "private")
    : path.join(runtimeDataDir, "skills", "private");
}

export function defaultPublicSkillsDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "skills", "public")
    : path.join(runtimeDataDir, "skills", "public");
}

export function defaultMemoryDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "memory")
    : path.join(runtimeDataDir, "memory");
}
