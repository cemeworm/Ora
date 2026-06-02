import {
  DEFAULT_MODE_RECOVERY_POLICY,
  type ModeSpec,
  type RecoveryAction,
  type RecoveryErrorType,
  type RecoveryRule,
} from "@cemeworm/shared";
import {
  ProviderCircuitOpenError,
  isProviderTransientExhaustedError,
} from "../providers/provider-health.js";
import { ProviderFetchError } from "../providers/provider-utils.js";
import { isSpawnContractViolationError } from "./runtime-interrupts.js";

export interface RecoveryIncident {
  surface?: RecoveryFailureSurface;
  errorType: RecoveryErrorType;
  detail: string;
  retryAfterMs?: number;
  attemptScope?: string;
  nodeId?: string;
  nodeTemplate?: string;
  agentId?: string;
  toolId?: string;
  actionId?: string;
  currentState?: string;
  ownerActionId?: string;
  ownerToolId?: string;
}

export type RecoveryFailureSurface =
  | "tool"
  | "provider"
  | "transport"
  | "sidecar"
  | "model"
  | "node"
  | "unknown";

export interface RecoveryDecision {
  action: RecoveryAction;
  attempt: number;
  maxAttempts: number;
  ruleId?: string;
  retryDelayMs?: number;
  alternateToolId?: string;
  fallbackArtifact: boolean;
  summary: string;
  usableOutput?: unknown;
}

export class RecoveryLedger {
  private readonly attempts = new Map<string, number>();

  nextAttempt(incident: RecoveryIncident): number {
    const key = recoveryAttemptKey(incident);
    const next = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, next);
    return next;
  }
}

export class RecoveryCoordinator {
  private readonly enabled: boolean;

  constructor(
    private readonly modeSpec: ModeSpec,
    private readonly enabledToolIds: readonly string[],
    private readonly ledger = new RecoveryLedger(),
  ) {
    this.enabled = modeSpec.runtimeAtoms.includes("recovery_policy") || modeSpec.runtimeAtoms.includes("tool_error_boundary");
  }

  resolve(incident: RecoveryIncident): RecoveryDecision {
    const attempt = this.ledger.nextAttempt(incident);
    if (!this.enabled) {
      return failDecision(incident, attempt, 1, undefined, "Recovery policy is disabled.");
    }

    const policy = this.modeSpec.runtimeAtoms.includes("recovery_policy")
      ? this.modeSpec.recoveryPolicy
      : DEFAULT_MODE_RECOVERY_POLICY;
    const rule = policy.rules.find((candidate) => ruleMatches(candidate, incident));
    const maxAttempts = rule?.maxAttempts ?? policy.defaults.maxAttempts;
    const fallbackArtifact = policy.defaults.fallbackArtifact;

    if (!rule) {
      return failDecision(incident, attempt, maxAttempts, undefined, "No recovery rule matched.");
    }

    if (rule.action === "retry") {
      if (attempt < maxAttempts) {
        const retryDelayMs = Math.min(
          Math.round(policy.defaults.backoffMs * (policy.defaults.backoffMultiplier ** Math.max(0, attempt - 1))),
          policy.defaults.capDelayMs,
        );
        const effectiveRetryDelayMs = Math.max(retryDelayMs, incident.retryAfterMs ?? 0);
        return {
          action: "retry",
          attempt,
          maxAttempts,
          ruleId: rule.id,
          retryDelayMs: effectiveRetryDelayMs,
          fallbackArtifact,
          summary: `Retrying ${incident.errorType} after attempt ${attempt}/${maxAttempts}.`,
        };
      }
      return failDecision(incident, attempt, maxAttempts, rule.id, "Retry attempts exhausted.");
    }

    if (rule.action === "alternate_tool") {
      const alternateToolId = rule.alternateToolIds.find((toolId) => this.enabledToolIds.includes(toolId));
      if (alternateToolId) {
        return {
          action: "alternate_tool",
          attempt,
          maxAttempts,
          ruleId: rule.id,
          alternateToolId,
          fallbackArtifact,
          summary: `Switching from ${incident.toolId ?? "tool"} to ${alternateToolId}.`,
        };
      }
      return fallbackArtifact
        ? fallbackDecision(incident, attempt, maxAttempts, rule)
        : failDecision(incident, attempt, maxAttempts, rule.id, "No configured alternate tool is enabled.");
    }

    if (rule.action === "fallback_artifact") {
      return fallbackDecision(incident, attempt, maxAttempts, rule);
    }

    return {
      action: rule.action,
      attempt,
      maxAttempts,
      ruleId: rule.id,
      fallbackArtifact,
      summary: rule.action === "skip_node"
        ? `Skipping node after ${incident.errorType}.`
        : rule.action === "interrupt"
          ? `Interrupting after ${incident.errorType}.`
          : `Failing after ${incident.errorType}.`,
    };
  }
}

export function classifyRecoveryError(error: unknown, context: {
  surface: RecoveryFailureSurface;
  attemptScope?: string;
  nodeId?: string;
  nodeTemplate?: string;
  agentId?: string;
  toolId?: string;
  actionId?: string;
  currentState?: string;
  ownerActionId?: string;
  ownerToolId?: string;
}): RecoveryIncident {
  const detail = errorDetail(error);
  const lowered = detail.toLowerCase();
  let errorType: RecoveryErrorType;

  if (isSpawnContractViolationError(error)) {
    errorType = "boundary_violation";
  } else if (/boundary violation/i.test(lowered)) {
    errorType = "boundary_violation";
  } else if (
    context.surface === "provider" ||
    context.surface === "transport" ||
    context.surface === "sidecar"
  ) {
    const structuredProviderType = classifyStructuredProviderError(error);
    if (structuredProviderType) {
      errorType = structuredProviderType;
    } else if (matchesAny(lowered, ["no project folder", "a selected project folder is required", "eacces", "eperm", "permission denied"])) {
      errorType = "env_unavailable";
    } else if (matchesAny(lowered, ["quota", "billing", "credit", "payment"])) {
      errorType = "provider_quota";
    } else if (matchesAny(lowered, ["unknown provider", "requires a baseurl", "invalid url"])) {
      errorType = "provider_config_error";
    } else if (matchesAny(lowered, ["api key", "authentication", "unauthorized", "forbidden", "access denied"])) {
      errorType = "provider_auth";
    } else if (matchesAny(lowered, ["invalid_request_error", "reasoning_content", "bad request"])) {
      errorType = "model_output_invalid";
    } else if (matchesAny(lowered, ["busy", "overloaded", "rate limit", "429", "temporarily unavailable", "try again later"])) {
      errorType = "provider_busy";
    } else if (matchesAny(lowered, ["timeout", "connection", "408", "409", "425", "500", "502", "503", "504"])) {
      errorType = "provider_transient";
    } else {
      errorType = "provider_transient";
    }
  } else if (context.surface === "tool") {
    const code = classifyCode(errorCode(error));
    if (isToolPolicyDenied(lowered)) {
      errorType = "tool_policy_denied";
    } else if (code === "env_unavailable" || isToolEnvironmentUnavailable(lowered)) {
      errorType = "env_unavailable";
    } else {
      errorType = "tool_error";
    }
  } else if (context.surface === "model") {
    errorType = "model_output_invalid";
  } else {
    errorType = matchesAny(lowered, ["timeout", "timed out"]) ? "node_timeout" : "node_exception";
  }

  return {
    surface: context.surface,
    errorType,
    detail,
    retryAfterMs: providerRetryAfterMs(error),
    attemptScope: context.attemptScope,
    nodeId: context.nodeId,
    nodeTemplate: context.nodeTemplate,
    agentId: context.agentId,
    toolId: context.toolId,
    actionId: context.actionId,
    currentState: context.currentState,
    ownerActionId: context.ownerActionId,
    ownerToolId: context.ownerToolId,
  };
}

function ruleMatches(rule: RecoveryRule, incident: RecoveryIncident) {
  if (!rule.enabled || !rule.errorTypes.includes(incident.errorType)) {
    return false;
  }
  if (rule.nodeIds.length > 0 && (!incident.nodeId || !rule.nodeIds.includes(incident.nodeId))) {
    return false;
  }
  if (rule.nodeTemplates.length > 0 && (!incident.nodeTemplate || !rule.nodeTemplates.includes(incident.nodeTemplate))) {
    return false;
  }
  if (rule.toolIds.length > 0 && (!incident.toolId || !rule.toolIds.includes(incident.toolId))) {
    return false;
  }
  return true;
}

function isToolPolicyDenied(lowered: string): boolean {
  return matchesAny(lowered, [
    "approval",
    "denied",
    "not approved",
    "risky",
    "not available in plan mode",
    "not available in the current mode",
    "requires user approval before execution",
    "denied by the active permission profile",
  ]);
}

function isToolEnvironmentUnavailable(lowered: string): boolean {
  return matchesAny(lowered, [
    "no project folder",
    "eacces",
    "enoent",
    "eperm",
    "permission denied",
    "workspace file and shell tools are unavailable",
    "a selected project folder is required",
    "host file scope requires an absolute path",
    "host file grant is required for this path",
    "host file path must stay inside the approved grant root",
    "host file grant does not allow this operation",
    "host file grant does not allow write access",
    "registry is required",
    "package manager is required",
    "mcp client",
    "mcp server",
    "is not configured",
    "requires searchprovider.mcpserverid",
    "missing runtime-sidecar assets",
    "missing frontend assets",
  ]);
}

function classifyStructuredProviderError(error: unknown): RecoveryErrorType | undefined {
  if (isProviderCircuitOpenError(error)) {
    return "provider_busy";
  }
  return classifyCode(errorCode(error));
}

function classifyCode(code: string | undefined): RecoveryErrorType | undefined {
  if (!code) {
    return undefined;
  }
  const normalized = code.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "401" || normalized === "403") {
    return "provider_auth";
  }
  if (normalized === "402") {
    return "provider_quota";
  }
  if (normalized === "408" || normalized === "409" || normalized === "425" || normalized === "429"
    || normalized === "500" || normalized === "502" || normalized === "503" || normalized === "504") {
    return normalized === "429" ? "provider_busy" : "provider_transient";
  }
  if (normalized === "EACCES" || normalized === "EPERM" || normalized === "ENOENT") {
    return "env_unavailable";
  }
  if (normalized === "ERR_INVALID_URL" || normalized === "ERR_INVALID_ARG_TYPE" || normalized === "ERR_INVALID_ARG_VALUE") {
    return "provider_config_error";
  }
  if (
    normalized === "ECONNRESET"
    || normalized === "ETIMEDOUT"
    || normalized === "ECONNREFUSED"
    || normalized === "EHOSTUNREACH"
    || normalized === "ENETUNREACH"
    || normalized === "EAI_AGAIN"
    || normalized === "ENOTFOUND"
    || normalized === "ABORT_ERR"
    || normalized === "UND_ERR_SOCKET"
    || normalized === "UND_ERR_CONNECT_TIMEOUT"
    || normalized === "UND_ERR_HEADERS_TIMEOUT"
    || normalized === "UND_ERR_BODY_TIMEOUT"
  ) {
    return "provider_transient";
  }
  return undefined;
}

function isProviderCircuitOpenError(error: unknown): error is ProviderCircuitOpenError {
  return error instanceof ProviderCircuitOpenError
    || (typeof error === "object" && error !== null
      && (error as { name?: unknown }).name === "ProviderCircuitOpenError"
      && typeof (error as { providerId?: unknown }).providerId === "string");
}

function providerRetryAfterMs(error: unknown): number | undefined {
  if (
    !isProviderCircuitOpenError(error)
    && !isProviderTransientExhaustedError(error)
    && !(typeof error === "object" && error !== null && (error as { retryAfterMs?: unknown }).retryAfterMs !== undefined)
  ) {
    return undefined;
  }
  const retryAfterMs = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? retryAfterMs
    : undefined;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const nestedCause = error instanceof ProviderFetchError
    ? error.cause
    : (error as { cause?: unknown }).cause;
  if (nestedCause) {
    return errorCode(nestedCause);
  }
  return undefined;
}

function recoveryAttemptKey(incident: RecoveryIncident) {
  return [
    incident.attemptScope ?? "run",
    incident.nodeId ?? "run",
    incident.errorType,
    incident.toolId ?? "none",
  ].join(":");
}

export class RecoveryExhaustedError extends Error {
  constructor(
    public readonly incident: RecoveryIncident,
    public readonly decision: RecoveryDecision,
  ) {
    super(decision.summary);
    this.name = "RecoveryExhaustedError";
  }
}

export function isRecoveryExhaustedError(error: unknown): error is RecoveryExhaustedError {
  return error instanceof RecoveryExhaustedError;
}

function fallbackDecision(
  incident: RecoveryIncident,
  attempt: number,
  maxAttempts: number,
  rule: RecoveryRule,
): RecoveryDecision {
  return {
    action: "fallback_artifact",
    attempt,
    maxAttempts,
    ruleId: rule.id,
    fallbackArtifact: true,
    summary: rule.fallbackSummary ?? `${incident.errorType} recovered with a degraded artifact.`,
    usableOutput: rule.fallbackUsableOutput,
  };
}

function failDecision(
  incident: RecoveryIncident,
  attempt: number,
  maxAttempts: number,
  ruleId: string | undefined,
  reason: string,
): RecoveryDecision {
  return {
    action: "fail",
    attempt,
    maxAttempts,
    ruleId,
    fallbackArtifact: false,
    summary: `${reason} ${incident.errorType}: ${incident.detail}`,
  };
}

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  const detail = String(error).trim();
  return detail || "Unknown runtime error";
}

function matchesAny(detail: string, patterns: readonly string[]) {
  return patterns.some((pattern) => detail.includes(pattern));
}
