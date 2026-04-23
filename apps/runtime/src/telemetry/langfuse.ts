import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  type LangfuseAgent,
  startActiveObservation,
  startObservation
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { CoordinationPattern, RunConfig, StateSnapshot, UserTaskInput } from "@ora/shared";
import type { ModelRequest, ModelResponse } from "../providers/types.js";

type RunLike = Pick<StateSnapshot, "runId" | "status" | "pattern" | "input" | "config" | "output" | "events" | "checkpoints" | "updatedAt">;

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
  if (!sdk) {
    return;
  }
  await sdk.shutdown();
  sdk = undefined;
  enabled = undefined;
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
      span.update({
        input: {
          prompt: params.input.prompt,
          config: params.config
        },
        metadata: runMetadata(params.runId, params.config.pattern, params.input)
      });

      try {
        const result = await fn();
        span.update({
          output: summarizeRunResult(result)
        });
        return result;
      } catch (error) {
        span.update({
          level: "ERROR",
          statusMessage: error instanceof Error ? error.message : String(error)
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
    child.end();
  }

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
    generation.end();
    return response;
  } catch (error) {
    generation.update({
      level: "ERROR",
      statusMessage: error instanceof Error ? error.message : String(error)
    });
    generation.end();
    throw error;
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
