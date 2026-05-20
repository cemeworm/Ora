import { ActionApprovalRequestCopySchema } from "@cemeworm/shared";
import { resolveToolPermission } from "@cemeworm/shared";
import type { ActionApprovalRequestCopy, ActionRiskLevel, AgentResultContract, AgentToolBundleId, ModeToolLimits, PermissionProfile, RuntimeToolResultPreview, SearchProviderConfig, SkillDescriptor, SkillDetail, SkillListParams, TaskIntent, ToolDescriptor, ToolPermission } from "@cemeworm/shared";
import type { PackageManager } from "../package-manager.js";
import type { ModelToolDefinition } from "../providers/index.js";
import type { RuntimeToolDefinition } from "./capability-registries.js";
import { automationToolRuntimeFields } from "./runtime-automation-tools.js";
import { clarificationToolRuntimeFields } from "./runtime-clarification-tool.js";
import { fileToolRuntimeFields } from "./runtime-file-tools.js";
import { createSearchProvider, type SearchProvider } from "./search-providers/index.js";
import { mcpToolRuntimeFields, callMcpTool as callRuntimeMcpTool } from "./runtime-mcp-tools.js";
import { modeToolRuntimeFields } from "./runtime-mode-tools.js";
import { packageToolRuntimeFields } from "./runtime-package-tools.js";
import { planToolRuntimeFields } from "./runtime-plan-tool.js";
import { ApprovalInterruptError } from "./runtime-interrupts.js";
import { selfIterationToolRuntimeFields } from "./runtime-self-iteration-tools.js";
import { shellCommandRequiresHighRisk, shellToolRuntimeFields } from "./runtime-shell-tool.js";
import { skillToolRuntimeFields } from "./runtime-skill-tools.js";
import { genericApprovalRequest } from "./runtime-tool-approval.js";
import { isRecord, workspaceRootPath } from "./runtime-tool-utils.js";
import { webDocumentToolRuntimeFields } from "./runtime-web-document-tools.js";
import { computerToolRuntimeFields } from "./runtime-computer-tools.js";
import { widgetToolRuntimeFields } from "./runtime-widget-tools.js";
import { type WorkspaceOperations, localWorkspaceOperations } from "./workspace-operations.js";
import type { ComputerBackendManager } from "./computer-use/backend-manager.js";

export const IMPLEMENTED_RUNTIME_TOOL_IDS = [
  "file.read",
  "file.list",
  "file.glob",
  "file.grep",
  "file.write",
  "file.patch",
  "file.apply_patch",
  "shell.execute",
  "web.fetch",
  "web.search",
  "document.extract",
  "user.clarify",
  "skills.list",
  "skills.get",
  "skills.checkName",
  "skills.create",
  "skills.update",
  "skills.setEnabled",
  "skills.patch",
  "mcp.listTools",
  "mcp.readResource",
  "mcp.call",
  "package.list",
  "package.buildCandidate",
  "package.verify",
  "package.promote",
  "package.switch",
  "package.rollback",
  "modes.list",
  "modes.generateDraft",
  "modes.refineDraft",
  "modes.validate",
  "modes.applyDraft",
  "selfIteration.list",
  "selfIteration.get",
  "selfIteration.scan",
  "selfIteration.evaluate",
  "selfIteration.apply",
  "automations.list",
  "automations.get",
  "automations.previewSchedule",
  "automations.create",
  "automations.update",
  "automations.pause",
  "automations.resume",
  "automations.delete",
  "automations.runNow",
  "widgets.getSelectedContext",
  "widgets.get",
  "widgets.todo.addItem",
  "plan.update",
  "agent.spawn",
  "agent.wait",
  "message.send",
  "computer.permissionStatus",
  "computer.observe",
  "computer.click",
  "computer.type",
  "computer.press",
  "computer.scroll",
  "computer.window",
] as const;

export type RuntimeToolId = typeof IMPLEMENTED_RUNTIME_TOOL_IDS[number];

export interface RuntimeToolCall {
  tool: RuntimeToolId;
  args: Record<string, unknown>;
}

export interface RuntimeFileChangeMetadata {
  kind: "file_change";
  path: string;
  operation: "write" | "patch";
  beforeContent: string;
  afterContent: string;
  additions: number;
  deletions: number;
  metadata: {
    sizeBytes: number;
    replacements?: number;
    firstChangedLine?: number;
    diff?: string;
    created: boolean;
  };
}

export interface RuntimeToolExecutionResult {
  output: unknown;
  fileChange?: RuntimeFileChangeMetadata;
  resultPreview?: RuntimeToolResultPreview;
}

export interface RuntimeToolExecutionContext {
  currentAgentId?: string;
  currentNodeId?: string;
  workspace: unknown;
  fetchImpl: typeof fetch;
  skillRegistry?: SkillRegistryTools;
  modeRegistry?: ModeRegistryTools;
  selfIterationRegistry?: SelfIterationRegistryTools;
  automationRegistry?: AutomationRegistryTools;
  widgetRegistry?: WidgetRegistryTools;
  mcpConfigPaths?: string[];
  searchProvider: SearchProvider;
  packageManager?: PackageManager;
  limits: ResolvedToolLimits;
  taskIntent?: TaskIntent;
  permissionProfile?: PermissionProfile;
  allowRisky?: boolean;
  /** AbortSignal from the run-level AbortController. Tools should observe this and stop execution when aborted. */
  signal?: AbortSignal;
  /** Read-only turn context for the active run, including selected widget context. */
  turnContext?: Record<string, unknown>;
  /** Workspace operations adapter — pluggable backend for file/shell operations. */
  operations: WorkspaceOperations;
  /** Spawn a sub-agent and run it to completion. Returns the agent's text output. */
  spawnAgent?: (params: {
    description: string;
    prompt: string;
    agentType?: string;
    runInBackground?: boolean;
    inheritContext?: boolean;
    systemPrompt?: string;
    toolBundle?: AgentToolBundleId;
    toolIds?: string[];
    resultContract?: AgentResultContract;
    invokingAgentId?: string;
  }) => Promise<unknown>;
  /** Wait for background sub-agents and collect their structured results. */
  waitForAgents?: (params: {
    agentIds?: string[];
    childSessionIds?: string[];
    requireAll?: boolean;
    invokingAgentId?: string;
  }) => Promise<unknown>;
  /** Enqueue a message to be delivered to an agent on its next invocation. */
  enqueueMessage?: (params: { to: string; message: string; invokingAgentId?: string }) => void;
  /** Computer use backend manager for GUI automation tools. */
  computerBackendManager?: ComputerBackendManager;
}

export interface RuntimeToolExecutionOptions {
  allowRisky?: boolean;
  currentAgentId?: string;
  currentNodeId?: string;
  signal?: AbortSignal;
}

export interface RuntimePreToolPolicyRequest {
  toolId: string;
  args: Record<string, unknown>;
  descriptor: ToolDescriptor;
  context: RuntimeToolExecutionContext;
  riskLevel: ToolDescriptor["riskLevel"];
}

export interface RuntimePreToolPolicyResult {
  permission?: ToolPermission;
  args?: Record<string, unknown>;
  riskLevel?: ToolDescriptor["riskLevel"];
  reason?: string;
}

export type RuntimePreToolPolicyHook = (
  request: RuntimePreToolPolicyRequest,
) => RuntimePreToolPolicyResult | undefined | Promise<RuntimePreToolPolicyResult | undefined>;

export interface RuntimePostToolPolicyRequest {
  toolId: string;
  args: Record<string, unknown>;
  descriptor?: ToolDescriptor;
  context: RuntimeToolExecutionContext;
  result?: RuntimeToolExecutionResult;
  isError: boolean;
  error?: unknown;
}

export interface RuntimePostToolPolicyResult {
  result?: RuntimeToolExecutionResult;
}

export type RuntimePostToolPolicyHook = (
  request: RuntimePostToolPolicyRequest,
) => RuntimePostToolPolicyResult | undefined | Promise<RuntimePostToolPolicyResult | undefined>;

export interface RuntimeToolExecutorOptions {
  workspace?: unknown;
  toolDescriptors?: readonly ToolDescriptor[];
  skillRegistry?: SkillRegistryTools;
  modeRegistry?: ModeRegistryTools;
  selfIterationRegistry?: SelfIterationRegistryTools;
  automationRegistry?: AutomationRegistryTools;
  widgetRegistry?: WidgetRegistryTools;
  fetchImpl?: typeof fetch;
  mcpConfigPaths?: string[];
  searchProvider?: SearchProvider;
  searchProviderConfig?: SearchProviderConfig;
  searchEnv?: NodeJS.ProcessEnv;
  packageManager?: PackageManager;
  toolLimits?: ModeToolLimits;
  taskIntent?: TaskIntent;
  permissionProfile?: PermissionProfile;
  toolDefinitions?: RuntimeToolDefinition<RuntimeToolExecutionContext>[];
  preToolPolicyHooks?: RuntimePreToolPolicyHook[];
  postToolPolicyHooks?: RuntimePostToolPolicyHook[];
  signal?: AbortSignal;
  turnContext?: Record<string, unknown>;
  workspaceOperations?: WorkspaceOperations;
  computerBackendManager?: ComputerBackendManager;
}

export interface SkillRegistryTools {
  list(params?: SkillListParams): SkillDescriptor[];
  get(params: { name: string }): SkillDetail;
  checkName(params: unknown): unknown;
  create(params: unknown): SkillDetail;
  update(params: unknown): SkillDetail;
  setEnabled(params: unknown): SkillDetail;
  patch(params: unknown): SkillDetail;
  recordTelemetry(name: string, event: "use" | "view" | "patch"): void;
  flushTelemetry(): void;
  evaluateCurator(): void;
  evaluateCuratorIfDue(): void;
}

export interface ModeRegistryTools {
  listModes(): unknown[];
  generateModeStudioDraft(params: unknown): unknown;
  refineModeStudioDraft(params: unknown): unknown;
  validateModeStudioDraft(params: unknown): unknown;
  applyModeStudioDraft(params: unknown): unknown;
}

export interface SelfIterationRegistryTools {
  listSelfIterationCandidates(params?: unknown): unknown;
  getSelfIterationCandidate(params: unknown): unknown;
  scanSelfIteration(params?: unknown): unknown;
  evaluateSelfIterationCandidate(params: unknown): unknown;
  applySelfIterationCandidate(params: unknown): unknown;
}

export interface AutomationRegistryTools {
  listAutomations(params?: unknown): unknown;
  getAutomation(params: unknown): unknown;
  previewAutomationSchedule(params: unknown): unknown;
  createAutomation(params: unknown): unknown;
  updateAutomation(params: unknown): unknown;
  pauseAutomation(params: unknown): unknown;
  resumeAutomation(params: unknown): unknown;
  deleteAutomation(params: unknown): unknown;
  runAutomationNow(params: unknown): unknown;
}

export interface WidgetRegistryTools {
  getWidget(params: unknown): unknown;
  addTodoWidgetItem(params: unknown): unknown;
}

const IMPLEMENTED_TOOL_SET = new Set<string>(IMPLEMENTED_RUNTIME_TOOL_IDS);

export function registerImplementedToolId(toolId: string): void {
  IMPLEMENTED_TOOL_SET.add(toolId);
}

export function unregisterImplementedToolId(toolId: string): void {
  IMPLEMENTED_TOOL_SET.delete(toolId);
}
const FILE_READ_MAX_BYTES = 10_000_000;
const FILE_LIST_MAX_ENTRIES = 500;
const FILE_SEARCH_MAX_FILES = 10_000;
const FILE_SEARCH_MAX_MATCHES = 1_000;
const FILE_SEARCH_MAX_BYTES = 10_000_000;
const FILE_WRITE_MAX_BYTES = 10_000_000;
const WEB_MAX_BYTES = 10_000_000;
const DOCUMENT_EXTRACT_MAX_BYTES = 1_000_000;
const DOCUMENT_SOURCE_MAX_BYTES = 25_000_000;
const SHELL_MAX_OUTPUT_BYTES = 1_048_576;
const SHELL_TIMEOUT_MS = 300_000;

export interface ResolvedToolLimits {
  fileReadMaxBytes: number;
  fileListMaxEntries: number;
  fileSearchMaxFiles: number;
  fileSearchMaxMatches: number;
  fileSearchMaxBytes: number;
  fileWriteMaxBytes: number;
  webMaxBytes: number;
  documentExtractMaxBytes: number;
  documentSourceMaxBytes: number;
  shellMaxOutputBytes: number;
  shellTimeoutMs: number;
}

function resolveToolLimits(overrides: ModeToolLimits = {} as ModeToolLimits): ResolvedToolLimits {
  return {
    fileReadMaxBytes: overrides.fileReadMaxBytes ?? FILE_READ_MAX_BYTES,
    fileListMaxEntries: overrides.fileListMaxEntries ?? FILE_LIST_MAX_ENTRIES,
    fileSearchMaxFiles: overrides.fileSearchMaxFiles ?? FILE_SEARCH_MAX_FILES,
    fileSearchMaxMatches: overrides.fileSearchMaxMatches ?? FILE_SEARCH_MAX_MATCHES,
    fileSearchMaxBytes: overrides.fileSearchMaxBytes ?? FILE_SEARCH_MAX_BYTES,
    fileWriteMaxBytes: overrides.fileWriteMaxBytes ?? FILE_WRITE_MAX_BYTES,
    webMaxBytes: overrides.webMaxBytes ?? WEB_MAX_BYTES,
    documentExtractMaxBytes: overrides.documentExtractMaxBytes ?? DOCUMENT_EXTRACT_MAX_BYTES,
    documentSourceMaxBytes: overrides.documentSourceMaxBytes ?? DOCUMENT_SOURCE_MAX_BYTES,
    shellMaxOutputBytes: overrides.shellMaxOutputBytes ?? SHELL_MAX_OUTPUT_BYTES,
    shellTimeoutMs: overrides.shellTimeoutMs ?? SHELL_TIMEOUT_MS,
  };
}

export function isRuntimeToolImplemented(toolId: string): toolId is RuntimeToolId {
  return IMPLEMENTED_TOOL_SET.has(toolId);
}

export function extractRuntimeToolCallFromText(text: string, toolIds: readonly string[] = []): RuntimeToolCall | undefined {
  const enabled = new Set(toolIds.filter(isRuntimeToolImplemented));
  if (enabled.size === 0) {
    return undefined;
  }

  const trimmed = text.trim();
  const candidates = [
    trimmed,
    ...Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1]?.trim() ?? ""),
    ...Array.from(trimmed.matchAll(/<tool_call(?:\s[^>]*)?>([\s\S]*?)<\/tool_call>/gi), (match) => match[1]?.trim() ?? ""),
    ...extractInlineJsonCandidates(trimmed),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const jsonCall = extractJsonToolCall(candidate, enabled);
    if (jsonCall) {
      return jsonCall;
    }
  }

  return extractTaggedToolCall(trimmed, enabled);
}

function extractInlineJsonCandidates(text: string): string[] {
  const results: string[] = [];
  const enabledPattern = /\{[^{}]*"tool"\s*:\s*"[^"]+"\s*[,}][^{}]*\}/g;
  let match: RegExpExecArray | null;
  while ((match = enabledPattern.exec(text)) !== null) {
    // Try to expand to balanced braces
    const start = match.index;
    let depth = 0;
    let end = start;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end > start) {
      results.push(text.slice(start, end));
    }
  }
  return results;
}

function extractJsonToolCall(candidate: string, enabled: Set<RuntimeToolId>): RuntimeToolCall | undefined {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.tool !== "string" || !enabled.has(record.tool as RuntimeToolId)) {
      return undefined;
    }
    return {
      tool: record.tool as RuntimeToolId,
      args: record.args && typeof record.args === "object" && !Array.isArray(record.args)
        ? record.args as Record<string, unknown>
        : {},
    };
  } catch {
    return undefined;
  }
}

function extractTaggedToolCall(text: string, enabled: Set<RuntimeToolId>): RuntimeToolCall | undefined {
  if (!/DSML|parameter\s+name\s*=/i.test(text)) {
    return undefined;
  }

  const args: Record<string, unknown> = {};
  for (const match of text.matchAll(/parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)(?:<\/[^>]*parameter>|$)/gi)) {
    const name = match[1]?.trim();
    const value = match[2]?.replace(/<\|?\/?DSML\|?>/gi, "").trim();
    if (name && value) {
      args[name] = value;
    }
  }

  const explicitTool = Array.from(enabled).find((toolId) =>
    text.includes(toolId) || text.includes(toolId.replace(".", "__"))
  );
  if (explicitTool) {
    return { tool: explicitTool, args };
  }
  if (typeof args.url === "string" && enabled.has("web.fetch")) {
    return { tool: "web.fetch", args };
  }
  if (typeof args.query === "string" && enabled.has("web.search")) {
    return { tool: "web.search", args };
  }
  return undefined;
}

export class RuntimeToolExecutor {
  private readonly fetchImpl: typeof fetch;
  private readonly toolDescriptors: readonly ToolDescriptor[];
  private readonly skillRegistry?: SkillRegistryTools;
  private readonly modeRegistry?: ModeRegistryTools;
  private readonly selfIterationRegistry?: SelfIterationRegistryTools;
  private readonly automationRegistry?: AutomationRegistryTools;
  private readonly widgetRegistry?: WidgetRegistryTools;
  private readonly mcpConfigPaths?: string[];
  private readonly searchProvider: SearchProvider;
  private readonly packageManager?: PackageManager;
  private readonly limits: ResolvedToolLimits;
  private readonly taskIntent?: TaskIntent;
  private readonly permissionProfile?: PermissionProfile;
  private readonly definitions: Map<string, RuntimeToolDefinition<RuntimeToolExecutionContext>>;
  private readonly preToolPolicyHooks: RuntimePreToolPolicyHook[];
  private readonly postToolPolicyHooks: RuntimePostToolPolicyHook[];
  private readonly signal?: AbortSignal;
  private readonly turnContext?: Record<string, unknown>;
  private readonly workspaceOperations: WorkspaceOperations;
  private readonly computerBackendManager?: ComputerBackendManager;
  private spawnAgentCallback?: RuntimeToolExecutionContext["spawnAgent"];
  private waitForAgentsCallback?: RuntimeToolExecutionContext["waitForAgents"];
  private enqueueMessageCallback?: RuntimeToolExecutionContext["enqueueMessage"];

  constructor(options: RuntimeToolExecutorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.toolDescriptors = options.toolDescriptors ?? [];
    this.skillRegistry = options.skillRegistry;
    this.modeRegistry = options.modeRegistry;
    this.selfIterationRegistry = options.selfIterationRegistry;
    this.automationRegistry = options.automationRegistry;
    this.widgetRegistry = options.widgetRegistry;
    this.mcpConfigPaths = options.mcpConfigPaths;
    this.packageManager = options.packageManager;
    this.workspace = options.workspace;
    this.limits = resolveToolLimits(options.toolLimits);
    this.taskIntent = options.taskIntent;
    this.permissionProfile = options.permissionProfile;
    this.signal = options.signal;
    this.turnContext = options.turnContext;
    this.computerBackendManager = options.computerBackendManager;
    this.workspaceOperations = options.workspaceOperations ?? localWorkspaceOperations;
    this.searchProvider = options.searchProvider ?? createSearchProvider({
      fetchImpl: this.fetchImpl,
      env: options.searchEnv,
      config: options.searchProviderConfig,
      mcpClient: {
        callTool: (serverId, toolName, toolArgs) =>
          callRuntimeMcpTool(this.workspace, { server: serverId, name: toolName, arguments: toolArgs }, this.mcpConfigPaths, this.fetchImpl),
      },
    });
    this.definitions = buildRuntimeToolDefinitions(this.toolDescriptors, options.toolDefinitions ?? []);
    this.preToolPolicyHooks = [
      shellDestructiveCommandPolicyHook,
      permissionProfilePolicyHook,
      ...(options.preToolPolicyHooks ?? []),
    ];
    this.postToolPolicyHooks = options.postToolPolicyHooks ?? [];
  }

  private readonly workspace: unknown;

  setSpawnAgent(callback: RuntimeToolExecutionContext["spawnAgent"]): void {
    if (this.spawnAgentCallback) return;
    this.spawnAgentCallback = callback;
  }

  setWaitForAgents(callback: RuntimeToolExecutionContext["waitForAgents"]): void {
    if (this.waitForAgentsCallback) return;
    this.waitForAgentsCallback = callback;
  }

  setEnqueueMessage(callback: RuntimeToolExecutionContext["enqueueMessage"]): void {
    if (this.enqueueMessageCallback) return;
    this.enqueueMessageCallback = callback;
  }

  enabledToolIds(toolIds: readonly string[] = []): RuntimeToolId[] {
    return toolIds.filter((toolId): toolId is RuntimeToolId => {
      const definition = this.definitions.get(toolId);
      return (
        typeof definition?.execute === "function" &&
        isRuntimeToolImplemented(toolId) &&
        this.toolAvailableForTaskIntent(toolId)
      );
    });
  }

  private toolAvailableForTaskIntent(toolId: RuntimeToolId): boolean {
    return !(this.taskIntent === "plan" && toolId === "plan.update");
  }

  toolDefinitions(toolIds: readonly string[] = []): ModelToolDefinition[] {
    return this.enabledToolIds(toolIds).map((toolId) => {
      const definition = this.definitions.get(toolId);
      const descriptor = definition?.descriptor;
      return {
        id: toolId,
        description: descriptor?.description ?? toolId,
        parameters: toolParametersForApproval(definition, descriptor?.parameters),
      };
    });
  }

  systemPrompt(toolIds: readonly string[] = []): string | undefined {
    const rootPath = workspaceRootPath(this.workspace);
    const enabled = this.enabledToolIds(toolIds);
    if (enabled.length === 0) {
      return undefined;
    }

    const descriptions = enabled
      .map((toolId) => {
        const descriptor = this.definitions.get(toolId)?.descriptor;
        const label = descriptor ? `${descriptor.label}: ${descriptor.description}` : toolId;
        return `- ${toolId}: ${label}`;
      })
      .join("\n");

    const enabledDefinitions = enabled
      .map((toolId) => this.definitions.get(toolId))
      .filter((definition): definition is RuntimeToolDefinition<RuntimeToolExecutionContext> => Boolean(definition));
    const examples = enabledDefinitions
      .map((definition) => definition.promptExample)
      .filter((example): example is string => typeof example === "string" && example.trim().length > 0)
      .join("\n");
    const promptSnippets = [...new Set(enabled
      .flatMap((toolId) => {
        const definition = this.definitions.get(toolId);
        return [
          definition?.promptSnippet,
          ...(definition?.promptGuidelines ?? []),
        ];
      })
      .filter((snippet): snippet is string => typeof snippet === "string" && snippet.trim().length > 0))];
    return [
      "Workspace tool protocol:",
      "When a tool is needed, respond with EXACTLY a JSON code block containing the tool call — no markdown, no prose before or after.",
      "Correct format:\n```json\n{\"tool\":\"tool.id\",\"args\":{...}}\n```",
      "Incorrect: wrapping the JSON in explanations, greetings, or markdown outside the code block.",
      "Use the function calling / tool use protocol provided by the platform. Do not describe tool calls in prose — actually invoke them.",
      rootPath ? "Workspace file and shell tools are rooted inside the selected project folder." : "Workspace file and shell tools are unavailable unless a project folder is selected.",
      "If the user asks what tools you can use, answer from this available-tools list and the selected workspace context; do not claim you have no local tools when tools are listed here.",
      enabledDefinitions.some((definition) => definition.requiresApprovalCopy)
        ? "For tools that can change local files, run commands, install skills, toggle skills, or call external MCP tools, include args.approvalRequest with user-facing copy in the current conversation language. Explain what you will do, what will change, why it is needed, and the risk in plain language. Do not expose internal tool ids, policy ids, action ids, or agent ids in that copy."
        : undefined,
      "Available tools:",
      descriptions,
      promptSnippets.length > 0 ? ["Tool usage guidelines:", ...promptSnippets.map((snippet) => `- ${snippet}`)].join("\n") : undefined,
      "Examples:",
      examples,
      "After a tool result is returned, answer the user normally unless another tool call is required.",
    ].filter(Boolean).join("\n");
  }

  extractToolCall(text: string, toolIds: readonly string[] = []): RuntimeToolCall | undefined {
    return extractRuntimeToolCallFromText(text, this.enabledToolIds(toolIds));
  }

  riskLevel(call: RuntimeToolCall): ActionRiskLevel {
    const definition = this.definitions.get(call.tool);
    const context = this.executionContext();
    if (definition?.actionRiskLevel) {
      return definition.actionRiskLevel(call.args, context);
    }
    const descriptorRisk = definition?.riskLevel?.(call.args, context) ?? definition?.descriptor.riskLevel;
    return descriptorRisk === "requires_approval" ? "high" : "low";
  }

  approvalRequest(call: RuntimeToolCall, userPrompt?: string): ActionApprovalRequestCopy {
    const provided = parseProvidedApprovalRequest(call.args.approvalRequest);
    if (provided) {
      return provided;
    }
    return this.definitions.get(call.tool)?.approvalRequest?.(call.args, { toolId: call.tool, userPrompt })
      ?? genericApprovalRequest(userPrompt);
  }

  async execute(call: RuntimeToolCall, options: RuntimeToolExecutionOptions = {}): Promise<unknown> {
    return (await this.executeWithMetadata(call, options)).output;
  }

  async executeWithMetadata(call: RuntimeToolCall, options: RuntimeToolExecutionOptions = {}): Promise<RuntimeToolExecutionResult> {
    const effectiveSignal = mergeAbortSignals(this.signal, options.signal);
    if (effectiveSignal?.aborted) {
      throw new Error(`Tool '${call.tool}' execution cancelled: run was aborted.`);
    }
    const preflight = await this.runPreToolPolicy(call, options);
    if (preflight.permission === "deny") {
      throw new Error(preflight.reason ?? `Tool '${call.tool}' is denied by the active permission profile.`);
    }
    if (preflight.permission === "ask" && options.allowRisky !== true) {
      throw new ApprovalInterruptError(call.tool);
    }
    const effectiveCall: RuntimeToolCall = { ...call, args: preflight.args };
    const definition = this.definitions.get(effectiveCall.tool);
    try {
      if (!definition?.execute) {
        throw new Error(`Unsupported runtime tool: ${effectiveCall.tool}`);
      }
      const preparedArgs = definition.prepareArguments
        ? definition.prepareArguments(effectiveCall.args, this.executionContext(options))
        : effectiveCall.args;
      let result = toRuntimeToolExecutionResult(await definition.execute(preparedArgs, this.executionContext(options)));
      if (definition.resultPreview) {
        result = { ...result, resultPreview: definition.resultPreview(result, preparedArgs) };
      }
      return await this.runPostToolPolicy(effectiveCall, result, false, options);
    } catch (error) {
      await this.runPostToolPolicy(effectiveCall, undefined, true, options, error);
      throw error;
    }
  }

  private resolveDescriptorRiskLevel(call: RuntimeToolCall, descriptor: ToolDescriptor): ToolDescriptor["riskLevel"] {
    const definition = this.definitions.get(call.tool);
    return definition?.riskLevel?.(call.args, this.executionContext()) ?? descriptor.riskLevel;
  }

  private async runPreToolPolicy(
    call: RuntimeToolCall,
    options: RuntimeToolExecutionOptions,
  ): Promise<{ args: Record<string, unknown>; permission: ToolPermission; riskLevel: ToolDescriptor["riskLevel"]; reason?: string }> {
    const descriptor = this.definitions.get(call.tool)?.descriptor;
    if (!descriptor) {
      return {
        args: call.args,
        permission: this.permissionProfile ? "ask" : "allow",
        riskLevel: "requires_approval",
      };
    }
    const context = this.executionContext(options);
    let args = call.args;
    let riskLevel = this.resolveDescriptorRiskLevel(call, descriptor);
    let permission: ToolPermission | undefined;
    let reason: string | undefined;
    for (const hook of this.preToolPolicyHooks) {
      const result = await hook({
        toolId: call.tool,
        args,
        descriptor,
        context,
        riskLevel,
      });
      if (!result) {
        continue;
      }
      args = result.args ?? args;
      riskLevel = result.riskLevel ?? riskLevel;
      permission = result.permission ?? permission;
      reason = result.reason ?? reason;
    }
    return {
      args,
      permission: permission ?? "allow",
      riskLevel,
      reason,
    };
  }

  private async runPostToolPolicy(
    call: RuntimeToolCall,
    result: RuntimeToolExecutionResult | undefined,
    isError: boolean,
    options: RuntimeToolExecutionOptions,
    error?: unknown,
  ): Promise<RuntimeToolExecutionResult> {
    const descriptor = this.definitions.get(call.tool)?.descriptor;
    let nextResult = result;
    for (const hook of this.postToolPolicyHooks) {
      const hookResult = await hook({
        toolId: call.tool,
        args: call.args,
        descriptor,
        context: this.executionContext(options),
        result: nextResult,
        isError,
        error,
      });
      nextResult = hookResult?.result ?? nextResult;
    }
    if (!nextResult) {
      throw error instanceof Error ? error : new Error(String(error ?? "Tool execution failed."));
    }
    return nextResult;
  }

  private executionContext(options: RuntimeToolExecutionOptions = {}): RuntimeToolExecutionContext {
    return {
      currentAgentId: options.currentAgentId,
      currentNodeId: options.currentNodeId,
      workspace: this.workspace,
      fetchImpl: this.fetchImpl,
      skillRegistry: this.skillRegistry,
      modeRegistry: this.modeRegistry,
      selfIterationRegistry: this.selfIterationRegistry,
      automationRegistry: this.automationRegistry,
      widgetRegistry: this.widgetRegistry,
      mcpConfigPaths: this.mcpConfigPaths,
      searchProvider: this.searchProvider,
      packageManager: this.packageManager,
      limits: this.limits,
      taskIntent: this.taskIntent,
      permissionProfile: this.permissionProfile,
      allowRisky: options.allowRisky,
      signal: mergeAbortSignals(this.signal, options.signal),
      turnContext: this.turnContext,
      operations: this.workspaceOperations,
      spawnAgent: this.spawnAgentCallback,
      waitForAgents: this.waitForAgentsCallback,
      enqueueMessage: this.enqueueMessageCallback,
      computerBackendManager: this.computerBackendManager,
    };
  }
}

function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
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

const shellDestructiveCommandPolicyHook: RuntimePreToolPolicyHook = (request) => {
  if (request.toolId !== "shell.execute" || !shellCommandRequiresHighRisk(request.args)) {
    return undefined;
  }
  return {
    riskLevel: "requires_approval",
    reason: "shell.execute command matches a destructive-command safety pattern.",
  };
};

const permissionProfilePolicyHook: RuntimePreToolPolicyHook = (request) => {
  const profile = request.context.permissionProfile;
  if (!profile) {
    return { permission: "allow" };
  }
  return {
    permission: resolveToolPermission(profile, request.descriptor.category, request.riskLevel),
  };
};

function toRuntimeToolExecutionResult(value: unknown): RuntimeToolExecutionResult {
  if (isRecord(value) && "output" in value) {
    return value as unknown as RuntimeToolExecutionResult;
  }
  return { output: value };
}

function buildRuntimeToolDefinitions(
  descriptors: readonly ToolDescriptor[],
  dynamicDefinitions: readonly RuntimeToolDefinition<RuntimeToolExecutionContext>[],
): Map<string, RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  const definitions = new Map<string, RuntimeToolDefinition<RuntimeToolExecutionContext>>();
  for (const descriptor of descriptors) {
    definitions.set(descriptor.id, {
      descriptor,
      ...builtInToolRuntimeFields(descriptor.id),
    });
  }
  for (const definition of dynamicDefinitions) {
    const existing = definitions.get(definition.descriptor.id);
    const merged = {
      ...existing,
      ...definition,
      descriptor: definition.descriptor,
      execute: definition.execute ?? existing?.execute,
      riskLevel: definition.riskLevel ?? existing?.riskLevel,
    };
    definitions.set(definition.descriptor.id, merged);
    if (typeof merged.execute === "function") {
      registerImplementedToolId(definition.descriptor.id);
    }
  }
  return definitions;
}

function builtInToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  return {
    ...fileToolRuntimeFields(toolId),
    ...shellToolRuntimeFields(toolId),
    ...webDocumentToolRuntimeFields(toolId),
    ...clarificationToolRuntimeFields(toolId),
    ...skillToolRuntimeFields(toolId),
    ...mcpToolRuntimeFields(toolId),
    ...packageToolRuntimeFields(toolId),
    ...modeToolRuntimeFields(toolId),
    ...selfIterationToolRuntimeFields(toolId),
    ...automationToolRuntimeFields(toolId),
    ...widgetToolRuntimeFields(toolId),
    ...planToolRuntimeFields(toolId),
    ...agentSpawnToolRuntimeFields(toolId),
    ...agentWaitToolRuntimeFields(toolId),
    ...messageSendToolRuntimeFields(toolId),
    ...computerToolRuntimeFields(toolId),
  };
}

function messageSendToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  if (toolId !== "message.send") return {};
  return {
    promptSnippet: "Use message.send to continue work with a sub-agent that already has context loaded.",
    promptGuidelines: [
      "Continue agents whose work is relevant to the next task.",
      "Reference what the agent did previously in your message.",
      "Spawn fresh agents for completely unrelated tasks.",
    ],
    requiresApprovalCopy: false,
    riskLevel: () => "low_risk",
    execute(args, context) {
      const to = typeof args.to === "string" ? args.to.trim() : "";
      if (!to) {
        throw new Error("message.send requires a non-empty 'to' agent ID.");
      }
      const message = typeof args.message === "string" ? args.message.trim() : "";
      if (!message) {
        throw new Error("message.send requires a non-empty message string.");
      }
      if (!context.enqueueMessage) {
        throw new Error("message.send is not available in this runtime context.");
      }
      context.enqueueMessage({ to, message, invokingAgentId: context.currentAgentId });
      return { output: { status: "queued", to, messageLength: message.length } };
    },
  };
}

function agentSpawnToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  if (toolId !== "agent.spawn") return {};
  return {
    promptSnippet: "Use agent.spawn to delegate complex subtasks to a fresh sub-agent. The sub-agent gets its own context window and tool loop. Write self-contained prompts — the sub-agent cannot see your conversation.",
    promptGuidelines: [
      "Delegate only substantial, self-contained subtasks that benefit from a fresh context window.",
      "Write prompts that include all necessary context — file paths, line numbers, error messages.",
      "State what \"done\" looks like for the sub-agent.",
      "Prefer tool_bundle over raw tool_ids so the child gets a maintained, role-appropriate tool surface.",
      "Do not spawn agents for trivial lookups that a single tool call can handle.",
    ],
    requiresApprovalCopy: false,
    riskLevel: () => "low_risk",
    async execute(args, context) {
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt) {
        throw new Error("agent.spawn requires a non-empty prompt string.");
      }
      const description = typeof args.description === "string" && args.description.trim()
        ? args.description.trim()
        : "Sub-agent task";
      const agentType = typeof args.agent_type === "string" ? args.agent_type : undefined;
      const runInBackground = args.run_in_background === true;
      const inheritContext = args.inherit_context === true;
      const systemPrompt = typeof args.system_prompt === "string" ? args.system_prompt : undefined;
      const toolBundle = typeof args.tool_bundle === "string" ? args.tool_bundle as AgentToolBundleId : undefined;
      const toolIds = Array.isArray(args.tool_ids) ? args.tool_ids.filter((t: unknown) => typeof t === "string") as string[] : undefined;
      const resultContract = typeof args.result_contract === "string" ? args.result_contract as AgentResultContract : undefined;
      if (!context.spawnAgent) {
        throw new Error("agent.spawn is not available in this runtime context.");
      }
      const result = await context.spawnAgent({
        description, prompt, agentType, runInBackground, inheritContext, systemPrompt, toolBundle, toolIds, resultContract, invokingAgentId: context.currentAgentId,
      });
      return { output: result };
    },
  };
}

function agentWaitToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  if (toolId !== "agent.wait") return {};
  return {
    promptSnippet: "Use agent.wait to explicitly gather background sub-agent results before you synthesize your final answer.",
    promptGuidelines: [
      "Use agent.wait after fan-out when the parent should not conclude until child evidence arrives.",
      "Omit filters to wait on all active background children for the current parent agent.",
      "Prefer child_session_ids when you need to join a specific spawned session.",
    ],
    requiresApprovalCopy: false,
    riskLevel: () => "low_risk",
    async execute(args, context) {
      if (!context.waitForAgents) {
        throw new Error("agent.wait is not available in this runtime context.");
      }
      const agentIds = Array.isArray(args.agent_ids)
        ? args.agent_ids.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
        : undefined;
      const childSessionIds = Array.isArray(args.child_session_ids)
        ? args.child_session_ids.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
        : undefined;
      const requireAll = args.require_all !== false;
      const result = await context.waitForAgents({
        agentIds,
        childSessionIds,
        requireAll,
        invokingAgentId: context.currentAgentId,
      });
      return { output: result };
    },
  };
}

function toolParametersForApproval(
  definition: RuntimeToolDefinition<RuntimeToolExecutionContext> | undefined,
  parameters: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const base = parameters && Object.keys(parameters).length > 0
    ? parameters
    : {
        type: "object",
        properties: {},
        additionalProperties: true,
      };
  if (!definition?.requiresApprovalCopy) {
    return base;
  }

  const properties = isRecord(base.properties) ? base.properties : {};
  return {
    ...base,
    type: "object",
    properties: {
      ...properties,
      approvalRequest: {
        type: "object",
        description: "Plain-language approval copy shown to the user before this action runs.",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          whatWillChange: { type: "string" },
          whyNeeded: { type: "string" },
          riskNote: { type: "string" },
          confirmLabel: { type: "string" },
        },
        required: ["title", "summary"],
        additionalProperties: false,
      },
    },
    additionalProperties: true,
  };
}

function parseProvidedApprovalRequest(value: unknown): ActionApprovalRequestCopy | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const parsed = ActionApprovalRequestCopySchema.safeParse(trimApprovalRequest(value));
  return parsed.success ? parsed.data : undefined;
}

function trimApprovalRequest(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ["title", "summary", "whatWillChange", "whyNeeded", "riskNote", "confirmLabel"]) {
    const entry = value[key];
    if (typeof entry === "string" && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}
