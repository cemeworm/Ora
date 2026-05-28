import type { OraRunConfig } from "./runtimeClient";

export type DesktopSearchProviderId = "auto" | NonNullable<NonNullable<OraRunConfig["searchProvider"]>["id"]>;

export interface DesktopSearchSettings {
  enabled: boolean;
  providerId: DesktopSearchProviderId;
  apiKeyEnv: string;
  maxResults: string;
  timeoutMs: string;
  mcpServerId: string;
  mcpToolName: string;
}

const SEARCH_SETTINGS_STORAGE_KEY = "ora.searchSettings.v1";

export const DEFAULT_SEARCH_SETTINGS: DesktopSearchSettings = {
  enabled: true,
  providerId: "mcp",
  apiKeyEnv: "ANYSEARCH_API_KEY",
  maxResults: "5",
  timeoutMs: "8000",
  mcpServerId: "anysearch",
  mcpToolName: "search",
};

export function loadDesktopSearchSettings(): DesktopSearchSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SEARCH_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(SEARCH_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SEARCH_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<DesktopSearchSettings>;
    return {
      ...DEFAULT_SEARCH_SETTINGS,
      ...parsed,
      providerId: isDesktopSearchProviderId(parsed.providerId) ? parsed.providerId : DEFAULT_SEARCH_SETTINGS.providerId,
      enabled: parsed.enabled !== false,
    };
  } catch {
    return DEFAULT_SEARCH_SETTINGS;
  }
}

export function saveDesktopSearchSettings(settings: DesktopSearchSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SEARCH_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function buildRunSearchConfig(settings = loadDesktopSearchSettings()): {
  searchProvider?: OraRunConfig["searchProvider"];
  metadata: Record<string, unknown>;
} {
  if (!settings.enabled) {
    return {
      metadata: { disableDefaultWebTools: true },
    };
  }

  const searchProvider: NonNullable<OraRunConfig["searchProvider"]> = {
    maxResults: readPositiveInt(settings.maxResults, 10) ?? DEFAULT_SEARCH_SETTINGS_MAX_RESULTS,
    timeoutMs: readPositiveInt(settings.timeoutMs, 30_000) ?? DEFAULT_SEARCH_SETTINGS_TIMEOUT_MS,
  };
  if (settings.providerId !== "auto") {
    searchProvider.id = settings.providerId;
  }
  const apiKeyEnv = normalizeSearchApiKeyEnv(settings.apiKeyEnv);
  if (apiKeyEnv) {
    searchProvider.apiKeyEnv = apiKeyEnv;
  }
  if (settings.providerId === "mcp") {
    if (settings.mcpServerId.trim()) {
      searchProvider.mcpServerId = settings.mcpServerId.trim();
    }
    if (settings.mcpToolName.trim()) {
      searchProvider.mcpToolName = settings.mcpToolName.trim();
    }
  }

  return {
    searchProvider: Object.keys(searchProvider).length > 0 ? searchProvider : undefined,
    metadata: {},
  };
}

export function normalizeSearchApiKeyEnv(value: string): string | undefined {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z_][A-Z0-9_]*$/.test(normalized) ? normalized : undefined;
}

const DEFAULT_SEARCH_SETTINGS_MAX_RESULTS = 5;
const DEFAULT_SEARCH_SETTINGS_TIMEOUT_MS = 8000;

function readPositiveInt(value: string, max: number): number | undefined {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.min(parsed, max);
}

function isDesktopSearchProviderId(value: unknown): value is DesktopSearchProviderId {
  return value === "auto"
    || value === "brave"
    || value === "tavily"
    || value === "serpapi"
    || value === "kagi"
    || value === "duckduckgo"
    || value === "mcp";
}
