import type {
  ChannelConfig,
  ChannelIngestParams,
  ChannelOutboundMessage,
  ChannelStatus,
} from "@ora/shared";
import type { ChannelAdapter } from "./base.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscordAdapterDeps {
  onIngest: (params: ChannelIngestParams) => Promise<unknown>;
}

interface DiscordGatewayMessage {
  op: number;
  t?: string;
  s?: number;
  d?: unknown;
}

interface DiscordReadyData {
  session_id: string;
  resume_gateway_url?: string;
}

interface DiscordMessageCreateEvent {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  content: string;
  timestamp: string;
}

// Gateway opcodes
const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

// Discord intents: GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT
const REQUIRED_INTENTS = (1 << 0) | (1 << 9) | (1 << 15);

const DISCORD_API_BASE = "https://discord.com/api/v10";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class DiscordChannelAdapter implements ChannelAdapter {
  readonly channelId: string;
  private running = false;
  private ws: WebSocket | null = null;
  private heartbeatInterval: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly config: ChannelConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly deps?: DiscordAdapterDeps,
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
      return { ok: false, error: "Discord not configured: missing botToken" };
    }

    try {
      const res = await this.fetchImpl(
        `${DISCORD_API_BASE}/channels/${message.externalChatId}/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bot ${botToken}`,
          },
          body: JSON.stringify({
            content: message.text,
            allowed_mentions: { parse: [] },
          }),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `Discord send HTTP ${res.status}: ${body}` };
      }

      const data = (await res.json()) as Record<string, unknown>;
      return {
        ok: true,
        externalMessageId: typeof data.id === "string" ? data.id : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Gateway connection
  // -----------------------------------------------------------------------

  private async connect(): Promise<void> {
    if (!this.running) return;

    const botToken = this.getBotToken();
    if (!botToken) {
      this.scheduleReconnect(10_000);
      return;
    }

    // Try to resume session first
    if (this.sessionId && this.resumeUrl) {
      this.connectRaw(this.resumeUrl);
      return;
    }

    try {
      const res = await this.fetchImpl(`${DISCORD_API_BASE}/gateway/bot`, {
        headers: { authorization: `Bot ${botToken}` },
      });

      if (!res.ok) {
        this.scheduleReconnect(10_000);
        return;
      }

      const data = (await res.json()) as { url: string };
      this.connectRaw(data.url);
    } catch {
      if (this.running) {
        this.scheduleReconnect(10_000);
      }
    }
  }

  private connectRaw(url: string): void {
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        // Wait for Hello before sending anything
      };

      this.ws.onmessage = (event) => {
        void this.handleGatewayMessage(event.data as string);
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        if (this.running) {
          this.scheduleReconnect(5_000);
        }
      };

      this.ws.onerror = () => {
        // onclose will fire
      };
    } catch {
      if (this.running) {
        this.scheduleReconnect(5_000);
      }
    }
  }

  private async handleGatewayMessage(raw: string): Promise<void> {
    let msg: DiscordGatewayMessage;
    try {
      msg = JSON.parse(raw) as DiscordGatewayMessage;
    } catch {
      return;
    }

    switch (msg.op) {
      case OP_HELLO: {
        const d = msg.d as { heartbeat_interval: number } | undefined;
        if (d?.heartbeat_interval) {
          this.heartbeatInterval = d.heartbeat_interval;
          this.startHeartbeat();
        }
        this.identifyOrResume();
        break;
      }

      case OP_HEARTBEAT_ACK:
        // heartbeat acknowledged
        break;

      case OP_RECONNECT:
        this.stopHeartbeat();
        this.ws?.close(1000);
        break;

      case OP_DISPATCH: {
        if (msg.s !== undefined) this.sequence = msg.s;

        if (msg.t === "READY") {
          const d = msg.d as DiscordReadyData;
          this.sessionId = d.session_id;
          this.resumeUrl = d.resume_gateway_url ?? null;
        }

        if (msg.t === "RESUMED") {
          // Successfully resumed; nothing extra to do
        }

        if (msg.t === "MESSAGE_CREATE") {
          await this.handleMessageCreate(msg.d as DiscordMessageCreateEvent);
        }
        break;
      }
    }
  }

  private identifyOrResume(): void {
    if (this.sessionId && this.sequence !== null) {
      this.sendWs({
        op: OP_RESUME,
        d: {
          token: this.getBotToken(),
          session_id: this.sessionId,
          seq: this.sequence,
        },
      });
    } else {
      this.sendWs({
        op: OP_IDENTIFY,
        d: {
          token: this.getBotToken(),
          intents: REQUIRED_INTENTS,
          properties: {
            os: "linux",
            browser: "Ora",
            device: "Ora",
          },
        },
      });
    }
  }

  private async handleMessageCreate(
    event: DiscordMessageCreateEvent,
  ): Promise<void> {
    const normalized = normalizeDiscordMessage(event);
    if (!normalized || !this.deps?.onIngest) return;

    try {
      await this.deps.onIngest({
        channelId: this.channelId,
        ...normalized,
      });
    } catch {
      // swallow
    }
  }

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();

    if (!this.heartbeatInterval) return;

    // Send initial heartbeat with jitter
    const jitter = Math.random() * this.heartbeatInterval;
    setTimeout(() => {
      this.sendHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        this.sendHeartbeat();
      }, this.heartbeatInterval!);
    }, jitter);
  }

  private sendHeartbeat(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendWs({ op: OP_HEARTBEAT, d: this.sequence });
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private sendWs(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private getBotToken(): string | undefined {
    return typeof this.config.config.botToken === "string"
      ? this.config.config.botToken
      : undefined;
  }

  private scheduleReconnect(delay: number): void {
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close(1000);
      this.ws = null;
    }
  }
}

// ---------------------------------------------------------------------------
// normalizeDiscordMessage — exported for testing
// ---------------------------------------------------------------------------

export function normalizeDiscordMessage(
  event: DiscordMessageCreateEvent,
): Omit<ChannelIngestParams, "channelId"> | null {
  // Ignore bot messages
  if (event.author?.bot) return null;

  const text = event.content?.trim();
  if (!text) return null;

  return {
    externalMessageId: event.id,
    externalChatId: event.channel_id,
    externalUserId: event.author.id,
    externalUserDisplayName: event.author.username,
    text,
    type: text.startsWith("/") ? "command" : "chat",
    attachments: [],
    metadata: {
      source: "discord",
      guildId: event.guild_id,
    },
  };
}
