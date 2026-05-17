import { spawn, type ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Persistent MCP Session
// ---------------------------------------------------------------------------
//
// Long-lived MCP stdio client that initializes once and reuses across calls.
// Replaces the spawn/kill-per-call pattern for multi-step observe/act/verify loops.
//
// See: TASK-20260517-1532-peekaboo-computer-use.md

export interface McpSessionOptions {
  serverCommand: string;
  serverArgs?: string[];
  env?: Record<string, string>;
  cwd?: string;
  initializeTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface McpSession {
  readonly id: string;
  readonly status: "disconnected" | "connecting" | "connected" | "degraded" | "disposed";
  initialize(): Promise<void>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  listTools(signal?: AbortSignal): Promise<unknown[]>;
  dispose(): Promise<void>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PersistentMcpSession implements McpSession {
  readonly id: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly env?: Record<string, string>;
  private readonly cwd?: string;
  private readonly initializeTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private responseBuffer = "";
  private stderrLog: string[] = [];
  private _status: McpSession["status"] = "disconnected";
  private consecutiveFailures = 0;
  private maxConsecutiveFailures = 3;
  private disposed = false;

  constructor(id: string, options: McpSessionOptions) {
    this.id = id;
    this.command = options.serverCommand;
    this.args = options.serverArgs ?? [];
    this.env = options.env;
    this.cwd = options.cwd;
    this.initializeTimeoutMs = options.initializeTimeoutMs ?? 30_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  }

  get status(): McpSession["status"] {
    return this._status;
  }

  async initialize(): Promise<void> {
    if (this.disposed) {
      throw new Error(`MCP session ${this.id} has been disposed.`);
    }
    if (this._status === "connected") {
      return;
    }
    if (this._status === "connecting") {
      throw new Error(`MCP session ${this.id} is already connecting.`);
    }

    this._status = "connecting";
    this.consecutiveFailures = 0;

    try {
      await this.spawnAndInitialize();
    } catch (error) {
      this._status = "degraded";
      this.consecutiveFailures++;
      this.killChild();
      throw error;
    }
  }

  private async spawnAndInitialize(): Promise<void> {
    this.child = spawn(this.command, this.args, {
      env: { ...process.env, ...(this.env ?? {}) },
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.on("exit", (code, signal) => {
      if (this.disposed) return;
      this._status = "degraded";
      this.stderrLog.push(`[session:exit] code=${code} signal=${signal}`);
      this.rejectPending(new Error(`MCP server ${this.id} exited unexpectedly (code=${code}).`));
    });

    this.child.on("error", (error) => {
      if (this.disposed) return;
      this._status = "degraded";
      this.stderrLog.push(`[session:error] ${error.message}`);
      this.rejectPending(new Error(`MCP server ${this.id} process error: ${error.message}`));
    });

    this.child.stdout?.on("data", (chunk: Buffer) => {
      this.responseBuffer += chunk.toString("utf8");
      this.processResponseLines();
    });

    this.child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.stderrLog.push(text);
      if (this.stderrLog.length > 500) {
        this.stderrLog = this.stderrLog.slice(-500);
      }
    });

    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ora-runtime", version: "0.2.0" },
    }, this.initializeTimeoutMs);

    this._status = "connected";
  }

  private processResponseLines(): void {
    const lines = this.responseBuffer.split(/\r?\n/);
    this.responseBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        if (typeof message.id === "number") {
          const pending = this.pending.get(message.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            if (message.error) {
              pending.reject(new Error(message.error.message ?? "MCP request failed."));
            } else {
              pending.resolve(message.result);
            }
          }
        }
      } catch {
        continue;
      }
    }
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    this.ensureConnected();
    return this.send("tools/call", { name, arguments: args }, this.requestTimeoutMs, signal);
  }

  async listTools(signal?: AbortSignal): Promise<unknown[]> {
    this.ensureConnected();
    const result = await this.send("tools/list", undefined, this.requestTimeoutMs, signal);
    if (result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).tools)) {
      return (result as Record<string, unknown[]>).tools ?? [];
    }
    return [];
  }

  private ensureConnected(): void {
    if (this.disposed) {
      throw new Error(`MCP session ${this.id} has been disposed.`);
    }
    if (this._status !== "connected") {
      throw new Error(
        `MCP session ${this.id} is not connected (status: ${this._status}). Call initialize() first.`,
      );
    }
  }

  private send(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.child || !this.child.stdin) {
      return Promise.reject(new Error(`MCP session ${this.id} has no active process.`));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request '${method}' timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const pending: PendingRequest = { resolve, reject, timer };
      this.pending.set(id, pending);

      const onAbort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`MCP request '${method}' cancelled: run was aborted.`));
      };

      try {
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
      } catch {
        // signal may not support events in all envs
      }

      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.child!.stdin!.write(payload + "\n", (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error(`Failed to write to MCP server stdin: ${error.message}`));
        }
      });
    }).finally(() => {
      try {
        signal?.removeEventListener("abort", () => {});
      } catch {
        // signal may not support events
      }
    });
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private killChild(): void {
    if (this.child) {
      try {
        this.child.stdin?.end();
        this.child.kill("SIGTERM");
      } catch {
        // best-effort
      }
      this.child = null;
    }
  }

  async restart(): Promise<void> {
    this.killChild();
    this.pending.clear();
    this.responseBuffer = "";
    this._status = "disconnected";
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      throw new Error(
        `MCP session ${this.id} exceeded max consecutive failures (${this.maxConsecutiveFailures}). Manual recovery required.`,
      );
    }
    await this.initialize();
  }

  recentStderr(lines = 20): string {
    return this.stderrLog.slice(-lines).join("");
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this._status = "disposed";
    this.killChild();
    this.pending.clear();
    this.responseBuffer = "";
  }
}
