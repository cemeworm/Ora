import fs from "node:fs";
import path from "node:path";
import {
  ModeCloneParamsSchema,
  ModeCreateParamsSchema,
  ModeDeleteParamsSchema,
  ModeGetParamsSchema,
  ModeIdSchema,
  ModeSpecSchema,
  ModeUpdateParamsSchema,
  ModeValidationResultSchema,
  MVP_MODES,
  getModePreset,
  type CoordinationPattern,
  type ModeCreateParams,
  type ModeSpec,
  type ModeUpdateParams,
  type ModeValidationResult,
  validateModeSpec,
} from "@cemeworm/shared";

export class ModeSpecFileStore {
  constructor(
    private readonly rootDir: string,
    private readonly clock: () => number = Date.now,
  ) {}

  list(): ModeSpec[] {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const customModes = fs.readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .flatMap((entry) => {
        try {
          return [this.readMode(entry.name.replace(/\.json$/, ""))];
        } catch {
          return [];
        }
      });

    return [
      ...MVP_MODES,
      ...customModes.sort((left, right) => right.updatedAt - left.updatedAt || left.label.localeCompare(right.label)),
    ];
  }

  get(params: unknown): ModeSpec {
    const parsed = ModeGetParamsSchema.parse(params);
    const preset = getModePreset(parsed.modeId);
    if (preset) {
      return preset;
    }
    return this.readMode(parsed.modeId);
  }

  resolve(modeId: string | undefined, fallbackFamily: CoordinationPattern): ModeSpec {
    if (modeId) {
      return this.get({ modeId });
    }
    return this.get({ modeId: fallbackFamily });
  }

  create(params: ModeCreateParams | unknown): ModeSpec {
    const parsed = ModeCreateParamsSchema.parse(params);
    const modeId = ModeIdSchema.parse(parsed.id);
    if (getModePreset(modeId)) {
      throw new Error(`Mode '${modeId}' is reserved by a system preset.`);
    }
    const filePath = this.modePath(modeId);
    if (fs.existsSync(filePath)) {
      throw new Error(`Mode '${modeId}' already exists.`);
    }

    const now = this.clock();
    const spec = ModeSpecSchema.parse({
      ...parsed,
      id: modeId,
      systemPreset: false,
      createdAt: now,
      updatedAt: now,
    });
    this.ensureValid(spec);
    this.writeMode(spec);
    return spec;
  }

  update(params: ModeUpdateParams | unknown): ModeSpec {
    const parsed = ModeUpdateParamsSchema.parse(params);
    const existing = this.get({ modeId: parsed.modeId });
    if (existing.systemPreset) {
      throw new Error(`System preset '${parsed.modeId}' is read-only. Clone it before editing.`);
    }

    const spec = ModeSpecSchema.parse({
      ...parsed.spec,
      id: parsed.modeId,
      systemPreset: false,
      createdAt: existing.createdAt,
      updatedAt: this.clock(),
    });
    this.ensureValid(spec);
    this.writeMode(spec);
    return spec;
  }

  delete(params: unknown): { deleted: true; modeId: string } {
    const parsed = ModeDeleteParamsSchema.parse(params);
    const existing = this.get({ modeId: parsed.modeId });
    if (existing.systemPreset) {
      throw new Error(`System preset '${parsed.modeId}' cannot be deleted.`);
    }
    const filePath = this.modePath(parsed.modeId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Mode '${parsed.modeId}' not found.`);
    }
    fs.rmSync(filePath, { force: true });
    return { deleted: true, modeId: parsed.modeId };
  }

  validate(params: unknown): ModeValidationResult {
    const spec = this.toValidationSpec(params);
    return this.ensureValid(spec, false);
  }

  cloneFromPreset(params: unknown): ModeSpec {
    const parsed = ModeCloneParamsSchema.parse(params);
    const source = this.get({ modeId: parsed.sourceModeId });
    const targetId = parsed.modeId ?? this.nextCloneId(source.id);
    const targetLabel = parsed.label?.trim() || `${source.label} Copy`;
    return this.create({
      ...source,
      id: targetId,
      label: targetLabel,
      summary: source.summary,
      description: source.description,
      recommendedUse: source.recommendedUse,
      failureMode: source.failureMode,
      nodes: source.nodes.map((node) => ({ ...node })),
      edges: source.edges.map((edge) => ({ ...edge })),
      stopPolicy: { ...source.stopPolicy },
      capabilityFlags: { ...source.capabilityFlags },
      editorConstraints: {
        ...source.editorConstraints,
        readOnly: false,
      },
      defaultBudget: { ...source.defaultBudget },
      profiles: source.profiles.map((profile) => ({ ...profile })),
      completionPolicy: { ...source.completionPolicy },
      runtimePolicy: { ...source.runtimePolicy },
      recoveryPolicy: { ...source.recoveryPolicy },
      memoryPolicy: { ...source.memoryPolicy },
    });
  }

  private toValidationSpec(params: unknown): ModeSpec {
    if (typeof params !== "object" || params === null || !("spec" in params)) {
      throw new Error("Mode validation requires a spec.");
    }
    const now = this.clock();
    return ModeSpecSchema.parse({
      ...(params as { spec: Record<string, unknown> }).spec,
      systemPreset: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  private ensureValid(spec: ModeSpec, throwOnInvalid = true): ModeValidationResult {
    const result = ModeValidationResultSchema.parse(validateModeSpec(spec));
    if (!result.valid && throwOnInvalid) {
      throw new Error(result.errors.join(" "));
    }
    return result;
  }

  private readMode(modeId: string): ModeSpec {
    const filePath = this.modePath(modeId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Mode '${modeId}' not found.`);
    }
    return ModeSpecSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  }

  private writeMode(spec: ModeSpec): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.writeFileSync(this.modePath(spec.id), `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  }

  private modePath(modeId: string): string {
    return path.join(this.rootDir, `${modeId}.json`);
  }

  private nextCloneId(sourceId: string): string {
    const normalizedSource = sourceId.replace(/-copy-\d+$/, "");
    let index = 1;
    while (true) {
      const candidate = `${normalizedSource}-copy-${index}`;
      if (!getModePreset(candidate) && !fs.existsSync(this.modePath(candidate))) {
        return candidate;
      }
      index += 1;
    }
  }
}
