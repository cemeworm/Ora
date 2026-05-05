import crypto from "node:crypto";
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

export interface WechatAdapterDeps {
  onIngest: (params: ChannelIngestParams) => Promise<unknown>;
  onConfigUpdate: (channelId: string, patch: Record<string, unknown>) => void;
}

interface QrCodeResponse {
  base64: string;
  qrcode: string;
  mimeType: string;
  imageSrc: string;
  pageSrc?: string;
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

interface WechatInboundMsg {
  seq?: number;
  message_id?: string | number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  message_type?: number;
  item_list?: Array<{
    type?: number;
    text_item?: { text?: string };
  }>;
  context_token?: string;
}

interface GetUpdatesResponse {
  item_list?: WechatInboundItem[];
  msgs?: WechatInboundMsg[];
  get_updates_buf?: string;
  sync_buf?: string;
  errcode?: number;
  errmsg?: string;
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
  private consecutiveErrors = 0;

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
    this.persistWechatUinIfMissing();
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
          authorizationtype: "ilink_bot_token",
          authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({
          msg: {
            to_user_id: message.externalChatId,
            client_id: `ora-wechat-${message.id}`,
            message_type: 2,
            message_state: 2,
            item_list: [{
              type: 1,
              text_item: { text: message.text },
            }],
            context_token: contextToken,
          },
          base_info: { channel_version: "1.0.0" },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `sendmessage HTTP ${res.status}: ${body}` };
      }

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (typeof data.ret === "number" && data.ret !== 0) {
        return { ok: false, error: `sendmessage ret ${data.ret}` };
      }
      return {
        ok: true,
        externalMessageId: typeof data.msg_id === "string"
          ? data.msg_id
          : typeof data.message_id === "string"
            ? data.message_id
            : undefined,
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

  async requestQrCode(): Promise<QrCodeResponse> {
    this.persistWechatUinIfMissing();
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
      typeof raw.qrcode_img_content === "string" ? raw.qrcode_img_content :
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

    const image = await normalizeQrImagePayload(base64Raw, this.fetchImpl);

    this.qrCodeKey = qrKey;
    this.deps?.onConfigUpdate(this.channelId, { qrCodeKey: qrKey });
    return { ...image, qrcode: qrKey };
  }

  async pollQrCodeStatus(): Promise<{
    status: "waiting" | "scanned" | "confirmed" | "expired" | "canceled";
    botToken?: string;
    baseUrl?: string;
  }> {
    this.persistWechatUinIfMissing();
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
    this.persistWechatUinIfMissing();

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
          authorizationtype: "ilink_bot_token",
          authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({
          get_updates_buf: this.updatesBuf,
          timeout: 35,
          base_info: { channel_version: "1.0.0" },
        }),
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= 5) {
          console.error(`[WeChat:${this.channelId}] poll 连续失败 ${this.consecutiveErrors} 次 (HTTP ${res.status})`);
        }
        if (res.status === 401 || res.status === 403) {
          console.error(`[WeChat:${this.channelId}] 认证失败 (HTTP ${res.status})，停止轮询`);
          this.running = false;
          return;
        }
        this.pollHandle = setTimeout(() => void this.pollLoop(), 5_000);
        return;
      }

      this.consecutiveErrors = 0;

      const data = (await res.json()) as GetUpdatesResponse;
      if (typeof data.errcode === "number" && data.errcode !== 0) {
        this.consecutiveErrors++;
        const message = typeof data.errmsg === "string" && data.errmsg.trim()
          ? data.errmsg.trim()
          : "unknown iLink error";
        console.error(`[WeChat:${this.channelId}] poll iLink 错误 ${data.errcode}: ${message}`);
        if (data.errcode === -14) {
          console.error(`[WeChat:${this.channelId}] WeChat bot session timeout，请重新绑定该 WeChat channel`);
          this.deps?.onConfigUpdate(this.channelId, {
            bound: false,
            botToken: "",
            updatesBuf: "",
          });
          this.running = false;
          return;
        }
        this.pollHandle = setTimeout(() => void this.pollLoop(), 5_000);
        return;
      }

      if (data.get_updates_buf) {
        this.updatesBuf = data.get_updates_buf;
        this.deps?.onConfigUpdate(this.channelId, {
          updatesBuf: data.get_updates_buf,
        });
      }

      const inboundItems = normalizeGetUpdatesItems(data);
      if (inboundItems.length && this.deps?.onIngest) {
        for (const item of inboundItems) {
          const normalized = normalizeWechatMessage(item);
          if (normalized) {
            if (typeof item.context_token === "string" && item.context_token.trim()) {
              this.contextTokenMap.set(normalized.externalChatId, item.context_token);
            }
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
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= 5) {
        console.error(`[WeChat:${this.channelId}] poll 连续网络错误 ${this.consecutiveErrors} 次:`, err instanceof Error ? err.message : String(err));
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

  private persistWechatUinIfMissing(): void {
    if (typeof this.config.config.wechatUin === "string" && this.config.config.wechatUin.trim()) {
      return;
    }
    this.config.config.wechatUin = this.wechatUin;
    this.deps?.onConfigUpdate(this.channelId, { wechatUin: this.wechatUin });
  }
}

async function normalizeQrImagePayload(rawValue: string, fetchImpl: typeof fetch): Promise<Omit<QrCodeResponse, "qrcode">> {
  const decoded = safeDecodeURIComponent(rawValue.trim());
  const dataUrlMatch = decoded.match(/^data:(image\/[^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1].toLowerCase();
    const base64 = normalizeBase64(dataUrlMatch[2]);
    return { base64, mimeType, imageSrc: `data:${mimeType};base64,${base64}` };
  }

  const bareDataUrlMatch = decoded.match(/^(image\/[^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (bareDataUrlMatch) {
    const mimeType = bareDataUrlMatch[1].toLowerCase();
    const base64 = normalizeBase64(bareDataUrlMatch[2]);
    return { base64, mimeType, imageSrc: `data:${mimeType};base64,${base64}` };
  }

  const trimmed = decoded.trim();
  if (isHttpUrl(trimmed)) {
    return fetchQrImageUrl(trimmed, fetchImpl);
  }

  if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml")) {
    const base64 = Buffer.from(trimmed, "utf8").toString("base64");
    return { base64, mimeType: "image/svg+xml", imageSrc: `data:image/svg+xml;base64,${base64}` };
  }

  const rawImage = encodeRawImageContent(trimmed);
  if (rawImage) {
    return rawImage;
  }

  const base64 = normalizeBase64(trimmed);
  const mimeType = detectImageMimeType(base64);
  return { base64, mimeType, imageSrc: `data:${mimeType};base64,${base64}` };
}

function safeDecodeURIComponent(value: string): string {
  if (!value.includes("%")) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function fetchQrImageUrl(url: string, fetchImpl: typeof fetch): Promise<Omit<QrCodeResponse, "qrcode">> {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,text/html;q=0.8,*/*;q=0.5",
      "user-agent": "Mozilla/5.0 OraRuntime/0.1 WeChatQrBinding",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`get_bot_qrcode 图片下载失败 HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const sniffedMimeType = detectImageMimeTypeFromBuffer(buffer);
  if (sniffedMimeType) {
    const base64 = buffer.toString("base64");
    return { base64, mimeType: sniffedMimeType, imageSrc: `data:${sniffedMimeType};base64,${base64}` };
  }

  const text = buffer.toString("utf8").trimStart();
  if (looksLikeHtml(text)) {
    const embeddedImage = extractQrImageCandidateFromHtml(text, url);
    if (embeddedImage) {
      return normalizeQrImagePayload(embeddedImage, fetchImpl);
    }

    const base64 = buffer.toString("base64");
    return {
      base64,
      mimeType: "text/html",
      imageSrc: "",
      pageSrc: url,
    };
  }

  const base64 = buffer.toString("base64");
  const mimeType = normalizeImageContentType(res.headers.get("content-type")) ?? detectImageMimeType(base64);
  return { base64, mimeType, imageSrc: `data:${mimeType};base64,${base64}` };
}

function normalizeImageContentType(contentType: string | null): string | undefined {
  const mimeType = contentType?.split(";")[0]?.trim().toLowerCase();
  return mimeType?.startsWith("image/") ? mimeType : undefined;
}

function looksLikeHtml(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.startsWith("<!doctype html") || lower.startsWith("<html") || lower.includes("<body");
}

function extractQrImageCandidateFromHtml(html: string, baseUrl: string): string | undefined {
  const candidates = [
    ...matchHtmlAttributeValues(html, /<img\b[^>]+src=["']([^"']+)["'][^>]*>/gi),
    ...matchHtmlAttributeValues(html, /<source\b[^>]+srcset=["']([^"']+)["'][^>]*>/gi),
    ...matchHtmlAttributeValues(html, /<meta\b[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["'][^>]*>/gi),
    ...matchHtmlAttributeValues(html, /url\(["']?([^"')]+)["']?\)/gi),
  ];

  for (const candidate of candidates) {
    const value = candidate.split(/\s+/)[0]?.trim();
    if (!value || value.startsWith("#")) continue;
    if (/^data:image\//i.test(value)) return value;
    if (/\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(value) || isHttpUrl(value) || value.startsWith("/")) {
      return resolveUrl(value, baseUrl);
    }
  }

  return undefined;
}

function matchHtmlAttributeValues(html: string, pattern: RegExp): string[] {
  const values: string[] = [];
  for (const match of html.matchAll(pattern)) {
    if (match[1]) values.push(match[1]);
  }
  return values;
}

function resolveUrl(value: string, baseUrl: string): string {
  if (/^data:/i.test(value)) return value;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function detectImageMimeTypeFromBuffer(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  const head = buffer.subarray(0, 256).toString("utf8").trimStart();
  if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) return "image/gif";
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return undefined;
}

function normalizeBase64(value: string): string {
  const compact = value.replace(/\s+/g, "").replace(/^base64,/i, "").replace(/-/g, "+").replace(/_/g, "/");
  const remainder = compact.length % 4;
  return remainder === 0 ? compact : `${compact}${"=".repeat(4 - remainder)}`;
}

function encodeRawImageContent(value: string): Omit<QrCodeResponse, "qrcode"> | undefined {
  const rawMimeType = detectRawImageMimeType(value);
  if (!rawMimeType) {
    return undefined;
  }
  const base64 = Buffer.from(value, "latin1").toString("base64");
  return { base64, mimeType: rawMimeType, imageSrc: `data:${rawMimeType};base64,${base64}` };
}

function detectRawImageMimeType(value: string): string | undefined {
  if (value.startsWith("\u0089PNG\r\n\u001a\n") || value.startsWith("PNG\r\n\u001a\n")) return "image/png";
  if (value.startsWith("\u00ff\u00d8")) return "image/jpeg";
  if (value.startsWith("GIF87a") || value.startsWith("GIF89a")) return "image/gif";
  return undefined;
}

function detectImageMimeType(base64: string): string {
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("R0lGOD")) return "image/gif";

  try {
    const head = Buffer.from(base64.slice(0, 128), "base64").toString("utf8").trimStart();
    if (head.startsWith("<svg") || head.startsWith("<?xml")) {
      return "image/svg+xml";
    }
  } catch {
    // Keep the conservative default below.
  }

  return "image/png";
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

function normalizeGetUpdatesItems(data: GetUpdatesResponse): WechatInboundItem[] {
  if (Array.isArray(data.item_list)) {
    return data.item_list;
  }
  if (!Array.isArray(data.msgs)) {
    return [];
  }
  const items: WechatInboundItem[] = [];
  for (const msg of data.msgs) {
    const textItem = msg.item_list?.find((item) => item.type === 1 && item.text_item?.text);
    const content = textItem?.text_item?.text ?? "";
    items.push({
      msg_id: String(msg.message_id ?? msg.seq ?? `wechat-${Date.now()}`),
      type: msg.message_type ?? 1,
      content,
      from_user: msg.from_user_id ?? "",
      to_user: msg.to_user_id ?? "",
      context_token: msg.context_token,
      timestamp: typeof msg.create_time_ms === "number"
        ? Math.floor(msg.create_time_ms / 1000)
        : undefined,
    });
  }
  return items;
}
