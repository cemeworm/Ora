import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ActivePackagePointerSchema,
  ORA_HOST_ABI_VERSION,
  ORA_RUNTIME_ABI_VERSION,
  PackageBuildCandidateParamsSchema,
  PackageManifestSchema,
  PackageStoreSnapshotSchema,
  PackageVerifyParamsSchema,
  PackageVersionParamsSchema,
  type ActivePackagePointer,
  type PackageBuildCandidateParams,
  type PackageManifest,
  type PackageStoreSnapshot,
  type PackageVerifyParams,
} from "@cemeworm/shared";

export interface PackageManagerOptions {
  appDataRoot?: string;
  repoRoot?: string;
  clock?: () => number;
  runCommand?: (command: string, cwd: string) => string;
}

const DEFAULT_BUILD_COMMANDS = [
  "pnpm typecheck",
  "pnpm --filter @ora/runtime package:sidecar",
  "pnpm --filter @ora/desktop build",
];

export class PackageManager {
  private readonly appDataRoot: string;
  private readonly repoRoot: string;
  private readonly clock: () => number;
  private readonly runCommandImpl: (command: string, cwd: string) => string;

  constructor(options: PackageManagerOptions = {}) {
    this.appDataRoot = path.resolve(options.appDataRoot ?? process.env.ORA_APP_DATA_DIR ?? defaultAppDataRoot());
    this.repoRoot = path.resolve(options.repoRoot ?? findRepoRoot(process.cwd()));
    this.clock = options.clock ?? Date.now;
    this.runCommandImpl = options.runCommand ?? runCommand;
  }

  snapshot(): PackageStoreSnapshot {
    const packages = this.readManifests();
    const active = this.readActivePointer();
    return PackageStoreSnapshotSchema.parse({
      rootPath: this.versionsRoot(),
      active,
      packages: packages.map((manifest) => markManifestStatus(manifest, active)),
    });
  }

  active(): PackageStoreSnapshot {
    return this.snapshot();
  }

  buildCandidate(params: unknown = {}): PackageManifest {
    const parsed = PackageBuildCandidateParamsSchema.parse(params);
    this.ensureStore();
    const now = this.clock();
    const semver = parsed.semver ?? `0.1.${Math.floor(now / 1000)}`;
    const versionId = safeVersionId(parsed.versionId ?? `local-${semver}-${now}`);
    const slotPath = path.join(this.versionsRoot(), versionId);
    const buildLogPath = path.join(slotPath, "build.log");
    const frontendDistPath = path.join(slotPath, "frontend");
    const runtimeSidecarPath = path.join(slotPath, "runtime-sidecar");
    fs.mkdirSync(slotPath, { recursive: true });

    const commands = parsed.verificationCommands ?? DEFAULT_BUILD_COMMANDS;
    const errors: string[] = [];
    const logParts: string[] = [];
    if (!parsed.skipBuildCommands) {
      for (const command of commands) {
        logParts.push(`$ ${command}\n`);
        try {
          logParts.push(this.runCommandImpl(command, parsed.sourceRoot ?? this.repoRoot));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${command}: ${message}`);
          logParts.push(`${message}\n`);
          break;
        }
      }
    } else {
      logParts.push("Build commands skipped by request.\n");
    }

    copyIfExists(path.join(this.repoRoot, "apps", "desktop", "dist"), frontendDistPath);
    copyIfExists(path.join(this.repoRoot, "apps", "desktop", "src-tauri", "resources", "runtime-sidecar"), runtimeSidecarPath);

    fs.writeFileSync(buildLogPath, logParts.join("\n"), "utf8");
    const manifest = PackageManifestSchema.parse({
      versionId,
      semver,
      status: errors.length > 0 ? "failed" : "candidate",
      channel: parsed.channel,
      gitCommit: parsed.gitCommit ?? readGitCommit(parsed.sourceRoot ?? this.repoRoot),
      builtAt: now,
      hostAbiVersion: ORA_HOST_ABI_VERSION,
      runtimeAbiVersion: ORA_RUNTIME_ABI_VERSION,
      sourceRoot: parsed.sourceRoot ?? this.repoRoot,
      slotPath,
      frontendDistPath,
      runtimeSidecarPath,
      buildLogPath,
      verification: {
        status: errors.length > 0 ? "failed" : "passed",
        checkedAt: now,
        commands,
        logPath: buildLogPath,
        errors,
      },
      migrationNotes: parsed.migrationNotes,
      rollbackTarget: this.readActivePointer().activeVersionId,
    });
    this.writeManifest(manifest);
    return manifest;
  }

  verify(params: unknown): PackageManifest {
    const parsed = PackageVerifyParamsSchema.parse(params);
    const manifest = this.readManifest(parsed.versionId);
    const commands = parsed.commands ?? [];
    const errors: string[] = [];
    const logParts: string[] = [];
    for (const command of commands) {
      logParts.push(`$ ${command}\n`);
      try {
        logParts.push(this.runCommandImpl(command, manifest.sourceRoot ?? this.repoRoot));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${command}: ${message}`);
        logParts.push(`${message}\n`);
      }
    }
    const sidecarOk = fs.existsSync(manifest.runtimeSidecarPath);
    const frontendOk = fs.existsSync(manifest.frontendDistPath);
    if (!sidecarOk) errors.push("runtimeSidecarPath is missing.");
    if (!frontendOk) errors.push("frontendDistPath is missing.");
    if (!isCompatible(manifest)) errors.push("Package ABI is incompatible with this host.");
    if (logParts.length > 0) {
      fs.appendFileSync(manifest.buildLogPath, `\n# verify ${new Date(this.clock()).toISOString()}\n${logParts.join("\n")}`, "utf8");
    }
    const next = PackageManifestSchema.parse({
      ...manifest,
      status: errors.length > 0 ? "failed" : manifest.status === "active" ? "active" : "candidate",
      verification: {
        status: errors.length > 0 ? "failed" : "passed",
        checkedAt: this.clock(),
        commands,
        logPath: manifest.buildLogPath,
        errors,
      },
    });
    this.writeManifest(next);
    return next;
  }

  promote(params: unknown): PackageStoreSnapshot {
    const { versionId } = PackageVersionParamsSchema.parse(params);
    const manifest = this.readManifest(versionId);
    assertPromotable(manifest);
    const active = this.readActivePointer();
    const now = this.clock();
    this.writeManifest(PackageManifestSchema.parse({
      ...manifest,
      status: "active",
      promotedAt: manifest.promotedAt ?? now,
      activatedAt: now,
    }));
    this.writeActivePointer({
      activeVersionId: versionId,
      previousVersionId: active.activeVersionId,
      channel: manifest.channel,
      activatedAt: now,
      compatibilityStatus: "compatible",
    });
    this.markPrevious(active.activeVersionId, versionId);
    return this.snapshot();
  }

  switch(params: unknown): PackageStoreSnapshot {
    return this.promote(params);
  }

  rollback(): PackageStoreSnapshot {
    const active = this.readActivePointer();
    if (!active.previousVersionId) {
      throw new Error("No previous Ora package slot is available for rollback.");
    }
    return this.promote({ versionId: active.previousVersionId });
  }

  prune(params: unknown = {}): PackageStoreSnapshot {
    const keep = new Set<string>();
    const active = this.readActivePointer();
    if (active.activeVersionId) keep.add(active.activeVersionId);
    if (active.previousVersionId) keep.add(active.previousVersionId);
    const record = params && typeof params === "object" ? params as Record<string, unknown> : {};
    const includeFailed = record.includeFailed === true;
    for (const manifest of this.readManifests()) {
      if (keep.has(manifest.versionId)) continue;
      if (!includeFailed && manifest.status !== "failed") continue;
      fs.rmSync(manifest.slotPath, { recursive: true, force: true });
    }
    return this.snapshot();
  }

  private versionsRoot(): string {
    return path.join(this.appDataRoot, "versions");
  }

  private activePointerPath(): string {
    return path.join(this.appDataRoot, "active-version.json");
  }

  private ensureStore() {
    fs.mkdirSync(this.versionsRoot(), { recursive: true });
  }

  private readActivePointer(): ActivePackagePointer {
    const pointerPath = this.activePointerPath();
    if (!fs.existsSync(pointerPath)) {
      return ActivePackagePointerSchema.parse({ channel: "local", compatibilityStatus: "unknown" });
    }
    try {
      return ActivePackagePointerSchema.parse(JSON.parse(fs.readFileSync(pointerPath, "utf8")));
    } catch {
      return ActivePackagePointerSchema.parse({ channel: "local", compatibilityStatus: "incompatible" });
    }
  }

  private writeActivePointer(pointer: ActivePackagePointer) {
    fs.mkdirSync(path.dirname(this.activePointerPath()), { recursive: true });
    writeJsonAtomic(this.activePointerPath(), ActivePackagePointerSchema.parse(pointer));
  }

  private readManifests(): PackageManifest[] {
    this.ensureStore();
    return fs.readdirSync(this.versionsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const manifestPath = path.join(this.versionsRoot(), entry.name, "manifest.json");
        if (!fs.existsSync(manifestPath)) return [];
        try {
          return [PackageManifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")))];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.builtAt - a.builtAt || a.versionId.localeCompare(b.versionId));
  }

  private readManifest(versionId: string): PackageManifest {
    const manifestPath = path.join(this.versionsRoot(), safeVersionId(versionId), "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Ora package slot not found: ${versionId}`);
    }
    return PackageManifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  }

  private writeManifest(manifest: PackageManifest) {
    fs.mkdirSync(manifest.slotPath, { recursive: true });
    writeJsonAtomic(path.join(manifest.slotPath, "manifest.json"), manifest);
  }

  private markPrevious(previousVersionId: string | undefined, activeVersionId: string) {
    for (const manifest of this.readManifests()) {
      if (manifest.versionId === activeVersionId) continue;
      if (manifest.versionId === previousVersionId) {
        this.writeManifest(PackageManifestSchema.parse({ ...manifest, status: "previous" }));
      } else if (manifest.status === "active") {
        this.writeManifest(PackageManifestSchema.parse({ ...manifest, status: "candidate" }));
      }
    }
  }
}

function assertPromotable(manifest: PackageManifest) {
  if (!isCompatible(manifest)) {
    throw new Error("Ora package slot is not compatible with this host.");
  }
  if (manifest.verification.status !== "passed") {
    throw new Error("Ora package slot must pass verification before promotion.");
  }
  if (!fs.existsSync(manifest.runtimeSidecarPath)) {
    throw new Error("Ora package slot is missing runtime-sidecar assets.");
  }
  if (!fs.existsSync(manifest.frontendDistPath)) {
    throw new Error("Ora package slot is missing frontend assets.");
  }
}

function isCompatible(manifest: PackageManifest) {
  return manifest.hostAbiVersion === ORA_HOST_ABI_VERSION && manifest.runtimeAbiVersion === ORA_RUNTIME_ABI_VERSION;
}

function markManifestStatus(manifest: PackageManifest, active: ActivePackagePointer): PackageManifest {
  if (manifest.versionId === active.activeVersionId) return { ...manifest, status: "active" };
  if (manifest.versionId === active.previousVersionId) return { ...manifest, status: "previous" };
  return manifest;
}

function safeVersionId(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error("Package version id must contain at least one safe character.");
  }
  return normalized;
}

function defaultAppDataRoot(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "dev.ora.workbench");
  }
  return path.join(os.homedir(), ".ora", "workbench");
}

function findRepoRoot(start: string): string {
  let current = path.resolve(start);
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return path.resolve(start);
}

function runCommand(command: string, cwd: string): string {
  const [executable, ...argv] = parseCommand(command);
  if (!executable) throw new Error("Command is empty.");
  return execFileSync(executable, argv, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 512_000,
    timeout: 10 * 60_000,
  });
}

function parseCommand(command: string): string[] {
  if (/[|;&<>`$\\]/.test(command)) {
    throw new Error("Package build commands must be single executable invocations.");
  }
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
  return tokens.map((token) => token.replace(/^["']|["']$/g, ""));
}

function copyIfExists(source: string, target: string) {
  if (!fs.existsSync(source)) return;
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

function readGitCommit(repoRoot: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}
