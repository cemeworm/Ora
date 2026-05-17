import type { ComputerTargetKind } from "@cemeworm/shared";
import type {
  ComputerUseBackend,
  ComputerPermissionStatus,
  ComputerRecoverableError,
} from "./types.js";

// ---------------------------------------------------------------------------
// Backend Manager
// ---------------------------------------------------------------------------

export class ComputerBackendManager {
  private readonly backends = new Map<string, ComputerUseBackend>();
  private degraded = new Set<string>();

  register(backend: ComputerUseBackend): void {
    this.backends.set(backend.id, backend);
  }

  unregister(backendId: string): void {
    this.backends.delete(backendId);
    this.degraded.delete(backendId);
  }

  get(backendId: string): ComputerUseBackend | undefined {
    return this.backends.get(backendId);
  }

  isDegraded(backendId: string): boolean {
    return this.degraded.has(backendId);
  }

  markDegraded(backendId: string): void {
    this.degraded.add(backendId);
  }

  clearDegraded(backendId: string): void {
    this.degraded.delete(backendId);
  }

  selectBackend(targetKind: ComputerTargetKind): ComputerUseBackend | undefined {
    const all = Array.from(this.backends.values()).filter(
      (b) => !this.degraded.has(b.id) && b.supportedTargetKinds.includes(targetKind),
    );

    if (all.length === 0) return undefined;

    // Routing rule: prefer page backend for browser_page and ora_view;
    // prefer Peekaboo for native_app
    if (targetKind === "native_app") {
      const peekaboo = all.find((b) => b.id === "peekaboo");
      if (peekaboo) return peekaboo;
    }
    if (targetKind === "browser_page" || targetKind === "ora_view") {
      const page = all.find((b) => b.id === "page");
      if (page) return page;
      // Fallback to Peekaboo for ora_view (packaged WebView, etc.)
      const peekaboo = all.find((b) => b.id === "peekaboo");
      if (peekaboo) return peekaboo;
    }
    return all[0];
  }

  async permissionStatus(targetKind?: ComputerTargetKind): Promise<ComputerPermissionStatus> {
    const statuses = await Promise.all(
      Array.from(this.backends.values()).map(async (backend) => {
        try {
          return await backend.getStatus();
        } catch {
          return degradedStatus(backend.id);
        }
      }),
    );

    // Merge all backend statuses
    const merged = mergePermissionStatuses(statuses);
    if (targetKind) {
      const suitable = this.selectBackend(targetKind);
      if (!suitable) {
        merged.available = false;
        merged.recoverableError = {
          code: "backend_unavailable",
          message: `No available backend for target kind: ${targetKind}`,
        };
      }
    }
    return merged;
  }

  disposeAll(): void {
    for (const backend of this.backends.values()) {
      try {
        void backend.dispose();
      } catch {
        // Best-effort cleanup
      }
    }
    this.backends.clear();
    this.degraded.clear();
  }
}

function degradedStatus(backendId: string): ComputerPermissionStatus {
  return {
    backend: backendId,
    targetKind: "native_app",
    available: false,
    permissions: [],
    recoverableError: {
      code: "backend_unavailable",
      message: `Backend ${backendId} is unavailable or failed to report status.`,
    },
  };
}

function mergePermissionStatuses(statuses: ComputerPermissionStatus[]): ComputerPermissionStatus {
  if (statuses.length === 0) {
    return {
      backend: "none",
      targetKind: "native_app",
      available: false,
      permissions: [],
      recoverableError: {
        code: "backend_unavailable",
        message: "No computer use backends are registered.",
      },
    };
  }

  if (statuses.length === 1) {
    return statuses[0]!;
  }

  // Merge: available if any backend is available
  const primary = statuses.find((s) => s.available) ?? statuses[0]!;
  return {
    ...primary,
    available: statuses.some((s) => s.available),
    permissions: statuses.flatMap((s) => s.permissions),
    diagnostics: statuses.flatMap((s) => s.diagnostics ?? []),
  };
}
