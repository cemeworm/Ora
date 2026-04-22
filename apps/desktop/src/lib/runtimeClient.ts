import type {
  ActionRecord as OraActionRecord,
  AgentProfile as OraAgentProfile,
  ArtifactRef as OraArtifactRef,
  CheckpointMeta as OraCheckpointMeta,
  CoordinationPattern,
  JsonRpcRequest,
  JsonRpcResponse,
  MemoryRecord as OraMemoryRecord,
  OraEventEnvelope,
  PatternDefinition as OraPatternDefinition,
  PlanItem as OraPlanItem,
  ProviderConfig as OraProviderConfig,
  ProviderRegistry as OraProviderRegistry,
  ProviderSecretStatus as OraProviderSecretStatus,
  ResourceBudget as OraResourceBudget,
  RunConfig as OraRunConfig,
  RunEventStream as OraRunEventStream,
  RunHandle as OraRunHandle,
  RunStatus as OraRunStatus,
  StateSnapshot as OraStateSnapshot,
  TopologyEdge as OraTopologyEdge,
  TopologyNode as OraTopologyNode,
  UserTaskInput as OraUserTaskInput,
} from "@ora/shared";
import { DEFAULT_PROVIDERS } from "@ora/shared";

export type {
  OraActionRecord,
  OraAgentProfile,
  OraArtifactRef,
  OraCheckpointMeta,
  OraEventEnvelope,
  OraMemoryRecord,
  OraPatternDefinition,
  OraProviderConfig,
  OraProviderRegistry,
  OraProviderSecretStatus,
  OraPlanItem,
  OraResourceBudget,
  OraRunConfig,
  OraRunEventStream,
  OraRunHandle,
  OraStateSnapshot,
  OraTopologyEdge,
  OraTopologyNode,
  OraUserTaskInput,
};

export interface RuntimeHealth {
  ok: boolean;
  mode: "tauri" | "browser_mock" | "tauri_mock_fallback";
  service: string;
  detail: string;
}

export interface RuntimeBootstrap {
  health: RuntimeHealth;
  patterns: OraPatternDefinition[];
  providerRegistry: OraProviderRegistry;
  providerSecretStatuses: OraProviderSecretStatus[];
  snapshot: OraStateSnapshot;
}

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

const DEFAULT_PROMPT =
  "Implement a smoke run that proves Ora can switch patterns, expose topology, stream events, and checkpoint state.";

export function createRuntimeClient() {
  const local = new LocalJsonRpcRuntime();
  let requestId = 1;
  let lastHealth: RuntimeHealth | undefined;
  let sidecarSpawnEnabled = false;

  async function call<T>(method: string, params?: unknown): Promise<T> {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: requestId++,
      method,
      params,
    };

    const tauriResponse = sidecarSpawnEnabled ? await tryTauriJsonRpc(request) : { ok: false as const, tauriAvailable: isTauriAvailable() };
    if (tauriResponse.ok && !("error" in tauriResponse.response)) {
      lastHealth = {
        ok: true,
        mode: "tauri",
        service: "ora-runtime",
        detail: "Tauri command bridge is serving Ora JSON-RPC.",
      };
      return unwrapJsonRpc<T>(tauriResponse.response);
    }

    const response = await local.handle(request);
    lastHealth = {
      ok: true,
      mode: tauriResponse.tauriAvailable ? "tauri_mock_fallback" : "browser_mock",
      service: "ora-runtime-mock",
      detail: tauriResponse.tauriAvailable
        ? `Tauri is present; using deterministic browser handler until runtime_json_rpc is wired.`
        : "Browser dev fallback is serving deterministic Ora JSON-RPC.",
    };
    return unwrapJsonRpc<T>(response);
  }

  return {
    async bootstrap(): Promise<RuntimeBootstrap> {
      const sidecarStatus = await readTauriSidecarStatus();
      sidecarSpawnEnabled = Boolean(sidecarStatus?.sidecar_spawn_enabled);
      const health = await call<Omit<RuntimeHealth, "mode" | "detail">>("runtime.health");
      const patterns = await call<OraPatternDefinition[]>("patterns.list");
      const providerRegistry = await call<OraProviderRegistry>("providers.list");
      const providerSecretStatuses = await getProviderSecretStatuses(providerRegistry.providers);
      const snapshot = local.previewState("orchestrator_subagent", DEFAULT_PROMPT);

      return {
        health: lastHealth ?? {
          ok: health.ok,
          mode: "browser_mock",
          service: health.service,
          detail: sidecarStatus
            ? String(sidecarStatus.reason ?? "Tauri facade is available; deterministic browser runtime owns run state.")
            : "Browser dev fallback is serving deterministic Ora JSON-RPC.",
        },
        patterns,
        providerRegistry,
        providerSecretStatuses,
        snapshot,
      };
    },
    async startRun(input: OraUserTaskInput, config: Partial<OraRunConfig>): Promise<OraStateSnapshot> {
      const handle = await call<OraRunHandle>("runs.start", { input, config });
      return call<OraStateSnapshot>("runs.state", { runId: handle.runId });
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
  };
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
  private runs = new Map<string, OraStateSnapshot>();
  private nextRunNumber = 1;

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

  previewState(pattern: CoordinationPattern, prompt: string): OraStateSnapshot {
    return this.createSnapshot("run-preview", pattern, prompt, 0, "running", undefined, {
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
    });
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
      case "patterns.list":
        return PATTERN_DEFINITIONS;
      case "providers.list":
        return {
          providers: DEFAULT_PROVIDERS,
          defaultProviderId: "local-smoke",
        };
      case "runs.start":
        return this.startRun(params);
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
        );
        this.runs.set(runId, snapshot);
        return {
          runId,
          status: snapshot.status,
          pattern,
          startedAt: snapshot.events[0]?.createdAt ?? snapshot.updatedAt,
        };
      }
      default:
        throw new Error(`Method not found: ${method}`);
    }
  }

  private startRun(params: unknown): OraRunHandle {
    const parsed = asStartRunParams(params);
    const pattern = parsed.config?.pattern ?? "orchestrator_subagent";
    const runId = `run-${String(this.nextRunNumber++).padStart(4, "0")}`;
    const startedAt = Date.now();
    const snapshot = this.createSnapshot(runId, pattern, parsed.input.prompt, startedAt, "succeeded", undefined, {
      providerId: parsed.config?.providerId ?? "local-smoke",
      modelRef: parsed.config?.modelRef ?? "local/smoke-model",
    });
    this.runs.set(runId, snapshot);

    return {
      runId,
      status: snapshot.status,
      pattern,
      startedAt,
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
    return updated;
  }

  private createSnapshot(
    runId: string,
    pattern: CoordinationPattern,
    prompt: string,
    startedAt: number,
    status: OraRunStatus,
    forkedFrom?: { runId: string; checkpointId: string; eventSeq: number },
    provider?: { providerId?: string; modelRef?: string },
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
        providerId: provider?.providerId ?? "local-smoke",
        modelRef: provider?.modelRef ?? "local/smoke-model",
        budget: definition.defaultBudget,
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
      output: {
        text: `Smoke result for ${definition.label}: ${prompt}`,
      },
      updatedAt: eventBase + 6000,
    };
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

function asStartRunParams(params: unknown): { input: OraUserTaskInput; config?: Partial<OraRunConfig> } {
  if (typeof params !== "object" || params === null || !("input" in params)) {
    throw new Error("Missing start run input");
  }

  const input = (params as { input: OraUserTaskInput }).input;
  if (!input || typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
    throw new Error("Start run prompt is required");
  }

  return params as { input: OraUserTaskInput; config?: Partial<OraRunConfig> };
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

const budget = (maxTokens: number, maxToolCalls: number, maxRuntimeMs: number, maxCostUsd: number): OraResourceBudget => ({
  maxTokens,
  maxToolCalls,
  maxRuntimeMs,
  maxCostUsd,
});

const DEFAULT_BUDGETS: Record<CoordinationPattern, OraResourceBudget> = {
  generator_verifier: budget(12000, 8, 180000, 2),
  orchestrator_subagent: budget(18000, 16, 300000, 3),
  agent_teams: budget(24000, 24, 600000, 5),
};

function profile(
  id: string,
  label: string,
  role: string,
  pattern: CoordinationPattern,
  namespaces: string[],
): OraAgentProfile {
  return {
    id,
    label,
    role,
    modelRef: "local/smoke-model",
    toolPolicyId: `${pattern}.default_policy`,
    memoryNamespaces: namespaces,
    budget: DEFAULT_BUDGETS[pattern],
  };
}

const PATTERN_DEFINITIONS: OraPatternDefinition[] = [
  {
    id: "orchestrator_subagent",
    label: "Orchestrator-Subagent",
    summary: "An orchestrator decomposes the task and dispatches explicit subagents.",
    recommendedUse: "Use as the default for decomposable tasks needing inspectable delegation.",
    failureMode: "Over-decomposition can spend budget on coordination instead of progress.",
    defaultConstraints: [
      "Keep subagents explicit in topology.",
      "Track plan items as Ora-owned records.",
      "Expose subagent state without leaking graph internals.",
    ],
    defaultBudget: DEFAULT_BUDGETS.orchestrator_subagent,
    profiles: [
      profile("orchestrator", "Orchestrator", "Plan, dispatch, and synthesize results.", "orchestrator_subagent", [
        "session",
        "project",
      ]),
      profile("researcher", "Research Subagent", "Gather focused context.", "orchestrator_subagent", [
        "session",
        "project",
      ]),
      profile("reviewer", "Review Subagent", "Check completeness and risks.", "orchestrator_subagent", [
        "session",
        "artifact",
      ]),
    ],
    topology: {
      nodes: [
        { id: "run", label: "Run", kind: "run", status: "idle", metadata: {} },
        { id: "orchestrator", label: "Orchestrator", kind: "agent", agentId: "orchestrator", status: "idle", metadata: {} },
        { id: "researcher", label: "Research", kind: "agent", agentId: "researcher", status: "idle", metadata: {} },
        { id: "reviewer", label: "Review", kind: "agent", agentId: "reviewer", status: "idle", metadata: {} },
        { id: "checkpoint", label: "Checkpoint", kind: "checkpoint", status: "blocked", metadata: {} },
      ],
      edges: [
        { id: "run-orchestrator", source: "run", target: "orchestrator", kind: "control", label: "task", metadata: {} },
        { id: "orchestrator-researcher", source: "orchestrator", target: "researcher", kind: "delegation", label: "research", metadata: {} },
        { id: "orchestrator-reviewer", source: "orchestrator", target: "reviewer", kind: "delegation", label: "review", metadata: {} },
        { id: "reviewer-checkpoint", source: "reviewer", target: "checkpoint", kind: "artifact", label: "state", metadata: {} },
      ],
    },
    planTemplate: [
      { id: "decompose", title: "Decompose task into inspectable plan", ownerAgentId: "orchestrator", dependencies: [] },
      { id: "research", title: "Gather focused supporting context", ownerAgentId: "researcher", dependencies: ["decompose"] },
      { id: "review", title: "Review result and surface risks", ownerAgentId: "reviewer", dependencies: ["research"] },
      { id: "synthesize", title: "Synthesize final response", ownerAgentId: "orchestrator", dependencies: ["review"] },
    ],
  },
  {
    id: "generator_verifier",
    label: "Generator-Verifier",
    summary: "A generator proposes an answer and a verifier checks it against a rubric.",
    recommendedUse: "Use when quality can be judged by explicit acceptance criteria.",
    failureMode: "Weak rubrics can create false confidence or unproductive retry loops.",
    defaultConstraints: ["Require a clear rubric before verification.", "Keep retries bounded.", "Attach verifier evidence."],
    defaultBudget: DEFAULT_BUDGETS.generator_verifier,
    profiles: [
      profile("generator", "Generator", "Produce the candidate answer.", "generator_verifier", ["session", "project"]),
      profile("verifier", "Verifier", "Evaluate the answer against the rubric.", "generator_verifier", [
        "session",
        "project",
        "artifact",
      ]),
    ],
    topology: {
      nodes: [
        { id: "run", label: "Run", kind: "run", status: "idle", metadata: {} },
        { id: "generator", label: "Generator", kind: "agent", agentId: "generator", status: "idle", metadata: {} },
        { id: "verifier", label: "Verifier", kind: "agent", agentId: "verifier", status: "blocked", metadata: {} },
      ],
      edges: [
        { id: "run-generator", source: "run", target: "generator", kind: "control", label: "draft", metadata: {} },
        { id: "generator-verifier", source: "generator", target: "verifier", kind: "verification", label: "check", metadata: {} },
      ],
    },
    planTemplate: [
      { id: "draft", title: "Draft candidate output", ownerAgentId: "generator", dependencies: [] },
      { id: "verify", title: "Verify against rubric", ownerAgentId: "verifier", dependencies: ["draft"] },
    ],
  },
  {
    id: "agent_teams",
    label: "Agent Teams",
    summary: "Persistent teammate agents coordinate around a shared backlog and memory.",
    recommendedUse: "Use when long-running workers need identity and context across tasks.",
    failureMode: "Unclear ownership can create duplicate work or stale worker memory.",
    defaultConstraints: ["Assign every plan item to an owner.", "Keep worker memory explicit.", "Summarize handoffs."],
    defaultBudget: DEFAULT_BUDGETS.agent_teams,
    profiles: [
      profile("team_lead", "Team Lead", "Prioritize backlog and coordinate workers.", "agent_teams", ["session", "project"]),
      profile("builder", "Builder", "Implement assigned work.", "agent_teams", ["session", "project", "worker"]),
      profile("checker", "Checker", "Validate completed work.", "agent_teams", ["session", "project", "worker", "artifact"]),
    ],
    topology: {
      nodes: [
        { id: "team_lead", label: "Team Lead", kind: "agent", agentId: "team_lead", status: "idle", metadata: {} },
        { id: "builder", label: "Builder", kind: "agent", agentId: "builder", status: "idle", metadata: {} },
        { id: "checker", label: "Checker", kind: "agent", agentId: "checker", status: "idle", metadata: {} },
        { id: "memory", label: "Shared Memory", kind: "capability", status: "blocked", metadata: {} },
      ],
      edges: [
        { id: "lead-builder", source: "team_lead", target: "builder", kind: "delegation", label: "assign", metadata: {} },
        { id: "builder-checker", source: "builder", target: "checker", kind: "verification", label: "validate", metadata: {} },
        { id: "checker-lead", source: "checker", target: "team_lead", kind: "control", label: "report", metadata: {} },
        { id: "lead-memory", source: "team_lead", target: "memory", kind: "memory", label: "scope", metadata: {} },
      ],
    },
    planTemplate: [
      { id: "triage", title: "Triage work into team backlog", ownerAgentId: "team_lead", dependencies: [] },
      { id: "build", title: "Complete assigned task", ownerAgentId: "builder", dependencies: ["triage"] },
      { id: "check", title: "Validate output", ownerAgentId: "checker", dependencies: ["build"] },
      { id: "handoff", title: "Record handoff and next action", ownerAgentId: "team_lead", dependencies: ["check"] },
    ],
  },
];

function getPatternDefinition(pattern: CoordinationPattern): OraPatternDefinition {
  return PATTERN_DEFINITIONS.find((definition) => definition.id === pattern) ?? PATTERN_DEFINITIONS[0];
}
