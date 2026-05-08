import { LangfuseAPIClient, type ObservationsView, type TraceWithFullDetails } from "@langfuse/core";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  type LangfuseAgent,
  getActiveSpanId,
  getActiveTraceId,
  startActiveObservation,
  startObservation
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type {
  CoordinationPattern,
  EvaluationCase,
  RunConfig,
  RunTraceMetadata,
  StateSnapshot,
  TrailGenerationRef,
  TrailObservation,
  UserTaskInput
} from "@cemeworm/shared";
import type { ModelRequest, ModelResponse } from "../providers/types.js";

type RunLike = Pick<StateSnapshot, "runId" | "status" | "pattern" | "input" | "config" | "output" | "events" | "checkpoints" | "updatedAt">;

type RegisteredRunTrace = RunTraceMetadata & {
  observations: TrailObservation[];
};

export const ORA_MANAGED_LANGFUSE = {
  baseUrl: "http://localhost:3000",
  orgId: "ora-local",
  orgName: "Ora Local",
  projectId: "ora-runtime",
  projectName: "Ora Runtime",
  publicKey: "lf_pk_ora_local_runtime",
  secretKey: "lf_sk_ora_local_runtime",
  userEmail: "ora-local@localhost",
  userName: "Ora Local",
  userPassword: "ora-local-langfuse"
} as const;

let sdk: NodeSDK | undefined;
let enabled: boolean | undefined;
let apiClient: LangfuseAPIClient | undefined;
const runTraceRegistry = new Map<string, RegisteredRunTrace>();
const traceToRunRegistry = new Map<string, string>();

function shouldEnable(env: NodeJS.ProcessEnv): boolean {
  if (env.ORA_LANGFUSE_ENABLED === "false") {
    return false;
  }
  return env.ORA_LANGFUSE_ENABLED === "true" || Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}

export function managedLangfuseRuntimeEnv(): Record<string, string> {
  return {
    ORA_LANGFUSE_ENABLED: "true",
    LANGFUSE_BASE_URL: ORA_MANAGED_LANGFUSE.baseUrl,
    LANGFUSE_PUBLIC_KEY: ORA_MANAGED_LANGFUSE.publicKey,
    LANGFUSE_SECRET_KEY: ORA_MANAGED_LANGFUSE.secretKey,
    LANGFUSE_TRACING_ENVIRONMENT: "local"
  };
}

export function managedLangfuseBootstrapEnv(): Record<string, string> {
  return {
    LANGFUSE_INIT_ORG_ID: ORA_MANAGED_LANGFUSE.orgId,
    LANGFUSE_INIT_ORG_NAME: ORA_MANAGED_LANGFUSE.orgName,
    LANGFUSE_INIT_PROJECT_ID: ORA_MANAGED_LANGFUSE.projectId,
    LANGFUSE_INIT_PROJECT_NAME: ORA_MANAGED_LANGFUSE.projectName,
    LANGFUSE_INIT_PROJECT_PUBLIC_KEY: ORA_MANAGED_LANGFUSE.publicKey,
    LANGFUSE_INIT_PROJECT_SECRET_KEY: ORA_MANAGED_LANGFUSE.secretKey,
    LANGFUSE_INIT_USER_EMAIL: ORA_MANAGED_LANGFUSE.userEmail,
    LANGFUSE_INIT_USER_NAME: ORA_MANAGED_LANGFUSE.userName,
    LANGFUSE_INIT_USER_PASSWORD: ORA_MANAGED_LANGFUSE.userPassword
  };
}

export function initLangfuseTelemetry(env: NodeJS.ProcessEnv = process.env): boolean {
  if (enabled !== undefined) {
    return enabled;
  }

  enabled = shouldEnable(env);
  if (!enabled) {
    return false;
  }

  if (env.VITEST === "true" || env.NODE_ENV === "test") {
    return true;
  }

  try {
    sdk = new NodeSDK({
      spanProcessors: [
        new LangfuseSpanProcessor({
          publicKey: env.LANGFUSE_PUBLIC_KEY ?? ORA_MANAGED_LANGFUSE.publicKey,
          secretKey: env.LANGFUSE_SECRET_KEY ?? ORA_MANAGED_LANGFUSE.secretKey,
          baseUrl: env.LANGFUSE_BASE_URL ?? ORA_MANAGED_LANGFUSE.baseUrl,
          environment: env.LANGFUSE_TRACING_ENVIRONMENT ?? env.NODE_ENV ?? "local",
          release: env.LANGFUSE_RELEASE,
          exportMode: env.ORA_LANGFUSE_EXPORT_MODE === "immediate" ? "immediate" : "batched"
        })
      ]
    });
    sdk.start();
    return true;
  } catch (error) {
    enabled = false;
    process.stderr.write(
      `Langfuse telemetry disabled: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return false;
  }
}

export async function shutdownLangfuseTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
  sdk = undefined;
  apiClient = undefined;
  enabled = undefined;
  runTraceRegistry.clear();
  traceToRunRegistry.clear();
}

export function getLangfuseRunTraceMetadata(runId: string): RunTraceMetadata | undefined {
  const trace = runTraceRegistry.get(runId);
  if (!trace) {
    return undefined;
  }
  const { observations: _observations, ...metadata } = trace;
  return metadata;
}

export function getLangfuseRunTraceObservations(runId: string): TrailObservation[] {
  return runTraceRegistry.get(runId)?.observations ?? [];
}

export async function readLangfuseRunTrace(
  runId: string,
  base?: RunTraceMetadata
): Promise<{ trace: RunTraceMetadata; observations: TrailObservation[] }> {
  const merged = mergeTraceMetadata(runId, base);
  if (!merged.enabled) {
    return {
      trace: merged,
      observations: getLangfuseRunTraceObservations(runId),
    };
  }

  if (!merged.traceId) {
    return {
      trace: {
        ...merged,
        available: false,
        source: merged.generationRefs.length > 0 ? "local_synthesized" : "degraded",
        reason: merged.reason ?? "Langfuse trace id is not available for this run.",
      },
      observations: getLangfuseRunTraceObservations(runId),
    };
  }

  try {
    const client = getLangfuseApiClient();
    const trace = await client.trace.get(merged.traceId, { fields: "core,observations,metrics" });
    const observations = trace.observations.map(mapLangfuseObservation);
    const nextTrace: RunTraceMetadata = {
      ...merged,
      available: true,
      source: "managed_local",
      traceUrl: buildTraceUrl(resolveLangfuseConfig().baseUrl, trace.htmlPath, merged.traceId),
      generationRefs: mergeGenerationRefs(
        merged.generationRefs,
        observations
          .filter((observation) => observation.type.toLowerCase() === "generation")
          .map((observation) => ({
            observationId: observation.id,
            traceId: observation.traceId,
            parentObservationId: observation.parentObservationId ?? undefined,
            name: observation.name,
            model: observation.model,
            statusMessage: observation.statusMessage,
            totalCostUsd: observation.totalCostUsd,
            latencySeconds: observation.latencySeconds,
          })),
      ),
    };
    registerRunTrace(runId, nextTrace, observations);
    return { trace: nextTrace, observations };
  } catch (error) {
    const localObservations = getLangfuseRunTraceObservations(runId);
    const nextTrace: RunTraceMetadata = {
      ...merged,
      available: localObservations.length > 0 || merged.generationRefs.length > 0 || Boolean(merged.traceId),
      source: localObservations.length > 0 ? "local_synthesized" : "degraded",
      reason: error instanceof Error ? error.message : "Langfuse trace query failed.",
    };
    registerRunTrace(runId, nextTrace, localObservations);
    return { trace: nextTrace, observations: localObservations };
  }
}

export async function withLangfuseRunTrace<T>(
  params: {
    runId: string;
    input: UserTaskInput;
    config: RunConfig;
  },
  fn: () => Promise<T>
): Promise<T> {
  if (!initLangfuseTelemetry()) {
    return fn();
  }

  return startActiveObservation(
    `ora.run.${params.config.pattern}`,
    async (span: LangfuseAgent) => {
      const traceId = span.traceId ?? getActiveTraceId();
      const rootObservationId = span.id ?? getActiveSpanId();
      registerRunTrace(params.runId, {
        provider: "langfuse",
        enabled: true,
        available: true,
        traceId: traceId ?? undefined,
        rootObservationId: rootObservationId ?? undefined,
        traceUrl: buildTraceUrl(resolveLangfuseConfig().baseUrl, undefined, traceId ?? undefined),
        source: "managed_local",
        generationRefs: [],
      }, [
        {
          id: rootObservationId ?? `${params.runId}:trace-root`,
          traceId: traceId ?? params.runId,
          parentObservationId: null,
          type: "agent",
          name: `ora.run.${params.config.pattern}`,
          input: {
            prompt: params.input.prompt,
            config: params.config,
          },
          metadata: runMetadata(params.runId, params.config.pattern, params.input),
          startTime: new Date().toISOString(),
        },
      ]);

      span.update({
        input: {
          prompt: params.input.prompt,
          config: params.config
        },
        metadata: runMetadata(params.runId, params.config.pattern, params.input)
      });

      try {
        const result = await fn();
        if (isRunLike(result)) {
          registerEventObservations(params.runId, span, result);
        }
        span.update({
          output: summarizeRunResult(result)
        });
        updateRootObservation(params.runId, {
          output: summarizeRunResult(result),
          endTime: new Date().toISOString(),
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        span.update({
          level: "ERROR",
          statusMessage: message
        });
        updateRootObservation(params.runId, {
          endTime: new Date().toISOString(),
          level: "ERROR",
          statusMessage: message,
        });
        throw error;
      }
    },
    { asType: "agent" }
  );
}

export function recordLangfuseSnapshotTrace(snapshot: RunLike): void {
  if (!initLangfuseTelemetry()) {
    return;
  }

  const root = startObservation(
    `ora.run.${snapshot.pattern}`,
    {
      input: {
        prompt: snapshot.input.prompt,
        config: snapshot.config
      },
      output: {
        status: snapshot.status,
        output: snapshot.output,
        eventCount: snapshot.events.length,
        checkpointCount: snapshot.checkpoints.length
      },
      metadata: runMetadata(snapshot.runId, snapshot.pattern, snapshot.input)
    },
    { asType: "agent" }
  );

  registerRunTrace(snapshot.runId, {
    provider: "langfuse",
    enabled: true,
    available: true,
    traceId: root.traceId ?? undefined,
    rootObservationId: root.id ?? undefined,
    traceUrl: buildTraceUrl(resolveLangfuseConfig().baseUrl, undefined, root.traceId ?? undefined),
    source: "managed_local",
    generationRefs: [],
  }, [
    {
      id: root.id,
      traceId: root.traceId,
      parentObservationId: null,
      type: "agent",
      name: `ora.run.${snapshot.pattern}`,
      input: {
        prompt: snapshot.input.prompt,
        config: snapshot.config,
      },
      output: summarizeRunResult(snapshot),
      metadata: runMetadata(snapshot.runId, snapshot.pattern, snapshot.input),
      startTime: new Date(snapshot.updatedAt).toISOString(),
      endTime: new Date(snapshot.updatedAt).toISOString(),
    },
  ]);
  registerEventObservations(snapshot.runId, root, snapshot);
  root.end();
}

export async function traceLangfuseGeneration(
  params: {
    providerId: string | undefined;
    modelId: string;
    providerType: string;
    request: ModelRequest;
  },
  fn: () => Promise<ModelResponse>
): Promise<ModelResponse> {
  if (!initLangfuseTelemetry()) {
    return fn();
  }

  const traceId = getActiveTraceId();
  const parentObservationId = getActiveSpanId();
  const generation = startObservation(
    `model.${params.providerId ?? params.modelId}`,
    {
      input: modelInput(params.request),
      model: params.modelId,
      modelParameters: modelParameters(params.request),
      metadata: {
        providerId: params.providerId,
        providerType: params.providerType
      }
    },
    { asType: "generation" }
  );

  registerGenerationObservation(traceId, {
    observationId: generation.id,
    traceId: generation.traceId,
    parentObservationId: parentObservationId ?? undefined,
    name: `model.${params.providerId ?? params.modelId}`,
    providerId: params.providerId,
    providerType: params.providerType,
    model: params.modelId,
  }, {
    id: generation.id,
    traceId: generation.traceId,
    parentObservationId: parentObservationId ?? null,
    type: "generation",
    name: `model.${params.providerId ?? params.modelId}`,
    model: params.modelId,
    input: modelInput(params.request),
    metadata: {
      providerId: params.providerId,
      providerType: params.providerType,
    },
    startTime: new Date().toISOString(),
  });

  try {
    const response = await fn();
    generation.update({
      output: {
        text: response.text,
        raw: response.raw
      },
      model: response.modelId,
      metadata: {
        providerId: response.providerId,
        providerType: response.providerType
      }
    });
    updateGenerationObservation(traceId, generation.id, {
      model: response.modelId,
      output: {
        text: response.text,
      },
      endTime: new Date().toISOString(),
    }, {
      observationId: generation.id,
      traceId: generation.traceId,
      parentObservationId: parentObservationId ?? undefined,
      name: `model.${params.providerId ?? params.modelId}`,
      providerId: response.providerId,
      providerType: response.providerType,
      model: response.modelId,
    });
    generation.end();
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    generation.update({
      level: "ERROR",
      statusMessage: message
    });
    updateGenerationObservation(traceId, generation.id, {
      level: "ERROR",
      statusMessage: message,
      endTime: new Date().toISOString(),
    }, {
      observationId: generation.id,
      traceId: generation.traceId,
      parentObservationId: parentObservationId ?? undefined,
      name: `model.${params.providerId ?? params.modelId}`,
      providerId: params.providerId,
      providerType: params.providerType,
      model: params.modelId,
      statusMessage: message,
    });
    generation.end();
    throw error;
  }
}

export interface LangfuseScoreOptions {
  comment?: string;
  observationId?: string;
  dataType?: "NUMERIC" | "BOOLEAN" | "CATEGORICAL";
  configId?: string;
  environment?: string;
}

export async function scoreLangfuseTrace(
  traceId: string,
  name: string,
  value: number,
  options?: LangfuseScoreOptions
): Promise<{ status: "succeeded" | "failed"; error?: string }> {
  if (!initLangfuseTelemetry()) {
    return { status: "failed", error: "Langfuse telemetry is disabled." };
  }

  try {
    const client = getLangfuseApiClient();
    await client.legacy.scoreV1.create({
      traceId,
      name,
      value,
      comment: options?.comment,
      observationId: options?.observationId,
      dataType: options?.dataType ?? "NUMERIC",
      configId: options?.configId,
      environment: options?.environment,
    });
    return { status: "succeeded" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Langfuse score write failed (trace=${traceId}, name=${name}): ${message}\n`);
    return { status: "failed", error: message };
  }
}

export async function scoreLangfuseGeneration(
  traceId: string,
  observationId: string,
  name: string,
  value: number,
  options?: LangfuseScoreOptions
): Promise<{ status: "succeeded" | "failed"; error?: string }> {
  return scoreLangfuseTrace(traceId, name, value, { ...options, observationId });
}

export async function importLangfuseDataset(
  datasetName: string
): Promise<{ cases: EvaluationCase[]; error?: string }> {
  if (!initLangfuseTelemetry()) {
    return { cases: [], error: "Langfuse telemetry is disabled." };
  }

  try {
    const client = getLangfuseApiClient();
    const response = await client.datasetItems.list({ datasetName });
    const cases: EvaluationCase[] = response.data.map((item) => ({
      id: item.id,
      input: {
        prompt: typeof item.input === "string" ? item.input : JSON.stringify(item.input ?? ""),
        context: typeof item.input === "object" && item.input !== null && !Array.isArray(item.input)
          ? item.input as Record<string, unknown>
          : {},
      },
      expected: item.expectedOutput ? {
        text: typeof item.expectedOutput === "string" ? item.expectedOutput : JSON.stringify(item.expectedOutput),
      } : undefined,
      metadata: (typeof item.metadata === "object" && item.metadata !== null
        ? item.metadata as Record<string, unknown>
        : {}),
    }));
    return { cases };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { cases: [], error: message };
  }
}

export async function exportDatasetToLangfuse(
  datasetName: string,
  cases: EvaluationCase[],
  description?: string
): Promise<{ status: "succeeded" | "failed"; error?: string }> {
  if (!initLangfuseTelemetry()) {
    return { status: "failed", error: "Langfuse telemetry is disabled." };
  }

  try {
    const client = getLangfuseApiClient();

    try {
      await client.datasets.create({ name: datasetName, description, metadata: { source: "ora-runtime" } });
    } catch {
      // Dataset may already exist; continue
    }

    for (const evaluationCase of cases) {
      await client.datasetItems.create({
        datasetName,
        id: evaluationCase.id,
        input: evaluationCase.input,
        expectedOutput: evaluationCase.expected,
        metadata: evaluationCase.metadata,
      });
    }
    return { status: "succeeded" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Langfuse dataset export failed (dataset=${datasetName}): ${message}\n`);
    return { status: "failed", error: message };
  }
}

export async function createLangfuseExperiment(
  datasetName: string,
  runName: string,
  description?: string
): Promise<{ status: "succeeded" | "failed"; error?: string }> {
  if (!initLangfuseTelemetry()) {
    return { status: "failed", error: "Langfuse telemetry is disabled." };
  }

  try {
    // In Langfuse, experiments are dataset runs. Dataset runs are implicitly
    // created when datasetRunItems are created, so this is a no-op placeholder
    // that verifies the dataset exists.
    const client = getLangfuseApiClient();
    await client.datasets.get(datasetName);
    return { status: "succeeded" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Langfuse experiment creation failed (dataset=${datasetName}, run=${runName}): ${message}\n`);
    return { status: "failed", error: message };
  }
}

export async function logLangfuseExperimentResult(
  runName: string,
  datasetItemId: string,
  traceId: string,
  observationId?: string
): Promise<{ status: "succeeded" | "failed"; error?: string }> {
  if (!initLangfuseTelemetry()) {
    return { status: "failed", error: "Langfuse telemetry is disabled." };
  }

  try {
    const client = getLangfuseApiClient();
    await client.datasetRunItems.create({
      runName,
      datasetItemId,
      traceId,
      observationId,
    });
    return { status: "succeeded" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Langfuse experiment result logging failed (run=${runName}, item=${datasetItemId}): ${message}\n`
    );
    return { status: "failed", error: message };
  }
}

export interface LangfusePromptRef {
  name: string;
  version?: number;
  label?: string;
}

export async function fetchLangfusePrompt(
  promptName: string,
  version?: number,
  label?: string
): Promise<{ text: string; version: number; error?: string }> {
  if (!initLangfuseTelemetry()) {
    return { text: "", version: 0, error: "Langfuse telemetry is disabled." };
  }

  try {
    const client = getLangfuseApiClient();
    const prompt = await client.prompts.get(promptName, { version, label });

    if ("prompt" in prompt && typeof prompt.prompt === "string") {
      return { text: prompt.prompt, version: prompt.version };
    }
    if ("prompt" in prompt && Array.isArray(prompt.prompt)) {
      const text = prompt.prompt
        .map((msg) => {
          if (typeof msg === "object" && msg !== null && "content" in msg) {
            return `${msg.role}: ${(msg as { content: string }).content}`;
          }
          return JSON.stringify(msg);
        })
        .join("\n");
      return { text, version: prompt.version };
    }
    return { text: JSON.stringify(prompt), version: 0, error: "Unexpected prompt format." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: "", version: 0, error: message };
  }
}

export async function listLangfusePrompts(): Promise<{
  prompts: Array<{ name: string; versions: number[]; labels: string[] }>;
  error?: string;
}> {
  if (!initLangfuseTelemetry()) {
    return { prompts: [], error: "Langfuse telemetry is disabled." };
  }

  try {
    const client = getLangfuseApiClient();
    const response = await client.prompts.list();
    return {
      prompts: response.data.map((meta) => ({
        name: meta.name,
        versions: meta.versions,
        labels: meta.labels,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { prompts: [], error: message };
  }
}

function runMetadata(runId: string, pattern: CoordinationPattern, input: UserTaskInput) {
  return {
    source: "ora-runtime",
    runId,
    pattern,
    projectId: input.projectId
  };
}

function summarizeRunResult(result: unknown) {
  if (isRunLike(result)) {
    return {
      status: result.status,
      output: result.output,
      eventCount: result.events.length,
      checkpointCount: result.checkpoints.length
    };
  }
  return result;
}

function isRunLike(result: unknown): result is RunLike {
  return Boolean(
    result
      && typeof result === "object"
      && "runId" in result
      && "status" in result
      && "events" in result
      && Array.isArray((result as { events?: unknown }).events)
  );
}

function startChildObservation(
  root: LangfuseAgent,
  name: string,
  attributes: {
    input: unknown;
    metadata: Record<string, unknown>;
  }
) {
  const observationType = observationTypeForEvent(name);
  switch (observationType) {
    case "generation":
      return root.startObservation(name, attributes, { asType: "generation" });
    case "event":
      return root.startObservation(name, attributes, { asType: "event" });
    case "tool":
      return root.startObservation(name, attributes, { asType: "tool" });
    case "span":
      return root.startObservation(name, attributes, { asType: "span" });
  }
}

function observationTypeForEvent(type: string): "span" | "event" | "tool" | "generation" {
  if (type === "message.delta" || type === "token.delta") {
    return "generation";
  }
  if (type === "action.updated" || type.startsWith("approval.")) {
    return "tool";
  }
  if (type === "checkpoint.created") {
    return "event";
  }
  return "span";
}

function modelInput(request: ModelRequest) {
  return {
    prompt: request.prompt,
    system: request.system,
    messages: request.messages
  };
}

function modelParameters(request: ModelRequest): Record<string, number> {
  const params: Record<string, number> = {};
  if (request.temperature !== undefined) {
    params.temperature = request.temperature;
  }
  if (request.maxTokens !== undefined) {
    params.maxTokens = request.maxTokens;
  }
  return params;
}

function getLangfuseApiClient(): LangfuseAPIClient {
  if (apiClient) {
    return apiClient;
  }
  const config = resolveLangfuseConfig();
  apiClient = new LangfuseAPIClient({
    environment: () => config.environment,
    baseUrl: () => config.baseUrl,
    username: () => config.publicKey,
    password: () => config.secretKey,
  });
  return apiClient;
}

function resolveLangfuseConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    baseUrl: env.LANGFUSE_BASE_URL ?? ORA_MANAGED_LANGFUSE.baseUrl,
    publicKey: env.LANGFUSE_PUBLIC_KEY ?? ORA_MANAGED_LANGFUSE.publicKey,
    secretKey: env.LANGFUSE_SECRET_KEY ?? ORA_MANAGED_LANGFUSE.secretKey,
    environment: env.LANGFUSE_TRACING_ENVIRONMENT ?? env.NODE_ENV ?? "local",
  };
}

function buildTraceUrl(baseUrl: string, htmlPath?: string | null, traceId?: string) {
  if (htmlPath) {
    if (htmlPath.startsWith("http://") || htmlPath.startsWith("https://")) {
      return htmlPath;
    }
    return `${baseUrl.replace(/\/$/, "")}${htmlPath.startsWith("/") ? htmlPath : `/${htmlPath}`}`;
  }
  if (!traceId) {
    return undefined;
  }
  return `${baseUrl.replace(/\/$/, "")}/project/${ORA_MANAGED_LANGFUSE.projectId}/traces/${traceId}`;
}

function mapLangfuseObservation(observation: ObservationsView): TrailObservation {
  return {
    id: observation.id,
    traceId: observation.traceId ?? "unknown-trace",
    parentObservationId: observation.parentObservationId,
    type: observation.type,
    name: observation.name ?? observation.type,
    level: observation.level,
    statusMessage: observation.statusMessage ?? undefined,
    model: observation.model ?? undefined,
    startTime: observation.startTime,
    endTime: observation.endTime,
    input: observation.input,
    output: observation.output,
    metadata: asRecord(observation.metadata),
    latencySeconds: observation.latency ?? undefined,
    totalCostUsd: observation.totalPrice ?? observation.costDetails?.total ?? undefined,
  };
}

function mergeTraceMetadata(runId: string, base?: RunTraceMetadata): RunTraceMetadata {
  const registered = getLangfuseRunTraceMetadata(runId);
  if (registered && base) {
    return {
      ...base,
      ...registered,
      generationRefs: mergeGenerationRefs(base.generationRefs, registered.generationRefs),
    };
  }
  if (registered) {
    return registered;
  }
  if (base) {
    return base;
  }
  return {
    provider: "langfuse",
    enabled: false,
    available: false,
    source: "disabled",
    reason: "Langfuse tracing is disabled for this run.",
    generationRefs: [],
  };
}

function registerRunTrace(runId: string, trace: RunTraceMetadata, observations: TrailObservation[]) {
  const current = runTraceRegistry.get(runId);
  const next: RegisteredRunTrace = {
    provider: "langfuse",
    enabled: trace.enabled,
    available: trace.available,
    traceId: trace.traceId ?? current?.traceId,
    rootObservationId: trace.rootObservationId ?? current?.rootObservationId,
    traceUrl: trace.traceUrl ?? current?.traceUrl,
    source: trace.source,
    reason: trace.reason,
    generationRefs: mergeGenerationRefs(current?.generationRefs, trace.generationRefs),
    observations: mergeObservations(current?.observations, observations),
  };
  if (next.traceId) {
    traceToRunRegistry.set(next.traceId, runId);
  }
  runTraceRegistry.set(runId, next);
}

function registerEventObservations(runId: string, root: LangfuseAgent, snapshot: RunLike) {
  const nextObservations: TrailObservation[] = [];
  for (const event of snapshot.events) {
    const child = startChildObservation(
      root,
      event.type,
      {
        input: event.payload,
        metadata: {
          runId: snapshot.runId,
          seq: event.seq,
          eventType: event.type,
          checkpointId: event.checkpointId
        }
      }
    );
    nextObservations.push({
      id: child.id,
      traceId: child.traceId,
      parentObservationId: root.id,
      type: observationTypeForEvent(event.type),
      name: event.type,
      startTime: new Date(event.createdAt).toISOString(),
      endTime: new Date(event.createdAt).toISOString(),
      input: event.payload,
      metadata: {
        runId: snapshot.runId,
        seq: event.seq,
        eventType: event.type,
        checkpointId: event.checkpointId,
      },
    });
    child.end();
  }
  registerRunTrace(runId, {
    provider: "langfuse",
    enabled: true,
    available: true,
    traceId: root.traceId ?? undefined,
    rootObservationId: root.id ?? undefined,
    traceUrl: buildTraceUrl(resolveLangfuseConfig().baseUrl, undefined, root.traceId ?? undefined),
    source: "managed_local",
    generationRefs: [],
  }, nextObservations);
}

function registerGenerationObservation(
  traceId: string | undefined,
  ref: TrailGenerationRef,
  observation: TrailObservation
) {
  if (!traceId) {
    return;
  }
  const runId = traceToRunRegistry.get(traceId);
  if (!runId) {
    return;
  }
  const current = runTraceRegistry.get(runId);
  registerRunTrace(runId, {
    provider: "langfuse",
    enabled: true,
    available: true,
    traceId,
    rootObservationId: current?.rootObservationId,
    traceUrl: current?.traceUrl ?? buildTraceUrl(resolveLangfuseConfig().baseUrl, undefined, traceId),
    source: "managed_local",
    generationRefs: mergeGenerationRefs(current?.generationRefs, [ref]),
  }, [observation]);
}

function updateGenerationObservation(
  traceId: string | undefined,
  observationId: string,
  observationPatch: Partial<TrailObservation>,
  refPatch: TrailGenerationRef
) {
  if (!traceId) {
    return;
  }
  const runId = traceToRunRegistry.get(traceId);
  if (!runId) {
    return;
  }
  const current = runTraceRegistry.get(runId);
  if (!current) {
    return;
  }
  const observations = current.observations.map((item) => (
    item.id === observationId ? { ...item, ...observationPatch } : item
  ));
  const generationRefs = current.generationRefs.map((item) => (
    item.observationId === observationId ? { ...item, ...refPatch } : item
  ));
  if (!generationRefs.some((item) => item.observationId === observationId)) {
    generationRefs.push(refPatch);
  }
  registerRunTrace(runId, {
    provider: "langfuse",
    enabled: true,
    available: true,
    traceId,
    rootObservationId: current.rootObservationId,
    traceUrl: current.traceUrl,
    source: "managed_local",
    generationRefs,
  }, observations);
}

function updateRootObservation(runId: string, patch: Partial<TrailObservation>) {
  const current = runTraceRegistry.get(runId);
  if (!current?.rootObservationId) {
    return;
  }
  const observations = current.observations.map((item) => (
    item.id === current.rootObservationId ? { ...item, ...patch } : item
  ));
  registerRunTrace(runId, current, observations);
}

function mergeGenerationRefs(
  previous: TrailGenerationRef[] | undefined,
  next: TrailGenerationRef[] | undefined
) {
  const merged = new Map<string, TrailGenerationRef>();
  for (const ref of previous ?? []) {
    merged.set(ref.observationId, ref);
  }
  for (const ref of next ?? []) {
    merged.set(ref.observationId, {
      ...merged.get(ref.observationId),
      ...ref,
    });
  }
  return [...merged.values()];
}

function mergeObservations(
  previous: TrailObservation[] | undefined,
  next: TrailObservation[] | undefined
) {
  const merged = new Map<string, TrailObservation>();
  for (const observation of previous ?? []) {
    merged.set(observation.id, observation);
  }
  for (const observation of next ?? []) {
    merged.set(observation.id, {
      ...merged.get(observation.id),
      ...observation,
      metadata: {
        ...asRecord(merged.get(observation.id)?.metadata),
        ...asRecord(observation.metadata),
      },
    });
  }
  return [...merged.values()].sort((a, b) => {
    const left = a.startTime ?? "";
    const right = b.startTime ?? "";
    return left.localeCompare(right) || a.id.localeCompare(b.id);
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
