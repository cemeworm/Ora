import {
  DEFAULT_MODE_RECOVERY_POLICY,
  type ModeSpec,
  type RecoveryAction,
  type RecoveryErrorType,
  type RecoveryRule,
} from "@cemeworm/shared";

export interface RecoveryIncident {
  surface?: RecoveryFailureSurface;
  errorType: RecoveryErrorType;
  detail: string;
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
        return {
          action: "retry",
          attempt,
          maxAttempts,
          ruleId: rule.id,
          retryDelayMs,
          fallbackArtifact,
          summary: `Retrying ${incident.errorType} after attempt ${attempt}/${maxAttempts}.`,
        };
      }
      return fallbackArtifact
        ? fallbackDecision(incident, attempt, maxAttempts, rule)
        : failDecision(incident, attempt, maxAttempts, rule.id, "Retry attempts exhausted.");
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

  if (/boundary violation/i.test(lowered)) {
    errorType = "boundary_violation";
  } else if (
    context.surface === "provider" ||
    context.surface === "transport" ||
    context.surface === "sidecar"
  ) {
    if (matchesAny(lowered, ["quota", "billing", "credit", "payment"])) {
      errorType = "provider_quota";
    } else if (matchesAny(lowered, ["unknown provider"])) {
      errorType = "provider_config_error";
    } else if (matchesAny(lowered, ["api key", "authentication", "unauthorized", "forbidden", "access denied", "permission", "requires a baseurl"])) {
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
    errorType = matchesAny(lowered, ["approval", "denied", "not approved", "risky"])
      ? "tool_policy_denied"
      : "tool_error";
  } else if (context.surface === "model") {
    errorType = "model_output_invalid";
  } else {
    errorType = matchesAny(lowered, ["timeout", "timed out"]) ? "node_timeout" : "node_exception";
  }

  return {
    surface: context.surface,
    errorType,
    detail,
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

function recoveryAttemptKey(incident: RecoveryIncident) {
  return [
    incident.nodeId ?? "run",
    incident.errorType,
    incident.toolId ?? "none",
  ].join(":");
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
