import crypto from "node:crypto";
import type { ChannelConfig, ChannelOutboundMessage } from "@cemeworm/shared";
import type { ChannelAdapter } from "./base.js";

export interface HttpWebhookSendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export class HttpWebhookChannelAdapter implements ChannelAdapter {
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
    const callbackUrl = typeof this.config.config.callbackUrl === "string" ? this.config.config.callbackUrl : undefined;
    if (!callbackUrl) {
      return { ok: true };
    }
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const callbackToken = typeof this.config.config.callbackToken === "string" ? this.config.config.callbackToken : undefined;
      if (callbackToken) {
        headers.authorization = `Bearer ${callbackToken}`;
      }
      const response = await this.fetchImpl(callbackUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
      });
      if (!response.ok) {
        return { ok: false, error: `Callback returned HTTP ${response.status}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function validateHttpWebhookAuth(config: ChannelConfig, headers: Headers, rawBody: string): boolean {
  const token = typeof config.config.token === "string" ? config.config.token : undefined;
  if (token) {
    const auth = headers.get("authorization") ?? "";
    const headerToken = headers.get("x-ora-channel-token") ?? "";
    if (auth !== `Bearer ${token}` && headerToken !== token) {
      return false;
    }
  }

  const signingSecret = typeof config.config.signingSecret === "string" ? config.config.signingSecret : undefined;
  if (!signingSecret) {
    return true;
  }
  const signature = headers.get("x-ora-signature") ?? "";
  const expected = crypto.createHmac("sha256", signingSecret).update(rawBody).digest("hex");
  const normalizedSignature = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(normalizedSignature, "hex");
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
