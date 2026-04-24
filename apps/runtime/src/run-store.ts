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
  DEFAULT_RESOURCE_BUDGETS,
  getPatternDefinition,
  modeSpecToPatternDefinition,
  MVP_PATTERNS,
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
  StateSnapshot,
  StateSnapshotSchema,
  UserTaskInput,
  UserTaskInputSchema
} from "@ora/shared";
import {
  ActionLedger,
  AgentProfileRegistry,
  MemoryService,
  PlanService,
  PolicyService
} from "./capabilities.js";
import { CustomAgentFileStore } from "./custom-agents.js";
import { executeRuntimeKernel } from "./harness/runtime-kernel.js";
import { ModeSpecFileStore } from "./modes.js";
import { SqliteRuntimePersistence } from "./persistence/sqlite-backend.js";
import type { RuntimePersistenceBackend } from "./persistence/sqlite-backend.js";
import type { ModelMessage } from "./providers/index.js";
import {
  getLangfuseRunTraceMetadata,
  getLangfuseRunTraceObservations,
  readLangfuseRunTrace,
  recordLangfuseSnapshotTrace,
  withLangfuseRunTrace
} from "./telemetry/langfuse.js";
import { LocalEvaluationStore } from "./evaluation-store.js";

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

export interface LocalRunStoreOptions {
  dataDir?: string;
  clock?: () => number;
}

interface PersistedArtifact {
  ref: ArtifactRef;
  payload: unknown;
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
  private readonly customAgentStore: CustomAgentFileStore;
  private readonly modeStore: ModeSpecFileStore;
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
    this.evaluationStore = new LocalEvaluationStore(defaultEvaluationStoreDir(dataDir), this.clock);
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

  createSession(params: unknown = {}): SessionSummary {
    const parsed = SessionCreateParamsSchema.parse(params ?? {});
    if (parsed.projectId) {
      this.getProjectOrThrow(parsed.projectId);
    }
    const now = this.now();
    const session = SessionSummarySchema.parse({
      sessionId: this.nextSessionId(),
      title: parsed.label?.trim() || "New Chat",
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

  async startRun(params: unknown): Promise<RunHandle> {
    const parsed = StartRunParamsSchema.parse(params);
    const session = this.ensureSessionForRun(parsed.sessionId, parsed.input);
    const { fullConfig } = this.resolveModeSelection(parsed.config);
    const manualApproval =
      fullConfig.approvalMode === "manual" ||
      fullConfig.metadata?.approvalMode === "manual" ||
      fullConfig.metadata?.requireApproval === true;
    if (manualApproval) {
      const run = this.createCompletedRun({
        input: parsed.input,
        config: fullConfig,
        session,
      });
      recordLangfuseSnapshotTrace(run);
      const tracedRun = this.attachTraceMetadata(run);
      this.persistRun(tracedRun);
      return this.toRunHandle(tracedRun);
    }

    const input = UserTaskInputSchema.parse({
      ...parsed.input,
      createdAt: parsed.input.createdAt ?? this.now()
    });
    const { modeSpec, definition } = this.resolveModeSelection(fullConfig);
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
    const sessionBoundSnapshot = await withLangfuseRunTrace(
      { runId, input, config: fullConfig },
      async () => {
        const { snapshot } = await executeRuntimeKernel(runId, input, fullConfig, {
          clock: this.clock,
          modeSpec,
          definition,
          customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
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
    this.persistRun(tracedSnapshot);
    return this.toRunHandle(tracedSnapshot);
  }

  async startRunWithKernel(
    params: unknown,
    forkedFrom?: { runId: string; checkpointId: string; eventSeq: number }
  ): Promise<RunHandle> {
    const parsed = StartRunParamsSchema.parse(params);
    const session = this.ensureSessionForRun(parsed.sessionId, parsed.input);
    const input = UserTaskInputSchema.parse({
      ...parsed.input,
      createdAt: parsed.input.createdAt ?? this.now()
    });
    const { modeSpec, definition, fullConfig } = this.resolveModeSelection(parsed.config);
    const runId = this.nextRunId();
    const turnIndex = this.nextTurnIndex(session.sessionId);
    const sessionBoundSnapshot = await withLangfuseRunTrace(
      { runId, input, config: fullConfig },
      async () => {
        const { snapshot } = await executeRuntimeKernel(runId, input, fullConfig, {
          clock: this.clock,
          modeSpec,
          definition,
          customAgentOverlay: this.customAgentStore.personaOverlay(fullConfig.customAgentId),
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
    this.persistRun(tracedSnapshot);
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
    }) => Promise<StateSnapshot | undefined>
  ): Promise<RunHandle | undefined> {
    const parsed = StartRunParamsSchema.parse(params);
    const session = this.ensureSessionForRun(parsed.sessionId, parsed.input);
    const input = UserTaskInputSchema.parse({
      ...parsed.input,
      createdAt: parsed.input.createdAt ?? this.now()
    });
    const { modeSpec, definition, fullConfig } = this.resolveModeSelection(parsed.config);
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
    this.persistRun(sessionBoundSnapshot);
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
      reason: parsed.reason ?? "Interrupted by caller."
    });
  }

  resumeRun(params: unknown): StateSnapshot {
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
    let working = this.appendEvent(snapshot, "run.resumed", {
      reason: parsed.reason ?? "Resumed by caller.",
      patch: parsed.patch ?? {}
    });

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

      const output = this.patternOutput(working.pattern, working.input.prompt);
      const memory = {
        id: `${working.runId}:memory:resumed-pattern-state`,
        namespace: this.patternMemoryNamespace(working.pattern, working.input.projectId),
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
    this.persistRun(updated);
    return updated;
  }

  cancelRun(params: unknown): StateSnapshot {
    const runId = this.requireRunId(params);
    const snapshot = this.getRunOrThrow(runId);
    return this.transitionRun(snapshot, "cancelled", "run.cancelled", {
      reason: "Cancelled by caller."
    });
  }

  getRunState(params: unknown): StateSnapshot {
    return this.attachTraceMetadata(this.getRunOrThrow(this.requireRunId(params)));
  }

  async getRunTrail(params: unknown): Promise<RunTrail> {
    const parsed = RunTrailParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    const { trace, observations } = await readLangfuseRunTrace(snapshot.runId, snapshot.trace);
    return RunTrailSchema.parse({
      run: this.toRunSummary(snapshot),
      trace,
      observations,
      liveMetrics: this.buildRunTrailMetrics(snapshot, trace),
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

  private resolveModeSelection(config?: Partial<RunConfig>): {
    modeSpec: ModeSpec;
    definition: PatternDefinition;
    fullConfig: RunConfig;
  } {
    const parsed = RunConfigSchema.parse(config ?? {});
    const requestedModeId = typeof config?.modeId === "string" ? config.modeId : parsed.modeId ?? parsed.pattern;
    const modeSpec = this.modeStore.resolve(requestedModeId, parsed.pattern);
    const definition = modeSpecToPatternDefinition(modeSpec);
    const fullConfig = RunConfigSchema.parse({
      ...parsed,
      pattern: modeSpec.family,
      modeId: modeSpec.id,
      budget: parsed.budget ?? modeSpec.defaultBudget ?? DEFAULT_RESOURCE_BUDGETS[modeSpec.family],
      approvalMode: config?.approvalMode ?? modeSpec.capabilityFlags.approvalMode,
      skillIds: Array.isArray(config?.skillIds) ? config.skillIds : modeSpec.capabilityFlags.skillIds,
      toolIds: Array.isArray(config?.toolIds) ? config.toolIds : modeSpec.capabilityFlags.toolIds,
      metadata: {
        ...parsed.metadata,
        modeId: modeSpec.id,
      },
    });
    return {
      modeSpec,
      definition,
      fullConfig,
    };
  }

  private createCompletedRun(params: {
    input: UserTaskInput;
    config?: Partial<RunConfig>;
    session: SessionSummary;
    forkedFrom?: { runId: string; checkpointId: string; eventSeq: number };
  }): StoredRun {
    const input = UserTaskInputSchema.parse({
      ...params.input,
      createdAt: params.input.createdAt ?? this.now()
    });
    const { modeSpec, definition, fullConfig } = this.resolveModeSelection(params.config);
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

    const firstPlanItem = planService.firstItem();
    const highRiskAction = actionLedger.propose({
      id: "external-effect",
      type: this.patternActionType(pattern),
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

    const patternOutput = this.patternOutput(pattern, input.prompt);
    const memory = memoryService.remember({
      id: "pattern-state",
      namespace: this.patternMemoryNamespace(pattern, input.projectId),
      kind: pattern === "agent_teams" ? "worker" : "session",
      sourceActionId: highRiskAction.id,
      value: patternOutput.state
    });
    appendEvent("memory.updated", { record: memory });
    planService.markAll("done");
    appendEvent("plan.updated", { items: planService.list() });
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

  private patternActionType(pattern: CoordinationPattern): string {
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

  private patternMemoryNamespace(pattern: CoordinationPattern, projectId?: string): string[] {
    const projectNamespace = projectId ?? "local-project";
    switch (pattern) {
      case "generator_verifier":
        return ["session", projectNamespace, "generator_verifier"];
      case "orchestrator_subagent":
        return ["session", projectNamespace, "orchestrator_subagent"];
      case "agent_teams":
        return ["worker", projectNamespace, "agent_teams"];
      case "message_bus":
        return ["session", projectNamespace, "message_bus"];
      case "shared_state":
        return ["project", projectNamespace, "shared_state"];
    }
    throw new OraRuntimeError(`Unsupported pattern memory namespace: ${pattern}`, -32002, { pattern });
  }

  private patternOutput(pattern: CoordinationPattern, prompt: string) {
    switch (pattern) {
      case "generator_verifier":
        return {
          token: "verified",
          tokenCount: 1,
          message: `Generator produced a candidate for "${prompt}" and verifier accepted it against the MVP rubric.`,
          state: {
            text: `Verified candidate: ${prompt}`,
            pattern,
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
    const updated = StateSnapshotSchema.parse({
      ...this.appendEvent(snapshot, type, payload),
      status
    });
    this.persistRun(updated);
    return updated;
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

  private buildRunTrailMetrics(snapshot: StateSnapshot, trace: RunTraceMetadata): RunTrailMetrics {
    const runtimeMs = Math.max(0, snapshot.updatedAt - (snapshot.events[0]?.createdAt ?? snapshot.updatedAt));
    const topologyChangeCount = snapshot.events.filter((event) => event.type === "topology.updated").length;
    const messageCount = snapshot.events.filter((event) => event.type === "message.delta").length;
    const warningCount = getLangfuseRunTraceObservations(snapshot.runId).filter((observation) => observation.level === "WARNING").length;
    const errorCount = getLangfuseRunTraceObservations(snapshot.runId).filter((observation) => observation.level === "ERROR").length;
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
    this.runs.set(snapshot.runId, snapshot);
    this.backend.saveRun(snapshot);
    if (snapshot.sessionId) {
      const session = this.upsertSessionFromRun(snapshot);
      this.persistSession(session);
    }
    this.backend.saveManifest(this.manifest);
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

  private upsertSessionFromRun(snapshot: StateSnapshot): SessionSummary {
    const sessionId = snapshot.sessionId;
    if (!sessionId) {
      throw new OraRuntimeError("Cannot persist run without sessionId.", -32004, { runId: snapshot.runId });
    }
    const existing = this.sessions.get(sessionId);
    const turnCount = this.runsForSession(sessionId).filter((run) => run.runId !== snapshot.runId).length + 1;
    const title = existing && existing.turnCount > 0
      ? existing.title
      : this.defaultSessionTitle(snapshot.input.prompt);
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
    return trimmed.length > 0 ? trimmed.slice(0, 120) : "New Chat";
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

  private buildConversationMessages(sessionId: string, currentPrompt: string): ModelMessage[] {
    const priorTurns = this.runsForSession(sessionId);
    const messages: ModelMessage[] = [];
    for (const turn of priorTurns) {
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

export function defaultRuntimeStoreDir(): string {
  return fileURLToPath(pathToFileURL(path.join(process.cwd(), ".ora", "runtime.db")));
}

export function defaultEvaluationStoreDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "evaluation-store")
    : path.join(runtimeDataDir, "evaluation-store");
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
