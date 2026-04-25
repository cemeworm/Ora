import fs from "node:fs";
import path from "node:path";
import {
  SkillCheckNameParamsSchema,
  SkillCheckNameResultSchema,
  SkillCreateParamsSchema,
  SkillDeleteParamsSchema,
  SkillDescriptorSchema,
  SkillDetailSchema,
  SkillGetParamsSchema,
  SkillListParamsSchema,
  SkillNameSchema,
  SkillSetEnabledParamsSchema,
  SkillUpdateParamsSchema,
  type CoordinationPattern,
  type SkillCheckNameResult,
  type SkillCreateParams,
  type SkillDeleteParams,
  type SkillDescriptor,
  type SkillDetail,
  type SkillGetParams,
  type SkillListParams,
  type SkillSetEnabledParams,
  type SkillUpdateParams,
} from "@ora/shared";

interface ParsedSkillFile {
  name: string;
  description: string;
  license?: string;
}

interface PersistedSkillState {
  enabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

const SKILL_FILE_NAME = "SKILL.md";

export interface SkillFileStoreOptions {
  customRootDir: string;
  publicRootDir?: string;
  clock?: () => number;
  bundledSkills?: readonly SkillDescriptor[];
}

export class SkillFileStore {
  private readonly customRootDir: string;
  private readonly publicRootDir: string;
  private readonly statePath: string;
  private readonly clock: () => number;
  private readonly bundledSkills: readonly SkillDescriptor[];

  constructor(options: SkillFileStoreOptions) {
    this.customRootDir = options.customRootDir;
    this.publicRootDir = options.publicRootDir ?? path.join(process.cwd(), "skills");
    this.statePath = path.join(this.customRootDir, "..", "state.json");
    this.clock = options.clock ?? Date.now;
    this.bundledSkills = options.bundledSkills ?? [];
  }

  list(params: SkillListParams | CoordinationPattern | undefined = {}): SkillDescriptor[] {
    const parsed = typeof params === "string"
      ? SkillListParamsSchema.parse({ pattern: params })
      : SkillListParamsSchema.parse(params ?? {});
    const query = parsed.query?.trim().toLowerCase();

    return this.readAllSkills()
      .filter((skill) => !parsed.category || skill.category === parsed.category)
      .filter((skill) => !parsed.enabledOnly || skill.enabled)
      .filter((skill) => !parsed.pattern || skill.allowedPatterns.length === 0 || skill.allowedPatterns.includes(parsed.pattern))
      .filter((skill) => {
        if (!query) {
          return true;
        }
        return [
          skill.name,
          skill.description,
          skill.path ?? "",
          ...skill.tags,
        ].some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  get(params: SkillGetParams | unknown): SkillDetail {
    const parsed = SkillGetParamsSchema.parse(params);
    const skill = this.readAllSkillDetails().find((candidate) => candidate.name === parsed.name || candidate.id === parsed.name);
    if (!skill) {
      throw new Error(`Skill '${parsed.name}' not found.`);
    }
    return skill;
  }

  create(params: SkillCreateParams | unknown): SkillDetail {
    const parsed = SkillCreateParamsSchema.parse(params);
    const name = normalizeSkillName(parsed.name);
    if (this.findAnySkill(name)) {
      throw new Error(`Skill '${name}' already exists.`);
    }

    const content = parsed.content ?? defaultSkillContent(name, parsed.description);
    validateSkillContent(name, content);
    const now = this.clock();
    this.writeCustomSkill(name, content);
    this.updateState(name, { enabled: parsed.enabled, createdAt: now, updatedAt: now });
    return this.get({ name });
  }

  update(params: SkillUpdateParams | unknown): SkillDetail {
    const parsed = SkillUpdateParamsSchema.parse(params);
    const name = normalizeSkillName(parsed.name);
    const existing = this.get({ name });
    if (!existing.editable || existing.category !== "custom") {
      throw new Error(`Skill '${name}' is built in and cannot be edited.`);
    }

    validateSkillContent(name, parsed.content);
    this.writeCustomSkill(name, parsed.content);
    this.updateState(name, { updatedAt: this.clock() });
    return this.get({ name });
  }

  delete(params: SkillDeleteParams | unknown): { deleted: true; name: string } {
    const parsed = SkillDeleteParamsSchema.parse(params);
    const name = normalizeSkillName(parsed.name);
    const existing = this.get({ name });
    if (!existing.editable || existing.category !== "custom") {
      throw new Error(`Skill '${name}' is built in and cannot be deleted.`);
    }

    fs.rmSync(this.customSkillDir(name), { recursive: true, force: true });
    this.removeState(name);
    return { deleted: true, name };
  }

  checkName(params: unknown): SkillCheckNameResult {
    const parsed = SkillCheckNameParamsSchema.parse(params);
    const name = normalizeSkillName(parsed.name);
    return SkillCheckNameResultSchema.parse({
      available: !this.findAnySkill(name),
      name,
    });
  }

  setEnabled(params: SkillSetEnabledParams | unknown): SkillDetail {
    const parsed = SkillSetEnabledParamsSchema.parse(params);
    const name = normalizeSkillName(parsed.name);
    this.get({ name });
    this.updateState(name, { enabled: parsed.enabled, updatedAt: this.clock() });
    return this.get({ name });
  }

  promptSnippets(skillIds: string[]): string[] {
    if (skillIds.length === 0) {
      return [];
    }
    const wanted = new Set(skillIds);
    return this.readAllSkillDetails()
      .filter((skill) => skill.enabled && (wanted.has(skill.id) || wanted.has(skill.name)))
      .map((skill) => stripFrontmatter(skill.content).trim() || skill.description)
      .filter((snippet) => snippet.length > 0);
  }

  warnings(skillIds: string[]): string[] {
    if (skillIds.length === 0) {
      return [];
    }
    const byId = new Map(this.readAllSkillDetails().flatMap((skill) => [[skill.id, skill], [skill.name, skill]]));
    return skillIds.flatMap((skillId) => {
      const skill = byId.get(skillId);
      if (!skill) {
        return [`Skill '${skillId}' was requested but is not installed.`];
      }
      if (!skill.enabled) {
        return [`Skill '${skillId}' was requested but is disabled.`];
      }
      return [];
    });
  }

  private readAllSkills(): SkillDescriptor[] {
    return this.readAllSkillDetails().map(({ content: _content, ...descriptor }) => SkillDescriptorSchema.parse(descriptor));
  }

  private readAllSkillDetails(): SkillDetail[] {
    const state = this.readState();
    const merged = new Map<string, SkillDetail>();

    for (const skill of this.bundledSkills) {
      const id = toSkillId(skill.id || skill.name);
      const record = state[id] ?? {};
      merged.set(id, SkillDetailSchema.parse({
        ...skill,
        id,
        name: skill.name,
        category: "public",
        enabled: record.enabled ?? skill.enabled ?? true,
        editable: false,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        content: skill.promptSnippet ?? skill.description,
      }));
    }

    for (const detail of this.scanSkillRoot(this.publicRootDir, "public", state)) {
      merged.set(detail.id, detail);
    }
    for (const detail of this.scanSkillRoot(this.customRootDir, "custom", state)) {
      merged.set(detail.id, detail);
    }

    return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  private scanSkillRoot(rootDir: string, category: "public" | "custom", state: Record<string, PersistedSkillState>): SkillDetail[] {
    if (!fs.existsSync(rootDir)) {
      return [];
    }

    const skills: SkillDetail[] = [];
    const stack = [rootDir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.name.startsWith(".")) {
          continue;
        }
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile() || entry.name !== SKILL_FILE_NAME) {
          continue;
        }

        const content = fs.readFileSync(fullPath, "utf8");
        const metadata = parseSkillFile(content);
        if (!metadata) {
          continue;
        }
        const id = toSkillId(metadata.name);
        const stat = fs.statSync(fullPath);
        const record = state[id] ?? {};
        skills.push(SkillDetailSchema.parse({
          id,
          name: metadata.name,
          description: metadata.description,
          license: metadata.license,
          promptSnippet: metadata.description,
          path: path.relative(process.cwd(), fullPath),
          category,
          enabled: record.enabled ?? true,
          editable: category === "custom",
          createdAt: record.createdAt ?? Math.floor(stat.birthtimeMs),
          updatedAt: record.updatedAt ?? Math.floor(stat.mtimeMs),
          allowedPatterns: [],
          tags: [],
          content,
        }));
      }
    }

    return skills;
  }

  private readState(): Record<string, PersistedSkillState> {
    try {
      if (!fs.existsSync(this.statePath)) {
        return {};
      }
      const decoded = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      return decoded && typeof decoded === "object" && !Array.isArray(decoded)
        ? decoded as Record<string, PersistedSkillState>
        : {};
    } catch {
      return {};
    }
  }

  private writeState(state: Record<string, PersistedSkillState>) {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private updateState(name: string, patch: PersistedSkillState) {
    const id = toSkillId(name);
    const state = this.readState();
    state[id] = {
      ...state[id],
      ...patch,
    };
    this.writeState(state);
  }

  private removeState(name: string) {
    const state = this.readState();
    delete state[toSkillId(name)];
    this.writeState(state);
  }

  private writeCustomSkill(name: string, content: string) {
    const target = this.customSkillFile(name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  }

  private findAnySkill(name: string): SkillDetail | undefined {
    const id = toSkillId(name);
    return this.readAllSkillDetails().find((skill) => skill.id === id || skill.name === name);
  }

  private customSkillDir(name: string): string {
    return path.join(this.customRootDir, normalizeSkillName(name));
  }

  private customSkillFile(name: string): string {
    return path.join(this.customSkillDir(name), SKILL_FILE_NAME);
  }
}

export function validateSkillContent(expectedName: string, content: string): ParsedSkillFile {
  const metadata = parseSkillFile(content);
  if (!metadata) {
    throw new Error("Skill content must start with YAML frontmatter containing name and description.");
  }
  if (metadata.name !== expectedName) {
    throw new Error(`Frontmatter name '${metadata.name}' must match requested skill name '${expectedName}'.`);
  }
  normalizeSkillName(metadata.name);
  return metadata;
}

function parseSkillFile(content: string): ParsedSkillFile | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return undefined;
  }
  const frontmatter = parseFrontmatter(match[1] ?? "");
  const name = frontmatter.name?.trim();
  const description = frontmatter.description?.trim();
  if (!name || !description) {
    return undefined;
  }
  return {
    name,
    description,
    license: frontmatter.license?.trim() || undefined,
  };
}

function parseFrontmatter(value: string): Record<string, string> {
  const record: Record<string, string> = {};
  const lines = value.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1]!;
    const rawValue = match[2] ?? "";
    if (/^[>|][+-]?$/.test(rawValue.trim())) {
      const parts: string[] = [];
      while (index + 1 < lines.length && (/^\s+/.test(lines[index + 1]!) || lines[index + 1] === "")) {
        index += 1;
        parts.push(lines[index]!.trim());
      }
      record[key] = rawValue.trim().startsWith("|") ? parts.join("\n").trim() : parts.join(" ").trim();
      continue;
    }
    record[key] = stripQuotes(rawValue);
  }
  return record;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/^["']|["']$/g, "");
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
}

function defaultSkillContent(name: string, description: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description.trim() || "Describe what this skill helps the agent do."}`,
    "---",
    "",
    `# ${name}`,
    "",
    description.trim() || "Describe the workflow, rules, and examples for this skill.",
    "",
  ].join("\n");
}

function normalizeSkillName(name: string): string {
  return SkillNameSchema.parse(name.trim().toLowerCase());
}

function toSkillId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
