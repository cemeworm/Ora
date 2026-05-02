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
  type ToolDescriptor,
  type ToolRegistry,
} from "@cemeworm/shared";
import { SkillFileStore, type SkillFileStoreOptions } from "../skills.js";

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
  constructor(private readonly tools: readonly ToolDescriptor[] = MVP_TOOLS) {}

  list(): ToolDescriptor[] {
    return ToolRegistrySchema.parse({
      tools: [...this.tools],
      defaultPolicyId: "runtime.default_policy",
    }).tools;
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

  promptSnippets(skillIds: string[]): string[] {
    return this.store.promptSnippets(skillIds);
  }

  warnings(skillIds: string[]): string[] {
    return this.store.warnings(skillIds);
  }
}

export function loadRuntimeSkills(): SkillDescriptor[] {
  return new RuntimeSkillRegistry().list();
}
