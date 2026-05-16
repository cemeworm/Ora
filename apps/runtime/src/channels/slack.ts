import type {
  ChannelConfig,
  ChannelIngestParams,
  ChannelOutboundMessage,
  ChannelStatus,
} from "@cemeworm/shared";
import type { ChannelAdapter } from "./base.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlackAdapterDeps {
  onIngest: (params: ChannelIngestParams) => Promise<unknown>;
}

interface SlackEnvelope {
  payload?: Record<string, unknown>;
  envelope_id?: string;
  type?: string;
  accepts_response_payload?: boolean;
}

interface SlackEventCallback {
  event?: SlackMessageEvent;
  type?: string;
  event_id?: string;
}

interface SlackMessageEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  bot_id?: string;
  thread_ts?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class SlackChannelAdapter implements ChannelAdapter {
  readonly channelId: string;
  private running = false;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly config: ChannelConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly deps?: SlackAdapterDeps,
  ) {
    this.channelId = config.channelId;
  }

  // -----------------------------------------------------------------------
  // ChannelAdapter interface
  // -----------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.cleanup();
  }

  status(): ChannelStatus {
    return {
      channelId: this.config.channelId,
      kind: this.config.kind,
      label: this.config.label,
      enabled: this.config.enabled,
      state: this.running ? ("running" as const) : ("stopped" as const),
      queueSize: 0,
      runningCount: this.running ? 1 : 0,
      updatedAt: this.config.updatedAt,
    };
  }

  async send(
    message: ChannelOutboundMessage,
  ): Promise<
    { ok: true; externalMessageId?: string } | { ok: false; error: string }
  > {
    const botToken = this.getBotToken();
    if (!botToken) {
      return { ok: false, error: "Slack not configured: missing botToken" };
    }

    try {
      const res = await this.fetchImpl("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({
          channel: message.externalChatId,
          text: message.text,
          ...(message.externalThreadId
            ? { thread_ts: message.externalThreadId }
            : {}),
        }),
      });

      const data = (await res.json()) as Record<string, unknown>;

      if (!data.ok) {
        return { ok: false, error: `Slack error: ${String(data.error ?? "unknown")}` };
      }

      return {
        ok: true,
        externalMessageId:
          typeof data.ts === "string" ? data.ts : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -----------------------------------------------------------------------
  // WebSocket connection management
  // -----------------------------------------------------------------------

  private async connect(): Promise<void> {
    if (!this.running) return;

    const appToken = this.getAppToken();
    if (!appToken) {
      this.scheduleReconnect(10_000);
      return;
    }

    try {
      const res = await this.fetchImpl("https://slack.com/api/apps.connections.open", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${appToken}`,
        },
      });

      const data = (await res.json()) as Record<string, unknown>;
      const url = typeof data.url === "string" ? data.url : undefined;

      if (!data.ok || !url) {
        this.scheduleReconnect(10_000);
        return;
      }

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        void this.handleMessage(event.data as string);
      };

      this.ws.onclose = () => {
        this.stopPing();
        if (this.running) {
          this.scheduleReconnect(5_000);
        }
      };

      this.ws.onerror = () => {
        // onclose will fire after this, triggering reconnect
      };
    } catch {
      if (this.running) {
        this.scheduleReconnect(10_000);
      }
    }
  }

  private async handleMessage(raw: string): Promise<void> {
    let envelope: SlackEnvelope;
    try {
      envelope = JSON.parse(raw) as SlackEnvelope;
    } catch {
      return;
    }

    // Acknowledge every event
    if (envelope.envelope_id) {
      this.ws?.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    }

    const payload = envelope.payload;
    if (!payload || payload.type !== "event_callback") return;

    const callback = payload as unknown as SlackEventCallback;
    const event = callback.event;
    if (!event || event.type !== "message") return;

    // Skip bot messages and subtypes (message_changed, message_deleted, etc.)
    if (event.bot_id || event.subtype) return;

    const normalized = normalizeSlackMessage(event);
    if (!normalized || !this.deps?.onIngest) return;

    try {
      const result = await this.deps.onIngest({
        channelId: this.channelId,
        ...normalized,
      }) as Record<string, unknown> | undefined;
      if (result && !result.accepted) {
        console.warn(`[Slack:${this.channelId}] Ingest rejected: ${normalized.externalChatId}`);
      }
    } catch {
      // swallow
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private getBotToken(): string | undefined {
    return typeof this.config.config.botToken === "string"
      ? this.config.config.botToken
      : undefined;
  }

  private getAppToken(): string | undefined {
    return typeof this.config.config.appToken === "string"
      ? this.config.config.appToken
      : undefined;
  }

  private scheduleReconnect(delay: number): void {
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

// ---------------------------------------------------------------------------
// normalizeSlackMessage — exported for testing
// ---------------------------------------------------------------------------

export function normalizeSlackMessage(
  event: SlackMessageEvent,
): Omit<ChannelIngestParams, "channelId"> | null {
  const text = event.text?.trim();
  if (!text) return null;

  const channel = event.channel;
  if (!channel) return null;

  return {
    externalMessageId: event.ts ?? `slack-${Date.now()}`,
    externalChatId: channel,
    externalThreadId: event.thread_ts ?? undefined,
    externalUserId: event.user ?? channel,
    text,
    type: text.startsWith("/") ? "command" : "chat",
    attachments: [],
    metadata: {
      source: "slack",
      subtype: event.subtype,
    },
  };
}
