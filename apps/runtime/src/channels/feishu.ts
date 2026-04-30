import crypto from "node:crypto";
import { ChannelAttachmentSchema, type ChannelConfig, type ChannelIngestParams, type ChannelOutboundMessage } from "@ora/shared";
import type { ChannelAdapter } from "./base.js";

export class FeishuChannelAdapter implements ChannelAdapter {
  readonly channelId: string;
  private running = false;

  constructor(readonly config: ChannelConfig, private readonly fetchImpl: typeof fetch = fetch) {
    this.channelId = config.channelId;
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  status() {
    return {
      channelId: this.config.channelId,
      kind: this.config.kind,
      label: this.config.label,
      enabled: this.config.enabled,
      state: this.running ? "running" as const : "stopped" as const,
      queueSize: 0,
      runningCount: this.running ? 1 : 0,
      updatedAt: this.config.updatedAt,
    };
  }

  async send(message: ChannelOutboundMessage): Promise<{ ok: true; externalMessageId?: string } | { ok: false; error: string }> {
    const webhookUrl = typeof this.config.config.webhookUrl === "string" ? this.config.config.webhookUrl : undefined;
    if (!webhookUrl) {
      return { ok: true };
    }
    const body: Record<string, unknown> = {
      msg_type: "text",
      content: { text: message.text || "Ora completed the run." },
    };
    const secret = typeof this.config.config.signingSecret === "string" ? this.config.config.signingSecret : undefined;
    if (secret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      body.timestamp = timestamp;
      body.sign = crypto.createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
    }
    try {
      const response = await this.fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return { ok: false, error: `Feishu webhook returned HTTP ${response.status}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export type NormalizedFeishuWebhook =
  | { kind: "challenge"; challenge: string }
  | { kind: "message"; params: Omit<ChannelIngestParams, "channelId"> };

export function normalizeFeishuWebhookPayload(raw: unknown): NormalizedFeishuWebhook {
  const record = isRecord(raw) ? raw : {};
  const challenge = stringValue(record.challenge)
    ?? stringValue(record.event, "challenge")
    ?? stringValue(record, "Challenge");
  if (challenge) {
    return { kind: "challenge", challenge };
  }

  const header = record.header && isRecord(record.header) ? record.header : {};
  const event = record.event && isRecord(record.event) ? record.event : record;
  const message = event.message && isRecord(event.message) ? event.message : event;
  const sender = event.sender && isRecord(event.sender) ? event.sender : {};
  const senderId = sender.sender_id && isRecord(sender.sender_id) ? sender.sender_id : {};
  const content = parseContent(message.content);
  const text = stringValue(content, "text") ?? stringValue(message, "text") ?? "";
  const externalMessageId = stringValue(message, "message_id")
    ?? stringValue(header, "event_id")
    ?? stringValue(record, "uuid")
    ?? `feishu-${Date.now()}`;
  const externalChatId = stringValue(message, "chat_id")
    ?? stringValue(senderId, "open_id")
    ?? stringValue(senderId, "user_id")
    ?? "feishu-chat";
  const externalThreadId = stringValue(message, "root_id") ?? stringValue(message, "parent_id");
  const externalUserId = stringValue(senderId, "open_id") ?? stringValue(senderId, "user_id");
  const externalUserDisplayName = stringValue(sender, "sender_type");

  return {
    kind: "message",
    params: {
      externalMessageId,
      externalChatId,
      externalThreadId,
      externalUserId,
      externalUserDisplayName,
      text,
      type: text.trim().startsWith("/") ? "command" : "chat",
      attachments: feishuAttachments(content, message),
      raw,
      metadata: { source: "feishu", eventType: stringValue(header, "event_type") },
    },
  };
}

export function validateFeishuWebhookAuth(config: ChannelConfig, headers: Headers, rawBody: string): boolean {
  const verificationToken = typeof config.config.verificationToken === "string" ? config.config.verificationToken : undefined;
  if (verificationToken) {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      const token = isRecord(parsed)
        ? stringValue(parsed, "token") ?? stringValue(parsed.header, "token")
        : undefined;
      if (token !== verificationToken) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const signingSecret = typeof config.config.signingSecret === "string" ? config.config.signingSecret : undefined;
  const signature = headers.get("x-lark-signature") ?? headers.get("x-feishu-signature");
  if (!signingSecret || !signature) {
    return true;
  }
  const timestamp = headers.get("x-lark-request-timestamp") ?? "";
  const nonce = headers.get("x-lark-request-nonce") ?? "";
  const expected = crypto.createHash("sha256").update(`${timestamp}${nonce}${signingSecret}${rawBody}`).digest("hex");
  return timingSafeHexEqual(signature, expected);
}

function feishuAttachments(content: Record<string, unknown>, message: Record<string, unknown>) {
  const attachments = [];
  const imageKey = stringValue(content, "image_key") ?? stringValue(message, "image_key");
  if (imageKey) {
    attachments.push(ChannelAttachmentSchema.parse({
      id: imageKey,
      kind: "image",
      metadata: { source: "feishu", imageKey },
    }));
  }
  const fileKey = stringValue(content, "file_key") ?? stringValue(message, "file_key");
  if (fileKey) {
    attachments.push(ChannelAttachmentSchema.parse({
      id: fileKey,
      kind: "file",
      name: stringValue(content, "file_name") ?? undefined,
      metadata: { source: "feishu", fileKey },
    }));
  }
  return attachments;
}

function parseContent(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return { text: value };
    }
  }
  return {};
}

function stringValue(value: unknown, key?: string): string | undefined {
  const target = key && isRecord(value) ? value[key] : value;
  return typeof target === "string" && target.trim() ? target.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timingSafeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
