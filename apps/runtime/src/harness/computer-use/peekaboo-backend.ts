import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PersistentMcpSession, type McpSession } from "./mcp-session.js";
import type {
  ComputerUseBackend,
  ComputerPermissionStatus,
  ComputerObserveResult,
  ComputerActionResult,
  ComputerObserveRequest,
  ComputerClickRequest,
  ComputerTypeRequest,
  ComputerPressRequest,
  ComputerScrollRequest,
  ComputerWindowRequest,
  ComputerArtifact,
  ComputerUIElement,
  ComputerRecoverableError,
} from "./types.js";

// ---------------------------------------------------------------------------
// Peekaboo Backend (macOS native GUI automation via Peekaboo MCP)
// ---------------------------------------------------------------------------

const PEEKABOO_MCP_ARGS = ["mcp"];
const ARTIFACT_ROOT = path.join(os.homedir(), ".ora", "computer-use", "artifacts");

function resolvePeekabooBin(): string | null {
  // 1. node_modules/.bin/peekaboo (local optionalDependency install)
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    // Walk up from current file to find node_modules
    let dir = __dirname;
    for (let i = 0; i < 10; i++) {
      const binPath = path.join(dir, "node_modules", ".bin", "peekaboo");
      if (fs.existsSync(binPath)) return binPath;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // import.meta.url not available in all contexts
  }

  // 2. pnpm/node_modules/.bin/peekaboo (workspace root)
  try {
    const repoRoot = findRepoRoot();
    if (repoRoot) {
      const binPath = path.join(repoRoot, "node_modules", ".bin", "peekaboo");
      if (fs.existsSync(binPath)) return binPath;
    }
  } catch {
    // Not found
  }

  // 3. npx peekaboo (auto-download)
  try {
    const npxResult = execSync("npx peekaboo --version 2>/dev/null || echo ''", {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    if (npxResult) {
      // npx can execute it — use npx as the command
      return "npx";
    }
  } catch {
    // npx not available or failed
  }

  // 4. Global install
  try {
    const globalPath = execSync("which peekaboo 2>/dev/null || echo ''", {
      encoding: "utf8",
      timeout: 3_000,
    }).trim();
    if (globalPath && fs.existsSync(globalPath)) return globalPath;
  } catch {
    // Not found
  }

  return null;
}

function findRepoRoot(): string | null {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    let dir = __dirname;
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Not available
  }
  return null;
}

function getPeekabooCommand(binPath: string | null): { command: string; args: string[] } {
  if (!binPath) {
    return { command: "peekaboo", args: PEEKABOO_MCP_ARGS };
  }
  if (binPath === "npx") {
    return { command: "npx", args: ["peekaboo", ...PEEKABOO_MCP_ARGS] };
  }
  return { command: binPath, args: PEEKABOO_MCP_ARGS };
}

type PeekabooSessionState =
  | { kind: "uninitialized" }
  | { kind: "initializing" }
  | { kind: "ready"; session: McpSession }
  | { kind: "degraded"; reason: string };

export class PeekabooMcpBackend implements ComputerUseBackend {
  readonly id = "peekaboo";
  readonly label = "Peekaboo (macOS GUI)";
  readonly supportedTargetKinds = ["native_app" as const, "builtin_browser" as const];

  private sessionState: PeekabooSessionState = { kind: "uninitialized" };
  private readonly logBuffer: string[] = [];

  // -----------------------------------------------------------------------
  // Permission Status
  // -----------------------------------------------------------------------

  async getStatus(): Promise<ComputerPermissionStatus> {
    const permissions = this.checkMacOSPermissions();
    const installStatus = this.checkInstallation();

    const available = installStatus.installed && permissions.every((p) => p.granted || !p.required);

    const result: ComputerPermissionStatus = {
      backend: this.id,
      targetKind: "native_app",
      available,
      permissions,
      installStatus,
      diagnostics: this.logBuffer.slice(-20),
    };

    if (!installStatus.installed) {
      result.recoverableError = {
        code: "install_required",
        message: "Peekaboo is not installed. Run: npm install -g peekaboo",
        detail: { nodeVersion: process.version },
      };
    } else if (!available) {
      const missing = permissions.filter((p) => !p.granted && p.required).map((p) => p.name);
      result.recoverableError = {
        code: "permission_missing",
        message: `Missing macOS permissions: ${missing.join(", ")}. Grant them in System Settings > Privacy & Security.`,
        detail: { missing },
      };
    }

    return result;
  }

  private checkInstallation(): { installed: boolean; version?: string; installHint?: string } {
    const binPath = resolvePeekabooBin();

    if (!binPath) {
      return {
        installed: false,
        installHint: "Peekaboo not found. Install with: npm install -g peekaboo  OR  pnpm add peekaboo (auto-installed as optional dependency). Requires Node >= 22, macOS 15+.",
      };
    }

    let version: string | undefined;
    try {
      version = execSync(
        binPath === "npx" ? "npx peekaboo --version 2>/dev/null" : `"${binPath}" --version 2>/dev/null || echo ""`,
        { encoding: "utf8", timeout: 5_000 },
      ).trim();
    } catch {
      // version check is optional
    }

    return { installed: true, version: version || undefined };
  }

  private checkMacOSPermissions(): ComputerPermissionStatus["permissions"] {
    const perms: ComputerPermissionStatus["permissions"] = [
      {
        name: "screen_recording",
        granted: this.hasScreenRecordingPermission(),
        required: true,
        description: "Screen Recording permission in System Settings > Privacy & Security",
      },
      {
        name: "accessibility",
        granted: this.hasAccessibilityPermission(),
        required: true,
        description: "Accessibility permission in System Settings > Privacy & Security",
      },
    ];
    return perms;
  }

  private hasScreenRecordingPermission(): boolean {
    // We can't read TCC.db directly (SIP-protected).
    // Quick existence check: if peekaboo binary is found, permissions may be grantable.
    return resolvePeekabooBin() !== null;
  }

  private hasAccessibilityPermission(): boolean {
    try {
      // Check if the system believes we have AX access
      // A quick heuristic: check if AX processes are visible
      const result = execSync(
        `osascript -e 'tell application "System Events" to count processes' 2>/dev/null || echo "0"`,
        { encoding: "utf8", timeout: 3_000 },
      ).trim();
      const count = parseInt(result, 10);
      return Number.isFinite(count) && count > 0;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Session Management
  // -----------------------------------------------------------------------

  private async ensureSession(): Promise<McpSession> {
    if (this.sessionState.kind === "ready") {
      return this.sessionState.session;
    }

    if (this.sessionState.kind === "initializing") {
      throw new Error("Peekaboo session is still initializing. Retry shortly.");
    }

    const binPath = resolvePeekabooBin();
    const installStatus = this.checkInstallation();
    if (!installStatus.installed || !binPath) {
      throw new Error(
        "Peekaboo is not installed. Install it with: npm install -g peekaboo\n" +
        "Or as a local dependency: pnpm add peekaboo\n" +
        "Requires Node >= 22 and macOS 15+.",
      );
    }

    this.sessionState = { kind: "initializing" };

    try {
      fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });

      const { command, args } = getPeekabooCommand(binPath);
      const session = new PersistentMcpSession("peekaboo", {
        serverCommand: command,
        serverArgs: args,
        initializeTimeoutMs: 15_000,
        requestTimeoutMs: 30_000,
      });

      await session.initialize();
      this.sessionState = { kind: "ready", session };
      this.logBuffer.push("[peekaboo] session initialized");
      return session;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.sessionState = { kind: "degraded", reason };
      this.logBuffer.push(`[peekaboo] session init failed: ${reason}`);
      throw new Error(`Failed to initialize Peekaboo session: ${reason}`);
    }
  }

  private async withSession<T>(
    fn: (session: McpSession) => Promise<T>,
  ): Promise<T> {
    let attemptedRestart = false;
    while (true) {
      try {
        const session = await this.ensureSession();
        return await fn(session);
      } catch (error) {
        if (attemptedRestart) {
          throw error;
        }
        this.logBuffer.push(
          `[peekaboo] request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        attemptedRestart = true;
        await this.restartSession();
      }
    }
  }

  private async restartSession(): Promise<void> {
    if (this.sessionState.kind === "ready") {
      const session = this.sessionState.session;
      this.sessionState = { kind: "uninitialized" };
      await session.dispose();
    } else {
      this.sessionState = { kind: "uninitialized" };
    }
    this.logBuffer.push("[peekaboo] session restarted");
  }

  // -----------------------------------------------------------------------
  // Artifact Management
  // -----------------------------------------------------------------------

  private ensureArtifactDir(): string {
    const runDir = path.join(ARTIFACT_ROOT, `run-${Date.now()}`);
    fs.mkdirSync(runDir, { recursive: true });
    return runDir;
  }

  private artifactPath(runDir: string, kind: string, ext: string): string {
    const ts = Date.now();
    const seq = Math.random().toString(36).slice(2, 6);
    return path.join(runDir, `${kind}-${ts}-${seq}.${ext}`);
  }

  // -----------------------------------------------------------------------
  // observe
  // -----------------------------------------------------------------------

  async observe(request: ComputerObserveRequest): Promise<ComputerObserveResult> {
    return this.withSession(async (session) => {
      const runDir = this.ensureArtifactDir();
      const artifacts: ComputerArtifact[] = [];

      // Call Peekaboo's "see" MCP tool
      const rawResult = (await session.callTool("see", {
        target: request.target,
        app: request.app,
        mode: request.mode ?? "full",
        annotate: request.annotate !== false,
        maxElements: request.maxElements ?? 50,
      }, request.signal)) as Record<string, unknown>;

      // Extract screenshot if included
      let screenshotArtifact: ComputerArtifact | undefined;
      if (rawResult.screenshot && typeof rawResult.screenshot === "string") {
        const screenshotPath = this.artifactPath(runDir, "screenshot", "png");
        const buffer = Buffer.from(rawResult.screenshot, "base64");
        fs.writeFileSync(screenshotPath, buffer);
        screenshotArtifact = {
          kind: "screenshot",
          path: screenshotPath,
          mimeType: "image/png",
          label: `Screenshot: ${request.target}`,
        };
        artifacts.push(screenshotArtifact);
      }

      // Extract UI elements
      const rawElements = Array.isArray(rawResult.elements) ? rawResult.elements : [];
      const elements = rawElements.map((el: unknown) => this.normalizeElement(el as Record<string, unknown>));

      // Save UI map artifact for large element trees
      let uiMapArtifact: ComputerArtifact | undefined;
      if (elements.length > 20) {
        const mapPath = this.artifactPath(runDir, "ui-map", "json");
        fs.writeFileSync(mapPath, JSON.stringify({ elements, snapshotId: rawResult.snapshotId }, null, 2));
        uiMapArtifact = {
          kind: "ui_map",
          path: mapPath,
          mimeType: "application/json",
          label: `UI Map (${elements.length} elements)`,
        };
        artifacts.push(uiMapArtifact);
      }

      return {
        backend: this.id,
        targetKind: request.targetKind,
        target: request.target,
        elements,
        screenshotArtifact,
        snapshotId: typeof rawResult.snapshotId === "string" ? rawResult.snapshotId : String(Date.now()),
        app: typeof rawResult.app === "string" ? rawResult.app : undefined,
        windowTitle: typeof rawResult.windowTitle === "string" ? rawResult.windowTitle : undefined,
        bounds: this.parseBounds(rawResult.bounds),
        artifacts,
        backendHandle: typeof rawResult.snapshotId === "string" ? rawResult.snapshotId : undefined,
      };
    });
  }

  // -----------------------------------------------------------------------
  // click
  // -----------------------------------------------------------------------

  async click(request: ComputerClickRequest): Promise<ComputerActionResult> {
    return this.withSession(async (session) => {
      const toolName = request.snapshotId ? "click" : "click";
      const rawResult = (await session.callTool(toolName, {
        on: request.target,
        snapshot: request.snapshotId,
        button: request.button ?? "left",
        clickCount: request.clickCount ?? 1,
      }, request.signal)) as Record<string, unknown>;

      return {
        backend: this.id,
        targetKind: request.targetKind,
        action: "click",
        success: !rawResult.error,
        target: request.target,
        affectedElement: rawResult.element ? this.normalizeElement(rawResult.element as Record<string, unknown>) : undefined,
        verificationHint: request.waitFor ?? "Verify by observing again.",
      };
    });
  }

  // -----------------------------------------------------------------------
  // type
  // -----------------------------------------------------------------------

  async type(request: ComputerTypeRequest): Promise<ComputerActionResult> {
    return this.withSession(async (session) => {
      if (request.clear) {
        try {
          await session.callTool("set-value", {
            on: request.target,
            snapshot: request.snapshotId,
            value: "",
          }, request.signal);
        } catch {
          // Clear failure is non-fatal; fall through to type
        }
      }

      const rawResult = (await session.callTool("type", {
        text: request.text,
        on: request.target,
        snapshot: request.snapshotId,
        delayMs: request.delayMs ?? 0,
      }, request.signal)) as Record<string, unknown>;

      if (request.submit) {
        try {
          await session.callTool("press", { keys: "enter" }, request.signal);
        } catch {
          // Submit failure is non-fatal
        }
      }

      return {
        backend: this.id,
        targetKind: request.targetKind,
        action: "type",
        success: !rawResult.error,
        target: request.target,
        verificationHint: `Typed ${request.text.length} characters. Verify input field content.`,
      };
    });
  }

  // -----------------------------------------------------------------------
  // press
  // -----------------------------------------------------------------------

  async press(request: ComputerPressRequest): Promise<ComputerActionResult> {
    return this.withSession(async (session) => {
      const keys = request.keys.toLowerCase();
      // Simple keys like enter, escape go through "press"
      // Key combinations like cmd,l go through "hotkey"
      const isCombo = keys.includes(",");
      const toolName = isCombo ? "hotkey" : "press";

      const rawResult = (await session.callTool(toolName, {
        keys: request.keys,
        count: request.count ?? 1,
        holdMs: request.holdMs,
      }, request.signal)) as Record<string, unknown>;

      return {
        backend: this.id,
        targetKind: request.targetKind,
        action: "press",
        success: !rawResult.error,
        target: request.keys,
        verificationHint: `Pressed ${request.keys}. Verify the expected UI response.`,
      };
    });
  }

  // -----------------------------------------------------------------------
  // scroll
  // -----------------------------------------------------------------------

  async scroll(request: ComputerScrollRequest): Promise<ComputerActionResult> {
    return this.withSession(async (session) => {
      const rawResult = (await session.callTool("scroll", {
        on: request.target,
        snapshot: request.snapshotId,
        direction: request.direction,
        amount: request.amount,
        unit: request.unit ?? "lines",
      }, request.signal)) as Record<string, unknown>;

      return {
        backend: this.id,
        targetKind: request.targetKind,
        action: "scroll",
        success: !rawResult.error,
        target: request.target,
        verificationHint: `Scrolled ${request.direction}. Verify content visibility.`,
      };
    });
  }

  // -----------------------------------------------------------------------
  // window
  // -----------------------------------------------------------------------

  async window(request: ComputerWindowRequest): Promise<ComputerActionResult> {
    return this.withSession(async (session) => {
      if (request.action === "list") {
        const rawResult = (await session.callTool("window", {
          action: "list",
          app: request.app,
        }, request.signal)) as Record<string, unknown>;

        const windows = Array.isArray(rawResult.windows) ? rawResult.windows : [];
        return {
          backend: this.id,
          targetKind: request.targetKind,
          action: "list",
          success: true,
          verificationHint: `Found ${windows.length} window(s).`,
        };
      }

      if (request.action === "focus") {
        const rawResult = (await session.callTool("window", {
          action: "focus",
          app: request.app,
          title: request.windowTitle,
        }, request.signal)) as Record<string, unknown>;

        return {
          backend: this.id,
          targetKind: request.targetKind,
          action: "focus",
          success: !rawResult.error,
          verificationHint: `Focused window${request.app ? ` of ${request.app}` : ""}.`,
        };
      }

      // Mutating actions: move, resize, minimize, maximize, close
      const rawResult = (await session.callTool("window", {
        action: request.action,
        app: request.app,
        title: request.windowTitle,
        bounds: request.bounds,
      }, request.signal)) as Record<string, unknown>;

      return {
        backend: this.id,
        targetKind: request.targetKind,
        action: request.action,
        success: !rawResult.error,
        verificationHint: `Window action '${request.action}' completed.`,
      };
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private normalizeElement(raw: Record<string, unknown>): ComputerUIElement {
    return {
      id: typeof raw.id === "string" ? raw.id : String(raw.id ?? ""),
      role: typeof raw.role === "string" ? raw.role : (typeof raw.role === "string" ? raw.role : "unknown"),
      label: typeof raw.label === "string" ? raw.label : undefined,
      value: typeof raw.value === "string" ? raw.value : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
      bounds: this.parseBounds(raw.bounds),
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
      focused: typeof raw.focused === "boolean" ? raw.focused : undefined,
    };
  }

  private parseBounds(raw: unknown): { x: number; y: number; width: number; height: number } | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const b = raw as Record<string, unknown>;
    const x = typeof b.x === "number" ? b.x : typeof b.x === "string" ? parseFloat(b.x) : NaN;
    const y = typeof b.y === "number" ? b.y : typeof b.y === "string" ? parseFloat(b.y) : NaN;
    const width = typeof b.width === "number" ? b.width : typeof b.width === "string" ? parseFloat(b.width) : NaN;
    const height = typeof b.height === "number" ? b.height : typeof b.height === "string" ? parseFloat(b.height) : NaN;
    if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) return undefined;
    return { x, y, width, height };
  }

  dispose(): void {
    if (this.sessionState.kind === "ready") {
      void this.sessionState.session.dispose();
    }
    this.sessionState = { kind: "uninitialized" };
  }
}
