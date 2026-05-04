export interface DesktopToolModelSettings {
  providerId: string;
}

const TOOL_MODEL_SETTINGS_STORAGE_KEY = "ora.toolModelSettings.v1";

export const DEFAULT_TOOL_MODEL_SETTINGS: DesktopToolModelSettings = {
  providerId: "auto",
};

export function loadDesktopToolModelSettings(): DesktopToolModelSettings {
  if (typeof window === "undefined") {
    return DEFAULT_TOOL_MODEL_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(TOOL_MODEL_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_TOOL_MODEL_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<DesktopToolModelSettings>;
    return {
      ...DEFAULT_TOOL_MODEL_SETTINGS,
      providerId: typeof parsed.providerId === "string" ? parsed.providerId : DEFAULT_TOOL_MODEL_SETTINGS.providerId,
    };
  } catch {
    return DEFAULT_TOOL_MODEL_SETTINGS;
  }
}

export function saveDesktopToolModelSettings(settings: DesktopToolModelSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(TOOL_MODEL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
