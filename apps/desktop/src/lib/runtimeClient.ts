import type {
  ActionRecord as OraActionRecord,
  AgentProfile as OraAgentProfile,
  ArtifactRef as OraArtifactRef,
  CheckpointMeta as OraCheckpointMeta,
  CoordinationPattern,
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
  OraEventEnvelope,
  PatternDefinition as OraPatternDefinition,
  PlanItem as OraPlanItem,
  ProviderConfig as OraProviderConfig,
  ProviderRegistry as OraProviderRegistry,
  ProviderSecretStatus as OraProviderSecretStatus,
  RuntimeBootstrap as OraRuntimeBootstrap,
  RunConfig as OraRunConfig,
  RunEventStream as OraRunEventStream,
  RunHandle as OraRunHandle,
  SessionCreateParams as OraSessionCreateParams,
  SessionDetail as OraSessionDetail,
  SessionSummary as OraSessionSummary,
  SessionTranscriptMessage as OraSessionTranscriptMessage,
  SessionTurn as OraSessionTurn,
  SkillRegistry as OraSkillRegistry,
  StateSnapshot as OraStateSnapshot,
  TopologyEdge as OraTopologyEdge,
  TopologyNode as OraTopologyNode,
  ToolRegistry as OraToolRegistry,
  UserTaskInput as OraUserTaskInput,
} from "@ora/shared";
import { DEFAULT_PROVIDERS, MVP_PATTERNS, MVP_SKILLS, MVP_TOOLS, ProviderConfigSchema } from "@ora/shared";

export type {
  OraActionRecord,
  OraAgentProfile,
  OraArtifactRef,
  OraCheckpointMeta,
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
  OraPatternDefinition,
  OraProviderConfig,
  OraProviderRegistry,
  OraProviderSecretStatus,
  OraPlanItem,
  OraRunConfig,
  OraRunEventStream,
  OraRunHandle,
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
  providerRegistry: OraProviderRegistry;
  toolRegistry: OraToolRegistry;
  skillRegistry: OraSkillRegistry;
  providerSecretStatuses: OraProviderSecretStatus[];
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
        return {
          health: lastHealth ?? {
            ok: true,
            mode: "tauri",
            service: "ora-runtime",
            detail: tauriUnavailableReason,
          },
          patterns,
          providerRegistry,
          toolRegistry: { tools: MVP_TOOLS, defaultPolicyId: "runtime.default_policy" },
          skillRegistry: { skills: MVP_SKILLS },
          providerSecretStatuses,
        };
      }

      const bootstrap = await call<OraRuntimeBootstrap>("runtime.bootstrap");
      const providerRegistry = mergeCustomProviders(bootstrap.providers);
      const providerSecretStatuses = await getProviderSecretStatuses(providerRegistry.providers);

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
        providerRegistry,
        toolRegistry: bootstrap.tools,
        skillRegistry: bootstrap.skills,
        providerSecretStatuses,
      };
    },
    async createSession(params: OraSessionCreateParams = {}): Promise<OraSessionSummary> {
      return call<OraSessionSummary>("sessions.create", params);
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
    async startRun(input: OraUserTaskInput, config: Partial<OraRunConfig>, sessionId?: string): Promise<OraStateSnapshot> {
      const handle = await call<OraRunHandle>("runs.start", { input, config, sessionId });
      return call<OraStateSnapshot>("runs.state", { runId: handle.runId });
    },
    async getRunState(runId: string): Promise<OraStateSnapshot> {
      return call<OraStateSnapshot>("runs.state", { runId });
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
    async storeProviderSecret(providerId: string, secret: string): Promise<OraProviderSecretStatus> {
      return writeProviderSecret(providerId, secret);
    },
    async deleteProviderSecret(providerId: string): Promise<OraProviderSecretStatus> {
      return removeProviderSecret(providerId);
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
  private sessions = new Map<string, OraSessionSummary>();
  private runs = new Map<string, OraStateSnapshot>();
  private evaluationDatasets = new Map<string, OraEvaluationDatasetDetail>();
  private evaluationRuns = new Map<string, OraEvaluationRunDetail>();
  private evaluationBaselines = new Map<string, OraEvaluationBaseline>();
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
      case "sessions.create":
        return this.createSession(params);
      case "sessions.list":
        return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
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
            prompt: snapshot.input.prompt,
            startedAt: snapshot.input.createdAt ?? snapshot.updatedAt,
            updatedAt: snapshot.updatedAt,
            eventCount: snapshot.events.length,
            checkpointCount: snapshot.checkpoints.length,
            artifactCount: snapshot.artifacts.length,
          }));
      case "runs.state":
        return this.getRunState(params);
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
        const pattern = parsed.config?.pattern ?? source.pattern;
        const prompt = parsed.input?.prompt ?? `${source.input.prompt} (forked from ${checkpoint.label})`;
        const runId = `run-${String(this.nextRunNumber++).padStart(4, "0")}`;
        const sessionId = source.sessionId ?? this.createSession({}).sessionId;
        const snapshot = this.createSnapshot(
          runId,
          pattern,
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
        : "ora-mvp";
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
    return session;
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
    const pattern = parsed.config?.pattern ?? "orchestrator_subagent";
    const runId = `run-${String(this.nextRunNumber++).padStart(4, "0")}`;
    const startedAt = Date.now();
    const turnIndex = [...this.runs.values()].filter((snapshot) => snapshot.sessionId === sessionId).length + 1;
    const snapshot = this.createSnapshot(runId, pattern, parsed.input.prompt, startedAt, "succeeded", undefined, {
      providerId: parsed.config?.providerId ?? "local-smoke",
      modelRef: parsed.config?.modelRef ?? "local/smoke-model",
    }, sessionId, turnIndex);
    this.runs.set(runId, snapshot);
    this.updateSessionFromSnapshot(snapshot);

    return {
      runId,
      sessionId,
      turnIndex,
      status: snapshot.status,
      pattern,
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
              projectId: "ora-evaluation",
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
    pattern: CoordinationPattern,
    prompt: string,
    startedAt: number,
    status: OraStateSnapshot["status"],
    forkedFrom?: { runId: string; checkpointId: string; eventSeq: number },
    provider?: { providerId?: string; modelRef?: string },
    sessionId?: string,
    turnIndex = 1,
  ): OraStateSnapshot {
    const definition = getPatternDefinition(pattern);
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
      input: {
        prompt,
        projectId: "ora-mvp",
        context: {},
        createdAt: eventBase,
      },
      config: {
        pattern,
        profileIds: definition.profiles.map((profile) => profile.id),
        skillIds: [],
        toolIds: [],
        providerId: provider?.providerId ?? "local-smoke",
        modelRef: provider?.modelRef ?? "local/smoke-model",
        budget: definition.defaultBudget,
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: { source: "desktop-smoke", providerId: provider?.providerId ?? "local-smoke" },
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
      pendingApprovals: [],
      output: {
        text: `Smoke result for ${definition.label}: ${prompt}`,
      },
      updatedAt: eventBase + 6000,
    };
  }

  private updateSessionFromSnapshot(snapshot: OraStateSnapshot) {
    const sessionId = snapshot.sessionId;
    if (!sessionId) return;
    const existing = this.sessions.get(sessionId);
    if (!existing) return;
    this.sessions.set(sessionId, {
      ...existing,
      title: existing.turnCount > 0 && existing.title !== "New Chat" ? existing.title : snapshot.input.prompt,
      status: snapshot.status,
      latestRunId: snapshot.runId,
      latestPattern: snapshot.pattern,
      latestProviderId: snapshot.config.providerId,
      latestModelRef: snapshot.config.modelRef,
      turnCount: [...this.runs.values()].filter((run) => run.sessionId === sessionId).length,
      updatedAt: snapshot.updatedAt,
    });
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

function getPatternDefinition(pattern: CoordinationPattern): OraPatternDefinition {
  return MVP_PATTERNS.find((definition) => definition.id === pattern) ?? MVP_PATTERNS[0];
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
  const safetyScore = snapshot.actions.some((action) => action.status === "approval_required") ? 0.55 : 0.92;
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
