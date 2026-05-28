import fs from "node:fs";
import path from "node:path";
import {
  MVP_SKILLS,
  MVP_TOOLS,
  SkillRegistrySchema,
  ToolRegistrySchema,
  type CoordinationPattern,
  type SkillDescriptor,
  type SkillDetail,
  type SkillCheckNameResult,
  type SkillCreateParams,
  type SkillDeleteParams,
  type SkillFileDeleteParams,
  type SkillFileGetParams,
  type SkillFileUpsertParams,
  type SkillGetParams,
  type SkillPackageFileContent,
  type SkillRegistry,
  type SkillListParams,
  type SkillSetEnabledParams,
  type SkillUpdateParams,
  type ActionApprovalRequestCopy,
  type ActionRiskLevel,
  normalizeToolDescriptor,
  type ToolDescriptor,
  type ToolDescriptorInput,
  type ToolRegistry,
} from "@cemeworm/shared";
import { SkillFileStore, type SkillFileStoreOptions, type SkillStateRestoreSnapshot } from "../skills.js";
import { SkillCurator, DEFAULT_CURATOR_CONFIG, type SkillCuratorConfig } from "../skill-curator.js";

export interface RuntimeToolResultPreview {
  kind: string;
  summary: string;
  detail?: Record<string, unknown>;
  preview?: unknown;
}

export interface RuntimeToolContinuationHandler<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
> {
  canReplay(toolId: string, args: TArgs): boolean;
  shouldContinueKernelAfterTool(result: unknown): boolean;
}

export interface RuntimeToolDefinition<
  TContext = unknown,
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
> {
  descriptor: ToolDescriptor;
  promptSnippet?: string;
  promptGuidelines?: string[];
  promptExample?: string;
  requiresApprovalCopy?: boolean;
  actionRiskLevel?: (args: TArgs, context: TContext) => ActionRiskLevel;
  approvalRequest?: (args: TArgs, context: { toolId: string; userPrompt?: string }) => ActionApprovalRequestCopy;
  riskLevel?: (args: TArgs, context: TContext) => ToolDescriptor["riskLevel"];
  execute?: (args: TArgs, context: TContext) => TResult | Promise<TResult>;
  resultPreview?: (result: TResult, args: TArgs) => RuntimeToolResultPreview;
  prepareArguments?: (input: TArgs, context: TContext) => TArgs;
  continuationHandler?: RuntimeToolContinuationHandler<TArgs>;
}

type RuntimeToolDefinitionInput<
  TContext = unknown,
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
> = Omit<RuntimeToolDefinition<TContext, TArgs, TResult>, "descriptor"> & {
  descriptor: ToolDescriptorInput | ToolDescriptor;
};

function repoRoot(): string {
  let current = path.resolve(process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(process.cwd());
    }
    current = parent;
  }
}

function publicSkillsRoot(): string {
  return path.join(repoRoot(), "skills");
}

function defaultPrivateSkillsRoot(): string {
  return path.join(repoRoot(), ".ora", "skills", "private");
}

function defaultPublicSkillsRoot(): string {
  return path.join(repoRoot(), ".ora", "skills", "public");
}

export class RuntimeToolRegistry {
  private readonly definitions = new Map<string, RuntimeToolDefinition>();
  private activeToolIds: string[] | undefined;

  constructor(definitions: Iterable<ToolDescriptorInput | RuntimeToolDefinitionInput> = MVP_TOOLS) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register(definition: ToolDescriptorInput | RuntimeToolDefinitionInput): void {
    const runtimeDefinition: RuntimeToolDefinition = "descriptor" in definition
      ? { ...definition, descriptor: normalizeToolDescriptor(definition.descriptor) }
      : { descriptor: normalizeToolDescriptor(definition) };
    this.definitions.set(runtimeDefinition.descriptor.id, runtimeDefinition);
  }

  unregister(toolId: string): boolean {
    this.activeToolIds = this.activeToolIds?.filter((id) => id !== toolId);
    return this.definitions.delete(toolId);
  }

  get(toolId: string): ToolDescriptor | undefined {
    return this.getDefinition(toolId)?.descriptor;
  }

  getDefinition(toolId: string): RuntimeToolDefinition | undefined {
    return this.definitions.get(toolId);
  }

  list(): ToolDescriptor[] {
    return this.listDefinitions().map((definition) => definition.descriptor);
  }

  listDefinitions(): RuntimeToolDefinition[] {
    return Array.from(this.definitions.values());
  }

  setActiveTools(toolIds: readonly string[]): void {
    this.activeToolIds = [...new Set(toolIds)].filter((toolId) => this.definitions.has(toolId));
  }

  getActiveToolIds(): string[] {
    return this.activeToolIds ?? this.list().map((tool) => tool.id);
  }

  listActiveDefinitions(): RuntimeToolDefinition[] {
    const activeIds = new Set(this.getActiveToolIds());
    return this.listDefinitions().filter((definition) => activeIds.has(definition.descriptor.id));
  }

  activeSnapshot(): ToolRegistry {
    return ToolRegistrySchema.parse({
      tools: this.listActiveDefinitions().map((definition) => definition.descriptor),
      defaultPolicyId: "runtime.default_policy",
    });
  }

  snapshot(): ToolRegistry {
    return ToolRegistrySchema.parse({
      tools: this.list(),
      defaultPolicyId: "runtime.default_policy",
    });
  }
}

export class RuntimeSkillRegistry {
  private readonly store: SkillFileStore;
  private readonly telemetryBuffer = new Map<string, { useCount: number; viewCount: number; patchCount: number; lastUsedAt: number }>();
  private readonly curatorConfig: SkillCuratorConfig;
  private runCountSinceLastCuratorEval = 0;
  private static readonly CURATOR_EVAL_INTERVAL = 10;

  constructor(options: Partial<SkillFileStoreOptions> | SkillFileStore = {}) {
    this.store = options instanceof SkillFileStore
      ? options
      : new SkillFileStore({
        privateRootDir: options.privateRootDir ?? options.customRootDir ?? defaultPrivateSkillsRoot(),
        publicRootDir: options.publicRootDir ?? defaultPublicSkillsRoot(),
        bundledPublicRootDir: options.bundledPublicRootDir ?? publicSkillsRoot(),
        clock: options.clock,
        bundledSkills: options.bundledSkills ?? MVP_SKILLS,
      });
    this.curatorConfig = { ...DEFAULT_CURATOR_CONFIG };
  }

  list(params?: SkillListParams | CoordinationPattern): SkillDescriptor[] {
    return this.store.list(params);
  }

  snapshot(params?: SkillListParams | CoordinationPattern): SkillRegistry {
    return SkillRegistrySchema.parse({
      skills: this.list(params),
    });
  }

  get(params: SkillGetParams | unknown): SkillDetail {
    return this.store.get(params);
  }

  getFile(params: SkillFileGetParams | unknown): SkillPackageFileContent {
    return this.store.getFile(params);
  }

  create(params: SkillCreateParams | unknown): SkillDetail {
    return this.store.create(params);
  }

  update(params: SkillUpdateParams | unknown): SkillDetail {
    return this.store.update(params);
  }

  upsertFile(params: SkillFileUpsertParams | unknown): SkillDetail {
    return this.store.upsertFile(params);
  }

  delete(params: SkillDeleteParams | unknown): { deleted: true; name: string } {
    return this.store.delete(params);
  }

  deleteFile(params: SkillFileDeleteParams | unknown): SkillDetail {
    return this.store.deleteFile(params);
  }

  checkName(params: unknown): SkillCheckNameResult {
    return this.store.checkName(params);
  }

  setEnabled(params: SkillSetEnabledParams | unknown): SkillDetail {
    return this.store.setEnabled(params);
  }

  patch(params: unknown): SkillDetail {
    return this.store.patchContent(params);
  }

  transitionLifecycle(name: string, lifecycle: "active" | "stale" | "archived", note?: string): void {
    this.store.transitionLifecycle(name, lifecycle, note);
  }

  restoreState(name: string, snapshot: SkillStateRestoreSnapshot) {
    return this.store.restoreState(name, snapshot);
  }

  recordTelemetry(name: string, event: "use" | "view" | "patch"): void {
    const existing = this.telemetryBuffer.get(name) ?? { useCount: 0, viewCount: 0, patchCount: 0, lastUsedAt: 0 };
    if (event === "use") existing.useCount++;
    if (event === "view") existing.viewCount++;
    if (event === "patch") existing.patchCount++;
    existing.lastUsedAt = Date.now();
    this.telemetryBuffer.set(name, existing);
  }

  flushTelemetry(): void {
    if (this.telemetryBuffer.size === 0) return;
    this.store.flushTelemetryBatch(this.telemetryBuffer);
    this.telemetryBuffer.clear();
  }

  evaluateCurator(): void {
    const curator = new SkillCurator({
      config: this.curatorConfig,
      applyTransition: (name, lifecycle) => {
        this.store.transitionLifecycle(name, lifecycle);
      },
    });
    const transitions = curator.evaluate(this.list());
    curator.applyTransitions(transitions);
  }

  evaluateCuratorIfDue(): void {
    this.runCountSinceLastCuratorEval++;
    if (this.runCountSinceLastCuratorEval >= RuntimeSkillRegistry.CURATOR_EVAL_INTERVAL) {
      this.runCountSinceLastCuratorEval = 0;
      this.evaluateCurator();
    }
  }

  promptSnippets(skillIds: string[]): string[] {
    if (skillIds.length === 0) {
      return [];
    }
    const wanted = new Set(skillIds);
    const matched = this.list().filter((skill) => skill.enabled && (wanted.has(skill.id) || wanted.has(skill.name)));
    for (const skill of matched) {
      this.recordTelemetry(skill.name, "use");
    }
    return this.store.promptSnippets(skillIds);
  }

  warnings(skillIds: string[]): string[] {
    return this.store.warnings(skillIds);
  }
}

export function loadRuntimeSkills(): SkillDescriptor[] {
  return new RuntimeSkillRegistry().list();
}
