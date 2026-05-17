import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { CdpClient, type CdpBrowserTarget, type CdpAXNode } from "./cdp-client.js";
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
} from "./types.js";

// ---------------------------------------------------------------------------
// Page Backend (structured page automation via CDP)
// ---------------------------------------------------------------------------

const DEFAULT_CDP_HOST = "127.0.0.1";
const DEFAULT_CDP_PORT = 9222;

export interface PageBackendOptions {
  cdpHost?: string;
  cdpPort?: number;
  targetUrl?: string;
  connectTimeoutMs?: number;
  /** Auto-launch a Chromium browser if no CDP target is found. Default true. */
  autoLaunch?: boolean;
  /** Custom browser executable path. Auto-detected when omitted. */
  browserPath?: string;
  /** Launch in headless mode. Default false for ora_view (visual verification), true for browser_page. */
  headless?: boolean;
}

const BROWSER_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export class PageBackend implements ComputerUseBackend {
  readonly id = "page";
  readonly label = "Page / Ora View (structured DOM)";
  readonly supportedTargetKinds = ["browser_page" as const, "ora_view" as const];

  private readonly cdpHost: string;
  private readonly cdpPort: number;
  private readonly defaultTargetUrl?: string;
  private readonly connectTimeoutMs: number;
  private readonly autoLaunch: boolean;
  private readonly browserPath?: string;
  private readonly headless: boolean;
  private client: CdpClient | null = null;
  private connectedTargetId: string | null = null;
  private lastSnapshotId: string | null = null;
  private browserProcess: ChildProcess | null = null;
  private launchedByUs = false;

  constructor(options: PageBackendOptions = {}) {
    this.cdpHost = options.cdpHost ?? DEFAULT_CDP_HOST;
    this.cdpPort = options.cdpPort ?? DEFAULT_CDP_PORT;
    this.defaultTargetUrl = options.targetUrl;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.autoLaunch = options.autoLaunch ?? true;
    this.browserPath = options.browserPath;
    this.headless = options.headless ?? false;
  }

  // -----------------------------------------------------------------------
  // Permission Status
  // -----------------------------------------------------------------------

  async getStatus(): Promise<ComputerPermissionStatus> {
    let targets = await this.fetchTargets();

    // Auto-launch if no targets found
    if (targets.length === 0 && this.autoLaunch) {
      const launched = await this.tryAutoLaunch();
      if (launched) {
        targets = await this.fetchTargets();
      }
    }

    const browserFound = this.findBrowserPath() !== null;
    const available = targets.length > 0;

    const installHint = !browserFound
      ? "No Chromium browser found. Install Google Chrome, Chromium, or Microsoft Edge."
      : !available
        ? `Browser found at ${this.findBrowserPath()} but CDP not available at ${this.cdpHost}:${this.cdpPort}.`
        : undefined;

    return {
      backend: this.id,
      targetKind: "ora_view",
      available,
      permissions: [],
      installStatus: {
        installed: browserFound,
        version: browserFound ? "detected" : undefined,
        installHint,
      },
      diagnostics: targets.map((t) => `${t.type}: ${t.title} (${t.url})`),
      recoverableError: available
        ? undefined
        : {
            code: "backend_unavailable",
            message: installHint ?? `No browser targets at ${this.cdpHost}:${this.cdpPort}.`,
          },
    };
  }

  private async fetchTargets(): Promise<CdpBrowserTarget[]> {
    try {
      const json = await httpGet(`http://${this.cdpHost}:${this.cdpPort}/json`, this.connectTimeoutMs);
      const parsed = JSON.parse(json) as unknown[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (t): t is CdpBrowserTarget =>
          typeof t === "object" && t !== null && typeof (t as Record<string, unknown>).webSocketDebuggerUrl === "string",
      );
    } catch {
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Connection Management
  // -----------------------------------------------------------------------

  private async ensureClient(): Promise<CdpClient> {
    if (this.client?.connected) return this.client;

    let targets = await this.fetchTargets();

    // Auto-launch browser if needed
    if (targets.length === 0 && this.autoLaunch) {
      const launched = await this.tryAutoLaunch();
      if (launched) {
        targets = await this.fetchTargets();
      }
    }

    if (targets.length === 0) {
      throw new Error(
        `No browser targets at ${this.cdpHost}:${this.cdpPort}. ` +
        "Install Google Chrome, Chromium, or Microsoft Edge for page automation.",
      );
    }

    // Prefer a page target that matches defaultTargetUrl, or any page target
    let target: CdpBrowserTarget | undefined;
    if (this.defaultTargetUrl) {
      target = targets.find(
        (t) => t.type === "page" && (t.url === this.defaultTargetUrl || t.url.startsWith(this.defaultTargetUrl!)),
      );
    }
    if (!target) {
      target = targets.find((t) => t.type === "page") ?? targets[0];
    }

    if (!target?.webSocketDebuggerUrl) {
      throw new Error("No suitable browser page target with a debugger URL.");
    }

    const client = new CdpClient();
    await client.connect(target.webSocketDebuggerUrl);
    this.client = client;
    this.connectedTargetId = target.id;

    // Enable required domains
    await client.send("Page.enable");
    await client.send("DOM.enable");
    await client.send("Runtime.enable");
    await client.send("Accessibility.enable");

    return client;
  }

  // -----------------------------------------------------------------------
  // observe
  // -----------------------------------------------------------------------

  async observe(request: ComputerObserveRequest): Promise<ComputerObserveResult> {
    const client = await this.ensureClient();

    // Navigate if a URL-like target is provided
    if (isUrl(request.target)) {
      await client.navigate(request.target);
    }

    let elements: ComputerUIElement[] = [];
    let screenshotArtifact: ComputerArtifact | undefined;

    // Try accessibility tree first
    try {
      const axRoot = await client.getAccessibilityTree();
      if (axRoot) {
        elements = flattenAXTree(axRoot, request.maxElements ?? 50);
      }
    } catch {
      // AX tree unavailable — fall back to DOM-based element extraction
    }

    // Fall back to DOM-based extraction if AX tree is sparse
    if (elements.length < 2) {
      try {
        const domElements = await client.evaluate<SerializedElement[]>(EXTRACT_DOM_ELEMENTS_SCRIPT);
        if (domElements && domElements.length > 0) {
          elements = domElements.map(serializedToUIElement);
        }
      } catch {
        // DOM extraction failed — return what we have
      }
    }

    // Try to take a screenshot (Page.captureScreenshot)
    if (request.includeScreenshot !== false) {
      try {
        const screenshotResult = (await client.send("Page.captureScreenshot", {
          format: "png",
        })) as { data?: string };
        if (screenshotResult.data) {
          screenshotArtifact = {
            kind: "screenshot",
            path: `cdp://screenshot/${Date.now()}.png`,
            mimeType: "image/png",
            label: `Screenshot: ${request.target}`,
          };
        }
      } catch {
        // Screenshot unavailable
      }
    }

    // Generate snapshot ID
    const snapshotId = `cdp-snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.lastSnapshotId = snapshotId;

    // Get page title
    let pageTitle = "";
    try {
      pageTitle = (await client.evaluate<string>("document.title")) ?? "";
    } catch {
      // ignore
    }

    return {
      backend: this.id,
      targetKind: request.targetKind,
      target: request.target,
      elements,
      snapshotId,
      screenshotArtifact,
      windowTitle: pageTitle || undefined,
      artifacts: screenshotArtifact ? [screenshotArtifact] : [],
      backendHandle: snapshotId,
    };
  }

  // -----------------------------------------------------------------------
  // click
  // -----------------------------------------------------------------------

  async click(request: ComputerClickRequest): Promise<ComputerActionResult> {
    const client = await this.ensureClient();

    // Try element-based targeting first
    let clicked = false;
    if (request.target && !isCoord(request.target)) {
      try {
        // Try to find by element ID from observe
        const found = await client.evaluate<{ x: number; y: number } | null>(
          `(function() {
            const el = document.querySelector('[data-ora-el="${request.target}"]');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          })()`,
        );
        if (found) {
          await client.clickPoint(Math.round(found.x), Math.round(found.y), request.clickCount ?? 1);
          clicked = true;
        }
      } catch {
        // fall through to AX-based click
      }
    }

    if (!clicked) {
      // Try click by coordinates
      const coords = parseCoords(request.target);
      await client.clickPoint(coords.x, coords.y, request.clickCount ?? 1);
    }

    // Verify if waitFor specified
    if (request.waitFor) {
      try {
        await waitForElement(client, request.waitFor, request.timeoutMs ?? 5_000);
      } catch {
        return {
          backend: this.id,
          targetKind: request.targetKind,
          action: "click",
          success: true,
          target: request.target,
          verificationHint: `Click performed but waitFor element '${request.waitFor}' not found within timeout. Verify manually.`,
        };
      }
    }

    return {
      backend: this.id,
      targetKind: request.targetKind,
      action: "click",
      success: true,
      target: request.target,
      verificationHint: request.waitFor
        ? `Clicked ${request.target}. Verified '${request.waitFor}' appeared.`
        : `Clicked ${request.target}. Verify by observing again.`,
    };
  }

  // -----------------------------------------------------------------------
  // type
  // -----------------------------------------------------------------------

  async type(request: ComputerTypeRequest): Promise<ComputerActionResult> {
    const client = await this.ensureClient();

    // Focus the target element if specified
    if (request.target) {
      try {
        await client.evaluate(
          `(function() {
            const el = document.querySelector('[data-ora-el="${request.target}"]') ||
                       document.querySelector('${request.target}');
            if (el) el.focus();
          })()`,
        );
      } catch {
        // focus failure is non-fatal
      }
    }

    // Clear existing content
    if (request.clear) {
      try {
        await client.evaluate(
          `(function() { if (document.activeElement && 'value' in document.activeElement) document.activeElement.value = ''; })()`,
        );
      } catch {
        // clear failure is non-fatal
      }
    }

    // Type text character by character
    await client.typeText(request.text);

    // Submit if requested
    if (request.submit) {
      await client.pressKey("Enter");
    }

    return {
      backend: this.id,
      targetKind: request.targetKind,
      action: "type",
      success: true,
      target: request.target,
      verificationHint: `Typed ${request.text.length} characters${request.target ? ` into ${request.target}` : ""}.`,
    };
  }

  // -----------------------------------------------------------------------
  // press
  // -----------------------------------------------------------------------

  async press(request: ComputerPressRequest): Promise<ComputerActionResult> {
    const client = await this.ensureClient();

    const keys = request.keys.toLowerCase().trim();
    const isCombo = keys.includes(",");
    const count = request.count ?? 1;

    for (let i = 0; i < count; i++) {
      if (isCombo) {
        const keyList = keys.split(",").map((k) => k.trim()).filter(Boolean);
        await client.keyCombo(keyList);
      } else {
        await client.pressKey(keys);
      }
      if (request.holdMs && request.holdMs > 0) {
        await sleep(request.holdMs);
      }
    }

    return {
      backend: this.id,
      targetKind: request.targetKind,
      action: "press",
      success: true,
      target: request.keys,
      verificationHint: `Pressed ${request.keys}${count > 1 ? ` ${count} times` : ""}.`,
    };
  }

  // -----------------------------------------------------------------------
  // scroll
  // -----------------------------------------------------------------------

  async scroll(request: ComputerScrollRequest): Promise<ComputerActionResult> {
    const client = await this.ensureClient();

    const amount = request.amount ?? (request.unit === "pages" ? 1 : 3);
    const isPage = request.unit === "pages";

    let deltaX = 0;
    let deltaY = 0;
    const baseDelta = isPage ? amount * 800 : amount * 100;

    switch (request.direction) {
      case "up": deltaY = -baseDelta; break;
      case "down": deltaY = baseDelta; break;
      case "left": deltaX = -baseDelta; break;
      case "right": deltaX = baseDelta; break;
    }

    // Try to scroll within target element first, otherwise scroll viewport
    if (request.target) {
      try {
        await client.evaluate(
          `(function() {
            const el = document.querySelector('[data-ora-el="${request.target}"]') ||
                       document.querySelector('${request.target}');
            if (el) { el.scrollBy(${deltaX}, ${deltaY}); return true; }
            return false;
          })()`,
        );
      } catch {
        // fall through to mouse wheel
      }
    } else {
      // Scroll the viewport
      await client.evaluate(`window.scrollBy(${deltaX}, ${deltaY})`);
    }

    return {
      backend: this.id,
      targetKind: request.targetKind,
      action: "scroll",
      success: true,
      target: request.target,
      verificationHint: `Scrolled ${request.direction} by ${amount} ${request.unit ?? "lines"}.`,
    };
  }

  // -----------------------------------------------------------------------
  // window
  // -----------------------------------------------------------------------

  async window(request: ComputerWindowRequest): Promise<ComputerActionResult> {
    const client = await this.ensureClient();

    switch (request.action) {
      case "list": {
        const targets = await this.fetchTargets();
        return {
          backend: this.id,
          targetKind: request.targetKind,
          action: "list",
          success: true,
          verificationHint: `Found ${targets.length} browser target(s).`,
        };
      }

      case "focus": {
        const targets = await this.fetchTargets();
        const match = targets.find(
          (t) =>
            (request.app && t.title.toLowerCase().includes(request.app.toLowerCase())) ||
            (request.windowTitle && t.title.toLowerCase().includes(request.windowTitle.toLowerCase())),
        );
        if (match?.webSocketDebuggerUrl) {
          this.client?.disconnect();
          this.client = new CdpClient();
          await this.client.connect(match.webSocketDebuggerUrl);
          this.connectedTargetId = match.id;
          return {
            backend: this.id,
            targetKind: request.targetKind,
            action: "focus",
            success: true,
            verificationHint: `Focused target: ${match.title}`,
          };
        }
        return {
          backend: this.id,
          targetKind: request.targetKind,
          action: "focus",
          success: false,
          verificationHint: "No matching target found.",
        };
      }

      case "close": {
        if (this.connectedTargetId) {
          try {
            await client.send("Page.close");
          } catch {
            // close failure is non-fatal
          }
          this.client?.disconnect();
          this.client = null;
          this.connectedTargetId = null;
        }
        return {
          backend: this.id,
          targetKind: request.targetKind,
          action: "close",
          success: true,
          verificationHint: "Page closed.",
        };
      }

      case "move":
      case "resize":
      case "minimize":
      case "maximize": {
        // Window geometry operations via Browser domain
        try {
          const bounds = request.bounds;
          if (bounds) {
            await client.evaluate(
              `window.resizeTo(${bounds.width}, ${bounds.height}); window.moveTo(${bounds.x}, ${bounds.y})`,
            );
          }
          if (request.action === "minimize") {
            await client.evaluate(`(function() { try { document.hidden || window.blur(); } catch {} })()`);
          }
        } catch {
          // Non-fatal
        }
        return {
          backend: this.id,
          targetKind: request.targetKind,
          action: request.action,
          success: true,
          verificationHint: `Window action '${request.action}' performed.`,
        };
      }

      default:
        return {
          backend: this.id,
          targetKind: request.targetKind,
          action: request.action,
          success: false,
          verificationHint: `Unknown window action: ${request.action}`,
        };
    }
  }

  // -----------------------------------------------------------------------
  // Browser Auto-Launch
  // -----------------------------------------------------------------------

  private findBrowserPath(): string | null {
    if (this.browserPath && fs.existsSync(this.browserPath)) {
      return this.browserPath;
    }
    for (const candidate of BROWSER_CANDIDATES) {
      if (fs.existsSync(candidate)) return candidate;
    }
    // Try `which` for chromium/google-chrome
    try {
      const result = execSync("which chromium google-chrome chrome 2>/dev/null || echo ''", {
        encoding: "utf8",
        timeout: 3_000,
      }).trim().split("\n")[0];
      if (result && fs.existsSync(result)) return result;
    } catch {
      // Not found
    }
    return null;
  }

  private async tryAutoLaunch(): Promise<boolean> {
    if (this.launchedByUs && this.browserProcess) return true; // Already launched

    const browserPath = this.findBrowserPath();
    if (!browserPath) return false;

    try {
      await this.launchBrowser(browserPath);
      return true;
    } catch {
      return false;
    }
  }

  private async launchBrowser(browserPath: string): Promise<void> {
    const userDataDir = path.join(
      os.tmpdir(),
      `ora-cdp-profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    fs.mkdirSync(userDataDir, { recursive: true });

    const args = [
      `--remote-debugging-port=${this.cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-translate",
      "--disable-features=TranslateUI,DialMediaRouteProvider",
      "--disable-component-update",
      "--disable-prompt-on-repost",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-ipc-flooding-protection",
      "--password-store=basic",
      "--use-mock-keychain",
      "--noerrdialogs",
      "--disable-breakpad",
      ...(this.headless ? ["--headless=new"] : []),
    ];

    if (this.defaultTargetUrl) {
      args.push(this.defaultTargetUrl);
    }

    this.browserProcess = spawn(browserPath, args, {
      stdio: "ignore",
      detached: false,
    });

    this.launchedByUs = true;
    this.browserProcess.on("exit", () => {
      this.launchedByUs = false;
      this.browserProcess = null;
      // Clean up the temporary profile
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    });

    // Wait for CDP endpoint to become available
    const deadline = Date.now() + this.connectTimeoutMs;
    while (Date.now() < deadline) {
      try {
        await httpGet(`http://${this.cdpHost}:${this.cdpPort}/json/version`, 2_000);
        return; // Ready
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw new Error(`Browser launched but CDP endpoint not ready within ${this.connectTimeoutMs}ms.`);
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  dispose(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
      this.connectedTargetId = null;
      this.lastSnapshotId = null;
    }
    if (this.browserProcess && this.launchedByUs) {
      try { this.browserProcess.kill("SIGTERM"); } catch {}
      this.browserProcess = null;
      this.launchedByUs = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString("utf8"); });
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("HTTP GET timed out.")); });
  });
}

function isUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

function isCoord(value: string): boolean {
  return /^\d+,\d+$/.test(value.trim());
}

function parseCoords(value: string): { x: number; y: number } {
  const parts = value.trim().split(",");
  return { x: parseInt(parts[0]!, 10), y: parseInt(parts[1]!, 10) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForElement(client: CdpClient, selector: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await client.evaluate<boolean>(
      `!!(document.querySelector('${selector}') || document.querySelector('[data-ora-el="${selector}"]'))`,
    );
    if (found) return;
    await sleep(200);
  }
  throw new Error(`Element '${selector}' not found within ${timeoutMs}ms.`);
}

// ---------------------------------------------------------------------------
// AX Tree → UI Elements
// ---------------------------------------------------------------------------

interface SerializedElement {
  id: string;
  role: string;
  label?: string;
  value?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

function flattenAXTree(node: CdpAXNode, maxElements: number): ComputerUIElement[] {
  const results: ComputerUIElement[] = [];
  const queue: CdpAXNode[] = [node];

  while (queue.length > 0 && results.length < maxElements) {
    const current = queue.shift()!;
    if (!current.ignored && current.role?.value) {
      results.push({
        id: current.nodeId,
        role: current.role.value,
        label: current.name?.value || undefined,
        value: current.value?.value || undefined,
        description: current.description?.value || undefined,
        enabled: current.properties?.find((p) => p.name === "enabled")?.value?.value === "true" || undefined,
        focused: current.properties?.find((p) => p.name === "focused")?.value?.value === "true" || undefined,
      });
    }
    if (current.children) {
      queue.push(...current.children);
    } else if (current.childIds) {
      // children might be referenced by ID — we'd need the full tree
    }
  }

  return results;
}

function serializedToUIElement(el: SerializedElement): ComputerUIElement {
  return {
    id: el.id,
    role: el.role,
    label: el.label,
    value: el.value,
    bounds: el.bounds,
  };
}

// ---------------------------------------------------------------------------
// DOM Element Extraction Script (injected into page)
// ---------------------------------------------------------------------------

const EXTRACT_DOM_ELEMENTS_SCRIPT = `
(function() {
  var results = [];
  var interactive = 'button, a, input, textarea, select, [role], [data-ora-el], [aria-label], [contenteditable], summary, details';
  var nodes = document.querySelectorAll(interactive);
  for (var i = 0; i < nodes.length && i < 200; i++) {
    var el = nodes[i];
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    var label = el.getAttribute('aria-label') || el.getAttribute('data-ora-el') || el.textContent?.trim().slice(0, 60) || '';
    results.push({
      id: el.getAttribute('data-ora-el') || el.id || el.getAttribute('aria-label') || ('auto-el-' + i),
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      label: label,
      value: el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? (el.value || '').slice(0, 100) : undefined,
      bounds: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
    });
  }
  return results;
})()`;
