import fs from "node:fs";
import path from "node:path";
import {
  SkillCheckNameParamsSchema,
  SkillCheckNameResultSchema,
  SkillCreateParamsSchema,
  SkillDeleteParamsSchema,
  SkillDescriptorSchema,
  SkillDetailSchema,
  SkillFileDeleteParamsSchema,
  SkillFileGetParamsSchema,
  SkillFileUpsertParamsSchema,
  SkillGetParamsSchema,
  SkillListParamsSchema,
  SkillNameSchema,
  SkillPackageFileContentSchema,
  SkillPackageFileDescriptorSchema,
  SkillPatchParamsSchema,
  SkillSetEnabledParamsSchema,
  SkillUpdateParamsSchema,
  type CoordinationPattern,
  type SkillCheckNameResult,
  type SkillCreateParams,
  type SkillDeleteParams,
  type SkillDescriptor,
  type SkillDetail,
  type SkillFileDeleteParams,
  type SkillFileGetParams,
  type SkillFileUpsertParams,
  type SkillGetParams,
  type SkillListParams,
  type SkillPackageFileContent,
  type SkillPackageFileDescriptor,
  type SkillPatchParams,
  type SkillSetEnabledParams,
  type SkillUpdateParams,
} from "@cemeworm/shared";

interface ParsedSkillFile {
  name: string;
  description: string;
  license?: string;
}

interface PersistedSkillState {
  enabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
  deleted?: boolean;
  provenance?: "foreground" | "background_auto";
  lifecycle?: "active" | "stale" | "archived";
  useCount?: number;
  lastUsedAt?: number;
  viewCount?: number;
  patchCount?: number;
  autoCreateTrigger?: string;
}

const SKILL_FILE_NAME = "SKILL.md";

interface SupportingSkillFile {
  path: string;
  content: string;
  executable?: boolean;
}

export interface SkillFileStoreOptions {
  privateRootDir?: string;
  customRootDir?: string;
  legacyCustomRootDir?: string;
  publicRootDir?: string;
  bundledPublicRootDir?: string;
  clock?: () => number;
  bundledSkills?: readonly SkillDescriptor[];
}

export class SkillFileStore {
  private readonly privateRootDir: string;
  private readonly legacyCustomRootDir: string;
  private readonly publicRootDir: string;
  private readonly bundledPublicRootDir: string;
  private readonly statePath: string;
  private readonly clock: () => number;
  private readonly bundledSkills: readonly SkillDescriptor[];

  constructor(options: SkillFileStoreOptions) {
    this.privateRootDir = options.privateRootDir ?? options.customRootDir ?? path.join(process.cwd(), ".ora", "skills", "private");
    this.legacyCustomRootDir = options.legacyCustomRootDir ?? path.join(path.dirname(this.privateRootDir), "custom");
    this.publicRootDir = options.publicRootDir ?? path.join(path.dirname(this.privateRootDir), "public");
    this.bundledPublicRootDir = options.bundledPublicRootDir ?? path.join(process.cwd(), "skills");
    this.statePath = path.join(this.privateRootDir, "..", "state.json");
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
      .filter((skill) => !parsed.lifecycle || skill.lifecycle === parsed.lifecycle)
      .filter((skill) => !parsed.provenance || skill.provenance === parsed.provenance)
      .filter((skill) => parsed.lifecycle !== undefined || skill.lifecycle !== "archived")
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
    this.writeSkillPackage(this.privateSkillDir(name), content, parsed.files, true);
    this.updateState(name, {
      enabled: parsed.enabled,
      createdAt: now,
      deleted: false,
      updatedAt: now,
      provenance: parsed.provenance,
      autoCreateTrigger: parsed.autoCreateTrigger,
    });
    return this.get({ name });
  }

  update(params: SkillUpdateParams | unknown): SkillDetail {
    const parsed = SkillUpdateParamsSchema.parse(params);
    const name = normalizeSkillName(parsed.name);
    const nextName = normalizeSkillName(parsed.nextName ?? parsed.name);
    const existing = this.get({ name });
    if (!existing.editable) {
      throw new Error(`Skill '${name}' cannot be edited.`);
    }

    if (nextName !== name && this.findAnySkill(nextName)) {
      throw new Error(`Skill '${nextName}' already exists.`);
    }

    validateSkillContent(nextName, parsed.content);
    const targetDir = existing.category === "public"
      ? this.publicSkillDir(nextName)
      : this.privateSkillDir(nextName);
    this.prepareEditablePackage(existing, name, nextName, targetDir);
    this.writeSkillPackage(targetDir, parsed.content, parsed.files, parsed.files !== undefined);
    const now = this.clock();
    if (nextName !== name) {
      if (existing.category === "public") {
        fs.rmSync(this.publicSkillDir(name), { recursive: true, force: true });
        this.updateState(name, { deleted: true, enabled: false, updatedAt: now });
      } else {
        fs.rmSync(this.privateSkillDir(name), { recursive: true, force: true });
        fs.rmSync(this.legacyCustomSkillDir(name), { recursive: true, force: true });
        this.removeState(name);
      }
      this.updateState(nextName, {
        enabled: existing.enabled,
        createdAt: existing.createdAt,
        deleted: false,
        updatedAt: now,
      });
      return this.get({ name: nextName });
    }
    this.updateState(name, { deleted: false, updatedAt: now });
    return this.get({ name });
  }

  delete(params: SkillDeleteParams | unknown): { deleted: true; name: string } {
    const parsed = SkillDeleteParamsSchema.parse(params);
    const name = normalizeSkillName(parsed.name);
    const existing = this.get({ name });
    if (!existing.editable) {
      throw new Error(`Skill '${name}' cannot be deleted.`);
    }

    if (existing.category === "public") {
      fs.rmSync(this.publicSkillDir(name), { recursive: true, force: true });
      this.updateState(name, { deleted: true, enabled: false, updatedAt: this.clock() });
      return { deleted: true, name };
    }

    fs.rmSync(this.privateSkillDir(name), { recursive: true, force: true });
    fs.rmSync(this.legacyCustomSkillDir(name), { recursive: true, force: true });
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

  patchContent(params: SkillPatchParams | unknown): SkillDetail {
    const parsed = SkillPatchParamsSchema.parse(params);
    const name = normalizeSkillName(parsed.name);
    const existing = this.get({ name });
    if (!existing.editable) {
      throw new Error(`Skill '${name}' cannot be edited.`);
    }

    const { oldContent, newContent } = parsed;
    const content = existing.content;

    // Layer 1: exact match
    let newFileContent: string | undefined;
    if (content.includes(oldContent)) {
      newFileContent = content.replace(oldContent, newContent);
    } else {
      // Layer 2: whitespace-normalized match
      const normalizeWs = (s: string) => s.replace(/\s+/g, " ").trim();
      const normalizedContent = normalizeWs(content);
      const normalizedOld = normalizeWs(oldContent);
      const idx = normalizedContent.indexOf(normalizedOld);
      if (idx >= 0) {
        // Map back to original content positions
        newFileContent = fuzzyReplace(content, oldContent, newContent);
      }
    }

    if (newFileContent === undefined) {
      const preview = content.slice(0, 500);
      throw new Error(
        `Could not find oldContent in skill '${name}'. Content preview:\n${preview}`,
      );
    }

    validateSkillContent(name, newFileContent);
    const packageDir = this.skillPackageDir(existing) ?? this.privateSkillDir(name);
    this.writeSkillPackage(packageDir, newFileContent, undefined, false);
    this.updateState(name, { deleted: false, updatedAt: this.clock() });
    return this.get({ name });
  }

  transitionLifecycle(name: string, lifecycle: "active" | "stale" | "archived"): void {
    const id = toSkillId(name);
    const state = this.readState();
    const current = state[id]?.lifecycle ?? "active";
    const order: readonly string[] = ["active", "stale", "archived"];
    const fromIdx = order.indexOf(current);
    const toIdx = order.indexOf(lifecycle);
    if (toIdx < fromIdx) {
      throw new Error(`Invalid lifecycle transition: ${current} → ${lifecycle}. Only forward transitions are allowed.`);
    }
    this.updateState(name, { lifecycle });
  }

  flushTelemetryBatch(batch: ReadonlyMap<string, { useCount?: number; viewCount?: number; patchCount?: number; lastUsedAt?: number }>): void {
    if (batch.size === 0) return;
    const state = this.readState();
    for (const [skillId, delta] of batch) {
      const id = toSkillId(skillId);
      const existing = state[id] ?? {};
      state[id] = {
        ...existing,
        useCount: (existing.useCount ?? 0) + (delta.useCount ?? 0),
        viewCount: (existing.viewCount ?? 0) + (delta.viewCount ?? 0),
        patchCount: (existing.patchCount ?? 0) + (delta.patchCount ?? 0),
        lastUsedAt: delta.lastUsedAt ?? existing.lastUsedAt,
      };
    }
    this.writeState(state);
  }

  getFile(params: SkillFileGetParams | unknown): SkillPackageFileContent {
    const parsed = SkillFileGetParamsSchema.parse(params);
    const skill = this.get({ name: parsed.skillName });
    const packageDir = this.requireSkillPackageDir(skill);
    const relativePath = normalizePackageFilePath(parsed.path);
    const target = path.join(packageDir, relativePath);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`Skill file '${relativePath}' was not found in '${skill.name}'.`);
    }

    const content = fs.readFileSync(target).toString("utf8");
    if (content.includes("\uFFFD")) {
      throw new Error(`Skill file '${relativePath}' is not editable as UTF-8 text.`);
    }

    return SkillPackageFileContentSchema.parse({
      skillName: skill.name,
      content,
      ...this.packageFileDescriptor(packageDir, relativePath),
    });
  }

  upsertFile(params: SkillFileUpsertParams | unknown): SkillDetail {
    const parsed = SkillFileUpsertParamsSchema.parse(params);
    const name = normalizeSkillName(parsed.skillName);
    const existing = this.get({ name });
    if (!existing.editable) {
      throw new Error(`Skill '${name}' cannot be edited.`);
    }

    const targetDir = existing.category === "public"
      ? this.publicSkillDir(name)
      : this.privateSkillDir(name);
    this.prepareEditablePackage(existing, name, name, targetDir);
    this.writeSupportingFile(targetDir, {
      path: parsed.path,
      content: parsed.content,
      executable: parsed.executable,
    });
    this.updateState(name, { deleted: false, updatedAt: this.clock() });
    return this.get({ name });
  }

  deleteFile(params: SkillFileDeleteParams | unknown): SkillDetail {
    const parsed = SkillFileDeleteParamsSchema.parse(params);
    const name = normalizeSkillName(parsed.skillName);
    const existing = this.get({ name });
    if (!existing.editable) {
      throw new Error(`Skill '${name}' cannot be edited.`);
    }

    const targetDir = existing.category === "public"
      ? this.publicSkillDir(name)
      : this.privateSkillDir(name);
    this.prepareEditablePackage(existing, name, name, targetDir);
    const relativePath = normalizePackageFilePath(parsed.path);
    const target = path.join(targetDir, relativePath);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`Skill file '${relativePath}' was not found in '${existing.name}'.`);
    }
    fs.rmSync(target, { force: true });
    this.removeEmptyDirectories(targetDir, targetDir);
    this.updateState(name, { deleted: false, updatedAt: this.clock() });
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
      if (record.deleted) {
        continue;
      }
      merged.set(id, SkillDetailSchema.parse({
        ...skill,
        id,
        name: skill.name,
        category: "public",
        enabled: record.enabled ?? skill.enabled ?? true,
        editable: true,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        content: defaultSkillContent(skill.name, skill.promptSnippet ?? skill.description),
        provenance: record.provenance ?? "foreground",
        lifecycle: record.lifecycle ?? "active",
        telemetry: (record.useCount || record.viewCount || record.patchCount || record.lastUsedAt)
          ? { useCount: record.useCount ?? 0, viewCount: record.viewCount ?? 0, patchCount: record.patchCount ?? 0, lastUsedAt: record.lastUsedAt }
          : undefined,
      }));
    }

    for (const detail of this.scanSkillRoot(this.bundledPublicRootDir, "public", state)) {
      merged.set(detail.id, detail);
    }
    for (const detail of this.scanSkillRoot(this.publicRootDir, "public", state)) {
      merged.set(detail.id, detail);
    }
    for (const detail of this.scanSkillRoot(this.legacyCustomRootDir, "private", state)) {
      merged.set(detail.id, detail);
    }
    for (const detail of this.scanSkillRoot(this.privateRootDir, "private", state)) {
      merged.set(detail.id, detail);
    }

    return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  private scanSkillRoot(rootDir: string, category: "public" | "private", state: Record<string, PersistedSkillState>): SkillDetail[] {
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
        if (record.deleted) {
          continue;
        }
        skills.push(SkillDetailSchema.parse({
          id,
          name: metadata.name,
          description: metadata.description,
          license: metadata.license,
          promptSnippet: metadata.description,
          path: path.relative(process.cwd(), fullPath),
          category,
          enabled: record.enabled ?? true,
          editable: true,
          createdAt: record.createdAt ?? Math.floor(stat.birthtimeMs),
          updatedAt: record.updatedAt ?? Math.floor(stat.mtimeMs),
          allowedPatterns: [],
          tags: [],
          files: this.listPackageFiles(path.dirname(fullPath)),
          content,
          provenance: record.provenance ?? "foreground",
          lifecycle: record.lifecycle ?? "active",
          telemetry: (record.useCount || record.viewCount || record.patchCount || record.lastUsedAt)
            ? { useCount: record.useCount ?? 0, viewCount: record.viewCount ?? 0, patchCount: record.patchCount ?? 0, lastUsedAt: record.lastUsedAt }
            : undefined,
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

  private writeSkillPackage(
    packageDir: string,
    content: string,
    files: readonly SupportingSkillFile[] | undefined,
    replaceSupportingFiles: boolean,
  ) {
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, SKILL_FILE_NAME), content.endsWith("\n") ? content : `${content}\n`, "utf8");
    if (replaceSupportingFiles) {
      this.removeSupportingFiles(packageDir);
    }
    if (files) {
      for (const file of files) {
        this.writeSupportingFile(packageDir, file);
      }
    }
  }

  private prepareEditablePackage(existing: SkillDetail, name: string, nextName: string, targetDir: string) {
    const sourceDir = this.skillPackageDir(existing);
    if (nextName !== name) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      if (sourceDir && fs.existsSync(sourceDir)) {
        this.copyPackageFiles(sourceDir, targetDir);
      }
      return;
    }

    if (existing.category === "public" && !fs.existsSync(targetDir) && sourceDir && fs.existsSync(sourceDir)) {
      this.copyPackageFiles(sourceDir, targetDir);
    }
  }

  private skillPackageDir(skill: SkillDetail): string | undefined {
    if (!skill.path) {
      return undefined;
    }
    const skillFilePath = path.isAbsolute(skill.path)
      ? skill.path
      : path.resolve(process.cwd(), skill.path);
    return path.dirname(skillFilePath);
  }

  private copyPackageFiles(sourceDir: string, targetDir: string) {
    for (const file of this.walkPackageFiles(sourceDir, true)) {
      const sourceFile = path.join(sourceDir, file.relativePath);
      const targetFile = path.join(targetDir, file.relativePath);
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.copyFileSync(sourceFile, targetFile);
      fs.chmodSync(targetFile, fs.statSync(sourceFile).mode);
    }
  }

  private removeSupportingFiles(packageDir: string) {
    for (const file of this.walkPackageFiles(packageDir, false).reverse()) {
      if (file.relativePath === SKILL_FILE_NAME) {
        continue;
      }
      fs.rmSync(path.join(packageDir, file.relativePath), { force: true });
    }
    this.removeEmptyDirectories(packageDir, packageDir);
  }

  private removeEmptyDirectories(rootDir: string, currentDir: string) {
    if (!fs.existsSync(currentDir)) {
      return;
    }
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        this.removeEmptyDirectories(rootDir, path.join(currentDir, entry.name));
      }
    }
    if (currentDir !== rootDir && fs.readdirSync(currentDir).length === 0) {
      fs.rmdirSync(currentDir);
    }
  }

  private writeSupportingFile(packageDir: string, file: SupportingSkillFile) {
    const relativePath = normalizePackageFilePath(file.path);
    const target = path.join(packageDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, "utf8");
    if (file.executable) {
      fs.chmodSync(target, 0o755);
    }
  }

  private listPackageFiles(packageDir: string): SkillPackageFileDescriptor[] {
    return this.walkPackageFiles(packageDir, false)
      .filter((file) => file.relativePath !== SKILL_FILE_NAME)
      .map((file) => this.packageFileDescriptor(packageDir, file.relativePath));
  }

  private packageFileDescriptor(packageDir: string, relativePath: string): SkillPackageFileDescriptor {
    const fullPath = path.join(packageDir, relativePath);
    const stat = fs.statSync(fullPath);
    return SkillPackageFileDescriptorSchema.parse({
      path: relativePath,
      kind: classifyPackageFile(relativePath),
      size: stat.size,
      updatedAt: Math.floor(stat.mtimeMs),
      executable: (stat.mode & 0o111) !== 0,
    });
  }

  private walkPackageFiles(packageDir: string, includeSkillFile: boolean): { relativePath: string }[] {
    if (!fs.existsSync(packageDir)) {
      return [];
    }
    const files: { relativePath: string }[] = [];
    const stack = [packageDir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.name.startsWith(".")) {
          continue;
        }
        const fullPath = path.join(current, entry.name);
        const relativePath = path.relative(packageDir, fullPath).split(path.sep).join("/");
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (!includeSkillFile && relativePath === SKILL_FILE_NAME) {
          continue;
        }
        files.push({ relativePath });
      }
    }
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  private findAnySkill(name: string): SkillDetail | undefined {
    const id = toSkillId(name);
    return this.readAllSkillDetails().find((skill) => skill.id === id || skill.name === name);
  }

  private privateSkillDir(name: string): string {
    return path.join(this.privateRootDir, normalizeSkillName(name));
  }

  private publicSkillDir(name: string): string {
    return path.join(this.publicRootDir, normalizeSkillName(name));
  }

  private legacyCustomSkillDir(name: string): string {
    return path.join(this.legacyCustomRootDir, normalizeSkillName(name));
  }

  private requireSkillPackageDir(skill: SkillDetail): string {
    const packageDir = this.skillPackageDir(skill);
    if (!packageDir || !fs.existsSync(packageDir)) {
      throw new Error(`Skill '${skill.name}' does not have a local package directory.`);
    }
    return packageDir;
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

function normalizePackageFilePath(filePath: string): string {
  const normalized = filePath.trim().replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))
  ) {
    throw new Error(`Skill package file path '${filePath}' must be a visible relative path inside the skill directory.`);
  }
  if (normalized === SKILL_FILE_NAME) {
    throw new Error(`${SKILL_FILE_NAME} must be supplied as skill content, not as a supporting file.`);
  }
  return parts.join("/");
}

function classifyPackageFile(filePath: string): "script" | "agent" | "template" | "asset" | "reference" | "other" {
  const [folder] = filePath.split("/");
  if (folder === "scripts") {
    return "script";
  }
  if (folder === "agents") {
    return "agent";
  }
  if (folder === "templates") {
    return "template";
  }
  if (folder === "assets") {
    return "asset";
  }
  if (folder === "references" || folder === "docs") {
    return "reference";
  }
  return "other";
}

/**
 * Fuzzy find-and-replace: strips all whitespace sequences to single spaces for matching,
 * then performs the replacement on the original content by tracking character positions.
 */
function fuzzyReplace(content: string, oldContent: string, newContent: string): string {
  const normalizeWs = (s: string) => s.replace(/\s+/g, " ").trim();
  const normalizedContent = normalizeWs(content);
  const normalizedOld = normalizeWs(oldContent);
  const idx = normalizedContent.indexOf(normalizedOld);
  if (idx < 0) return content;

  // Build a mapping from normalized index → original index
  const origMap: number[] = [];
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (!/\s/.test(ch) || origMap.length === 0 || !/\s/.test(content[origMap[origMap.length - 1]!] as string)) {
      origMap.push(i);
    } else if (/\s/.test(ch) && /\s/.test(content[origMap[origMap.length - 1]!] as string)) {
      // collapse consecutive whitespace: skip
    }
  }

  const startOrigIdx = origMap[idx] ?? 0;
  const endOrigIdx = (origMap[idx + normalizedOld.length] ?? content.length);

  return content.slice(0, startOrigIdx) + newContent + content.slice(endOrigIdx);
}

function normalizeSkillName(name: string): string {
  return SkillNameSchema.parse(name.trim().toLowerCase());
}

function toSkillId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
