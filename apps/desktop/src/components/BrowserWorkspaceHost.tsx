import { useEffect, useMemo, useRef, useState } from "react";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

type BrowserWorkspaceHostProps = {
  pageId: string;
  url?: string;
  reloadKey: number;
  onLoadingChange?: (loading: boolean) => void;
};

type BrowserRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TauriWebviewHandle = {
  close: () => Promise<void>;
  once: (
    event: "tauri://created" | "tauri://error",
    handler: (event: { payload?: unknown }) => void,
  ) => Promise<() => void>;
  setPosition: (position: { x: number; y: number }) => Promise<void>;
  setSize: (size: { width: number; height: number }) => Promise<void>;
  setFocus: () => Promise<void>;
};

function isTauriDesktopAvailable(): boolean {
  return typeof window !== "undefined" && Boolean((window as TauriWindow).__TAURI_INTERNALS__);
}

function browserWebviewLabel(pageId: string): string {
  return `right-workspace-browser:${pageId}`;
}

const BROWSER_WEBVIEW_RADIUS = 18;
const BROWSER_WEBVIEW_INSET = 1;

function rectEquals(left: BrowserRect | undefined, right: BrowserRect | undefined): boolean {
  return Boolean(
    left &&
      right &&
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height,
  );
}

function readMountRect(element: HTMLDivElement | null): BrowserRect | undefined {
  if (!element) {
    return undefined;
  }
  const rect = element.getBoundingClientRect();
  const width = Math.round(rect.width - BROWSER_WEBVIEW_INSET * 2);
  const height = Math.round(rect.height - BROWSER_WEBVIEW_INSET * 2);
  if (width < 2 || height < 2) {
    return undefined;
  }
  return {
    x: Math.round(rect.left + BROWSER_WEBVIEW_INSET),
    y: Math.round(rect.top + BROWSER_WEBVIEW_INSET),
    width,
    height,
  };
}

export function BrowserWorkspaceHost({
  pageId,
  url,
  reloadKey,
  onLoadingChange,
}: BrowserWorkspaceHostProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<TauriWebviewHandle | null>(null);
  const measureRafRef = useRef<number | undefined>(undefined);
  const loadingChangeRef = useRef(onLoadingChange);
  const rectRef = useRef<BrowserRect | undefined>(undefined);
  const [rect, setRect] = useState<BrowserRect | undefined>(undefined);
  const [hostError, setHostError] = useState<string | undefined>(undefined);
  const tauriAvailable = useMemo(() => isTauriDesktopAvailable(), []);
  const hasUrl = Boolean(url && url.trim().length > 0);
  const hasMountRect = Boolean(rect);

  useEffect(() => {
    loadingChangeRef.current = onLoadingChange;
  }, [onLoadingChange]);

  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  async function waitForWebviewCreation(webview: TauriWebviewHandle): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        callback();
      };

      void webview.once("tauri://created", () => {
        settle(resolve);
      });
      void webview.once("tauri://error", (event) => {
        const payload = event.payload;
        const message = typeof payload === "string"
          ? payload
          : payload instanceof Error
            ? payload.message
            : "无法创建原生浏览器视图";
        settle(() => reject(new Error(message)));
      });
    });
  }

  async function closeCurrentWebview() {
    const webview = webviewRef.current;
    webviewRef.current = null;
    if (!webview) {
      return;
    }
    try {
      await webview.close();
    } catch {
      // Best effort close only; stale child webviews should not block the React UI.
    }
  }

  async function syncWebviewRect(webview: TauriWebviewHandle, nextRect: BrowserRect) {
    await webview.setPosition(new LogicalPosition(nextRect.x, nextRect.y)).catch(() => undefined);
    await webview.setSize(new LogicalSize(nextRect.width, nextRect.height)).catch(() => undefined);
  }

  useEffect(() => {
    if (!tauriAvailable || !hasUrl) {
      setRect(undefined);
      return;
    }

    let cancelled = false;
    const measure = () => {
      if (cancelled) {
        return;
      }
      const next = readMountRect(mountRef.current);
      setRect((current) => (rectEquals(current, next) ? current : next));
      measureRafRef.current = window.requestAnimationFrame(measure);
    };

    measureRafRef.current = window.requestAnimationFrame(measure);
    return () => {
      cancelled = true;
      if (measureRafRef.current !== undefined) {
        window.cancelAnimationFrame(measureRafRef.current);
        measureRafRef.current = undefined;
      }
    };
  }, [hasUrl, tauriAvailable]);

  useEffect(() => {
    if (!tauriAvailable || !hasUrl || !hasMountRect || !rect || !url) {
      setHostError(undefined);
      loadingChangeRef.current?.(false);
      void closeCurrentWebview();
      return;
    }

    let cancelled = false;
    setHostError(undefined);
    loadingChangeRef.current?.(true);

    void (async () => {
      await closeCurrentWebview();
      try {
        const [{ Webview }, { getCurrentWindow }] = await Promise.all([
          import("@tauri-apps/api/webview"),
          import("@tauri-apps/api/window"),
        ]);
        if (cancelled) {
          return;
        }
        const creationRect = rectRef.current ?? rect;
        if (!creationRect) {
          loadingChangeRef.current?.(false);
          return;
        }
        const webview = new Webview(getCurrentWindow(), browserWebviewLabel(pageId), {
          url,
          x: creationRect.x,
          y: creationRect.y,
          width: creationRect.width,
          height: creationRect.height,
          focus: true,
        }) as unknown as TauriWebviewHandle;
        await waitForWebviewCreation(webview);
        if (cancelled) {
          await webview.close().catch(() => undefined);
          return;
        }
        webviewRef.current = webview;
        const latestRect = rectRef.current ?? creationRect;
        await syncWebviewRect(webview, latestRect);
        void import("@tauri-apps/api/core")
          .then(({ invoke }) =>
            invoke("round_browser_webview", {
              label: browserWebviewLabel(pageId),
              radius: BROWSER_WEBVIEW_RADIUS,
            }),
          )
          .catch(() => undefined);
        loadingChangeRef.current?.(false);
        await webview.setFocus().catch(() => undefined);
      } catch (error) {
        if (!cancelled) {
          loadingChangeRef.current?.(false);
          setHostError(error instanceof Error ? error.message : "无法创建原生浏览器视图");
        }
      }
    })();

    return () => {
      cancelled = true;
      loadingChangeRef.current?.(false);
      void closeCurrentWebview();
    };
  }, [hasMountRect, hasUrl, pageId, reloadKey, tauriAvailable, url]);

  useEffect(() => {
    if (!rect || !webviewRef.current) {
      return;
    }
    void syncWebviewRect(webviewRef.current, rect);
  }, [rect]);

  useEffect(() => () => {
    void closeCurrentWebview();
  }, []);

  if (!hasUrl) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed border-border bg-background/70 p-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-sm font-medium text-foreground">开始浏览</p>
          <p className="text-sm text-muted-foreground">输入URL进行访问</p>
        </div>
      </div>
    );
  }

  if (!tauriAvailable) {
    return (
      <div
        data-testid="browser-workspace-fallback"
        className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-border bg-background/70 p-6 text-center"
      >
        <div className="max-w-sm space-y-2">
          <p className="text-sm font-medium text-foreground">当前环境不支持原生内置浏览器</p>
          <p className="text-sm text-muted-foreground">
            请在 Tauri 桌面壳中使用此页面。当前地址：{url}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="browser-workspace-host"
      className="relative h-full min-h-[240px] overflow-hidden rounded-[24px]"
    >
      <div ref={mountRef} className="absolute inset-0">
        {hostError ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="max-w-sm space-y-2">
              <p className="text-sm font-medium text-red-700">原生浏览器视图创建失败</p>
              <p className="text-sm text-muted-foreground">{hostError}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
