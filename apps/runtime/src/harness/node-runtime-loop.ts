import type {
  ArtifactRef,
  CausalTaskState,
  ChildSessionSummary,
  CompletionStopReason,
  ModeSpec,
  OraEventEnvelope,
  OraToolCallEnvelope,
  PlanListStep,
  PendingClarificationOption,
  RunConfig,
} from "@cemeworm/shared";
import {
  isInternalAssistantText as isSharedInternalAssistantText,
  isInternalRecoveryFallbackText as isSharedInternalRecoveryFallbackText,
  stripInternalAssistantProtocolText,
} from "@cemeworm/shared";
import { buildCommentaryDelta } from "../commentary-delta.js";
import { invokeRunProvider, invokeRunProviderStream } from "../providers/index.js";
import type { ModelMessage, ModelRequest, ModelResponse } from "../providers/index.js";
import type { ModelStreamEvent } from "../providers/types.js";
import {
  classifyRecoveryError,
  RecoveryExhaustedError,
  type RecoveryCoordinator,
  type RecoveryDecision,
  type RecoveryIncident,
} from "./recovery-policy.js";
import { RUNTIME_TOOL_LOOP_SAFETY_LIMIT, type RuntimeCompletionController } from "./runtime-completion.js";
import { evaluateRuntimeCompletionGuards, finalOutputGuard } from "./runtime-completion-guards.js";
import { forcedFinalSystemPrompt } from "./runtime-output.js";
import type { RuntimeActionDeps } from "./runtime-action-runner.js";
import { buildModelRequestCacheDiagnostics } from "../providers/provider-utils.js";
import {
  providerSupportsNativeTools,
  cacheKeyForRuntimeTool,
  invalidatesRuntimeToolCache,
  nativeRuntimeToolAttempts,
  selectRuntimeToolAttempt,
} from "./runtime-tool-loop.js";
import { RuntimeToolExecutor, type RuntimeFileChangeMetadata, type RuntimeToolCall } from "./runtime-tool-executor.js";
import type { AppendRuntimeToolCallParams } from "./runtime-tool-ledger.js";
import {
  buildRuntimeMiddlewares,
  invokeRuntimeModelCall,
  invokeRuntimeModelResponse,
  invokeRuntimeToolExecution,
  invokeRuntimeToolFailure,
  type RuntimeModelResponseContext,
  type RuntimeMiddlewareContext,
  type RuntimeToolExecutionContext,
  type RuntimeToolFailureContext,
  type RuntimeToolFailureRequest,
} from "./runtime-middleware.js";
import {
  NodeLoopController,
} from "./node-loop-transitions.js";
import { routeIntervention, applyCausalPolicyGate, interventionActionToLabel } from "./causal-policy-router.js";
import {
  classifyToolRisk,
  isReadContextTool,
  isSearchTool,
  ORA_ROOT_AGENT_ID,
  SINGLE_AGENT_MODE_ID,
} from "@cemeworm/shared";
import {
  extractCausalTaskState as defaultExtractCausalTaskState,
  hasPrimaryCausalDecisionInPhase,
  latestCausalTaskState,
  type ExtractCausalTaskStateParams,
} from "./causal-task-state-extractor.js";
import {
  planStepBlockerFingerprint,
  requestPlanStepBlockerClarification,
} from "./runtime-clarifications.js";
import { registerRuntimeToolAttempt } from "./runtime-tool-attempt.js";
import { codeDevelopmentToolBoundaryError } from "./runtime-tool-boundary.js";
import { RuntimeToolCallService } from "./runtime-tool-call-service.js";
import { RuntimeToolRecoveryService } from "./runtime-tool-recovery-service.js";
import { logLatency } from "../latency-log.js";

export type NodeRuntimeLoopState =
  | "pending"
  | "running_model"
  | "tool_requested"
  | "tool_running"
  | "tool_result_observed"
  | "repairing"
  | "finalizing"
  | "completed"
  | "degraded"
  | "interrupted"
  | "failed";

type RuntimeLoopEmit = (
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => OraEventEnvelope;

export function shouldEmitProviderStreamEvent(
  event: Pick<ModelStreamEvent, "kind">,
  emittedProviderStreamFrameForInvocation: boolean,
): boolean {
  return event.kind !== "sse_frame" || !emittedProviderStreamFrameForInvocation;
}

export function shouldBlockFinalForFreshnessPolicy(params: {
  enabled: boolean;
  prompt: string;
  toolCalls: readonly OraToolCallEnvelope[];
  currentTaskState?: Partial<CausalTaskState>;
  toolCallCount: number;
  clarificationCount: number;
  hasUnresolvedPlanItems: boolean;
  responseText: string;
  routerVersion: "v1" | "v2";
}): boolean {
  if (!params.enabled || params.routerVersion !== "v2") return false;
  if (params.currentTaskState?.needsFreshnessEvidence !== true) return false;
  if (hasSucceededSearchEvidence(params.toolCalls)) return false;
  const policyResult = routeIntervention({
    surfaceRequest: params.prompt,
    taskState: params.currentTaskState,
    proposedToolId: undefined,
    proposedToolRisk: "low",
    toolCallCount: params.toolCallCount,
    clarificationCount: params.clarificationCount,
    hasPendingApprovals: false,
    hasPendingPlanDecisions: false,
    hasUnresolvedPlanItems: params.hasUnresolvedPlanItems,
    modelResponseText: params.responseText,
    routerVersion: params.routerVersion,
  });
  return policyResult.action === "search_web";
}

export function shouldBlockFinalForReadContextPolicy(params: {
  enabled: boolean;
  prompt: string;
  toolCalls: readonly OraToolCallEnvelope[];
  currentTaskState?: Partial<CausalTaskState>;
  toolCallCount: number;
  clarificationCount: number;
  hasUnresolvedPlanItems: boolean;
  responseText: string;
  routerVersion: "v1" | "v2";
}): boolean {
  if (!params.enabled || params.routerVersion !== "v2") return false;
  if (hasReadContextEvidence(params.toolCalls)) return false;
  const policyResult = routeIntervention({
    surfaceRequest: params.prompt,
    taskState: params.currentTaskState,
    proposedToolId: undefined,
    proposedToolRisk: "low",
    toolCallCount: params.toolCallCount,
    clarificationCount: params.clarificationCount,
    hasPendingApprovals: false,
    hasPendingPlanDecisions: false,
    hasUnresolvedPlanItems: params.hasUnresolvedPlanItems,
    modelResponseText: params.responseText,
    routerVersion: params.routerVersion,
  });
  return policyResult.action === "read_context";
}

export function shouldRepairReadContextDiagnosisWithoutEvidence(params: {
  enabled: boolean;
  prompt: string;
  toolCalls: readonly OraToolCallEnvelope[];
  currentTaskState?: Partial<CausalTaskState>;
  toolCallCount: number;
  clarificationCount: number;
  hasUnresolvedPlanItems: boolean;
  responseText: string;
  routerVersion: "v1" | "v2";
  readContextPolicyRepairUsed: boolean;
}): boolean {
  if (!params.readContextPolicyRepairUsed) return false;
  if (!params.enabled || params.routerVersion !== "v2") return false;
  if (!isDiagnosisReadContextPrompt(params.prompt)) return false;
  if (hasReadContextEvidence(params.toolCalls)) return false;
  const policyResult = routeIntervention({
    surfaceRequest: params.prompt,
    taskState: params.currentTaskState,
    proposedToolId: undefined,
    proposedToolRisk: "low",
    toolCallCount: params.toolCallCount,
    clarificationCount: params.clarificationCount,
    hasPendingApprovals: false,
    hasPendingPlanDecisions: false,
    hasUnresolvedPlanItems: params.hasUnresolvedPlanItems,
    modelResponseText: params.responseText,
    routerVersion: params.routerVersion,
  });
  return policyResult.action === "read_context";
}

function isDiagnosisReadContextPrompt(prompt: string): boolean {
  return /连接池|数据库|报错|错误|异常|故障|排查|诊断|日志|堆栈|连接泄漏|连接耗尽/u.test(prompt);
}

function isManifestLikePath(path: string): boolean {
  const normalized = path.trim().toLowerCase();
  return normalized.endsWith("package.json")
    || normalized.endsWith("package-lock.json")
    || normalized.endsWith("pnpm-lock.yaml")
    || normalized.endsWith("yarn.lock")
    || normalized.endsWith("bun.lock")
    || normalized.endsWith("bun.lockb")
    || normalized.endsWith("deno.json")
    || normalized.endsWith("deno.jsonc")
    || normalized.endsWith("tsconfig.json");
}

function grepProducedMatches(call: OraToolCallEnvelope): boolean {
  if (call.toolId !== "file.grep") return false;
  const output = call.result?.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return false;
  const matches = (output as { matches?: unknown }).matches;
  return Array.isArray(matches) && matches.length > 0;
}

function hasManifestReadEvidence(toolCalls: readonly OraToolCallEnvelope[]): boolean {
  return toolCalls.some((call) => {
    if (!(call.status === "succeeded" || call.status === "repaired")) {
      return false;
    }
    if (call.toolId !== "file.read") return false;
    const path = typeof call.args?.path === "string" ? call.args.path : "";
    return path.length > 0 && isManifestLikePath(path);
  });
}

function readProducedDiagnosisSignal(call: OraToolCallEnvelope): boolean {
  if (call.toolId !== "file.read") return false;
  const output = call.result?.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return false;
  const content = typeof (output as { content?: unknown }).content === "string"
    ? (output as { content: string }).content
    : "";
  const path = typeof call.args?.path === "string" ? call.args.path : "";
  const haystack = `${path}\n${content}`;
  return /\b(prisma|sequelize|typeorm|drizzle|knex|better-sqlite3|sqlite3|node:sqlite|DATABASE_URL|createPool|pg\.Pool|mysql2|postgres|mysql|sqlite|pool_size|max_connections|connection_limit|HikariCP|Druid|DataSource|SQLITE_BUSY|SQLITE_LOCKED)\b/i.test(haystack);
}

export function hasStrongReadContextDiagnosisEvidence(toolCalls: readonly OraToolCallEnvelope[]): boolean {
  return toolCalls.some((call) => {
    if (!(call.status === "succeeded" || call.status === "repaired")) {
      return false;
    }
    if (!isReadContextTool(call.toolId)) {
      return false;
    }
    if (call.toolId === "file.read") {
      const path = typeof call.args?.path === "string" ? call.args.path : "";
      return path.length > 0 && !isManifestLikePath(path) && readProducedDiagnosisSignal(call);
    }
    if (call.toolId === "file.grep") {
      return grepProducedMatches(call);
    }
    return false;
  });
}

export function hasManifestOnlyReadContextDiagnosisEvidence(toolCalls: readonly OraToolCallEnvelope[]): boolean {
  if (!hasReadContextEvidence(toolCalls)) return false;
  if (hasStrongReadContextDiagnosisEvidence(toolCalls)) return false;
  return hasManifestReadEvidence(toolCalls);
}

export function shouldRepairWeakReadContextDiagnosisCompletion(params: {
  enabled: boolean;
  prompt: string;
  toolCalls: readonly OraToolCallEnvelope[];
  currentTaskState?: Partial<CausalTaskState>;
  toolCallCount: number;
  clarificationCount: number;
  hasUnresolvedPlanItems: boolean;
  responseText: string;
  routerVersion: "v1" | "v2";
}): boolean {
  if (!params.enabled || params.routerVersion !== "v2") return false;
  if (!isDiagnosisReadContextPrompt(params.prompt)) return false;
  if (!hasReadContextEvidence(params.toolCalls)) return false;
  if (hasStrongReadContextDiagnosisEvidence(params.toolCalls)) return false;
  const policyResult = routeIntervention({
    surfaceRequest: params.prompt,
    taskState: params.currentTaskState,
    proposedToolId: undefined,
    proposedToolRisk: "low",
    toolCallCount: params.toolCallCount,
    clarificationCount: params.clarificationCount,
    hasPendingApprovals: false,
    hasPendingPlanDecisions: false,
    hasUnresolvedPlanItems: params.hasUnresolvedPlanItems,
    modelResponseText: params.responseText,
    routerVersion: params.routerVersion,
  });
  return policyResult.action === "read_context";
}

export function shouldRepairManifestOnlyDiagnosisCompletion(params: {
  enabled: boolean;
  prompt: string;
  toolCalls: readonly OraToolCallEnvelope[];
  currentTaskState?: Partial<CausalTaskState>;
  toolCallCount: number;
  clarificationCount: number;
  hasUnresolvedPlanItems: boolean;
  responseText: string;
  routerVersion: "v1" | "v2";
  weakDiagnosisRepairUsed: boolean;
}): boolean {
  if (!params.weakDiagnosisRepairUsed) return false;
  if (!params.enabled || params.routerVersion !== "v2") return false;
  if (!isDiagnosisReadContextPrompt(params.prompt)) return false;
  if (!hasManifestOnlyReadContextDiagnosisEvidence(params.toolCalls)) return false;
  const policyResult = routeIntervention({
    surfaceRequest: params.prompt,
    taskState: params.currentTaskState,
    proposedToolId: undefined,
    proposedToolRisk: "low",
    toolCallCount: params.toolCallCount,
    clarificationCount: params.clarificationCount,
    hasPendingApprovals: false,
    hasPendingPlanDecisions: false,
    hasUnresolvedPlanItems: params.hasUnresolvedPlanItems,
    modelResponseText: params.responseText,
    routerVersion: params.routerVersion,
  });
  return policyResult.action === "read_context";
}

export function shouldBlockToolForContextProbePolicy(params: {
  enabled: boolean;
  prompt: string;
  toolCalls: readonly OraToolCallEnvelope[];
  proposedToolId: string;
  proposedToolArgs?: Record<string, unknown>;
  recommendedAction: string;
  routerVersion: "v1" | "v2";
  modeId?: string;
  sourceModeId?: string;
}): boolean {
  if (!params.enabled || params.routerVersion !== "v2") return false;
  if (params.recommendedAction !== "read_context") return false;
  if (shouldBlockRepoExploreUpgradeForSingleAgent(params)) return true;
  if (shouldBlockWideTaskArchiveReadForReporting(params)) return true;
  if (isReadContextTool(params.proposedToolId)) return false;
  if (hasReadContextEvidence(params.toolCalls)) return false;
  return true;
}

function isReportingReadContextPrompt(prompt: string): boolean {
  return /\b(summary|report|weekly update|status update|changelog)\b|周报|汇报|总结|项目报告/u.test(prompt);
}

function hasHighSignalReportingEvidence(toolCalls: readonly OraToolCallEnvelope[]): boolean {
  return toolCalls.some((call) => {
    if (!isReadContextTool(call.toolId)) return false;
    if (!(call.status === "proposed" || call.status === "running" || call.status === "succeeded" || call.status === "repaired")) {
      return false;
    }
    const path = typeof call.args?.path === "string" ? call.args.path : "";
    const pattern = typeof call.args?.pattern === "string" ? call.args.pattern : "";
    const haystack = `${path}\n${pattern}`.toLowerCase();
    return haystack.includes("docs/")
      || haystack.includes("changelog")
      || haystack.includes("release")
      || haystack.includes("latest.json");
  });
}

function isTaskJournalPath(path: string): boolean {
  return /^tasks\/TASK-[^/]+\.md$/i.test(path);
}

function countTaskJournalReads(toolCalls: readonly OraToolCallEnvelope[]): number {
  return toolCalls.filter((call) => {
    if (call.toolId !== "file.read") return false;
    if (!(call.status === "proposed" || call.status === "running" || call.status === "succeeded" || call.status === "repaired")) {
      return false;
    }
    const path = typeof call.args?.path === "string" ? call.args.path : "";
    return isTaskJournalPath(path);
  }).length;
}

function isWideTaskArchiveEntryPoint(toolId: string, args?: Record<string, unknown>): boolean {
  const path = typeof args?.path === "string" ? args.path : "";
  const pattern = typeof args?.pattern === "string" ? args.pattern : "";
  if (toolId === "file.list") {
    return path === "tasks" || path === "tasks/";
  }
  if (toolId === "file.glob") {
    return pattern.toLowerCase().startsWith("tasks/") && pattern.includes("*");
  }
  return false;
}

function isBroadReportingWorkspaceEntryPoint(toolId: string, args?: Record<string, unknown>): boolean {
  if (toolId !== "file.list") {
    return false;
  }
  const path = typeof args?.path === "string" ? args.path.trim() : ".";
  return path === "" || path === "." || path === "./";
}

function isTaskJournalReadAttempt(toolId: string, args?: Record<string, unknown>): boolean {
  if (toolId !== "file.read") return false;
  const path = typeof args?.path === "string" ? args.path : "";
  return isTaskJournalPath(path);
}

function shouldBlockWideTaskArchiveReadForReporting(params: {
  prompt: string;
  toolCalls: readonly OraToolCallEnvelope[];
  proposedToolId: string;
  proposedToolArgs?: Record<string, unknown>;
  recommendedAction: string;
}): boolean {
  if (params.recommendedAction !== "read_context") return false;
  if (!isReportingReadContextPrompt(params.prompt)) return false;
  if (isBroadReportingWorkspaceEntryPoint(params.proposedToolId, params.proposedToolArgs)) {
    return true;
  }
  if (isWideTaskArchiveEntryPoint(params.proposedToolId, params.proposedToolArgs)) {
    return true;
  }
  if (!isTaskJournalReadAttempt(params.proposedToolId, params.proposedToolArgs)) {
    return false;
  }
  if (!hasHighSignalReportingEvidence(params.toolCalls)) {
    return true;
  }
  return countTaskJournalReads(params.toolCalls) >= 2;
}

function shouldBlockRepoExploreUpgradeForSingleAgent(params: {
  proposedToolId: string;
  recommendedAction: string;
  modeId?: string;
  sourceModeId?: string;
}): boolean {
  if (params.recommendedAction !== "read_context") return false;
  if (params.proposedToolId !== "repo.explore") return false;
  return params.modeId === SINGLE_AGENT_MODE_ID || params.sourceModeId === SINGLE_AGENT_MODE_ID;
}

function hasCausalFollowUpThisTurn(
  messages: readonly { role: string; content: string }[],
  toolName: string,
): boolean {
  return messages.some(
    (m) =>
      m.role === "user" &&
      m.content.includes("[Causal Policy]") &&
      m.content.includes(toolName),
  );
}

export function shouldContinueAfterCausalBlock(action: ReturnType<typeof routeIntervention>["action"]): boolean {
  return action === "search_web" || action === "read_context";
}

export function toolMatchesCausalRecommendation(
  action: ReturnType<typeof routeIntervention>["action"],
  toolId: string | undefined,
): boolean {
  if (!toolId) return false;
  if (action === "read_context") return isReadContextTool(toolId);
  if (action === "search_web") return isSearchTool(toolId);
  return action === "use_tool";
}

function hasSucceededSearchEvidence(toolCalls: readonly OraToolCallEnvelope[]): boolean {
  return toolCalls.some((call) =>
    isSearchTool(call.toolId) && (call.status === "succeeded" || call.status === "repaired")
  );
}

export function hasReadContextEvidence(toolCalls: readonly OraToolCallEnvelope[]): boolean {
  return toolCalls.some((call) =>
    isReadContextTool(call.toolId) &&
    (call.status === "proposed" || call.status === "running" || call.status === "succeeded" || call.status === "repaired")
  );
}

function buildContextProbePolicyFollowUp(params: {
  proposedToolId: string;
  modeId?: string;
  sourceModeId?: string;
}): string {
  const singleAgentMode = params.modeId === SINGLE_AGENT_MODE_ID || params.sourceModeId === SINGLE_AGENT_MODE_ID;
  if (singleAgentMode && params.proposedToolId === "repo.explore") {
    return "[Context Probe Policy] The request already points to a concrete artifact or repository context. In single-agent mode, inspect that context with file.read/file.grep/file.glob/file.list before escalating to repo.explore, using other tools, or answering.";
  }
  return "[Context Probe Policy] The request already points to a concrete artifact or repository context. Read that context first before using other tools or answering.";
}

export function buildReadContextPolicyFollowUp(prompt: string): string {
  const guidance = [
    "[Read Context Policy] This request likely depends on repository or local context. Before finalizing, inspect the relevant local evidence with a read-context tool such as file.read, file.list, file.grep, or file.glob.",
    "Treat dependency names, package entries, or config strings as partial clues only, not proof of the active runtime path or root cause.",
    "Package manifests alone are weak evidence: do not diagnose the active failing component from package.json-style declarations without corroborating code paths, runtime config, logs, or a narrow clarification.",
  ];
  if (/\b(summary|report|weekly update|status update|changelog)\b|周报|汇报|总结|项目报告/u.test(prompt)) {
    guidance.push(
      "For summaries, reports, changelogs, weekly updates, or status updates, start with the highest-signal artifacts first such as docs/, CHANGELOG, release notes, dated notes, or commit summaries. Only if those are insufficient should you add a few recent dated task journals.",
      "If you need task journals, target at most 1-2 recent artifacts that match the likely time window or topic instead of sweeping the whole tasks/ archive.",
    );
  }
  guidance.push(
    "If the evidence still does not identify the user's real target system, report the repo-grounded finding and ask a narrow clarification instead of generalizing.",
  );
  return guidance.join(" ");
}

export function buildWeakReadContextDiagnosisFollowUp(): string {
  return "[Read Context Policy] The local evidence here is still weak: dependency declarations, package manifests, and empty grep results are not enough to prove the active failing runtime or to rule out the user's real connection-pool problem. Revise the answer so it stays evidence-bound to this repo, avoid claims that the user's environment definitely is or is not using a pool, and ask for one narrow next artifact such as the exact error log, stack trace, runtime config, or deployment database target.";
}

export function buildManifestOnlyDiagnosisFollowUp(): string {
  return "[Read Context Policy] Your current diagnosis still leans on package-manifest dependency names without corroborating code-path or runtime evidence. Do not mention dependencies like better-sqlite3, ioredis, Prisma, or similar package names as if they prove the active runtime path. Limit the answer to the concrete checks you actually ran (for example, empty grep results in inspected code/config paths), say that this repo evidence is insufficient to identify the failing system, and ask for one concrete artifact such as the exact error log, stack trace, runtime config, or deployment target.";
}

export function buildReadContextNoEvidenceFinalFollowUp(): string {
  return "[Read Context Policy] You still have not inspected any local repository evidence for this diagnosis. Do not invent or assume repository-specific databases, ORMs, vendors, connection-pool sizes, file paths, or config values. Revise the answer to say that no matching local evidence has been inspected yet, keep the conclusion evidence-bound, and ask for one concrete next artifact such as the exact error log, stack trace, runtime config, deployment database target, or the file/config path to inspect next.";
}

export function buildReportingReadContextSurfaceFollowUp(): string {
  return "[Read Context Policy] For summary/report/week-update requests, first inspect high-signal project artifacts such as docs/, CHANGELOG, release notes, or release metadata. Use workspace-relative file paths, not absolute paths. For discovery, prefer targeted file.glob/file.grep calls over broad file.list on the workspace root (for example, file.glob with patterns like CHANGELOG*, docs/**/*.md, or *release*.json). Prioritize concrete release metadata files when they already exist in the root, such as release.json or latest.json, before broad docs summaries. Only use file.read on a concrete file path such as release.json, latest.json, or docs/weekly-update.md, and do not attach pattern to file.read. Do not start with broad tasks/ archive sweeps; only read 1-2 recent task journals after those higher-signal sources prove insufficient.";
}

const NODE_RUNTIME_HARD_TIMEOUT_MULTIPLIER = 6;

class NodeRuntimeTimeoutError extends Error {
  constructor(
    public readonly kind: "idle" | "hard",
    public readonly timeoutMs: number,
    public readonly state?: NodeRuntimeLoopState,
  ) {
    super(
      kind === "idle"
        ? `Node idle timeout after ${timeoutMs}ms without progress.`
        : `Node hard timeout after ${timeoutMs}ms.`,
    );
    this.name = "NodeRuntimeTimeoutError";
  }
}

function shouldTrackRuntimeActivity(
  type: OraEventEnvelope["type"],
  payload: unknown,
): boolean {
  switch (type) {
    case "message.delta":
    case "token.delta":
    case "tool.called":
    case "action.updated":
    case "task.started":
    case "task.progress":
    case "task.completed":
    case "task.failed":
    case "artifact.exported":
    case "artifact.degraded":
      return true;
    case "node.updated": {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return false;
      }
      const state = (payload as { state?: unknown }).state;
      return typeof state === "string" && state !== "cache_diagnostics";
    }
    default:
      return false;
  }
}

function shouldTrackProviderStreamActivity(
  event: Pick<ModelStreamEvent, "kind">,
): boolean {
  return event.kind === "sse_frame" || event.kind === "fallback_response" || event.kind === "local_stream_started";
}

function mergeAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) {
    return undefined;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener("abort", () => abort(signal), { once: true });
  }
  return controller.signal;
}

export interface RunNodeRuntimeLoopParams {
  runId: string;
  agentId: string;
  nodeId: string;
  title: string;
  prompt: string;
  system: string;
  providerCache?: ModelRequest["providerCache"];
  cacheDiagnosticsContext?: ModelRequest["cacheDiagnosticsContext"];
  responseFormat?: ModelRequest["responseFormat"];
  toolIds: string[];
  /** Optional per-node timeout in milliseconds. Interpreted as an idle timeout:
   *  the node is allowed to run longer than this as long as it continues to
   *  produce meaningful progress. A longer hard-timeout fallback is derived
   *  internally to prevent infinite hangs. */
  timeoutMs?: number;
  onForcedFinalProviderExhausted?: (error: unknown) => ModelResponse | undefined;
}

export interface PendingAsyncAgentResult {
  sourceAgentId: string;
  childSessionId: string;
  result: string;
  completedAt: number;
  toolBundleId?: string;
  resolvedToolIds?: string[];
  resultContract?: string;
  usedToolCount?: number;
  artifactIds?: string[];
  durationMs?: number;
}

export interface PendingExternalInputs {
  messages: string[];
  asyncResults: PendingAsyncAgentResult[];
}

export interface RunNodeRuntimeLoopDeps {
  config: RunConfig;
  modeSpec: ModeSpec;
  conversationMessages?: ModelMessage[];
  streamProvider?: boolean;
  signal?: AbortSignal;
  inputPrompt: string;
  turnIndex?: number;
  now: () => number;
  events: () => readonly OraEventEnvelope[];
  eventsLength: () => number;
  planList: () => readonly PlanListStep[];
  activePlanStepId: () => string | undefined;
  autoAdvancePlanListFromLifecycle: (params: {
    agentId: string;
    nodeId: string;
    title: string;
    evidenceToolCallIds: string[];
    planStepId?: string;
  }) => boolean;
  toolCalls: () => readonly OraToolCallEnvelope[];
  runtimeToolExecutor: RuntimeToolExecutor;
  completion: RuntimeCompletionController;
  runtimeToolResultCache: Map<string, unknown>;
  recoveryCoordinator: RecoveryCoordinator;
  appendToolCall: (params: AppendRuntimeToolCallParams) => OraToolCallEnvelope;
  emit: RuntimeLoopEmit;
  emitNodeRuntimeState: (
    state: NodeRuntimeLoopState,
    params: {
      agentId: string;
      title?: string;
      actionId?: string;
      reason?: string;
      detail?: string;
      toolId?: string;
      iteration?: number;
    },
  ) => void;
  emitRecoveryDecision: (
    incident: RecoveryIncident,
    decision: RecoveryDecision,
  ) => void;
  emitRejectedFinalToolIntent: (
    call: RuntimeToolCall,
    reason: CompletionStopReason,
  ) => void;
  extractCausalTaskState?: (params: ExtractCausalTaskStateParams) => Promise<Partial<CausalTaskState>>;
  /** Count of clarification.required events emitted so far in this run. */
  clarificationCount: () => number;
  clarificationAnswer: (key: string, id: string) => unknown;
  drainPendingExternalInputs?: (agentId: string) => PendingExternalInputs;
  activeBackgroundChildCount?: (agentId: string) => number;
  pendingAsyncResultCount?: (agentId: string) => number;
  stalledBackgroundChildren?: (agentId: string) => readonly ChildSessionSummary[];
  waitForBackgroundProgress?: (agentId: string) => Promise<void>;
  ensureClarification: (params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options?: PendingClarificationOption[];
    missingVariables?: string[];
    counterfactualRiskIfSkipped?: string;
  }) => Promise<unknown>;
  ensureClarifications: (requests: Array<{
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options?: PendingClarificationOption[];
  }>) => Promise<unknown[]>;
  coerceNoToolResponse: (
    response: ModelResponse,
    reason: CompletionStopReason,
    options?: { emitRejectedToolIntent?: boolean },
  ) => ModelResponse;
  runForcedFinalProviderCall: (params: {
    invokeProvider: typeof invokeRunProvider | typeof invokeRunProviderStream;
    config: RunConfig;
    messages: ModelMessage[];
    system: string;
    providerCache?: ModelRequest["providerCache"];
    cacheDiagnosticsContext?: ModelRequest["cacheDiagnosticsContext"];
    nativeTools: ReturnType<RuntimeToolExecutor["toolDefinitions"]>;
    streamCallbacks?: Parameters<typeof invokeRunProviderStream>[2];
    reason: CompletionStopReason;
    agentId?: string;
    nodeId?: string;
    title?: string;
    emitNodeRuntimeState?: RunNodeRuntimeLoopDeps["emitNodeRuntimeState"];
    onProviderExhausted?: (error: unknown) => ModelResponse | undefined;
  }) => Promise<ModelResponse>;
  publishRecoveryArtifact: (
    incident: RecoveryIncident,
    decision: RecoveryDecision,
  ) => { id: string };
  publishFileChangeArtifact: (
    fileChange: RuntimeFileChangeMetadata,
    context: { agentId?: string; nodeId?: string; actionId?: string },
  ) => ArtifactRef;
  sleep: (ms: number) => Promise<void>;
  actionDeps: () => RuntimeActionDeps;
}

export function isInternalProviderAssistantText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (isSharedInternalRecoveryFallbackText(trimmed)) {
    return true;
  }
  if (isSharedInternalAssistantText(trimmed)) {
    return true;
  }
  if (/<tool_c/i.test(trimmed)) {
    return true;
  }
  if (/\{"tool"\s*:\s*"/i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Strips tool-call markers, DSML tags, and other internal protocol text from
 * assistant output before it reaches user-visible surfaces.  Used in
 * non-streaming / fallback paths where the full response is emitted at once.
 */
export function stripInternalAssistantText(text: string): string {
  return stripInternalAssistantProtocolText(text);
}

function containsCompleteProposedPlanText(text: string): boolean {
  return /<proposed_plan>\s*[\s\S]+?\s*<\/proposed_plan>/.test(text);
}

function shouldPreferCompleteProposedPlanResponse(
  config: RunConfig,
  response: Pick<ModelResponse, "text">,
): boolean {
  if (config.metadata.taskIntent !== "plan") {
    return false;
  }
  const text = response.text.trim();
  if (!text || isInternalProviderAssistantText(text)) {
    return false;
  }
  return containsCompleteProposedPlanText(text);
}

export async function maybeInterruptBlockedPlanStep(params: {
  guardResultReason: string;
  prompt: string;
  currentResponseText: string;
  planList: readonly PlanListStep[];
  config: RunConfig;
  agentId: string;
  nodeId: string;
  title: string;
  ensureClarification: RunNodeRuntimeLoopDeps["ensureClarification"];
  requestPlanStepBlocker?: typeof requestPlanStepBlockerClarification;
}): Promise<void> {
  if (params.guardResultReason !== "plan_list_incomplete") {
    return;
  }
  const activeStep = params.planList.find((item) => item.status === "in_progress");
  const classifyBlocker = params.requestPlanStepBlocker ?? requestPlanStepBlockerClarification;
  const blockerClarification = await classifyBlocker({
    prompt: params.prompt,
    responseText: params.currentResponseText,
    activeStep,
    planList: params.planList,
    config: params.config,
  });
  if (!blockerClarification || !activeStep) {
    return;
  }
  const clarificationSlug = planStepBlockerFingerprint({
    activeStep,
    clarification: blockerClarification,
  }) || "plan_step_blocker";
  await params.ensureClarification({
    id: `clarification:${params.agentId}:plan-step:${clarificationSlug}`,
    key: `plan_step_blocker_${clarificationSlug}`,
    nodeId: params.nodeId,
    nodeLabel: params.title,
    question: blockerClarification.question,
    missingVariables: blockerClarification.missingVariables,
    counterfactualRiskIfSkipped: blockerClarification.counterfactualRiskIfSkipped,
  });
}

function cacheDiagnosticDelta(
  previous: ReturnType<typeof buildModelRequestCacheDiagnostics> | undefined,
  current: ReturnType<typeof buildModelRequestCacheDiagnostics>,
): { changed: string[]; stablePrefixUnchanged: boolean } {
  if (!previous) {
    return {
      changed: ["initial_request"],
      stablePrefixUnchanged: true,
    };
  }
  const changed: string[] = [];
  if (previous.stableSystemPrefixHash !== current.stableSystemPrefixHash) {
    changed.push("stable_system_prefix");
  }
  if (previous.volatileSystemSuffixHash !== current.volatileSystemSuffixHash) {
    changed.push("volatile_system_suffix");
  }
  const derivedBlockIds = new Set([
    ...Object.keys(previous.derivedContextBlockHashes),
    ...Object.keys(current.derivedContextBlockHashes),
  ]);
  for (const blockId of [...derivedBlockIds].sort()) {
    if (previous.derivedContextBlockHashes[blockId] !== current.derivedContextBlockHashes[blockId]) {
      changed.push(`derived_context_block:${blockId}`);
    }
  }
  if (previous.toolsHash !== current.toolsHash) {
    changed.push("tools");
  }
  if (previous.latestTurnMetadataHash !== current.latestTurnMetadataHash) {
    changed.push("turn_local_metadata");
  }
  if (previous.fullSystemHash !== current.fullSystemHash && !changed.includes("volatile_system_suffix") && !changed.includes("stable_system_prefix")) {
    changed.push("system_other");
  }
  return {
    changed,
    stablePrefixUnchanged: previous.stableSystemPrefixHash === current.stableSystemPrefixHash,
  };
}

function emitRuntimeStatusProgress(
  emit: RuntimeLoopEmit,
  params: RunNodeRuntimeLoopParams,
  trigger: string,
  summary: string,
  basedOnSeq: number,
  lastPublicCommentaryFingerprintRef?: { current?: string },
): void {
  emit(
    "task.progress",
    {
      kind: "chat_progress",
      source: "runtime_status",
      trigger,
      title: params.title,
      summary,
      basedOnSeq,
      ...(isInternalRuntimeStatusTrigger(trigger) ? { audience: "internal" } : {}),
    },
    { agentId: params.agentId, nodeId: params.nodeId },
  );
  if (isInternalRuntimeStatusTrigger(trigger)) {
    return;
  }
  const commentary = buildCommentaryDelta({
    runId: params.runId,
    agentId: params.agentId,
    nodeId: params.nodeId,
    trigger,
    summary,
    basedOnSeq,
  });
  if (!commentary) {
    return;
  }
  if (lastPublicCommentaryFingerprintRef?.current === commentary.fingerprint) {
    return;
  }
  if (lastPublicCommentaryFingerprintRef) {
    lastPublicCommentaryFingerprintRef.current = commentary.fingerprint;
  }
  emit("message.delta", commentary.payload, commentary.extra);
}

function isInternalRuntimeStatusTrigger(trigger: string): boolean {
  return trigger === "plan_list.incomplete" || trigger === "runtime_work.pending";
}

/**
 * Build a normalized fingerprint from a guard rejection result so the
 * cycle counter detects no-progress loops even when the model rephrases
 * the same logical error or generates new action/plan IDs.
 */
function buildGuardFingerprint(guardResult: { reason: string; detail: string }): string {
  let normalized = guardResult.detail
    // Strip parenthesized IDs: (action-abc), (plan-xyz), (todo-123)
    .replace(/\s*\([^)]+\)/g, "")
    // Normalize numbered list prefixes: "plan 1." → "plan", "todo 2." → "todo"
    .replace(/\b(plan|todo|action|tool call)\s+\d+\./gi, "$1")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return `${guardResult.reason}:${normalized}`;
}

export async function runNodeRuntimeLoop(
  params: RunNodeRuntimeLoopParams,
  deps: RunNodeRuntimeLoopDeps,
): Promise<ModelResponse> {
  const extractCausalTaskState = deps.extractCausalTaskState ?? defaultExtractCausalTaskState;
  const routerVersion = deps.config.metadata.causalRouterVersion === "v1" ? "v1" : "v2";
  const freshnessBlockPolicyEnabled = deps.config.metadata.causalFreshnessBlockPolicy === true;
  const contextProbePolicyEnabled = deps.config.metadata.causalContextProbePolicy === true;
  const {
    config,
    modeSpec,
    runtimeToolExecutor,
    completion,
    runtimeToolResultCache,
    recoveryCoordinator,
    appendToolCall,
    now,
    emit: rawEmit,
    emitNodeRuntimeState: rawEmitNodeRuntimeStateEvent,
    emitRecoveryDecision,
    emitRejectedFinalToolIntent,
    clarificationAnswer,
    ensureClarification,
    ensureClarifications,
    coerceNoToolResponse,
    runForcedFinalProviderCall,
    publishRecoveryArtifact,
    publishFileChangeArtifact,
    sleep,
    actionDeps,
  } = deps;
  const options = {
    conversationMessages: deps.conversationMessages,
    streamProvider: deps.streamProvider,
  };
  let activeOperationAbortController: AbortController | undefined;
  let recordWatchdogActivity = (_source: string): void => undefined;
  let disposeNodeWatchdog = (): void => undefined;
  const emitNodeRuntimeState: RunNodeRuntimeLoopDeps["emitNodeRuntimeState"] = (state, emitParams) => {
    rawEmitNodeRuntimeStateEvent(state, emitParams);
    recordWatchdogActivity(`state:${state}`);
    if (state === "completed" || state === "failed" || state === "interrupted") {
      disposeNodeWatchdog();
    }
  };
  const emit: RuntimeLoopEmit = (type, payload, extra) => {
    const envelope = rawEmit(type, payload, extra);
    if (shouldTrackRuntimeActivity(type, payload)) {
      recordWatchdogActivity(`event:${type}`);
    }
    return envelope;
  };
  const input = { prompt: deps.inputPrompt };
  const lastPublicCommentaryFingerprintRef: { current?: string } = {};
  const events = {
    get length(): number {
      return deps.eventsLength();
    },
  };
  const { actionLedger } = actionDeps();
  const nodeLoopController = new NodeLoopController({
    emit: emitNodeRuntimeState,
    onInvalidTransition: "throw",
    onInvalidTransitionRecorded: (transition, transitionParams) => {
      emit(
        "task.progress",
        {
          kind: "runtime_diagnostic",
          source: "node_loop_transition",
          severity: "warning",
          from: transition.from,
          to: transition.to,
          title: transitionParams.title ?? params.title,
          actionId: transitionParams.actionId,
          toolId: transitionParams.toolId,
          iteration: transitionParams.iteration,
        },
        { agentId: params.agentId, nodeId: params.nodeId },
      );
    },
  });
  let nodeTimeoutError: NodeRuntimeTimeoutError | undefined;
  const idleTimeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
      ? params.timeoutMs
      : undefined;
  const hardTimeoutMs = idleTimeoutMs ? idleTimeoutMs * NODE_RUNTIME_HARD_TIMEOUT_MULTIPLIER : undefined;
  if (idleTimeoutMs && hardTimeoutMs) {
    let idleTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let hardTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const triggerTimeout = (kind: "idle" | "hard", timeoutMs: number) => {
      if (disposed || nodeTimeoutError) {
        return;
      }
      nodeTimeoutError = new NodeRuntimeTimeoutError(kind, timeoutMs, nodeLoopController.state);
      activeOperationAbortController?.abort(nodeTimeoutError);
      const currentState = nodeLoopController.state;
      if (currentState === "running_model" || currentState === "tool_running" || currentState === "failed") {
        nodeLoopController.emitRecoveryState("degraded", {
          agentId: params.agentId,
          title: params.title,
          reason: kind === "idle" ? "node_idle_timeout" : "node_hard_timeout",
          detail: nodeTimeoutError.message,
        });
      }
    };
    const armIdleTimeout = () => {
      if (disposed || nodeTimeoutError) {
        return;
      }
      if (idleTimeoutHandle) {
        clearTimeout(idleTimeoutHandle);
      }
      idleTimeoutHandle = setTimeout(() => {
        triggerTimeout("idle", idleTimeoutMs);
      }, idleTimeoutMs);
    };
    recordWatchdogActivity = () => {
      if (disposed || nodeTimeoutError) {
        return;
      }
      armIdleTimeout();
    };
    disposeNodeWatchdog = () => {
      disposed = true;
      if (idleTimeoutHandle) {
        clearTimeout(idleTimeoutHandle);
        idleTimeoutHandle = undefined;
      }
      if (hardTimeoutHandle) {
        clearTimeout(hardTimeoutHandle);
        hardTimeoutHandle = undefined;
      }
    };
    hardTimeoutHandle = setTimeout(() => {
      triggerTimeout("hard", hardTimeoutMs);
    }, hardTimeoutMs);
    armIdleTimeout();
  }

  const emitNodeRuntimeStateDirect = nodeLoopController.emit;
  const completionScope = { agentId: params.agentId, nodeId: params.nodeId };
  const enabledTools = runtimeToolExecutor.enabledToolIds(params.toolIds);
  const nativeTools = providerSupportsNativeTools(config)
    ? runtimeToolExecutor.toolDefinitions(params.toolIds)
    : [];
  let messages: ModelMessage[] = [...(options.conversationMessages ?? [])];
  const invokeProvider = options.streamProvider
    ? invokeRunProviderStream
    : invokeRunProvider;
  let lastProviderRequestMessages: ModelMessage[] = [];
  let lastRequestCacheDiagnostics: ReturnType<typeof buildModelRequestCacheDiagnostics> | undefined;
  let modelInvocationIndex = 0;
  let activeAssistantMessageId = `${params.runId}:assistant:${params.agentId}:${params.nodeId}:0`;
  let emittedProviderStreamFrameForInvocation = false;
  const nextAssistantMessageId = () => {
    activeAssistantMessageId = `${params.runId}:assistant:${params.agentId}:${params.nodeId}:${modelInvocationIndex}`;
    modelInvocationIndex += 1;
    emittedProviderStreamFrameForInvocation = false;
    return activeAssistantMessageId;
  };
  const streamCallbacks = options.streamProvider
    ? {
        onTextDelta: (chunk: {
          delta: string;
          text: string;
          raw?: unknown;
        }) => {
          recordWatchdogActivity("stream:text_delta");
          const visibility = isInternalProviderAssistantText(chunk.text)
            ? "internal"
            : undefined;
          emit(
            "message.delta",
            {
              role: "assistant",
              messageId: activeAssistantMessageId,
              content: chunk.delta,
              delta: chunk.delta,
              streaming: true,
              phase: "stream",
              ...(visibility ? { visibility } : {}),
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
        },
        onStreamEvent: (event: ModelStreamEvent) => {
          if (shouldTrackProviderStreamActivity(event)) {
            recordWatchdogActivity(`stream:${event.kind}`);
          }
          if (!shouldEmitProviderStreamEvent(event, emittedProviderStreamFrameForInvocation)) {
            return;
          }
          if (event.kind === "sse_frame") {
            emittedProviderStreamFrameForInvocation = true;
          }
          emit(
            "node.updated",
            {
              state: event.kind,
              title: params.title,
              streamMode: event.streamMode,
              providerStream: true,
              raw: event.raw,
            },
            { agentId: params.agentId, nodeId: params.agentId },
          );
        },
      }
    : undefined;
  const runtimeMiddlewares = buildRuntimeMiddlewares();
  const middlewareContext: RuntimeMiddlewareContext = {
    config,
    agentId: params.agentId,
    nodeId: params.agentId,
    modelNodeId: params.nodeId,
    title: params.title,
    now,
    appendToolCall,
    emit,
    replaceMessages: (nextMessages) => {
      messages = [...nextMessages];
    },
  };
  const withAbortSignal = (request: ModelRequest): ModelRequest => {
    activeOperationAbortController = new AbortController();
    const effectiveSignal = mergeAbortSignals(request.signal, deps.signal, activeOperationAbortController.signal);
    return {
      ...request,
      signal: effectiveSignal,
    };
  };

  const MAX_PROVIDER_RETRIES = 10;

  const invokeProviderWithRecovery = async (
    request: ModelRequest,
    options: { emitRetryModelState: boolean },
  ): Promise<ModelResponse> => {
    const attemptScope = nextAssistantMessageId();
    let retryCount = 0;
    while (true) {
      try {
        const cacheDiagnostics = buildModelRequestCacheDiagnostics(request);
        const cacheDelta = cacheDiagnosticDelta(lastRequestCacheDiagnostics, cacheDiagnostics);
        emit(
          "node.updated",
          {
            state: "cache_diagnostics",
            title: params.title,
            providerCache: request.providerCache,
            cacheDiagnostics: {
              ...cacheDiagnostics,
              changedSincePreviousRequest: cacheDelta.changed,
              stablePrefixUnchanged: cacheDelta.stablePrefixUnchanged,
            },
          },
          { agentId: params.agentId, nodeId: params.agentId },
        );
        const response = await invokeProvider(config, request, streamCallbacks);
        lastProviderRequestMessages = [...(request.messages ?? [])];
        lastRequestCacheDiagnostics = cacheDiagnostics;
        return response;
      } catch (error) {
        if (nodeTimeoutError) {
          const incident = classifyRecoveryError(nodeTimeoutError, {
            surface: "node",
            nodeId: params.nodeId,
            agentId: params.agentId,
            currentState: nodeTimeoutError.state,
          });
          const recoveryDecision = recoveryCoordinator.resolve(incident);
          emitRecoveryDecision(incident, recoveryDecision);
          throw new RecoveryExhaustedError(incident, recoveryDecision);
        }
        retryCount += 1;
        const detail = error instanceof Error ? error.message : String(error);
        const incident = classifyRecoveryError(error, {
          surface: "provider",
          attemptScope,
          nodeId: params.agentId,
          agentId: params.agentId,
        });
        const recoveryDecision = recoveryCoordinator.resolve(incident);
        if (recoveryDecision.action !== "retry" || retryCount > MAX_PROVIDER_RETRIES) {
          if (recoveryDecision.action !== "fail" && retryCount <= MAX_PROVIDER_RETRIES) {
            throw error;
          }
          emitRecoveryDecision(incident, recoveryDecision);
          throw new RecoveryExhaustedError(incident, recoveryDecision);
        }
        emitRecoveryDecision(incident, recoveryDecision);
        await sleep(recoveryDecision.retryDelayMs ?? 0);
        if (options.emitRetryModelState) {
          nodeLoopController.emitTransitionResult("model_request", "running_model", {
            agentId: params.agentId,
            title: params.title,
            reason: "provider_retry",
            detail,
          });
        }
      }
    }
  };

  const invokeModel = (
    request: ModelRequest,
    options: { emitRetryModelState?: boolean } = {},
  ) =>
    invokeRuntimeModelCall({
      request: withAbortSignal(withStablePrefixCacheMetadata(requestWithPendingExternalInputs(request))),
      context: middlewareContext,
      middlewares: runtimeMiddlewares,
      terminal: (nextRequest) => invokeProviderWithRecovery(nextRequest, {
        emitRetryModelState: options.emitRetryModelState ?? true,
      }),
    });
  const invokeFollowUpModel = (
    request: ModelRequest,
    latestResponse: ModelResponse,
    reason: string,
  ) =>
    invokeRuntimeModelCall({
      request: withAbortSignal(withFollowUpCacheMetadata(requestWithPendingExternalInputs(request), latestResponse, lastProviderRequestMessages)),
      context: middlewareContext,
      middlewares: runtimeMiddlewares,
      terminal: (nextRequest) => invokeProviderWithRecovery(nextRequest, {
        emitRetryModelState: true,
      }),
      metadata: {
        compaction: { latestResponse, reason },
      },
    });
  const formatExternalInputMessage = (inputs: PendingExternalInputs): string | undefined => {
    const sections: string[] = [];
    if (inputs.messages.length > 0) {
      const messageContext = inputs.messages.map((message, index) =>
        `<agent-message seq="${index + 1}">\n${message}\n</agent-message>`
      ).join("\n\n");
      sections.push([
        "<agent-messages>",
        "The following messages were sent to you:",
        "",
        messageContext,
        "</agent-messages>",
      ].join("\n"));
    }
    if (inputs.asyncResults.length > 0) {
      const resultContext = inputs.asyncResults.map((result) =>
        [
          `<async-agent-result agent="${result.sourceAgentId}" child_session="${result.childSessionId}" completed_at="${result.completedAt}"`,
          typeof result.toolBundleId === "string" ? ` tool_bundle="${result.toolBundleId}"` : "",
          typeof result.resultContract === "string" ? ` result_contract="${result.resultContract}"` : "",
          typeof result.usedToolCount === "number" ? ` used_tool_count="${result.usedToolCount}"` : "",
          typeof result.durationMs === "number" ? ` duration_ms="${result.durationMs}"` : "",
          ">",
          Array.isArray(result.resolvedToolIds) && result.resolvedToolIds.length > 0
            ? `<resolved-tools>${result.resolvedToolIds.join(", ")}</resolved-tools>\n`
            : "",
          result.result,
          "\n</async-agent-result>",
        ].join("")
      ).join("\n\n");
      sections.push([
        "<async-results>",
        "The following async sub-agent results are now available:",
        "",
        resultContext,
        "</async-results>",
      ].join("\n"));
    }
    return sections.length > 0 ? sections.join("\n\n") : undefined;
  };
  const requestWithPendingExternalInputs = (request: ModelRequest): ModelRequest => {
    const pendingInputs = deps.drainPendingExternalInputs?.(params.agentId);
    const externalInputMessage = pendingInputs
      ? formatExternalInputMessage(pendingInputs)
      : undefined;
    if (!externalInputMessage) {
      return request;
    }
    if (typeof request.prompt === "string" && request.prompt.trim().length > 0) {
      return {
        ...request,
        prompt: `${request.prompt}\n\n${externalInputMessage}`,
      };
    }
    return {
      ...request,
      messages: [...(request.messages ?? []), { role: "user", content: externalInputMessage }],
    };
  };
  const emitForcedFinalProviderState: RunNodeRuntimeLoopDeps["emitNodeRuntimeState"] = (state, emitParams) => {
    if (state === "completed" || state === "failed") {
      nodeLoopController.emitForcedFinalProviderState(state, emitParams);
      return;
    }
    emitNodeRuntimeStateDirect(state, emitParams);
  };
  const toolExecutionContext: RuntimeToolExecutionContext = {
    ...middlewareContext,
    actionDeps,
    emitNodeRuntimeState: emitForcedFinalProviderState,
    emitToolRequested: nodeLoopController.emitToolRequested,
    emitToolRunning: nodeLoopController.emitToolRunning,
    emitToolResultObserved: nodeLoopController.emitToolResultObserved,
    emitModelRequest: nodeLoopController.emitModelRequest,
    emitForcedFinal: nodeLoopController.emitForcedFinal,
    emitGateRequired: nodeLoopController.emitGateRequired,
    eventsLength: () => events.length,
    clarificationAnswer,
    ensureClarification,
  };
  const invokeToolExecution = (request: Parameters<typeof invokeRuntimeToolExecution>[0]["request"]) =>
    invokeRuntimeToolExecution({
      request,
      context: toolExecutionContext,
      middlewares: runtimeMiddlewares,
      terminal: async ({ toolCall, allowRisky }) => {
        const invalidatesCache = invalidatesRuntimeToolCache(toolCall);
        const cacheKey = invalidatesCache ? undefined : cacheKeyForRuntimeTool(toolCall);
        const cacheHit =
          cacheKey !== undefined && runtimeToolResultCache.has(cacheKey);
        const execution = cacheHit
          ? { output: runtimeToolResultCache.get(cacheKey) }
          : await runtimeToolExecutor.executeWithMetadata(toolCall, {
              allowRisky,
              currentAgentId: params.agentId,
              currentNodeId: params.nodeId,
              signal: (() => {
                activeOperationAbortController = new AbortController();
                return mergeAbortSignals(deps.signal, activeOperationAbortController.signal);
              })(),
            });
        if (cacheKey && !cacheHit) {
          runtimeToolResultCache.set(cacheKey, execution.output);
        }
        if (invalidatesCache) {
          runtimeToolResultCache.clear();
        }
        const artifact = execution.fileChange
          ? publishFileChangeArtifact(execution.fileChange, {
              actionId: request.action.id,
              agentId: params.agentId,
              nodeId: params.agentId,
            })
          : undefined;
        return {
          output: execution.output,
          fileChange: execution.fileChange,
          artifact,
          cacheKey,
          cacheHit,
        };
      },
    });
  const backgroundChildCount = () => deps.activeBackgroundChildCount?.(params.agentId) ?? 0;
  const pendingAsyncResultCount = () => deps.pendingAsyncResultCount?.(params.agentId) ?? 0;
  const stalledBackgroundChildren = () => deps.stalledBackgroundChildren?.(params.agentId) ?? [];
  const collaborationObserved = () =>
    deps.toolCalls().some((call) =>
      call.agentId === params.agentId
      && call.toolId === "agent.spawn"
      && (call.status === "succeeded" || call.status === "repaired")
    );
  const toolRecoveryService = new RuntimeToolRecoveryService({
    agentId: params.agentId,
    nodeId: params.nodeId,
    title: params.title,
    inputPrompt: input.prompt,
    system: params.system,
    config,
    modeSpec,
    nativeTools,
    streamCallbacks,
    invokeProvider,
    completion,
    completionScope,
    recoveryCoordinator,
    nodeLoopController,
    runtimeToolExecutor,
    actionDeps,
    actionLedger,
    now,
    eventsLength: () => events.length,
    getMessages: () => messages,
    replaceMessages: (nextMessages) => {
      messages = [...nextMessages];
    },
    emit,
    emitRecoveryDecision,
    runForcedFinalProviderCall,
    emitForcedFinalProviderState,
    invokeFollowUpModel,
    publishRecoveryArtifact,
    publishFileChangeArtifact,
    sleep,
  });
  const recoverToolFailure = (failure: RuntimeToolFailureRequest) =>
    toolRecoveryService.recoverToolFailure(failure);
  const toolFailureContext: RuntimeToolFailureContext = {
    ...toolExecutionContext,
    recoverToolFailure,
  };
  const invokeToolFailure = (request: RuntimeToolFailureRequest) =>
    invokeRuntimeToolFailure({
      request,
      context: toolFailureContext,
      middlewares: runtimeMiddlewares,
      terminal: async ({ error }) => ({ kind: "throw", error }),
    });
  const toolCallService = new RuntimeToolCallService({
    agentId: params.agentId,
    nodeId: params.nodeId,
    title: params.title,
    inputPrompt: input.prompt,
    system: params.system,
    config,
    nativeTools,
    streamCallbacks,
    invokeProvider,
    completion,
    completionScope,
    nodeLoopController,
    runtimeToolExecutor,
    actionDeps,
    actionLedger,
    activePlanStepId: deps.activePlanStepId,
    now,
    eventsLength: () => events.length,
    appendToolCall,
    getMessages: () => messages,
    replaceMessages: (nextMessages) => {
      messages = [...nextMessages];
    },
    emit,
    runForcedFinalProviderCall,
    emitForcedFinalProviderState,
    invokeFollowUpModel,
    invokeToolExecution,
    invokeToolFailure,
  });
  const modelResponseContext: RuntimeModelResponseContext = {
    ...toolExecutionContext,
    system: params.system,
    ensureClarifications,
    completion,
    runForcedFinalProviderCall: ({ messages: nextMessages, reason, nativeTools: nextNativeTools }) => {
      const forcedFinalParams = {
        invokeProvider,
        config,
        messages: [...nextMessages],
        system: params.system,
        providerCache: params.providerCache,
        cacheDiagnosticsContext: params.cacheDiagnosticsContext,
        nativeTools: [...nextNativeTools],
        streamCallbacks,
        reason,
        agentId: params.agentId,
        nodeId: params.nodeId,
        title: params.title,
        emitNodeRuntimeState: emitForcedFinalProviderState,
        onProviderExhausted: params.onForcedFinalProviderExhausted,
      } as Parameters<typeof runForcedFinalProviderCall>[0];
      return runForcedFinalProviderCall(forcedFinalParams);
    },
    invokeFollowUpModel,
  };
  const invokeModelResponse = (request: Parameters<typeof invokeRuntimeModelResponse>[0]["request"]) =>
    invokeRuntimeModelResponse({
      request,
      context: modelResponseContext,
      middlewares: runtimeMiddlewares,
      terminal: async () => ({ kind: "unhandled" }),
    });
  const guardCycleCounts = new Map<string, number>();
  let lastAutoAdvanceEvidenceKey = "";
  let emptyFinalOutputRepairUsed = false;
  let freshnessPolicyRepairUsed = false;
  let readContextPolicyRepairUsed = false;
  let weakReadContextDiagnosisRepairUsed = false;
  let manifestOnlyDiagnosisRepairUsed = false;
  let internalProtocolRepairUsed = false;
  const continueOrCompleteNaturally = async (
    currentResponse: ModelResponse,
    iteration: number,
    isPostTool = false,
  ): Promise<{ kind: "continue"; response: ModelResponse } | { kind: "complete"; response: ModelResponse }> => {
    const evidenceToolCallIds = lifecycleEvidenceToolCallIds(deps.toolCalls(), params);
    const evidencePlanStepId = lifecycleEvidencePlanStepId(deps.toolCalls(), evidenceToolCallIds);
    const evidenceKey = evidenceToolCallIds.join("|");
    if (evidenceKey && evidenceKey !== lastAutoAdvanceEvidenceKey) {
      const advanced = deps.autoAdvancePlanListFromLifecycle({
        agentId: params.agentId,
        nodeId: params.nodeId,
        title: params.title,
        evidenceToolCallIds,
        planStepId: evidencePlanStepId,
      });
      if (advanced) {
        lastAutoAdvanceEvidenceKey = evidenceKey;
      }
    }

    const guardResult = evaluateRuntimeCompletionGuards({
      actions: actionLedger.list(),
      planList: deps.planList(),
      toolCalls: deps.toolCalls(),
      agentId: params.agentId,
      activeBackgroundChildCount: backgroundChildCount(),
      pendingAsyncResultCount: pendingAsyncResultCount(),
      collaborationRequirement: params.agentId === ORA_ROOT_AGENT_ID
        ? config.effectiveStrategy?.collaborationRequirement
        : "none",
      collaborationObserved: collaborationObserved(),
      stalledBackgroundChildren: stalledBackgroundChildren(),
    });
    if (guardResult.allowComplete) {
      const planList = deps.planList();
      const hasUnresolvedPlanItems = planList.some(s => s.status !== "completed");
      const currentTaskState = latestCausalTaskState(deps.events());
      const shouldBlockForReadContext = shouldBlockFinalForReadContextPolicy({
        enabled: completion.toolsAllowed(completionScope),
        prompt: input.prompt,
        toolCalls: deps.toolCalls(),
        currentTaskState,
        toolCallCount: completion.toolAttempts,
        clarificationCount: deps.clarificationCount(),
        hasUnresolvedPlanItems,
        responseText: currentResponse.text,
        routerVersion,
      });
      if (shouldBlockForReadContext && !readContextPolicyRepairUsed) {
        readContextPolicyRepairUsed = true;
        nodeLoopController.emitTransitionResult("model_request", "running_model", {
          agentId: params.agentId,
          title: params.title,
          reason: "read_context_policy_blocked",
          detail: "This request likely depends on local context that has not been inspected yet.",
          iteration,
        });
        messages = [
          ...messages,
          { role: "assistant", content: currentResponse.text },
          {
            role: "user",
            content: buildReadContextPolicyFollowUp(input.prompt),
          },
        ];
        return {
          kind: "continue",
          response: await invokeFollowUpModel({
            messages,
            system: params.system,
            providerCache: params.providerCache,
            cacheDiagnosticsContext: params.cacheDiagnosticsContext,
            responseFormat: params.responseFormat,
            maxTokens: config.budget?.maxTokens,
            tools: nativeTools,
            toolChoice: completion.toolsAllowed(completionScope) && nativeTools.length > 0 ? "auto" : "none",
          }, currentResponse, "read_context_policy_blocked"),
        };
      }
      const shouldRepairNoEvidenceDiagnosis = shouldRepairReadContextDiagnosisWithoutEvidence({
        enabled: completion.toolsAllowed(completionScope),
        prompt: input.prompt,
        toolCalls: deps.toolCalls(),
        currentTaskState,
        toolCallCount: completion.toolAttempts,
        clarificationCount: deps.clarificationCount(),
        hasUnresolvedPlanItems,
        responseText: currentResponse.text,
        routerVersion,
        readContextPolicyRepairUsed,
      });
      if (shouldRepairNoEvidenceDiagnosis && !weakReadContextDiagnosisRepairUsed) {
        weakReadContextDiagnosisRepairUsed = true;
        nodeLoopController.emitTransitionResult("model_request", "running_model", {
          agentId: params.agentId,
          title: params.title,
          reason: "read_context_diagnosis_missing_local_evidence",
          detail: "The diagnosis still lacks any inspected local evidence and must not invent repo-specific details.",
          iteration,
        });
        messages = [
          ...messages,
          { role: "assistant", content: currentResponse.text },
          {
            role: "user",
            content: buildReadContextNoEvidenceFinalFollowUp(),
          },
        ];
        return {
          kind: "continue",
          response: await invokeFollowUpModel({
            messages,
            system: params.system,
            providerCache: params.providerCache,
            cacheDiagnosticsContext: params.cacheDiagnosticsContext,
            responseFormat: params.responseFormat,
            maxTokens: config.budget?.maxTokens,
            tools: nativeTools,
            toolChoice: completion.toolsAllowed(completionScope) && nativeTools.length > 0 ? "auto" : "none",
          }, currentResponse, "read_context_diagnosis_missing_local_evidence"),
        };
      }
      const shouldBlockForFreshness = shouldBlockFinalForFreshnessPolicy({
        enabled: freshnessBlockPolicyEnabled,
        prompt: input.prompt,
        toolCalls: deps.toolCalls(),
        currentTaskState,
        toolCallCount: completion.toolAttempts,
        clarificationCount: deps.clarificationCount(),
        hasUnresolvedPlanItems,
        responseText: currentResponse.text,
        routerVersion,
      });
      if (shouldBlockForFreshness && !freshnessPolicyRepairUsed) {
        freshnessPolicyRepairUsed = true;
        nodeLoopController.emitTransitionResult("model_request", "running_model", {
          agentId: params.agentId,
          title: params.title,
          reason: "freshness_policy_blocked",
          detail: "Current-information request lacks fresh search evidence.",
          iteration,
        });
        messages = [
          ...messages,
          { role: "assistant", content: currentResponse.text },
          {
            role: "user",
            content: completion.toolsAllowed(completionScope)
              ? "[Freshness Policy] This request needs current, verifiable information. Before finalizing, use a web/search tool to gather fresh evidence."
              : "[Freshness Policy] You cannot verify the latest state with tools right now. Revise your answer to explicitly say that the latest status is unverified and avoid unsupported current claims.",
          },
        ];
        return {
          kind: "continue",
          response: await invokeFollowUpModel({
            messages,
            system: params.system,
            providerCache: params.providerCache,
            cacheDiagnosticsContext: params.cacheDiagnosticsContext,
            responseFormat: params.responseFormat,
            maxTokens: config.budget?.maxTokens,
            tools: nativeTools,
            toolChoice: completion.toolsAllowed(completionScope) && nativeTools.length > 0 ? "auto" : "none",
          }, currentResponse, "freshness_policy_blocked"),
        };
      }
      const shouldRepairWeakDiagnosis = shouldRepairWeakReadContextDiagnosisCompletion({
        enabled: completion.toolsAllowed(completionScope),
        prompt: input.prompt,
        toolCalls: deps.toolCalls(),
        currentTaskState,
        toolCallCount: completion.toolAttempts,
        clarificationCount: deps.clarificationCount(),
        hasUnresolvedPlanItems,
        responseText: currentResponse.text,
        routerVersion,
      });
      if (shouldRepairWeakDiagnosis && !weakReadContextDiagnosisRepairUsed) {
        weakReadContextDiagnosisRepairUsed = true;
        nodeLoopController.emitTransitionResult("model_request", "running_model", {
          agentId: params.agentId,
          title: params.title,
          reason: "read_context_diagnosis_evidence_weak",
          detail: "The current diagnosis relies on weak repo evidence and needs an evidence-bound revision.",
          iteration,
        });
        messages = [
          ...messages,
          { role: "assistant", content: currentResponse.text },
          {
            role: "user",
            content: buildWeakReadContextDiagnosisFollowUp(),
          },
        ];
        return {
          kind: "continue",
          response: await invokeFollowUpModel({
            messages,
            system: params.system,
            providerCache: params.providerCache,
            cacheDiagnosticsContext: params.cacheDiagnosticsContext,
            responseFormat: params.responseFormat,
            maxTokens: config.budget?.maxTokens,
            tools: nativeTools,
            toolChoice: completion.toolsAllowed(completionScope) && nativeTools.length > 0 ? "auto" : "none",
          }, currentResponse, "read_context_diagnosis_evidence_weak"),
        };
      }
      const shouldRepairManifestOnlyDiagnosis = shouldRepairManifestOnlyDiagnosisCompletion({
        enabled: completion.toolsAllowed(completionScope),
        prompt: input.prompt,
        toolCalls: deps.toolCalls(),
        currentTaskState,
        toolCallCount: completion.toolAttempts,
        clarificationCount: deps.clarificationCount(),
        hasUnresolvedPlanItems,
        responseText: currentResponse.text,
        routerVersion,
        weakDiagnosisRepairUsed: weakReadContextDiagnosisRepairUsed,
      });
      if (shouldRepairManifestOnlyDiagnosis && !manifestOnlyDiagnosisRepairUsed) {
        manifestOnlyDiagnosisRepairUsed = true;
        nodeLoopController.emitTransitionResult("model_request", "running_model", {
          agentId: params.agentId,
          title: params.title,
          reason: "read_context_diagnosis_manifest_only",
          detail: "The diagnosis still leans on manifest dependency names without corroborating runtime evidence.",
          iteration,
        });
        messages = [
          ...messages,
          { role: "assistant", content: currentResponse.text },
          {
            role: "user",
            content: buildManifestOnlyDiagnosisFollowUp(),
          },
        ];
        return {
          kind: "continue",
          response: await invokeFollowUpModel({
            messages,
            system: params.system,
            providerCache: params.providerCache,
            cacheDiagnosticsContext: params.cacheDiagnosticsContext,
            responseFormat: params.responseFormat,
            maxTokens: config.budget?.maxTokens,
            tools: nativeTools,
            toolChoice: completion.toolsAllowed(completionScope) && nativeTools.length > 0 ? "auto" : "none",
          }, currentResponse, "read_context_diagnosis_manifest_only"),
        };
      }

      // Final-output guard: refuse to complete when the candidate answer is empty
      // or obviously too short after tool use.
      const hasToolResultContext = messages.some((message) =>
        message.role === "tool" ||
        (message.role === "user" &&
          typeof message.content === "string" &&
          message.content.includes("Workspace tool result for ")),
      );
      const outputGuardResult = finalOutputGuard(currentResponse.text, {
        isPostTool: isPostTool || hasToolResultContext || completion.toolAttempts > 0,
        finishReason: currentResponse.finishReason,
      });
      if (!outputGuardResult.allowComplete) {
        // Only allow one repair turn for final-output guard failures.
        if (!emptyFinalOutputRepairUsed) {
          emptyFinalOutputRepairUsed = true;
          nodeLoopController.emitTransitionResult("model_request", "running_model", {
            agentId: params.agentId,
            title: params.title,
            reason: outputGuardResult.reason,
            detail: outputGuardResult.detail,
            iteration,
          });
          messages = [
            ...messages,
            { role: "assistant", content: currentResponse.text },
            { role: "user", content: outputGuardResult.followUpContent },
          ];
          const repairResponse = await invokeFollowUpModel({
            messages,
            system: params.system,
            providerCache: params.providerCache,
            cacheDiagnosticsContext: params.cacheDiagnosticsContext,
            responseFormat: params.responseFormat,
            maxTokens: config.budget?.maxTokens,
            tools: nativeTools,
            toolChoice: "none",
          }, currentResponse, outputGuardResult.followUpReason);
          // Re-check the repair response via natural completion.
          return continueOrCompleteNaturally(repairResponse, iteration, false);
        }
        // Repair already used; fail the run.
        throw new Error([
          "Run cannot complete: final output is empty after repair attempt.",
          `reason: ${outputGuardResult.reason}`,
          outputGuardResult.detail,
        ].join("\n"));
      }

      if (isInternalProviderAssistantText(currentResponse.text)) {
        if (!internalProtocolRepairUsed) {
          internalProtocolRepairUsed = true;
          nodeLoopController.emitTransitionResult("model_request", "running_model", {
            agentId: params.agentId,
            title: params.title,
            reason: "internal_protocol_repair",
            detail: "Final model response contained internal protocol text and must be rewritten as plain prose.",
            iteration,
          });
          messages = [
            ...messages,
            { role: "assistant", content: currentResponse.text },
            {
              role: "user",
              content: "Rewrite the final answer in plain user-facing prose only. Do not include JSON tool calls, code-block tool intents, XML-like tool markers, or any other internal protocol text.",
            },
          ];
          return {
            kind: "continue",
            response: await invokeFollowUpModel({
              messages,
              system: params.system,
              providerCache: params.providerCache,
              cacheDiagnosticsContext: params.cacheDiagnosticsContext,
              responseFormat: params.responseFormat,
              maxTokens: config.budget?.maxTokens,
              tools: nativeTools,
              toolChoice: "none",
            }, currentResponse, "internal_protocol_repair"),
          };
        }
        throw new Error("Run cannot complete: final output contains internal protocol text.");
      }

      nodeLoopController.emitTransitionResult("complete", "completed", {
        agentId: params.agentId,
        title: params.title,
        iteration,
      });
      const completionTaskState = await extractCausalTaskState({
        prompt: input.prompt,
        config,
        phase: "completion",
        currentTaskState,
        modelResponseText: currentResponse.text,
        toolCallCount: completion.toolAttempts,
        clarificationCount: deps.clarificationCount(),
        hasUnresolvedPlanItems,
        allowLlmExtraction: false,
      });
      const completionDecision = routeIntervention({
        surfaceRequest: input.prompt,
        taskState: completionTaskState,
        proposedToolId: undefined,
        proposedToolRisk: "low",
        toolCallCount: completion.toolAttempts,
        clarificationCount: deps.clarificationCount(),
        hasPendingApprovals: false,
        hasPendingPlanDecisions: false,
        hasUnresolvedPlanItems,
        modelResponseText: currentResponse.text,
        routerVersion,
        decisionContext: {
          phase: "completion",
          turnIndex: deps.turnIndex,
          replyMessageId: activeAssistantMessageId,
          agentId: params.agentId,
          nodeId: params.nodeId,
          iteration,
        },
      });
      emit("causal.decision.recorded", completionDecision.decisionRecord, {
        agentId: params.agentId,
        nodeId: params.nodeId,
      });
      return { kind: "complete", response: currentResponse };
    }

    await maybeInterruptBlockedPlanStep({
      guardResultReason: guardResult.reason,
      prompt: input.prompt,
      currentResponseText: currentResponse.text,
      planList: deps.planList(),
      config,
      agentId: params.agentId,
      nodeId: params.nodeId,
      title: params.title,
      ensureClarification: deps.ensureClarification,
    });

    // Build a normalized guard fingerprint to detect no-progress loops.
    // Strip parenthesized IDs (e.g. "(action-xxx)"), normalize whitespace,
    // and remove leading numbered prefixes (e.g. "plan 1." → "plan") so
    // minor rephrasings don't reset the cycle counter.
    const guardFingerprint = buildGuardFingerprint(guardResult);
    const guardCycleCount = (guardCycleCounts.get(guardFingerprint) ?? 0) + 1;
    guardCycleCounts.set(guardFingerprint, guardCycleCount);
    if (guardCycleCount > 3) {
      throw new Error([
        "Runtime completion guard repeated without progress.",
        `reason: ${guardResult.reason}`,
        guardResult.detail,
      ].join("\n"));
    }

    emitRuntimeStatusProgress(
      emit,
      params,
      guardResult.progressTrigger,
      guardResult.progressSummary,
      Math.max(0, events.length - 1),
      lastPublicCommentaryFingerprintRef,
    );
    if (
      (guardResult.reason === "pending_background_children" || guardResult.reason === "pending_background_results") &&
      stalledBackgroundChildren().length === 0 &&
      pendingAsyncResultCount() === 0 &&
      backgroundChildCount() > 0
    ) {
      await deps.waitForBackgroundProgress?.(params.agentId);
    }
    nodeLoopController.emitTransitionResult("model_request", "running_model", {
      agentId: params.agentId,
      title: params.title,
      reason: guardResult.reason,
      detail: guardResult.detail,
      iteration: iteration + 1,
    });
    messages = [
      ...messages,
      { role: "assistant", content: currentResponse.text },
      { role: "user", content: guardResult.followUpContent },
    ];
    return {
      kind: "continue",
      response: await invokeFollowUpModel({
        messages,
        system: completion.toolsAllowed(completionScope)
          ? params.system
          : forcedFinalSystemPrompt(
              params.system,
              completion.stopReasonForScope(completionScope) ?? "forced_final_answer",
            ),
        providerCache: params.providerCache,
        cacheDiagnosticsContext: params.cacheDiagnosticsContext,
        responseFormat: params.responseFormat,
        maxTokens: config.budget?.maxTokens,
        tools: nativeTools,
        toolChoice: completion.toolsAllowed(completionScope) && nativeTools.length > 0 ? "auto" : "none",
      }, currentResponse, guardResult.followUpReason),
    };
  };

  nodeLoopController.emitPending({
    agentId: params.agentId,
    title: params.title,
  });
  const initialToolsAllowed = completion.toolsAllowed(completionScope);
  if (!initialToolsAllowed && completion.toolAttempts >= completion.maxToolCalls) {
    completion.forceFinalAnswer("tool_budget_exhausted");
  }
  if (initialToolsAllowed) {
    nodeLoopController.emitTransitionResult("model_request", "running_model", {
      agentId: params.agentId,
      title: params.title,
    });
  } else {
    nodeLoopController.emitForcedFinal({
      agentId: params.agentId,
      title: params.title,
    });
  }
  const initialRequest: ModelRequest = {
    prompt: params.prompt,
    messages,
    system: initialToolsAllowed
      ? params.system
      : forcedFinalSystemPrompt(
          params.system,
          completion.stopReasonForScope(completionScope) ?? "tool_budget_exhausted",
        ),
    providerCache: params.providerCache,
    cacheDiagnosticsContext: params.cacheDiagnosticsContext,
    responseFormat: params.responseFormat,
    maxTokens: config.budget?.maxTokens,
    tools: nativeTools,
    toolChoice:
      nativeTools.length > 0
        ? initialToolsAllowed
          ? "auto"
          : "none"
        : undefined,
  };
  let response: ModelResponse;
  try {
    const tNow = Date.now();
    const kernelElapsed = tNow - (((globalThis as any).__latencyKernelStart as number) ?? tNow);
    (globalThis as any).__latencyInvokeModelStart = tNow;
    logLatency("kernel→invokeModel", kernelElapsed);
    response = await invokeModel(initialRequest, {
      emitRetryModelState: initialToolsAllowed,
    });
  } catch (error) {
    if (!initialToolsAllowed) {
      nodeLoopController.emitTransitionResult("fail", "failed", {
        agentId: params.agentId,
        title: params.title,
        reason: completion.stopReasonForScope(completionScope) ?? "tool_budget_exhausted",
        detail: error instanceof Error ? error.message : String(error),
      });
      const exhaustedFallback = params.onForcedFinalProviderExhausted?.(error);
      if (exhaustedFallback) {
        return exhaustedFallback;
      }
    }
    throw error;
  }
  if (!initialToolsAllowed) {
    const finalResponse = coerceNoToolResponse(
      response,
      completion.stopReasonForScope(completionScope) ?? "tool_budget_exhausted",
    );
    const completionResult = await continueOrCompleteNaturally(finalResponse, 0);
    if (completionResult.kind === "complete") {
      return completionResult.response;
    }
    response = completionResult.response;
  }

  if (enabledTools.length === 0) {
    const completionResult = await continueOrCompleteNaturally(response, 0);
    if (completionResult.kind === "complete") {
      return completionResult.response;
    }
    response = completionResult.response;
  }

  const remainingToolBudget = Number.isFinite(completion.maxToolCalls)
    ? Math.max(0, completion.maxToolCalls - completion.toolAttempts)
    : RUNTIME_TOOL_LOOP_SAFETY_LIMIT;
  const toolLoopLimit = Math.max(
    1,
    Math.min(RUNTIME_TOOL_LOOP_SAFETY_LIMIT, remainingToolBudget),
  );
  let ignoredUnavailableToolCallFollowUps = 0;
  let hasExecutedTool = false;
  for (let iteration = 0; iteration < toolLoopLimit; iteration += 1) {
    if (shouldPreferCompleteProposedPlanResponse(config, response)) {
      const completionResult = await continueOrCompleteNaturally(response, iteration, hasExecutedTool);
      if (completionResult.kind === "continue") {
        response = completionResult.response;
        continue;
      }
      return completionResult.response;
    }

    if (!completion.toolsAllowed(completionScope)) {
      const forcedFinalResponse = coerceNoToolResponse(
        response,
        completion.stopReasonForScope(completionScope) ?? "tool_budget_exhausted",
        { emitRejectedToolIntent: true },
      );
      const completionResult = await continueOrCompleteNaturally(
        forcedFinalResponse,
        iteration,
        hasExecutedTool,
      );
      if (completionResult.kind === "continue") {
        response = completionResult.response;
        continue;
      }
      return completionResult.response;
    }

    const toolCall = selectRuntimeToolAttempt({
      response,
      toolIds: enabledTools,
      extractFallbackToolCall: (text, toolIds) => runtimeToolExecutor.extractToolCall(text, toolIds),
    });
    if (!toolCall) {
      const ignoredNativeToolCalls = (response.toolCalls?.length ?? 0) > 0 &&
        nativeRuntimeToolAttempts(response, enabledTools).length === 0;
      if (ignoredNativeToolCalls && ignoredUnavailableToolCallFollowUps < 3) {
        ignoredUnavailableToolCallFollowUps += 1;
        emit("completion.updated", {
          state: "tool_calls_ignored",
          reason: "unavailable_tool_in_mode",
          ignoredToolCalls: response.toolCalls,
        });
        nodeLoopController.emitTransitionResult("model_request", "running_model", {
          agentId: params.agentId,
          title: params.title,
          reason: "unavailable_tool_in_mode",
          detail: "The model requested a tool that is not available in the current mode.",
          iteration: iteration + 1,
        });
        messages = [
          ...messages,
          { role: "assistant", content: response.text },
          {
            role: "user",
            content: "The previous response requested a tool that is not available in the current mode. Continue without that tool and produce the required user-facing response.",
          },
        ];
        response = await invokeFollowUpModel({
          messages,
          system: params.system,
          providerCache: params.providerCache,
          cacheDiagnosticsContext: params.cacheDiagnosticsContext,
          responseFormat: params.responseFormat,
          maxTokens: config.budget?.maxTokens,
          tools: nativeTools,
          toolChoice: nativeTools.length > 0 ? "auto" : undefined,
        }, response, "unavailable_tool_follow_up");
        continue;
      }
      const completionResult = await continueOrCompleteNaturally(response, iteration, hasExecutedTool);
      if (completionResult.kind === "continue") {
        response = completionResult.response;
        continue;
      }
      return completionResult.response;
    }

    const allNativeToolCalls = nativeRuntimeToolAttempts(response, enabledTools);

    const responseResult = await invokeModelResponse({
      response,
      iteration,
      messages,
      selectedToolCall: toolCall,
      allNativeToolCalls,
      nativeTools,
    });
    if (responseResult.kind === "handled_return") {
      return responseResult.response;
    }
    if (responseResult.kind === "handled_continue") {
      response = responseResult.response;
      continue;
    }

    const toolRisk = classifyToolRisk(toolCall.tool);
    const planList = deps.planList();
    const hasUnresolvedPlanItems = planList.some(s => s.status !== "completed");
    const currentTaskState = latestCausalTaskState(deps.events());
    const shouldExtractSemanticState = !hasPrimaryCausalDecisionInPhase(deps.events(), "tool_request") &&
      String(currentTaskState?.selectedLatentGoal ?? "").trim().length === 0;
    const policyTaskState = await extractCausalTaskState({
      prompt: input.prompt,
      config,
      phase: "tool_request",
      currentTaskState,
      modelResponseText: response.text,
      proposedToolId: toolCall.tool,
      toolCallCount: completion.toolAttempts + 1,
      clarificationCount: deps.clarificationCount(),
      hasUnresolvedPlanItems,
      allowLlmExtraction: shouldExtractSemanticState,
    });
    const policyResult = routeIntervention({
      surfaceRequest: input.prompt,
      taskState: policyTaskState,
      proposedToolId: toolCall.tool,
      proposedToolRisk: toolRisk,
      toolCallCount: completion.toolAttempts + 1,
      clarificationCount: deps.clarificationCount(),
      hasPendingApprovals: false,
      hasPendingPlanDecisions: false,
      hasUnresolvedPlanItems,
      modelResponseText: response.text,
      routerVersion,
      decisionContext: {
        phase: "tool_request",
        turnIndex: deps.turnIndex,
        replyMessageId: activeAssistantMessageId,
        toolId: toolCall.tool,
        providerCallId: toolCall.providerCallId,
        iteration,
        agentId: params.agentId,
        nodeId: params.nodeId,
      },
    });
    emit("causal.decision.recorded", policyResult.decisionRecord, {
      agentId: params.agentId,
      nodeId: params.nodeId,
    });

    if (shouldBlockToolForContextProbePolicy({
      enabled: contextProbePolicyEnabled,
      prompt: input.prompt,
      toolCalls: deps.toolCalls(),
      proposedToolId: toolCall.tool,
      proposedToolArgs: toolCall.args,
      recommendedAction: policyResult.action,
      routerVersion,
      modeId: config.modeId,
      sourceModeId: config.effectiveStrategy?.sourceModeId,
    })) {
      emit("causal.decision.rejected", {
        toolId: toolCall.tool,
        recommendedAction: policyResult.action,
        reason: "Context probe policy requires reading the referenced artifact/context before other tool execution.",
        level: "context_probe_policy",
        diagnostic: {
          recordedAt: now(),
          toolCallCount: completion.toolAttempts,
          hasReadContextEvidence: hasReadContextEvidence(deps.toolCalls()),
          promptExcerpt: input.prompt.slice(0, 200),
          proposedToolId: toolCall.tool,
          iteration,
        },
      }, {
        agentId: params.agentId,
        nodeId: params.nodeId,
      });
      nodeLoopController.emitTransitionResult("model_request", "running_model", {
        agentId: params.agentId,
        title: params.title,
        toolId: toolCall.tool,
        reason: "context_probe_policy",
        detail: "Read the referenced file/PR/diff/data context first.",
        iteration,
      });
      messages = [
        ...messages,
        { role: "assistant", content: response.text },
        {
          role: "user",
          content: buildContextProbePolicyFollowUp({
            proposedToolId: toolCall.tool,
            modeId: config.modeId,
            sourceModeId: config.effectiveStrategy?.sourceModeId,
          }),
        },
      ];
      response = await invokeFollowUpModel({
        messages,
        system: params.system,
        providerCache: params.providerCache,
        cacheDiagnosticsContext: params.cacheDiagnosticsContext,
        responseFormat: params.responseFormat,
        maxTokens: config.budget?.maxTokens,
        tools: nativeTools,
        toolChoice: nativeTools.length > 0 ? "auto" : undefined,
      }, response, "context_probe_policy_blocked");
      continue;
    }

    if (
      shouldBlockWideTaskArchiveReadForReporting({
        prompt: input.prompt,
        toolCalls: deps.toolCalls(),
        proposedToolId: toolCall.tool,
        proposedToolArgs: toolCall.args,
        recommendedAction: policyResult.action,
      })
    ) {
      emit("causal.decision.rejected", {
        toolId: toolCall.tool,
        recommendedAction: policyResult.action,
        reason: "reporting_read_context_surface",
        level: "context_probe_policy",
        diagnostic: {
          recordedAt: now(),
          toolCallCount: completion.toolAttempts,
          hasHighSignalReportingEvidence: hasHighSignalReportingEvidence(deps.toolCalls()),
          promptExcerpt: input.prompt.slice(0, 200),
          proposedToolId: toolCall.tool,
          proposedToolArgs: toolCall.args,
          iteration,
        },
      }, {
        agentId: params.agentId,
        nodeId: params.nodeId,
      });
      nodeLoopController.emitTransitionResult("model_request", "running_model", {
        agentId: params.agentId,
        title: params.title,
        toolId: toolCall.tool,
        reason: "reporting_read_context_surface",
        detail: "Start with docs/changelog/release artifacts before wide task-archive reads.",
        iteration,
      });
      messages = [
        ...messages,
        { role: "assistant", content: response.text },
        {
          role: "user",
          content: buildReportingReadContextSurfaceFollowUp(),
        },
      ];
      response = await invokeFollowUpModel({
        messages,
        system: params.system,
        providerCache: params.providerCache,
        cacheDiagnosticsContext: params.cacheDiagnosticsContext,
        responseFormat: params.responseFormat,
        maxTokens: config.budget?.maxTokens,
        tools: nativeTools,
        toolChoice: nativeTools.length > 0 ? "auto" : undefined,
      }, response, "reporting_read_context_surface_blocked");
      continue;
    }

    // Enforcing mode: for executable interventions, inject guidance and let
    // the model continue with tools instead of forcing a final answer. This must
    // happen before emitToolRequested() to keep the state machine valid.
    const interventionLevel = deps.config.causalInterventionLevel ?? "record_only";
    const toolAlreadyMatchesRecommendation = toolMatchesCausalRecommendation(
      policyResult.action,
      toolCall.tool,
    );
    if (
      interventionLevel === "enforcing" &&
      shouldContinueAfterCausalBlock(policyResult.action) &&
      !toolAlreadyMatchesRecommendation
    ) {
      const blockResult = applyCausalPolicyGate(policyResult, interventionLevel);
      if (blockResult.blocked) {
        if (hasCausalFollowUpThisTurn(messages, toolCall.tool)) {
          // Already issued a causal follow-up this turn;
          // fall through to emitToolRequested + existing force-final path.
        } else {
          emit("causal.decision.rejected", {
            toolId: toolCall.tool,
            recommendedAction: policyResult.action,
            reason: blockResult.reason,
            level: interventionLevel,
          }, {
            agentId: params.agentId,
            nodeId: params.nodeId,
          });
          nodeLoopController.emitTransitionResult("model_request", "running_model", {
            agentId: params.agentId,
            title: params.title,
            toolId: toolCall.tool,
            reason: blockResult.reason,
            iteration,
          });
          const actionLabel = interventionActionToLabel(policyResult.action);
          const guidanceMessage = [
            `[Causal Policy] Your attempt to use ${toolCall.tool} was blocked.`,
            `Reason: ${blockResult.reason}`,
            `Recommended action: ${actionLabel}.`,
            `Please ${actionLabel.toLowerCase()} before answering.`,
          ].join(" ");
          messages = [
            ...messages,
            { role: "assistant", content: response.text },
            { role: "user", content: guidanceMessage },
          ];
          response = await invokeFollowUpModel({
            messages,
            system: params.system,
            providerCache: params.providerCache,
            cacheDiagnosticsContext: params.cacheDiagnosticsContext,
            responseFormat: params.responseFormat,
            maxTokens: config.budget?.maxTokens,
            tools: nativeTools,
            toolChoice: nativeTools.length > 0 ? "auto" : undefined,
          }, response, `causal_policy_${policyResult.action}_blocked`);
          continue;
        }
      }
    }

    const toolRequestedParams = {
      agentId: params.agentId,
      title: params.title,
      toolId: toolCall.tool,
      iteration,
    };
    nodeLoopController.emitToolRequested(toolRequestedParams);

    // Causal policy gate: in advisory/enforcing mode, the causal decision
    // may override or block the proposed tool call.
    if (interventionLevel !== "record_only" && !toolAlreadyMatchesRecommendation) {
      const blockResult = applyCausalPolicyGate(policyResult, interventionLevel);
      if (blockResult.blocked) {
        emit("causal.decision.rejected", {
          toolId: toolCall.tool,
          recommendedAction: policyResult.action,
          reason: blockResult.reason,
          level: interventionLevel,
        }, {
          agentId: params.agentId,
          nodeId: params.nodeId,
        });
        if (interventionLevel === "enforcing") {
          nodeLoopController.emitTransitionResult("boundary_failure", "finalizing", {
            agentId: params.agentId,
            title: params.title,
            toolId: toolCall.tool,
            reason: blockResult.reason,
            iteration,
          });
          // Inject causal policy feedback into the conversation so the model
          // can produce an informed final answer instead of silently dropping
          // the tool call.
          const causalFeedback = [
            `[Causal Policy] Your attempt to use ${toolCall.tool} was blocked.`,
            `Reason: ${blockResult.reason}`,
            `Recommended action: ${interventionActionToLabel(policyResult.action)}.`,
            `Please provide your final answer based on the conversation so far.`,
          ].join(" ");
          const forcedFinalParams = {
            invokeProvider,
            config,
            messages: [
              ...messages,
              { role: "user", content: causalFeedback },
            ],
            system: params.system,
            providerCache: params.providerCache,
            cacheDiagnosticsContext: params.cacheDiagnosticsContext,
            nativeTools,
            streamCallbacks,
            reason: "causal_policy_blocked",
            agentId: params.agentId,
            nodeId: params.nodeId,
            title: params.title,
            emitNodeRuntimeState: emitForcedFinalProviderState,
            onProviderExhausted: params.onForcedFinalProviderExhausted,
          } as Parameters<typeof runForcedFinalProviderCall>[0];
          return runForcedFinalProviderCall(forcedFinalParams);
        }
      }
    }

    const attemptDecision = registerRuntimeToolAttempt({
      completion,
      toolCall,
      scope: completionScope,
    });
    if (!attemptDecision.allowed) {
      nodeLoopController.emitTransitionResult("boundary_failure", "finalizing", {
        agentId: params.agentId,
        title: params.title,
        toolId: toolCall.tool,
        reason: attemptDecision.reason,
        iteration,
      });
      const forcedFinalParams = {
        invokeProvider,
        config,
        messages,
        system: params.system,
        providerCache: params.providerCache,
        cacheDiagnosticsContext: params.cacheDiagnosticsContext,
        nativeTools,
        streamCallbacks,
        reason: attemptDecision.reason,
        agentId: params.agentId,
        nodeId: params.nodeId,
        title: params.title,
        emitNodeRuntimeState: emitForcedFinalProviderState,
        onProviderExhausted: params.onForcedFinalProviderExhausted,
      } as Parameters<typeof runForcedFinalProviderCall>[0];
      return runForcedFinalProviderCall(forcedFinalParams);
    }

    const boundaryError = codeDevelopmentToolBoundaryError({
      modeSpec,
      agentId: params.agentId,
      toolCall,
      runtimeToolExecutor,
    });
    if (boundaryError) {
      nodeLoopController.emitTransitionResult("boundary_failure", "failed", {
        agentId: params.agentId,
        title: params.title,
        toolId: toolCall.tool,
        detail: boundaryError,
        iteration,
      });
      throw new Error(boundaryError);
    }

    const toolTurnResult = await toolCallService.runToolTurn({
      toolCall,
      response,
      iteration,
    });
    switch (toolTurnResult.kind) {
      case "retry":
        continue;
      case "return":
        return toolTurnResult.response;
      case "continue":
        hasExecutedTool = true;
        response = toolTurnResult.response;
        continue;
      case "throw":
        throw toolTurnResult.error;
    }
  }

  completion.forceFinalAnswer("runtime_tool_loop_limit");
  nodeLoopController.emitForcedFinal({
    agentId: params.agentId,
    title: params.title,
    reason: "runtime_tool_loop_limit",
  });
  const forcedFinalParams = {
    invokeProvider,
    config,
    messages,
    system: params.system,
    providerCache: params.providerCache,
    cacheDiagnosticsContext: params.cacheDiagnosticsContext,
    nativeTools,
    streamCallbacks,
    reason: "runtime_tool_loop_limit",
    agentId: params.agentId,
    title: params.title,
    emitNodeRuntimeState: emitForcedFinalProviderState,
    onProviderExhausted: params.onForcedFinalProviderExhausted,
  } as Parameters<typeof runForcedFinalProviderCall>[0];
  return runForcedFinalProviderCall(forcedFinalParams);
}

function lifecycleEvidenceToolCallIds(
  toolCalls: readonly OraToolCallEnvelope[],
  params: Pick<RunNodeRuntimeLoopParams, "agentId" | "nodeId">,
): string[] {
  return toolCalls
    .filter((call) =>
      call.status === "succeeded" &&
      call.toolId !== "plan.update" &&
      (!call.agentId || call.agentId === params.agentId) &&
      (!call.nodeId || call.nodeId === params.nodeId || call.nodeId === params.agentId)
    )
    .map((call) => call.id)
    .sort();
}

function lifecycleEvidencePlanStepId(
  toolCalls: readonly OraToolCallEnvelope[],
  evidenceToolCallIds: readonly string[],
): string | undefined {
  const ids = new Set(evidenceToolCallIds);
  const planStepIds = [...new Set(toolCalls
    .filter((call) => ids.has(call.id) && call.planStepId)
    .map((call) => call.planStepId!)
  )];
  return planStepIds.length === 1 ? planStepIds[0] : undefined;
}

function withStablePrefixCacheMetadata(request: ModelRequest): ModelRequest {
  if (!request.messages?.length) {
    return request;
  }
  return {
    ...request,
    providerCache: {
      ...request.providerCache,
      stablePrefixMessageCount: request.providerCache?.stablePrefixMessageCount ?? request.messages.length,
    },
  };
}

function withFollowUpCacheMetadata(
  request: ModelRequest,
  latestResponse: ModelResponse,
  previousMessages: readonly ModelMessage[],
): ModelRequest {
  const stableRequest = withStablePrefixCacheMetadata(request);
  const previousResponseId = (latestResponse.providerResponseId ?? rawProviderResponseId(latestResponse.raw))?.trim();
  if (!previousResponseId || !request.messages?.length || previousMessages.length === 0) {
    return stableRequest;
  }
  if (!messagesHaveStablePrefix(previousMessages, request.messages)) {
    return stableRequest;
  }
  const deltaMessages = request.messages.slice(previousMessages.length);
  if (deltaMessages.length === 0) {
    return stableRequest;
  }
  return {
    ...stableRequest,
    providerCache: {
      ...stableRequest.providerCache,
      openaiPreviousResponseId: previousResponseId,
      openaiDeltaMessages: deltaMessages,
    },
  };
}

function rawProviderResponseId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const id = (raw as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

function messagesHaveStablePrefix(
  previousMessages: readonly ModelMessage[],
  nextMessages: readonly ModelMessage[],
): boolean {
  if (nextMessages.length < previousMessages.length) {
    return false;
  }
  for (let index = 0; index < previousMessages.length; index += 1) {
    if (JSON.stringify(previousMessages[index]) !== JSON.stringify(nextMessages[index])) {
      return false;
    }
  }
  return true;
}
