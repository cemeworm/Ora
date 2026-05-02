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

export interface TelegramAdapterDeps {
  onIngest: (params: ChannelIngestParams) => Promise<unknown>;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  date: number;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class TelegramChannelAdapter implements ChannelAdapter {
  readonly channelId: string;
  private running = false;
  private abortController: AbortController | null = null;
  private pollOffset = 0;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly config: ChannelConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly deps?: TelegramAdapterDeps,
  ) {
    this.channelId = config.channelId;
    this.pollOffset =
      typeof config.config.pollOffset === "number"
        ? config.config.pollOffset
        : 0;
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
    const botToken = this.getBotToken();
    if (!botToken) {
      return { ok: false, error: "Telegram bot not configured: missing botToken" };
    }

    const chatId = parseTelegramChatId(message.externalChatId);
    if (chatId === undefined) {
      return { ok: false, error: `Invalid Telegram chat_id: ${message.externalChatId}` };
    }

    try {
      const res = await this.fetchImpl(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: message.text,
            parse_mode: "HTML",
          }),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `sendMessage HTTP ${res.status}: ${body}` };
      }

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const result = data.result as Record<string, unknown> | undefined;
      return {
        ok: true,
        externalMessageId:
          typeof result?.message_id === "number"
            ? String(result.message_id)
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
  // Polling loop
  // -----------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    if (!this.running) return;

    const botToken = this.getBotToken();
    if (!botToken) {
      this.pollHandle = setTimeout(() => void this.pollLoop(), 10_000);
      return;
    }

    this.abortController = new AbortController();

    try {
      const res = await this.fetchImpl(
        `https://api.telegram.org/bot${botToken}/getUpdates?offset=${this.pollOffset}&timeout=35`,
        {
          method: "GET",
          signal: this.abortController.signal,
        },
      );

      if (!res.ok) {
        this.pollHandle = setTimeout(() => void this.pollLoop(), 5_000);
        return;
      }

      const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };

      if (data.ok && data.result?.length && this.deps?.onIngest) {
        for (const update of data.result) {
          const normalized = normalizeTelegramUpdate(update);
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
          this.pollOffset = update.update_id + 1;
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
    }

    if (this.running) {
      this.pollHandle = setTimeout(() => void this.pollLoop(), 1_000);
    }
  }

  private getBotToken(): string | undefined {
    return typeof this.config.config.botToken === "string"
      ? this.config.config.botToken
      : undefined;
  }
}

// ---------------------------------------------------------------------------
// normalizeTelegramUpdate — exported for testing
// ---------------------------------------------------------------------------

export function normalizeTelegramUpdate(
  update: TelegramUpdate,
): Omit<ChannelIngestParams, "channelId"> | null {
  const msg = update.message;
  if (!msg) return null;
  if (!msg.text || !msg.text.trim()) return null;

  const text = msg.text.trim();
  const fromUser = msg.from;
  const chatId = String(msg.chat.id);

  return {
    externalMessageId: String(msg.message_id),
    externalChatId: chatId,
    externalUserId: fromUser ? String(fromUser.id) : chatId,
    externalUserDisplayName:
      fromUser?.username ?? fromUser?.first_name ?? undefined,
    text,
    type: text.startsWith("/") ? "command" : "chat",
    attachments: [],
    metadata: {
      source: "telegram",
      chatType: msg.chat.type,
      timestamp: msg.date,
    },
  };
}

function parseTelegramChatId(raw: string): number | string | undefined {
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) return num;
  if (raw.startsWith("@")) return raw;
  if (raw) return Number(raw) || raw;
  return undefined;
}
