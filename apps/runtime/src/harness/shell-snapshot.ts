import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ShellSnapshot {
  env: Record<string, string>;
  shellPath: string;
  capturedAt: number;
}

const SHELL_SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const SHELL_SNAPSHOT_TIMEOUT_MS = 10_000;
const SHELL_SNAPSHOT_MARKER = "__ORA_SHELL_SNAPSHOT_START__";
const DEFAULT_PATH = process.platform === "darwin"
  ? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  : "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const SENSITIVE_ENV_PATTERNS = [/(^|_)API_KEY/i, /(^|_)SECRET/i, /(^|_)TOKEN/i, /(^|_)PASSWORD/i];

let cachedSnapshot: ShellSnapshot | undefined;
let inFlightSnapshot: Promise<ShellSnapshot> | undefined;

export async function captureShellSnapshot(): Promise<ShellSnapshot> {
  return loadShellSnapshot({ forceRefresh: true });
}

export async function getShellSnapshot(): Promise<ShellSnapshot> {
  return loadShellSnapshot();
}

export async function warmShellSnapshot(): Promise<ShellSnapshot> {
  return loadShellSnapshot();
}

export async function getShellExecutionContext(): Promise<{ env: NodeJS.ProcessEnv; shellPath: string; snapshot: ShellSnapshot }> {
  const snapshot = await getShellSnapshot();
  return {
    env: filterShellEnvironment({
      ...process.env,
      ...snapshot.env,
      SHELL: snapshot.shellPath,
    }),
    shellPath: snapshot.shellPath,
    snapshot,
  };
}

export function filterShellEnvironment(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || isSensitiveEnvKey(key)) {
      continue;
    }
    next[key] = value;
  }
  if (!next.PATH) {
    next.PATH = env.PATH ?? process.env.PATH ?? DEFAULT_PATH;
  }
  if (!next.SHELL) {
    next.SHELL = typeof env.SHELL === "string" ? env.SHELL : resolveShellPath(process.env);
  }
  return next;
}

export function fallbackShellSnapshot(env: NodeJS.ProcessEnv = process.env): ShellSnapshot {
  const shellPath = resolveShellPath(env);
  return {
    env: normalizeEnvironment(env, shellPath),
    shellPath,
    capturedAt: Date.now(),
  };
}

async function loadShellSnapshot(options: { forceRefresh?: boolean } = {}): Promise<ShellSnapshot> {
  if (!options.forceRefresh && cachedSnapshot && !snapshotExpired(cachedSnapshot)) {
    return cachedSnapshot;
  }
  if (!options.forceRefresh && inFlightSnapshot) {
    return inFlightSnapshot;
  }
  const task = captureShellSnapshotFromShell();
  inFlightSnapshot = task;
  try {
    const snapshot = await task;
    cachedSnapshot = snapshot;
    return snapshot;
  } catch {
    const fallback = fallbackShellSnapshot();
    cachedSnapshot = fallback;
    return fallback;
  } finally {
    if (inFlightSnapshot === task) {
      inFlightSnapshot = undefined;
    }
  }
}

async function captureShellSnapshotFromShell(): Promise<ShellSnapshot> {
  if (process.platform === "win32") {
    return fallbackShellSnapshot();
  }
  const shellPath = resolveShellPath(process.env);
  const command = buildShellSnapshotCommand(shellPath);
  const stdout = await runShellSnapshotCommand(shellPath, command);
  return {
    env: normalizeEnvironment(parseShellSnapshotOutput(stdout), shellPath),
    shellPath,
    capturedAt: Date.now(),
  };
}

async function runShellSnapshotCommand(shellPath: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(shellPath, shellArgsForCapture(command), {
      cwd: process.cwd(),
      env: process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, SHELL_SNAPSHOT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Shell snapshot timed out after ${SHELL_SNAPSHOT_TIMEOUT_MS}ms.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Shell snapshot command failed with exit ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function shellArgsForCapture(command: string): string[] {
  if (process.platform === "win32") {
    return ["/d", "/s", "/c", command];
  }
  return ["-ilc", command];
}

function normalizeEnvironment(env: Record<string, string | undefined>, shellPath: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      next[key] = value;
    }
  }
  next.SHELL = shellPath;
  next.PATH = next.PATH || process.env.PATH || DEFAULT_PATH;
  if (!next.HOME && process.env.HOME) {
    next.HOME = process.env.HOME;
  }
  if (!next.USER && process.env.USER) {
    next.USER = process.env.USER;
  }
  if (!next.TMPDIR && process.env.TMPDIR) {
    next.TMPDIR = process.env.TMPDIR;
  }
  return next;
}

function snapshotExpired(snapshot: ShellSnapshot): boolean {
  return (Date.now() - snapshot.capturedAt) >= SHELL_SNAPSHOT_TTL_MS;
}

function resolveShellPath(env: NodeJS.ProcessEnv): string {
  if (process.platform === "win32") {
    return env.COMSPEC ?? "cmd.exe";
  }
  const candidates = [env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) {
      continue;
    }
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "/bin/sh";
}

function buildShellSnapshotCommand(shellPath: string, nodeExecPath: string = process.execPath): string {
  const shellName = path.basename(shellPath).toLowerCase();
  const bootstrap = bootstrapCommandForShell(shellName);
  const nodeCommand = `${quoteForPosixShell(nodeExecPath)} -e ${quoteForPosixShell("process.stdout.write(JSON.stringify(process.env))")}`;
  return [bootstrap, `printf '%s\\n' ${quoteForPosixShell(SHELL_SNAPSHOT_MARKER)}`, nodeCommand]
    .filter(Boolean)
    .join("; ");
}

function bootstrapCommandForShell(shellName: string): string {
  switch (shellName) {
    case "zsh":
      return [
        "[ -f ~/.zshenv ] && . ~/.zshenv >/dev/null 2>&1 || true",
        "[ -f ~/.zprofile ] && . ~/.zprofile >/dev/null 2>&1 || true",
        "[ -f ~/.zshrc ] && . ~/.zshrc >/dev/null 2>&1 || true",
        "[ -f ~/.zlogin ] && . ~/.zlogin >/dev/null 2>&1 || true",
      ].join("; ");
    case "bash":
      return [
        "[ -f ~/.bash_profile ] && . ~/.bash_profile >/dev/null 2>&1 || true",
        "[ -f ~/.bash_login ] && . ~/.bash_login >/dev/null 2>&1 || true",
        "[ -f ~/.profile ] && . ~/.profile >/dev/null 2>&1 || true",
        "[ -f ~/.bashrc ] && . ~/.bashrc >/dev/null 2>&1 || true",
      ].join("; ");
    case "fish":
      return "if test -f ~/.config/fish/config.fish; source ~/.config/fish/config.fish >/dev/null 2>&1; end";
    default:
      return "[ -f ~/.profile ] && . ~/.profile >/dev/null 2>&1 || true";
  }
}

function parseShellSnapshotOutput(stdout: string): Record<string, string> {
  const markerIndex = stdout.lastIndexOf(SHELL_SNAPSHOT_MARKER);
  if (markerIndex < 0) {
    throw new Error("Shell snapshot marker not found in shell output.");
  }
  const payload = stdout.slice(markerIndex + SHELL_SNAPSHOT_MARKER.length).replace(/^\r?\n/, "").trim();
  if (!payload) {
    throw new Error("Shell snapshot output was empty.");
  }
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Shell snapshot payload must be an object.");
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      next[key] = value;
    }
  }
  return next;
}

function isSensitiveEnvKey(key: string): boolean {
  return SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key));
}

function quoteForPosixShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill("SIGTERM");
    return;
  }
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    child.kill("SIGTERM");
  }
}

export const shellSnapshotInternals = {
  buildShellSnapshotCommand,
  bootstrapCommandForShell,
  parseShellSnapshotOutput,
  resolveShellPath,
  resetForTests() {
    cachedSnapshot = undefined;
    inFlightSnapshot = undefined;
  },
};
