// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserWorkspaceHost } from "./BrowserWorkspaceHost";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

const createdWebviews: MockWebview[] = [];
const getCurrentWindow = vi.fn(() => ({ label: "main" }));

class MockWebview {
  static nextCreationError: string | undefined;
  static autoEmitCreation = true;
  label: string;
  options: Record<string, unknown>;
  listeners = new Map<string, (event: { payload?: unknown }) => void>();
  close = vi.fn().mockResolvedValue(undefined);
  setPosition = vi.fn().mockResolvedValue(undefined);
  setSize = vi.fn().mockResolvedValue(undefined);
  setFocus = vi.fn().mockResolvedValue(undefined);

  constructor(_window: unknown, label: string, options: Record<string, unknown>) {
    this.label = label;
    this.options = options;
    createdWebviews.push(this);
    if (MockWebview.autoEmitCreation) {
      queueMicrotask(() => {
        const error = MockWebview.nextCreationError;
        MockWebview.nextCreationError = undefined;
        if (error) {
          this.emit("tauri://error", { payload: error });
        } else {
          this.emit("tauri://created", {});
        }
      });
    }
  }

  once(event: "tauri://created" | "tauri://error", handler: (event: { payload?: unknown }) => void) {
    this.listeners.set(event, handler);
    return Promise.resolve(() => {
      this.listeners.delete(event);
    });
  }

  emit(event: string, payload: { payload?: unknown }) {
    const handler = this.listeners.get(event);
    if (!handler) {
      return;
    }
    this.listeners.delete(event);
    handler(payload);
  }
}

vi.mock("@tauri-apps/api/webview", () => ({
  Webview: MockWebview,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow,
}));

describe("BrowserWorkspaceHost", () => {
  const originalRaf = window.requestAnimationFrame;
  const originalCancelRaf = window.cancelAnimationFrame;
  const originalRect = HTMLDivElement.prototype.getBoundingClientRect;
  const originalScrollX = window.scrollX;
  const originalScrollY = window.scrollY;
  let rafCallbacks = new Map<number, FrameRequestCallback>();
  let rafId = 0;

  beforeEach(() => {
    createdWebviews.length = 0;
    getCurrentWindow.mockClear();
    MockWebview.nextCreationError = undefined;
    MockWebview.autoEmitCreation = true;
    rafCallbacks = new Map();
    rafId = 0;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      rafId += 1;
      rafCallbacks.set(rafId, callback);
      return rafId;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) => {
      rafCallbacks.delete(id);
    }) as typeof window.cancelAnimationFrame;
    Object.defineProperty(window, "scrollX", {
      configurable: true,
      value: 72,
      writable: true,
    });
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 48,
      writable: true,
    });
    HTMLDivElement.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 120,
      y: 80,
      left: 120,
      top: 80,
      width: 420,
      height: 280,
      right: 540,
      bottom: 360,
      toJSON: () => undefined,
    })) as typeof HTMLDivElement.prototype.getBoundingClientRect;
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    Object.defineProperty(window, "scrollX", {
      configurable: true,
      value: originalScrollX,
      writable: true,
    });
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: originalScrollY,
      writable: true,
    });
    HTMLDivElement.prototype.getBoundingClientRect = originalRect;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function flushNextFrame() {
    const next = Array.from(rafCallbacks.entries()).sort((left, right) => left[0] - right[0])[0];
    if (!next) {
      return;
    }
    const [id, callback] = next;
    rafCallbacks.delete(id);
    act(() => {
      callback(performance.now());
    });
  }

  async function flushMicrotasks() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("renders a fallback shell when Tauri is unavailable", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <BrowserWorkspaceHost
          pageId="browser:1"
          url="https://example.com/"
          reloadKey={0}
        />,
      );
    });

    expect(container.textContent).toContain("当前环境不支持原生内置浏览器");
    expect(createdWebviews).toHaveLength(0);

    act(() => {
      root.unmount();
    });
  });

  it("creates a native child webview for a committed URL in Tauri", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWebview: { label: "main" } } } });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <BrowserWorkspaceHost
          pageId="browser:1"
          url="https://example.com/"
          reloadKey={0}
        />,
      );
    });

    flushNextFrame();
    await flushMicrotasks();

    expect(createdWebviews).toHaveLength(1);
    expect(getCurrentWindow).toHaveBeenCalled();
    expect(createdWebviews[0]?.label).toBe("right-workspace-browser:browser:1");
    expect(createdWebviews[0]?.options).toMatchObject({
      url: "https://example.com/",
      x: 121,
      y: 81,
      width: 418,
      height: 278,
      focus: true,
    });

    act(() => {
      root.unmount();
    });
  });

  it("does not shift the webview position when the page scrolls", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWebview: { label: "main" } } } });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <BrowserWorkspaceHost
          pageId="browser:1"
          url="https://example.com/"
          reloadKey={0}
        />,
      );
    });

    flushNextFrame();
    await flushMicrotasks();

    expect(createdWebviews[0]?.options).toMatchObject({
      x: 121,
      y: 81,
    });

    act(() => {
      root.unmount();
    });
  });

  it("realigns the webview after async creation if the host rect changed meanwhile", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWebview: { label: "main" } } } });
    MockWebview.autoEmitCreation = false;

    let currentRect = {
      x: 120,
      y: 80,
      left: 120,
      top: 80,
      width: 420,
      height: 280,
      right: 540,
      bottom: 360,
      toJSON: () => undefined,
    };
    (HTMLDivElement.prototype.getBoundingClientRect as ReturnType<typeof vi.fn>).mockImplementation(() => currentRect);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <BrowserWorkspaceHost
          pageId="browser:1"
          url="https://example.com/"
          reloadKey={0}
        />,
      );
    });

    flushNextFrame();
    await flushMicrotasks();

    const webview = createdWebviews[0];
    expect(webview?.options).toMatchObject({ x: 121, y: 81, width: 418, height: 278 });

    currentRect = {
      x: 980,
      y: 110,
      left: 980,
      top: 110,
      width: 320,
      height: 900,
      right: 1300,
      bottom: 1010,
      toJSON: () => undefined,
    };

    flushNextFrame();
    await flushMicrotasks();

    act(() => {
      webview?.emit("tauri://created", {});
    });
    await flushMicrotasks();

    expect(webview?.setPosition).toHaveBeenCalledWith(new LogicalPosition(981, 111));
    expect(webview?.setSize).toHaveBeenCalledWith(new LogicalSize(318, 898));

    act(() => {
      root.unmount();
    });
  });

  it("reports loading state while creating the native child webview", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWebview: { label: "main" } } } });

    const onLoadingChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <BrowserWorkspaceHost
          pageId="browser:1"
          url="https://example.com/"
          reloadKey={0}
          onLoadingChange={onLoadingChange}
        />,
      );
    });

    flushNextFrame();
    expect(onLoadingChange).toHaveBeenCalledWith(true);

    await flushMicrotasks();

    expect(onLoadingChange).toHaveBeenCalledWith(false);

    act(() => {
      root.unmount();
    });
  });

  it("recreates the native child webview when reloadKey changes", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWebview: { label: "main" } } } });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <BrowserWorkspaceHost
          pageId="browser:1"
          url="https://example.com/"
          reloadKey={0}
        />,
      );
    });

    flushNextFrame();
    await flushMicrotasks();

    const firstWebview = createdWebviews[0];
    expect(firstWebview).toBeTruthy();

    act(() => {
      root.render(
        <BrowserWorkspaceHost
          pageId="browser:1"
          url="https://example.com/"
          reloadKey={1}
        />,
      );
    });

    await flushMicrotasks();

    expect(firstWebview?.close).toHaveBeenCalled();
    expect(createdWebviews).toHaveLength(2);

    act(() => {
      root.unmount();
    });
  });

  it("does not recreate the webview when only the loading callback reference changes", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWebview: { label: "main" } } } });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <BrowserWorkspaceHost
          pageId="browser:1"
          url="https://example.com/"
          reloadKey={0}
          onLoadingChange={vi.fn()}
        />,
      );
    });

    flushNextFrame();
    await flushMicrotasks();

    const firstWebview = createdWebviews[0];
    expect(firstWebview).toBeTruthy();

    act(() => {
      root.render(
        <BrowserWorkspaceHost
          pageId="browser:1"
          url="https://example.com/"
          reloadKey={0}
          onLoadingChange={vi.fn()}
        />,
      );
    });

    await flushMicrotasks();

    expect(firstWebview?.close).not.toHaveBeenCalled();
    expect(createdWebviews).toHaveLength(1);

    act(() => {
      root.unmount();
    });
  });

  it("resizes and closes the native child webview with the host lifecycle", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWebview: { label: "main" } } } });

    let currentRect = {
      x: 120,
      y: 80,
      left: 120,
      top: 80,
      width: 420,
      height: 280,
      right: 540,
      bottom: 360,
      toJSON: () => undefined,
    };
    (HTMLDivElement.prototype.getBoundingClientRect as ReturnType<typeof vi.fn>).mockImplementation(() => currentRect);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <BrowserWorkspaceHost
          pageId="browser:1"
          url="https://example.com/"
          reloadKey={0}
        />,
      );
    });

    flushNextFrame();
    await flushMicrotasks();

    const webview = createdWebviews[0];
    expect(webview).toBeTruthy();

    currentRect = {
      x: 90,
      y: 64,
      left: 90,
      top: 64,
      width: 360,
      height: 240,
      right: 450,
      bottom: 304,
      toJSON: () => undefined,
    };

    flushNextFrame();
    await flushMicrotasks();

    expect(webview?.setPosition).toHaveBeenLastCalledWith(new LogicalPosition(91, 65));
    expect(webview?.setSize).toHaveBeenLastCalledWith(new LogicalSize(358, 238));

    act(() => {
      root.unmount();
    });

    expect(webview?.close).toHaveBeenCalled();
  });

  it("surfaces asynchronous Tauri creation errors instead of leaving a blank host", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWebview: { label: "main" } } } });
    MockWebview.nextCreationError = "window label not found";

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <BrowserWorkspaceHost
          pageId="browser:1"
          url="https://example.com/"
          reloadKey={0}
        />,
      );
    });

    flushNextFrame();
    await flushMicrotasks();

    expect(container.textContent).toContain("原生浏览器视图创建失败");
    expect(container.textContent).toContain("window label not found");

    act(() => {
      root.unmount();
    });
  });
});
