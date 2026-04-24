import type {
  ActionRecord as OraActionRecord,
  AgentProfile as OraAgentProfile,
  ArtifactRef as OraArtifactRef,
  CheckpointMeta as OraCheckpointMeta,
  CoordinationPattern,
  CustomAgentCheckNameResult as OraCustomAgentCheckNameResult,
  CustomAgentCreateParams as OraCustomAgentCreateParams,
  CustomAgentDetail as OraCustomAgentDetail,
  CustomAgentSummary as OraCustomAgentSummary,
  CustomAgentUpdateParams as OraCustomAgentUpdateParams,
  EvaluationBaseline as OraEvaluationBaseline,
  EvaluationCaseResult as OraEvaluationCaseResult,
  EvaluationDataset as OraEvaluationDataset,
  EvaluationDatasetDetail as OraEvaluationDatasetDetail,
  EvaluationExportResult as OraEvaluationExportResult,
  EvaluationRun as OraEvaluationRun,
  EvaluationRunDetail as OraEvaluationRunDetail,
  EvaluationRunStream as OraEvaluationRunStream,
  EvaluationSpec as OraEvaluationSpec,
  JsonRpcRequest,
  JsonRpcResponse,
  MemoryRecord as OraMemoryRecord,
  ModeRuntimeAtomDefinition as OraModeRuntimeAtomDefinition,
  ModeCreateParams as OraModeCreateParams,
  ModeSpec as OraModeSpec,
  ModeUpdateParams as OraModeUpdateParams,
  ModeValidationResult as OraModeValidationResult,
  OraEventEnvelope,
  PatternDefinition as OraPatternDefinition,
  PlanItem as OraPlanItem,
  ProjectCreateParams as OraProjectCreateParams,
  ProjectDetail as OraProjectDetail,
  ProjectSummary as OraProjectSummary,
  ProviderConfig as OraProviderConfig,
  ProviderRegistry as OraProviderRegistry,
  ProviderSecretStatus as OraProviderSecretStatus,
  ProviderStatus as OraProviderStatus,
  RunTraceMetadata as OraRunTraceMetadata,
  RuntimeBootstrap as OraRuntimeBootstrap,
  RunConfig as OraRunConfig,
  RunEventStream as OraRunEventStream,
  RunHandle as OraRunHandle,
  RunTrail as OraRunTrail,
  RunTrailMetrics as OraRunTrailMetrics,
  SessionCreateParams as OraSessionCreateParams,
  SessionDetail as OraSessionDetail,
  SessionSummary as OraSessionSummary,
  SessionTranscriptMessage as OraSessionTranscriptMessage,
  SessionTurn as OraSessionTurn,
  SkillRegistry as OraSkillRegistry,
  StateSnapshot as OraStateSnapshot,
  TopologyEdge as OraTopologyEdge,
  TopologyNode as OraTopologyNode,
  TrailGenerationRef as OraTrailGenerationRef,
  TrailObservation as OraTrailObservation,
  ToolRegistry as OraToolRegistry,
  UserTaskInput as OraUserTaskInput,
} from "@ora/shared";
import { DEFAULT_PROVIDERS, MVP_MODE_RUNTIME_ATOMS, MVP_MODES, MVP_PATTERNS, MVP_SKILLS, MVP_TOOLS, ProviderConfigSchema, modeSpecToPatternDefinition, validateModeSpec } from "@ora/shared";

export type {
  OraActionRecord,
  OraAgentProfile,
  OraArtifactRef,
  OraCheckpointMeta,
  OraCustomAgentCheckNameResult,
  OraCustomAgentCreateParams,
  OraCustomAgentDetail,
  OraCustomAgentSummary,
  OraCustomAgentUpdateParams,
  OraEvaluationBaseline,
  OraEvaluationCaseResult,
  OraEvaluationDataset,
  OraEvaluationDatasetDetail,
  OraEvaluationExportResult,
  OraEvaluationRun,
  OraEvaluationRunDetail,
  OraEvaluationRunStream,
  OraEvaluationSpec,
  OraEventEnvelope,
  OraMemoryRecord,
  OraModeRuntimeAtomDefinition,
  OraModeCreateParams,
  OraModeSpec,
  OraModeUpdateParams,
  OraModeValidationResult,
  OraPatternDefinition,
  OraProviderConfig,
  OraProviderRegistry,
  OraProviderSecretStatus,
  OraProviderStatus,
  OraPlanItem,
  OraProjectCreateParams,
  OraProjectDetail,
  OraProjectSummary,
  OraRunConfig,
  OraRunEventStream,
  OraRunHandle,
  OraRunTraceMetadata,
  OraRunTrail,
  OraRunTrailMetrics,
  OraSessionCreateParams,
  OraSessionDetail,
  OraSessionSummary,
  OraSessionTranscriptMessage,
  OraSessionTurn,
  OraStateSnapshot,
  OraToolRegistry,
  OraSkillRegistry,
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
  skillRegistry: OraSkillRegistry;
  providerSecretStatuses: OraProviderSecretStatus[];
  providerStatuses: OraProviderStatus[];
}

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };
const CUSTOM_PROVIDER_STORAGE_KEY = "ora.customProviders.v1";
let sharedRuntimeClient: ReturnType<typeof createRuntimeClient> | undefined;

export function createRuntimeClient() {
  const local = new LocalJsonRpcRuntime();
  let requestId = 1;
  let lastHealth: RuntimeHealth | undefined;
  let processBridgeEnabled = false;
  let tauriUnavailableReason = "Runtime sidecar is unavailable.";

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
          ? "Tauri command bridge is serving Ora JSON-RPC."
          : tauriUnavailableReason,
      };
      return unwrapJsonRpc<T>(tauriResponse.response);
    }

    if (tauriAvailable) {
      lastHealth = {
        ok: false,
        mode: "unavailable",
        service: "ora-runtime",
        detail: tauriUnavailableReason,
      };
      throw new Error(tauriUnavailableReason);
    }

    const response = await local.handle(request);
    lastHealth = {
      ok: true,
      mode: "browser_mock",
      service: "ora-runtime-mock",
      detail: "Browser dev fallback is serving deterministic Ora JSON-RPC.",
    };
    return unwrapJsonRpc<T>(response);
  }

  return {
    async bootstrap(): Promise<RuntimeBootstrap> {
      const sidecarStatus = await readTauriSidecarStatus();
      processBridgeEnabled = Boolean(sidecarStatus?.process_spawn_available);
      tauriUnavailableReason = sidecarStatus
        ? String(sidecarStatus.reason ?? "Runtime sidecar process bridge is unavailable.")
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
          modes: MVP_MODES,
          atoms: MVP_MODE_RUNTIME_ATOMS,
          providerRegistry,
          toolRegistry: { tools: MVP_TOOLS, defaultPolicyId: "runtime.default_policy" },
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
        skillRegistry: bootstrap.skills,
        providerSecretStatuses,
        providerStatuses,
      };
    },
    async createSession(params: OraSessionCreateParams = {}): Promise<OraSessionSummary> {
      return call<OraSessionSummary>("sessions.create", params);
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
    async listSessions(): Promise<OraSessionSummary[]> {
      return call<OraSessionSummary[]>("sessions.list");
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
    async getSession(sessionId: string): Promise<OraSessionDetail> {
      return call<OraSessionDetail>("sessions.get", { sessionId });
    },
    async listAgents(): Promise<OraCustomAgentSummary[]> {
      return call<OraCustomAgentSummary[]>("agents.list");
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
    async startRun(input: OraUserTaskInput, config: Partial<OraRunConfig>, sessionId?: string): Promise<OraStateSnapshot> {
      const handle = await call<OraRunHandle>("runs.start", { input, config, sessionId });
      return call<OraStateSnapshot>("runs.state", { runId: handle.runId });
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
    async cancelRun(runId: string): Promise<OraStateSnapshot> {
      return call<OraStateSnapshot>("runs.cancel", { runId });
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
  private runs = new Map<string, OraStateSnapshot>();
  private customAgents = new Map<string, OraCustomAgentDetail>();
  private modes = new Map<string, OraModeSpec>();
  private evaluationDatasets = new Map<string, OraEvaluationDatasetDetail>();
  private evaluationRuns = new Map<string, OraEvaluationRunDetail>();
  private evaluationBaselines = new Map<string, OraEvaluationBaseline>();
  private nextProjectNumber = 1;
  private nextSessionNumber = 1;
  private nextRunNumber = 1;
  private nextEvaluationDatasetNumber = 1;
  private nextEvaluationRunNumber = 1;
  private nextEvaluationBaselineNumber = 1;

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
        modes: [...MVP_MODES],
        atoms: MVP_MODE_RUNTIME_ATOMS,
        tools: {
          tools: MVP_TOOLS,
          defaultPolicyId: "runtime.default_policy",
          },
          skills: {
            skills: MVP_SKILLS,
          },
          providers: {
            providers: DEFAULT_PROVIDERS,
            defaultProviderId: "local-smoke",
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
      case "tools.list":
        return {
          tools: MVP_TOOLS,
          defaultPolicyId: "runtime.default_policy",
        };
      case "skills.list":
        return {
          skills: MVP_SKILLS,
        };
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
      case "agents.list":
        return [...this.customAgents.values()]
          .map(({ soul, ...summary }) => summary)
          .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
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
      case "projects.create":
        return this.createProject(params);
      case "projects.list":
        return [...this.projects.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.projectId.localeCompare(b.projectId));
      case "projects.get":
        return this.getProjectDetail(params);
      case "sessions.create":
        return this.createSession(params);
      case "sessions.list":
        return [...this.sessions.values()]
          .filter((session) => {
            if (typeof params !== "object" || params === null || !("projectId" in params)) return true;
            return typeof params.projectId === "string" ? session.projectId === params.projectId : true;
          })
          .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
      case "sessions.get":
        return this.getSessionDetail(params);
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
      case "runs.start":
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
        const mode = this.resolveMode(parsed.config?.modeId ?? source.modeId, parsed.config?.pattern ?? source.pattern);
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
      .filter((session) => session.projectId === params.projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
    return {
      project,
      sessions,
    };
  }

  private createAgent(params: unknown): OraCustomAgentDetail {
    if (!isRecord(params) || typeof params.name !== "string") {
      throw new Error("Custom agent name is required.");
    }
    const name = normalizeMockAgentName(params.name);
    if (this.customAgents.has(name)) {
      throw new Error(`Custom agent '${name}' already exists.`);
    }
    const now = Date.now();
    const detail: OraCustomAgentDetail = {
      name,
      description: typeof params.description === "string" ? params.description : "",
      model: typeof params.model === "string" && params.model.trim() ? params.model : undefined,
      toolGroups: Array.isArray(params.toolGroups)
        ? params.toolGroups.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : undefined,
      soul: typeof params.soul === "string" ? params.soul : "",
      createdAt: now,
      updatedAt: now,
    };
    this.customAgents.set(name, detail);
    return detail;
  }

  private listModes(): OraModeSpec[] {
    return [...MVP_MODES, ...this.modes.values()]
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
        : Array.isArray(params.toolGroups)
          ? params.toolGroups.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : existing.toolGroups,
      soul: typeof params.soul === "string" ? params.soul : existing.soul,
      updatedAt: Date.now(),
    };
    this.customAgents.set(name, next);
    return next;
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
      available: !this.customAgents.has(name),
      name,
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
      .sort((a, b) => (a.turnIndex ?? 1) - (b.turnIndex ?? 1))
      .map((snapshot) => ({
        runId: snapshot.runId,
        sessionId: snapshot.sessionId!,
        turnIndex: snapshot.turnIndex ?? 1,
        status: snapshot.status,
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
      session,
      turns,
      transcript,
      latestSnapshot: latestRunId ? this.runs.get(latestRunId) : undefined,
    };
  }

  private startRun(params: unknown): OraRunHandle {
    const parsed = asStartRunParams(params);
    const sessionId =
      parsed.sessionId ??
      this.createSession({ projectId: parsed.input.projectId }).sessionId;
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const mode = this.resolveMode(parsed.config?.modeId, parsed.config?.pattern ?? "orchestrator_subagent");
    const pattern = mode.family;
    const runId = `run-${String(this.nextRunNumber++).padStart(4, "0")}`;
    const startedAt = Date.now();
    const turnIndex = [...this.runs.values()].filter((snapshot) => snapshot.sessionId === sessionId).length + 1;
    const snapshot = this.createSnapshot(runId, mode, parsed.input.prompt, startedAt, "succeeded", undefined, {
      providerId: parsed.config?.providerId ?? "local-smoke",
      modelRef: parsed.config?.modelRef ?? "local/smoke-model",
      customAgentId: parsed.config?.customAgentId,
      projectId: parsed.input.projectId ?? this.sessions.get(sessionId)?.projectId,
    }, sessionId, turnIndex);
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
            runtimeMs: Math.max(0, snapshot.updatedAt - (snapshot.events[0]?.createdAt ?? snapshot.updatedAt)),
            costUsd: Number((snapshot.events.length * 0.0002).toFixed(4)),
            startedAt: snapshot.events[0]?.createdAt ?? startedAt,
            updatedAt: snapshot.updatedAt,
          });
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
    const runId = asRunId(params);
    const snapshot = this.getRunState({ runId });
    const event = createEvent(snapshot.runId, snapshot.events.length, type, { status }, snapshot.pattern);
    const updated = {
      ...snapshot,
      status,
      events: [...snapshot.events, event],
      actions: snapshot.actions.map((action) =>
        status === "cancelled" && action.status === "approval_required" ? { ...action, status: "denied" as const } : action,
      ),
      updatedAt: event.createdAt,
    };
    this.runs.set(runId, updated);
    this.updateSessionFromSnapshot(updated);
    return updated;
  }

  private resumeRun(params: unknown): OraStateSnapshot {
    const { runId, reason, patch } = asResumeRunParams(params);
    const snapshot = this.getRunState({ runId });
    const resumedEvent = createEvent(
      snapshot.runId,
      snapshot.events.length,
      "run.resumed",
      { reason: reason ?? "Approved from the Operator Workbench.", patch: patch ?? {} },
      snapshot.pattern,
    );
    const doneEvent = createEvent(
      snapshot.runId,
      snapshot.events.length + 1,
      "run.done",
      { status: "succeeded", summary: "Run resumed from approval gate and completed." },
      snapshot.pattern,
    );
    const updated = {
      ...snapshot,
      status: "succeeded" as const,
      topology: {
        ...snapshot.topology,
        nodes: snapshot.topology.nodes.map((node) => ({ ...node, status: "done" as const })),
      },
      plan: snapshot.plan.map((item) => ({ ...item, status: "done" as const })),
      actions: snapshot.actions.map((action) =>
        action.status === "approval_required" ? { ...action, status: "approved" as const } : action,
      ),
      events: [...snapshot.events, resumedEvent, doneEvent],
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
    provider?: { providerId?: string; modelRef?: string; customAgentId?: string; projectId?: string },
    sessionId?: string,
    turnIndex = 1,
  ): OraStateSnapshot {
    const pattern = mode.family;
    const definition = modeSpecToPatternDefinition(mode);
    const eventBase = startedAt || Date.parse("2026-04-22T13:00:00.000Z");
    const checkpoint: OraCheckpointMeta = {
      id: `${runId}:checkpoint-0`,
      runId,
      label: status === "succeeded" ? "Smoke checkpoint" : "Preview checkpoint",
      createdAt: eventBase + 5000,
      eventSeq: 5,
      stateHash: `${pattern}:${definition.planTemplate.length}:${definition.topology.nodes.length}`,
    };

    const events: OraEventEnvelope[] = [
      createEvent(runId, 0, "run.started", { message: "Smoke run started.", prompt }, pattern, eventBase),
      ...(forkedFrom
        ? [createEvent(runId, 1, "run.forked", { sourceRunId: forkedFrom.runId, checkpointId: forkedFrom.checkpointId, eventSeq: forkedFrom.eventSeq }, pattern, eventBase + 1000)]
        : []),
      createEvent(runId, forkedFrom ? 2 : 1, "topology.updated", definition.topology, pattern, eventBase + 1000),
      createEvent(runId, forkedFrom ? 3 : 2, "plan.updated", { items: definition.planTemplate }, pattern, eventBase + 2000),
      createEvent(
        runId,
        forkedFrom ? 4 : 3,
        "message.delta",
        { role: "assistant", content: `${definition.label} accepted a local smoke task: ${prompt}` },
        pattern,
        eventBase + 3000,
      ),
      createEvent(
        runId,
        forkedFrom ? 5 : 4,
        "checkpoint.created",
        { checkpoint, summary: "Deterministic checkpoint captured after smoke stream." },
        pattern,
        eventBase + 4000,
        checkpoint.id,
      ),
      createEvent(
        runId,
        forkedFrom ? 6 : 5,
        status === "failed" ? "run.failed" : "run.done",
        { status, summary: "Deterministic local smoke run completed." },
        pattern,
        eventBase + 5000,
      ),
    ];

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
        profileIds: definition.profiles.map((profile) => profile.id),
        skillIds: mode.capabilityFlags.skillIds,
        toolIds: mode.capabilityFlags.toolIds,
        providerId: provider?.providerId ?? "local-smoke",
        customAgentId: provider?.customAgentId,
        modelRef: provider?.modelRef ?? "local/smoke-model",
        budget: definition.defaultBudget,
        approvalMode: mode.capabilityFlags.approvalMode,
        patternOptions: {},
        metadata: {
          source: "desktop-smoke",
          modeId: mode.id,
          providerId: provider?.providerId ?? "local-smoke",
          ...(provider?.customAgentId ? { customAgentId: provider.customAgentId } : {}),
        },
        deterministicSeed: "ora-smoke",
      },
      topology: {
        nodes: definition.topology.nodes.map((node) => ({
          ...node,
          status: status === "succeeded" ? "done" : node.kind === "run" ? "running" : node.status,
        })),
        edges: definition.topology.edges,
      },
      profiles: definition.profiles,
      memory: [],
      plan: definition.planTemplate.map((item, index) => ({
        id: `${runId}:${item.id}`,
        runId,
        ownerAgentId: item.ownerAgentId,
        status: status === "succeeded" ? "done" : index === 0 ? "running" : "planned",
        title: item.title,
        dependencies: item.dependencies.map((dependency) => `${runId}:${dependency}`),
        linkedActionIds: index === 1 ? [`${runId}:action-sidecar`] : [],
        checkpointIds: [checkpoint.id],
      })),
      actions: [
        {
          id: `${runId}:action-sidecar`,
          runId,
          planItemId: `${runId}:${definition.planTemplate[1]?.id ?? definition.planTemplate[0].id}`,
          agentId: definition.profiles[1]?.id ?? definition.profiles[0].id,
          type: "runtime.sidecar.preview",
          riskLevel: "medium",
          status: "approval_required",
          input: { command: "ora-runtime-sidecar --transport stdio" },
          artifactIds: [],
        },
        {
          id: `${runId}:action-report`,
          runId,
          agentId: definition.profiles[0].id,
          type: "report.export",
          riskLevel: "low",
          status: status === "succeeded" ? "succeeded" : "proposed",
          input: { format: "application/json" },
          output: status === "succeeded" ? { artifactId: `${runId}:report-0` } : undefined,
          artifactIds: status === "succeeded" ? [`${runId}:report-0`] : [],
        },
      ],
      policyDecisions: [],
      checkpoints: [checkpoint],
      events,
      artifacts: [],
      activeAgents: status === "running" ? definition.profiles.slice(0, 1).map((profile) => profile.id) : [],
    queueSummary: {
      mode: definition.coordinationKind === "bus"
        ? "event_bus"
        : definition.coordinationKind === "shared_state"
            ? "shared_state"
            : definition.coordinationKind === "team"
              ? "backlog"
              : "dag",
        pending: Math.max(0, definition.planTemplate.length - 1),
        inProgress: status === "running" ? 1 : 0,
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
    pendingApprovals: [],
    modeSpec: mode,
      output: {
        text: `Smoke result for ${mode.label}: ${prompt}`,
      },
      trace: createMockTraceMetadata(runId, provider?.providerId, provider?.modelRef),
      updatedAt: eventBase + 6000,
    };
  }

  private updateSessionFromSnapshot(snapshot: OraStateSnapshot) {
    const sessionId = snapshot.sessionId;
    if (!sessionId) return;
    const existing = this.sessions.get(sessionId);
    if (!existing) return;
    const updatedSession = {
      ...existing,
      title: existing.turnCount > 0 && existing.title !== "New Chat" ? existing.title : snapshot.input.prompt,
      status: snapshot.status,
      latestRunId: snapshot.runId,
      latestPattern: snapshot.pattern,
      latestModeId: snapshot.modeId,
      latestProviderId: snapshot.config.providerId,
      latestModelRef: snapshot.config.modelRef,
      projectId: snapshot.input.projectId ?? existing.projectId,
      turnCount: [...this.runs.values()].filter((run) => run.sessionId === sessionId).length,
      updatedAt: snapshot.updatedAt,
    };
    this.sessions.set(sessionId, updatedSession);
    if (updatedSession.projectId) {
      this.syncProjectSummary(updatedSession.projectId);
    }
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
    const sessions = [...this.sessions.values()].filter((session) => session.projectId === projectId);
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
): OraEventEnvelope {
  return {
    id: `${runId}:evt-${seq}`,
    runId,
    seq,
    type,
    createdAt,
    pattern,
    checkpointId,
    payload,
  };
}

function createMockTraceMetadata(
  runId: string,
  providerId?: string,
  modelRef?: string,
): OraRunTraceMetadata {
  return {
    provider: "langfuse",
    enabled: true,
    available: true,
    traceId: `trace-${runId}`,
    rootObservationId: `${runId}:trace-root`,
    traceUrl: `http://localhost:3000/project/ora-runtime/traces/trace-${runId}`,
    source: "local_synthesized",
    generationRefs: [{
      observationId: `${runId}:generation-0`,
      traceId: `trace-${runId}`,
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
        latestOutput: matchingAttempts.at(-1)?.output,
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

function csvCell(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}
