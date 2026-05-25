import fs from "node:fs";
import path from "node:path";
import type { FileAccessScope, HostFilesystemCapability, HostFilesystemGrant, HostFilesystemState } from "@cemeworm/shared";

const workspacePackageAliasCache = new Map<string, Map<string, string>>();

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function workspaceRootPath(workspace: unknown): string | undefined {
  if (!workspace || typeof workspace !== "object" || workspace === null) {
    return undefined;
  }
  const rootPath = (workspace as Record<string, unknown>).rootPath;
  return typeof rootPath === "string" && rootPath.trim() ? rootPath : undefined;
}

export function requireWorkspaceRoot(workspace: unknown): string {
  const rootPath = workspaceRootPath(workspace);
  if (!rootPath) {
    throw new Error("A selected project folder is required for this tool.");
  }
  return path.resolve(rootPath);
}

export function resolveWorkspacePath(rootPath: string, requestedPath: unknown): string {
  const rawPath = requestedPath === undefined ? "." : requestedPath;
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new Error("Workspace path must be a non-empty relative path.");
  }
  const normalizedRequest = rawPath.trim();
  const resolved = path.resolve(rootPath, resolveWorkspacePackageAlias(rootPath, normalizedRequest));
  const relative = path.relative(rootPath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Workspace tool path must stay inside the project root.");
  }
  return resolved;
}

function resolveWorkspacePackageAlias(rootPath: string, requestedPath: string): string {
  const aliasTarget = parseWorkspacePackageAlias(requestedPath);
  if (!aliasTarget) {
    return requestedPath;
  }

  const workspaceRelativePath = workspacePackageAliases(rootPath).get(aliasTarget.packageName);
  if (!workspaceRelativePath) {
    return requestedPath;
  }

  const candidateRelativePath = aliasTarget.suffix
    ? path.join(workspaceRelativePath, ...aliasTarget.suffix.split("/"))
    : workspaceRelativePath;
  const candidateAbsolutePath = path.resolve(rootPath, candidateRelativePath);
  return fs.existsSync(candidateAbsolutePath) ? candidateRelativePath : requestedPath;
}

function workspacePackageAliases(rootPath: string): Map<string, string> {
  const cached = workspacePackageAliasCache.get(rootPath);
  if (cached) {
    return cached;
  }
  const aliases = scanWorkspacePackageAliases(rootPath);
  workspacePackageAliasCache.set(rootPath, aliases);
  return aliases;
}

function scanWorkspacePackageAliases(rootPath: string): Map<string, string> {
  const workspaceConfigPath = path.join(rootPath, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspaceConfigPath)) {
    return new Map();
  }

  const workspacePatterns = readWorkspacePackagePatterns(workspaceConfigPath);
  const aliases = new Map<string, string>();
  const duplicates = new Set<string>();

  for (const workspacePattern of workspacePatterns) {
    if (!workspacePattern.endsWith("/*")) {
      continue;
    }

    const workspaceDir = path.join(rootPath, workspacePattern.slice(0, -2));
    if (!fs.existsSync(workspaceDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageDir = path.join(workspaceDir, entry.name);
      const packageJsonPath = path.join(packageDir, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }

      const packageName = readPackageName(packageJsonPath);
      if (!packageName) {
        continue;
      }

      if (aliases.has(packageName)) {
        aliases.delete(packageName);
        duplicates.add(packageName);
        continue;
      }
      if (duplicates.has(packageName)) {
        continue;
      }

      aliases.set(packageName, path.relative(rootPath, packageDir));
    }
  }

  return aliases;
}

function readWorkspacePackagePatterns(workspaceConfigPath: string): string[] {
  const workspaceConfig = fs.readFileSync(workspaceConfigPath, "utf8");
  const patterns: string[] = [];
  for (const line of workspaceConfig.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const value = match[1]?.trim();
    if (!value) {
      continue;
    }
    patterns.push(value.replace(/^['"]|['"]$/g, ""));
  }
  return patterns;
}

function readPackageName(packageJsonPath: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : undefined;
  } catch {
    return undefined;
  }
}

function parseWorkspacePackageAlias(requestedPath: string): { packageName: string; suffix: string } | undefined {
  const normalized = requestedPath.split(path.sep).join("/");
  if (!normalized.startsWith("node_modules/")) {
    return undefined;
  }

  const segments = normalized.split("/");
  if (segments.length < 2) {
    return undefined;
  }

  const packageName = segments[1]?.startsWith("@")
    ? segments.slice(1, 3).join("/")
    : segments[1]!;
  if (!packageName || packageName === "@") {
    return undefined;
  }

  const suffixStart = packageName.startsWith("@") ? 3 : 2;
  return {
    packageName,
    suffix: segments.slice(suffixStart).join("/"),
  };
}

export function relativeWorkspacePath(rootPath: string, absolutePath: string): string {
  const relative = path.relative(rootPath, absolutePath);
  return relative || ".";
}

export function normalizeHostFilesystemState(state: HostFilesystemState | undefined): HostFilesystemState {
  if (!state) {
    return {
      grants: [],
      allowDynamicGrant: false,
    };
  }
  const grants = new Map<string, HostFilesystemGrant>();
  for (const grant of state.grants ?? []) {
    if (!grant || typeof grant.id !== "string" || !grant.id.trim()) {
      continue;
    }
    if (typeof grant.rootPath !== "string" || !grant.rootPath.trim() || !path.isAbsolute(grant.rootPath)) {
      continue;
    }
    grants.set(grant.id, {
      ...grant,
      id: grant.id.trim(),
      rootPath: path.resolve(grant.rootPath),
      label: grant.label.trim(),
      capabilities: [...new Set(grant.capabilities ?? [])],
    });
  }
  return {
    grants: [...grants.values()],
    allowDynamicGrant: state.allowDynamicGrant === true,
  };
}

export function hasHostFilesystemAccess(state: HostFilesystemState | undefined): boolean {
  return normalizeHostFilesystemState(state).grants.length > 0;
}

export function hasHostFilesystemCapability(
  state: HostFilesystemState | undefined,
  capability: HostFilesystemCapability,
): boolean {
  return normalizeHostFilesystemState(state).grants.some((grant) => (grant.capabilities ?? []).includes(capability));
}

export interface ResolvedFileToolTarget {
  scope: FileAccessScope;
  grantId?: string;
  absolutePath: string;
  displayPath: string;
  workspaceRoot?: string;
  anchorRootPath: string;
  scopeLabel: "project" | "temporary_directory" | "approved_host_directory" | "external_file";
}

export function resolveFileToolTarget(params: {
  workspace: unknown;
  hostFilesystem?: HostFilesystemState;
  args: Record<string, unknown>;
  capability: HostFilesystemCapability;
}): ResolvedFileToolTarget {
  const hostState = normalizeHostFilesystemState(params.hostFilesystem);
  const scope = fileAccessScopeFromArgs(params.args);
  if (scope === "workspace") {
    const workspaceRoot = workspaceRootPath(params.workspace);
    if (!workspaceRoot) {
      const readOnlyHostTarget = resolveImplicitReadOnlyHostTarget(hostState, params.args, params.capability);
      if (readOnlyHostTarget) {
        return readOnlyHostTarget;
      }
    }
    const rootPath = requireWorkspaceRoot(params.workspace);
    try {
      const absolutePath = resolveWorkspacePath(rootPath, params.args.path);
      return {
        scope,
        absolutePath,
        displayPath: relativeWorkspacePath(rootPath, absolutePath),
        workspaceRoot: rootPath,
        anchorRootPath: rootPath,
        scopeLabel: "project",
      };
    } catch (innerError) {
      // 仅读操作 + 已存在的绝对路径 = 允许越界
      if (isReadCapability(params.capability)) {
        const lenientPath = resolveLenientExternalPath(params.args.path);
        if (lenientPath) {
          return {
            scope,
            absolutePath: lenientPath,
            displayPath: lenientPath,
            workspaceRoot: rootPath,
            anchorRootPath: rootPath,
            scopeLabel: "external_file",
          };
        }
      }
      throw innerError;
    }
  }

  const grant = scope === "host_grant"
    ? requireHostGrant(hostState, params.args.grantId)
    : undefined;
  const requestedPath = defaultHostScopePath(scope, grant, params.args.path);
  const resolvedHostPath = resolveHostPath(
    scope,
    requestedPath,
    hostState,
    params.capability,
    grant,
  );
  return {
    scope,
    grantId: grant?.id,
    absolutePath: resolvedHostPath.absolutePath,
    displayPath: resolvedHostPath.absolutePath,
    anchorRootPath: resolvedHostPath.anchorRootPath,
    scopeLabel: scope === "host_tmp" ? "temporary_directory" : "approved_host_directory",
  };
}

function fileAccessScopeFromArgs(args: Record<string, unknown>): FileAccessScope {
  return args.scope === "host_tmp" || args.scope === "host_grant" ? args.scope : "workspace";
}

function resolveImplicitReadOnlyHostTarget(
  state: HostFilesystemState,
  args: Record<string, unknown>,
  capability: HostFilesystemCapability,
): ResolvedFileToolTarget | undefined {
  if (!isReadCapability(capability)) {
    return undefined;
  }
  const requestedPath = typeof args.path === "string" && args.path.trim()
    ? args.path.trim()
    : undefined;
  const grants = state.grants.filter((candidate) => grantAllowsCapability(candidate, capability));
  if (requestedPath && path.isAbsolute(requestedPath)) {
    const absolutePath = path.resolve(requestedPath);
    const matchingGrant = [...grants]
      .filter((candidate) => pathStaysInsideRoot(candidate.rootPath, absolutePath))
      .sort((left, right) => right.rootPath.length - left.rootPath.length)[0];
    if (!matchingGrant) {
      return undefined;
    }
    return {
      scope: "host_grant",
      grantId: matchingGrant.id,
      absolutePath,
      displayPath: absolutePath,
      anchorRootPath: matchingGrant.rootPath,
      scopeLabel: "approved_host_directory",
    };
  }

  if (grants.length !== 1) {
    return undefined;
  }
  const onlyGrant = grants[0]!;
  const relativeOrDefaultPath = requestedPath && requestedPath !== "."
    ? requestedPath
    : ".";
  const absolutePath = path.resolve(onlyGrant.rootPath, relativeOrDefaultPath);
  if (!pathStaysInsideRoot(onlyGrant.rootPath, absolutePath)) {
    return undefined;
  }
  return {
    scope: "host_grant",
    grantId: onlyGrant.id,
    absolutePath,
    displayPath: relativeOrDefaultPath === "." ? onlyGrant.rootPath : absolutePath,
    anchorRootPath: onlyGrant.rootPath,
    scopeLabel: "approved_host_directory",
  };
}

function defaultHostScopePath(
  scope: Exclude<FileAccessScope, "workspace">,
  grant: HostFilesystemGrant | undefined,
  requestedPath: unknown,
): unknown {
  if (requestedPath !== undefined) {
    return requestedPath;
  }
  if (scope === "host_tmp") {
    return "/tmp";
  }
  return grant?.rootPath;
}

function requireHostGrant(state: HostFilesystemState, grantId: unknown): HostFilesystemGrant {
  if (typeof grantId !== "string" || !grantId.trim()) {
    throw new Error("Host file grant is required for this path.");
  }
  const grant = state.grants.find((candidate) => candidate.id === grantId.trim());
  if (!grant) {
    throw new Error("Host file grant is required for this path.");
  }
  return grant;
}

function resolveHostPath(
  scope: Exclude<FileAccessScope, "workspace">,
  requestedPath: unknown,
  state: HostFilesystemState,
  capability: HostFilesystemCapability,
  grant?: HostFilesystemGrant,
): { absolutePath: string; anchorRootPath: string } {
  const absolutePath = requireAbsoluteHostPath(requestedPath);
  const approvedRoots = scope === "host_tmp"
    ? state.grants.filter((candidate) => candidate.source === "system_tmp")
    : grant
      ? [grant]
      : [];
  const approvedGrant = approvedRoots.find((candidate) => {
    if (!grantAllowsCapability(candidate, capability)) {
      return false;
    }
    return pathStaysInsideRoot(candidate.rootPath, absolutePath);
  });

  if (!approvedGrant) {
    if (scope === "host_grant" && grant && !grantAllowsCapability(grant, capability)) {
      throw new Error(hostCapabilityDeniedMessage(capability));
    }
    if (scope === "host_grant" && grant) {
      throw new Error("Host file path must stay inside the approved grant root.");
    }
    if (scope === "host_tmp") {
      throw new Error("Host file path must stay inside the approved grant root.");
    }
    if (state.allowDynamicGrant) {
      throw new Error("Host file grant is required for this path.");
    }
    throw new Error("Host file grant is required for this path.");
  }

  return {
    absolutePath,
    anchorRootPath: approvedGrant.rootPath,
  };
}

function hostCapabilityDeniedMessage(capability: HostFilesystemCapability): string {
  return capability === "write" || capability === "patch"
    ? "Host file grant does not allow write access."
    : "Host file grant does not allow this operation.";
}

function requireAbsoluteHostPath(requestedPath: unknown): string {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) {
    throw new Error("Host file scope requires an absolute path.");
  }
  const absolutePath = path.resolve(requestedPath.trim());
  if (!path.isAbsolute(absolutePath)) {
    throw new Error("Host file scope requires an absolute path.");
  }
  return absolutePath;
}

function grantAllowsCapability(
  grant: HostFilesystemGrant,
  capability: HostFilesystemCapability,
): boolean {
  return (grant.capabilities ?? []).includes(capability);
}

function pathStaysInsideRoot(rootPath: string, absolutePath: string): boolean {
  const canonicalRoot = canonicalizePathForContainment(rootPath);
  const canonicalTarget = canonicalizePathForContainment(absolutePath);
  const relative = path.relative(canonicalRoot, canonicalTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalizePathForContainment(targetPath: string): string {
  const missingSegments: string[] = [];
  let current = path.resolve(targetPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return current;
    }
    missingSegments.unshift(path.basename(current));
    current = parent;
  }
  let canonical = fs.realpathSync.native(current);
  for (const segment of missingSegments) {
    canonical = path.join(canonical, segment);
  }
  return path.resolve(canonical);
}

export function parseHttpUrl(value: unknown, toolName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${toolName} requires a non-empty URL.`);
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${toolName} only supports http and https URLs.`);
  }
  return parsed.href;
}

function isReadCapability(capability: HostFilesystemCapability): boolean {
  return capability === "read" || capability === "list" || capability === "search";
}

function resolveLenientExternalPath(requestedPath: unknown): string | undefined {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) return undefined;
  if (!path.isAbsolute(requestedPath.trim())) return undefined;
  const resolved = path.resolve(requestedPath.trim());
  if (!fs.existsSync(resolved)) return undefined;
  return resolved;
}

export function readPositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, max);
}

export function truncateText(text: string, maxBytes: number): { content: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text);
  if (bytes <= maxBytes) {
    return { content: text, truncated: false };
  }
  return {
    content: text.slice(0, maxBytes),
    truncated: true,
  };
}
