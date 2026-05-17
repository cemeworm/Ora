import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

// ---------------------------------------------------------------------------
// Computer Use Bootstrap — Installation & Environment Detection
// ---------------------------------------------------------------------------
//
// Called during Ora initialization to report computer use availability.
// Provides install guidance and prerequisite checks without requiring
// the backends to be fully connected.
//

export interface ComputerUseBootstrapReport {
  timestamp: number;
  platform: string;
  nodeVersion: string;
  backends: {
    peekaboo: PeekabooBootstrapResult;
    page: PageBootstrapResult;
  };
  summary: ComputerUseAvailabilitySummary;
}

export interface PeekabooBootstrapResult {
  available: boolean;
  installPath?: string;
  version?: string;
  nodeVersionOk: boolean;
  nodeVersionRequired: string;
  installHint?: string;
  permissionHints: string[];
}

export interface PageBootstrapResult {
  available: boolean;
  browserPath?: string;
  browserName?: string;
  installHint?: string;
}

export interface ComputerUseAvailabilitySummary {
  anyAvailable: boolean;
  peekabooAvailable: boolean;
  pageAvailable: boolean;
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Peekaboo Detection
// ---------------------------------------------------------------------------

const PEEKABOO_REQUIRED_NODE = "22.0.0";

function detectPeekaboo(): PeekabooBootstrapResult {
  const nodeVersionOk = parseNodeVersion(process.version) >= parseNodeVersion(PEEKABOO_REQUIRED_NODE);

  let installPath: string | undefined;
  let version: string | undefined;

  try {
    installPath = execSync("which peekaboo 2>/dev/null || echo ''", {
      encoding: "utf8",
      timeout: 3_000,
    }).trim();
  } catch {
    installPath = undefined;
  }

  if (installPath) {
    try {
      version = execSync(`"${installPath}" --version 2>/dev/null || echo ""`, {
        encoding: "utf8",
        timeout: 3_000,
      }).trim();
    } catch {
      // Version check is optional
    }
  }

  const permissionHints: string[] = [];
  if (installPath) {
    permissionHints.push(
      "Screen Recording: System Settings > Privacy & Security > Screen Recording",
      "Accessibility: System Settings > Privacy & Security > Accessibility",
    );
  }

  const available = Boolean(installPath) && nodeVersionOk;

  return {
    available,
    installPath: installPath || undefined,
    version: version || undefined,
    nodeVersionOk,
    nodeVersionRequired: PEEKABOO_REQUIRED_NODE,
    installHint: !installPath
      ? "Install Peekaboo: npm install -g peekaboo (requires Node >= 22, macOS 15+)"
      : !nodeVersionOk
        ? `Node version ${process.version} is below the required ${PEEKABOO_REQUIRED_NODE}. Upgrade Node.js.`
        : undefined,
    permissionHints,
  };
}

// ---------------------------------------------------------------------------
// Browser Detection
// ---------------------------------------------------------------------------

const MACOS_BROWSER_CANDIDATES: { path: string; name: string }[] = [
  { path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", name: "Google Chrome" },
  { path: "/Applications/Chromium.app/Contents/MacOS/Chromium", name: "Chromium" },
  { path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", name: "Microsoft Edge" },
];

function detectBrowser(): PageBootstrapResult {
  for (const candidate of MACOS_BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate.path)) {
      return {
        available: true,
        browserPath: candidate.path,
        browserName: candidate.name,
      };
    }
  }

  // Try which
  try {
    const result = execSync("which chromium google-chrome chrome 2>/dev/null || echo ''", {
      encoding: "utf8",
      timeout: 3_000,
    }).trim().split("\n")[0];
    if (result && fs.existsSync(result)) {
      return {
        available: true,
        browserPath: result,
        browserName: pathToBrowserName(result),
      };
    }
  } catch {
    // Not found
  }

  return {
    available: false,
    installHint: os.platform() === "darwin"
      ? "Install Google Chrome (google.com/chrome) for page automation."
      : "Install Chromium or Google Chrome for page automation.",
  };
}

function pathToBrowserName(p: string): string {
  const lower = p.toLowerCase();
  if (lower.includes("chrome")) return "Google Chrome";
  if (lower.includes("chromium")) return "Chromium";
  if (lower.includes("edge")) return "Microsoft Edge";
  return "Chromium-based browser";
}

// ---------------------------------------------------------------------------
// Bootstrap Report
// ---------------------------------------------------------------------------

export function computerUseBootstrap(): ComputerUseBootstrapReport {
  const peekaboo = detectPeekaboo();
  const page = detectBrowser();

  const recommendations: string[] = [];
  if (!peekaboo.available && !page.available) {
    recommendations.push(
      "No computer use backends available. Install at least one:",
      "  • Peekaboo: npm install -g peekaboo (macOS GUI automation)",
      "  • Chrome/Chromium: for page/DOM automation",
    );
  }
  if (!peekaboo.available && peekaboo.installHint) {
    recommendations.push(`Peekaboo: ${peekaboo.installHint}`);
  }
  if (!page.available && page.installHint) {
    recommendations.push(`Page backend: ${page.installHint}`);
  }
  if (peekaboo.available && peekaboo.permissionHints.length > 0) {
    recommendations.push(
      "Peekaboo detected. Ensure macOS permissions are granted:",
      ...peekaboo.permissionHints.map((h) => `  • ${h}`),
    );
  }

  return {
    timestamp: Date.now(),
    platform: `${os.platform()} ${os.release()}`,
    nodeVersion: process.version,
    backends: { peekaboo, page },
    summary: {
      anyAvailable: peekaboo.available || page.available,
      peekabooAvailable: peekaboo.available,
      pageAvailable: page.available,
      recommendations,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNodeVersion(version: string): number {
  const match = version.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return 0;
  return parseInt(match[1]!, 10) * 1_000_000 + parseInt(match[2]!, 10) * 1_000 + parseInt(match[3]!, 10);
}
