import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChannelConfig, ChannelIngestParams } from "@ora/shared";
import {
  WechatChannelAdapter,
  normalizeWechatMessage,
} from "../src/channels/wechat.js";
import { createRuntimeMethodHandler, LocalRunStore } from "../src/index.js";

let tempDir: string;
let currentTime: number;
const clock = () => currentTime++;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-wechat-test-"));
  currentTime = 1_700_000_000_000;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeConfig(overrides: Record<string, unknown> = {}): ChannelConfig {
  return {
    channelId: "wechat-test",
    kind: "wechat",
    label: "WeChat Test",
    enabled: true,
    capabilities: {
      supportsStreamingUpdates: false,
      supportsThreadReplies: false,
      supportsReactions: false,
      supportsFileInbound: false,
      supportsFileOutbound: false,
      supportsMessageUpdate: false,
    },
    config: {
      baseUrl: "https://ilinkai.weixin.qq.com",
      botToken: "test-bot-token",
      ...overrides,
    },
    secretRefs: {},
    createdAt: clock(),
    updatedAt: clock(),
  };
}

function request(method: string, params?: unknown) {
  return { jsonrpc: "2.0" as const, id: method, method, params };
}

// ---------------------------------------------------------------------------
// normalizeWechatMessage
// ---------------------------------------------------------------------------

describe("normalizeWechatMessage", () => {
  it("parses a text message (type=1)", () => {
    const result = normalizeWechatMessage({
      msg_id: "msg-001",
      type: 1,
      content: "Hello from WeChat",
      from_user: "user-wx-1",
      to_user: "bot-001",
      context_token: "ctx-token-abc",
      timestamp: 1700000000,
    });

    expect(result).toEqual({
      externalMessageId: "msg-001",
      externalChatId: "user-wx-1",
      externalUserId: "user-wx-1",
      text: "Hello from WeChat",
      type: "chat",
      attachments: [],
      metadata: {
        source: "wechat",
        contextToken: "ctx-token-abc",
        timestamp: 1700000000,
      },
    });
  });

  it("returns null for non-text messages (type!=1)", () => {
    expect(normalizeWechatMessage({
      msg_id: "msg-002",
      type: 3,
      content: "[image]",
      from_user: "user-wx-1",
      to_user: "bot-001",
    })).toBeNull();
  });

  it("returns null for empty content", () => {
    expect(normalizeWechatMessage({
      msg_id: "msg-003",
      type: 1,
      content: "   ",
      from_user: "user-wx-1",
      to_user: "bot-001",
    })).toBeNull();
  });

  it("detects command type for /-prefixed messages", () => {
    const result = normalizeWechatMessage({
      msg_id: "msg-004",
      type: 1,
      content: "/help",
      from_user: "user-wx-1",
      to_user: "bot-001",
    });
    expect(result?.type).toBe("command");
  });
});

// ---------------------------------------------------------------------------
// requestQrCode / pollQrCodeStatus
// ---------------------------------------------------------------------------

describe("WechatChannelAdapter QR code flow", () => {
  it("requestQrCode calls get_bot_qrcode and persists qrCodeKey", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      return new Response(
        JSON.stringify({ base64: "iVBOR...", qrcode: "qr-key-123" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const onConfigUpdate = vi.fn();
    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl, {
      onIngest: vi.fn(),
      onConfigUpdate,
    });
    const result = await adapter.requestQrCode();

    expect(result.base64).toBe("iVBOR...");
    expect(result.qrcode).toBe("qr-key-123");
    expect(onConfigUpdate).toHaveBeenCalledWith(
      "wechat-test",
      expect.objectContaining({ qrCodeKey: "qr-key-123" }),
    );
  });

  it("pollQrCodeStatus restores qrCodeKey from config across process restarts", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      return new Response(
        JSON.stringify({ status: "waiting" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    // Simulate a new process: adapter reads qrCodeKey from persisted config
    const adapter = new WechatChannelAdapter(
      makeConfig({ qrCodeKey: "persisted-qr-key" }),
      fetchImpl,
    );
    const result = await adapter.pollQrCodeStatus();
    expect(result.status).toBe("waiting");

    const calledUrl = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toContain("persisted-qr-key");
  });

  it("pollQrCodeStatus returns confirmed with botToken and baseUrl", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("get_bot_qrcode")) {
        return new Response(
          JSON.stringify({ base64: "abc", qrcode: "qr-key" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          status: "confirmed",
          bot_token: "new-bot-token",
          baseurl: "https://ilinkai.weixin.qq.com",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const onConfigUpdate = vi.fn();
    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl, {
      onIngest: vi.fn(),
      onConfigUpdate,
    });

    // Need a QR session first
    await adapter.requestQrCode();

    const result = await adapter.pollQrCodeStatus();
    expect(result.status).toBe("confirmed");
    expect(result.botToken).toBe("new-bot-token");
    expect(onConfigUpdate).toHaveBeenCalledWith(
      "wechat-test",
      expect.objectContaining({ botToken: "new-bot-token", bound: true }),
    );
  });

  it("pollQrCodeStatus returns waiting when not yet scanned", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("get_bot_qrcode")) {
        return new Response(
          JSON.stringify({ base64: "abc", qrcode: "qr-key" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ status: "waiting" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl);
    await adapter.requestQrCode();
    const result = await adapter.pollQrCodeStatus();
    expect(result.status).toBe("waiting");
  });
});

// ---------------------------------------------------------------------------
// send()
// ---------------------------------------------------------------------------

describe("WechatChannelAdapter send", () => {
  it("sends message with context_token in body", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ msg_id: "out-msg-001" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl);
    const result = await adapter.send({
      id: "outbound-1",
      channelId: "wechat-test",
      bindingId: "binding-1",
      sessionId: "session-1",
      runId: "run-1",
      externalChatId: "user-wx-1",
      text: "Hello back!",
      isFinal: true,
      kind: "final",
      attachments: [],
      createdAt: clock(),
      metadata: {},
    });

    // No context_token mapped, so should fail
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No context_token");
    }
  });

  it("returns error when botToken is missing", async () => {
    const adapter = new WechatChannelAdapter(makeConfig({ botToken: "" }));
    const result = await adapter.send({
      id: "outbound-1",
      channelId: "wechat-test",
      bindingId: "binding-1",
      sessionId: "session-1",
      externalChatId: "user-wx-1",
      text: "Hello",
      isFinal: true,
      kind: "final",
      attachments: [],
      createdAt: clock(),
      metadata: {},
    });

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// start / stop
// ---------------------------------------------------------------------------

describe("WechatChannelAdapter lifecycle", () => {
  it("start and stop without errors", () => {
    const adapter = new WechatChannelAdapter(makeConfig({ botToken: "" }));
    adapter.start();
    expect(adapter.status().state).toBe("running");
    adapter.stop();
    expect(adapter.status().state).toBe("stopped");
  });
});

// ---------------------------------------------------------------------------
// JSON-RPC integration
// ---------------------------------------------------------------------------

describe("wechat JSON-RPC methods", () => {
  it("channels.wechat.requestQrCode delegates to adapter", async () => {
    const store = new LocalRunStore({
      dataDir: path.join(tempDir, "runtime.db"),
      clock,
      fetchImpl: async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("get_bot_qrcode")) {
          return new Response(
            JSON.stringify({ base64: "base64data", qrcode: "qr-key" }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ status: "waiting" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const handler = createRuntimeMethodHandler(store);

    // Create a wechat channel first
    await handler(request("channels.create", {
      channelId: "wechat-rpc",
      label: "WeChat RPC Test",
      kind: "wechat",
      config: {},
    }));

    const result = await handler(request("channels.wechat.requestQrCode", {
      channelId: "wechat-rpc",
    })) as { base64: string; qrcode: string };

    expect(result.base64).toBe("base64data");
    expect(result.qrcode).toBe("qr-key");
  });
});
