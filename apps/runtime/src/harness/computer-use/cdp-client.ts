// ---------------------------------------------------------------------------
// Lightweight CDP (Chrome DevTools Protocol) Client
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Minimal WebSocket interface for Node 22+ global WebSocket
interface NodeWebSocket {
  on(event: "open", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "message", listener: (data: Buffer) => void): void;
  send(data: string, cb?: (err?: Error) => void): void;
  close(): void;
}

function createWebSocket(url: string): NodeWebSocket {
  return new (globalThis as unknown as { WebSocket: new (url: string) => NodeWebSocket }).WebSocket(url);
}

export class CdpClient {
  private ws: NodeWebSocket | null = null;
  private msgId = 1;
  private pending = new Map<number, PendingRequest>();
  private _connected = false;
  private requestTimeoutMs: number;

  constructor(requestTimeoutMs = 15_000) {
    this.requestTimeoutMs = requestTimeoutMs;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(wsUrl: string, signal?: AbortSignal): Promise<void> {
    if (this._connected) return;

    if (signal?.aborted) {
      throw new Error("CDP connection cancelled: aborted before connect.");
    }

    await new Promise<void>((resolve, reject) => {
      const ws = createWebSocket(wsUrl);
      this.ws = ws;

      const onAbort = () => {
        ws.close();
        reject(new Error("CDP connection cancelled: aborted."));
      };

      try {
        signal?.addEventListener("abort", onAbort, { once: true });
      } catch {
        // signal may not support events
      }

      ws.on("open", () => {
        try { signal?.removeEventListener("abort", onAbort); } catch {}
        this._connected = true;
        resolve();
      });

      ws.on("error", (err) => {
        try { signal?.removeEventListener("abort", onAbort); } catch {}
        this._connected = false;
        reject(new Error(`CDP WebSocket error: ${err.message}`));
      });

      ws.on("close", () => {
        this._connected = false;
        this.rejectPending(new Error("CDP connection closed."));
      });

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString("utf8")) as { id?: number; result?: unknown; error?: { message?: string } };
          if (typeof message.id === "number") {
            const pending = this.pending.get(message.id);
            if (pending) {
              clearTimeout(pending.timer);
              this.pending.delete(message.id);
              if (message.error) {
                pending.reject(new Error(message.error.message ?? "CDP command failed."));
              } else {
                pending.resolve(message.result);
              }
            }
          }
        } catch {
          // Skip non-JSON messages
        }
      });

      if (signal?.aborted) {
        ws.close();
        reject(new Error("CDP connection cancelled: aborted during connect."));
        return;
      }
    });
  }

  async send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    if (!this.ws || !this._connected) {
      throw new Error("CDP client is not connected.");
    }

    const id = this.msgId++;
    const timeout = timeoutMs ?? this.requestTimeoutMs;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command '${method}' timed out after ${timeout}ms.`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });

      const payload = JSON.stringify({ id, method, params: params ?? {} });
      this.ws!.send(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error(`CDP send failed: ${err.message}`));
        }
      });
    });
  }

  async navigate(url: string): Promise<void> {
    await this.send("Page.enable");
    await this.send("Page.navigate", { url });
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    })) as { result?: { value?: T; type?: string }; exceptionDetails?: { text?: string } };

    if (result.exceptionDetails) {
      throw new Error(`CDP evaluate failed: ${result.exceptionDetails.text ?? "unknown error"}`);
    }
    return (result.result?.value ?? null) as T;
  }

  async getAccessibilityTree(): Promise<CdpAXNode | null> {
    const result = (await this.send("Accessibility.getFullAXTree", {
      depth: 100,
    })) as { nodes?: CdpAXNode[] };
    return (result.nodes && result.nodes.length > 0) ? result.nodes[0] ?? null : null;
  }

  async getDocument(): Promise<CdpDomNode | null> {
    const result = (await this.send("DOM.getDocument", {
      depth: 3,
      pierce: true,
    })) as { root?: CdpDomNode };
    return result.root ?? null;
  }

  async querySelector(selector: string, nodeId?: number): Promise<number | null> {
    const result = (await this.send("DOM.querySelector", {
      selector,
      ...(nodeId ? { nodeId } : {}),
    })) as { nodeId?: number };
    return result.nodeId ?? null;
  }

  async querySelectorAll(selector: string, nodeId?: number): Promise<number[]> {
    const result = (await this.send("DOM.querySelectorAll", {
      selector,
      ...(nodeId ? { nodeId } : {}),
    })) as { nodeIds?: number[] };
    return result.nodeIds ?? [];
  }

  async describeNode(nodeId: number): Promise<CdpDomNode | null> {
    const result = (await this.send("DOM.describeNode", {
      nodeId,
      depth: 2,
    })) as { node?: CdpDomNode };
    return result.node ?? null;
  }

  async clickPoint(x: number, y: number, clickCount = 1): Promise<void> {
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x, y,
      button: "left",
      clickCount,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x, y,
      button: "left",
      clickCount,
    });
  }

  async typeText(text: string): Promise<void> {
    for (const char of text) {
      await this.send("Input.dispatchKeyEvent", {
        type: "char",
        text: char,
        unmodifiedText: char,
      });
    }
  }

  async pressKey(key: string, modifiers?: number): Promise<void> {
    const normalized = normalizeKey(key);
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: normalized,
      code: keyToCode(normalized),
      modifiers,
    });
  }

  async keyCombo(keys: string[]): Promise<void> {
    let modifiers = 0;
    const mainKey = keys[keys.length - 1]!;
    for (const key of keys.slice(0, -1)) {
      const mod = modifierMask(key);
      modifiers |= mod;
      await this.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: normalizeModifier(key),
        code: modifierToCode(key),
        modifiers,
      });
    }
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: normalizeKey(mainKey),
      code: keyToCode(mainKey),
      modifiers,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: normalizeKey(mainKey),
      code: keyToCode(mainKey),
      modifiers,
    });
    // Release modifiers in reverse
    for (const key of keys.slice(0, -1).reverse()) {
      modifiers &= ~modifierMask(key);
      await this.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: normalizeModifier(key),
        code: modifierToCode(key),
        modifiers,
      });
    }
  }

  async scrollElement(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x, y,
      deltaX, deltaY,
    });
  }

  disconnect(): void {
    this._connected = false;
    this.rejectPending(new Error("CDP client disconnected."));
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// CDP Types
// ---------------------------------------------------------------------------

export interface CdpAXNode {
  nodeId: string;
  ignored: boolean;
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  properties?: { name: string; value?: { value: string } }[];
  childIds?: string[];
  children?: CdpAXNode[];
  backendDOMNodeId?: number;
}

export interface CdpDomNode {
  nodeId: number;
  nodeType: number;
  nodeName: string;
  localName?: string;
  nodeValue?: string;
  attributes?: string[];
  children?: CdpDomNode[];
  contentDocument?: CdpDomNode;
  frameId?: string;
}

export interface CdpBrowserTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

// ---------------------------------------------------------------------------
// Key mapping
// ---------------------------------------------------------------------------

function normalizeKey(key: string): string {
  const lower = key.toLowerCase().trim();
  const map: Record<string, string> = {
    "enter": "Enter",
    "escape": "Escape",
    "esc": "Escape",
    "tab": "Tab",
    "space": " ",
    "backspace": "Backspace",
    "delete": "Delete",
    "up": "ArrowUp",
    "down": "ArrowDown",
    "left": "ArrowLeft",
    "right": "ArrowRight",
    "home": "Home",
    "end": "End",
    "pageup": "PageUp",
    "pagedown": "PageDown",
    "cmd": "Meta",
    "meta": "Meta",
    "command": "Meta",
    "ctrl": "Control",
    "control": "Control",
    "alt": "Alt",
    "option": "Alt",
    "shift": "Shift",
  };
  return map[lower] ?? (key.length === 1 ? key : key.charAt(0).toUpperCase() + key.slice(1).toLowerCase());
}

function normalizeModifier(key: string): string {
  const map: Record<string, string> = {
    "cmd": "Meta",
    "meta": "Meta",
    "command": "Meta",
    "ctrl": "Control",
    "control": "Control",
    "alt": "Alt",
    "option": "Alt",
    "shift": "Shift",
  };
  return map[key.toLowerCase().trim()] ?? key;
}

function keyToCode(key: string): string {
  const map: Record<string, string> = {
    "Enter": "Enter",
    "Escape": "Escape",
    "Tab": "Tab",
    " ": "Space",
    "Backspace": "Backspace",
    "Delete": "Delete",
    "ArrowUp": "ArrowUp",
    "ArrowDown": "ArrowDown",
    "ArrowLeft": "ArrowLeft",
    "ArrowRight": "ArrowRight",
    "Home": "Home",
    "End": "End",
    "PageUp": "PageUp",
    "PageDown": "PageDown",
  };
  return map[key] ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
}

function modifierToCode(key: string): string {
  const map: Record<string, string> = {
    "Meta": "MetaLeft",
    "Control": "ControlLeft",
    "Alt": "AltLeft",
    "Shift": "ShiftLeft",
  };
  return map[key] ?? key;
}

function modifierMask(key: string): number {
  const map: Record<string, number> = {
    "cmd": 1 << 3,
    "meta": 1 << 3,
    "command": 1 << 3,
    "ctrl": 1 << 2,
    "control": 1 << 2,
    "alt": 1 << 1,
    "option": 1 << 1,
    "shift": 1 << 0,
  };
  return map[key.toLowerCase().trim()] ?? 0;
}
