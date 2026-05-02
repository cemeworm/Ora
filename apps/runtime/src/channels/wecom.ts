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

export interface WecomAdapterDeps {
  onIngest: (params: ChannelIngestParams) => Promise<unknown>;
}

interface WecomWsMessage {
  cmd?: string;
  headers?: { req_id?: string };
  errcode?: number;
  errmsg?: string;
  body?: WecomMsgBody;
}

interface WecomMsgBody {
  msgid?: string;
  aibotid?: string;
  chatid?: string;
  chattype?: string;
  from?: { userid?: string };
  msgtype?: string;
  text?: { content?: string };
  event?: { event_type?: string };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class WecomChannelAdapter implements ChannelAdapter {
  readonly channelId: string;
  private running = false;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private subscribed = false;

  constructor(
    readonly config: ChannelConfig,
    private readonly deps?: WecomAdapterDeps,
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { ok: false, error: "WeCom WebSocket not connected" };
    }

    const streamId = `stream-${message.id}`;

    try {
      this.ws.send(
        JSON.stringify({
          cmd: "aibot_send_msg",
          headers: { req_id: message.id },
          body: {
            chatid: message.externalChatId,
            chat_type: 1,
            msgtype: "markdown",
            markdown: { content: message.text || "Ora response" },
          },
        }),
      );
      return { ok: true, externalMessageId: streamId };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -----------------------------------------------------------------------
  // WebSocket connection
  // -----------------------------------------------------------------------

  private connect(): void {
    if (!this.running) return;

    const botId = this.getBotId();
    const botSecret = this.getBotSecret();
    if (!botId || !botSecret) {
      this.scheduleReconnect(10_000);
      return;
    }

    try {
      this.ws = new WebSocket("wss://openws.work.weixin.qq.com");

      this.ws.onopen = () => {
        this.subscribed = false;
        this.sendWs({
          cmd: "aibot_subscribe",
          headers: { req_id: `sub-${Date.now()}` },
          body: { bot_id: botId, secret: botSecret },
        });
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        void this.handleMessage(event.data as string);
      };

      this.ws.onclose = () => {
        this.stopPing();
        this.subscribed = false;
        if (this.running) {
          this.scheduleReconnect(5_000);
        }
      };

      this.ws.onerror = () => {
        // onclose will fire
      };
    } catch {
      if (this.running) {
        this.scheduleReconnect(10_000);
      }
    }
  }

  private async handleMessage(raw: string): Promise<void> {
    let msg: WecomWsMessage;
    try {
      msg = JSON.parse(raw) as WecomWsMessage;
    } catch {
      return;
    }

    const cmd = msg.cmd;

    // Subscription confirmation
    if (cmd === "aibot_subscribe" || (!this.subscribed && msg.errcode === 0)) {
      this.subscribed = true;
      return;
    }

    // Handle incoming message callback
    if (cmd === "aibot_msg_callback" && msg.body) {
      const normalized = normalizeWecomCallback(msg.body);
      if (normalized && this.deps?.onIngest) {
        try {
          await this.deps.onIngest({
            channelId: this.channelId,
            ...normalized,
          });
        } catch {
          // swallow
        }
      }
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

  private getBotId(): string | undefined {
    return typeof this.config.config.botId === "string"
      ? this.config.config.botId
      : undefined;
  }

  private getBotSecret(): string | undefined {
    return typeof this.config.config.botSecret === "string"
      ? this.config.config.botSecret
      : undefined;
  }

  private scheduleReconnect(delay: number): void {
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      this.sendWs({
        cmd: "ping",
        headers: { req_id: `ping-${Date.now()}` },
      });
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
    this.subscribed = false;
  }
}

// ---------------------------------------------------------------------------
// normalizeWecomCallback — exported for testing
// ---------------------------------------------------------------------------

export function normalizeWecomCallback(
  body: WecomMsgBody,
): Omit<ChannelIngestParams, "channelId"> | null {
  const text =
    body.text?.content?.trim() ?? "";
  if (!text) return null;

  return {
    externalMessageId: body.msgid ?? `wecom-${Date.now()}`,
    externalChatId: body.chatid ?? "wecom-chat",
    externalUserId: body.from?.userid ?? "wecom-user",
    text,
    type: text.startsWith("/") ? "command" : "chat",
    attachments: [],
    metadata: {
      source: "wecom",
      chattype: body.chattype,
      msgtype: body.msgtype,
    },
  };
}
