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

interface DingtalkAccessToken {
  token: string;
  expiresAt: number;
}

interface DingtalkWebhookPayload {
  encrypt?: string;
  signature?: string;
  timestamp?: string;
  nonce?: string;
}

interface DingtalkMessageBody {
  msgId?: string;
  conversationId?: string;
  conversationType?: string;
  senderId?: string;
  senderNick?: string;
  msgtype?: string;
  text?: { content?: string };
  content?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class DingtalkChannelAdapter implements ChannelAdapter {
  readonly channelId: string;
  private running = false;
  private accessToken: DingtalkAccessToken | null = null;

  constructor(
    readonly config: ChannelConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.channelId = config.channelId;
  }

  // -----------------------------------------------------------------------
  // ChannelAdapter interface
  // -----------------------------------------------------------------------

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.accessToken = null;
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
    const token = await this.getAccessToken();
    if (!token) {
      return { ok: false, error: "DingTalk not configured: missing clientId/clientSecret" };
    }

    try {
      const res = await this.fetchImpl(
        `https://oapi.dingtalk.com/topapi/im/chat/send?access_token=${token}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chatid: message.externalChatId,
            msg: {
              msgtype: "text",
              text: { content: message.text },
            },
          }),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `DingTalk send HTTP ${res.status}: ${body}` };
      }

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (data.errcode !== 0) {
        return { ok: false, error: `DingTalk error ${data.errcode}: ${String(data.errmsg ?? "")}` };
      }

      return {
        ok: true,
        externalMessageId:
          typeof data.messageId === "string" ? data.messageId : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Access token management
  // -----------------------------------------------------------------------

  private async getAccessToken(): Promise<string | undefined> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.token;
    }

    const clientId = this.config.config.clientId as string | undefined;
    const clientSecret = this.config.config.clientSecret as string | undefined;
    if (!clientId || !clientSecret) return undefined;

    try {
      const res = await this.fetchImpl(
        `https://oapi.dingtalk.com/gettoken?appkey=${clientId}&appsecret=${clientSecret}`,
        { method: "GET" },
      );

      if (!res.ok) return undefined;

      const data = (await res.json()) as Record<string, unknown>;
      const token = typeof data.access_token === "string" ? data.access_token : undefined;
      const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 7200;

      if (token) {
        this.accessToken = {
          token,
          expiresAt: Date.now() + expiresIn * 1000,
        };
        return token;
      }
    } catch {
      // ignore
    }

    return undefined;
  }
}

// ---------------------------------------------------------------------------
// normalizeDingtalkWebhookPayload — exported for use by HTTP server
// ---------------------------------------------------------------------------

export function normalizeDingtalkWebhookPayload(
  raw: unknown,
): Omit<ChannelIngestParams, "channelId"> | null {
  const record = asRecord(raw);
  if (!record) return null;

  const body = extractMessageBody(record);

  const text =
    body.text?.content?.trim() ??
    (typeof body.content === "string" ? body.content.trim() : "");
  if (!text) return null;

  const externalMessageId =
    body.msgId ?? `dingtalk-${Date.now()}`;
  const externalChatId =
    body.conversationId ?? "dingtalk-chat";
  const externalUserId = body.senderId ?? externalChatId;
  const externalUserDisplayName = body.senderNick ?? undefined;

  return {
    externalMessageId,
    externalChatId,
    externalUserId,
    externalUserDisplayName,
    text,
    type: text.startsWith("/") ? "command" : "chat",
    attachments: [],
    metadata: {
      source: "dingtalk",
      conversationType: body.conversationType,
    },
  };
}

function extractMessageBody(record: Record<string, unknown>): DingtalkMessageBody {
  const encrypt = typeof record.encrypt === "string" ? record.encrypt : undefined;

  if (encrypt) {
    try {
      const decrypted = JSON.parse(encrypt) as Record<string, unknown>;
      if (asRecord(decrypted)) return decrypted;
    } catch {
      // fall through
    }
  }

  return record as unknown as DingtalkMessageBody;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
