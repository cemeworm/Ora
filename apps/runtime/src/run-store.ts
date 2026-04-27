import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ArtifactRef,
  ArtifactRefSchema,
  CheckpointMeta,
  AgentCatalogResult,
  AgentCatalogResultSchema,
  CustomAgentCatalogItemSchema,
  CustomAgentCheckNameResult,
  CustomAgentCreateParams,
  CustomAgentDetail,
  CustomAgentGenerateDraftParams,
  CustomAgentGenerateDraftResult,
  CustomAgentSummary,
  CustomAgentUpdateParams,
  CustomAgentCreateParamsSchema,
  DEFAULT_SKILL_TOOL_IDS,
  DEFAULT_WEB_TOOL_IDS,
  DEFAULT_RESOURCE_BUDGETS,
  EvaluationFeedbackDraftCaseSchema,
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
  ModeStudioDraftBundleSchema,
  ModeStudioGenerateDraftParams,
  ModeStudioGenerateDraftParamsSchema,
  ModeStudioRefineDraftParamsSchema,
  ModeStudioStartBuilderRunParams,
  ModeStudioStartBuilderRunParamsSchema,
  ModeStudioValidateDraftParamsSchema,
  createModeSpecFromPattern,
  getPatternDefinition,
  modeSpecToPatternDefinition,
  MVP_MODE_RUNTIME_ATOMS,
  MVP_PATTERNS,
  ModeSpecSchema,
  type ModeCreateParams,
  type ModeSpec,
  type ModeUpdateParams,
  type ModeValidationResult,
  OraEventEnvelope,
  OraEventEnvelopeSchema,
  PatternDefinition,
  ProjectCreateParamsSchema,
  ProjectDetail,
  ProjectDetailSchema,
  ProjectFileReadParamsSchema,
  ProjectFileReadResult,
  ProjectFilesParamsSchema,
  ProjectFilesResult,
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
  SessionArchiveParamsSchema,
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
  SystemAgentOverride,
  SystemAgentOverrideResetParamsSchema,
  SystemAgentOverrideUpdateParamsSchema,
  SystemAgentOverrideUpdateParams,
  UserTaskInput,
  UserTaskInputSchema,
  withDefaultWebToolIds
} from "@ora/shared";
import type { ActionRecord } from "@ora/shared";
import { TodoService } from "./capabilities.js";
import { CustomAgentFileStore } from "./custom-agents.js";
import { SystemAgentOverrideFileStore } from "./custom-agents.js";
import { RuntimeSkillRegistry, RuntimeToolRegistry } from "./harness/capability-registries.js";
import { RuntimeToolExecutor } from "./harness/runtime-tool-executor.js";
import { FileLongTermMemoryStore, LongTermMemoryManager, LongTermMemoryUpdateQueue } from "./memory.js";
import type { LongTermMemoryUpdateTask } from "./memory.js";
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
import { invokeRunProvider, type ModelMessage } from "./providers/index.js";
import {
  getLangfuseRunTraceMetadata,
  readLangfuseRunTrace
} from "./telemetry/langfuse.js";
import { mergeTrailObservations, synthesizeLocalTrail } from "./telemetry/trails.js";
import { LocalEvaluationStore } from "./evaluation-store.js";
import { LocalFeedbackLoopStore } from "./feedback-loop-store.js";
import {
  listProjectFilesForProject,
  normalizeProjectRootPath,
  projectWorkspaceContext,
  readProjectFileForProject
} from "./project-workspace.js";
import { OraRuntimeError } from "./runtime-errors.js";
import { generateCustomAgentDraft } from "./agent-draft.js";
import { isPlainRecord, parseJsonObject } from "./provider-json.js";
import {
  assessModeStudioDesignCompleteness,
  enrichModeStudioGeneratedDraft,
  inferModeStudioFamily,
  isCoordinationPattern,
  modeCreateParamsFromSpec,
  modeStudioAgentDraft,
  modeStudioBuilderSystemPrompt,
  modeStudioBuilderUserPrompt,
  type ModeStudioBuilderProviderResponse,
  modeStudioDescription,
  modeStudioFamilyReason,
  modeStudioGuidance,
  modeStudioLabel,
  modeStudioNeedsInputBundle,
  modeStudioNodePrompt,
  modeStudioNodeStoryConfig,
  modeStudioPurpose,
  modeStudioRolePlans,
  modeStudioRuntimeAtoms,
  modeStudioSummary,
  modeStudioTopologyChoices,
  modeStudioUserText,
  normalizeGeneratedAgentDraft,
  ownerForModeStudioTemplate,
  parseModeStudioBuilderProviderText,
  prepareModeStudioDraft,
  slugifyModeStudio
} from "./mode-studio-draft.js";
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
  cancelledRunSnapshot,
  createRunningRunSnapshot,
  createStandaloneRunSnapshot
} from "./run-snapshots.js";
import {
  completeModeStudioBuilderSnapshot,
  createModeStudioBuilderConfig,
  createModeStudioBuilderInput,
  modeStudioBuilderResultFromSnapshot,
  startModeStudioBuilderSnapshot,
  type ModeStudioBuilderRunResult
} from "./mode-studio-builder-run.js";

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

const AUTO_MODE_ROUTER_CONFIDENCE_THRESHOLD = 0.55;
const DEFAULT_SESSION_TITLE = "New Chat";
const SESSION_TITLE_MAX_INPUT_CHARS = 500;
const SESSION_TITLE_MAX_CHARS = 60;
const SESSION_TITLE_FALLBACK_CHARS = 50;
const AutoModeRouterResponseSchema = z.object({
  modeId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

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
    return {
      ...modeSpec,
      profiles: modeSpec.profiles.map((profile) => this.systemAgentOverrideStore.apply(profile)),
    };
  }

  private customAgentOverlaysForMode(modeSpec: ModeSpec): Record<string, string> {
    const overlays: Record<string, string> = {};
    for (const customAgentId of this.customAgentIdsForMode(modeSpec)) {
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

  private customAgentContextsForMode(modeSpec: ModeSpec): Record<string, Pick<CustomAgentDetail, "model" | "skillIds" | "toolIds"> & { overlay: string }> {
    const contexts: Record<string, Pick<CustomAgentDetail, "model" | "skillIds" | "toolIds"> & { overlay: string }> = {};
    for (const customAgentId of this.customAgentIdsForMode(modeSpec)) {
      if (!customAgentId || contexts[customAgentId]) {
        continue;
      }
      try {
        const agent = this.customAgentStore.get({ name: customAgentId });
        const overlay = this.customAgentStore.personaOverlay(customAgentId);
        if (overlay) {
          contexts[customAgentId] = {
            overlay,
            model: agent.model,
            toolIds: agent.toolIds,
            skillIds: agent.skillIds,
          };
        }
      } catch {
        // A deleted custom agent should not make an otherwise valid mode unusable.
      }
    }
    return contexts;
  }

  private customAgentIdsForMode(modeSpec: ModeSpec): string[] {
    return [
      ...modeSpec.profiles.map((profile) => profile.customAgentId?.trim() ?? ""),
      ...modeSpec.nodes.map((node) =>
        typeof node.config?.customAgentId === "string" ? node.config.customAgentId.trim() : "",
      ),
    ].filter(Boolean);
  }

  private systemAgentOverlaysForMode(modeSpec: ModeSpec): Record<string, string> {
    const overlays: Record<string, string> = {};
    for (const profile of modeSpec.profiles) {
      if (profile.customAgentId) {
        continue;
      }
      const overlay = this.systemAgentOverrideStore.overlay(profile.id);
      if (overlay) {
        overlays[profile.id] = overlay;
      }
    }
    return overlays;
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
    return this.buildModeStudioDraft(parsed);
  }

  refineModeStudioDraft(params: unknown): ModeStudioDraftBundle {
    const parsed = ModeStudioRefineDraftParamsSchema.parse(params);
    return this.buildModeStudioDraft({
      ...parsed,
      currentDraft: parsed.draftBundle.modeDraft,
    });
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

    const result = await this.createModeStudioBuilderResult(parsed, config);
    snapshot = completeModeStudioBuilderSnapshot({
      snapshot,
      result,
      runId,
      definition,
      createdAt: this.now(),
      appendEvent,
    });
    this.cacheRun(this.attachTraceMetadata(snapshot), true);
    return this.toRunHandle(snapshot);
  }

  modeStudioBuilderResult(params: unknown): ModeStudioBuilderResult {
    const parsed = ModeStudioBuilderResultParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    return modeStudioBuilderResultFromSnapshot(snapshot);
  }

  validateModeStudioDraft(params: unknown): ModeStudioDraftBundle {
    const parsed = ModeStudioValidateDraftParamsSchema.parse(params);
    return this.withModeStudioValidation(parsed.draftBundle);
  }

  applyModeStudioDraft(params: unknown): ModeStudioApplyDraftResult {
    const parsed = ModeStudioApplyDraftParamsSchema.parse(params);
    const bundle = this.withModeStudioValidation(parsed.draftBundle);
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

  private buildModeStudioDraft(params: ModeStudioGenerateDraftParams & { draftBundle?: ModeStudioDraftBundle }): ModeStudioDraftBundle {
    const userText = modeStudioUserText(params.messages);
    const source = this.modeStudioSourceMode(params);
    const completeness = assessModeStudioDesignCompleteness(userText, {
      currentDraft: params.currentDraft,
      previousDraftBundle: params.draftBundle,
    });
    if (!completeness.complete) {
      return this.withModeStudioValidation(ModeStudioDraftBundleSchema.parse({
        modeDraft: prepareModeStudioDraft(source, userText, [], params),
        agentDrafts: [],
        guidance: {
          step: completeness.missing.includes("topology") ? "topology" : "goal",
          assistantMessage: completeness.assistantMessage,
          choices: completeness.missing.includes("topology") ? modeStudioTopologyChoices() : [],
        },
        changeSummary: ["Kept a preview draft open while the builder collects enough mode design detail."],
        validation: { valid: false, errors: [], warnings: [] },
        needsInput: true,
      }));
    }

    const family = inferModeStudioFamily(userText, source.family);
    const pattern = getPatternDefinition(family);
    const base = params.currentDraft && params.currentDraft.family === family
      ? params.currentDraft
      : createModeSpecFromPattern(family);
    const rolePlans = modeStudioRolePlans(family, userText);
    const usedNames = new Set(this.listAgents().map((agent) => agent.name));
    const agentDrafts = rolePlans.map((role) => modeStudioAgentDraft(role, userText, usedNames));
    const modeDraft = prepareModeStudioDraft(base, userText, agentDrafts, params);
    const profiles = rolePlans.map((role, index) => {
      const draft = agentDrafts[index]!;
      return {
        id: role.profileId,
        label: role.label,
        role: role.role,
        customAgentId: draft.name,
        modelRef: base.profiles[index]?.modelRef,
        toolPolicyId: base.profiles[index]?.toolPolicyId ?? `${family}.default`,
        toolIds: draft.toolIds,
        skillIds: draft.skillIds,
        memoryNamespaces: base.profiles[index]?.memoryNamespaces ?? ["session", "project"],
        budget: base.profiles[index]?.budget ?? DEFAULT_RESOURCE_BUDGETS[family],
      };
    });
    const toolIds = [...new Set(agentDrafts.flatMap((agent) => agent.toolIds))];
    const skillIds = [...new Set(agentDrafts.flatMap((agent) => agent.skillIds))];
    const runtimeAtoms = modeStudioRuntimeAtoms(family, userText, base.runtimeAtoms);
    const nextDraft = {
      ...modeDraft,
      family,
      summary: modeStudioSummary(userText, pattern.summary),
      description: modeStudioDescription(userText, pattern),
      recommendedUse: `Use when the user wants: ${modeStudioPurpose(userText)}.`,
      failureMode: pattern.failureMode,
      profiles,
      nodes: modeDraft.nodes.map((node) => {
        const ownerAgentId = ownerForModeStudioTemplate(node.template, rolePlans) ?? node.ownerAgentId;
        return {
          ...node,
          ownerAgentId,
          prompt: modeStudioNodePrompt(node.template, userText, node.prompt),
          config: {
            ...node.config,
            story: modeStudioNodeStoryConfig(family, node, ownerAgentId, profiles, userText),
          },
        };
      }),
      capabilityFlags: {
        ...modeDraft.capabilityFlags,
        supportsPersistentWorkers: pattern.supportsPersistentWorkers,
        supportsSharedState: pattern.supportsSharedState,
        supportsEventRouting: pattern.supportsEventRouting,
        toolIds,
        skillIds,
      },
      runtimeAtoms,
      updatedAt: Date.now(),
    };
    const guidance = modeStudioGuidance(family, userText);
    return this.withModeStudioValidation(ModeStudioDraftBundleSchema.parse({
      modeDraft: nextDraft,
      agentDrafts,
      guidance,
      changeSummary: [
        `Selected ${pattern.label} because the request implies ${modeStudioFamilyReason(family)}.`,
        `Drafted ${agentDrafts.length} agent${agentDrafts.length === 1 ? "" : "s"} with role-specific style and capabilities.`,
        toolIds.length > 0 ? `Mounted ${toolIds.length} tool${toolIds.length === 1 ? "" : "s"} across the agent roster.` : "Kept tools minimal until the user asks for more capability.",
      ],
      validation: { valid: false, errors: [], warnings: [] },
      needsInput: false,
    }));
  }

  private modeStudioSourceMode(params: ModeStudioGenerateDraftParams): ModeSpec {
    if (params.currentDraft) {
      return params.currentDraft;
    }
    if (params.baseModeId) {
      try {
        return this.getMode({ modeId: params.baseModeId });
      } catch {
        // Fall back to the default pattern when a stale UI reference is supplied.
      }
    }
    return this.listModes().find((mode) => mode.id === SINGLE_AGENT_MODE_ID)
      ?? createModeSpecFromPattern("orchestrator_subagent");
  }

  private withModeStudioValidation(bundle: ModeStudioDraftBundle): ModeStudioDraftBundle {
    const validation = this.validateMode({ spec: bundle.modeDraft });
    return ModeStudioDraftBundleSchema.parse({
      ...bundle,
      validation,
    });
  }

  private async createModeStudioBuilderResult(
    params: ModeStudioStartBuilderRunParams,
    config: RunConfig,
  ): Promise<ModeStudioBuilderRunResult> {
    if (config.providerId === "local-smoke" || config.modelRef === "local/smoke-model") {
      return { draftBundle: this.buildModeStudioDraft(params), issues: [] };
    }
    try {
      const firstResponse = await invokeRunProvider(config, {
        system: modeStudioBuilderSystemPrompt(),
        messages: params.messages.map((message): ModelMessage => ({
          role: message.role,
          content: message.content,
        })),
        prompt: modeStudioBuilderUserPrompt(params, this.modeStudioContext()),
        temperature: 0.2,
        maxTokens: 5000,
        toolChoice: "none",
      });
      const firstParsed = parseModeStudioBuilderProviderText(firstResponse.text);
      const parsed = firstParsed.success
        ? firstParsed
        : parseModeStudioBuilderProviderText((await invokeRunProvider(config, {
            system: "Repair the previous response into strict JSON only. Do not add markdown.",
            messages: [
              {
                role: "user",
                content: [
                  "Invalid Mode Studio builder response:",
                  firstResponse.text,
                  "Return JSON matching: {\"assistantMessage\": string, \"needsInput\": boolean, \"modeDraft\": ModeSpec, \"agentDrafts\": CustomAgentGeneratedDraft[], \"changeSummary\": string[], \"issues\": [{\"field\": string, \"message\": string}]}",
                ].join("\n\n"),
              },
            ],
            temperature: 0,
            maxTokens: 5000,
            toolChoice: "none",
          })).text);
      if (!parsed.success) {
        return {
          draftBundle: this.withModeStudioValidation(modeStudioNeedsInputBundle(this.modeStudioSourceMode(params), params, "Builder returned invalid JSON after repair.")),
          issues: [{ field: "general", message: "Builder returned invalid JSON after repair." }],
          rawText: firstResponse.text,
        };
      }
      const draftBundle = this.modeStudioBundleFromProvider(parsed.data, params);
      return { draftBundle, issues: parsed.data.issues, rawText: firstResponse.text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        draftBundle: this.withModeStudioValidation(modeStudioNeedsInputBundle(this.modeStudioSourceMode(params), params, message)),
        issues: [{ field: "general", message }],
      };
    }
  }

  private modeStudioBundleFromProvider(
    providerResult: ModeStudioBuilderProviderResponse,
    params: ModeStudioStartBuilderRunParams,
  ): ModeStudioDraftBundle {
    const text = modeStudioUserText(params.messages);
    const source = this.modeStudioSourceMode(params);
    const rawMode = isPlainRecord(providerResult.modeDraft) ? providerResult.modeDraft : {};
    const rawFamily = typeof rawMode.family === "string" && isCoordinationPattern(rawMode.family)
      ? rawMode.family
      : source.family;
    const base = params.currentDraft && params.currentDraft.family === rawFamily
      ? params.currentDraft
      : source.family === rawFamily
        ? source
        : createModeSpecFromPattern(rawFamily);
    const now = this.now();
    const idSeed = typeof rawMode.id === "string"
      ? rawMode.id
      : typeof rawMode.label === "string"
        ? rawMode.label
        : modeStudioPurpose(text);
    const modeDraft = ModeSpecSchema.parse({
      ...base,
      ...rawMode,
      id: slugifyModeStudio(idSeed) || slugifyModeStudio(base.id) || "guided-mode",
      family: rawFamily,
      label: typeof rawMode.label === "string" && rawMode.label.trim() ? rawMode.label.trim() : modeStudioLabel(text),
      summary: typeof rawMode.summary === "string" && rawMode.summary.trim() ? rawMode.summary.trim() : modeStudioSummary(text, base.summary),
      description: typeof rawMode.description === "string" && rawMode.description.trim() ? rawMode.description.trim() : modeStudioDescription(text, getPatternDefinition(rawFamily)),
      recommendedUse: typeof rawMode.recommendedUse === "string" && rawMode.recommendedUse.trim() ? rawMode.recommendedUse.trim() : `Use when the user wants: ${modeStudioPurpose(text)}.`,
      systemPreset: false,
      visibility: "user",
      nodes: Array.isArray(rawMode.nodes) ? rawMode.nodes : base.nodes,
      edges: Array.isArray(rawMode.edges) ? rawMode.edges : base.edges,
      profiles: Array.isArray(rawMode.profiles) ? rawMode.profiles : base.profiles,
      createdAt: params.currentDraft?.createdAt ?? now,
      updatedAt: now,
    });
    const agentDrafts = providerResult.agentDrafts.map((draft) => normalizeGeneratedAgentDraft(draft));
    const enrichedDraft = enrichModeStudioGeneratedDraft(modeDraft, {
      text,
      agentDrafts,
      currentDraft: params.currentDraft,
    });
    const completeness = assessModeStudioDesignCompleteness(text, {
      currentDraft: params.currentDraft,
      previousDraftBundle: params.draftBundle,
    });
    const needsInput = providerResult.needsInput || !completeness.complete;
    const bundle = ModeStudioDraftBundleSchema.parse({
      modeDraft: enrichedDraft,
      agentDrafts,
      guidance: {
        step: needsInput ? "goal" : "preview",
        assistantMessage: providerResult.needsInput
          ? providerResult.assistantMessage
          : needsInput
            ? completeness.assistantMessage
            : providerResult.assistantMessage,
        choices: needsInput
          ? (completeness.missing.includes("topology") ? modeStudioTopologyChoices() : [])
          : modeStudioGuidance(enrichedDraft.family, text).choices,
      },
      changeSummary: providerResult.changeSummary.length > 0
        ? providerResult.changeSummary
        : [`Generated ${enrichedDraft.label} through the runtime-backed Mode Studio builder.`],
      validation: { valid: false, errors: [], warnings: [] },
      needsInput,
    });
    return this.withModeStudioValidation(bundle);
  }

  createProject(params: unknown = {}): ProjectSummary {
    const parsed = ProjectCreateParamsSchema.parse(params ?? {});
    const normalizedRootPath = normalizeProjectRootPath(parsed.rootPath);
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
    return listProjectFilesForProject(project);
  }

  readProjectFile(params: unknown): ProjectFileReadResult {
    const parsed = ProjectFileReadParamsSchema.parse(params);
    const project = this.getProjectOrThrow(parsed.projectId);
    return readProjectFileForProject(project, parsed.path);
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
      .filter((session) => session.archivedAt === undefined)
      .filter((session) => (parsed.projectId ? session.projectId === parsed.projectId : true))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
      .slice(0, parsed.limit)
      .map((session) => SessionSummarySchema.parse(session));
  }

  archiveSession(params: unknown): SessionSummary {
    const parsed = SessionArchiveParamsSchema.parse(params);
    const existing = this.getSessionOrThrow(parsed.sessionId);
    const archivedAt = existing.archivedAt ?? this.now();
    const session = SessionSummarySchema.parse({
      ...existing,
      archivedAt,
      updatedAt: Math.max(existing.updatedAt, archivedAt),
    });
    this.persistSession(session);
    return session;
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

  agentCatalog(): AgentCatalogResult {
    const rawModes = this.modeStore.list().filter((mode) => mode.visibility !== "internal");
    const effectiveModes = rawModes.map((mode) => this.applySystemAgentOverridesToMode(mode));
    const effectiveModeById = new Map(effectiveModes.map((mode) => [mode.id, mode]));
    const systemProfiles = new Map<string, {
      source: "system";
      id: string;
      label: string;
      role: string;
      modelRef?: string;
      toolPolicyId: string;
      toolIds: string[];
      skillIds: string[];
      memoryNamespaces: string[];
      soul: string;
      overridden: boolean;
      override?: SystemAgentOverride;
      usages: unknown[];
    }>();
    const customUsages = new Map<string, unknown[]>();
    const addCustomUsage = (name: string | undefined, usage: unknown) => {
      if (!name) {
        return;
      }
      const normalized = name.trim().toLowerCase();
      const current = customUsages.get(normalized) ?? [];
      const key = JSON.stringify(usage);
      if (!current.some((item) => JSON.stringify(item) === key)) {
        current.push(usage);
      }
      customUsages.set(normalized, current);
    };

    for (const mode of rawModes.filter((candidate) => candidate.systemPreset)) {
      const effectiveMode = effectiveModeById.get(mode.id) ?? mode;
      for (const profile of mode.profiles) {
        if (systemProfiles.has(profile.id)) {
          continue;
        }
        const effectiveProfile = effectiveMode.profiles.find((candidate) => candidate.id === profile.id) ?? profile;
        const override = this.systemAgentOverrideStore.get(profile.id);
        const modelRef = explicitSystemAgentModelRef(effectiveProfile.modelRef);
        systemProfiles.set(profile.id, {
          source: "system",
          id: profile.id,
          label: effectiveProfile.label,
          role: effectiveProfile.role,
          ...(modelRef ? { modelRef } : {}),
          toolPolicyId: effectiveProfile.toolPolicyId,
          toolIds: effectiveProfile.toolIds,
          skillIds: effectiveProfile.skillIds,
          memoryNamespaces: effectiveProfile.memoryNamespaces,
          soul: override?.soul ?? effectiveProfile.systemPrompt ?? "",
          overridden: override !== undefined,
          ...(override ? { override } : {}),
          usages: [],
        });
      }
    }

    for (const mode of rawModes) {
      const effectiveMode = effectiveModeById.get(mode.id) ?? mode;
      for (const profile of mode.profiles) {
        const effectiveProfile = effectiveMode.profiles.find((candidate) => candidate.id === profile.id) ?? profile;
        const usage = {
          modeId: mode.id,
          modeLabel: effectiveMode.label,
          systemPreset: mode.systemPreset,
          profileId: profile.id,
          profileLabel: effectiveProfile.label,
        };
        if (profile.customAgentId) {
          addCustomUsage(profile.customAgentId, usage);
          continue;
        }
        systemProfiles.get(profile.id)?.usages.push(usage);
      }
      for (const node of mode.nodes) {
        addCustomUsage(
          typeof node.config?.customAgentId === "string" ? node.config.customAgentId : undefined,
          {
            modeId: mode.id,
            modeLabel: effectiveMode.label,
            systemPreset: mode.systemPreset,
            nodeId: node.id,
            nodeLabel: node.title ?? node.label,
          },
        );
      }
    }

    return AgentCatalogResultSchema.parse({
      systemAgents: [...systemProfiles.values()].sort((left, right) => left.label.localeCompare(right.label)),
      customAgents: this.listAgents().map((agent) => CustomAgentCatalogItemSchema.parse({
        ...agent,
        source: "custom",
        usages: customUsages.get(agent.name) ?? [],
      })),
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
    return new Set(
      this.modeStore.list()
        .filter((mode) => mode.systemPreset)
        .flatMap((mode) => mode.profiles.map((profile) => profile.id)),
    );
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
    const resolved = await this.resolveModeSelection(parsed.config, input, session);
    const fullConfig = this.withMemoryPrompt(resolved.fullConfig);
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
      const finalSnapshot = this.attachTraceMetadata(snapshot);
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
      liveSnapshot = this.attachTraceMetadata(failure.snapshot);
      await this.persistRunWithGeneratedTitle(liveSnapshot);
      publishStream([failure.event], liveSnapshot);
    });

    return this.toRunHandle(liveSnapshot);
  }

  private approvedFileWriteResumeActions(snapshot: StateSnapshot, approvedActionIds: string[]): ActionRecord[] {
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

  private async completeApprovedFileWriteResume(
    snapshot: StateSnapshot,
    approvedActionIds: string[],
    params: { reason?: string; patch?: unknown } = {},
    onEvent?: (event: OraEventEnvelope, snapshot: StateSnapshot) => void,
  ): Promise<StateSnapshot | undefined> {
    const approvedFileWrites = this.approvedFileWriteResumeActions(snapshot, approvedActionIds);
    if (approvedFileWrites.length === 0) {
      return undefined;
    }
    const writeResults: Array<{ path?: unknown; sizeBytes?: unknown; content?: unknown }> = [];

    const executor = new RuntimeToolExecutor({
      workspace: snapshot.input.context?.projectWorkspace,
      toolDescriptors: new RuntimeToolRegistry().list(),
      skillRegistry: this.skillRegistry,
      searchProviderConfig: snapshot.config.searchProvider,
    });

    let working = StateSnapshotSchema.parse({
      ...snapshot,
      status: "running",
      pendingApprovals: snapshot.pendingApprovals.filter((actionId) => !approvedActionIds.includes(actionId)),
      updatedAt: this.now(),
    });
    const append = (type: OraEventEnvelope["type"], payload: unknown, base: StateSnapshot = working) => {
      working = this.appendEvent(base, type, payload);
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
      const updatedAt = this.now();
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
        return this.attachTraceMetadata(StateSnapshotSchema.parse({
          ...working,
          status: "failed",
          error: detail,
          activeAgents: [],
          updatedAt: this.now(),
        }));
      }
    }

    const finalText = await this.finalTextForApprovedFileWriteResume(snapshot, writeResults);
    append("message.delta", { role: "assistant", content: finalText });
    const output = { text: finalText };
    append("run.done", { status: "succeeded", output });
    return this.attachTraceMetadata(StateSnapshotSchema.parse({
      ...working,
      status: "succeeded",
      pendingApprovals: [],
      activeAgents: [],
      output,
      updatedAt: this.now(),
    }));
  }

  private async finalTextForApprovedFileWriteResume(
    snapshot: StateSnapshot,
    writeResults: Array<{ path?: unknown; sizeBytes?: unknown; content?: unknown }>,
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
        ? this.buildConversationMessages(snapshot.sessionId, snapshot.input.prompt, snapshot.runId)
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
      return this.toRunHandle(resumed);
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

    if (this.approvedFileWriteResumeActions(snapshot, approvedActionIds).length > 0) {
      void this.completeApprovedFileWriteResume(
        snapshot,
        approvedActionIds,
        { reason: parsed.reason, patch: parsed.patch },
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
        liveSnapshot = this.attachTraceMetadata(failure.snapshot);
        await this.persistRunWithGeneratedTitle(liveSnapshot);
        publishStream([failure.event], liveSnapshot);
      });
      return this.toRunHandle(liveSnapshot);
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
      const finalSnapshot = this.attachTraceMetadata(nextSnapshot);
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
      liveSnapshot = this.attachTraceMetadata(failure.snapshot);
      await this.persistRunWithGeneratedTitle(liveSnapshot);
      publishStream([failure.event], liveSnapshot);
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
      systemAgentOverlays: this.systemAgentOverlaysForMode(modeSpec),
      customAgentContexts: this.customAgentContextsForMode(modeSpec),
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
    const { clarificationPatch, approvedActionIds } = parseResumePatch(parsed.patch);
    const approvedActions = approvedActionsForResume(snapshot, approvedActionIds);
    const completedApprovedFileWrite = await this.completeApprovedFileWriteResume(
      snapshot,
      approvedActionIds,
      { reason: parsed.reason, patch: parsed.patch },
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
      const tracedSnapshot = this.attachTraceMetadata(resumedSnapshot);
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
    const modeSpec = this.applySystemAgentOverridesToMode(this.modeStore.resolve(requestedModeId, parsed.pattern));
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
    const modeSpec = this.applySystemAgentOverridesToMode(this.modeStore.resolve(requestedModeId, config.pattern));
    return {
      ...modeSpec.memoryPolicy,
      enabled: modeSpec.memoryPolicy.enabled && modeSpec.runtimeAtoms.includes("long_term_memory"),
      updaterProviderId: modeSpec.memoryPolicy.updaterProviderId ?? config.providerId,
    };
  }

  private transitionRun(
    snapshot: StateSnapshot,
    status: StateSnapshot["status"],
    type: "run.interrupted" | "run.cancelled",
    payload: unknown
  ): StateSnapshot {
    const withEvent = this.appendEvent(snapshot, type, payload);
    const updated = StateSnapshotSchema.parse(status === "cancelled"
      ? cancelledRunSnapshot({
          snapshot: withEvent,
          payload,
          updatedAt: this.now(),
          defaultReason: USER_CANCELLED_MESSAGE,
        })
      : {
          ...withEvent,
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
      archivedAt: existing?.archivedAt,
    });
  }

  private defaultSessionTitle(prompt: string): string {
    const trimmed = prompt.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 120) : DEFAULT_SESSION_TITLE;
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

export function defaultRuntimeStoreDir(): string {
  return fileURLToPath(pathToFileURL(path.join(process.cwd(), ".ora", "runtime.db")));
}

function explicitSystemAgentModelRef(modelRef: string | undefined): string | undefined {
  return modelRef === "local/smoke-model" ? undefined : modelRef;
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

export function defaultSystemAgentOverridesDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "agent-overrides")
    : path.join(runtimeDataDir, "agent-overrides");
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
