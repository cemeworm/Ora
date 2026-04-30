import crypto from "node:crypto";
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

export interface WechatAdapterDeps {
  onIngest: (params: ChannelIngestParams) => Promise<unknown>;
  onConfigUpdate: (channelId: string, patch: Record<string, unknown>) => void;
}

interface QrCodeResponse {
  base64: string;
  qrcode: string;
}

interface QrCodeStatusResponse {
  status: "waiting" | "scanned" | "confirmed" | "expired" | "canceled";
  bot_token?: string;
  baseurl?: string;
}

interface WechatInboundItem {
  msg_id: string;
  type: number;
  content: string;
  from_user: string;
  to_user: string;
  context_token?: string;
  timestamp?: number;
}

interface GetUpdatesResponse {
  item_list: WechatInboundItem[];
  get_updates_buf: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class WechatChannelAdapter implements ChannelAdapter {
  readonly channelId: string;
  private running = false;
  private abortController: AbortController | null = null;
  private updatesBuf = "";
  private readonly contextTokenMap = new Map<string, string>();
  private readonly wechatUin: string;
  private qrCodeKey = "";
  private pollHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly config: ChannelConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly deps?: WechatAdapterDeps,
  ) {
    this.channelId = config.channelId;
    this.wechatUin =
      typeof config.config.wechatUin === "string"
        ? config.config.wechatUin
        : `UIN${crypto.randomBytes(8).toString("hex")}`;
    this.updatesBuf =
      typeof config.config.updatesBuf === "string"
        ? config.config.updatesBuf
        : "";
    this.qrCodeKey =
      typeof config.config.qrCodeKey === "string"
        ? config.config.qrCodeKey
        : "";
  }

  // -----------------------------------------------------------------------
  // ChannelAdapter interface
  // -----------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollLoop();
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    if (this.pollHandle) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
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
    const baseUrl = this.getBaseUrl();
    const botToken = this.getBotToken();
    if (!baseUrl || !botToken) {
      return { ok: false, error: "WeChat bot not bound: missing baseUrl or botToken" };
    }

    const contextToken = this.contextTokenMap.get(message.externalChatId);
    if (!contextToken) {
      return { ok: false, error: `No context_token for chat ${message.externalChatId}` };
    }

    try {
      const res = await this.fetchImpl(`${baseUrl}/ilink/bot/sendmessage`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wechat-uin": this.wechatUin,
          authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({
          to_user: message.externalChatId,
          content: message.text,
          context_token: contextToken,
          msg_type: 1,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `sendmessage HTTP ${res.status}: ${body}` };
      }

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        ok: true,
        externalMessageId: typeof data.msg_id === "string" ? data.msg_id : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -----------------------------------------------------------------------
  // QR code binding
  // -----------------------------------------------------------------------

  async requestQrCode(): Promise<{ base64: string; qrcode: string }> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw new Error("WeChat baseUrl not configured");
    }

    const res = await this.fetchImpl(
      `${baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`,
      {
        method: "GET",
        headers: { "x-wechat-uin": this.wechatUin },
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`get_bot_qrcode HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const raw = (await res.json()) as Record<string, unknown>;
    // Handle different possible field names from the iLink API
    const base64Raw =
      typeof raw.base64 === "string" ? raw.base64 :
      typeof raw.image === "string" ? raw.image :
      typeof raw.qr_image === "string" ? raw.qr_image :
      "";
    const qrKey =
      typeof raw.qrcode === "string" ? raw.qrcode :
      typeof raw.qrcode_key === "string" ? raw.qrcode_key :
      typeof raw.key === "string" ? raw.key :
      "";

    if (!base64Raw || !qrKey) {
      throw new Error(
        `get_bot_qrcode 返回了无法识别的格式。` +
        `可用字段: ${Object.keys(raw).join(", ")}`,
      );
    }

    // Strip data URL prefix if present (e.g. "data:image/png;base64,abc123" → "abc123")
    const base64 = base64Raw.replace(/^data:image\/[^;]+;base64,/, "");

    this.qrCodeKey = qrKey;
    this.deps?.onConfigUpdate(this.channelId, { qrCodeKey: qrKey });
    return { base64, qrcode: qrKey };
  }

  async pollQrCodeStatus(): Promise<{
    status: "waiting" | "scanned" | "confirmed" | "expired" | "canceled";
    botToken?: string;
    baseUrl?: string;
  }> {
    if (!this.qrCodeKey) {
      throw new Error("No active QR code session");
    }

    const baseUrl = this.getBaseUrl();
    const res = await this.fetchImpl(
      `${baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(this.qrCodeKey)}`,
      {
        method: "GET",
        headers: { "x-wechat-uin": this.wechatUin },
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`get_qrcode_status HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const raw = (await res.json()) as Record<string, unknown>;
    const status = typeof raw.status === "string" ? raw.status : "waiting";
    const botToken = typeof raw.bot_token === "string" ? raw.bot_token : undefined;
    const baseurl = typeof raw.baseurl === "string" ? raw.baseurl : undefined;

    if (status === "confirmed" && botToken && baseurl) {
      // Auto-persist credentials and clear QR session via config update
      this.deps?.onConfigUpdate(this.channelId, {
        botToken,
        baseUrl: baseurl,
        bound: true,
        qrCodeKey: "",
      });
      return {
        status: "confirmed",
        botToken,
        baseUrl: baseurl,
      };
    }

    return { status: status as QrCodeStatusResponse["status"] };
  }

  // -----------------------------------------------------------------------
  // Long-polling message loop
  // -----------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    if (!this.running) return;

    const baseUrl = this.getBaseUrl();
    const botToken = this.getBotToken();
    if (!baseUrl || !botToken) {
      // Not bound yet; retry in 10s
      this.pollHandle = setTimeout(() => void this.pollLoop(), 10_000);
      return;
    }

    this.abortController = new AbortController();

    try {
      const res = await this.fetchImpl(`${baseUrl}/ilink/bot/getupdates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wechat-uin": this.wechatUin,
          authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({
          get_updates_buf: this.updatesBuf,
          timeout: 35,
        }),
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        // Retry after delay on error
        this.pollHandle = setTimeout(() => void this.pollLoop(), 5_000);
        return;
      }

      const data = (await res.json()) as GetUpdatesResponse;

      if (data.get_updates_buf) {
        this.updatesBuf = data.get_updates_buf;
        this.deps?.onConfigUpdate(this.channelId, {
          updatesBuf: data.get_updates_buf,
        });
      }

      if (data.item_list?.length && this.deps?.onIngest) {
        for (const item of data.item_list) {
          const normalized = normalizeWechatMessage(item);
          if (normalized) {
            try {
              await this.deps.onIngest({
                channelId: this.channelId,
                ...normalized,
              });
            } catch {
              // swallow ingest errors to keep polling
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
    }

    // Schedule next poll
    if (this.running) {
      this.pollHandle = setTimeout(() => void this.pollLoop(), 1_000);
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private getBaseUrl(): string {
    return typeof this.config.config.baseUrl === "string" &&
      this.config.config.baseUrl
      ? this.config.config.baseUrl
      : "https://ilinkai.weixin.qq.com";
  }

  private getBotToken(): string | undefined {
    return typeof this.config.config.botToken === "string"
      ? this.config.config.botToken
      : undefined;
  }
}

// ---------------------------------------------------------------------------
// normalizeWechatMessage – pure function, exported for testing
// ---------------------------------------------------------------------------

export function normalizeWechatMessage(
  item: WechatInboundItem,
): Omit<ChannelIngestParams, "channelId"> | null {
  // Phase 1: only handle text messages (type=1)
  if (item.type !== 1) return null;

  const text = typeof item.content === "string" ? item.content.trim() : "";
  if (!text) return null;

  return {
    externalMessageId: item.msg_id || `wechat-${Date.now()}`,
    externalChatId: item.from_user,
    externalUserId: item.from_user,
    text,
    type: text.startsWith("/") ? "command" : "chat",
    attachments: [],
    metadata: {
      source: "wechat",
      contextToken: item.context_token,
      timestamp: item.timestamp,
    },
  };
}
