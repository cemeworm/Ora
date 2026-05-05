import type {
  ActionRecord as OraActionRecord,
  AgentCatalogResult as OraAgentCatalogResult,
  AgentProfile as OraAgentProfile,
  Automation as OraAutomation,
  AutomationCreateParams as OraAutomationCreateParams,
  AutomationPreviewScheduleParams as OraAutomationPreviewScheduleParams,
  AutomationPreviewScheduleResult as OraAutomationPreviewScheduleResult,
  AutomationRunRecord as OraAutomationRunRecord,
  AutomationSchedule as OraAutomationSchedule,
  AutomationUpdateParams as OraAutomationUpdateParams,
  ArtifactRef as OraArtifactRef,
  CheckpointMeta as OraCheckpointMeta,
  ChannelConfig as OraChannelConfig,
  ChannelKind as OraChannelKind,
  ChannelCreateParams as OraChannelCreateParams,
  ChannelStatusResult as OraChannelStatusResult,
  ChannelUpdateParams as OraChannelUpdateParams,
  CoordinationPattern,
  CustomAgentCheckNameResult as OraCustomAgentCheckNameResult,
  CustomAgentCreateParams as OraCustomAgentCreateParams,
  CustomAgentDetail as OraCustomAgentDetail,
  CustomAgentGenerateDraftParams as OraCustomAgentGenerateDraftParams,
  CustomAgentGenerateDraftResult as OraCustomAgentGenerateDraftResult,
  CustomAgentSummary as OraCustomAgentSummary,
  CustomAgentUpdateParams as OraCustomAgentUpdateParams,
  EvaluationBaseline as OraEvaluationBaseline,
  EvaluationAnnotationTask as OraEvaluationAnnotationTask,
  EvaluationBlueprint as OraEvaluationBlueprint,
  EvaluationBlueprintCompileResult as OraEvaluationBlueprintCompileResult,
  EvaluationBlueprintCreateParams as OraEvaluationBlueprintCreateParams,
  EvaluationBlueprintGenerateDraftParams as OraEvaluationBlueprintGenerateDraftParams,
  EvaluationBlueprintListParams as OraEvaluationBlueprintListParams,
  EvaluationBlueprintPlanTurnResult as OraEvaluationBlueprintPlanTurnResult,
  EvaluationBlueprintUpdateParams as OraEvaluationBlueprintUpdateParams,
  EvaluationCaseResult as OraEvaluationCaseResult,
  EvaluationDataset as OraEvaluationDataset,
  EvaluationDatasetDetail as OraEvaluationDatasetDetail,
  EvaluationExportResult as OraEvaluationExportResult,
  EvaluationFeedbackRecord as OraEvaluationFeedbackRecord,
  EvaluationRun as OraEvaluationRun,
  EvaluationRunDetail as OraEvaluationRunDetail,
  EvaluationRunStream as OraEvaluationRunStream,
  EvaluationSpec as OraEvaluationSpec,
  FeedbackLoopActionResult as OraFeedbackLoopActionResult,
  FeedbackLoopCalibrationRule as OraFeedbackLoopCalibrationRule,
  JsonRpcRequest,
  JsonRpcResponse,
  LongTermMemoryProfile as OraLongTermMemoryProfile,
  MemoryRecord as OraMemoryRecord,
  ModeStudioApplyDraftParams as OraModeStudioApplyDraftParams,
  ModeStudioApplyDraftResult as OraModeStudioApplyDraftResult,
  ModeStudioBuilderResult as OraModeStudioBuilderResult,
  ModeStudioContextResult as OraModeStudioContextResult,
  ModeStudioDraftBundle as OraModeStudioDraftBundle,
  ModeStudioGenerateDraftParams as OraModeStudioGenerateDraftParams,
  ModeStudioRefineDraftParams as OraModeStudioRefineDraftParams,
  ModeStudioStartBuilderRunParams as OraModeStudioStartBuilderRunParams,
  ModeRuntimeAtomDefinition as OraModeRuntimeAtomDefinition,
  ModeCreateParams as OraModeCreateParams,
  ModeSpec as OraModeSpec,
  ModeUpdateParams as OraModeUpdateParams,
  ModeValidationResult as OraModeValidationResult,
  ModeSelection as OraModeSelection,
  PackageBuildCandidateParams as OraPackageBuildCandidateParams,
  PackageManifest as OraPackageManifest,
  PackageStoreSnapshot as OraPackageStoreSnapshot,
  OraEventEnvelope,
  PatternDefinition as OraPatternDefinition,
  PlanItem as OraPlanItem,
  ProjectInsight as OraProjectInsight,
  ProjectSignal as OraProjectSignal,
  ProjectCreateParams as OraProjectCreateParams,
  ProjectDetail as OraProjectDetail,
  ProjectFileEntry as OraProjectFileEntry,
  ProjectFileReadResult as OraProjectFileReadResult,
  ProjectFilesResult as OraProjectFilesResult,
  ProjectSummary as OraProjectSummary,
  ProviderConfig as OraProviderConfig,
  ProviderModelsResult as OraProviderModelsResult,
  ProviderRegistry as OraProviderRegistry,
  ProviderSecretStatus as OraProviderSecretStatus,
  ProviderStatus as OraProviderStatus,
  RunTraceMetadata as OraRunTraceMetadata,
  RuntimeBootstrap as OraRuntimeBootstrap,
  SelfIterationCandidate as OraSelfIterationCandidate,
  SelfIterationPolicy as OraSelfIterationPolicy,
  SelfIterationScanResult as OraSelfIterationScanResult,
  RunConfig as OraRunConfig,
  RunAttention as OraRunAttention,
  RunEventStream as OraRunEventStream,
  RunHandle as OraRunHandle,
  RuntimeMaintenanceParams as OraRuntimeMaintenanceParams,
  RuntimeMaintenanceResult as OraRuntimeMaintenanceResult,
  RunTrail as OraRunTrail,
  RunTrailMetrics as OraRunTrailMetrics,
  SessionCreateParams as OraSessionCreateParams,
  SessionBranchGroup as OraSessionBranchGroup,
  SessionBranchGroupCreateParams as OraSessionBranchGroupCreateParams,
  SessionBranchGroupAdoptParams as OraSessionBranchGroupAdoptParams,
  SessionBranchGroupDismissParams as OraSessionBranchGroupDismissParams,
  SessionBranchGroupGetParams as OraSessionBranchGroupGetParams,
  SessionBranchGroupListParams as OraSessionBranchGroupListParams,
  SessionDetail as OraSessionDetail,
  SessionPlanDecisionResolveParams as OraSessionPlanDecisionResolveParams,
  SessionSummary as OraSessionSummary,
  SessionTranscriptMessage as OraSessionTranscriptMessage,
  SessionTurn as OraSessionTurn,
  SkillCheckNameResult as OraSkillCheckNameResult,
  SkillCreateParams as OraSkillCreateParams,
  SkillDetail as OraSkillDetail,
  SkillPackageFileContent as OraSkillPackageFileContent,
  SkillRegistry as OraSkillRegistry,
  SkillSetEnabledParams as OraSkillSetEnabledParams,
  SkillUpdateParams as OraSkillUpdateParams,
  StateSnapshot as OraStateSnapshot,
  SystemAgentOverride as OraSystemAgentOverride,
  SystemAgentOverrideUpdateParams as OraSystemAgentOverrideUpdateParams,
  TodoItem as OraTodoItem,
  TopologyEdge as OraTopologyEdge,
  TopologyNode as OraTopologyNode,
  TrailGenerationRef as OraTrailGenerationRef,
  TrailObservation as OraTrailObservation,
  ToolRegistry as OraToolRegistry,
  UserTaskInput as OraUserTaskInput,
} from "@cemeworm/shared";
import { AutomationCreateParamsSchema, AutomationPreviewScheduleParamsSchema, AutomationSchema, AutomationUpdateParamsSchema, DEFAULT_AGENT_MODE_TOOL_IDS, DEFAULT_PROVIDERS, DEBATE_MODE_ID, FeedbackLoopActionApplyParamsSchema, FeedbackLoopActionResultSchema, FeedbackLoopCalibrationRuleSchema, FeedbackLoopRuleUpdateParamsSchema, LongTermMemoryProfileSchema, MVP_MODE_RUNTIME_ATOMS, MVP_MODES, MVP_PATTERNS, MVP_SKILLS, MVP_TOOLS, ORA_HOST_ABI_VERSION, ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL, ORA_RUNTIME_ABI_VERSION, ProjectInsightSchema, ProjectSignalSchema, ProviderConfigSchema, SINGLE_AGENT_MODE_ID, SYSTEM_AGENT_ID_ALIASES, SelfIterationCandidateApplyParamsSchema, SelfIterationCandidateSchema, SelfIterationPolicySchema, SelfIterationScanResultSchema, SystemAgentOverrideUpdateParamsSchema, canonicalSystemAgentId, deriveRunAttention, deriveSessionBranchGroupsForSession, legacySystemAgentIdsFor, modeSpecToPatternDefinition, snapshotContainsCompleteProposedPlan, validateModeSpec } from "@cemeworm/shared";
import { PROVIDER_PRESETS } from "./providerPresets";

export const USER_CANCELLED_MESSAGE = "Stopped processing as instructed.";
export const USER_INTERRUPTED_MESSAGE = "Paused as instructed.";
export const USER_RESUMED_MESSAGE = "Confirmed. Continuing.";

export type {
  OraActionRecord,
  OraAgentCatalogResult,
  OraAgentProfile,
  OraAutomation,
  OraAutomationCreateParams,
  OraAutomationPreviewScheduleParams,
  OraAutomationPreviewScheduleResult,
  OraAutomationRunRecord,
  OraAutomationSchedule,
  OraAutomationUpdateParams,
  OraArtifactRef,
  OraCheckpointMeta,
  OraChannelConfig,
  OraChannelCreateParams,
  OraChannelStatusResult,
  OraChannelUpdateParams,
  OraCustomAgentCheckNameResult,
  OraCustomAgentCreateParams,
  OraCustomAgentDetail,
  OraCustomAgentGenerateDraftParams,
  OraCustomAgentGenerateDraftResult,
  OraCustomAgentSummary,
  OraCustomAgentUpdateParams,
  OraEvaluationBaseline,
  OraEvaluationAnnotationTask,
  OraEvaluationBlueprint,
  OraEvaluationBlueprintCompileResult,
  OraEvaluationBlueprintCreateParams,
  OraEvaluationBlueprintGenerateDraftParams,
  OraEvaluationBlueprintListParams,
  OraEvaluationBlueprintPlanTurnResult,
  OraEvaluationBlueprintUpdateParams,
  OraEvaluationCaseResult,
  OraEvaluationDataset,
  OraEvaluationDatasetDetail,
  OraEvaluationExportResult,
  OraEvaluationFeedbackRecord,
  OraEvaluationRun,
  OraEvaluationRunDetail,
  OraEvaluationRunStream,
  OraEvaluationSpec,
  OraFeedbackLoopActionResult,
  OraFeedbackLoopCalibrationRule,
  OraEventEnvelope,
  OraLongTermMemoryProfile,
  OraMemoryRecord,
  OraModeStudioApplyDraftParams,
  OraModeStudioApplyDraftResult,
  OraModeStudioBuilderResult,
  OraModeStudioContextResult,
  OraModeStudioDraftBundle,
  OraModeStudioGenerateDraftParams,
  OraModeStudioRefineDraftParams,
  OraModeStudioStartBuilderRunParams,
  OraModeRuntimeAtomDefinition,
  OraModeCreateParams,
  OraModeSpec,
  OraModeUpdateParams,
  OraModeValidationResult,
  OraPackageBuildCandidateParams,
  OraPackageManifest,
  OraPackageStoreSnapshot,
  OraPatternDefinition,
  OraProviderConfig,
  OraProviderModelsResult,
  OraProviderRegistry,
  OraProviderSecretStatus,
  OraProviderStatus,
  OraPlanItem,
  OraProjectInsight,
  OraProjectSignal,
  OraProjectCreateParams,
  OraProjectDetail,
  OraProjectFileEntry,
  OraProjectFileReadResult,
  OraProjectFilesResult,
  OraProjectSummary,
  OraRunConfig,
  OraRunAttention,
  OraRunEventStream,
  OraRunHandle,
  OraRuntimeMaintenanceParams,
  OraRuntimeMaintenanceResult,
  OraRunTraceMetadata,
  OraRunTrail,
  OraRunTrailMetrics,
  OraSelfIterationCandidate,
  OraSelfIterationPolicy,
  OraSelfIterationScanResult,
  OraSessionBranchGroup,
  OraSessionBranchGroupCreateParams,
  OraSessionBranchGroupAdoptParams,
  OraSessionBranchGroupDismissParams,
  OraSessionBranchGroupGetParams,
  OraSessionBranchGroupListParams,
  OraSessionCreateParams,
  OraSessionPlanDecisionResolveParams,
  OraSessionDetail,
  OraSessionSummary,
  OraSessionTranscriptMessage,
  OraSessionTurn,
  OraSkillCheckNameResult,
  OraSkillCreateParams,
  OraSkillDetail,
  OraSkillPackageFileContent,
  OraStateSnapshot,
  OraSystemAgentOverride,
  OraSystemAgentOverrideUpdateParams,
  OraTodoItem,
  OraToolRegistry,
  OraSkillRegistry,
  OraSkillSetEnabledParams,
  OraSkillUpdateParams,
  OraTopologyEdge,
  OraTopologyNode,
  OraTrailGenerationRef,
  OraTrailObservation,
  OraUserTaskInput,
};

export interface RuntimeHealth {
  ok: boolean;
  mode: "tauri" | "browser_mock" | "unavailable" | "error";
  service: string;
  detail: string;
}

export interface RuntimeBootstrap {
  health: RuntimeHealth;
  patterns: OraPatternDefinition[];
  modes: OraModeSpec[];
  atoms: OraModeRuntimeAtomDefinition[];
  providerRegistry: OraProviderRegistry;
  toolRegistry: OraToolRegistry;
  packageStore: OraPackageStoreSnapshot;
  skillRegistry: OraSkillRegistry;
  providerSecretStatuses: OraProviderSecretStatus[];
  providerStatuses: OraProviderStatus[];
}

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };
const CUSTOM_PROVIDER_STORAGE_KEY = "ora.customProviders.v1";
export const RUN_EVENT_NOTIFICATION = "ora://runtime/run-event";
export const CHANNEL_SESSION_UPDATED_NOTIFICATION = "ora://runtime/channel-session-updated";
let sharedRuntimeClient: ReturnType<typeof createRuntimeClient> | undefined;

export interface OraChannelSessionUpdate {
  channelId: string;
  channelKind: string;
  bindingId: string;
  sessionId: string;
  runId?: string;
  inboundMessageId: string;
  deliveryId?: string;
}

export function createRuntimeClient() {
  const local = new LocalJsonRpcRuntime();
  let requestId = 1;
  let lastHealth: RuntimeHealth | undefined;
  let processBridgeEnabled = false;
  let tauriUnavailableReason = "Runtime sidecar is unavailable.";
  let managedLangfuseDetail: string | undefined;

  async function call<T>(method: string, params?: unknown): Promise<T> {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: requestId++,
      method,
      params,
    };

    const tauriAvailable = isTauriAvailable();
    const tauriResponse = tauriAvailable
      ? await tryTauriJsonRpc(request)
      : { ok: false as const, tauriAvailable };
    if (tauriResponse.ok) {
      lastHealth = {
        ok: true,
        mode: "tauri",
        service: "ora-runtime",
        detail: processBridgeEnabled
          ? compactDetails([
            "Tauri command bridge is serving Ora JSON-RPC.",
            managedLangfuseDetail,
          ])
          : tauriUnavailableReason,
      };
      if (method.startsWith("channels.wechat")) {
        console.warn("[ora:debug] channels.wechat response (tauri ok):", JSON.stringify(tauriResponse.response));
      }
      return unwrapJsonRpc<T>(tauriResponse.response);
    }

    if (tauriAvailable) {
      lastHealth = {
        ok: false,
        mode: "unavailable",
        service: "ora-runtime",
        detail: tauriUnavailableReason,
      };
      if (method.startsWith("channels.wechat")) {
        console.warn("[ora:debug] channels.wechat tauri failed:", tauriUnavailableReason, tauriResponse);
      }
      throw new Error(tauriUnavailableReason);
    }

    const response = await local.handle(request);
    lastHealth = {
      ok: true,
      mode: "browser_mock",
      service: "ora-runtime-mock",
      detail: "Browser dev fallback is serving deterministic Ora JSON-RPC.",
    };
    if (method.startsWith("channels.wechat")) {
      console.warn("[ora:debug] channels.wechat response (mock):", JSON.stringify(response));
    }
    return unwrapJsonRpc<T>(response);
  }

  return {
    async bootstrap(): Promise<RuntimeBootstrap> {
      const sidecarStatus = await readTauriSidecarStatus();
      processBridgeEnabled = Boolean(sidecarStatus?.process_spawn_available);
      managedLangfuseDetail = formatManagedLangfuseStatus(sidecarStatus);
      tauriUnavailableReason = sidecarStatus
        ? compactDetails([
          String(sidecarStatus.reason ?? "Runtime sidecar process bridge is unavailable."),
          managedLangfuseDetail,
        ])
        : "Runtime sidecar process bridge is unavailable.";

      if (isTauriAvailable() && !processBridgeEnabled) {
        const patterns = await call<OraPatternDefinition[]>("patterns.list");
        const providerRegistry = mergeCustomProviders(await call<OraProviderRegistry>("providers.list"));
        const providerSecretStatuses = await getProviderSecretStatuses(providerRegistry.providers);
        const providerStatuses = deriveProviderStatuses(providerRegistry.providers, providerSecretStatuses);
        return {
          health: lastHealth ?? {
            ok: true,
            mode: "tauri",
            service: "ora-runtime",
            detail: tauriUnavailableReason,
          },
          patterns,
          modes: MVP_MODES.filter((mode) => mode.visibility !== "internal"),
          atoms: MVP_MODE_RUNTIME_ATOMS,
          providerRegistry,
          toolRegistry: { tools: MVP_TOOLS, defaultPolicyId: "runtime.default_policy" },
          packageStore: await call<OraPackageStoreSnapshot>("packages.active"),
          skillRegistry: { skills: MVP_SKILLS },
          providerSecretStatuses,
          providerStatuses,
        };
      }

      const bootstrap = await call<OraRuntimeBootstrap>("runtime.bootstrap");
      const providerRegistry = mergeCustomProviders(bootstrap.providers);
      const providerSecretStatuses = await getProviderSecretStatuses(providerRegistry.providers);
      const providerStatuses = deriveProviderStatuses(providerRegistry.providers, providerSecretStatuses);

      return {
        health: lastHealth ?? {
          ok: bootstrap.health.ok,
          mode: "browser_mock",
          service: bootstrap.health.service,
          detail: sidecarStatus
            ? String(sidecarStatus.reason ?? bootstrap.health.detail)
            : "Browser dev fallback is serving deterministic Ora JSON-RPC.",
        },
        patterns: bootstrap.patterns,
        modes: bootstrap.modes,
        atoms: bootstrap.atoms,
        providerRegistry,
        toolRegistry: bootstrap.tools,
        packageStore: bootstrap.packages ?? await call<OraPackageStoreSnapshot>("packages.active"),
        skillRegistry: bootstrap.skills,
        providerSecretStatuses,
        providerStatuses,
      };
    },
    async createSession(params: OraSessionCreateParams = {}): Promise<OraSessionSummary> {
      return call<OraSessionSummary>("sessions.create", params);
    },
    async listChannels(params: { kind?: string; enabled?: boolean; limit?: number } = {}): Promise<OraChannelConfig[]> {
      return call<OraChannelConfig[]>("channels.list", params);
    },
    async createChannel(params: OraChannelCreateParams): Promise<OraChannelConfig> {
      return call<OraChannelConfig>("channels.create", params);
    },
    async updateChannel(params: OraChannelUpdateParams): Promise<OraChannelConfig> {
      return call<OraChannelConfig>("channels.update", params);
    },
    async deleteChannel(channelId: string): Promise<{ deleted: true; channelId: string }> {
      return call<{ deleted: true; channelId: string }>("channels.delete", { channelId });
    },
    async channelStatus(): Promise<OraChannelStatusResult> {
      return call<OraChannelStatusResult>("channels.status");
    },
    async listAutomations(params: { includePaused?: boolean } = {}): Promise<OraAutomation[]> {
      return call<OraAutomation[]>("automations.list", params);
    },
    async getAutomation(id: string): Promise<OraAutomation> {
      return call<OraAutomation>("automations.get", { id });
    },
    async createAutomation(params: OraAutomationCreateParams): Promise<OraAutomation> {
      return call<OraAutomation>("automations.create", params);
    },
    async updateAutomation(params: OraAutomationUpdateParams): Promise<OraAutomation> {
      return call<OraAutomation>("automations.update", params);
    },
    async deleteAutomation(id: string): Promise<{ deleted: true; id: string }> {
      return call<{ deleted: true; id: string }>("automations.delete", { id });
    },
    async pauseAutomation(id: string): Promise<OraAutomation> {
      return call<OraAutomation>("automations.pause", { id });
    },
    async resumeAutomation(id: string): Promise<OraAutomation> {
      return call<OraAutomation>("automations.resume", { id });
    },
    async runAutomationNow(id: string): Promise<OraAutomationRunRecord> {
      return call<OraAutomationRunRecord>("automations.runNow", { id });
    },
    async previewAutomationSchedule(params: OraAutomationPreviewScheduleParams): Promise<OraAutomationPreviewScheduleResult> {
      return call<OraAutomationPreviewScheduleResult>("automations.previewSchedule", params);
    },
    async wechatRequestQrCode(channelId: string): Promise<{ base64: string; qrcode: string; mimeType?: string; imageSrc?: string; pageSrc?: string }> {
      return call<{ base64: string; qrcode: string; mimeType?: string; imageSrc?: string; pageSrc?: string }>("channels.wechat.requestQrCode", { channelId });
    },
    async wechatPollQrCodeStatus(channelId: string): Promise<{
      status: string;
      botToken?: string;
      baseUrl?: string;
    }> {
      return call<{
        status: string;
        botToken?: string;
        baseUrl?: string;
      }>("channels.wechat.pollQrCodeStatus", { channelId });
    },
    async createProject(params: OraProjectCreateParams): Promise<OraProjectSummary> {
      return call<OraProjectSummary>("projects.create", params);
    },
    async listProjects(): Promise<OraProjectSummary[]> {
      return call<OraProjectSummary[]>("projects.list");
    },
    async getProject(projectId: string): Promise<OraProjectDetail> {
      return call<OraProjectDetail>("projects.get", { projectId });
    },
    async listProjectFiles(projectId: string): Promise<OraProjectFilesResult> {
      return call<OraProjectFilesResult>("projects.files", { projectId });
    },
    async readProjectFile(projectId: string, path: string): Promise<OraProjectFileReadResult> {
      return call<OraProjectFileReadResult>("projects.file.read", { projectId, path });
    },
    async listPackages(): Promise<OraPackageStoreSnapshot> {
      return call<OraPackageStoreSnapshot>("packages.list");
    },
    async activePackage(): Promise<OraPackageStoreSnapshot> {
      return call<OraPackageStoreSnapshot>("packages.active");
    },
    async buildPackageCandidate(params: Partial<OraPackageBuildCandidateParams> = {}): Promise<OraPackageManifest> {
      return call<OraPackageManifest>("packages.buildCandidate", params);
    },
    async verifyPackage(versionId: string): Promise<OraPackageManifest> {
      return call<OraPackageManifest>("packages.verify", { versionId });
    },
    async promotePackage(versionId: string): Promise<OraPackageStoreSnapshot> {
      return call<OraPackageStoreSnapshot>("packages.promote", { versionId });
    },
    async switchPackage(versionId: string): Promise<OraPackageStoreSnapshot> {
      return call<OraPackageStoreSnapshot>("packages.switch", { versionId });
    },
    async rollbackPackage(): Promise<OraPackageStoreSnapshot> {
      return call<OraPackageStoreSnapshot>("packages.rollback");
    },
    async prunePackages(includeFailed = true): Promise<OraPackageStoreSnapshot> {
      return call<OraPackageStoreSnapshot>("packages.prune", { includeFailed });
    },
    async listSessions(): Promise<OraSessionSummary[]> {
      return call<OraSessionSummary[]>("sessions.list");
    },
    async archiveSession(sessionId: string): Promise<OraSessionSummary> {
      return call<OraSessionSummary>("sessions.archive", { sessionId });
    },
    async listSessionBranchGroups(params: OraSessionBranchGroupListParams): Promise<OraSessionBranchGroup[]> {
      return call<OraSessionBranchGroup[]>("sessions.branchGroups.list", params);
    },
    async getSessionBranchGroup(params: OraSessionBranchGroupGetParams): Promise<OraSessionBranchGroup> {
      return call<OraSessionBranchGroup>("sessions.branchGroups.get", params);
    },
    async createAndRunSessionBranchGroup(params: OraSessionBranchGroupCreateParams): Promise<OraSessionBranchGroup> {
      return call<OraSessionBranchGroup>("sessions.branchGroups.createAndRun", params);
    },
    async adoptSessionBranchGroup(params: OraSessionBranchGroupAdoptParams): Promise<OraSessionDetail> {
      return call<OraSessionDetail>("sessions.branchGroups.adopt", params);
    },
    async dismissSessionBranchGroup(params: OraSessionBranchGroupDismissParams): Promise<OraSessionBranchGroup> {
      return call<OraSessionBranchGroup>("sessions.branchGroups.dismiss", params);
    },
    async resolvePlanDecision(params: OraSessionPlanDecisionResolveParams): Promise<OraSessionDetail> {
      return call<OraSessionDetail>("sessions.resolvePlanDecision", params);
    },
    async importEvaluationDataset(params: {
      name?: string;
      description?: string;
      sourceFileName?: string;
      sourceFormat?: "json" | "jsonl" | "csv" | "inline";
      content: string;
      tags?: string[];
    }): Promise<OraEvaluationDatasetDetail> {
      return call<OraEvaluationDatasetDetail>("evaluation.datasets.import", params);
    },
    async listEvaluationDatasets(): Promise<OraEvaluationDataset[]> {
      return call<OraEvaluationDataset[]>("evaluation.datasets.list");
    },
    async getEvaluationDataset(datasetId: string): Promise<OraEvaluationDatasetDetail> {
      return call<OraEvaluationDatasetDetail>("evaluation.datasets.get", { datasetId });
    },
    async createEvaluationBlueprint(params: OraEvaluationBlueprintCreateParams): Promise<OraEvaluationBlueprint> {
      return call<OraEvaluationBlueprint>("evaluation.blueprints.create", params);
    },
    async updateEvaluationBlueprint(params: OraEvaluationBlueprintUpdateParams): Promise<OraEvaluationBlueprint> {
      return call<OraEvaluationBlueprint>("evaluation.blueprints.update", params);
    },
    async listEvaluationBlueprints(params: OraEvaluationBlueprintListParams = {}): Promise<OraEvaluationBlueprint[]> {
      return call<OraEvaluationBlueprint[]>("evaluation.blueprints.list", params);
    },
    async getEvaluationBlueprint(blueprintId: string): Promise<OraEvaluationBlueprint> {
      return call<OraEvaluationBlueprint>("evaluation.blueprints.get", { blueprintId });
    },
    async compileEvaluationBlueprint(params: { blueprintId?: string; blueprint?: OraEvaluationBlueprint; datasetId?: string; providerId?: string; modelRef?: string; modeIds?: string[] }): Promise<OraEvaluationBlueprintCompileResult> {
      return call<OraEvaluationBlueprintCompileResult>("evaluation.blueprints.compile", params);
    },
    async generateEvaluationBlueprintDraft(params: OraEvaluationBlueprintGenerateDraftParams): Promise<OraEvaluationBlueprint> {
      return call<OraEvaluationBlueprint>("evaluation.blueprints.generateDraft", params);
    },
    async planEvaluationBlueprintTurn(params: { blueprintId?: string; message: string; providerId?: string; modelRef?: string }): Promise<OraEvaluationBlueprintPlanTurnResult> {
      return call<OraEvaluationBlueprintPlanTurnResult>("evaluation.blueprints.planTurn", params);
    },
    async startEvaluationRun(spec: OraEvaluationSpec): Promise<OraEvaluationRunDetail> {
      return call<OraEvaluationRunDetail>("evaluation.runs.start", spec);
    },
    async listEvaluationRuns(params: { datasetId?: string; profileId?: "outcome" | "orchestration" | "task_completion" } = {}): Promise<OraEvaluationRun[]> {
      return call<OraEvaluationRun[]>("evaluation.runs.list", params);
    },
    async getEvaluationRun(evaluationRunId: string): Promise<OraEvaluationRunDetail> {
      return call<OraEvaluationRunDetail>("evaluation.runs.get", { evaluationRunId });
    },
    async streamEvaluationRun(evaluationRunId: string, afterSeq?: number): Promise<OraEvaluationRunStream> {
      return call<OraEvaluationRunStream>("evaluation.runs.stream", { evaluationRunId, afterSeq });
    },
    async listEvaluationBaselines(params: { datasetId?: string; profileId?: "outcome" | "orchestration" | "task_completion" } = {}): Promise<OraEvaluationBaseline[]> {
      return call<OraEvaluationBaseline[]>("evaluation.baselines.list", params);
    },
    async promoteEvaluationBaseline(evaluationRunId: string, configId: string, name?: string): Promise<OraEvaluationBaseline> {
      return call<OraEvaluationBaseline>("evaluation.runs.promoteBaseline", { evaluationRunId, configId, name });
    },
    async exportEvaluationRun(evaluationRunId: string, format: "json" | "csv"): Promise<OraEvaluationExportResult> {
      return call<OraEvaluationExportResult>("evaluation.runs.export", { evaluationRunId, format });
    },
    async submitEvaluationFeedback(params: {
      runId: string;
      sessionId?: string;
      turnIndex?: number;
      messageId?: string;
      feedbackText: string;
    }): Promise<OraEvaluationFeedbackRecord> {
      return call<OraEvaluationFeedbackRecord>("evaluation.feedback.submit", params);
    },
    async listEvaluationFeedback(params: { status?: "pending" | "accepted" | "rejected" | "failed"; limit?: number } = {}): Promise<OraEvaluationFeedbackRecord[]> {
      return call<OraEvaluationFeedbackRecord[]>("evaluation.feedback.list", params);
    },
    async getEvaluationFeedback(feedbackId: string): Promise<OraEvaluationFeedbackRecord> {
      return call<OraEvaluationFeedbackRecord>("evaluation.feedback.get", { feedbackId });
    },
    async updateEvaluationFeedback(params: {
      feedbackId: string;
      feedbackText?: string;
      draftCase?: OraEvaluationFeedbackRecord["draft"]["case"];
      curatorRationale?: string;
    }): Promise<OraEvaluationFeedbackRecord> {
      return call<OraEvaluationFeedbackRecord>("evaluation.feedback.update", params);
    },
    async acceptEvaluationFeedback(feedbackId: string, datasetId?: string): Promise<OraEvaluationFeedbackRecord> {
      return call<OraEvaluationFeedbackRecord>("evaluation.feedback.accept", { feedbackId, datasetId });
    },
    async rejectEvaluationFeedback(feedbackId: string, reason?: string): Promise<OraEvaluationFeedbackRecord> {
      return call<OraEvaluationFeedbackRecord>("evaluation.feedback.reject", { feedbackId, reason });
    },
    async listEvaluationAnnotations(params: { status?: "pending" | "submitted"; runId?: string; limit?: number } = {}): Promise<OraEvaluationAnnotationTask[]> {
      return call<OraEvaluationAnnotationTask[]>("evaluation.annotations.list", params);
    },
    async submitEvaluationAnnotation(params: {
      taskId: string;
      score: { value: boolean | number | string; normalizedScore?: number; passed?: boolean; failureTags?: string[] };
      comment?: string;
      correctedOutput?: unknown;
    }): Promise<OraEvaluationAnnotationTask> {
      return call<OraEvaluationAnnotationTask>("evaluation.annotations.submit", params);
    },
    async listProjectSignals(params: { projectId?: string; source?: string; severity?: string; limit?: number } = {}): Promise<OraProjectSignal[]> {
      return call<OraProjectSignal[]>("feedbackLoop.signals.list", params);
    },
    async listProjectInsights(params: { projectId?: string; status?: "open" | "dismissed" | "applied"; limit?: number } = {}): Promise<OraProjectInsight[]> {
      return call<OraProjectInsight[]>("feedbackLoop.insights.list", params);
    },
    async getProjectInsight(insightId: string): Promise<OraProjectInsight> {
      return call<OraProjectInsight>("feedbackLoop.insights.get", { insightId });
    },
    async dismissProjectInsight(insightId: string, reason?: string): Promise<OraProjectInsight> {
      return call<OraProjectInsight>("feedbackLoop.insights.dismiss", { insightId, reason });
    },
    async previewProjectSignalAction(insightId: string, actionId: string): Promise<OraFeedbackLoopActionResult> {
      return call<OraFeedbackLoopActionResult>("feedbackLoop.actions.preview", { insightId, actionId });
    },
    async applyProjectSignalAction(insightId: string, actionId: string): Promise<OraFeedbackLoopActionResult> {
      return call<OraFeedbackLoopActionResult>("feedbackLoop.actions.apply", { insightId, actionId, confirmed: true });
    },
    async listFeedbackLoopRules(params: { projectId?: string } = {}): Promise<OraFeedbackLoopCalibrationRule[]> {
      return call<OraFeedbackLoopCalibrationRule[]>("feedbackLoop.rules.list", params);
    },
    async updateFeedbackLoopRule(rule: OraFeedbackLoopCalibrationRule): Promise<OraFeedbackLoopCalibrationRule> {
      return call<OraFeedbackLoopCalibrationRule>("feedbackLoop.rules.update", { rule });
    },
    async scanSelfIteration(params: { projectId?: string; autoApplyEvaluation?: boolean } = {}): Promise<OraSelfIterationScanResult> {
      return call<OraSelfIterationScanResult>("selfIteration.scan", params);
    },
    async listSelfIterationCandidates(params: { projectId?: string; targetKind?: string; status?: string; limit?: number } = {}): Promise<OraSelfIterationCandidate[]> {
      return call<OraSelfIterationCandidate[]>("selfIteration.candidates.list", params);
    },
    async getSelfIterationCandidate(candidateId: string): Promise<OraSelfIterationCandidate> {
      return call<OraSelfIterationCandidate>("selfIteration.candidates.get", { candidateId });
    },
    async evaluateSelfIterationCandidate(candidateId: string): Promise<OraSelfIterationCandidate> {
      return call<OraSelfIterationCandidate>("selfIteration.candidates.evaluate", { candidateId });
    },
    async rejectSelfIterationCandidate(candidateId: string, reason?: string): Promise<OraSelfIterationCandidate> {
      return call<OraSelfIterationCandidate>("selfIteration.candidates.reject", { candidateId, reason });
    },
    async applySelfIterationCandidate(candidateId: string, confirmed = false): Promise<OraSelfIterationCandidate> {
      return call<OraSelfIterationCandidate>("selfIteration.candidates.apply", { candidateId, confirmed });
    },
    async getSelfIterationPolicy(projectId?: string): Promise<OraSelfIterationPolicy> {
      return call<OraSelfIterationPolicy>("selfIteration.policy.get", { projectId });
    },
    async updateSelfIterationPolicy(policy: OraSelfIterationPolicy): Promise<OraSelfIterationPolicy> {
      return call<OraSelfIterationPolicy>("selfIteration.policy.update", { policy });
    },
    async getSession(sessionId: string): Promise<OraSessionDetail> {
      return call<OraSessionDetail>("sessions.get", { sessionId });
    },
    async getMemory(): Promise<OraLongTermMemoryProfile> {
      return call<OraLongTermMemoryProfile>("memory.get");
    },
    async clearMemory(): Promise<OraLongTermMemoryProfile> {
      return call<OraLongTermMemoryProfile>("memory.clear");
    },
    async listAgents(): Promise<OraCustomAgentSummary[]> {
      return call<OraCustomAgentSummary[]>("agents.list");
    },
    async agentCatalog(): Promise<OraAgentCatalogResult> {
      return call<OraAgentCatalogResult>("agents.catalog");
    },
    async listSkills(params: { category?: "public" | "private"; enabledOnly?: boolean; query?: string } = {}): Promise<OraSkillRegistry> {
      return call<OraSkillRegistry>("skills.list", params);
    },
    async getSkill(name: string): Promise<OraSkillDetail> {
      return call<OraSkillDetail>("skills.get", { name });
    },
    async getSkillFile(skillName: string, path: string): Promise<OraSkillPackageFileContent> {
      return call<OraSkillPackageFileContent>("skills.file.get", { skillName, path });
    },
    async createSkill(params: OraSkillCreateParams): Promise<OraSkillDetail> {
      return call<OraSkillDetail>("skills.create", params);
    },
    async updateSkill(params: OraSkillUpdateParams): Promise<OraSkillDetail> {
      return call<OraSkillDetail>("skills.update", params);
    },
    async upsertSkillFile(params: { skillName: string; path: string; content: string; executable?: boolean }): Promise<OraSkillDetail> {
      return call<OraSkillDetail>("skills.file.upsert", params);
    },
    async deleteSkill(name: string): Promise<{ deleted: true; name: string }> {
      return call<{ deleted: true; name: string }>("skills.delete", { name });
    },
    async deleteSkillFile(skillName: string, path: string): Promise<OraSkillDetail> {
      return call<OraSkillDetail>("skills.file.delete", { skillName, path });
    },
    async checkSkillName(name: string): Promise<OraSkillCheckNameResult> {
      return call<OraSkillCheckNameResult>("skills.checkName", { name });
    },
    async setSkillEnabled(params: OraSkillSetEnabledParams): Promise<OraSkillDetail> {
      return call<OraSkillDetail>("skills.setEnabled", params);
    },
    async listModes(): Promise<OraModeSpec[]> {
      return call<OraModeSpec[]>("modes.list");
    },
    async getMode(modeId: string): Promise<OraModeSpec> {
      return call<OraModeSpec>("modes.get", { modeId });
    },
    async createMode(spec: OraModeCreateParams): Promise<OraModeSpec> {
      return call<OraModeSpec>("modes.create", spec);
    },
    async updateMode(modeId: string, spec: OraModeCreateParams): Promise<OraModeSpec> {
      return call<OraModeSpec>("modes.update", { modeId, spec } satisfies OraModeUpdateParams);
    },
    async deleteMode(modeId: string): Promise<{ deleted: true; modeId: string }> {
      return call<{ deleted: true; modeId: string }>("modes.delete", { modeId });
    },
    async validateMode(spec: OraModeSpec | OraModeCreateParams): Promise<OraModeValidationResult> {
      return call<OraModeValidationResult>("modes.validate", { spec });
    },
    async cloneModeFromPreset(sourceModeId: string, modeId?: string, label?: string): Promise<OraModeSpec> {
      return call<OraModeSpec>("modes.cloneFromPreset", { sourceModeId, modeId, label });
    },
    async modeStudioContext(): Promise<OraModeStudioContextResult> {
      return call<OraModeStudioContextResult>("modeStudio.context");
    },
    async generateModeStudioDraft(params: OraModeStudioGenerateDraftParams): Promise<OraModeStudioDraftBundle> {
      return call<OraModeStudioDraftBundle>("modeStudio.generateDraft", params);
    },
    async refineModeStudioDraft(params: OraModeStudioRefineDraftParams): Promise<OraModeStudioDraftBundle> {
      return call<OraModeStudioDraftBundle>("modeStudio.refineDraft", params);
    },
    async startModeStudioBuilderRun(params: OraModeStudioStartBuilderRunParams): Promise<OraRunHandle> {
      return call<OraRunHandle>("modeStudio.startBuilderRun", params);
    },
    async modeStudioBuilderResult(runId: string): Promise<OraModeStudioBuilderResult> {
      return call<OraModeStudioBuilderResult>("modeStudio.builderResult", { runId });
    },
    async validateModeStudioDraft(draftBundle: OraModeStudioDraftBundle): Promise<OraModeStudioDraftBundle> {
      return call<OraModeStudioDraftBundle>("modeStudio.validateDraft", { draftBundle });
    },
    async applyModeStudioDraft(params: OraModeStudioApplyDraftParams): Promise<OraModeStudioApplyDraftResult> {
      return call<OraModeStudioApplyDraftResult>("modeStudio.applyDraft", params);
    },
    async getAgent(name: string): Promise<OraCustomAgentDetail> {
      return call<OraCustomAgentDetail>("agents.get", { name });
    },
    async createAgent(params: OraCustomAgentCreateParams): Promise<OraCustomAgentDetail> {
      return call<OraCustomAgentDetail>("agents.create", params);
    },
    async updateAgent(params: OraCustomAgentUpdateParams): Promise<OraCustomAgentDetail> {
      return call<OraCustomAgentDetail>("agents.update", params);
    },
    async deleteAgent(name: string): Promise<{ deleted: true; name: string }> {
      return call<{ deleted: true; name: string }>("agents.delete", { name });
    },
    async checkAgentName(name: string): Promise<OraCustomAgentCheckNameResult> {
      return call<OraCustomAgentCheckNameResult>("agents.checkName", { name });
    },
    async generateAgentDraft(params: OraCustomAgentGenerateDraftParams): Promise<OraCustomAgentGenerateDraftResult> {
      return call<OraCustomAgentGenerateDraftResult>("agents.generateDraft", params);
    },
    async updateSystemAgentOverride(params: OraSystemAgentOverrideUpdateParams): Promise<OraSystemAgentOverride> {
      return call<OraSystemAgentOverride>("agents.updateSystemOverride", params);
    },
    async resetSystemAgentOverride(agentId: string): Promise<{ reset: true; agentId: string }> {
      return call<{ reset: true; agentId: string }>("agents.resetSystemOverride", { agentId });
    },
    async startRun(input: OraUserTaskInput, config: Partial<OraRunConfig>, sessionId?: string): Promise<OraStateSnapshot> {
      const handle = await call<OraRunHandle>("runs.start", { input, config, sessionId });
      return call<OraStateSnapshot>("runs.state", { runId: handle.runId });
    },
    async startStreamingRun(input: OraUserTaskInput, config: Partial<OraRunConfig>, sessionId?: string): Promise<OraRunHandle> {
      return call<OraRunHandle>("runs.startStreaming", { input, config, sessionId });
    },
    async subscribeRunEvents(callback: (stream: OraRunEventStream) => void): Promise<() => void> {
      if (!isTauriAvailable()) {
        return () => {};
      }
      const { listen } = await import("@tauri-apps/api/event");
      return listen<OraRunEventStream>(RUN_EVENT_NOTIFICATION, (event) => callback(event.payload));
    },
    async subscribeChannelSessionUpdates(callback: (event: OraChannelSessionUpdate) => void): Promise<() => void> {
      if (!isTauriAvailable()) {
        return () => {};
      }
      const { listen } = await import("@tauri-apps/api/event");
      return listen<OraChannelSessionUpdate>(CHANNEL_SESSION_UPDATED_NOTIFICATION, (event) => callback(event.payload));
    },
    async getRunState(runId: string): Promise<OraStateSnapshot> {
      return call<OraStateSnapshot>("runs.state", { runId });
    },
    async getRunTrail(runId: string): Promise<OraRunTrail> {
      return call<OraRunTrail>("runs.trail", { runId });
    },
    async interruptRun(runId: string, reason: string): Promise<OraStateSnapshot> {
      return call<OraStateSnapshot>("runs.interrupt", { runId, reason });
    },
    async resumeRun(runId: string, reason: string, patch: Record<string, unknown> = {}): Promise<OraStateSnapshot> {
      return call<OraStateSnapshot>("runs.resume", { runId, reason, patch });
    },
    async resumeStreamingRun(runId: string, reason: string, patch: Record<string, unknown> = {}): Promise<OraRunHandle> {
      return call<OraRunHandle>("runs.resumeStreaming", { runId, reason, patch });
    },
    async cancelRun(runId: string, reason = USER_CANCELLED_MESSAGE): Promise<OraStateSnapshot> {
      return call<OraStateSnapshot>("runs.cancel", { runId, reason });
    },
    async listCheckpoints(runId: string): Promise<OraCheckpointMeta[]> {
      return call<OraCheckpointMeta[]>("runs.checkpoints", { runId });
    },
    async streamRun(runId: string, afterSeq?: number): Promise<OraRunEventStream> {
      return call<OraRunEventStream>("runs.stream", { runId, afterSeq });
    },
    async replayRun(runId: string, checkpointId?: string): Promise<OraRunEventStream> {
      return call<OraRunEventStream>("runs.replay", { runId, checkpointId });
    },
    async runtimeMaintenance(params: Partial<OraRuntimeMaintenanceParams> = {}): Promise<OraRuntimeMaintenanceResult> {
      return call<OraRuntimeMaintenanceResult>("runtime.maintenance", params);
    },
    async forkRun(
      runId: string,
      checkpointId: string,
      config: Partial<OraRunConfig> = {},
      input: Partial<OraUserTaskInput> = {},
    ): Promise<OraStateSnapshot> {
      const handle = await call<OraRunHandle>("runs.fork", { runId, checkpointId, config, input });
      return call<OraStateSnapshot>("runs.state", { runId: handle.runId });
    },
    async exportReport(runId: string): Promise<{ artifact: OraArtifactRef; snapshot: OraStateSnapshot }> {
      const artifact = await call<OraArtifactRef>("runs.exportReport", { runId });
      const snapshot = await call<OraStateSnapshot>("runs.state", { runId });
      return { artifact, snapshot };
    },
    getHealth(): RuntimeHealth | undefined {
      return lastHealth;
    },
    async refreshProviderSecretStatuses(providers: OraProviderConfig[]): Promise<OraProviderSecretStatus[]> {
      return getProviderSecretStatuses(providers);
    },
    refreshProviderStatuses(
      providers: OraProviderConfig[],
      secretStatuses: OraProviderSecretStatus[],
      currentStatuses: OraProviderStatus[] = []
    ): OraProviderStatus[] {
      return deriveProviderStatuses(providers, secretStatuses, currentStatuses);
    },
    async storeProviderSecret(providerId: string, secret: string): Promise<OraProviderSecretStatus> {
      return writeProviderSecret(providerId, secret);
    },
    async deleteProviderSecret(providerId: string): Promise<OraProviderSecretStatus> {
      return removeProviderSecret(providerId);
    },
    async verifyProvider(provider: OraProviderConfig): Promise<OraProviderStatus> {
      return call<OraProviderStatus>("providers.verify", { provider });
    },
    async listProviderModels(provider: OraProviderConfig): Promise<OraProviderModelsResult> {
      if (lastHealth?.mode === "browser_mock") {
        return mockProviderModels(provider);
      }
      return call<OraProviderModelsResult>("providers.models", { provider });
    },
    async upsertCustomProvider(provider: OraProviderConfig): Promise<OraProviderRegistry> {
      const parsed = ProviderConfigSchema.parse(provider) as OraProviderConfig;
      const providers = readCustomProviders();
      writeCustomProviders([
        parsed,
        ...providers.filter((entry) => entry.id !== parsed.id),
      ]);
      return mergeCustomProviders(await call<OraProviderRegistry>("providers.list"));
    },
    async deleteCustomProvider(providerId: string): Promise<OraProviderRegistry> {
      writeCustomProviders(readCustomProviders().filter((provider) => provider.id !== providerId));
      return mergeCustomProviders(await call<OraProviderRegistry>("providers.list"));
    },
    async openExternalUrl(url: string): Promise<void> {
      return openExternalUrl(url);
    },
  };
}

function mockProviderModels(provider: OraProviderConfig): OraProviderModelsResult {
  if (provider.type === "local_smoke") {
    return {
      models: [{ id: "smoke-model", source: "local" }],
      status: "ok",
      authoritative: true,
      fetchedAt: new Date().toISOString(),
    };
  }

  const preset = PROVIDER_PRESETS.find((entry) => {
    if (entry.fixedProviderId && provider.id.startsWith(entry.fixedProviderId)) {
      return true;
    }
    return entry.type === provider.type && entry.baseUrl === provider.baseUrl;
  }) ?? PROVIDER_PRESETS.find((entry) => entry.type === provider.type);

  if (preset?.modelSuggestions.length) {
    return {
      models: preset.modelSuggestions.map((id) => ({ id, source: "preset" })),
      status: "ok",
      authoritative: false,
      message: "Runtime is in browser mock mode; showing preset model suggestions.",
      fetchedAt: new Date().toISOString(),
    };
  }

  return {
    models: [],
    status: "unsupported",
    authoritative: false,
    message: "Runtime is in browser mock mode and no model suggestions are available.",
    fetchedAt: new Date().toISOString(),
  };
}

export type RuntimeClient = ReturnType<typeof createRuntimeClient>;

export function getSharedRuntimeClient() {
  if (!sharedRuntimeClient) {
    sharedRuntimeClient = createRuntimeClient();
  }
  return sharedRuntimeClient;
}

function mergeCustomProviders(registry: OraProviderRegistry): OraProviderRegistry {
  const merged = new Map<string, OraProviderConfig>();
  for (const provider of registry.providers) {
    merged.set(provider.id, provider);
  }
  for (const provider of readCustomProviders()) {
    merged.set(provider.id, provider);
  }

  return {
    providers: [...merged.values()],
    defaultProviderId: merged.has(registry.defaultProviderId)
      ? registry.defaultProviderId
      : registry.providers[0]?.id ?? "local-smoke",
  };
}

function readCustomProviders(): OraProviderConfig[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(CUSTOM_PROVIDER_STORAGE_KEY);
    const decoded = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(decoded)) {
      return [];
    }

    return decoded.flatMap((entry) => {
      const parsed = ProviderConfigSchema.safeParse(entry);
      return parsed.success ? [parsed.data as OraProviderConfig] : [];
    });
  } catch {
    return [];
  }
}

function writeCustomProviders(providers: OraProviderConfig[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(CUSTOM_PROVIDER_STORAGE_KEY, JSON.stringify(providers));
}

function deriveProviderStatuses(
  providers: OraProviderConfig[],
  secretStatuses: OraProviderSecretStatus[],
  currentStatuses: OraProviderStatus[] = []
): OraProviderStatus[] {
  const currentById = new Map(currentStatuses.map((status) => [status.providerId, status]));
  const secretById = new Map(secretStatuses.map((status) => [status.providerId, status]));

  return providers.map((provider) => {
    if (provider.type === "local_smoke") {
      return {
        providerId: provider.id,
        state: "verified",
        detail: "Local smoke provider is ready.",
        checkedAt: currentById.get(provider.id)?.checkedAt,
      } satisfies OraProviderStatus;
    }

    const secretStatus = secretById.get(provider.id);
    if (!secretStatus?.hasSecret) {
      return {
        providerId: provider.id,
        state: "needs_key",
        detail: "API key required before verification.",
      } satisfies OraProviderStatus;
    }

    const current = currentById.get(provider.id);
    if (current?.state === "verified" || current?.state === "failed") {
      return current;
    }

    return {
      providerId: provider.id,
      state: "key_stored",
      detail: "API key stored. Run verify to confirm connectivity.",
    } satisfies OraProviderStatus;
  });
}

async function tryTauriJsonRpc(request: JsonRpcRequest): Promise<
  | { ok: true; response: JsonRpcResponse; tauriAvailable: true }
  | { ok: false; tauriAvailable: boolean; error?: unknown }
> {
  if (!isTauriAvailable()) {
    return { ok: false, tauriAvailable: false };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<JsonRpcResponse>("runtime_json_rpc", { request });
    return { ok: true, response, tauriAvailable: true };
  } catch (error) {
    return { ok: false, tauriAvailable: true, error };
  }
}

async function readTauriSidecarStatus(): Promise<Record<string, unknown> | undefined> {
  if (!isTauriAvailable()) {
    return undefined;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<Record<string, unknown>>("runtime_sidecar_status");
  } catch {
    // The JSON-RPC bridge decides whether to use the deterministic fallback.
    return undefined;
  }
}

function compactDetails(items: Array<string | undefined>) {
  return items
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item))
    .join(" ");
}

function formatManagedLangfuseStatus(sidecarStatus: Record<string, unknown> | undefined): string | undefined {
  const rawStatus = sidecarStatus?.managed_langfuse;
  const status = isRecord(rawStatus) ? rawStatus : undefined;
  if (!status) {
    return undefined;
  }
  if (status.enabled !== true) {
    return undefined;
  }
  const available = status.available === true;
  const reason = typeof status.reason === "string" ? status.reason : undefined;
  return `Optional Langfuse ${available ? "ready" : "not ready"}${reason ? `: ${reason}` : "."}`;
}

async function getProviderSecretStatuses(providers: OraProviderConfig[]): Promise<OraProviderSecretStatus[]> {
  if (!isTauriAvailable()) {
    return providers.map((provider) => ({
      providerId: provider.id,
      hasSecret: provider.type === "local_smoke",
      storage: "unavailable",
      detail: provider.type === "local_smoke"
        ? "Local smoke provider does not require a secret."
        : "Open the Tauri desktop shell to store this provider key in Keychain.",
    }));
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<OraProviderSecretStatus[]>("provider_secret_status", {
      providerIds: providers.map((provider) => provider.id),
    });
  } catch (error) {
    return providers.map((provider) => ({
      providerId: provider.id,
      hasSecret: false,
      storage: "unavailable",
      detail: error instanceof Error ? error.message : "Provider secret status is unavailable.",
    }));
  }
}

async function writeProviderSecret(providerId: string, secret: string): Promise<OraProviderSecretStatus> {
  if (!isTauriAvailable()) {
    return {
      providerId,
      hasSecret: false,
      storage: "unavailable",
      detail: "Keychain writes require the Tauri desktop shell.",
    };
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<OraProviderSecretStatus>("provider_secret_store", {
    payload: { providerId, secret },
  });
}

async function removeProviderSecret(providerId: string): Promise<OraProviderSecretStatus> {
  if (!isTauriAvailable()) {
    return {
      providerId,
      hasSecret: false,
      storage: "unavailable",
      detail: "Keychain deletes require the Tauri desktop shell.",
    };
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<OraProviderSecretStatus>("provider_secret_delete", { providerId });
}

async function openExternalUrl(url: string): Promise<void> {
  if (typeof window === "undefined" || url.trim().length === 0) {
    return;
  }

  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external_url", { url });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as TauriWindow);
}

function unwrapJsonRpc<T>(response: JsonRpcResponse): T {
  if ("error" in response) {
    throw new Error(response.error.message);
  }

  return response.result as T;
}

class LocalJsonRpcRuntime {
  private projects = new Map<string, OraProjectSummary>();
  private sessions = new Map<string, OraSessionSummary>();
  private channels = new Map<string, OraChannelConfig>();
  private automations = new Map<string, OraAutomation>();
  private runs = new Map<string, OraStateSnapshot>();
  private modeStudioBuilderResults = new Map<string, OraModeStudioBuilderResult>();
  private customAgents = new Map<string, OraCustomAgentDetail>();
  private systemAgentOverrides = new Map<string, OraSystemAgentOverride>();
  private customSkills = new Map<string, OraSkillDetail>();
  private skillFileContents = new Map<string, Map<string, { content: string; executable?: boolean }>>();
  private deletedSkills = new Set<string>();
  private skillEnabled = new Map<string, boolean>();
  private modes = new Map<string, OraModeSpec>();
  private packageStore: OraPackageStoreSnapshot = createMockPackageStore();
  private memory = LongTermMemoryProfileSchema.parse({
    version: "1.0",
    lastUpdated: new Date(0).toISOString(),
    user: {},
    history: {},
    facts: [],
  });
  private evaluationDatasets = new Map<string, OraEvaluationDatasetDetail>();
  private evaluationRuns = new Map<string, OraEvaluationRunDetail>();
  private evaluationBaselines = new Map<string, OraEvaluationBaseline>();
  private evaluationFeedback = new Map<string, OraEvaluationFeedbackRecord>();
  private evaluationBlueprints = new Map<string, OraEvaluationBlueprint>();
  private evaluationAnnotations = new Map<string, OraEvaluationAnnotationTask>();
  private feedbackLoopApplied = new Map<string, string>();
  private feedbackLoopDismissed = new Set<string>();
  private feedbackLoopRules = new Map<string, OraFeedbackLoopCalibrationRule>();
  private selfIterationCandidates = new Map<string, OraSelfIterationCandidate>();
  private selfIterationPolicies = new Map<string, OraSelfIterationPolicy>();
  private nextProjectNumber = 1;
  private nextSessionNumber = 1;
  private nextAutomationNumber = 1;
  private nextRunNumber = 1;
  private nextEvaluationDatasetNumber = 1;
  private nextEvaluationRunNumber = 1;
  private nextEvaluationBaselineNumber = 1;
  private nextEvaluationFeedbackNumber = 1;
  private nextEvaluationBlueprintNumber = 1;
  private nextEvaluationAnnotationNumber = 1;

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      const result = this.dispatch(request.method, request.params);
      return { jsonrpc: "2.0", id: request.id ?? null, result };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Local runtime error",
        },
      };
    }
  }

  private dispatch(method: string, params: unknown): unknown {
    switch (method) {
      case "runtime.health":
        return {
          ok: true,
          service: "ora-runtime-mock",
          version: "0.1.0",
          deterministic: true,
        };
      case "runtime.bootstrap":
        return {
          health: {
            ok: true,
            service: "ora-runtime-mock",
            version: "0.1.0",
            mode: "deterministic_fixture",
          detail: "Browser dev fallback is serving deterministic Ora JSON-RPC.",
        },
        patterns: MVP_PATTERNS,
        modes: MVP_MODES.filter((mode) => mode.visibility !== "internal"),
        atoms: MVP_MODE_RUNTIME_ATOMS,
        tools: {
          tools: MVP_TOOLS,
          defaultPolicyId: "runtime.default_policy",
          },
          packages: this.packageStore,
          skills: {
            skills: this.listSkills().skills,
          },
          providers: {
            providers: DEFAULT_PROVIDERS,
            defaultProviderId: "local-smoke",
          },
        };
      case "runtime.maintenance":
        return {
          compactStreamingEvents: true,
          vacuum: false,
          runsScanned: 0,
          runsCompacted: 0,
          messageDeltaEventsCompacted: 0,
          rawPayloadsRemoved: 0,
          estimatedSnapshotBytesBefore: 0,
          estimatedSnapshotBytesAfter: 0,
          storage: {
            backend: "json-file",
            vacuumed: false,
            beforeBytes: 0,
            afterBytes: 0,
          },
        };
      case "patterns.list":
        return MVP_PATTERNS;
      case "modes.list":
        return this.listModes();
      case "modes.get": {
        const modeId = typeof params === "object" && params !== null && "modeId" in params ? String((params as { modeId: unknown }).modeId) : "";
        return this.getMode(modeId);
      }
      case "modes.create":
        return this.createMode(params);
      case "modes.update":
        return this.updateMode(params);
      case "modes.delete":
        return this.deleteMode(params);
      case "modes.validate":
        return this.validateMode(params);
      case "modes.cloneFromPreset":
        return this.cloneModeFromPreset(params);
      case "modeStudio.context":
        return this.modeStudioContext();
      case "modeStudio.generateDraft":
        return this.generateModeStudioDraft(params);
      case "modeStudio.refineDraft":
        return this.refineModeStudioDraft(params);
      case "modeStudio.startBuilderRun":
        return this.startModeStudioBuilderRun(params);
      case "modeStudio.builderResult":
        return this.modeStudioBuilderResult(params);
      case "modeStudio.validateDraft":
        return this.validateModeStudioDraft(params);
      case "modeStudio.applyDraft":
        return this.applyModeStudioDraft(params);
      case "tools.list":
        return {
          tools: MVP_TOOLS,
          defaultPolicyId: "runtime.default_policy",
        };
      case "packages.list":
      case "packages.active":
        return this.packageStore;
      case "packages.buildCandidate":
        return this.buildPackageCandidate(params);
      case "packages.verify":
        return this.verifyPackage(params);
      case "packages.promote":
      case "packages.switch":
        return this.promotePackage(params);
      case "packages.rollback":
        return this.rollbackPackage();
      case "packages.prune":
        return this.prunePackages(params);
      case "skills.list":
        return {
          skills: this.listSkills(params).skills,
        };
      case "skills.get": {
        const name = normalizeMockSkillName(isRecord(params) ? params.name : undefined);
        const skill = this.findSkill(name);
        if (!skill) {
          throw new Error(`Skill not found: ${name}`);
        }
        return skill;
      }
      case "skills.file.get":
        return this.getSkillFile(params);
      case "skills.create":
        return this.createSkill(params);
      case "skills.update":
        return this.updateSkill(params);
      case "skills.file.upsert":
        return this.upsertSkillFile(params);
      case "skills.delete":
        return this.deleteSkill(params);
      case "skills.file.delete":
        return this.deleteSkillFile(params);
      case "skills.checkName":
        return this.checkSkillName(params);
      case "skills.setEnabled":
        return this.setSkillEnabled(params);
      case "providers.list":
        return {
          providers: DEFAULT_PROVIDERS,
          defaultProviderId: "local-smoke",
        };
      case "providers.verify": {
        const provider = isRecord(params) && isRecord(params.provider)
          ? ProviderConfigSchema.parse(params.provider) as OraProviderConfig
          : undefined;
        if (!provider) {
          throw new Error("Provider config is required for verification.");
        }
        if (provider.type === "local_smoke") {
          return {
            providerId: provider.id,
            state: "verified",
            detail: "Local smoke provider is ready.",
            checkedAt: Date.now(),
          } satisfies OraProviderStatus;
        }
        if ((provider.type === "openai_compatible" || provider.type === "anthropic_compatible") && !provider.baseUrl) {
          return {
            providerId: provider.id,
            state: "not_configured",
            detail: "Base URL is required before verification.",
            checkedAt: Date.now(),
          } satisfies OraProviderStatus;
        }
        return {
          providerId: provider.id,
          state: "verified",
          detail: "Browser mock verified the provider configuration shape.",
          checkedAt: Date.now(),
        } satisfies OraProviderStatus;
      }
      case "providers.models": {
        const provider = isRecord(params) && isRecord(params.provider)
          ? ProviderConfigSchema.parse(params.provider) as OraProviderConfig
          : undefined;
        if (!provider) {
          throw new Error("Provider config is required for model listing.");
        }
        return mockProviderModels(provider);
      }
      case "memory.get":
        return this.memory;
      case "memory.clear":
        this.memory = LongTermMemoryProfileSchema.parse({
          version: "1.0",
          lastUpdated: new Date().toISOString(),
          user: {},
          history: {},
          facts: [],
        });
        return this.memory;
      case "agents.list":
        return [...this.customAgents.values()]
          .map(({ soul, ...summary }) => summary)
          .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
      case "agents.catalog":
        return this.agentCatalog();
      case "agents.get": {
        const name = normalizeMockAgentName(params);
        const agent = this.customAgents.get(name);
        if (!agent) {
          throw new Error(`Custom agent not found: ${name}`);
        }
        return agent;
      }
      case "agents.create":
        return this.createAgent(params);
      case "agents.update":
        return this.updateAgent(params);
      case "agents.delete":
        return this.deleteAgent(params);
      case "agents.checkName":
        return this.checkAgentName(params);
      case "agents.generateDraft":
        return this.generateAgentDraft(params);
      case "agents.updateSystemOverride":
        return this.updateSystemAgentOverride(params);
      case "agents.resetSystemOverride":
        return this.resetSystemAgentOverride(params);
      case "projects.create":
        return this.createProject(params);
      case "projects.list":
        return [...this.projects.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.projectId.localeCompare(b.projectId));
      case "projects.get":
        return this.getProjectDetail(params);
      case "projects.files":
        return this.listProjectFiles(params);
      case "projects.file.read":
        return this.readProjectFile(params);
      case "sessions.create":
        return this.createSession(params);
      case "sessions.list":
        return [...this.sessions.values()]
          .filter((session) => session.archivedAt === undefined)
          .filter((session) => {
            if (typeof params !== "object" || params === null || !("projectId" in params)) return true;
            return typeof params.projectId === "string" ? session.projectId === params.projectId : true;
          })
          .map((session) => this.sessionWithLatestAttention(session))
          .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
      case "sessions.get":
        return this.getSessionDetail(params);
      case "sessions.branchGroups.list":
        return this.listSessionBranchGroups(params);
      case "sessions.branchGroups.get":
        return this.getSessionBranchGroup(params);
      case "sessions.branchGroups.createAndRun":
        return this.createAndRunSessionBranchGroup(params);
      case "sessions.branchGroups.adopt":
        return this.adoptSessionBranchGroup(params);
      case "sessions.branchGroups.dismiss":
        return this.dismissSessionBranchGroup(params);
      case "sessions.resolvePlanDecision":
        return this.resolvePlanDecision(params);
      case "sessions.archive":
        return this.archiveSession(params);
      case "channels.list":
        return [...this.channels.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.channelId.localeCompare(b.channelId));
      case "channels.create":
        return this.createChannel(params);
      case "channels.update":
        return this.updateChannel(params);
      case "channels.delete":
        return this.deleteChannel(params);
      case "channels.status":
        return {
          channels: [...this.channels.values()].map((channel) => ({
            channelId: channel.channelId,
            kind: channel.kind,
            label: channel.label,
            enabled: channel.enabled,
            state: channel.enabled ? "running" : "stopped",
            queueSize: 0,
            runningCount: 0,
            updatedAt: channel.updatedAt,
          })),
          bus: {},
        };
      case "channels.wechat.requestQrCode": {
        const base64 = "iVBORw0KGgoAAAANSUhEUgAAABUAAAAVCAAAAACMfPpKAAAAPUlEQVR4nGP4//8HQ3MYB8OuVS8Ydoe9ANMg/r/VPxiuhkYwrFq1Aiv9b9UKhubQCIZdq1Yw7IbSID7QPAB9+CcNRdy/cgAAAABJRU5ErkJggg==";
        return {
          base64,
          qrcode: "mock-qr-key",
          mimeType: "image/png",
          imageSrc: `data:image/png;base64,${base64}`,
        };
      }
      case "channels.wechat.pollQrCodeStatus":
        return { status: "waiting" };
      case "automations.list":
        return [...this.automations.values()]
          .filter((automation) => {
            const includePaused = !isRecord(params) || params.includePaused !== false;
            return includePaused || automation.status !== "paused";
          })
          .sort((a, b) => (a.state.nextRunAt ?? Number.MAX_SAFE_INTEGER) - (b.state.nextRunAt ?? Number.MAX_SAFE_INTEGER) || b.updatedAt - a.updatedAt);
      case "automations.get": {
        const id = isRecord(params) ? String(params.id ?? "") : "";
        const automation = this.automations.get(id);
        if (!automation) throw new Error(`Automation not found: ${id}`);
        return automation;
      }
      case "automations.create":
        return this.createAutomation(params);
      case "automations.update":
        return this.updateAutomation(params);
      case "automations.delete": {
        const id = isRecord(params) ? String(params.id ?? "") : "";
        if (!this.automations.delete(id)) throw new Error(`Automation not found: ${id}`);
        return { deleted: true, id };
      }
      case "automations.pause":
        return this.setAutomationStatus(params, "paused");
      case "automations.resume":
        return this.setAutomationStatus(params, "active");
      case "automations.runNow":
        return this.runAutomationNow(params);
      case "automations.previewSchedule":
        return this.previewAutomationSchedule(params);
      case "evaluation.datasets.import":
        return this.importEvaluationDataset(params);
      case "evaluation.datasets.list":
        return [...this.evaluationDatasets.values()].map((detail) => detail.dataset);
      case "evaluation.datasets.get": {
        const datasetId = typeof params === "object" && params !== null && "datasetId" in params ? String((params as { datasetId: unknown }).datasetId) : "";
        const detail = this.evaluationDatasets.get(datasetId);
        if (!detail) throw new Error(`Evaluation dataset not found: ${datasetId}`);
        return detail;
      }
      case "evaluation.blueprints.create":
        return this.createEvaluationBlueprint(params);
      case "evaluation.blueprints.update":
        return this.updateEvaluationBlueprint(params);
      case "evaluation.blueprints.list": {
        const parsed = params as OraEvaluationBlueprintListParams | undefined;
        return [...this.evaluationBlueprints.values()]
          .filter((blueprint) => parsed?.recipe ? blueprint.recipe === parsed.recipe : true)
          .filter((blueprint) => parsed?.status ? blueprint.status === parsed.status : true)
          .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
          .slice(0, parsed?.limit);
      }
      case "evaluation.blueprints.get": {
        const blueprintId = typeof params === "object" && params !== null && "blueprintId" in params ? String((params as { blueprintId: unknown }).blueprintId) : "";
        const blueprint = this.evaluationBlueprints.get(blueprintId);
        if (!blueprint) throw new Error(`Evaluation blueprint not found: ${blueprintId}`);
        return blueprint;
      }
      case "evaluation.blueprints.compile":
        return this.compileEvaluationBlueprint(params);
      case "evaluation.blueprints.generateDraft":
        return this.generateEvaluationBlueprintDraft(params);
      case "evaluation.blueprints.planTurn":
        return this.planEvaluationBlueprintTurn(params);
      case "evaluation.runs.start":
        return this.startEvaluationRun(params);
      case "evaluation.runs.list":
        return [...this.evaluationRuns.values()].map((detail) => detail.run).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
      case "evaluation.runs.get": {
        const runId = typeof params === "object" && params !== null && "evaluationRunId" in params ? String((params as { evaluationRunId: unknown }).evaluationRunId) : "";
        const detail = this.evaluationRuns.get(runId);
        if (!detail) throw new Error(`Evaluation run not found: ${runId}`);
        return detail;
      }
      case "evaluation.runs.stream": {
        const runId = typeof params === "object" && params !== null && "evaluationRunId" in params ? String((params as { evaluationRunId: unknown }).evaluationRunId) : "";
        const detail = this.evaluationRuns.get(runId);
        if (!detail) throw new Error(`Evaluation run not found: ${runId}`);
        const afterSeq = typeof params === "object" && params !== null && "afterSeq" in params ? Number((params as { afterSeq?: number }).afterSeq ?? -1) : -1;
        const events = buildMockEvaluationEvents(detail.run, detail.attempts);
        return {
          evaluationRunId: runId,
          fromSeq: afterSeq + 1,
          events: events.filter((event) => event.seq > afterSeq),
          nextSeq: events.length,
        };
      }
      case "evaluation.runs.promoteBaseline":
        return this.promoteEvaluationBaseline(params);
      case "evaluation.runs.export":
        return this.exportEvaluationRun(params);
      case "evaluation.baselines.list":
        return [...this.evaluationBaselines.values()].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      case "evaluation.feedback.submit":
        return this.submitEvaluationFeedback(params);
      case "evaluation.feedback.list": {
        const status = typeof params === "object" && params !== null && "status" in params ? String((params as { status: unknown }).status) : undefined;
        const limit = typeof params === "object" && params !== null && "limit" in params ? Number((params as { limit: unknown }).limit) : undefined;
        return [...this.evaluationFeedback.values()]
          .filter((record) => status ? record.status === status : true)
          .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
          .slice(0, Number.isFinite(limit) ? limit : undefined);
      }
      case "evaluation.feedback.get": {
        const feedbackId = typeof params === "object" && params !== null && "feedbackId" in params ? String((params as { feedbackId: unknown }).feedbackId) : "";
        const record = this.evaluationFeedback.get(feedbackId);
        if (!record) throw new Error(`Evaluation feedback not found: ${feedbackId}`);
        return record;
      }
      case "evaluation.feedback.update":
        return this.updateEvaluationFeedback(params);
      case "evaluation.feedback.accept":
        return this.acceptEvaluationFeedback(params);
      case "evaluation.feedback.reject":
        return this.rejectEvaluationFeedback(params);
      case "evaluation.annotations.list": {
        const parsed = params as { status?: "pending" | "submitted"; runId?: string; limit?: number } | undefined;
        return [...this.evaluationAnnotations.values()]
          .filter((task) => parsed?.status ? task.status === parsed.status : true)
          .filter((task) => parsed?.runId ? task.evaluationRunId === parsed.runId : true)
          .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
          .slice(0, parsed?.limit);
      }
      case "evaluation.annotations.submit":
        return this.submitEvaluationAnnotation(params);
      case "feedbackLoop.signals.list":
        return this.listProjectSignals(params);
      case "feedbackLoop.insights.list":
        return this.listProjectInsights(params);
      case "feedbackLoop.insights.get": {
        const insightId = typeof params === "object" && params !== null && "insightId" in params ? String((params as { insightId: unknown }).insightId) : "";
        const insight = this.listProjectInsights({}).find((candidate) => candidate.id === insightId);
        if (!insight) throw new Error(`Feedback-loop insight not found: ${insightId}`);
        return insight;
      }
      case "feedbackLoop.insights.dismiss": {
        const insightId = typeof params === "object" && params !== null && "insightId" in params ? String((params as { insightId: unknown }).insightId) : "";
        this.feedbackLoopDismissed.add(insightId);
        const insight = this.listProjectInsights({}).find((candidate) => candidate.id === insightId);
        if (!insight) throw new Error(`Feedback-loop insight not found: ${insightId}`);
        return ProjectInsightSchema.parse({ ...insight, status: "dismissed", updatedAt: Date.now() });
      }
      case "feedbackLoop.actions.preview":
        return this.previewProjectSignalAction(params);
      case "feedbackLoop.actions.apply":
        return this.applyProjectSignalAction(params);
      case "feedbackLoop.rules.list":
        return this.listFeedbackLoopRules(params);
      case "feedbackLoop.rules.update": {
        const parsed = FeedbackLoopRuleUpdateParamsSchema.parse(params);
        this.feedbackLoopRules.set(parsed.rule.id, parsed.rule);
        return parsed.rule;
      }
      case "selfIteration.scan":
        return this.scanSelfIteration(params);
      case "selfIteration.candidates.list":
        return this.listSelfIterationCandidates(params);
      case "selfIteration.candidates.get": {
        const candidateId = candidateIdParam(params);
        const candidate = this.selfIterationCandidates.get(candidateId);
        if (!candidate) throw new Error(`Self-Iteration candidate not found: ${candidateId}`);
        return candidate;
      }
      case "selfIteration.candidates.evaluate": {
        const candidateId = candidateIdParam(params);
        const candidate = this.selfIterationCandidates.get(candidateId);
        if (!candidate) throw new Error(`Self-Iteration candidate not found: ${candidateId}`);
        const next = SelfIterationCandidateSchema.parse({
          ...candidate,
          status: "ready",
          evaluationRunId: candidate.evaluationRunId ?? `mock-self-eval:${candidate.id}`,
          updatedAt: Date.now(),
        });
        this.selfIterationCandidates.set(next.id, next);
        return next;
      }
      case "selfIteration.candidates.reject": {
        const candidateId = candidateIdParam(params);
        const candidate = this.selfIterationCandidates.get(candidateId);
        if (!candidate) throw new Error(`Self-Iteration candidate not found: ${candidateId}`);
        const reason = typeof params === "object" && params !== null && "reason" in params ? String(params.reason) : undefined;
        const next = SelfIterationCandidateSchema.parse({ ...candidate, status: "rejected", rejectionReason: reason, updatedAt: Date.now() });
        this.selfIterationCandidates.set(next.id, next);
        return next;
      }
      case "selfIteration.candidates.apply":
        return this.applySelfIterationCandidateMock(params);
      case "selfIteration.policy.get":
        return this.selfIterationPolicy(projectIdParam(params));
      case "selfIteration.policy.update": {
        const parsed = typeof params === "object" && params !== null && "policy" in params ? SelfIterationPolicySchema.parse(params.policy) : undefined;
        if (!parsed) throw new Error("Self-Iteration policy update requires policy.");
        this.selfIterationPolicies.set(parsed.projectId, parsed);
        return parsed;
      }
      case "runs.start":
        return this.startRun(params);
      case "runs.startStreaming":
        return this.startRun(params);
      case "runs.list":
        return [...this.runs.values()]
          .filter((snapshot) => {
            if (typeof params !== "object" || params === null) return true;
            if ("sessionId" in params && typeof params.sessionId === "string") {
              return snapshot.sessionId === params.sessionId;
            }
            return true;
          })
          .sort((a, b) => b.updatedAt - a.updatedAt || a.runId.localeCompare(b.runId))
          .map((snapshot) => ({
            runId: snapshot.runId,
            sessionId: snapshot.sessionId,
            turnIndex: snapshot.turnIndex,
            status: snapshot.status,
            pattern: snapshot.pattern,
            modeId: snapshot.modeId,
            prompt: snapshot.input.prompt,
            startedAt: snapshot.input.createdAt ?? snapshot.updatedAt,
            updatedAt: snapshot.updatedAt,
            eventCount: snapshot.events.length,
            checkpointCount: snapshot.checkpoints.length,
            artifactCount: snapshot.artifacts.length,
            trace: snapshot.trace,
          }));
      case "runs.state":
        return this.getRunState(params);
      case "runs.trail":
        return this.getRunTrail(params);
      case "runs.interrupt":
        return this.transitionRun(params, "interrupted", "run.interrupted");
      case "runs.resume":
        return this.resumeRun(params);
      case "runs.resumeStreaming":
      {
        const snapshot = this.resumeRun(params);
        return {
          runId: snapshot.runId,
          sessionId: snapshot.sessionId,
          turnIndex: snapshot.turnIndex,
          status: snapshot.status,
          pattern: snapshot.pattern,
          modeId: snapshot.modeId,
          startedAt: snapshot.input.createdAt ?? snapshot.updatedAt,
        };
      }
      case "runs.cancel":
        return this.transitionRun(params, "cancelled", "run.cancelled");
      case "runs.checkpoints":
        return this.getRunState(params).checkpoints;
      case "runs.stream": {
        const snapshot = this.getRunState(params);
        const afterSeq = typeof params === "object" && params !== null && "afterSeq" in params
          ? (params as { afterSeq?: unknown }).afterSeq
          : undefined;
        const fromSeq = typeof afterSeq === "number" ? afterSeq + 1 : 0;
        const events = snapshot.events.filter((event) => event.seq >= fromSeq);
        return {
          runId: snapshot.runId,
          fromSeq,
          events,
          nextSeq: snapshot.events.length,
          status: snapshot.status,
          snapshot,
        };
      }
      case "runs.replay": {
        const parsed = asReplayRunParams(params);
        const snapshot = this.getRunState({ runId: parsed.runId });
        const checkpoint = parsed.checkpointId
          ? snapshot.checkpoints.find((item) => item.id === parsed.checkpointId)
          : snapshot.checkpoints.at(-1);
        if (!checkpoint) {
          throw new Error("Checkpoint not found for replay.");
        }
        return {
          runId: snapshot.runId,
          fromSeq: 0,
          events: snapshot.events.filter((event) => event.seq <= checkpoint.eventSeq),
          nextSeq: snapshot.events.length,
        };
      }
      case "runs.exportReport": {
        const snapshot = this.getRunState(params);
        const reportIndex = snapshot.artifacts.filter((item) => item.kind === "report").length;
        const artifact: OraArtifactRef = {
          id: `${snapshot.runId}:report-${reportIndex}`,
          runId: snapshot.runId,
          kind: "report",
          label: reportIndex === 0 ? "Smoke run report" : `Smoke run report ${reportIndex + 1}`,
          mimeType: "application/json",
          createdAt: Date.now(),
          payload: {
            runId: snapshot.runId,
            pattern: snapshot.pattern,
            status: snapshot.status,
            eventCount: snapshot.events.length,
            checkpointCount: snapshot.checkpoints.length,
          },
        };
        const event = createEvent(snapshot.runId, snapshot.events.length, "artifact.exported", { artifact }, snapshot.pattern);
        this.runs.set(snapshot.runId, {
          ...snapshot,
          artifacts: [...snapshot.artifacts, artifact],
          events: [...snapshot.events, event],
          updatedAt: event.createdAt,
        });
        return artifact;
      }
      case "runs.fork": {
        const parsed = asForkRunParams(params);
        const source = this.getRunState({ runId: parsed.runId });
        const checkpoint = source.checkpoints.find((item) => item.id === parsed.checkpointId);
        if (!checkpoint) {
          throw new Error(`Checkpoint not found: ${parsed.checkpointId}`);
        }
        const modeSelection = parsed.config?.modeSelection ?? "manual";
        const mode = modeSelection === "auto"
          ? this.resolveMode(SINGLE_AGENT_MODE_ID, parsed.config?.pattern ?? source.pattern)
          : this.resolveMode(parsed.config?.modeId ?? source.modeId, parsed.config?.pattern ?? source.pattern);
        const pattern = mode.family;
        const prompt = parsed.input?.prompt ?? `${source.input.prompt} (forked from ${checkpoint.label})`;
        const runId = `run-${String(this.nextRunNumber++).padStart(4, "0")}`;
        const sessionId = source.sessionId ?? this.createSession({}).sessionId;
        const snapshot = this.createSnapshot(
          runId,
          mode,
          prompt,
          Date.now(),
          "succeeded",
          {
            runId: source.runId,
            checkpointId: checkpoint.id,
            eventSeq: checkpoint.eventSeq,
          },
          {
            providerId: parsed.config?.providerId ?? source.config.providerId ?? "local-smoke",
            modelRef: parsed.config?.modelRef ?? source.config.modelRef,
            customAgentId: parsed.config?.customAgentId ?? source.config.customAgentId,
            projectId: source.input.projectId,
            modeSelection,
            autoModeRouter: modeSelection === "auto"
              ? {
                  selectedModeId: mode.id,
                  confidence: 0.5,
                  reason: "Browser mock resolved Auto mode deterministically to Single Agent.",
                  status: "selected",
                }
              : undefined,
          },
          sessionId,
          (source.turnIndex ?? 0) + 1,
        );
        this.runs.set(runId, snapshot);
        this.updateSessionFromSnapshot(snapshot);
        return {
          runId,
          sessionId: snapshot.sessionId,
          turnIndex: snapshot.turnIndex,
          status: snapshot.status,
          pattern,
          modeId: mode.id,
          startedAt: snapshot.events[0]?.createdAt ?? snapshot.updatedAt,
        };
      }
      default:
        throw new Error(`Method not found: ${method}`);
    }
  }

  private listProjectSignals(params: unknown): OraProjectSignal[] {
    const projectId = typeof params === "object" && params !== null && "projectId" in params && typeof params.projectId === "string"
      ? params.projectId
      : undefined;
    const signals: OraProjectSignal[] = [];
    for (const snapshot of this.runs.values()) {
      const signalProjectId = this.projectIdForSnapshot(snapshot);
      if (projectId && signalProjectId !== projectId) continue;
      if (snapshot.status === "failed" || snapshot.status === "cancelled" || snapshot.status === "interrupted") {
        signals.push(ProjectSignalSchema.parse({
          id: `${signalProjectId}:signal:run:${snapshot.runId}:${snapshot.status}`,
          projectId: signalProjectId,
          source: "run_event",
          sourceRef: snapshot.runId,
          title: snapshot.status === "failed" ? "Run failed" : `Run ${snapshot.status}`,
          summary: snapshot.error ?? `${snapshot.runId} ended with status ${snapshot.status}.`,
          severity: snapshot.status === "failed" ? "critical" : "warning",
          confidence: 0.82,
          createdAt: snapshot.updatedAt,
          updatedAt: snapshot.updatedAt,
          evidence: [{
            id: `${snapshot.runId}:overview`,
            label: "Open Trails",
            target: { kind: "trail", id: snapshot.runId, runId: snapshot.runId, tabHint: "Overview" },
          }],
          metadata: { runId: snapshot.runId, runStatus: snapshot.status, modeId: snapshot.modeId ?? snapshot.pattern },
        }));
      }
      for (const event of snapshot.events.filter((event) => event.type.startsWith("recovery.") || event.type === "node.skipped")) {
        signals.push(ProjectSignalSchema.parse({
          id: `${signalProjectId}:signal:event:${snapshot.runId}:${event.seq}`,
          projectId: signalProjectId,
          source: event.type.startsWith("recovery.") ? "recovery_event" : "run_event",
          sourceRef: `${snapshot.runId}:${event.seq}`,
          title: event.type === "recovery.exhausted" ? "Recovery exhausted" : event.type,
          summary: `${event.type} occurred in ${snapshot.runId}.`,
          severity: event.type === "recovery.exhausted" ? "critical" : "warning",
          confidence: event.type === "recovery.exhausted" ? 0.9 : 0.74,
          createdAt: event.createdAt,
          updatedAt: event.createdAt,
          evidence: [{
            id: `${snapshot.runId}:evt-${event.seq}`,
            label: "Open Trails event",
            target: { kind: "trail", id: `${snapshot.runId}:evt-${event.seq}`, runId: snapshot.runId, eventSeq: event.seq, tabHint: "Events" },
          }],
          metadata: { runId: snapshot.runId, eventType: event.type, eventSeq: event.seq, modeId: snapshot.modeId ?? snapshot.pattern },
        }));
      }
      if (snapshot.pendingApprovals.length > 0) {
        signals.push(ProjectSignalSchema.parse({
          id: `${signalProjectId}:signal:approval:${snapshot.runId}:pending`,
          projectId: signalProjectId,
          source: "approval_event",
          sourceRef: `${snapshot.runId}:pending-approvals`,
          title: "Approval is pending",
          summary: `${snapshot.pendingApprovals.length} approval request${snapshot.pendingApprovals.length === 1 ? "" : "s"} remain pending.`,
          severity: "warning",
          confidence: 0.75,
          createdAt: snapshot.updatedAt,
          updatedAt: snapshot.updatedAt,
          evidence: [{
            id: `${snapshot.runId}:approvals`,
            label: "Open approvals",
            target: { kind: "trail", id: snapshot.runId, runId: snapshot.runId, tabHint: "Approvals" },
          }],
          metadata: { runId: snapshot.runId, approvalCount: snapshot.pendingApprovals.length, modeId: snapshot.modeId ?? snapshot.pattern },
        }));
      }
    }

    for (const record of this.evaluationFeedback.values()) {
      if (record.status !== "pending" && record.status !== "failed" && record.status !== "accepted") continue;
      const sourceRun = this.runs.get(record.sourceRunId);
      const signalProjectId = sourceRun ? this.projectIdForSnapshot(sourceRun) : "local-project";
      if (projectId && signalProjectId !== projectId) continue;
      signals.push(ProjectSignalSchema.parse({
        id: `${signalProjectId}:signal:feedback:${record.id}:${record.status}`,
        projectId: signalProjectId,
        source: "evaluation_feedback",
        sourceRef: record.id,
        title: record.status === "pending" ? "Feedback pending review" : "Feedback captured",
        summary: record.feedbackText,
        severity: record.status === "failed" ? "critical" : record.status === "pending" ? "warning" : "info",
        confidence: 0.8,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        evidence: [{
          id: record.id,
          label: "Open feedback record",
          target: { kind: "feedback", id: record.id, feedbackId: record.id, runId: record.sourceRunId, datasetId: record.datasetId },
        }],
        metadata: { feedbackId: record.id, feedbackStatus: record.status, sourceRunId: record.sourceRunId },
      }));
    }

    for (const project of this.projects.values()) {
      if (projectId && project.projectId !== projectId) continue;
      const policy = this.selfIterationPolicy(project.projectId).environmentObserver;
      if (!policy.enabled || policy.paused) continue;
      const observedFiles = Math.min(policy.scanBudgetFiles, 3);
      signals.push(ProjectSignalSchema.parse({
        id: `${project.projectId}:signal:project_file:environment_observer`,
        projectId: project.projectId,
        source: "project_file",
        sourceRef: `environment-observer:${project.projectId}`,
        title: "Environment observer snapshot",
        summary: `Scoped observer scanned ${observedFiles} file summaries under ${policy.watchedPaths.join(", ")} without reading raw content.`,
        severity: "info",
        confidence: 0.72,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        evidence: [{
          id: `${project.projectId}:file:mock`,
          label: "Observed project file",
          summary: "Mock browser fallback metadata only",
          target: { kind: "project_file", id: "mock", projectFilePath: "mock" },
        }],
        metadata: {
          observerKind: "environment_snapshot",
          privacy: "metadata_only_no_raw_content",
          watchedPaths: policy.watchedPaths,
          excludedGlobs: policy.excludedGlobs,
          scanBudgetFiles: policy.scanBudgetFiles,
          maxFileBytes: policy.maxFileBytes,
          observedFiles,
          skippedLargeFiles: 0,
          truncated: false,
          extensionCounts: { ".ts": 1, ".md": 1 },
          recentFiles: [{ path: "README.md", sizeBytes: 128, modifiedAt: Date.now() }],
          largestFiles: [{ path: "src/App.tsx", sizeBytes: 4096, modifiedAt: Date.now() }],
          runContext: { totalRuns: this.runs.size, failedRuns: 0, interruptedRuns: 0, recentRuns: [] },
        },
      }));
    }

    return signals.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  private listProjectInsights(params: unknown): OraProjectInsight[] {
    const projectId = typeof params === "object" && params !== null && "projectId" in params && typeof params.projectId === "string"
      ? params.projectId
      : undefined;
    const statusFilter = typeof params === "object" && params !== null && "status" in params && typeof params.status === "string"
      ? params.status
      : undefined;
    const signals = this.listProjectSignals({ projectId });
    const projectIds = [...new Set(signals.map((signal) => signal.projectId))];
    const insights: OraProjectInsight[] = [];
    for (const nextProjectId of projectIds) {
      const projectSignals = signals.filter((signal) => signal.projectId === nextProjectId);
      const rules = this.listFeedbackLoopRules({ projectId: nextProjectId });
      const recoveryRule = rules.find((rule) => rule.id.endsWith(":rule:repeated_recovery_exhausted"));
      const recovery = projectSignals.filter((signal) => signal.source === "recovery_event" && signal.metadata.eventType === "recovery.exhausted");
      if (recoveryRule && mockRuleAllows(recoveryRule, "recovery_event", "critical") && recovery.length >= 2) {
        const action = {
          id: `open-trails:${String(recovery[0]?.metadata.runId ?? "")}`,
          kind: "open_trails" as const,
          label: "Open Trails evidence",
          payload: { runId: recovery[0]?.metadata.runId },
          requiresConfirmation: true,
        };
        insights.push(ProjectInsightSchema.parse({
          id: `${nextProjectId}:insight:repeated_recovery_exhausted:browser_mock`,
          projectId: nextProjectId,
          title: "Recovery is recurring",
          summary: `${recovery.length} recent signals show exhausted recovery.`,
          status: this.feedbackLoopApplied.has(`${nextProjectId}:insight:repeated_recovery_exhausted:browser_mock`)
            ? "applied"
            : this.feedbackLoopDismissed.has(`${nextProjectId}:insight:repeated_recovery_exhausted:browser_mock`) ? "dismissed" : "open",
          signalIds: recovery.map((signal) => signal.id),
          recommendedActions: mockRuleAllowsAction(recoveryRule, action) ? [action] : [],
          confidence: 0.82,
          createdAt: recovery[0]?.createdAt ?? Date.now(),
          updatedAt: recovery[0]?.updatedAt ?? Date.now(),
        }));
      }
      const environmentRule = rules.find((rule) => rule.id.endsWith(":rule:environment_observer_review"));
      const environmentSignals = projectSignals.filter((signal) => signal.source === "project_file" && signal.metadata.observerKind === "environment_snapshot");
      if (environmentRule && mockRuleAllows(environmentRule, "project_file", "info") && environmentSignals.length > 0) {
        const insightId = `${nextProjectId}:insight:environment_observer`;
        const action = {
          id: `draft-self-iteration:${nextProjectId}`,
          kind: "draft_self_iteration_candidate" as const,
          label: "Draft Self-Iteration candidate",
          payload: { projectId: nextProjectId },
          requiresConfirmation: true,
        };
        insights.push(ProjectInsightSchema.parse({
          id: insightId,
          projectId: nextProjectId,
          title: "Environment observer has workspace context",
          summary: "Opt-in project observation produced scoped file and run-context summaries for Self-Iteration review.",
          status: this.feedbackLoopApplied.has(insightId) ? "applied" : this.feedbackLoopDismissed.has(insightId) ? "dismissed" : "open",
          signalIds: environmentSignals.map((signal) => signal.id),
          recommendedActions: mockRuleAllowsAction(environmentRule, action) ? [action] : [],
          confidence: 0.72,
          createdAt: environmentSignals[0]?.createdAt ?? Date.now(),
          updatedAt: environmentSignals[0]?.updatedAt ?? Date.now(),
        }));
      }
      const feedbackRule = rules.find((rule) => rule.id.endsWith(":rule:feedback_pending_review"));
      const feedback = projectSignals.filter((signal) => signal.source === "evaluation_feedback" && signal.metadata.feedbackStatus === "pending");
      if (feedbackRule && mockRuleAllows(feedbackRule, "evaluation_feedback", "warning") && feedback.length > 0) {
        const insightId = `${nextProjectId}:insight:feedback_pending_review`;
        const action = {
          id: "open-evaluation-feedback",
          kind: "open_evaluation_feedback" as const,
          label: "Open Feedback Inbox",
          payload: { view: "evaluation.feedback" },
          requiresConfirmation: true,
        };
        insights.push(ProjectInsightSchema.parse({
          id: insightId,
          projectId: nextProjectId,
          title: "Feedback is waiting for review",
          summary: `${feedback.length} feedback record${feedback.length === 1 ? "" : "s"} need curator review.`,
          status: this.feedbackLoopApplied.has(insightId) ? "applied" : this.feedbackLoopDismissed.has(insightId) ? "dismissed" : "open",
          signalIds: feedback.map((signal) => signal.id),
          recommendedActions: mockRuleAllowsAction(feedbackRule, action) ? [action] : [],
          confidence: 0.84,
          createdAt: feedback[0]?.createdAt ?? Date.now(),
          updatedAt: feedback[0]?.updatedAt ?? Date.now(),
        }));
      }
    }
    return insights
      .filter((insight) => statusFilter ? insight.status === statusFilter : true)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  private previewProjectSignalAction(params: unknown): OraFeedbackLoopActionResult {
    const { insight, action } = this.findProjectSignalAction(params);
    return FeedbackLoopActionResultSchema.parse({
      insight,
      action,
      status: "preview",
      message: action.kind === "open_evaluation_feedback"
        ? "This will open the Evaluation Feedback Inbox."
        : "This will route you to the linked evidence surface.",
    });
  }

  private applyProjectSignalAction(params: unknown): OraFeedbackLoopActionResult {
    const parsed = FeedbackLoopActionApplyParamsSchema.parse(params);
    const { insight, action } = this.findProjectSignalAction(parsed);
    this.feedbackLoopApplied.set(insight.id, action.id);
    return FeedbackLoopActionResultSchema.parse({
      insight: { ...insight, status: "applied", updatedAt: Date.now() },
      action,
      status: "applied",
      message: "Marked as applied in Project Signals.",
    });
  }

  private scanSelfIteration(params: unknown): OraSelfIterationScanResult {
    const projectId = projectIdParam(params) ?? this.projects.values().next().value?.projectId ?? "local-project";
    const now = Date.now();
    const feedback = [...this.evaluationFeedback.values()].find((record) => record.status === "pending");
    const candidates: OraSelfIterationCandidate[] = [];
    if (feedback) {
      candidates.push(SelfIterationCandidateSchema.parse({
        id: `${projectId}:self:evaluation:${feedback.id}`,
        projectId,
        targetKind: "evaluation",
        targetRef: { kind: "evaluation", id: feedback.id, feedbackId: feedback.id },
        title: "Turn feedback into an Evaluation case",
        summary: feedback.feedbackText,
        evidence: [{
          id: feedback.id,
          label: "Evaluation feedback",
          summary: feedback.feedbackText,
          target: { kind: "feedback", id: feedback.id, feedbackId: feedback.id, runId: feedback.sourceRunId, datasetId: feedback.datasetId },
        }],
        proposedChange: {
          operation: "evaluation.feedback.accept",
          title: "Accept feedback into Evaluation Studio",
          summary: "Add this reviewed feedback as regression material.",
          metadata: { feedbackId: feedback.id },
        },
        riskLevel: "low",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      }));
    }
    const environmentSignal = this.listProjectSignals({ projectId, source: "project_file" })
      .find((signal) => signal.metadata.observerKind === "environment_snapshot");
    if (environmentSignal) {
      candidates.push(SelfIterationCandidateSchema.parse({
        id: `${projectId}:self:mode:environment-observer`,
        projectId,
        targetKind: "mode",
        targetRef: { kind: "mode", id: "environment-observer" },
        title: "Review mode orchestration from environment observer context",
        summary: "Opt-in workspace observation found scoped file metadata and run-context signals that may improve mode orchestration.",
        evidence: environmentSignal.evidence,
        proposedChange: {
          operation: "mode.studio.generateDraft",
          title: "Open a Mode Studio draft from environment context",
          summary: "Use metadata-only project observation to draft conservative, reviewable mode improvements.",
          metadata: { sourceSignalId: environmentSignal.id, observerKind: "environment_snapshot" },
        },
        riskLevel: "high",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      }));
    }
    const failedRun = [...this.runs.values()].find((run) => run.status === "failed");
    if (failedRun) {
      candidates.push(SelfIterationCandidateSchema.parse({
        id: `${projectId}:self:prompt:${failedRun.modeId ?? failedRun.pattern}`,
        projectId,
        targetKind: "prompt",
        targetRef: { kind: "prompt", id: failedRun.modeId ?? failedRun.pattern, modeId: failedRun.modeId ?? failedRun.pattern },
        title: "Tighten prompt guidance from failed run",
        summary: failedRun.error ?? "A failed run suggests the active mode needs clearer success and recovery guidance.",
        evidence: [{ id: failedRun.runId, label: "Failed run", target: { kind: "run", id: failedRun.runId, runId: failedRun.runId } }],
        proposedChange: {
          operation: "mode.node.prompt.update",
          title: "Add failure-aware prompt guidance",
          summary: "Append a short instruction to verify tool outcomes and surface blockers.",
          after: "Before finalizing, verify tool outcomes and surface blockers with concrete next steps.",
        },
        riskLevel: "high",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      }));
    }
    for (const candidate of candidates) {
      if (!this.selfIterationCandidates.has(candidate.id)) {
        this.selfIterationCandidates.set(candidate.id, candidate);
      }
    }
    const autoApplied: OraSelfIterationCandidate[] = [];
    const policy = this.selfIterationPolicy(projectId);
    if (policy.autonomy === "low_risk_auto" && policy.evaluationAutoApply) {
      for (const candidate of candidates.filter((item) => item.targetKind === "evaluation")) {
        autoApplied.push(this.applySelfIterationCandidateMock({ candidateId: candidate.id, confirmed: true }));
      }
    }
    return SelfIterationScanResultSchema.parse({
      run: {
        id: `mock-self-iteration-run-${now}`,
        projectId,
        kind: "scan",
        candidateIds: candidates.map((candidate) => candidate.id),
        status: "succeeded",
        message: `Self-Iteration scan created or refreshed ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}.`,
        createdAt: now,
      },
      candidates,
      autoApplied,
    });
  }

  private listSelfIterationCandidates(params: unknown): OraSelfIterationCandidate[] {
    const projectId = projectIdParam(params);
    const status = typeof params === "object" && params !== null && "status" in params ? String(params.status) : undefined;
    const targetKind = typeof params === "object" && params !== null && "targetKind" in params ? String(params.targetKind) : undefined;
    return [...this.selfIterationCandidates.values()]
      .filter((candidate) => projectId ? candidate.projectId === projectId : true)
      .filter((candidate) => status ? candidate.status === status : true)
      .filter((candidate) => targetKind ? candidate.targetKind === targetKind : true)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  private applySelfIterationCandidateMock(params: unknown): OraSelfIterationCandidate {
    const parsed = SelfIterationCandidateApplyParamsSchema.parse(params);
    const candidate = this.selfIterationCandidates.get(parsed.candidateId);
    if (!candidate) throw new Error(`Self-Iteration candidate not found: ${parsed.candidateId}`);
    if (candidate.targetKind !== "evaluation" && !parsed.confirmed) {
      throw new Error(`${candidate.targetKind} self-iteration candidates require confirmation before apply.`);
    }
    const next = SelfIterationCandidateSchema.parse({
      ...candidate,
      status: "applied",
      applyResult: { applied: true, mock: true },
      updatedAt: Date.now(),
    });
    this.selfIterationCandidates.set(next.id, next);
    return next;
  }

  private selfIterationPolicy(projectId: string | undefined): OraSelfIterationPolicy {
    const nextProjectId = projectId ?? this.projects.values().next().value?.projectId ?? "local-project";
    const existing = this.selfIterationPolicies.get(nextProjectId);
    if (existing) return existing;
    const policy = SelfIterationPolicySchema.parse({ projectId: nextProjectId, updatedAt: Date.now() });
    this.selfIterationPolicies.set(nextProjectId, policy);
    return policy;
  }

  private listFeedbackLoopRules(params: unknown): OraFeedbackLoopCalibrationRule[] {
    const projectId = typeof params === "object" && params !== null && "projectId" in params && typeof params.projectId === "string"
      ? params.projectId
      : this.projects.values().next().value?.projectId ?? "local-project";
    return [
      FeedbackLoopCalibrationRuleSchema.parse({
        id: `${projectId}:rule:repeated_recovery_exhausted`,
        projectId,
        name: "Repeated recovery exhausted",
        enabled: true,
        sourceFilters: ["recovery_event"],
        severityThreshold: "warning",
        humanReviewRequired: true,
        actionPolicy: { allowedActionKinds: ["open_trails"] },
      }),
      FeedbackLoopCalibrationRuleSchema.parse({
        id: `${projectId}:rule:feedback_pending_review`,
        projectId,
        name: "Feedback pending review",
        enabled: true,
        sourceFilters: ["evaluation_feedback"],
        severityThreshold: "info",
        humanReviewRequired: true,
        actionPolicy: { allowedActionKinds: ["open_evaluation_feedback"] },
      }),
      FeedbackLoopCalibrationRuleSchema.parse({
        id: `${projectId}:rule:environment_observer_review`,
        projectId,
        name: "Environment observer review",
        enabled: true,
        sourceFilters: ["project_file"],
        severityThreshold: "info",
        humanReviewRequired: true,
        actionPolicy: { allowedActionKinds: ["draft_self_iteration_candidate"] },
      }),
    ].map((rule) => this.feedbackLoopRules.get(rule.id) ?? rule);
  }

  private findProjectSignalAction(params: unknown): { insight: OraProjectInsight; action: OraProjectInsight["recommendedActions"][number] } {
    const insightId = typeof params === "object" && params !== null && "insightId" in params ? String((params as { insightId: unknown }).insightId) : "";
    const actionId = typeof params === "object" && params !== null && "actionId" in params ? String((params as { actionId: unknown }).actionId) : "";
    const insight = this.listProjectInsights({}).find((candidate) => candidate.id === insightId);
    if (!insight) throw new Error(`Feedback-loop insight not found: ${insightId}`);
    const action = insight.recommendedActions.find((candidate) => candidate.id === actionId);
    if (!action) throw new Error(`Feedback-loop action not found: ${actionId}`);
    return { insight, action };
  }

  private projectIdForSnapshot(snapshot: OraStateSnapshot): string {
    if (snapshot.sessionId) {
      const projectId = this.sessions.get(snapshot.sessionId)?.projectId;
      if (projectId) return projectId;
    }
    const contextProjectId = snapshot.input.context.projectId;
    return typeof contextProjectId === "string" && contextProjectId.trim() ? contextProjectId : "local-project";
  }

  private createSession(params: unknown): OraSessionSummary {
    const label =
      typeof params === "object" && params !== null && "label" in params && typeof params.label === "string" && params.label.trim()
        ? params.label.trim()
        : "New Chat";
    const projectId =
      typeof params === "object" && params !== null && "projectId" in params && typeof params.projectId === "string"
        ? params.projectId
        : undefined;
    if (projectId && !this.projects.has(projectId)) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const sessionId = `session-${String(this.nextSessionNumber++).padStart(4, "0")}`;
    const now = Date.now();
    const session: OraSessionSummary = {
      sessionId,
      title: label,
      projectId,
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(sessionId, session);
    if (projectId) {
      this.syncProjectSummary(projectId);
    }
    return session;
  }

  private archiveSession(params: unknown): OraSessionSummary {
    if (typeof params !== "object" || params === null || !("sessionId" in params) || typeof params.sessionId !== "string") {
      throw new Error("Missing sessionId");
    }
    const existing = this.sessions.get(params.sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    const archivedAt = existing.archivedAt ?? Date.now();
    const session: OraSessionSummary = {
      ...existing,
      archivedAt,
      updatedAt: Math.max(existing.updatedAt, archivedAt),
    };
    this.sessions.set(session.sessionId, session);
    if (session.projectId) {
      this.syncProjectSummary(session.projectId);
    }
    return session;
  }

  private createAutomation(params: unknown): OraAutomation {
    const parsed = AutomationCreateParamsSchema.parse(params);
    const now = Date.now();
    const automation = AutomationSchema.parse({
      ...parsed,
      id: `automation-${String(this.nextAutomationNumber++).padStart(4, "0")}`,
      createdAt: now,
      updatedAt: now,
      state: {
        nextRunAt: parsed.status === "active" ? mockAutomationOccurrences(parsed.schedule, now, 1)[0] : undefined,
      },
    });
    this.automations.set(automation.id, automation);
    return automation;
  }

  private updateAutomation(params: unknown): OraAutomation {
    const parsed = AutomationUpdateParamsSchema.parse(params);
    const existing = this.automations.get(parsed.id);
    if (!existing) throw new Error(`Automation not found: ${parsed.id}`);
    const now = Date.now();
    const schedule = parsed.schedule ?? existing.schedule;
    const status = parsed.status ?? existing.status;
    const automation = AutomationSchema.parse({
      ...existing,
      ...parsed,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now,
      state: {
        ...existing.state,
        nextRunAt: status === "active" ? mockAutomationOccurrences(schedule, now, 1)[0] : undefined,
      },
    });
    this.automations.set(automation.id, automation);
    return automation;
  }

  private setAutomationStatus(params: unknown, status: "active" | "paused"): OraAutomation {
    const id = isRecord(params) ? String(params.id ?? "") : "";
    const existing = this.automations.get(id);
    if (!existing) throw new Error(`Automation not found: ${id}`);
    const now = Date.now();
    const automation = AutomationSchema.parse({
      ...existing,
      status,
      updatedAt: now,
      state: {
        ...existing.state,
        nextRunAt: status === "active" ? mockAutomationOccurrences(existing.schedule, now, 1)[0] : undefined,
      },
    });
    this.automations.set(automation.id, automation);
    return automation;
  }

  private runAutomationNow(params: unknown): OraAutomationRunRecord {
    const id = isRecord(params) ? String(params.id ?? "") : "";
    const existing = this.automations.get(id);
    if (!existing) throw new Error(`Automation not found: ${id}`);
    const startedAt = Date.now();
    const sessionId = existing.state.dedicatedSessionId
      ?? this.createSession({ label: `Automation: ${existing.title}`, projectId: existing.projectId }).sessionId;
    const handle = this.startRun({
      input: {
        prompt: existing.prompt,
        projectId: existing.projectId,
        context: { automationId: existing.id, automationTitle: existing.title },
        createdAt: startedAt,
      },
      config: {
        ...existing.runConfig,
        modeId: existing.modeId,
        modeSelection: existing.modeSelection,
        providerId: existing.providerId,
        customAgentId: existing.customAgentId,
        modelRef: existing.modelRef,
        skillIds: existing.skillIds,
        toolIds: existing.toolIds,
        metadata: {
          ...(existing.runConfig.metadata ?? {}),
          automationId: existing.id,
          automationTitle: existing.title,
          taskIntent: existing.taskIntent,
        },
      },
      sessionId,
    });
    const completedAt = Date.now();
    const record: OraAutomationRunRecord = {
      id: `automation-run-${Date.now()}`,
      automationId: existing.id,
      runId: handle.runId,
      sessionId,
      status: "succeeded",
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
    };
    const automation = AutomationSchema.parse({
      ...existing,
      updatedAt: completedAt,
      state: {
        ...existing.state,
        dedicatedSessionId: sessionId,
        lastRunId: handle.runId,
        lastRunAt: startedAt,
        lastRunStatus: "succeeded",
        lastDurationMs: record.durationMs,
        consecutiveFailures: 0,
        nextRunAt: existing.status === "active" ? mockAutomationOccurrences(existing.schedule, completedAt, 1)[0] : undefined,
        runHistory: [record, ...existing.state.runHistory].slice(0, 20),
      },
    });
    this.automations.set(automation.id, automation);
    return record;
  }

  private previewAutomationSchedule(params: unknown): OraAutomationPreviewScheduleResult {
    const parsed = AutomationPreviewScheduleParamsSchema.parse(params);
    return {
      occurrences: mockAutomationOccurrences(parsed.schedule, parsed.from ?? Date.now(), parsed.limit),
    };
  }

  private createChannel(params: unknown): OraChannelConfig {
    const record = isRecord(params) ? params : {};
    const now = Date.now();
    const channelKindValues = ["http_webhook", "slack", "feishu", "wechat", "wecom", "telegram", "discord", "dingtalk"];
    const kind = typeof record.kind === "string" && channelKindValues.includes(record.kind)
      ? record.kind as OraChannelKind
      : "http_webhook";
    const channel = {
      channelId: typeof record.channelId === "string" && record.channelId ? record.channelId : `channel-${this.channels.size + 1}`,
      kind,
      label: typeof record.label === "string" && record.label ? record.label : "Channel",
      enabled: typeof record.enabled === "boolean" ? record.enabled : true,
      capabilities: {
        supportsStreamingUpdates: false,
        supportsThreadReplies: false,
        supportsReactions: false,
        supportsFileInbound: false,
        supportsFileOutbound: false,
        supportsMessageUpdate: false,
      },
      config: isRecord(record.config) ? record.config : {},
      secretRefs: {},
      createdAt: now,
      updatedAt: now,
    } satisfies OraChannelConfig;
    this.channels.set(channel.channelId, channel);
    return channel;
  }

  private updateChannel(params: unknown): OraChannelConfig {
    const record = isRecord(params) ? params : {};
    const channelId = typeof record.channelId === "string" ? record.channelId : "";
    const existing = this.channels.get(channelId);
    if (!existing) throw new Error(`Channel not found: ${channelId}`);
    const updated = {
      ...existing,
      label: typeof record.label === "string" && record.label ? record.label : existing.label,
      enabled: typeof record.enabled === "boolean" ? record.enabled : existing.enabled,
      config: isRecord(record.config) ? { ...existing.config, ...record.config } : existing.config,
      updatedAt: Date.now(),
    } satisfies OraChannelConfig;
    this.channels.set(channelId, updated);
    return updated;
  }

  private deleteChannel(params: unknown): { deleted: true; channelId: string } {
    const channelId = isRecord(params) && typeof params.channelId === "string" ? params.channelId : "";
    this.channels.delete(channelId);
    return { deleted: true, channelId };
  }

  private createProject(params: unknown): OraProjectSummary {
    const rootPath =
      typeof params === "object" && params !== null && "rootPath" in params && typeof params.rootPath === "string"
        ? normalizeMockProjectPath(params.rootPath)
        : "";
    if (!rootPath) {
      throw new Error("Project rootPath is required.");
    }

    const existing = [...this.projects.values()].find((project) => project.rootPath === rootPath);
    if (existing) {
      return existing;
    }

    const label =
      typeof params === "object" && params !== null && "label" in params && typeof params.label === "string" && params.label.trim()
        ? params.label.trim()
        : defaultMockProjectLabel(rootPath);
    const projectId = `project-${String(this.nextProjectNumber++).padStart(4, "0")}`;
    const now = Date.now();
    const project: OraProjectSummary = {
      projectId,
      label,
      rootPath,
      sessionCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(projectId, project);
    return project;
  }

  private getProjectDetail(params: unknown): OraProjectDetail {
    if (typeof params !== "object" || params === null || !("projectId" in params) || typeof params.projectId !== "string") {
      throw new Error("Missing projectId");
    }
    const project = this.projects.get(params.projectId);
    if (!project) {
      throw new Error(`Project not found: ${params.projectId}`);
    }
    const sessions = [...this.sessions.values()]
      .filter((session) => session.projectId === params.projectId && session.archivedAt === undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
    return {
      project,
      sessions,
    };
  }

  private listProjectFiles(params: unknown): OraProjectFilesResult {
    const project = this.requireMockProject(params);
    const now = Date.now();
    const files = [
      {
        path: "README.md",
        name: "README.md",
        sizeBytes: 96,
        modifiedAt: now,
        mimeType: "text/markdown",
      },
      {
        path: "src/App.tsx",
        name: "App.tsx",
        sizeBytes: 128,
        modifiedAt: now,
        mimeType: "text/typescript",
      },
    ];
    return {
      projectId: project.projectId,
      rootPath: project.rootPath,
      totalFiles: files.length,
      files,
      truncated: false,
      skippedDirs: [".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "target"],
    };
  }

  private readProjectFile(params: unknown): OraProjectFileReadResult {
    const project = this.requireMockProject(params);
    const requestedPath = isRecord(params) && typeof params.path === "string" ? params.path : "";
    if (!requestedPath || requestedPath.startsWith("../") || requestedPath.includes("/../")) {
      throw new Error("Project file path must stay inside the project root.");
    }
    const label = requestedPath.split("/").at(-1) || requestedPath;
    const mimeType = requestedPath.endsWith(".json")
      ? "application/json"
      : requestedPath.endsWith(".md")
        ? "text/markdown"
        : requestedPath.endsWith(".tsx") || requestedPath.endsWith(".ts")
          ? "text/typescript"
          : "text/plain";
    const payload = mimeType.includes("json")
      ? { mock: true, path: requestedPath }
      : `Browser mock preview for ${requestedPath} in ${project.label}.`;
    return {
      projectId: project.projectId,
      rootPath: project.rootPath,
      path: requestedPath,
      label,
      mimeType,
      previewKind: mimeType.includes("json") ? "json" : "text",
      sizeBytes: typeof payload === "string" ? payload.length : JSON.stringify(payload).length,
      modifiedAt: Date.now(),
      payload,
    };
  }

  private requireMockProject(params: unknown): OraProjectSummary {
    if (!isRecord(params) || typeof params.projectId !== "string") {
      throw new Error("Missing projectId");
    }
    const project = this.projects.get(params.projectId);
    if (!project) {
      throw new Error(`Project not found: ${params.projectId}`);
    }
    return project;
  }

  private createAgent(params: unknown): OraCustomAgentDetail {
    if (!isRecord(params) || typeof params.name !== "string") {
      throw new Error("Custom agent name is required.");
    }
    const name = normalizeMockAgentName(params.name);
    if (this.systemAgentIds().has(name)) {
      throw new Error(`Custom agent '${name}' conflicts with a built-in system agent.`);
    }
    if (this.customAgents.has(name)) {
      throw new Error(`Custom agent '${name}' already exists.`);
    }
    const now = Date.now();
    const detail: OraCustomAgentDetail = {
      name,
      description: typeof params.description === "string" ? params.description : "",
      model: typeof params.model === "string" && params.model.trim() ? params.model : undefined,
      toolGroups: parseMockStringList(params.toolGroups, "optional") ?? undefined,
      toolIds: parseMockStringList(params.toolIds) ?? [],
      skillIds: parseMockStringList(params.skillIds) ?? [],
      soul: typeof params.soul === "string" ? params.soul : "",
      createdAt: now,
      updatedAt: now,
    };
    this.customAgents.set(name, detail);
    return detail;
  }

  private listSkills(params: unknown = {}): OraSkillRegistry {
    const filter = isRecord(params) ? params : {};
    const category = filter.category === "public" || filter.category === "private"
      ? filter.category
      : filter.category === "custom"
        ? "private"
        : undefined;
    const enabledOnly = filter.enabledOnly === true;
    const query = typeof filter.query === "string" ? filter.query.trim().toLowerCase() : "";
    const publicSkills = MVP_SKILLS.map((skill) => {
      const id = skill.id;
      return {
        ...skill,
        id,
        category: "public" as const,
        enabled: this.skillEnabled.get(id) ?? true,
        editable: true,
        content: defaultMockSkillContent(skill.name, skill.promptSnippet ?? skill.description),
      };
    }).filter((skill) => !this.deletedSkills.has(skill.name) && !this.customSkills.has(skill.name));
    const skills = [...publicSkills, ...this.customSkills.values()]
      .filter((skill) => !category || skill.category === category)
      .filter((skill) => !enabledOnly || skill.enabled)
      .filter((skill) => !query || [skill.name, skill.description, skill.path ?? ""].some((value) => value.toLowerCase().includes(query)))
      .map((skill) => {
        if ("content" in skill) {
          const { content: _content, ...descriptor } = skill;
          return descriptor;
        }
        return skill;
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return { skills };
  }

  private findSkill(name: string): OraSkillDetail | undefined {
    const custom = this.customSkills.get(name);
    if (custom) {
      return custom;
    }
    if (this.deletedSkills.has(name)) {
      return undefined;
    }
    const publicSkill = MVP_SKILLS.find((skill) => skill.id === name || skill.name === name);
    if (!publicSkill) {
      return undefined;
    }
    return {
      ...publicSkill,
      id: publicSkill.id,
      category: "public",
      enabled: this.skillEnabled.get(publicSkill.id) ?? true,
      editable: true,
      files: publicSkill.files ?? [],
      content: defaultMockSkillContent(publicSkill.name, publicSkill.promptSnippet ?? publicSkill.description),
    };
  }

  private getSkillFile(params: unknown): OraSkillPackageFileContent {
    if (!isRecord(params)) {
      throw new Error("Skill file params are required.");
    }
    const skillName = normalizeMockSkillName(params.skillName);
    const filePath = normalizeMockSkillFilePath(params.path);
    const skill = this.findSkill(skillName);
    if (!skill) {
      throw new Error(`Skill not found: ${skillName}`);
    }
    const stored = this.skillFileContents.get(skillName)?.get(filePath);
    const descriptor = (skill.files ?? []).find((file) => file.path === filePath);
    if (!stored && !descriptor) {
      throw new Error(`Skill file '${filePath}' was not found in '${skillName}'.`);
    }
    const content = stored?.content ?? `# ${filePath}\n\nBrowser mock content for ${skillName}.\n`;
    return {
      skillName,
      path: filePath,
      kind: descriptor?.kind ?? classifyMockSkillFile(filePath),
      size: content.length,
      updatedAt: descriptor?.updatedAt ?? Date.now(),
      executable: stored?.executable ?? descriptor?.executable ?? false,
      content,
    };
  }

  private upsertSkillFile(params: unknown): OraSkillDetail {
    if (!isRecord(params) || typeof params.content !== "string") {
      throw new Error("Skill file content is required.");
    }
    const skillName = normalizeMockSkillName(params.skillName);
    const filePath = normalizeMockSkillFilePath(params.path);
    const existing = this.findSkill(skillName);
    if (!existing) {
      throw new Error(`Skill not found: ${skillName}`);
    }
    const files = upsertMockSkillFileDescriptor(existing.files ?? [], filePath, params.content, params.executable === true);
    const next = {
      ...existing,
      files,
      updatedAt: Date.now(),
    };
    this.customSkills.set(skillName, next);
    const contents = this.skillFileContents.get(skillName) ?? new Map<string, { content: string; executable?: boolean }>();
    contents.set(filePath, { content: params.content, executable: params.executable === true });
    this.skillFileContents.set(skillName, contents);
    return next;
  }

  private deleteSkillFile(params: unknown): OraSkillDetail {
    if (!isRecord(params)) {
      throw new Error("Skill file params are required.");
    }
    const skillName = normalizeMockSkillName(params.skillName);
    const filePath = normalizeMockSkillFilePath(params.path);
    const existing = this.findSkill(skillName);
    if (!existing) {
      throw new Error(`Skill not found: ${skillName}`);
    }
    if (!(existing.files ?? []).some((file) => file.path === filePath)) {
      throw new Error(`Skill file '${filePath}' was not found in '${skillName}'.`);
    }
    const next = {
      ...existing,
      files: (existing.files ?? []).filter((file) => file.path !== filePath),
      updatedAt: Date.now(),
    };
    this.customSkills.set(skillName, next);
    this.skillFileContents.get(skillName)?.delete(filePath);
    return next;
  }

  private createSkill(params: unknown): OraSkillDetail {
    if (!isRecord(params)) {
      throw new Error("Skill params are required.");
    }
    const name = normalizeMockSkillName(params.name);
    if (this.findSkill(name)) {
      throw new Error(`Skill '${name}' already exists.`);
    }
    const description = typeof params.description === "string" ? params.description : "";
    const content = typeof params.content === "string" && params.content.trim()
      ? params.content
      : defaultMockSkillContent(name, description);
    const metadata = parseMockSkillContent(name, content);
    const now = Date.now();
    const files = readMockSkillFiles(name, params.files, now);
    const skill: OraSkillDetail = {
      id: name,
      name,
      description: metadata.description,
      promptSnippet: metadata.description,
      path: `.ora/skills/private/${name}/SKILL.md`,
      category: "private",
      enabled: params.enabled === false ? false : true,
      editable: true,
      createdAt: now,
      updatedAt: now,
      allowedPatterns: [],
      tags: [],
      files: files.descriptors,
      content,
    };
    this.customSkills.set(name, skill);
    if (files.contents.size > 0) {
      this.skillFileContents.set(name, files.contents);
    }
    this.deletedSkills.delete(name);
    this.skillEnabled.set(name, skill.enabled);
    return skill;
  }

  private updateSkill(params: unknown): OraSkillDetail {
    if (!isRecord(params) || typeof params.content !== "string") {
      throw new Error("Skill content is required.");
    }
    const name = normalizeMockSkillName(params.name);
    const nextName = normalizeMockSkillName(params.nextName ?? params.name);
    const existing = this.findSkill(name);
    if (!existing) {
      throw new Error(`Skill not found: ${name}`);
    }
    if (nextName !== name && this.findSkill(nextName)) {
      throw new Error(`Skill '${nextName}' already exists.`);
    }
    const metadata = parseMockSkillContent(nextName, params.content);
    const existingFiles = existing.files ?? [];
    const filePayload = Array.isArray(params.files) ? readMockSkillFiles(nextName, params.files, Date.now()) : undefined;
    const next: OraSkillDetail = {
      ...existing,
      id: nextName,
      name: nextName,
      description: metadata.description,
      promptSnippet: metadata.description,
      path: `.ora/skills/${existing.category}/${nextName}/SKILL.md`,
      files: filePayload?.descriptors ?? existingFiles,
      content: params.content,
      updatedAt: Date.now(),
    };
    if (nextName !== name) {
      this.customSkills.delete(name);
      this.skillEnabled.delete(name);
      if (existing.category === "public") {
        this.deletedSkills.add(name);
      }
    }
    this.customSkills.set(nextName, next);
    if (filePayload) {
      this.skillFileContents.set(nextName, filePayload.contents);
    } else if (nextName !== name && this.skillFileContents.has(name)) {
      this.skillFileContents.set(nextName, this.skillFileContents.get(name)!);
    }
    if (nextName !== name) {
      this.skillFileContents.delete(name);
    }
    this.deletedSkills.delete(nextName);
    return next;
  }

  private deleteSkill(params: unknown): { deleted: true; name: string } {
    const name = normalizeMockSkillName(isRecord(params) ? params.name : undefined);
    const existing = this.findSkill(name);
    if (!existing) {
      throw new Error(`Skill not found: ${name}`);
    }
    this.customSkills.delete(name);
    this.skillFileContents.delete(name);
    this.skillEnabled.delete(name);
    if (existing.category === "public") {
      this.deletedSkills.add(name);
    }
    return { deleted: true, name };
  }

  private checkSkillName(params: unknown): OraSkillCheckNameResult {
    if (!isRecord(params) || typeof params.name !== "string") {
      throw new Error("Skill name is required.");
    }
    const name = normalizeMockSkillName(params.name);
    return {
      available: !this.findSkill(name),
      name,
    };
  }

  private setSkillEnabled(params: unknown): OraSkillDetail {
    if (!isRecord(params) || typeof params.enabled !== "boolean") {
      throw new Error("Skill enabled state is required.");
    }
    const name = normalizeMockSkillName(params.name);
    const skill = this.findSkill(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }
    this.skillEnabled.set(skill.id, params.enabled);
    if (this.customSkills.has(name)) {
      const next = {
        ...skill,
        enabled: params.enabled,
        updatedAt: Date.now(),
      };
      this.customSkills.set(name, next);
      return next;
    }
    return {
      ...skill,
      enabled: params.enabled,
      updatedAt: Date.now(),
    };
  }

  private buildPackageCandidate(params: unknown): OraPackageManifest {
    const record = isRecord(params) ? params : {};
    const now = Date.now();
    const semver = typeof record.semver === "string" && record.semver.trim()
      ? record.semver.trim()
      : `0.1.${this.packageStore.packages.length + 1}`;
    const versionId = typeof record.versionId === "string" && record.versionId.trim()
      ? record.versionId.trim()
      : `browser-${semver}-${now}`;
    const manifest: OraPackageManifest = {
      versionId,
      semver,
      status: "candidate",
      channel: typeof record.channel === "string" && record.channel.trim() ? record.channel.trim() : "local",
      gitCommit: "browser-mock",
      builtAt: now,
      hostAbiVersion: ORA_HOST_ABI_VERSION,
      runtimeAbiVersion: ORA_RUNTIME_ABI_VERSION,
      slotPath: `/browser-mock/versions/${versionId}`,
      frontendDistPath: `/browser-mock/versions/${versionId}/frontend`,
      runtimeSidecarPath: `/browser-mock/versions/${versionId}/runtime-sidecar`,
      buildLogPath: `/browser-mock/versions/${versionId}/build.log`,
      verification: {
        status: "passed",
        checkedAt: now,
        commands: Array.isArray(record.verificationCommands)
          ? record.verificationCommands.filter((item): item is string => typeof item === "string")
          : ["browser mock verification"],
        logPath: `/browser-mock/versions/${versionId}/build.log`,
        errors: [],
      },
      migrationNotes: Array.isArray(record.migrationNotes)
        ? record.migrationNotes.filter((item): item is string => typeof item === "string")
        : [],
      rollbackTarget: this.packageStore.active.activeVersionId,
    };
    this.packageStore = {
      ...this.packageStore,
      packages: [manifest, ...this.packageStore.packages.filter((item) => item.versionId !== versionId)],
    };
    return manifest;
  }

  private verifyPackage(params: unknown): OraPackageManifest {
    const versionId = requireMockVersionId(params);
    const manifest = this.packageStore.packages.find((item) => item.versionId === versionId);
    if (!manifest) throw new Error(`Ora package slot not found: ${versionId}`);
    const verified: OraPackageManifest = {
      ...manifest,
      status: manifest.status === "active" ? "active" : "candidate",
      verification: {
        ...manifest.verification,
        status: "passed",
        checkedAt: Date.now(),
        errors: [],
      },
    };
    this.packageStore = replaceMockPackage(this.packageStore, verified);
    return verified;
  }

  private promotePackage(params: unknown): OraPackageStoreSnapshot {
    const versionId = requireMockVersionId(params);
    const manifest = this.packageStore.packages.find((item) => item.versionId === versionId);
    if (!manifest) throw new Error(`Ora package slot not found: ${versionId}`);
    if (manifest.verification.status !== "passed") {
      throw new Error("Ora package slot must pass verification before promotion.");
    }
    const now = Date.now();
    const previousVersionId = this.packageStore.active.activeVersionId;
    const activeManifest: OraPackageManifest = {
      ...manifest,
      status: "active",
      promotedAt: manifest.promotedAt ?? now,
      activatedAt: now,
    };
    this.packageStore = {
      ...this.packageStore,
      active: {
        activeVersionId: versionId,
        previousVersionId,
        channel: manifest.channel,
        activatedAt: now,
        compatibilityStatus: "compatible",
      },
      packages: this.packageStore.packages.map((item) => {
        if (item.versionId === versionId) return activeManifest;
        if (item.versionId === previousVersionId) return { ...item, status: "previous" };
        return item.status === "active" ? { ...item, status: "candidate" } : item;
      }),
    };
    return this.packageStore;
  }

  private rollbackPackage(): OraPackageStoreSnapshot {
    const previousVersionId = this.packageStore.active.previousVersionId;
    if (!previousVersionId) {
      throw new Error("No previous Ora package slot is available for rollback.");
    }
    return this.promotePackage({ versionId: previousVersionId });
  }

  private prunePackages(params: unknown): OraPackageStoreSnapshot {
    const includeFailed = !isRecord(params) || params.includeFailed !== false;
    const keepIds = new Set([
      this.packageStore.active.activeVersionId,
      this.packageStore.active.previousVersionId,
    ].filter(Boolean));
    this.packageStore = {
      ...this.packageStore,
      packages: this.packageStore.packages.filter((item) => keepIds.has(item.versionId) || (!includeFailed && item.status !== "failed")),
    };
    return this.packageStore;
  }

  private listModes(): OraModeSpec[] {
    return [...MVP_MODES, ...this.modes.values()]
      .filter((mode) => mode.visibility !== "internal")
      .map((mode) => this.applySystemAgentOverridesToMode(mode))
      .sort((left, right) =>
        Number(right.systemPreset) - Number(left.systemPreset) ||
        right.updatedAt - left.updatedAt ||
        left.label.localeCompare(right.label),
      );
  }

  private getMode(modeId: string): OraModeSpec {
    return this.listModes().find((mode) => mode.id === modeId) ?? (() => {
      throw new Error(`Mode not found: ${modeId}`);
    })();
  }

  private applySystemAgentOverridesToMode(mode: OraModeSpec): OraModeSpec {
    return {
      ...mode,
      profiles: mode.profiles.map((profile) => {
        if (profile.customAgentId) {
          return { ...profile };
        }
        const override = this.systemAgentOverrideFor(profile.id);
        if (!override) {
          return { ...profile };
        }
        return {
          ...profile,
          label: override.label ?? profile.label,
          role: override.role ?? profile.role,
          systemPrompt: override.soul.trim() ? override.soul : profile.systemPrompt,
          modelRef: override.modelRef ?? profile.modelRef,
          toolIds: override.toolIds ?? profile.toolIds,
          skillIds: override.skillIds ?? profile.skillIds,
        };
      }),
    };
  }

  private systemAgentIds(): Set<string> {
    return new Set([
      ORA_ROOT_AGENT_ID,
      ...MVP_MODES.flatMap((mode) => mode.profiles.map((profile) => profile.id)),
      ...Object.keys(SYSTEM_AGENT_ID_ALIASES),
    ]);
  }

  private systemAgentOverrideFor(agentId: string): OraSystemAgentOverride | undefined {
    const canonicalId = canonicalSystemAgentId(agentId);
    const override = this.systemAgentOverrides.get(canonicalId)
      ?? legacySystemAgentIdsFor(canonicalId)
        .map((legacyId) => this.systemAgentOverrides.get(legacyId))
        .find((candidate): candidate is OraSystemAgentOverride => Boolean(candidate));
    return override ? { ...override, agentId: canonicalId } : undefined;
  }

  private createMode(params: unknown): OraModeSpec {
    const spec = params as OraModeCreateParams;
    if (!spec?.id) {
      throw new Error("Mode id is required.");
    }
    if (this.listModes().some((mode) => mode.id === spec.id)) {
      throw new Error(`Mode '${spec.id}' already exists.`);
    }
    const now = Date.now();
    const next = {
      ...spec,
      systemPreset: false,
      createdAt: now,
      updatedAt: now,
    } satisfies OraModeSpec;
    const validation = validateModeSpec(next);
    if (!validation.valid) {
      throw new Error(validation.errors.join(" "));
    }
    this.modes.set(next.id, next);
    return next;
  }

  private updateMode(params: unknown): OraModeSpec {
    if (typeof params !== "object" || params === null || !("modeId" in params) || !("spec" in params)) {
      throw new Error("Mode update requires modeId and spec.");
    }
    const modeId = String((params as { modeId: unknown }).modeId);
    const existing = this.getMode(modeId);
    if (existing.systemPreset) {
      throw new Error(`System preset '${modeId}' is read-only.`);
    }
    const spec = (params as { spec: OraModeCreateParams }).spec;
    const next = {
      ...spec,
      id: modeId,
      systemPreset: false,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    } satisfies OraModeSpec;
    const validation = validateModeSpec(next);
    if (!validation.valid) {
      throw new Error(validation.errors.join(" "));
    }
    this.modes.set(modeId, next);
    return next;
  }

  private deleteMode(params: unknown): { deleted: true; modeId: string } {
    const modeId = typeof params === "object" && params !== null && "modeId" in params ? String((params as { modeId: unknown }).modeId) : "";
    const existing = this.getMode(modeId);
    if (existing.systemPreset) {
      throw new Error(`System preset '${modeId}' cannot be deleted.`);
    }
    this.modes.delete(modeId);
    return { deleted: true, modeId };
  }

  private validateMode(params: unknown): OraModeValidationResult {
    if (typeof params !== "object" || params === null || !("spec" in params)) {
      throw new Error("Mode validation requires a spec.");
    }
    const incoming = (params as { spec: OraModeSpec }).spec;
    const spec = {
      ...incoming,
      systemPreset: false,
      createdAt: "createdAt" in incoming && typeof incoming.createdAt === "number" ? incoming.createdAt : Date.now(),
      updatedAt: Date.now(),
    } satisfies OraModeSpec;
    return validateModeSpec(spec);
  }

  private cloneModeFromPreset(params: unknown): OraModeSpec {
    const sourceModeId = typeof params === "object" && params !== null && "sourceModeId" in params
      ? String((params as { sourceModeId: unknown }).sourceModeId)
      : "";
    const source = this.getMode(sourceModeId);
    const modeId = typeof params === "object" && params !== null && "modeId" in params && typeof (params as { modeId?: unknown }).modeId === "string"
      ? String((params as { modeId?: unknown }).modeId)
      : `${source.id}-copy-${this.modes.size + 1}`;
    const label = typeof params === "object" && params !== null && "label" in params && typeof (params as { label?: unknown }).label === "string"
      ? String((params as { label?: unknown }).label)
      : `${source.label} Copy`;
    return this.createMode({
      ...source,
      id: modeId,
      label,
      editorConstraints: {
        ...source.editorConstraints,
        readOnly: false,
      },
    });
  }

  private modeStudioContext(): OraModeStudioContextResult {
    return {
      modes: this.listModes(),
      agents: [...this.customAgents.values()]
        .map(({ soul, ...summary }) => summary)
        .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name)),
      tools: {
        tools: MVP_TOOLS,
        defaultPolicyId: "runtime.default_policy",
      },
      skills: {
        skills: this.listSkills().skills,
      },
      atoms: MVP_MODE_RUNTIME_ATOMS,
    };
  }

  private generateModeStudioDraft(params: unknown): OraModeStudioDraftBundle {
    return this.mockModeStudioDraftBundle(params);
  }

  private refineModeStudioDraft(params: unknown): OraModeStudioDraftBundle {
    const draftBundle = isRecord(params) && isRecord(params.draftBundle)
      ? params.draftBundle as OraModeStudioDraftBundle
      : undefined;
    return this.mockModeStudioDraftBundle({
      ...(isRecord(params) ? params : {}),
      currentDraft: draftBundle?.modeDraft,
    });
  }

  private startModeStudioBuilderRun(params: unknown): OraRunHandle {
    const bundle = this.mockModeStudioDraftBundle(params);
    const runId = `run-${this.runs.size + 1}`;
    const now = Date.now();
    const mode = MVP_MODES.find((candidate) => candidate.id === "mode_studio_builder")
      ?? this.resolveMode(undefined, "agent_teams");
    const snapshot = this.createSnapshot(
      runId,
      mode,
      modeStudioMockPrompt(params),
      now,
      "succeeded",
      undefined,
      { providerId: "local-smoke", modelRef: "local/smoke-model" },
    );
    const completed = {
      ...snapshot,
      output: {
        kind: "mode_studio_builder_result",
        draftBundle: bundle,
        issues: [],
      },
    };
    this.runs.set(runId, completed);
    this.modeStudioBuilderResults.set(runId, {
      runId,
      status: "succeeded",
      draftBundle: bundle,
      issues: [],
    });
    return {
      runId,
      status: "succeeded",
      pattern: mode.family,
      modeId: mode.id,
      startedAt: now,
    };
  }

  private modeStudioBuilderResult(params: unknown): OraModeStudioBuilderResult {
    const runId = isRecord(params) && typeof params.runId === "string" ? params.runId : "";
    const result = this.modeStudioBuilderResults.get(runId);
    if (!result) {
      throw new Error(`Mode Studio builder result not found: ${runId}`);
    }
    return result;
  }

  private validateModeStudioDraft(params: unknown): OraModeStudioDraftBundle {
    if (!isRecord(params) || !isRecord(params.draftBundle)) {
      throw new Error("Mode Studio draft bundle is required.");
    }
    const bundle = params.draftBundle as OraModeStudioDraftBundle;
    return {
      ...bundle,
      validation: this.validateMode({ spec: bundle.modeDraft }),
    };
  }

  private applyModeStudioDraft(params: unknown): OraModeStudioApplyDraftResult {
    if (!isRecord(params) || !isRecord(params.draftBundle)) {
      throw new Error("Mode Studio draft bundle is required.");
    }
    const bundle = this.validateModeStudioDraft({ draftBundle: params.draftBundle });
    if (!bundle.validation.valid) {
      throw new Error(bundle.validation.errors.join(" "));
    }
    const saveAgentDrafts = typeof params.saveAgentDrafts === "boolean" ? params.saveAgentDrafts : true;
    const agents: OraModeStudioApplyDraftResult["agents"] = [];
    if (saveAgentDrafts) {
      for (const draft of bundle.agentDrafts) {
        const existing = this.customAgents.has(draft.name);
        const saved = existing
          ? this.updateAgent({
              name: draft.name,
              description: draft.description,
              model: draft.model ?? null,
              toolGroups: draft.toolGroups,
              toolIds: draft.toolIds,
              skillIds: draft.skillIds,
              soul: draft.soul,
            })
          : this.createAgent(draft);
        const { soul: _soul, ...summary } = saved;
        agents.push(summary);
      }
    }
    const mode = typeof params.updateModeId === "string"
      ? this.updateMode({ modeId: params.updateModeId, spec: bundle.modeDraft })
      : this.createMode(bundle.modeDraft);
    return { mode, agents };
  }

  private mockModeStudioDraftBundle(params: unknown): OraModeStudioDraftBundle {
    const messages = isRecord(params) && Array.isArray(params.messages) ? params.messages : [];
    const userText = messages
      .filter((message): message is { role: "user"; content: string } =>
        isRecord(message) && message.role === "user" && typeof message.content === "string"
      )
      .map((message) => message.content.trim())
      .filter(Boolean)
      .join("\n");
    const family = mockModeStudioFamily(userText);
    const base = isRecord(params) && isRecord(params.currentDraft)
      ? params.currentDraft as OraModeSpec
      : this.listModes().find((mode) => mode.family === family) ?? this.getMode(SINGLE_AGENT_MODE_ID);
    if (userText.length < 10) {
      const modeDraft = { ...base, systemPreset: false, updatedAt: Date.now() };
      return {
        modeDraft,
        agentDrafts: [],
        guidance: {
          step: "topology",
          assistantMessage: "我可以帮你生成 mode。先选一个方向：互审、主控派发，还是多个 agent 分工并行？",
          choices: [
            { id: "gv", label: "Generator + Verifier", description: "一个 agent 产出，另一个 agent 审查。", prompt: "使用生成-验证结构。" },
            { id: "team", label: "Team Parallel", description: "多个 agent 分工协作。", prompt: "使用多个 agent 分工并行。" },
          ],
        },
        changeSummary: ["Started a safe preview draft."],
        validation: this.validateMode({ spec: modeDraft }),
        needsInput: true,
      };
    }
    const roles = mockModeStudioRoles(family);
    const agentDrafts: OraModeStudioDraftBundle["agentDrafts"] = [];
    const profiles = roles.map((role, index) => {
      const wantsWeb = /\b(web|search|research|source|资料|搜索|研究)\b/i.test(userText) || role.id.includes("research");
      const wantsCode = /\b(code|repo|file|test|build|代码|仓库|测试|构建)\b/i.test(userText) || role.id.includes("builder") || role.id.includes("reviewer");
      const toolIds = [
        ...(wantsWeb ? ["web.search", "web.fetch"] : []),
        ...(wantsCode ? ["file.read", "file.grep"] : []),
      ];
      return {
        ...(base.profiles.find((profile) => profile.id === role.id) ?? base.profiles[index] ?? base.profiles[0]),
        id: role.id,
        label: role.label,
        role: role.role,
        toolIds,
        skillIds: [],
      };
    });
    const toolIds = [...new Set(profiles.flatMap((profile) => profile.toolIds))];
    const modeDraft: OraModeSpec = {
      ...base,
      id: `${slugifyMockAgentName(userText)}-mode`,
      family,
      label: `${userText.slice(0, 40).trim() || "Guided"} Mode`,
      summary: `Guided mode for ${userText.slice(0, 96)}.`,
      description: `Generated by the Mode Studio builder from: ${userText}`,
      systemPreset: false,
      profiles,
      nodes: base.nodes.map((node) => ({
        ...node,
        ownerAgentId: mockModeStudioOwner(node.template, roles) ?? node.ownerAgentId,
        prompt: `Stay aligned with the user's Mode Studio goal: ${userText}`,
      })),
      capabilityFlags: {
        ...base.capabilityFlags,
        toolIds,
        skillIds: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return {
      modeDraft,
      agentDrafts,
      guidance: {
        step: "preview",
        assistantMessage: "我生成了一版 mode 草稿。你可以继续调整 agent 风格、是否并行，以及每个 agent 的工具/技能范围。",
        choices: [
          { id: "strict", label: "Make review stricter", description: "让 reviewer 更重视风险和验证。", prompt: "让审查 agent 更严格。" },
          { id: "parallel", label: "Use more parallel work", description: "提高多个 agent 分工并行的倾向。", prompt: "让这个 mode 更偏并行分工。" },
        ],
      },
      changeSummary: [`Selected ${family.replace(/_/g, " ")} topology.`, "Reused Ora's canonical system agents."],
      validation: this.validateMode({ spec: modeDraft }),
      needsInput: false,
    };
  }

  private updateAgent(params: unknown): OraCustomAgentDetail {
    if (!isRecord(params) || typeof params.name !== "string") {
      throw new Error("Custom agent name is required.");
    }
    const name = normalizeMockAgentName(params.name);
    const existing = this.customAgents.get(name);
    if (!existing) {
      throw new Error(`Custom agent not found: ${name}`);
    }
    const next: OraCustomAgentDetail = {
      ...existing,
      description: typeof params.description === "string" ? params.description : existing.description,
      model: params.model === null
        ? undefined
        : typeof params.model === "string" && params.model.trim()
          ? params.model
          : existing.model,
      toolGroups: params.toolGroups === null
        ? undefined
        : parseMockStringList(params.toolGroups, "optional") ?? existing.toolGroups,
      toolIds: params.toolIds === null
        ? []
        : parseMockStringList(params.toolIds, "optional") ?? existing.toolIds,
      skillIds: params.skillIds === null
        ? []
        : parseMockStringList(params.skillIds, "optional") ?? existing.skillIds,
      soul: typeof params.soul === "string" ? params.soul : existing.soul,
      updatedAt: Date.now(),
    };
    this.customAgents.set(name, next);
    return next;
  }

  private agentCatalog(): OraAgentCatalogResult {
    const systemProfiles = new Map<string, OraAgentCatalogResult["systemAgents"][number]>();
    const customUsages = new Map<string, OraAgentCatalogResult["customAgents"][number]["usages"]>();
    const addCustomUsage = (name: string | undefined, usage: OraAgentCatalogResult["customAgents"][number]["usages"][number]) => {
      if (!name) return;
      const normalized = normalizeMockAgentName(name);
      const current = customUsages.get(normalized) ?? [];
      const key = JSON.stringify(usage);
      if (!current.some((item) => JSON.stringify(item) === key)) {
        current.push(usage);
      }
      customUsages.set(normalized, current);
    };

    systemProfiles.set(ORA_ROOT_AGENT_ID, this.rootAgentCatalogItem());

    for (const mode of MVP_MODES.filter((candidate) => candidate.visibility !== "internal")) {
      const effectiveMode = this.applySystemAgentOverridesToMode(mode);
      for (const profile of mode.profiles) {
        if (systemProfiles.has(profile.id)) continue;
        const effectiveProfile = effectiveMode.profiles.find((candidate) => candidate.id === profile.id) ?? profile;
        const override = this.systemAgentOverrideFor(profile.id);
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

    for (const mode of this.listModes()) {
      for (const profile of mode.profiles) {
        const usage = {
          modeId: mode.id,
          modeLabel: mode.label,
          systemPreset: mode.systemPreset,
          profileId: profile.id,
          profileLabel: profile.label,
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
            modeLabel: mode.label,
            systemPreset: mode.systemPreset,
            nodeId: node.id,
            nodeLabel: node.title ?? node.label,
          },
        );
      }
    }

    return {
      systemAgents: [...systemProfiles.values()].sort((left, right) => left.label.localeCompare(right.label)),
      customAgents: [...this.customAgents.values()]
        .map(({ soul: _soul, ...agent }) => ({
          ...agent,
          source: "custom" as const,
          usages: customUsages.get(agent.name) ?? [],
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name)),
    };
  }

  private rootAgentCatalogItem(): OraAgentCatalogResult["systemAgents"][number] {
    const override = this.systemAgentOverrideFor(ORA_ROOT_AGENT_ID);
    const role = "Root conversation agent, Auto Mode Router initiator, clarification owner, handoff parent, observer, and final responder.";
    const modelRef = explicitSystemAgentModelRef(override?.modelRef);
    const usage = (modeId: string, modeLabel: string) => ({
      modeId,
      modeLabel,
      systemPreset: true,
      profileId: ORA_ROOT_AGENT_ID,
      profileLabel: ORA_ROOT_AGENT_LABEL,
    });
    return {
      source: "system",
      id: ORA_ROOT_AGENT_ID,
      label: override?.label ?? ORA_ROOT_AGENT_LABEL,
      role: override?.role ?? role,
      ...(modelRef ? { modelRef } : {}),
      toolPolicyId: "root.default_policy",
      toolIds: override?.toolIds ?? [...DEFAULT_AGENT_MODE_TOOL_IDS],
      skillIds: override?.skillIds ?? [],
      memoryNamespaces: ["session", "project"],
      soul: override?.soul ?? "",
      overridden: override !== undefined,
      ...(override ? { override } : {}),
      usages: [
        usage("global_entry", "Global Entry"),
        usage("auto_mode_router", "Auto Mode Router"),
        usage("clarification", "Clarification"),
        usage("final_response", "Final Response"),
      ],
    };
  }

  private updateSystemAgentOverride(params: unknown): OraSystemAgentOverride {
    const parsed = SystemAgentOverrideUpdateParamsSchema.parse(params);
    const agentId = canonicalSystemAgentId(parsed.agentId);
    if (!this.systemAgentIds().has(agentId)) {
      throw new Error(`System agent '${parsed.agentId}' does not exist.`);
    }
    const existing = this.systemAgentOverrideFor(agentId);
    const now = Date.now();
    const next: OraSystemAgentOverride = {
      agentId,
      label: parsed.label ?? existing?.label,
      role: parsed.role ?? existing?.role,
      modelRef: parsed.modelRef === null ? undefined : parsed.modelRef ?? existing?.modelRef,
      toolIds: parsed.toolIds === null ? undefined : parsed.toolIds ?? existing?.toolIds,
      skillIds: parsed.skillIds === null ? undefined : parsed.skillIds ?? existing?.skillIds,
      soul: parsed.soul ?? existing?.soul ?? "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.systemAgentOverrides.set(parsed.agentId, next);
    return next;
  }

  private resetSystemAgentOverride(params: unknown): { reset: true; agentId: string } {
    const requestedAgentId = isRecord(params) && typeof params.agentId === "string" ? params.agentId : "";
    const agentId = canonicalSystemAgentId(requestedAgentId);
    if (!this.systemAgentIds().has(agentId)) {
      throw new Error(`System agent '${requestedAgentId}' does not exist.`);
    }
    this.systemAgentOverrides.delete(agentId);
    for (const legacyId of legacySystemAgentIdsFor(agentId)) {
      this.systemAgentOverrides.delete(legacyId);
    }
    return { reset: true, agentId };
  }

  private deleteAgent(params: unknown): { deleted: true; name: string } {
    const name = normalizeMockAgentName(isRecord(params) ? params.name : undefined);
    if (!this.customAgents.has(name)) {
      throw new Error(`Custom agent not found: ${name}`);
    }
    this.customAgents.delete(name);
    return { deleted: true, name };
  }

  private checkAgentName(params: unknown): OraCustomAgentCheckNameResult {
    if (!isRecord(params) || typeof params.name !== "string" || params.name.trim().length === 0) {
      throw new Error("Custom agent name is required.");
    }
    const name = normalizeMockAgentName(params.name);
    return {
      available: !this.customAgents.has(name) && !this.systemAgentIds().has(name),
      name,
    };
  }

  private generateAgentDraft(params: unknown): OraCustomAgentGenerateDraftResult {
    if (!isRecord(params) || !Array.isArray(params.messages)) {
      throw new Error("Agent draft messages are required.");
    }
    const messages = params.messages
      .filter((message): message is { role: "user" | "assistant"; content: string } =>
        isRecord(message) &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
      );
    const userText = messages
      .filter((message) => message.role === "user")
      .map((message) => message.content.trim())
      .join(" ")
      .trim();
    if (userText.length < 12) {
      return {
        status: "needs_input",
        assistantMessage: "我可以帮你生成智能体。先告诉我它主要负责什么任务、输出风格，以及是否需要 web / shell / github 这类工具。",
        draft: isRecord(params.partialDraft) ? params.partialDraft as OraCustomAgentGenerateDraftResult["draft"] : undefined,
        issues: [{ field: "description", message: "Need the agent's purpose and output style." }],
      };
    }

    const name = uniqueMockAgentName(slugifyMockAgentName(userText), (candidate) => this.customAgents.has(candidate));
    const wantsWeb = /\b(web|search|research|source|sources|资料|搜索|来源|研究)\b/i.test(userText);
    const wantsGithub = /\b(github|repo|code|代码|仓库|pr)\b/i.test(userText);
    const toolGroups = [
      ...(wantsWeb ? ["web"] : []),
      ...(wantsGithub ? ["github"] : []),
    ];
    const toolIds = [
      ...(wantsWeb ? ["web.search", "web.fetch"] : []),
      ...(wantsGithub ? ["file.grep"] : []),
    ];
    return {
      status: "draft_ready",
      assistantMessage: "我生成了一版智能体草稿，请检查后确认创建。",
      draft: {
        name,
        description: `Custom agent for ${userText.slice(0, 120)}${userText.length > 120 ? "..." : ""}`,
        model: typeof params.modelRef === "string" ? params.modelRef : undefined,
        toolGroups,
        toolIds,
        skillIds: [],
        soul: [
          `You are ${name}, a custom Ora agent created from this user request: ${userText}`,
          "Clarify ambiguity before acting, keep outputs concise and directly useful, and make assumptions explicit.",
          "When researching or reviewing, separate facts from judgment and call out risks before recommendations.",
        ].join("\n\n"),
      },
      issues: [],
    };
  }

  private getSessionDetail(params: unknown): OraSessionDetail {
    if (typeof params !== "object" || params === null || !("sessionId" in params) || typeof params.sessionId !== "string") {
      throw new Error("Missing sessionId");
    }
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    const turns = [...this.runs.values()]
      .filter((snapshot) => snapshot.sessionId === params.sessionId)
      .filter(isVisibleMockMainlineRun)
      .sort((a, b) => (a.turnIndex ?? 1) - (b.turnIndex ?? 1))
      .map((snapshot) => ({
        runId: snapshot.runId,
        sessionId: snapshot.sessionId!,
        turnIndex: snapshot.turnIndex ?? 1,
        status: snapshot.status,
        attention: deriveRunAttention(snapshot),
        pattern: snapshot.pattern,
        modeId: snapshot.modeId,
        providerId: snapshot.config.providerId,
        modelRef: snapshot.config.modelRef,
        prompt: snapshot.input.prompt,
        startedAt: snapshot.input.createdAt ?? snapshot.updatedAt,
        updatedAt: snapshot.updatedAt,
        eventCount: snapshot.events.length,
        checkpointCount: snapshot.checkpoints.length,
        artifactCount: snapshot.artifacts.length,
      }));
    const transcript: OraSessionTranscriptMessage[] = turns.flatMap((turn) => {
      const snapshot = this.runs.get(turn.runId)!;
      const messages: OraSessionTranscriptMessage[] = [{
        id: `${turn.runId}:user`,
        sessionId: turn.sessionId,
        runId: turn.runId,
        turnIndex: turn.turnIndex,
        role: "user",
        content: snapshot.input.prompt,
        pattern: turn.pattern,
        modeId: turn.modeId,
        createdAt: snapshot.input.createdAt ?? snapshot.updatedAt,
      }];
      const assistant = this.assistantTextForRun(snapshot);
      if (assistant) {
        messages.push({
          id: `${turn.runId}:assistant`,
          sessionId: turn.sessionId,
          runId: turn.runId,
          turnIndex: turn.turnIndex,
          role: "assistant",
          content: assistant,
          pattern: turn.pattern,
          modeId: turn.modeId,
          createdAt: snapshot.updatedAt,
        });
      }
      return messages;
    });
    const latestRunId = turns.at(-1)?.runId;
    return {
      session: this.sessionWithLatestAttention(session),
      turns,
      transcript,
      branchGroups: buildMockBranchGroups(params.sessionId, [...this.runs.values()]),
      latestSnapshot: latestRunId ? this.runs.get(latestRunId) : undefined,
    };
  }

  private listSessionBranchGroups(params: unknown): OraSessionBranchGroup[] {
    if (!isRecord(params) || typeof params.sessionId !== "string") {
      throw new Error("Missing sessionId");
    }
    return buildMockBranchGroups(params.sessionId, [...this.runs.values()]);
  }

  private getSessionBranchGroup(params: unknown): OraSessionBranchGroup {
    if (!isRecord(params) || typeof params.sessionId !== "string" || typeof params.branchGroupId !== "string") {
      throw new Error("Invalid branch group params");
    }
    const group = this.listSessionBranchGroups({ sessionId: params.sessionId })
      .find((candidate) => candidate.branchGroupId === params.branchGroupId);
    if (!group) throw new Error(`Branch group not found: ${params.branchGroupId}`);
    return group;
  }

  private createAndRunSessionBranchGroup(params: unknown): OraSessionBranchGroup {
    if (!isRecord(params) || typeof params.sessionId !== "string" || typeof params.target !== "string" || !Array.isArray(params.candidates)) {
      throw new Error("Invalid branch group create params");
    }
    const sessionId = params.sessionId;
    const branchTarget = branchTargetValue(params.target);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const latest = session.latestRunId ? this.runs.get(session.latestRunId) : undefined;
    const replaceRunId = branchTarget === "replace_latest"
      ? typeof params.replaceRunId === "string" ? params.replaceRunId : latest?.runId
      : undefined;
    const replaceRun = replaceRunId ? this.runs.get(replaceRunId) : undefined;
    const prompt = typeof params.prompt === "string" && params.prompt.trim()
      ? params.prompt.trim()
      : replaceRun?.input.prompt;
    if (!prompt) throw new Error("Branch group prompt is required.");
    if (branchTarget === "empty_start" && session.turnCount !== 0) {
      throw new Error("empty_start branch groups require an empty session.");
    }
    if (branchTarget === "replace_latest" && replaceRunId !== latest?.runId) {
      throw new Error("replace_latest can only replace the current latest run.");
    }
    const branchGroupId = `${sessionId}:branch-${Date.now()}-${this.nextRunNumber}`;
    const baseRunId = branchTarget === "append_after_latest"
      ? latest?.runId
      : branchTarget === "replace_latest"
        ? previousVisibleMockRunBefore(sessionId, replaceRunId!, [...this.runs.values()])?.runId
        : undefined;
    const baseTurnIndex = branchTarget === "replace_latest"
      ? Math.max(0, (replaceRun?.turnIndex ?? 1) - 1)
      : latest?.turnIndex ?? 0;
    params.candidates.forEach((rawCandidate, index) => {
      const candidate = isRecord(rawCandidate) ? rawCandidate : {};
      const config = isRecord(candidate.config) ? candidate.config : {};
      const modeId = typeof config.modeId === "string" ? config.modeId : SINGLE_AGENT_MODE_ID;
      const mode = this.resolveMode(modeId, typeof config.pattern === "string" ? config.pattern as CoordinationPattern : "orchestrator_subagent");
      const runId = `run-${String(this.nextRunNumber++).padStart(4, "0")}`;
      const providerId = typeof config.providerId === "string" ? config.providerId : "local-smoke";
      const modelRef = typeof config.modelRef === "string" ? config.modelRef : "local/smoke-model";
      const snapshot = this.createSnapshot(
        runId,
        mode,
        prompt,
        Date.now() + index,
        "succeeded",
        undefined,
        {
          providerId,
          modelRef,
          projectId: session.projectId,
          modeSelection: config.modeSelection === "auto" ? "auto" : "manual",
        },
        sessionId,
        branchTarget === "replace_latest" ? (replaceRun?.turnIndex ?? 1) + 1 : this.nextVisibleTurnIndex(sessionId),
      );
      const metadata = isRecord(config.metadata) ? config.metadata : {};
      this.runs.set(runId, {
        ...snapshot,
        config: {
          ...snapshot.config,
          ...config,
          metadata: {
            ...snapshot.config.metadata,
            ...metadata,
            branchGroupId,
            branchRole: "candidate",
            branchTarget,
            branchPrompt: prompt,
            branchBaseTurnIndex: baseTurnIndex,
            branchGroupCreatedAt: Date.now(),
            branchCandidateLabel: typeof candidate.label === "string" ? candidate.label : `Candidate ${index + 1}`,
            ...(baseRunId ? { branchBaseRunId: baseRunId } : {}),
            ...(replaceRunId ? { branchReplaceRunId: replaceRunId } : {}),
          },
        },
      });
    });
    return this.getSessionBranchGroup({ sessionId, branchGroupId });
  }

  private adoptSessionBranchGroup(params: unknown): OraSessionDetail {
    if (!isRecord(params) || typeof params.sessionId !== "string" || typeof params.branchGroupId !== "string" || typeof params.runId !== "string") {
      throw new Error("Invalid branch group adoption params");
    }
    const group = this.getSessionBranchGroup(params);
    const candidate = this.runs.get(params.runId);
    if (!candidate || candidate.config.metadata.branchGroupId !== params.branchGroupId) {
      throw new Error("Run does not belong to the selected branch group.");
    }
    const now = Date.now();
    if (group.target === "replace_latest" && group.replaceRunId) {
      const replaced = this.runs.get(group.replaceRunId);
      if (replaced) {
        this.runs.set(replaced.runId, {
          ...replaced,
          config: {
            ...replaced.config,
            metadata: { ...replaced.config.metadata, supersededByRunId: candidate.runId, supersededAt: now },
          },
          updatedAt: Math.max(replaced.updatedAt, now),
        });
      }
    }
    const adopted = {
      ...candidate,
      turnIndex: group.target === "replace_latest" && group.replaceRunId
        ? this.runs.get(group.replaceRunId)?.turnIndex ?? candidate.turnIndex
        : candidate.turnIndex,
      config: {
        ...candidate.config,
        metadata: { ...candidate.config.metadata, branchRole: "adopted", branchAdoptedAt: now },
      },
      updatedAt: Math.max(candidate.updatedAt, now),
    };
    this.runs.set(adopted.runId, adopted);
    this.updateSessionFromSnapshot(adopted);
    return this.getSessionDetail({ sessionId: params.sessionId });
  }

  private dismissSessionBranchGroup(params: unknown): OraSessionBranchGroup {
    const group = this.getSessionBranchGroup(params);
    const now = Date.now();
    group.candidateRunIds.forEach((runId) => {
      const run = this.runs.get(runId);
      if (!run || run.config.metadata.branchRole === "adopted") return;
      this.runs.set(runId, {
        ...run,
        config: {
          ...run.config,
          metadata: { ...run.config.metadata, branchDismissed: true, branchDismissedAt: now },
        },
      });
    });
    return this.getSessionBranchGroup(params);
  }

  private resolvePlanDecision(params: unknown): OraSessionDetail {
    if (
      typeof params !== "object" ||
      params === null ||
      !("sessionId" in params) ||
      typeof params.sessionId !== "string" ||
      !("decisionId" in params) ||
      typeof params.decisionId !== "string" ||
      !("status" in params) ||
      (params.status !== "accepted" && params.status !== "declined")
    ) {
      throw new Error("Invalid plan decision resolution.");
    }
    const detail = this.getSessionDetail({ sessionId: params.sessionId });
    const snapshot = detail.latestSnapshot;
    if (!snapshot) {
      throw new Error(`Session has no plan decision: ${params.sessionId}`);
    }
    if (!snapshot.planDecisions.some((decision) => decision.id === params.decisionId)) {
      throw new Error(`Plan decision does not exist: ${params.decisionId}`);
    }
    const status = params.status;
    const updated = this.normalizeMockSnapshot({
      ...snapshot,
      planDecisions: snapshot.planDecisions.map((decision) =>
        decision.id === params.decisionId
          ? { ...decision, status, resolvedAt: Date.now() }
          : decision
      ),
      updatedAt: Date.now(),
    });
    this.runs.set(updated.runId, updated);
    this.updateSessionFromSnapshot(updated);
    return this.getSessionDetail({ sessionId: params.sessionId });
  }

  private sessionWithLatestAttention(session: OraSessionSummary): OraSessionSummary {
    const latestRun = session.latestRunId
      ? this.runs.get(session.latestRunId)
      : [...this.runs.values()]
          .filter((run) => run.sessionId === session.sessionId)
          .sort((a, b) => (a.turnIndex ?? 1) - (b.turnIndex ?? 1) || a.updatedAt - b.updatedAt)
          .at(-1);
    return latestRun
      ? { ...session, attention: deriveRunAttention(latestRun) }
      : session;
  }

  private startRun(params: unknown): OraRunHandle {
    const parsed = asStartRunParams(params);
    const sessionId =
      parsed.sessionId ??
      this.createSession({ projectId: parsed.input.projectId }).sessionId;
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const modeSelection = parsed.config?.modeSelection ?? "manual";
    const mode = modeSelection === "auto"
      ? this.resolveMode(SINGLE_AGENT_MODE_ID, parsed.config?.pattern ?? "orchestrator_subagent")
      : this.resolveMode(parsed.config?.modeId, parsed.config?.pattern ?? "orchestrator_subagent");
    const pattern = mode.family;
    const runId = `run-${String(this.nextRunNumber++).padStart(4, "0")}`;
    const startedAt = Date.now();
    const turnIndex = [...this.runs.values()].filter((snapshot) => snapshot.sessionId === sessionId).length + 1;
    const mockStatus = mode.id === DEBATE_MODE_ID ? "succeeded" : "interrupted";
    const snapshot = this.createSnapshot(runId, mode, parsed.input.prompt, startedAt, mockStatus, undefined, {
      providerId: parsed.config?.providerId ?? "local-smoke",
      modelRef: parsed.config?.modelRef ?? "local/smoke-model",
      customAgentId: parsed.config?.customAgentId,
      projectId: parsed.input.projectId ?? this.sessions.get(sessionId)?.projectId,
      modeSelection,
      autoModeRouter: modeSelection === "auto"
        ? {
            selectedModeId: mode.id,
            confidence: 0.5,
            reason: "Browser mock resolved Auto mode deterministically to Single Agent.",
            status: "selected",
          }
        : undefined,
    }, sessionId, turnIndex);
    this.updateMockMemoryFromPrompt(snapshot);
    this.runs.set(runId, snapshot);
    this.updateSessionFromSnapshot(snapshot);

    return {
      runId,
      sessionId,
      turnIndex,
      status: snapshot.status,
      pattern,
      modeId: mode.id,
      startedAt,
    };
  }

  private updateMockMemoryFromPrompt(snapshot: OraStateSnapshot) {
    const prompt = snapshot.input.prompt.trim();
    if (!/(记住|记下来|以后|下次|默认|偏好|不要|remember|prefer|always|never|next time)/i.test(prompt)) {
      return;
    }
    const now = new Date().toISOString();
    const content = prompt.replace(/^请?(记住|记下来)[:：,，]?\s*/i, "").slice(0, 700);
    const fact = {
      id: `fact_${snapshot.runId.replace(/[^a-z0-9]+/gi, "_")}`,
      content,
      category: /不要|不对|wrong|incorrect/i.test(prompt) ? "correction" : "preference",
      confidence: /不要|不对|wrong|incorrect/i.test(prompt) ? 0.95 : 0.85,
      createdAt: now,
      source: snapshot.runId,
    };
    this.memory = LongTermMemoryProfileSchema.parse({
      ...this.memory,
      lastUpdated: now,
      user: {
        ...this.memory.user,
        topOfMind: {
          summary: content,
          updatedAt: now,
        },
      },
      history: {
        ...this.memory.history,
        recentMonths: {
          summary: content,
          updatedAt: now,
        },
      },
      facts: [
        fact,
        ...this.memory.facts.filter((item) => item.content !== content),
      ],
    });
  }

  private importEvaluationDataset(params: unknown): OraEvaluationDatasetDetail {
    const parsed = params as {
      name?: string;
      sourceFileName?: string;
      sourceFormat?: "json" | "jsonl" | "csv" | "inline";
      content?: string;
      tags?: string[];
      description?: string;
    };
    const content = parsed.content?.trim();
    if (!content) {
      throw new Error("Evaluation dataset import requires content.");
    }
    const sourceFormat = parsed.sourceFormat ?? inferMockDatasetFormat(parsed.sourceFileName);
    const cases = normalizeMockEvaluationCases(content, sourceFormat);
    const id = `dataset-${String(this.nextEvaluationDatasetNumber++).padStart(4, "0")}`;
    const now = Date.now();
    const detail: OraEvaluationDatasetDetail = {
      dataset: {
        id,
        name: parsed.name?.trim() || parsed.sourceFileName?.replace(/\.[^.]+$/, "") || "Imported dataset",
        description: parsed.description?.trim(),
        sourceFileName: parsed.sourceFileName,
        sourceFormat,
        schemaVersion: 1,
        caseCount: cases.length,
        tags: parsed.tags ?? [],
        createdAt: now,
        updatedAt: now,
      },
      cases,
      metadataKeys: [...new Set(cases.flatMap((item) => Object.keys(item.metadata ?? {})))].sort((a, b) => a.localeCompare(b)),
      tagCounts: cases.reduce<Record<string, number>>((acc, item) => {
        const tags = Array.isArray(item.metadata?.tags) ? item.metadata.tags : [];
        for (const tag of tags) {
          if (typeof tag === "string") acc[tag] = (acc[tag] ?? 0) + 1;
        }
        return acc;
      }, {}),
    };
    this.evaluationDatasets.set(id, detail);
    return detail;
  }

  private createEvaluationBlueprint(params: unknown): OraEvaluationBlueprint {
    const parsed = params as OraEvaluationBlueprintCreateParams;
    const now = Date.now();
    const blueprint: OraEvaluationBlueprint = {
      ...parsed,
      id: `blueprint-${String(this.nextEvaluationBlueprintNumber++).padStart(4, "0")}`,
      status: parsed.status ?? "draft",
      assumptions: parsed.assumptions ?? [],
      missingInformation: parsed.missingInformation ?? [],
      linkedRunIds: parsed.linkedRunIds ?? [],
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.evaluationBlueprints.set(blueprint.id, blueprint);
    return blueprint;
  }

  private updateEvaluationBlueprint(params: unknown): OraEvaluationBlueprint {
    const parsed = params as OraEvaluationBlueprintUpdateParams;
    const current = this.evaluationBlueprints.get(parsed.blueprintId);
    if (!current) throw new Error(`Evaluation blueprint not found: ${parsed.blueprintId}`);
    const next: OraEvaluationBlueprint = {
      ...current,
      ...parsed.updates,
      id: current.id,
      schemaVersion: 1,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    };
    this.evaluationBlueprints.set(next.id, next);
    return next;
  }

  private compileEvaluationBlueprint(params: unknown): OraEvaluationBlueprintCompileResult {
    const parsed = params as { blueprintId?: string; blueprint?: OraEvaluationBlueprint; datasetId?: string; providerId?: string; modelRef?: string; modeIds?: string[] };
    const blueprint = parsed.blueprint ?? (parsed.blueprintId ? this.evaluationBlueprints.get(parsed.blueprintId) : undefined);
    if (!blueprint) throw new Error(`Evaluation blueprint not found: ${parsed.blueprintId ?? ""}`);
    return compileMockEvaluationBlueprint(blueprint, parsed);
  }

  private generateEvaluationBlueprintDraft(params: unknown): OraEvaluationBlueprint {
    const parsed = params as OraEvaluationBlueprintGenerateDraftParams;
    const blueprint = draftMockEvaluationBlueprint({
      id: `blueprint-${String(this.nextEvaluationBlueprintNumber++).padStart(4, "0")}`,
      now: Date.now(),
      goal: parsed.goal,
      recipe: parsed.recipe,
      datasetId: parsed.datasetId,
      providerId: parsed.providerId,
      modelRef: parsed.modelRef,
    });
    this.evaluationBlueprints.set(blueprint.id, blueprint);
    return blueprint;
  }

  private planEvaluationBlueprintTurn(params: unknown): OraEvaluationBlueprintPlanTurnResult {
    const parsed = params as { blueprintId?: string; message?: string; providerId?: string; modelRef?: string };
    const now = Date.now();
    const current = parsed.blueprintId ? this.evaluationBlueprints.get(parsed.blueprintId) : undefined;
    const blueprint = current ?? draftMockEvaluationBlueprint({
      id: `blueprint-${String(this.nextEvaluationBlueprintNumber++).padStart(4, "0")}`,
      now,
      goal: parsed.message || "Plan a new evaluation.",
      recipe: inferMockRecipeFromGoal(parsed.message || ""),
      providerId: parsed.providerId,
      modelRef: parsed.modelRef,
    });
    const wantsJudge = /judge|rubric|llm|裁判/i.test(parsed.message || "");
    const wantsHuman = /human|annotation|人工|标注/i.test(parsed.message || "");
    const next: OraEvaluationBlueprint = {
      ...blueprint,
      goal: parsed.message?.trim() || blueprint.goal,
      evaluatorPlan: {
        ...blueprint.evaluatorPlan,
        evaluators: [
          {
            id: "heuristic",
            kind: "heuristic",
            label: "Heuristic Rules",
            metrics: blueprint.evaluatorPlan.metrics,
            assertions: blueprint.evaluatorPlan.assertions,
            weight: 1,
            metadata: {},
          },
          ...(wantsJudge ? [{
            id: "llm-judge",
            kind: "llm_judge" as const,
            label: "LLM Judge",
            rubric: "Score whether the output satisfies the evaluation goal and case expectations.",
            providerId: parsed.providerId,
            modelRef: parsed.modelRef,
            passThreshold: 0.75,
            weight: 1,
            metadata: {},
          }] : []),
          ...(wantsHuman ? [{
            id: "human-review",
            kind: "human_annotation" as const,
            label: "Human Annotation",
            instructions: "Review the output and mark whether this case should pass.",
            scoreType: "numeric" as const,
            categories: [],
            weight: 1,
            metadata: {},
          }] : []),
        ],
      },
      reviewPlan: {
        ...blueprint.reviewPlan,
        metadata: {
          ...blueprint.reviewPlan.metadata,
          plannerMessages: [
            ...((Array.isArray(blueprint.reviewPlan.metadata.plannerMessages) ? blueprint.reviewPlan.metadata.plannerMessages : []) as unknown[]),
            { id: `${blueprint.id}:planner:user:${now}`, role: "user", content: parsed.message || "", createdAt: now },
            { id: `${blueprint.id}:planner:assistant:${now + 1}`, role: "assistant", content: "I drafted the evaluation plan and evaluator mix.", createdAt: now + 1 },
          ],
        },
      },
      updatedAt: now,
    };
    this.evaluationBlueprints.set(next.id, next);
    const assistantMessage = { id: `${next.id}:planner:assistant:${now + 1}`, role: "assistant" as const, content: "I drafted the evaluation plan and evaluator mix.", createdAt: now + 1 };
    return {
      blueprint: next,
      messages: (next.reviewPlan.metadata.plannerMessages as OraEvaluationBlueprintPlanTurnResult["messages"]) ?? [assistantMessage],
      assistantMessage,
    };
  }

  private startEvaluationRun(params: unknown): OraEvaluationRunDetail {
    const spec = params as OraEvaluationSpec;
    const dataset = this.evaluationDatasets.get(spec.datasetId);
    if (!dataset) {
      throw new Error(`Evaluation dataset not found: ${spec.datasetId}`);
    }
    const evaluationRunId = `eval-run-${String(this.nextEvaluationRunNumber++).padStart(4, "0")}`;
    const attempts: OraEvaluationRunDetail["attempts"] = [];
    const startedAt = Date.now();
    for (const evaluationCase of dataset.cases) {
      for (const config of spec.configs) {
        for (let repetition = 1; repetition <= spec.repetitions; repetition += 1) {
          const handle = this.startRun({
            input: {
              prompt: evaluationCase.input.prompt,
            },
            config: config.runConfig,
          });
          const snapshot = this.getRunState({ runId: handle.runId });
          attempts.push({
            id: `${evaluationRunId}:attempt:${config.id}:${evaluationCase.id}:r${repetition}`,
            evaluationRunId,
            caseId: evaluationCase.id,
            configId: config.id,
            repetition,
            status: snapshot.status === "failed" ? "failed" : "succeeded",
            underlyingRunId: snapshot.runId,
            output: snapshot.output,
            error: snapshot.error,
            score: scoreMockEvaluationCase(spec.profileId, evaluationCase, snapshot),
            metricScores: [],
            evaluatorResults: (spec.objective?.evaluators ?? []).map((evaluator) => ({
              evaluatorId: evaluator.id,
              evaluatorKind: evaluator.kind,
              status: evaluator.kind === "human_annotation" ? "pending" : "scored",
              score: evaluator.kind === "human_annotation" ? undefined : 0.82,
              passed: evaluator.kind === "human_annotation" ? undefined : true,
              rationale: evaluator.kind === "human_annotation" ? "Waiting for human annotation." : "Mock evaluator passed.",
              failureTags: [],
              details: {},
            })),
            observations: buildMockEvaluationObservations(snapshot),
            runtimeMs: Math.max(0, snapshot.updatedAt - (snapshot.events[0]?.createdAt ?? snapshot.updatedAt)),
            costUsd: Number((snapshot.events.length * 0.0002).toFixed(4)),
            startedAt: snapshot.events[0]?.createdAt ?? startedAt,
            updatedAt: snapshot.updatedAt,
          });
          for (const evaluator of spec.objective?.evaluators ?? []) {
            if (evaluator.kind !== "human_annotation") continue;
            const attemptId = `${evaluationRunId}:attempt:${config.id}:${evaluationCase.id}:r${repetition}`;
            const task: OraEvaluationAnnotationTask = {
              id: `annotation-${String(this.nextEvaluationAnnotationNumber++).padStart(4, "0")}`,
              evaluationRunId,
              attemptId,
              caseId: evaluationCase.id,
              configId: config.id,
              evaluatorId: evaluator.id,
              instructions: evaluator.instructions,
              scoreType: evaluator.scoreType,
              categories: evaluator.categories,
              status: "pending",
              input: evaluationCase.input,
              output: snapshot.output,
              expected: evaluationCase.expected,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            this.evaluationAnnotations.set(task.id, task);
          }
        }
      }
    }
    const caseResults = buildMockCaseResults(dataset.cases, spec, attempts, spec.baselineId ? this.evaluationBaselines.get(spec.baselineId) : undefined, this.evaluationRuns);
    const scorecard = buildMockScorecard(spec.configs, attempts, caseResults);
    const run: OraEvaluationRun = {
      id: evaluationRunId,
      spec,
      status: "succeeded",
      totalAttempts: attempts.length,
      completedAttempts: attempts.length,
      failedAttempts: attempts.filter((attempt) => attempt.status === "failed").length,
      attemptIds: attempts.map((attempt) => attempt.id),
      caseResults,
      scorecard,
      startedAt,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    };
    const detail: OraEvaluationRunDetail = {
      run,
      attempts,
      dataset: dataset.dataset,
      configs: spec.configs,
    };
    this.evaluationRuns.set(evaluationRunId, detail);
    return detail;
  }

  private submitEvaluationAnnotation(params: unknown): OraEvaluationAnnotationTask {
    const parsed = params as {
      taskId?: string;
      score?: { value: boolean | number | string; normalizedScore?: number; passed?: boolean; failureTags?: string[] };
      comment?: string;
      correctedOutput?: unknown;
    };
    const current = this.evaluationAnnotations.get(parsed.taskId ?? "");
    if (!current) throw new Error(`Evaluation annotation not found: ${parsed.taskId ?? ""}`);
    const next: OraEvaluationAnnotationTask = {
      ...current,
      status: "submitted",
      score: {
        value: parsed.score?.value ?? 0,
        normalizedScore: parsed.score?.normalizedScore,
        passed: parsed.score?.passed,
        failureTags: parsed.score?.failureTags ?? [],
      },
      comment: parsed.comment,
      correctedOutput: parsed.correctedOutput,
      updatedAt: Date.now(),
      submittedAt: Date.now(),
    };
    this.evaluationAnnotations.set(next.id, next);
    return next;
  }

  private promoteEvaluationBaseline(params: unknown): OraEvaluationBaseline {
    const parsed = params as { evaluationRunId?: string; configId?: string; name?: string };
    const evaluationRunId = parsed.evaluationRunId ?? "";
    const configId = parsed.configId ?? "";
    const detail = this.evaluationRuns.get(evaluationRunId);
    if (!detail) throw new Error(`Evaluation run not found: ${evaluationRunId}`);
    const baseline: OraEvaluationBaseline = {
      id: `baseline-${String(this.nextEvaluationBaselineNumber++).padStart(4, "0")}`,
      name: parsed.name?.trim() || `${detail.dataset.name} · ${configId}`,
      datasetId: detail.run.spec.datasetId,
      profileId: detail.run.spec.profileId,
      configId,
      configSignature: JSON.stringify(detail.configs.find((config) => config.id === configId)?.runConfig ?? {}),
      evaluationRunId,
      createdAt: Date.now(),
    };
    this.evaluationBaselines.set(baseline.id, baseline);
    return baseline;
  }

  private exportEvaluationRun(params: unknown): OraEvaluationExportResult {
    const parsed = params as { evaluationRunId?: string; format?: "json" | "csv" };
    const run = this.evaluationRuns.get(parsed.evaluationRunId ?? "");
    if (!run) throw new Error(`Evaluation run not found: ${parsed.evaluationRunId ?? ""}`);
    if (parsed.format === "csv") {
      const content = [
        "case_id,config_id,overall_score,trace_run_ids",
        ...run.run.caseResults.map((result) => [
          csvCell(result.caseId),
          csvCell(result.configId),
          result.averageScore.overallScore.toFixed(4),
          csvCell(result.traceRunIds.join("|")),
        ].join(",")),
      ].join("\n");
      return { evaluationRunId: run.run.id, format: "csv", content: `${content}\n` };
    }
    return { evaluationRunId: run.run.id, format: "json", content: `${JSON.stringify(run, null, 2)}\n` };
  }

  private submitEvaluationFeedback(params: unknown): OraEvaluationFeedbackRecord {
    const parsed = params as {
      runId?: string;
      sessionId?: string;
      turnIndex?: number;
      messageId?: string;
      feedbackText?: string;
    };
    const runId = parsed.runId ?? "";
    const snapshot = this.runs.get(runId);
    if (!snapshot) throw new Error(`Run not found: ${runId}`);
    const feedbackText = parsed.feedbackText?.trim();
    if (!feedbackText) throw new Error("Feedback text is required.");
    const id = `feedback-${String(this.nextEvaluationFeedbackNumber++).padStart(4, "0")}`;
    const sourceContext = this.buildMockFeedbackSourceContext(snapshot);
    const now = Date.now();
    const record: OraEvaluationFeedbackRecord = {
      id,
      status: "pending",
      feedbackText,
      sourceRunId: runId,
      sourceSessionId: parsed.sessionId ?? snapshot.sessionId,
      sourceTurnIndex: parsed.turnIndex ?? snapshot.turnIndex,
      sourceMessageId: parsed.messageId,
      sourceContext,
      draft: buildMockFeedbackDraft(id, feedbackText, sourceContext),
      createdAt: now,
      updatedAt: now,
    };
    this.evaluationFeedback.set(id, record);
    return record;
  }

  private updateEvaluationFeedback(params: unknown): OraEvaluationFeedbackRecord {
    const parsed = params as {
      feedbackId?: string;
      feedbackText?: string;
      draftCase?: OraEvaluationFeedbackRecord["draft"]["case"];
      curatorRationale?: string;
    };
    const record = this.requireEvaluationFeedback(parsed.feedbackId);
    if (record.status === "accepted" || record.status === "rejected") {
      throw new Error(`Evaluation feedback ${record.id} is already ${record.status}.`);
    }
    const next: OraEvaluationFeedbackRecord = {
      ...record,
      status: "pending",
      feedbackText: parsed.feedbackText?.trim() || record.feedbackText,
      draft: parsed.draftCase
        ? {
            ...record.draft,
            case: parsed.draftCase,
            curatorStatus: "generated",
            curatorRationale: parsed.curatorRationale ?? record.draft.curatorRationale,
            error: undefined,
          }
        : record.draft,
      updatedAt: Date.now(),
    };
    this.evaluationFeedback.set(next.id, next);
    return next;
  }

  private acceptEvaluationFeedback(params: unknown): OraEvaluationFeedbackRecord {
    const parsed = params as { feedbackId?: string; datasetId?: string };
    const record = this.requireEvaluationFeedback(parsed.feedbackId);
    if (record.status === "rejected") throw new Error(`Evaluation feedback ${record.id} was rejected.`);
    if (record.status === "accepted") return record;
    const datasetId = parsed.datasetId ?? "feedback-chat";
    const dataset = this.ensureMockFeedbackDataset(datasetId);
    const evaluationCase = {
      ...record.draft.case,
      metadata: {
        ...record.draft.case.metadata,
        feedbackId: record.id,
        source: "chat_feedback",
        sourceRunId: record.sourceRunId,
        sourceSessionId: record.sourceSessionId,
        sourceTurnIndex: record.sourceTurnIndex,
      },
    };
    const cases = [...dataset.cases, evaluationCase];
    const nextDataset: OraEvaluationDatasetDetail = {
      dataset: {
        ...dataset.dataset,
        caseCount: cases.length,
        updatedAt: Date.now(),
      },
      cases,
      metadataKeys: [...new Set(cases.flatMap((item) => Object.keys(item.metadata ?? {})))].sort((a, b) => a.localeCompare(b)),
      tagCounts: collectMockTagCounts(cases),
    };
    this.evaluationDatasets.set(datasetId, nextDataset);
    const next: OraEvaluationFeedbackRecord = {
      ...record,
      status: "accepted",
      datasetId,
      acceptedCaseId: evaluationCase.id,
      updatedAt: Date.now(),
    };
    this.evaluationFeedback.set(next.id, next);
    return next;
  }

  private rejectEvaluationFeedback(params: unknown): OraEvaluationFeedbackRecord {
    const parsed = params as { feedbackId?: string; reason?: string };
    const record = this.requireEvaluationFeedback(parsed.feedbackId);
    if (record.status === "accepted") throw new Error(`Evaluation feedback ${record.id} is already accepted.`);
    const next: OraEvaluationFeedbackRecord = {
      ...record,
      status: "rejected",
      rejectionReason: parsed.reason?.trim(),
      updatedAt: Date.now(),
    };
    this.evaluationFeedback.set(next.id, next);
    return next;
  }

  private requireEvaluationFeedback(feedbackId: unknown): OraEvaluationFeedbackRecord {
    const id = typeof feedbackId === "string" ? feedbackId : "";
    const record = this.evaluationFeedback.get(id);
    if (!record) throw new Error(`Evaluation feedback not found: ${id}`);
    return record;
  }

  private ensureMockFeedbackDataset(datasetId: string): OraEvaluationDatasetDetail {
    const current = this.evaluationDatasets.get(datasetId);
    if (current) return current;
    const now = Date.now();
    const detail: OraEvaluationDatasetDetail = {
      dataset: {
        id: datasetId,
        name: "Chat Feedback",
        description: "Accepted natural-language chat feedback converted into evaluation cases.",
        sourceFileName: `${datasetId}.json`,
        sourceFormat: "inline",
        schemaVersion: 1,
        caseCount: 0,
        tags: ["chat_feedback"],
        createdAt: now,
        updatedAt: now,
      },
      cases: [],
      metadataKeys: [],
      tagCounts: {},
    };
    this.evaluationDatasets.set(datasetId, detail);
    return detail;
  }

  private buildMockFeedbackSourceContext(snapshot: OraStateSnapshot): Record<string, unknown> {
    return {
      runId: snapshot.runId,
      sessionId: snapshot.sessionId,
      turnIndex: snapshot.turnIndex,
      userPrompt: snapshot.input.prompt,
      assistantOutput: assistantTextFromMockSnapshot(snapshot),
      pattern: snapshot.pattern,
      modeId: snapshot.modeId,
      providerId: snapshot.config.providerId,
      modelRef: snapshot.config.modelRef,
      trail: buildMockRunTrail(snapshot).liveMetrics,
      events: snapshot.events.slice(-12).map((event) => ({
        type: event.type,
        seq: event.seq,
        agentId: event.agentId,
        nodeId: event.nodeId,
      })),
    };
  }

  private getRunState(params: unknown): OraStateSnapshot {
    const runId = asRunId(params);
    const snapshot = this.runs.get(runId);
    if (!snapshot) {
      throw new Error(`Run not found: ${runId}`);
    }
    return snapshot;
  }

  private getRunTrail(params: unknown): OraRunTrail {
    return buildMockRunTrail(this.getRunState(params));
  }

  private transitionRun(
    params: unknown,
    status: "interrupted" | "cancelled",
    type: "run.interrupted" | "run.cancelled",
  ): OraStateSnapshot {
    const { runId, reason } = asLifecycleRunParams(params);
    const snapshot = this.getRunState({ runId });
    const updated = transitionMockLifecycleSnapshot(snapshot, status, type, reason);
    this.runs.set(runId, updated);
    this.updateSessionFromSnapshot(updated);
    return updated;
  }

  private resumeRun(params: unknown): OraStateSnapshot {
    const { runId, reason, patch } = asResumeRunParams(params);
    const snapshot = this.getRunState({ runId });
    const clarificationPatch = patch && isRecord(patch.clarifications)
      ? patch.clarifications as Record<string, unknown>
      : {};
    const resolvedClarificationEvents = snapshot.pendingClarifications
      .filter((clarification) => clarificationPatch[clarification.key] !== undefined || clarificationPatch[clarification.id] !== undefined)
      .map((clarification, index) => createEvent(
        snapshot.runId,
        snapshot.events.length + 1 + index,
        "clarification.resolved",
        {
          clarificationId: clarification.id,
          nodeId: clarification.nodeId,
          answer: clarificationPatch[clarification.key] ?? clarificationPatch[clarification.id],
          mode: "resume",
        },
        snapshot.pattern,
        undefined,
        undefined,
        clarification.nodeId,
      ));
    const resumedEvent = createEvent(
      snapshot.runId,
      snapshot.events.length,
      "run.resumed",
      { reason: reason ?? USER_RESUMED_MESSAGE, patch: patch ?? {} },
      snapshot.pattern,
    );
    const doneEvent = createEvent(
      snapshot.runId,
      snapshot.events.length + 1 + resolvedClarificationEvents.length,
      "run.done",
      { status: "succeeded", summary: "Confirmed. Continuing the run." },
      snapshot.pattern,
    );
    const nextClarifications = Object.keys(clarificationPatch).length > 0
      ? {
          ...(isRecord(snapshot.input.context?.clarifications) ? snapshot.input.context.clarifications : {}),
          ...clarificationPatch,
        }
      : snapshot.input.context?.clarifications;
    const updated = {
      ...snapshot,
      status: "succeeded" as const,
      input: {
        ...snapshot.input,
        context: {
          ...snapshot.input.context,
          ...(nextClarifications ? { clarifications: nextClarifications } : {}),
        },
      },
      topology: {
        ...snapshot.topology,
        nodes: snapshot.topology.nodes.map((node) => ({ ...node, status: "done" as const })),
      },
      plan: snapshot.plan.map((item) => ({ ...item, status: "done" as const })),
      actions: snapshot.actions.map((action) =>
        action.status === "approval_required" ? { ...action, status: "approved" as const } : action,
      ),
      events: [...snapshot.events, resumedEvent, ...resolvedClarificationEvents, doneEvent],
      pendingClarifications: snapshot.pendingClarifications.filter(
        (clarification) => clarificationPatch[clarification.key] === undefined && clarificationPatch[clarification.id] === undefined,
      ),
      updatedAt: doneEvent.createdAt,
    };
    this.runs.set(runId, updated);
    this.updateSessionFromSnapshot(updated);
    return updated;
  }

  private createSnapshot(
    runId: string,
    mode: OraModeSpec,
    prompt: string,
    startedAt: number,
    status: OraStateSnapshot["status"],
    forkedFrom?: { runId: string; checkpointId: string; eventSeq: number },
    provider?: {
      providerId?: string;
      modelRef?: string;
      customAgentId?: string;
      projectId?: string;
      modeSelection?: OraModeSelection;
      autoModeRouter?: Record<string, unknown>;
    },
    sessionId?: string,
    turnIndex = 1,
  ): OraStateSnapshot {
    const pattern = mode.family;
    const definition = modeSpecToPatternDefinition(mode);
    const eventBase = startedAt || Date.parse("2026-04-22T13:00:00.000Z");
    const approvalNodeId = definition.topology.nodes.find((node) => node.kind !== "run")?.id ?? definition.topology.nodes[0]?.id;
    const sidecarActionId = `${runId}:action-sidecar`;
    const sidecarAction = {
      id: sidecarActionId,
      runId,
      planItemId: `${runId}:${definition.planTemplate[1]?.id ?? definition.planTemplate[0].id}`,
      agentId: definition.profiles[1]?.id ?? definition.profiles[0].id,
      type: "runtime.sidecar.preview",
      riskLevel: "medium" as const,
      status: "approval_required" as const,
      input: { command: "ora-runtime-sidecar --transport stdio", ...(approvalNodeId ? { nodeId: approvalNodeId } : {}) },
      artifactIds: [],
    };
    const reportAction = {
      id: `${runId}:action-report`,
      runId,
      agentId: definition.profiles[0].id,
      type: "report.export",
      riskLevel: "low" as const,
      status: status === "succeeded" ? "succeeded" as const : "proposed" as const,
      input: { format: "application/json" },
      output: status === "succeeded" ? { artifactId: `${runId}:report-0` } : undefined,
      artifactIds: status === "succeeded" ? [`${runId}:report-0`] : [],
    };
    const events: OraEventEnvelope[] = [];
    const appendEvent = (
      type: OraEventEnvelope["type"],
      payload: unknown,
      createdAt: number,
      options?: { nodeId?: string; checkpointId?: string },
    ) => {
      events.push(createEvent(runId, events.length, type, payload, pattern, createdAt, options?.checkpointId, options?.nodeId));
    };
    const checkpoint: OraCheckpointMeta = {
      id: `${runId}:checkpoint-0`,
      runId,
      label: status === "succeeded"
        ? "Smoke checkpoint"
        : status === "failed"
          ? "Failed checkpoint"
          : status === "interrupted"
            ? "Interrupted checkpoint"
            : "Preview checkpoint",
      createdAt: eventBase + 5000,
      eventSeq: 0,
      stateHash: `${pattern}:${definition.planTemplate.length}:${definition.topology.nodes.length}`,
    };
    appendEvent("run.started", { message: "Smoke run started.", prompt }, eventBase);
    if (forkedFrom) {
      appendEvent(
        "run.forked",
        { sourceRunId: forkedFrom.runId, checkpointId: forkedFrom.checkpointId, eventSeq: forkedFrom.eventSeq },
        eventBase + 1000,
      );
    }
    appendEvent("topology.updated", definition.topology, eventBase + 1000);
    appendEvent("plan.updated", { items: definition.planTemplate }, eventBase + 2000);
    appendEvent(
      "message.delta",
      { role: "assistant", content: `${definition.label} accepted a local smoke task: ${prompt}` },
      eventBase + 3000,
    );
    if (status === "interrupted") {
      appendEvent(
        "approval.required",
        {
          actionId: sidecarActionId,
          decision: {
            requiredApproval: true,
            reason: "Manual approval is required before this node can continue.",
          },
        },
        eventBase + 3500,
        approvalNodeId ? { nodeId: approvalNodeId } : undefined,
      );
      appendEvent(
        "action.updated",
        {
          actionId: sidecarActionId,
          status: "approval_required",
          record: sidecarAction,
        },
        eventBase + 3600,
        approvalNodeId ? { nodeId: approvalNodeId } : undefined,
      );
    }
    appendEvent(
      "checkpoint.created",
      { checkpoint, summary: "Deterministic checkpoint captured after smoke stream." },
      eventBase + 4000,
      { checkpointId: checkpoint.id },
    );
    if (status === "failed" || status === "succeeded") {
      appendEvent(
        status === "failed" ? "run.failed" : "run.done",
        { status, summary: "Deterministic local smoke run completed." },
        eventBase + 5000,
      );
    }
    checkpoint.eventSeq = events.find((event) => event.type === "checkpoint.created")?.seq ?? Math.max(0, events.length - 1);

    return {
      runId,
      sessionId,
      turnIndex,
      status,
      pattern,
      coordinationKind: pattern,
      modeId: mode.id,
      input: {
        prompt,
        projectId: provider?.projectId,
        context: {},
        createdAt: eventBase,
      },
      config: {
        pattern,
        modeId: mode.id,
        modeSelection: provider?.modeSelection ?? "manual",
        profileIds: definition.profiles.map((profile) => profile.id),
        skillIds: mode.capabilityFlags.skillIds,
        toolIds: mode.capabilityFlags.toolIds,
        providerId: provider?.providerId ?? "local-smoke",
        customAgentId: provider?.customAgentId,
        modelRef: provider?.modelRef ?? "local/smoke-model",
        budget: definition.defaultBudget,
        approvalMode: mode.capabilityFlags.approvalMode,
        permissionMode: "default",
        patternOptions: {},
        metadata: {
          source: "desktop-smoke",
          modeId: mode.id,
          providerId: provider?.providerId ?? "local-smoke",
          ...(provider?.autoModeRouter ? { autoModeRouter: provider.autoModeRouter } : {}),
          ...(provider?.customAgentId ? { customAgentId: provider.customAgentId } : {}),
        },
        deterministicSeed: "ora-smoke",
      },
      topology: {
        nodes: definition.topology.nodes.map((node) => ({
          ...node,
          status: status === "succeeded"
            ? "done"
            : status === "interrupted" && node.id === approvalNodeId
              ? "blocked"
              : node.kind === "run"
                ? "running"
                : node.status,
        })),
        edges: definition.topology.edges,
      },
      profiles: definition.profiles,
      memory: [],
      plan: definition.planTemplate.map((item, index) => ({
        id: `${runId}:${item.id}`,
        runId,
        ownerAgentId: item.ownerAgentId,
        status: status === "succeeded"
          ? "done"
          : status === "interrupted" && index === 1
            ? "blocked"
            : index === 0
              ? "running"
              : "planned",
        title: item.title,
        dependencies: item.dependencies.map((dependency) => `${runId}:${dependency}`),
        linkedActionIds: index === 1 ? [sidecarActionId] : [],
        checkpointIds: [checkpoint.id],
      })),
      planList: [],
      actions: [sidecarAction, reportAction],
      toolCalls: [],
      continuation: { frames: [] },
      planDecisions: [],
      conversation: [],
      toolResults: [],
      policyDecisions: [],
      checkpoints: [checkpoint],
      events,
      agentMessages: buildMockAgentMessages(runId, pattern, definition, eventBase, prompt, mode.id),
      artifacts: [],
      todos: definition.planTemplate.map((item, index) => ({
        id: `${runId}:todo-${index}`,
        runId,
        sourcePlanItemId: `${runId}:${item.id}`,
        status: status === "succeeded"
          ? "done"
          : status === "interrupted" && index === 1
            ? "blocked"
            : index === 0
              ? "running"
              : "planned",
        label: item.title,
        createdAt: eventBase + 400,
        updatedAt: eventBase + (status === "succeeded" ? 5200 : 1800),
      })),
      activeAgents: status === "running" || status === "interrupted" ? definition.profiles.slice(0, 1).map((profile) => profile.id) : [],
    queueSummary: {
      mode: definition.coordinationKind === "bus"
        ? "event_bus"
        : definition.coordinationKind === "shared_state"
            ? "shared_state"
            : definition.coordinationKind === "team"
              ? "backlog"
              : "dag",
        pending: Math.max(0, definition.planTemplate.length - 1),
        inProgress: status === "running" || status === "interrupted" ? 1 : 0,
        completed: status === "succeeded" ? definition.planTemplate.length : 0,
        topics: definition.supportsEventRouting ? ["task.input", "task.findings", "task.response"] : [],
    },
    sharedStateSummary: definition.supportsSharedState
        ? {
            enabled: true,
            storeKind: "blackboard",
            version: 2,
            entries: [
              { key: "seed", version: 1, summary: `Seeded board for ${prompt}` },
              { key: "finding-1", version: 2, summary: "Added supporting evidence" },
            ],
          }
        : {
            enabled: false,
            storeKind: "none",
            version: 0,
            entries: [],
          },
    busStats: definition.supportsEventRouting
        ? {
            enabled: true,
            publishedCount: 2,
            routedCount: 1,
            topicCounts: {
              "task.input": 1,
              "task.findings": 1,
              "task.response": 1,
            },
          }
        : {
            enabled: false,
            publishedCount: 0,
            routedCount: 0,
            topicCounts: {},
          },
    pendingClarifications: [],
    pendingApprovals: status === "interrupted" ? [sidecarActionId] : [],
    modeSpec: mode,
      output: status === "succeeded"
        ? {
            text: mode.id === DEBATE_MODE_ID
              ? `主持人总结：围绕“${prompt}”，正方强调收益、可行性与正当性，反方持续追问证据、边界条件与替代方案。当前更稳妥的结论取决于关键事实是否成立；若事实基础不足，应先补证据，再决定是否采纳正方主张。`
              : `Smoke result for ${mode.label}: ${prompt}`,
          }
        : undefined,
      trace: createMockTraceMetadata(runId, provider?.providerId, provider?.modelRef),
      updatedAt: events.at(-1)?.createdAt ?? eventBase + 4000,
    };
  }

  private updateSessionFromSnapshot(snapshot: OraStateSnapshot) {
    snapshot = this.normalizeMockSnapshot(snapshot);
    this.runs.set(snapshot.runId, snapshot);
    const sessionId = snapshot.sessionId;
    if (!sessionId) return;
    if (isUnadoptedMockBranchCandidate(snapshot)) return;
    const existing = this.sessions.get(sessionId);
    if (!existing) return;
    const updatedSession = {
      ...existing,
      title: existing.turnCount > 0 && existing.title !== "New Chat" ? existing.title : snapshot.input.prompt,
      status: snapshot.status,
      attention: deriveRunAttention(snapshot),
      latestRunId: snapshot.runId,
      latestPattern: snapshot.pattern,
      latestModeId: snapshot.modeId,
      latestProviderId: snapshot.config.providerId,
      latestModelRef: snapshot.config.modelRef,
      projectId: snapshot.input.projectId ?? existing.projectId,
      turnCount: [...this.runs.values()].filter((run) => run.sessionId === sessionId && isVisibleMockMainlineRun(run)).length,
      updatedAt: snapshot.updatedAt,
      archivedAt: existing.archivedAt,
    };
    this.sessions.set(sessionId, updatedSession);
    if (updatedSession.projectId) {
      this.syncProjectSummary(updatedSession.projectId);
    }
  }

  private nextVisibleTurnIndex(sessionId: string): number {
    const last = [...this.runs.values()]
      .filter((run) => run.sessionId === sessionId && isVisibleMockMainlineRun(run))
      .sort((a, b) => (a.turnIndex ?? 1) - (b.turnIndex ?? 1) || a.updatedAt - b.updatedAt)
      .at(-1);
    return (last?.turnIndex ?? 0) + 1;
  }

  private normalizeMockSnapshot(snapshot: OraStateSnapshot): OraStateSnapshot {
    let normalized = snapshot;
    const planCheck = {
      hasSessionId: Boolean(normalized.sessionId),
      isSucceeded: normalized.status === "succeeded",
      taskIntent: normalized.config.metadata.taskIntent,
      hasProposedPlan: snapshotContainsCompleteProposedPlan(normalized),
      noExistingDecision: normalized.planDecisions.length === 0,
    };
    const shouldInject = planCheck.hasSessionId && planCheck.isSucceeded && planCheck.taskIntent === "plan" && planCheck.hasProposedPlan && planCheck.noExistingDecision;
    if (shouldInject) {
      normalized = {
        ...normalized,
        planDecisions: [{
          id: `${normalized.runId}:plan-decision`,
          runId: normalized.runId,
          sessionId: normalized.sessionId!,
          status: "pending",
          createdAt: normalized.updatedAt,
        }],
      };
    }
    return {
      ...normalized,
      attention: deriveRunAttention(normalized),
    };
  }

  private assistantTextForRun(snapshot: OraStateSnapshot): string {
    if (snapshot.output && typeof snapshot.output === "object" && "text" in snapshot.output && typeof snapshot.output.text === "string") {
      return snapshot.output.text;
    }
    const lastMessage = [...snapshot.events].reverse().find((event) =>
      event.type === "message.delta" && isRecord(event.payload) && typeof event.payload.content === "string",
    );
    return lastMessage && isRecord(lastMessage.payload) && typeof lastMessage.payload.content === "string"
      ? lastMessage.payload.content
      : "";
  }

  private syncProjectSummary(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) {
      return;
    }
    const sessions = [...this.sessions.values()].filter((session) =>
      session.projectId === projectId && session.archivedAt === undefined
    );
    this.projects.set(projectId, {
      ...project,
      sessionCount: sessions.length,
      updatedAt: sessions.reduce((max, session) => Math.max(max, session.updatedAt), project.createdAt),
    });
  }

  private resolveMode(modeId: string | undefined, fallbackPattern: CoordinationPattern): OraModeSpec {
    return this.listModes().find((mode) => mode.id === (modeId ?? fallbackPattern))
      ?? this.listModes().find((mode) => mode.family === fallbackPattern)
      ?? MVP_MODES[0]!;
  }
}

function createEvent(
  runId: string,
  seq: number,
  type: OraEventEnvelope["type"],
  payload: unknown,
  pattern: CoordinationPattern,
  createdAt = Date.now(),
  checkpointId?: string,
  nodeId?: string,
): OraEventEnvelope {
  return {
    id: `${runId}:evt-${seq}`,
    runId,
    seq,
    type,
    createdAt,
    pattern,
    nodeId,
    checkpointId,
    payload,
  };
}

export function transitionMockLifecycleSnapshot(
  snapshot: OraStateSnapshot,
  status: "interrupted" | "cancelled",
  type: "run.interrupted" | "run.cancelled",
  reason?: string,
): OraStateSnapshot {
  const lifecycleReason = reason ?? (status === "cancelled" ? USER_CANCELLED_MESSAGE : USER_INTERRUPTED_MESSAGE);
  const event = createEvent(snapshot.runId, snapshot.events.length, type, { status, reason: lifecycleReason }, snapshot.pattern);
  const updatedAt = event.createdAt;
  const topologyStatus = status === "cancelled" ? "failed" as const : "blocked" as const;
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
    status,
    topology: {
      ...snapshot.topology,
      nodes: snapshot.topology.nodes.map((node) => ({ ...node, status: topologyStatus })),
    },
    plan,
    todos,
    events: [...snapshot.events, event],
    actions: snapshot.actions.map((action) =>
      status === "cancelled" && (action.status === "approval_required" || action.status === "running" || action.status === "proposed" || action.status === "approved")
        ? { ...action, status: "denied" as const, error: lifecycleReason }
        : action,
    ),
    toolCalls: snapshot.toolCalls.map((call) =>
      status === "cancelled" && (call.status === "running" || call.status === "proposed" || call.status === "approval_required" || call.status === "approved")
        ? {
            ...call,
            status: "denied" as const,
            updatedAt,
            error: lifecycleReason,
            result: {
              status: "denied" as const,
              error: lifecycleReason,
              content: lifecycleReason,
              createdAt: updatedAt,
              updatedAt,
            },
          }
        : call,
    ),
    pendingApprovals: status === "cancelled" ? [] : snapshot.pendingApprovals,
    activeAgents: status === "cancelled" ? [] : snapshot.activeAgents,
    queueSummary: status === "cancelled"
      ? {
          ...snapshot.queueSummary,
          inProgress: 0,
          pending: plan.filter((item) => item.status !== "done" && item.status !== "skipped").length,
          completed: plan.filter((item) => item.status === "done" || item.status === "skipped").length,
        }
      : snapshot.queueSummary,
    error: status === "cancelled" ? lifecycleReason : snapshot.error,
    updatedAt,
  };
}

function createMockTraceMetadata(
  runId: string,
  providerId?: string,
  modelRef?: string,
): OraRunTraceMetadata {
  return {
    provider: "ora",
    enabled: true,
    available: true,
    traceId: `ora-local-${runId}`,
    rootObservationId: `${runId}:trace-root`,
    source: "local",
    reason: "Ora-native Trails is using local runtime events; Langfuse is optional.",
    generationRefs: [{
      observationId: `${runId}:generation-0`,
      traceId: `ora-local-${runId}`,
      parentObservationId: `${runId}:trace-root`,
      name: "model.local-smoke",
      providerId: providerId ?? "local-smoke",
      providerType: "local_smoke",
      model: modelRef ?? "local/smoke-model",
      latencySeconds: 1.2,
      totalCostUsd: 0,
    }],
  };
}

function buildMockRunTrail(snapshot: OraStateSnapshot): OraRunTrail {
  const trace = snapshot.trace ?? createMockTraceMetadata(snapshot.runId, snapshot.config.providerId, snapshot.config.modelRef);
  const traceId = trace.traceId ?? `trace-${snapshot.runId}`;
  const rootObservationId = trace.rootObservationId ?? `${snapshot.runId}:trace-root`;
  const observations: OraTrailObservation[] = [
    {
      id: rootObservationId,
      traceId,
      parentObservationId: null,
      type: "agent",
      name: `ora.run.${snapshot.pattern}`,
      input: {
        prompt: snapshot.input.prompt,
        config: snapshot.config,
      },
      output: snapshot.output,
      metadata: {
        runId: snapshot.runId,
        pattern: snapshot.pattern,
        modeId: snapshot.modeId,
        source: "desktop-smoke",
      },
      startTime: new Date(snapshot.input.createdAt ?? snapshot.updatedAt).toISOString(),
      endTime: new Date(snapshot.updatedAt).toISOString(),
      latencySeconds: Math.max(0, snapshot.updatedAt - (snapshot.input.createdAt ?? snapshot.updatedAt)) / 1000,
      totalCostUsd: 0,
    },
    ...snapshot.events.map((event) => ({
      id: `${event.id}:obs`,
      traceId,
      parentObservationId: rootObservationId,
      type: event.type === "message.delta" ? "generation" : event.type === "checkpoint.created" ? "event" : "span",
      name: event.type,
      input: event.payload,
      metadata: {
        eventSeq: event.seq,
        agentId: event.agentId,
        nodeId: event.nodeId,
      },
      startTime: new Date(event.createdAt).toISOString(),
      endTime: new Date(event.createdAt).toISOString(),
      ...(event.type === "message.delta"
        ? {
            model: snapshot.config.modelRef,
            totalCostUsd: 0,
            latencySeconds: 0.8,
          }
        : {}),
    })),
  ];
  const liveMetrics: OraRunTrailMetrics = {
    runtimeMs: Math.max(0, snapshot.updatedAt - (snapshot.input.createdAt ?? snapshot.updatedAt)),
    eventCount: snapshot.events.length,
    checkpointCount: snapshot.checkpoints.length,
    topologyChangeCount: snapshot.events.filter((event) => event.type === "topology.updated").length,
    messageCount: snapshot.events.filter((event) => event.type === "message.delta").length,
    activeAgentCount: snapshot.activeAgents.length,
    warningCount: observations.filter((observation) => observation.level === "WARNING").length,
    errorCount: observations.filter((observation) => observation.level === "ERROR").length,
    estimatedCostUsd: trace.generationRefs.reduce((sum, generation) => sum + (generation.totalCostUsd ?? 0), 0),
  };

  return {
    run: {
      runId: snapshot.runId,
      sessionId: snapshot.sessionId,
      turnIndex: snapshot.turnIndex,
      status: snapshot.status,
      pattern: snapshot.pattern,
      modeId: snapshot.modeId,
      prompt: snapshot.input.prompt,
      startedAt: snapshot.input.createdAt ?? snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
      eventCount: snapshot.events.length,
      checkpointCount: snapshot.checkpoints.length,
      artifactCount: snapshot.artifacts.length,
    },
    trace,
    observations,
    liveMetrics,
  };
}

function asRunId(params: unknown): string {
  if (typeof params === "object" && params !== null && "runId" in params) {
    const runId = (params as { runId: unknown }).runId;
    if (typeof runId === "string" && runId.length > 0) {
      return runId;
    }
  }
  throw new Error("Missing runId");
}

function asStartRunParams(params: unknown): { input: OraUserTaskInput; config?: Partial<OraRunConfig>; sessionId?: string } {
  if (typeof params !== "object" || params === null || !("input" in params)) {
    throw new Error("Missing start run input");
  }

  const input = (params as { input: OraUserTaskInput }).input;
  if (!input || typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
    throw new Error("Start run prompt is required");
  }

  return params as { input: OraUserTaskInput; config?: Partial<OraRunConfig>; sessionId?: string };
}

function asResumeRunParams(params: unknown): { runId: string; reason?: string; patch?: Record<string, unknown> } {
  const runId = asRunId(params);
  if (typeof params !== "object" || params === null) {
    return { runId };
  }
  const reason = "reason" in params && typeof params.reason === "string" ? params.reason : undefined;
  const patch = "patch" in params && isRecord(params.patch) ? params.patch : undefined;
  return { runId, reason, patch };
}

function asLifecycleRunParams(params: unknown): { runId: string; reason?: string } {
  const runId = asRunId(params);
  if (typeof params !== "object" || params === null) {
    return { runId };
  }
  const reason = "reason" in params && typeof params.reason === "string" ? params.reason : undefined;
  return { runId, reason };
}

function asForkRunParams(params: unknown): {
  runId: string;
  checkpointId: string;
  input?: Partial<OraUserTaskInput>;
  config?: Partial<OraRunConfig>;
} {
  const runId = asRunId(params);
  if (typeof params !== "object" || params === null || !("checkpointId" in params)) {
    throw new Error("Missing checkpointId");
  }
  const checkpointId = (params as { checkpointId: unknown }).checkpointId;
  if (typeof checkpointId !== "string" || checkpointId.length === 0) {
    throw new Error("Missing checkpointId");
  }
  return params as {
    runId: string;
    checkpointId: string;
    input?: Partial<OraUserTaskInput>;
    config?: Partial<OraRunConfig>;
  };
}

function asReplayRunParams(params: unknown): { runId: string; checkpointId?: string } {
  const runId = asRunId(params);
  if (typeof params !== "object" || params === null || !("checkpointId" in params)) {
    return { runId };
  }
  const checkpointId = (params as { checkpointId?: unknown }).checkpointId;
  return typeof checkpointId === "string" && checkpointId.length > 0 ? { runId, checkpointId } : { runId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnadoptedMockBranchCandidate(run: OraStateSnapshot): boolean {
  return run.config.metadata.branchRole === "candidate";
}

function isVisibleMockMainlineRun(run: OraStateSnapshot): boolean {
  return !isUnadoptedMockBranchCandidate(run) && typeof run.config.metadata.supersededByRunId !== "string";
}

function previousVisibleMockRunBefore(sessionId: string, runId: string, runs: OraStateSnapshot[]): OraStateSnapshot | undefined {
  const visibleRuns = runs
    .filter((run) => run.sessionId === sessionId && isVisibleMockMainlineRun(run))
    .sort((a, b) => (a.turnIndex ?? 1) - (b.turnIndex ?? 1) || a.updatedAt - b.updatedAt);
  const index = visibleRuns.findIndex((run) => run.runId === runId);
  return index > 0 ? visibleRuns[index - 1] : undefined;
}

function buildMockBranchGroups(sessionId: string, runs: OraStateSnapshot[]): OraSessionBranchGroup[] {
  return deriveSessionBranchGroupsForSession(sessionId, runs);
}

function branchTargetValue(value: unknown): OraSessionBranchGroup["target"] {
  return value === "empty_start" || value === "append_after_latest" || value === "replace_latest"
    ? value
    : "append_after_latest";
}

function createMockPackageStore(): OraPackageStoreSnapshot {
  return {
    rootPath: "/browser-mock/versions",
    active: {
      activeVersionId: "bundled",
      channel: "bundled",
      activatedAt: 0,
      compatibilityStatus: "compatible",
    },
    packages: [
      {
        versionId: "bundled",
        semver: "0.1.0",
        status: "active",
        channel: "bundled",
        gitCommit: "browser-mock",
        builtAt: 0,
        activatedAt: 0,
        hostAbiVersion: ORA_HOST_ABI_VERSION,
        runtimeAbiVersion: ORA_RUNTIME_ABI_VERSION,
        slotPath: "/browser-mock/versions/bundled",
        frontendDistPath: "/browser-mock/versions/bundled/frontend",
        runtimeSidecarPath: "/browser-mock/versions/bundled/runtime-sidecar",
        buildLogPath: "/browser-mock/versions/bundled/build.log",
        verification: {
          status: "passed",
          checkedAt: 0,
          commands: [],
          logPath: "/browser-mock/versions/bundled/build.log",
          errors: [],
        },
        migrationNotes: ["Browser fallback package slot."],
      },
    ],
  };
}

function requireMockVersionId(params: unknown): string {
  if (!isRecord(params) || typeof params.versionId !== "string" || !params.versionId.trim()) {
    throw new Error("Package versionId is required.");
  }
  return params.versionId.trim();
}

function replaceMockPackage(store: OraPackageStoreSnapshot, manifest: OraPackageManifest): OraPackageStoreSnapshot {
  return {
    ...store,
    packages: store.packages.map((item) => item.versionId === manifest.versionId ? manifest : item),
  };
}

function normalizeMockAgentName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Custom agent name is required.");
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    throw new Error("Custom agent names must contain only letters, digits, and hyphens.");
  }
  return normalized;
}

function parseMockStringList(value: unknown, mode: "required" | "optional" = "required"): string[] | undefined {
  if (!Array.isArray(value)) {
    return mode === "optional" ? undefined : [];
  }
  return [...new Set(value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim()))];
}

function slugifyMockAgentName(value: string): string {
  if (/香港|hk|hong kong/i.test(value) && /研究|research|市场|market/i.test(value)) {
    return "researcher-hk";
  }
  if (/研究|research|资料|来源/i.test(value)) {
    return "research-agent";
  }
  if (/代码|code|审查|review|pr/i.test(value)) {
    return "code-review-agent";
  }
  const tokens = value
    .trim()
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]+/g, " agent ")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 4);
  return tokens.length > 0 ? tokens.join("-") : "custom-agent";
}

function uniqueMockAgentName(baseName: string, exists: (name: string) => boolean): string {
  if (!exists(baseName)) {
    return baseName;
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${baseName}-${index}`;
    if (!exists(candidate)) {
      return candidate;
    }
  }
  return `${baseName}-${Date.now()}`;
}

interface MockModeStudioRole {
  id: string;
  label: string;
  role: string;
}

function modeStudioMockPrompt(params: unknown): string {
  const messages = isRecord(params) && Array.isArray(params.messages) ? params.messages : [];
  return messages
    .filter((message): message is { role: string; content: string } =>
      isRecord(message) && typeof message.role === "string" && typeof message.content === "string"
    )
    .map((message) => `${message.role}: ${message.content.trim()}`)
    .filter(Boolean)
    .join("\n") || "Mode Studio builder request";
}

function mockModeStudioFamily(text: string): CoordinationPattern {
  if (/(parallel|team|roles|multiple|多个|并行|分工|团队)/i.test(text)) return "agent_teams";
  if (/(verify|review|critic|审核|审查|验证|互审|严格)/i.test(text)) return "generator_verifier";
  if (/(route|event|bus|路由|事件|消息)/i.test(text)) return "message_bus";
  if (/(shared|blackboard|state|memory|共享|黑板|状态|记忆)/i.test(text)) return "shared_state";
  return "orchestrator_subagent";
}

function mockModeStudioRoles(family: CoordinationPattern): MockModeStudioRole[] {
  if (family === "generator_verifier") {
    return [
      { id: "generator", label: "Generator", role: "Produce the candidate result." },
      { id: "verifier", label: "Verifier", role: "Review the result against acceptance criteria." },
    ];
  }
  if (family === "agent_teams") {
    return [
      { id: "team_lead", label: "Team Lead", role: "Coordinate the agent roster." },
      { id: "builder", label: "Builder", role: "Complete assigned work." },
      { id: "reviewer", label: "Reviewer", role: "Validate outputs and risks." },
    ];
  }
  if (family === "message_bus") {
    return [
      { id: "router", label: "Router", role: "Route events to handlers." },
      { id: "researcher", label: "Researcher", role: "Handle routed work and publish findings." },
      { id: "responder", label: "Responder", role: "Synthesize final response." },
    ];
  }
  if (family === "shared_state") {
    return [
      { id: "orchestrator", label: "Orchestrator", role: "Seed shared state." },
      { id: "researcher", label: "Researcher", role: "Add findings to shared state." },
      { id: "reviewer", label: "Reviewer", role: "Validate convergence." },
    ];
  }
  return [
    { id: "orchestrator", label: "Orchestrator", role: "Plan, delegate, and synthesize." },
    { id: "researcher", label: "Research Subagent", role: "Gather focused context." },
    { id: "reviewer", label: "Review Subagent", role: "Check completeness and risks." },
  ];
}

function mockModeStudioOwner(template: OraModeSpec["nodes"][number]["template"], roles: MockModeStudioRole[]): string | undefined {
  const ids = new Set(roles.map((role) => role.id));
  if ((template === "verify" || template === "review" || template === "check") && ids.has("verifier")) return "verifier";
  if ((template === "verify" || template === "review" || template === "check") && ids.has("reviewer")) return "reviewer";
  if ((template === "draft" || template === "build") && ids.has("generator")) return "generator";
  if ((template === "draft" || template === "build") && ids.has("builder")) return "builder";
  if ((template === "research" || template === "handle") && ids.has("researcher")) return "researcher";
  if ((template === "decompose" || template === "synthesize") && ids.has("orchestrator")) return "orchestrator";
  if ((template === "triage" || template === "handoff") && ids.has("team_lead")) return "team_lead";
  if ((template === "route" || template === "publish") && ids.has("router")) return "router";
  if (template === "respond" && ids.has("responder")) return "responder";
  if (template === "seed" && ids.has("orchestrator")) return "orchestrator";
  return roles[0]?.id;
}

function normalizeMockSkillName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Skill name is required.");
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw new Error("Skill names must be lowercase hyphen-case.");
  }
  return normalized;
}

function normalizeMockSkillFilePath(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Skill file path is required.");
  }
  const normalized = value.trim().replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (
    normalized === "SKILL.md" ||
    normalized.startsWith("/") ||
    parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))
  ) {
    throw new Error(`Skill package file path '${value}' must be a visible relative path inside the skill directory.`);
  }
  return parts.join("/");
}

function classifyMockSkillFile(filePath: string): "script" | "agent" | "template" | "asset" | "reference" | "other" {
  const [folder] = filePath.split("/");
  if (folder === "scripts") return "script";
  if (folder === "agents") return "agent";
  if (folder === "templates") return "template";
  if (folder === "assets") return "asset";
  if (folder === "references" || folder === "docs") return "reference";
  return "other";
}

function readMockSkillFiles(name: string, value: unknown, now: number) {
  const descriptors: NonNullable<OraSkillDetail["files"]> = [];
  const contents = new Map<string, { content: string; executable?: boolean }>();
  if (!Array.isArray(value)) {
    return { descriptors, contents };
  }
  for (const item of value) {
    if (!isRecord(item) || typeof item.content !== "string") {
      throw new Error(`Skill '${name}' file content is required.`);
    }
    const filePath = normalizeMockSkillFilePath(item.path);
    const executable = item.executable === true;
    descriptors.push({
      path: filePath,
      kind: classifyMockSkillFile(filePath),
      size: item.content.length,
      updatedAt: now,
      executable,
    });
    contents.set(filePath, { content: item.content, executable });
  }
  return {
    descriptors: descriptors.sort((left, right) => left.path.localeCompare(right.path)),
    contents,
  };
}

function upsertMockSkillFileDescriptor(
  files: NonNullable<OraSkillDetail["files"]>,
  filePath: string,
  content: string,
  executable: boolean,
): NonNullable<OraSkillDetail["files"]> {
  const next = files.filter((file) => file.path !== filePath);
  next.push({
    path: filePath,
    kind: classifyMockSkillFile(filePath),
    size: content.length,
    updatedAt: Date.now(),
    executable,
  });
  return next.sort((left, right) => left.path.localeCompare(right.path));
}

function defaultMockSkillContent(name: string, description: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description.trim() || "Describe what this skill helps the agent do."}`,
    "---",
    "",
    `# ${name}`,
    "",
    description.trim() || "Describe the workflow, rules, and examples for this skill.",
    "",
  ].join("\n");
}

function parseMockSkillContent(expectedName: string, content: string): { description: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    throw new Error("Skill content must start with YAML frontmatter.");
  }
  const frontmatter: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (item) {
      frontmatter[item[1]!] = (item[2] ?? "").trim().replace(/^["']|["']$/g, "");
    }
  }
  const name = normalizeMockSkillName(frontmatter.name);
  if (name !== expectedName) {
    throw new Error(`Frontmatter name '${name}' must match requested skill name '${expectedName}'.`);
  }
  const description = frontmatter.description?.trim();
  if (!description) {
    throw new Error("Skill frontmatter description is required.");
  }
  return { description };
}

function compileMockEvaluationBlueprint(
  blueprint: OraEvaluationBlueprint,
  overrides: { datasetId?: string; providerId?: string; modelRef?: string; modeIds?: string[] } = {},
): OraEvaluationBlueprintCompileResult {
  const datasetId = overrides.datasetId ?? blueprint.datasetPlan.datasetId ?? blueprint.datasetPlan.linkedDatasetIds[0];
  if (!datasetId) throw new Error(`Evaluation blueprint ${blueprint.id} is missing a dataset.`);
  const providerId = overrides.providerId ?? blueprint.runPlan.providerId ?? "local-smoke";
  const modelRef = overrides.modelRef ?? blueprint.runPlan.modelRef ?? "local/smoke-model";
  const evaluators = blueprint.evaluatorPlan.evaluators.length > 0
    ? blueprint.evaluatorPlan.evaluators
    : [{
        id: "heuristic",
        kind: "heuristic" as const,
        label: "Heuristic Rules",
        metrics: blueprint.evaluatorPlan.metrics,
        assertions: blueprint.evaluatorPlan.assertions,
        weight: 1,
        metadata: {},
      }];
  const baseMetadata = {
    blueprintId: blueprint.id,
    blueprintRecipe: blueprint.recipe,
    blueprintTitle: blueprint.title,
  };
  if (blueprint.recipe === "auto_router_quality") {
    return {
      blueprint,
      spec: {
        datasetId,
        profileId: blueprint.runPlan.profileId,
        objective: {
          kind: "classification",
          target: "runtime.mode_selection",
          metrics: blueprint.evaluatorPlan.metrics.length > 0
            ? blueprint.evaluatorPlan.metrics
            : ["exact_match", "acceptable_match", "assertion_pass_rate", "fallback_rate", "confidence_calibration"],
          assertions: blueprint.evaluatorPlan.assertions,
          evaluators,
          displayColumns: [
            "runtime.modeId",
            "runtime.autoModeRouter.status",
            "runtime.autoModeRouter.confidence",
            "runtime.autoModeRouter.reason",
          ],
          metadata: { blueprintId: blueprint.id },
        },
        configs: [{
          id: `auto-router-${providerId}`,
          label: `Auto Router · ${providerId}`,
          runConfig: {
            pattern: "orchestrator_subagent",
            modeSelection: "auto",
            providerId,
            modelRef,
            providerConfig: blueprint.runPlan.providerConfig as OraProviderConfig | undefined,
            metadata: {
              ...baseMetadata,
              providerId,
              evaluationRouterOnly: true,
            },
          },
        }],
        repetitions: blueprint.runPlan.repetitions,
        concurrency: blueprint.runPlan.concurrency,
        baselineId: blueprint.runPlan.baselineId,
        metadata: baseMetadata,
      },
      warnings: [],
      assumptions: blueprint.assumptions,
    };
  }
  const subjectModeIds = blueprint.subject.kind === "mode_matrix" ? blueprint.subject.modeIds : [];
  const modeIds = overrides.modeIds ?? subjectModeIds;
  if (modeIds.length === 0) throw new Error(`Evaluation blueprint ${blueprint.id} needs at least one Agent mode.`);
  return {
    blueprint,
    spec: {
      datasetId,
      profileId: blueprint.runPlan.profileId,
      objective: {
        kind: "outcome",
        target: blueprint.target,
        metrics: blueprint.evaluatorPlan.metrics,
        assertions: blueprint.evaluatorPlan.assertions,
        evaluators,
        displayColumns: [],
        metadata: { blueprintId: blueprint.id },
      },
      configs: modeIds.map((modeId) => ({
        id: `${modeId}-${providerId}`,
        label: `${modeId.replace(/_/g, " ")} · ${providerId}`,
        runConfig: {
          pattern: modeId as CoordinationPattern,
          providerId,
          modelRef,
          providerConfig: blueprint.runPlan.providerConfig as OraProviderConfig | undefined,
          metadata: baseMetadata,
        },
      })),
      repetitions: blueprint.runPlan.repetitions,
      concurrency: blueprint.runPlan.concurrency,
      baselineId: blueprint.runPlan.baselineId,
      metadata: baseMetadata,
    },
    warnings: [],
    assumptions: blueprint.assumptions,
  };
}

function draftMockEvaluationBlueprint(params: {
  id: string;
  now: number;
  goal: string;
  recipe?: OraEvaluationBlueprint["recipe"];
  datasetId?: string;
  providerId?: string;
  modelRef?: string;
}): OraEvaluationBlueprint {
  const recipe = params.recipe ?? inferMockRecipeFromGoal(params.goal);
  if (recipe === "auto_router_quality") {
    return {
      id: params.id,
      title: "Auto Router Quality",
      goal: params.goal.trim(),
      recipe,
      target: "runtime.mode_selection",
      subject: { kind: "auto_router" },
      datasetPlan: {
        datasetId: params.datasetId,
        sources: params.datasetId ? ["existing_dataset"] : ["file_import", "synthetic"],
        caseRequirements: ["single-turn easy cases", "mode-specific cases", "ambiguous fallback cases", "multi-turn context shift cases"],
        linkedDatasetIds: params.datasetId ? [params.datasetId] : [],
        metadata: {},
      },
      evaluatorPlan: {
        metrics: ["exact_match", "acceptable_match", "assertion_pass_rate", "fallback_rate", "confidence_calibration"],
        assertions: [],
        evaluators: [],
        metadata: {},
      },
      runPlan: {
        profileId: "outcome",
        providerId: params.providerId ?? "local-smoke",
        modelRef: params.modelRef ?? "local/smoke-model",
        repetitions: 1,
        concurrency: 1,
        routerOnly: true,
        exportFormats: ["json", "csv"],
        metadata: {},
      },
      reviewPlan: {
        emphasis: ["selected mode distribution", "fallback count", "confidence distribution", "case-level reasons"],
        failureTags: ["wrong_mode", "unexpected_fallback", "low_confidence"],
        includeTraceLinks: true,
        recommendedActions: ["add failed cases", "promote baseline"],
        metadata: {},
      },
      status: "draft",
      assumptions: ["Router-only execution stops after mode selection."],
      missingInformation: params.datasetId ? [] : ["Select or import a router dataset."],
      linkedRunIds: [],
      schemaVersion: 1,
      createdAt: params.now,
      updatedAt: params.now,
    };
  }
  return {
    id: params.id,
    title: "Agent Mode Comparison",
    goal: params.goal.trim(),
    recipe: "mode_comparison",
    target: "run.output",
    subject: { kind: "mode_matrix", modeIds: ["orchestrator_subagent", "agent_teams"] },
    datasetPlan: {
      datasetId: params.datasetId,
      sources: params.datasetId ? ["existing_dataset"] : ["file_import", "feedback_inbox"],
      caseRequirements: ["representative cases", "known regressions", "edge cases"],
      linkedDatasetIds: params.datasetId ? [params.datasetId] : [],
      metadata: {},
    },
    evaluatorPlan: {
      metrics: ["text_similarity", "assertion_pass_rate", "latency_score", "cost_score"],
      assertions: [],
      evaluators: [],
      metadata: {},
    },
    runPlan: {
      profileId: "outcome",
      providerId: params.providerId ?? "local-smoke",
      modelRef: params.modelRef ?? "local/smoke-model",
      repetitions: 1,
      concurrency: 1,
      routerOnly: false,
      exportFormats: ["json", "csv"],
      metadata: {},
    },
    reviewPlan: {
      emphasis: ["scorecard", "config comparison", "failure tags", "trace links"],
      failureTags: ["output_mismatch", "process_issue", "regression"],
      includeTraceLinks: true,
      recommendedActions: ["inspect low-score cases", "promote best stable config"],
      metadata: {},
    },
    status: "draft",
    assumptions: ["Mode ids map to current coordination pattern ids in the browser fallback."],
    missingInformation: params.datasetId ? [] : ["Select or import a dataset."],
    linkedRunIds: [],
    schemaVersion: 1,
    createdAt: params.now,
    updatedAt: params.now,
  };
}

function inferMockRecipeFromGoal(goal: string): OraEvaluationBlueprint["recipe"] {
  const lowered = goal.toLowerCase();
  return lowered.includes("router") || lowered.includes("路由") || lowered.includes("auto mode") || lowered.includes("mode selection")
    ? "auto_router_quality"
    : "mode_comparison";
}

function inferMockDatasetFormat(sourceFileName?: string): "json" | "jsonl" | "csv" | "inline" {
  const lowered = sourceFileName?.toLowerCase() ?? "";
  if (lowered.endsWith(".jsonl")) return "jsonl";
  if (lowered.endsWith(".csv")) return "csv";
  if (lowered.endsWith(".json")) return "json";
  return "inline";
}

function normalizeMockEvaluationCases(content: string, format: "json" | "jsonl" | "csv" | "inline") {
  const records = format === "csv"
    ? parseMockCsvContent(content)
    : format === "jsonl"
      ? content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
      : (() => {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) return parsed;
          if (isRecord(parsed) && Array.isArray(parsed.cases)) return parsed.cases;
          throw new Error("Mock dataset import expects an array or { cases: [...] }.");
        })();
  return records.map((record, index) => {
    if (!isRecord(record)) throw new Error(`Invalid evaluation case at index ${index}.`);
    const prompt = typeof record.prompt === "string"
      ? record.prompt
      : typeof record.input === "string"
        ? record.input
        : isRecord(record.input) && typeof record.input.prompt === "string"
          ? record.input.prompt
          : "";
    if (!prompt.trim()) {
      throw new Error(`Evaluation case ${String(record.id ?? index + 1)} is missing a prompt/input.`);
    }
    const expected = typeof record.expected === "string"
      ? { text: record.expected }
      : isRecord(record.expected)
        ? {
            text: typeof record.expected.text === "string" ? record.expected.text : undefined,
            structured: record.expected.structured,
          }
        : undefined;
    const metadata = isRecord(record.metadata)
      ? record.metadata
      : (() => {
          const extras: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(record)) {
            if (!["id", "prompt", "input", "expected"].includes(key)) extras[key] = value;
          }
          if (typeof record.metadata_json === "string" && record.metadata_json.trim()) {
            return JSON.parse(record.metadata_json) as Record<string, unknown>;
          }
          return extras;
        })();
    return {
      id: String(record.id ?? `case-${index + 1}`),
      input: {
        prompt: prompt.trim(),
        context: isRecord(record.input) && isRecord(record.input.context) ? record.input.context : {},
      },
      expected,
      metadata,
    };
  });
}

function parseMockCsvContent(content: string): Record<string, string>[] {
  const rows = content.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]!;
      const next = line[index + 1];
      if (char === "\"") {
        if (inQuotes && next === "\"") {
          current += "\"";
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === "," && !inQuotes) {
        parts.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    parts.push(current);
    return parts;
  });
  const [header, ...records] = rows;
  return records.map((row) => {
    const record: Record<string, string> = {};
    header?.forEach((key, index) => {
      record[key.trim()] = row[index] ?? "";
    });
    return record;
  });
}

function normalizeMockProjectPath(value: string): string {
  return value.trim().replace(/[\\/]+$/, "");
}

function defaultMockProjectLabel(rootPath: string): string {
  const normalized = normalizeMockProjectPath(rootPath);
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function assistantTextFromMockSnapshot(snapshot: OraStateSnapshot): string {
  if (snapshot.output && typeof snapshot.output === "object" && "text" in snapshot.output && typeof snapshot.output.text === "string") {
    return snapshot.output.text;
  }
  const lastMessage = [...snapshot.events].reverse().find((event) =>
    event.type === "message.delta" && isRecord(event.payload) && typeof event.payload.content === "string",
  );
  return lastMessage && isRecord(lastMessage.payload) && typeof lastMessage.payload.content === "string"
    ? lastMessage.payload.content
    : "";
}

function buildMockFeedbackDraft(
  feedbackId: string,
  feedbackText: string,
  sourceContext: Record<string, unknown>
): OraEvaluationFeedbackRecord["draft"] {
  const feedbackLower = feedbackText.toLowerCase();
  const failureMode = inferMockFeedbackFailureMode(feedbackLower);
  const severity = inferMockFeedbackSeverity(feedbackLower);
  const sourceRunId = typeof sourceContext.runId === "string" ? sourceContext.runId : undefined;
  const sourceSessionId = typeof sourceContext.sessionId === "string" ? sourceContext.sessionId : undefined;
  const sourceTurnIndex = typeof sourceContext.turnIndex === "number" ? sourceContext.turnIndex : undefined;
  const prompt = typeof sourceContext.userPrompt === "string" && sourceContext.userPrompt.trim()
    ? sourceContext.userPrompt
    : "Review the original Ora chat turn using the attached feedback.";
  return {
    curatorStatus: "fallback",
    curatorRationale: "Browser fallback generated a deterministic feedback draft.",
    case: {
      id: `feedback-case-${feedbackId.replace(/^feedback-/, "")}`,
      input: {
        prompt,
        context: {
          userFeedback: feedbackText,
          sourceAssistantOutput: sourceContext.assistantOutput,
          sourceContext,
        },
      },
      expected: {
        structured: {
          failureMode,
          severity,
          idealBehavior: "Address the user's feedback while preserving the original task intent.",
          mustAddress: [feedbackText],
          shouldAvoid: ["Repeating the same issue identified by the user."],
          rubric: [{
            criterion: "feedback_resolution",
            weight: 1,
            description: "The response resolves the concrete issue described in the user feedback.",
          }],
        },
      },
      metadata: {
        source: "chat_feedback",
        feedbackId,
        sourceRunId,
        sourceSessionId,
        sourceTurnIndex,
        failureMode,
        severity,
        tags: ["chat_feedback", failureMode, severity],
      },
    },
  };
}

function inferMockFeedbackFailureMode(feedbackLower: string) {
  if (/(format|格式|结构|排版|json|表格|citation|引用)/i.test(feedbackLower)) return "bad_format";
  if (/(tool|工具|搜索|文件|轨迹|trace|process|流程)/i.test(feedbackLower)) return "tool_process_issue";
  if (/(unsafe|危险|删除|权限|approval|安全)/i.test(feedbackLower)) return "safety_issue";
  if (/(miss|漏|没有|忽略|requirement|需求|要求)/i.test(feedbackLower)) return "missed_requirement";
  if (/(wrong|错误|不对|事实|hallucinat|幻觉)/i.test(feedbackLower)) return "factual_error";
  if (/(reason|逻辑|推理|分析)/i.test(feedbackLower)) return "poor_reasoning";
  return "user_reported_issue";
}

function inferMockFeedbackSeverity(feedbackLower: string) {
  if (/(critical|严重|危险|不能用|block|阻塞|错得离谱)/i.test(feedbackLower)) return "high";
  if (/(minor|小问题|轻微|typo|错别字)/i.test(feedbackLower)) return "low";
  return "medium";
}

function collectMockTagCounts(cases: OraEvaluationDatasetDetail["cases"]): Record<string, number> {
  return cases.reduce<Record<string, number>>((acc, item) => {
    const tags = Array.isArray(item.metadata?.tags) ? item.metadata.tags : [];
    for (const tag of tags) {
      if (typeof tag === "string") acc[tag] = (acc[tag] ?? 0) + 1;
    }
    return acc;
  }, {});
}

function buildMockAgentMessages(
  runId: string,
  pattern: CoordinationPattern,
  definition: OraPatternDefinition,
  baseTime: number,
  prompt: string,
  modeId?: string,
): OraStateSnapshot["agentMessages"] {
  const owner = (templateId: string, fallback: string) =>
    definition.planTemplate.find((item) => item.id === templateId)?.ownerAgentId ?? fallback;
  const message = (
    index: number,
    params: Omit<OraStateSnapshot["agentMessages"][number], "id" | "runId" | "createdAt" | "artifactIds" | "status"> & {
      status?: OraStateSnapshot["agentMessages"][number]["status"];
    },
  ): OraStateSnapshot["agentMessages"][number] => ({
    id: `${runId}:agent-message:${index}`,
    runId,
    createdAt: baseTime + 1200 + index * 700,
    status: params.status ?? "done",
    artifactIds: [],
    ...params,
  });

  if (modeId === DEBATE_MODE_ID) {
    const debateTurns = [
      { speakerLabel: "正方主辩", stageId: "affirmative-lead-opening", stageLabel: "开篇立论", stance: "affirmative" as const, content: `正方主辩：我方支持“${prompt}”。核心理由是它能带来明确收益，并且反方必须证明风险高到足以推翻该收益。` },
      { speakerLabel: "反方主辩", stageId: "negative-lead-opening", stageLabel: "开篇立论", stance: "negative" as const, content: `反方主辩：我方反对。正方尚未证明收益可持续，也没有排除成本、误用和替代方案。` },
      { speakerLabel: "正方第一副辩", stageId: "affirmative-deputy-one", stageLabel: "第一副辩", stance: "affirmative" as const, content: "正方第一副辩：反方指出风险，但没有证明风险必然发生；合理边界和验证机制足以降低主要疑虑。" },
      { speakerLabel: "反方第一副辩", stageId: "negative-deputy-one", stageLabel: "第一副辩", stance: "negative" as const, content: "反方第一副辩：正方把“可以控制”当成“已经可控”，这正是论证缺口；没有执行证据，收益判断过早。" },
      { speakerLabel: "正方第二副辩", stageId: "affirmative-deputy-two", stageLabel: "第二副辩", stance: "affirmative" as const, content: "正方第二副辩：我方承认需要验证，但这支持分阶段推进，而不是直接否定命题。" },
      { speakerLabel: "反方第二副辩", stageId: "negative-deputy-two", stageLabel: "第二副辩", stance: "negative" as const, content: "反方第二副辩：分阶段推进仍需先说明停止条件和失败成本，否则只是把风险后移。" },
      { speakerLabel: "正方主辩", stageId: "affirmative-lead-final", stageLabel: "总结陈词", stance: "affirmative" as const, content: "正方主辩总结：反方的质疑要求更好治理，但没有推翻命题本身；最强结论是审慎推进。" },
      { speakerLabel: "反方主辩", stageId: "negative-lead-final", stageLabel: "总结陈词", stance: "negative" as const, content: "反方主辩总结：正方仍依赖未验证假设；在关键证据补齐前，不应把命题当作成立。" },
      { speakerLabel: "主持人总结", stageId: "moderator-synthesis", stageLabel: "主持总结", stance: "moderator" as const, content: `主持人总结：围绕“${prompt}”，正方胜在提出可推进路径，反方胜在指出证据和边界缺口。结论应取决于关键事实能否被验证。` },
    ];
    return debateTurns.map((turn, index) => message(index, {
      fromAgentId: turn.stance === "moderator" ? "moderator" : "debate_agent",
      toAgentIds: [turn.stance === "moderator" ? "debate_agent" : "moderator"],
      replyToId: index > 0 ? `${runId}:agent-message:${index - 1}` : undefined,
      threadId: `${runId}:debate`,
      nodeId: turn.stance === "moderator" ? "synthesis" : "debate",
      planItemId: turn.stance === "moderator" ? "synthesis" : "debate",
      kind: "reply",
      content: turn.content,
      transcript: {
        kind: "stage_transcript",
        groupId: "debate",
        groupLabel: "结构化辩论",
        stageId: turn.stageId,
        stageLabel: turn.stageLabel,
        sequence: index,
        speakerLabel: turn.speakerLabel,
        speakerId: turn.stageId,
        stance: turn.stance,
        status: "done",
      },
    }));
  }

  if (pattern === "orchestrator_subagent") {
    const orchestrator = owner("decompose", "orchestrator");
    const researcher = owner("research", "researcher");
    const reviewer = owner("review", "reviewer");
    return [
      message(0, {
        fromAgentId: ORA_ROOT_AGENT_ID,
        toAgentIds: [orchestrator],
        threadId: `${runId}:ora-handoff`,
        nodeId: ORA_ROOT_AGENT_ID,
        kind: "handoff",
        content: `${ORA_ROOT_AGENT_LABEL} is handing this request to ${orchestrator}.`,
      }),
      message(1, {
        fromAgentId: orchestrator,
        toAgentIds: [researcher, reviewer],
        replyToId: `${runId}:agent-message:0`,
        threadId: `${runId}:ora-handoff`,
        nodeId: "decompose",
        planItemId: "decompose",
        kind: "reply",
        content: `@${researcher} and @${reviewer} subagent work is coordinated for: ${prompt}`,
      }),
    ];
  }

  if (pattern === "generator_verifier") {
    const generator = owner("draft", "generator");
    const verifier = owner("verify", "verifier");
    return [
      message(0, {
        fromAgentId: generator,
        toAgentIds: [verifier],
        threadId: "generator-verifier:1",
        nodeId: "draft",
        planItemId: "draft",
        kind: "mention",
        content: `@${verifier} please verify the candidate for: ${prompt}`,
      }),
      message(1, {
        fromAgentId: verifier,
        toAgentIds: [generator],
        replyToId: `${runId}:agent-message:0`,
        threadId: "generator-verifier:1",
        nodeId: "verify",
        planItemId: "verify",
        kind: "reply",
        content: `@${generator} verification complete for the candidate.`,
      }),
    ];
  }

  if (pattern === "message_bus") {
    const router = owner("route", "router");
    const researcher = owner("handle", "researcher");
    const responder = owner("respond", "responder");
    return [
      message(0, {
        fromAgentId: router,
        toAgentIds: [researcher],
        threadId: `${runId}:bus`,
        nodeId: "route",
        planItemId: "route",
        kind: "route",
        topic: "task.findings",
        correlationId: `${runId}:bus`,
        content: `@${researcher} routed task.findings for: ${prompt}`,
      }),
      message(1, {
        fromAgentId: researcher,
        toAgentIds: [responder],
        replyToId: `${runId}:agent-message:0`,
        threadId: `${runId}:bus`,
        nodeId: "handle",
        planItemId: "handle",
        kind: "reply",
        topic: "task.findings",
        correlationId: `${runId}:bus`,
        content: `@${responder} findings are ready.`,
      }),
    ];
  }

  if (pattern === "shared_state") {
    const orchestrator = owner("seed", "orchestrator");
    const researcher = owner("research", "researcher");
    const reviewer = owner("converge", "reviewer");
    return [
      message(0, {
        fromAgentId: orchestrator,
        toAgentIds: [researcher],
        threadId: "shared-state:board",
        nodeId: "seed",
        planItemId: "seed",
        kind: "mention",
        content: `@${researcher} shared board is seeded.`,
      }),
      message(1, {
        fromAgentId: researcher,
        toAgentIds: [reviewer],
        replyToId: `${runId}:agent-message:0`,
        threadId: "shared-state:board",
        nodeId: "research",
        planItemId: "research",
        kind: "reply",
        content: `@${reviewer} findings were added to the board.`,
      }),
    ];
  }

  const lead = owner("triage", "team_lead");
  const builder = owner("build", "builder");
  const reviewer = owner("check", "reviewer");
  return [
    message(0, {
      fromAgentId: lead,
      toAgentIds: [builder],
      threadId: "agent-teams:build",
      nodeId: "triage",
      planItemId: "triage",
      kind: "mention",
      content: `@${builder} backlog is ready for: ${prompt}`,
    }),
    message(1, {
      fromAgentId: builder,
      toAgentIds: [reviewer],
      replyToId: `${runId}:agent-message:0`,
      threadId: "agent-teams:build",
      nodeId: "build",
      planItemId: "build",
      kind: "reply",
      content: `@${reviewer} build is ready for validation.`,
    }),
  ];
}

function scoreMockEvaluationCase(profileId: "outcome" | "orchestration" | "task_completion", evaluationCase: OraEvaluationDatasetDetail["cases"][number], snapshot: OraStateSnapshot) {
  const outputText = snapshot.output && typeof snapshot.output === "object" && "text" in snapshot.output && typeof snapshot.output.text === "string"
    ? snapshot.output.text.toLowerCase()
    : "";
  const expectedText = evaluationCase.expected?.text?.toLowerCase();
  const outcomeScore = expectedText
    ? (outputText.includes(expectedText) || expectedText.includes(outputText) ? 1 : 0.45)
    : outputText ? 0.72 : 0.25;
  const processScore = Math.min(1, 0.5 + snapshot.events.filter((event) => ["topology.updated", "plan.updated", "checkpoint.created"].includes(event.type)).length * 0.12);
  const efficiencyScore = Math.max(0.4, 1 - snapshot.events.length / 20);
  const safetyScore = snapshot.pendingClarifications.length > 0 || snapshot.actions.some((action) => action.status === "approval_required")
    ? 0.55
    : 0.92;
  const weights = profileId === "orchestration"
    ? { outcome: 0.25, process: 0.45, efficiency: 0.15, safety: 0.15 }
    : profileId === "task_completion"
      ? { outcome: 0.45, process: 0.25, efficiency: 0.15, safety: 0.15 }
      : { outcome: 0.55, process: 0.2, efficiency: 0.15, safety: 0.1 };
  const overallScore = Number((outcomeScore * weights.outcome + processScore * weights.process + efficiencyScore * weights.efficiency + safetyScore * weights.safety).toFixed(4));
  const failureTags = [
    ...(outcomeScore < 0.6 ? ["incorrect_output"] : []),
    ...(processScore < 0.6 ? ["process_issue"] : []),
    ...(safetyScore < 0.8 ? ["safety_issue"] : []),
  ];
  return {
    outcomeScore: Number(outcomeScore.toFixed(4)),
    processScore: Number(processScore.toFixed(4)),
    efficiencyScore: Number(efficiencyScore.toFixed(4)),
    safetyScore: Number(safetyScore.toFixed(4)),
    overallScore,
    judgeRationale: expectedText
      ? `Mock ${profileId} grading compared the output against the expected answer and trace heuristics.`
      : `Mock ${profileId} grading used output and trace heuristics because no reference answer was provided.`,
    failureTags,
  };
}

function buildMockEvaluationObservations(snapshot: OraStateSnapshot): Record<string, unknown> {
  const autoModeRouter = isRecord(snapshot.config.metadata.autoModeRouter)
    ? snapshot.config.metadata.autoModeRouter
    : {};
  return {
    run: {
      status: snapshot.status,
      outputText: snapshot.output && typeof snapshot.output === "object" && "text" in snapshot.output && typeof snapshot.output.text === "string"
        ? snapshot.output.text
        : "",
      runtimeMs: Math.max(0, snapshot.updatedAt - (snapshot.events[0]?.createdAt ?? snapshot.updatedAt)),
      costUsd: Number((snapshot.events.length * 0.0002).toFixed(4)),
    },
    runtime: {
      modeId: snapshot.modeId,
      pattern: snapshot.pattern,
      autoModeRouter,
    },
    trace: {
      eventTypes: snapshot.events.map((event) => event.type),
      eventCount: snapshot.events.length,
      toolCallIds: snapshot.toolCalls.map((call) => call.toolId),
      toolCallCount: snapshot.toolCalls.length,
    },
  };
}

function buildMockCaseResults(
  cases: OraEvaluationDatasetDetail["cases"],
  spec: OraEvaluationSpec,
  attempts: OraEvaluationRunDetail["attempts"],
  baseline: OraEvaluationBaseline | undefined,
  evaluationRuns: Map<string, OraEvaluationRunDetail>
) {
  return cases.flatMap((evaluationCase) =>
    spec.configs.map((config) => {
      const matchingAttempts = attempts.filter((attempt) => attempt.caseId === evaluationCase.id && attempt.configId === config.id);
      const average = {
        outcomeScore: Number((matchingAttempts.reduce((sum, attempt) => sum + attempt.score.outcomeScore, 0) / matchingAttempts.length).toFixed(4)),
        processScore: Number((matchingAttempts.reduce((sum, attempt) => sum + attempt.score.processScore, 0) / matchingAttempts.length).toFixed(4)),
        efficiencyScore: Number((matchingAttempts.reduce((sum, attempt) => sum + attempt.score.efficiencyScore, 0) / matchingAttempts.length).toFixed(4)),
        safetyScore: Number((matchingAttempts.reduce((sum, attempt) => sum + attempt.score.safetyScore, 0) / matchingAttempts.length).toFixed(4)),
        overallScore: Number((matchingAttempts.reduce((sum, attempt) => sum + attempt.score.overallScore, 0) / matchingAttempts.length).toFixed(4)),
        judgeRationale: matchingAttempts.at(-1)?.score.judgeRationale ?? "Mock judge rationale unavailable.",
        failureTags: [...new Set(matchingAttempts.flatMap((attempt) => attempt.score.failureTags))],
      };
      const baselineRun = baseline ? evaluationRuns.get(baseline.evaluationRunId) : undefined;
      const baselineResult = baseline && baselineRun
        ? baselineRun.run.caseResults.find((result) => result.caseId === evaluationCase.id && result.configId === baseline.configId)
        : undefined;
      return {
        caseId: evaluationCase.id,
        configId: config.id,
        attemptIds: matchingAttempts.map((attempt) => attempt.id),
        averageScore: average,
        metricScores: [],
        evaluatorResults: matchingAttempts.at(-1)?.evaluatorResults ?? [],
        latestOutput: matchingAttempts.at(-1)?.output,
        observations: matchingAttempts.at(-1)?.observations ?? {},
        expected: evaluationCase.expected,
        metadata: evaluationCase.metadata,
        traceRunIds: matchingAttempts.flatMap((attempt) => attempt.underlyingRunId ? [attempt.underlyingRunId] : []),
        comparisonToBaseline: baseline && baselineResult
          ? {
              compatible: true,
              baselineId: baseline.id,
              baselineConfigId: baseline.configId,
              deltaOverallScore: Number((average.overallScore - baselineResult.averageScore.overallScore).toFixed(4)),
              regressed: average.overallScore < baselineResult.averageScore.overallScore - 0.05,
            }
          : undefined,
      };
    })
  );
}

function buildMockScorecard(configs: OraEvaluationSpec["configs"], attempts: OraEvaluationRunDetail["attempts"], caseResults: OraEvaluationRun["caseResults"]) {
  const average = (values: number[]) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    overallScore: Number(average(attempts.map((attempt) => attempt.score.overallScore)).toFixed(4)),
    passRate: Number(average(attempts.map((attempt) => attempt.score.overallScore >= 0.75 ? 1 : 0)).toFixed(4)),
    averageRuntimeMs: Math.round(average(attempts.map((attempt) => attempt.runtimeMs))),
    averageCostUsd: Number(average(attempts.map((attempt) => attempt.costUsd)).toFixed(4)),
    regressionCount: caseResults.filter((result) => result.comparisonToBaseline?.regressed).length,
    pendingAnnotationCount: attempts.reduce((count, attempt) => count + attempt.evaluatorResults.filter((result) => result.evaluatorKind === "human_annotation" && result.status === "pending").length, 0),
    configSummaries: configs.map((config) => {
      const configAttempts = attempts.filter((attempt) => attempt.configId === config.id);
      const configCaseResults = caseResults.filter((result) => result.configId === config.id);
      const failureTagCounts = configAttempts.reduce<Record<string, number>>((acc, attempt) => {
        for (const tag of attempt.score.failureTags) acc[tag] = (acc[tag] ?? 0) + 1;
        return acc;
      }, {});
      return {
        configId: config.id,
        label: config.label,
        overallScore: Number(average(configAttempts.map((attempt) => attempt.score.overallScore)).toFixed(4)),
        passRate: Number(average(configAttempts.map((attempt) => attempt.score.overallScore >= 0.75 ? 1 : 0)).toFixed(4)),
        averageRuntimeMs: Math.round(average(configAttempts.map((attempt) => attempt.runtimeMs))),
        averageCostUsd: Number(average(configAttempts.map((attempt) => attempt.costUsd)).toFixed(4)),
        caseCount: configCaseResults.length,
        regressionCount: configCaseResults.filter((result) => result.comparisonToBaseline?.regressed).length,
        failureTagCounts,
      };
    }),
    slices: caseResults.flatMap((result) => {
      const slices: Array<{ dimension: string; value: string; configId: string; caseCount: number; overallScore: number }> = [];
      if (typeof result.metadata.taskType === "string") {
        slices.push({ dimension: "taskType", value: result.metadata.taskType, configId: result.configId, caseCount: 1, overallScore: result.averageScore.overallScore });
      }
      if (typeof result.metadata.difficulty === "string") {
        slices.push({ dimension: "difficulty", value: result.metadata.difficulty, configId: result.configId, caseCount: 1, overallScore: result.averageScore.overallScore });
      }
      const tags = Array.isArray(result.metadata.tags) ? result.metadata.tags.filter((tag): tag is string => typeof tag === "string") : [];
      for (const tag of tags) {
        slices.push({ dimension: "tag", value: tag, configId: result.configId, caseCount: 1, overallScore: result.averageScore.overallScore });
      }
      return slices;
    }),
  };
}

function buildMockEvaluationEvents(run: OraEvaluationRun, attempts: OraEvaluationRunDetail["attempts"]): OraEvaluationRunStream["events"] {
  return [
    {
      id: `${run.id}:evt-0`,
      evaluationRunId: run.id,
      seq: 0,
      type: "evaluation.run.started",
      createdAt: run.startedAt,
      payload: { datasetId: run.spec.datasetId, configCount: run.spec.configs.length },
    },
    ...attempts.map((attempt, index) => ({
      id: `${run.id}:evt-${index + 1}`,
      evaluationRunId: run.id,
      seq: index + 1,
      type: "evaluation.attempt.completed" as const,
      createdAt: attempt.updatedAt,
      payload: {
        attemptId: attempt.id,
        caseId: attempt.caseId,
        configId: attempt.configId,
        overallScore: attempt.score.overallScore,
      },
    })),
    {
      id: `${run.id}:evt-${attempts.length + 1}`,
      evaluationRunId: run.id,
      seq: attempts.length + 1,
      type: "evaluation.run.completed",
      createdAt: run.completedAt ?? run.updatedAt,
      payload: {
        overallScore: run.scorecard.overallScore,
        passRate: run.scorecard.passRate,
      },
    },
  ];
}

function explicitSystemAgentModelRef(modelRef: string | undefined): string | undefined {
  return modelRef === "local/smoke-model" ? undefined : modelRef;
}

function mockAutomationOccurrences(schedule: OraAutomationSchedule, from: number, limit: number): number[] {
  if (schedule.kind === "once") {
    return schedule.at > from ? [schedule.at] : [];
  }
  const parts = Object.fromEntries(
    schedule.rrule.split(";").map((segment) => {
      const [key, value] = segment.split("=");
      return [key?.toUpperCase(), value];
    }),
  );
  const interval = Math.max(1, Number(parts.INTERVAL ?? 1));
  const minute = Number(parts.BYMINUTE ?? new Date(from).getMinutes());
  const hour = Number(parts.BYHOUR ?? new Date(from).getHours());
  const occurrences: number[] = [];
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let i = 0; i < 366 * 24 * 60 && occurrences.length < limit; i += 1) {
    if (mockAutomationOccurrenceMatches(cursor, String(parts.FREQ ?? "DAILY"), interval, hour, minute, String(parts.BYDAY ?? ""), String(parts.BYMONTHDAY ?? ""))) {
      occurrences.push(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return occurrences;
}

function mockAutomationOccurrenceMatches(date: Date, freq: string, interval: number, hour: number, minute: number, byDay: string, byMonthDay: string): boolean {
  if (date.getMinutes() !== minute) return false;
  if (freq !== "HOURLY" && date.getHours() !== hour) return false;
  if (byMonthDay && !byMonthDay.split(",").includes(String(date.getDate()))) return false;
  if (byDay) {
    const dayCode = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getDay()];
    if (!byDay.split(",").includes(dayCode)) return false;
  }
  if (freq === "HOURLY") return date.getHours() % interval === 0;
  if (freq === "MONTHLY") return date.getMonth() % interval === 0;
  return true;
}

function mockRuleAllows(rule: OraFeedbackLoopCalibrationRule, source: OraProjectSignal["source"], severity: OraProjectSignal["severity"]): boolean {
  return rule.enabled
    && (rule.sourceFilters.length === 0 || rule.sourceFilters.includes(source))
    && mockSeverityRank(severity) >= mockSeverityRank(rule.severityThreshold);
}

function mockRuleAllowsAction(rule: OraFeedbackLoopCalibrationRule, action: OraProjectInsight["recommendedActions"][number]): boolean {
  return rule.actionPolicy.allowedActionKinds.length === 0 || rule.actionPolicy.allowedActionKinds.includes(action.kind);
}

function projectIdParam(params: unknown): string | undefined {
  return typeof params === "object" && params !== null && "projectId" in params && typeof params.projectId === "string"
    ? params.projectId
    : undefined;
}

function candidateIdParam(params: unknown): string {
  return typeof params === "object" && params !== null && "candidateId" in params
    ? String(params.candidateId)
    : "";
}

function mockSeverityRank(severity: OraProjectSignal["severity"]): number {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}
