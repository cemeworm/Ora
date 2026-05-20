export interface DesktopBuildInfo {
  version: string;
  tag?: string;
  commit?: string;
  builtAt?: string;
  workflow?: string;
}

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as TauriWindow);
}

export async function loadDesktopBuildInfo(): Promise<DesktopBuildInfo> {
  let version = "unknown";

  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    version = await getVersion();
  } catch {
    // Fall back to metadata or "unknown" when not running inside Tauri.
  }

  if (!isTauriAvailable()) {
    return { version };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<DesktopBuildInfo>("desktop_build_info");
    return {
      version: info.version || version,
      tag: info.tag,
      commit: info.commit,
      builtAt: info.builtAt,
      workflow: info.workflow,
    };
  } catch {
    return { version };
  }
}
