import { describe, it, expect } from "vitest";
import { normalizeTelegramUpdate } from "../src/channels/telegram.js";
import { normalizeSlackMessage } from "../src/channels/slack.js";
import { normalizeWecomCallback } from "../src/channels/wecom.js";
import { normalizeDiscordMessage } from "../src/channels/discord.js";
import { normalizeDingtalkWebhookPayload } from "../src/channels/dingtalk.js";

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

describe("normalizeTelegramUpdate", () => {
  it("parses a text message", () => {
    const result = normalizeTelegramUpdate({
      update_id: 100,
      message: {
        message_id: 42,
        from: { id: 123, is_bot: false, first_name: "Alice", username: "alice99" },
        chat: { id: 123, type: "private" },
        text: "Hello bot!",
        date: 1714435200,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.externalMessageId).toBe("42");
    expect(result!.externalChatId).toBe("123");
    expect(result!.externalUserId).toBe("123");
    expect(result!.externalUserDisplayName).toBe("alice99");
    expect(result!.text).toBe("Hello bot!");
    expect(result!.type).toBe("chat");
  });

  it("detects commands", () => {
    const result = normalizeTelegramUpdate({
      update_id: 101,
      message: {
        message_id: 43,
        chat: { id: 456, type: "group" },
        text: "/help",
        date: 1714435300,
      },
    });

    expect(result!.type).toBe("command");
  });

  it("skips updates without message", () => {
    expect(normalizeTelegramUpdate({ update_id: 200 })).toBeNull();
  });

  it("skips empty text", () => {
    const result = normalizeTelegramUpdate({
      update_id: 102,
      message: {
        message_id: 44,
        chat: { id: 1, type: "private" },
        text: "   ",
        date: 1714435400,
      },
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

describe("normalizeSlackMessage", () => {
  it("parses a text message", () => {
    const result = normalizeSlackMessage({
      type: "message",
      channel: "C123",
      user: "U456",
      text: "Hello from Slack!",
      ts: "1678886400.123456",
    });

    expect(result).not.toBeNull();
    expect(result!.externalMessageId).toBe("1678886400.123456");
    expect(result!.externalChatId).toBe("C123");
    expect(result!.externalUserId).toBe("U456");
    expect(result!.text).toBe("Hello from Slack!");
    expect(result!.type).toBe("chat");
  });

  it("detects commands", () => {
    const result = normalizeSlackMessage({
      channel: "C789",
      user: "U012",
      text: "/status",
      ts: "1678886400.999",
    });

    expect(result!.type).toBe("command");
  });

  it("skips empty messages", () => {
    expect(normalizeSlackMessage({ text: "" })).toBeNull();
    expect(normalizeSlackMessage({ text: "   " })).toBeNull();
    expect(normalizeSlackMessage({})).toBeNull();
  });

  it("skips messages without channel", () => {
    expect(normalizeSlackMessage({ text: "hi", user: "U1" })).toBeNull();
  });

  it("includes thread_ts", () => {
    const result = normalizeSlackMessage({
      channel: "C1",
      user: "U1",
      text: "thread reply",
      ts: "t1",
      thread_ts: "parent-ts",
    });
    expect(result!.externalThreadId).toBe("parent-ts");
  });
});

// ---------------------------------------------------------------------------
// WeCom
// ---------------------------------------------------------------------------

describe("normalizeWecomCallback", () => {
  it("parses a text message", () => {
    const result = normalizeWecomCallback({
      msgid: "MSG001",
      chatid: "CHAT001",
      chattype: "group",
      from: { userid: "USER001" },
      msgtype: "text",
      text: { content: "Hello Oracle!" },
    });

    expect(result).not.toBeNull();
    expect(result!.externalMessageId).toBe("MSG001");
    expect(result!.externalChatId).toBe("CHAT001");
    expect(result!.externalUserId).toBe("USER001");
    expect(result!.text).toBe("Hello Oracle!");
    expect(result!.type).toBe("chat");
  });

  it("detects commands", () => {
    const result = normalizeWecomCallback({
      msgid: "MSG002",
      chatid: "CHAT002",
      from: { userid: "U2" },
      msgtype: "text",
      text: { content: "/new" },
    });
    expect(result!.type).toBe("command");
  });

  it("skips empty messages", () => {
    expect(normalizeWecomCallback({})).toBeNull();
    expect(normalizeWecomCallback({ text: { content: "" } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

describe("normalizeDiscordMessage", () => {
  it("parses a text message", () => {
    const result = normalizeDiscordMessage({
      id: "1234567890",
      channel_id: "CH789",
      guild_id: "G001",
      author: { id: "USER123", username: "DiscordUser", bot: false },
      content: "Hello from Discord!",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    expect(result).not.toBeNull();
    expect(result!.externalMessageId).toBe("1234567890");
    expect(result!.externalChatId).toBe("CH789");
    expect(result!.externalUserId).toBe("USER123");
    expect(result!.externalUserDisplayName).toBe("DiscordUser");
    expect(result!.text).toBe("Hello from Discord!");
    expect(result!.type).toBe("chat");
    expect(result!.metadata?.guildId).toBe("G001");
  });

  it("skips bot messages", () => {
    const result = normalizeDiscordMessage({
      id: "bot-msg",
      channel_id: "CH1",
      author: { id: "BOT1", username: "AnotherBot", bot: true },
      content: "I am a bot",
      timestamp: "2024-01-01T00:00:00.000Z",
    });
    expect(result).toBeNull();
  });

  it("skips empty content", () => {
    expect(
      normalizeDiscordMessage({
        id: "e",
        channel_id: "ch",
        author: { id: "u", username: "n" },
        content: "   ",
        timestamp: "ts",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DingTalk
// ---------------------------------------------------------------------------

describe("normalizeDingtalkWebhookPayload", () => {
  it("parses a text message", () => {
    const result = normalizeDingtalkWebhookPayload({
      msgId: "DT001",
      conversationId: "CONV001",
      conversationType: "1",
      senderId: "SENDER001",
      senderNick: "钉钉用户",
      msgtype: "text",
      text: { content: "你好 Ora!" },
    });

    expect(result).not.toBeNull();
    expect(result!.externalMessageId).toBe("DT001");
    expect(result!.externalChatId).toBe("CONV001");
    expect(result!.externalUserId).toBe("SENDER001");
    expect(result!.externalUserDisplayName).toBe("钉钉用户");
    expect(result!.text).toBe("你好 Ora!");
    expect(result!.type).toBe("chat");
  });

  it("detects commands", () => {
    const result = normalizeDingtalkWebhookPayload({
      conversationId: "C1",
      senderId: "S1",
      msgtype: "text",
      text: { content: "/help" },
    });
    expect(result!.type).toBe("command");
  });

  it("skips empty messages", () => {
    expect(normalizeDingtalkWebhookPayload({})).toBeNull();
    expect(normalizeDingtalkWebhookPayload({ text: { content: "" } })).toBeNull();
  });

  it("falls back to plain content field", () => {
    const result = normalizeDingtalkWebhookPayload({
      msgId: "DT002",
      conversationId: "CONV002",
      senderId: "S2",
      content: "plain text message",
    });
    expect(result).not.toBeNull();
    expect(result!.text).toBe("plain text message");
  });
});
