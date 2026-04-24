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
  type SkillGetParams,
  type SkillRegistry,
  type SkillListParams,
  type SkillSetEnabledParams,
  type SkillUpdateParams,
  type ToolDescriptor,
  type ToolRegistry,
} from "@ora/shared";
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

function defaultCustomSkillsRoot(): string {
  return path.join(repoRoot(), ".ora", "skills", "custom");
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
        customRootDir: options.customRootDir ?? defaultCustomSkillsRoot(),
        publicRootDir: options.publicRootDir ?? publicSkillsRoot(),
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

  create(params: SkillCreateParams | unknown): SkillDetail {
    return this.store.create(params);
  }

  update(params: SkillUpdateParams | unknown): SkillDetail {
    return this.store.update(params);
  }

  delete(params: SkillDeleteParams | unknown): { deleted: true; name: string } {
    return this.store.delete(params);
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
