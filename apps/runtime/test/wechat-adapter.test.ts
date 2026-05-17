import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChannelConfig, ChannelIngestParams } from "@cemeworm/shared";
import {
  WechatChannelAdapter,
  normalizeWechatMessage,
} from "../src/channels/wechat.js";
import { createRuntimeMethodHandler, handleJsonRpcLine, LocalRunStore } from "../src/index.js";

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
    const headers = (fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers["x-wechat-uin"]).toMatch(/^UIN[0-9a-f]{16}$/);
    expect(onConfigUpdate).toHaveBeenCalledWith(
      "wechat-test",
      expect.objectContaining({ wechatUin: headers["x-wechat-uin"] }),
    );
  });

  it("requestQrCode accepts qrcode_img_content from the iLink API", async () => {
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAABUAAAAVCAAAAACMfPpKAAAAPUlEQVR4nGP4//8HQ3MYB8OuVS8Ydoe9ANMg/r/VPxiuhkYwrFq1Aiv9b9UKhubQCIZdq1Yw7IbSID7QPAB9+CcNRdy/cgAAAABJRU5ErkJggg==";
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          qrcode: "qr-key-actual",
          qrcode_img_content: `data:image/png;base64,${base64}`,
          ret: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const onConfigUpdate = vi.fn();
    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl, {
      onIngest: vi.fn(),
      onConfigUpdate,
    });
    const result = await adapter.requestQrCode();

    expect(result).toEqual({
      base64,
      qrcode: "qr-key-actual",
      mimeType: "image/png",
      imageSrc: `data:image/png;base64,${base64}`,
    });
    expect(onConfigUpdate).toHaveBeenCalledWith(
      "wechat-test",
      expect.objectContaining({ qrCodeKey: "qr-key-actual" }),
    );
  });

  it("requestQrCode downloads qrcode_img_content when it is an image URL", async () => {
    const pngBase64 = "iVBORw0KGgo=";
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("get_bot_qrcode")) {
        return new Response(
          JSON.stringify({
            qrcode: "qr-key-url",
            qrcode_img_content: "https://liteapp.weixin.qq.com/qrcode.png",
            ret: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(Buffer.from(pngBase64, "base64"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });

    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl);
    const result = await adapter.requestQrCode();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe("https://liteapp.weixin.qq.com/qrcode.png");
    expect(result).toEqual({
      base64: pngBase64,
      qrcode: "qr-key-url",
      mimeType: "image/png",
      imageSrc: `data:image/png;base64,${pngBase64}`,
    });
  });

  it("requestQrCode extracts and downloads an image from an HTML QR page", async () => {
    const pngBase64 = "iVBORw0KGgo=";
    const html = "<!doctype html><html><body><img src=\"/qr/actual.png\" /></body></html>";
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("get_bot_qrcode")) {
        return new Response(
          JSON.stringify({
            qrcode: "qr-key-html-url",
            qrcode_img_content: "https://liteapp.weixin.qq.com/qrcode-page",
            ret: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://liteapp.weixin.qq.com/qrcode-page") {
        return new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response(Buffer.from(pngBase64, "base64"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });

    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl);
    const result = await adapter.requestQrCode();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe("https://liteapp.weixin.qq.com/qr/actual.png");
    expect(result).toEqual({
      base64: pngBase64,
      qrcode: "qr-key-html-url",
      mimeType: "image/png",
      imageSrc: `data:image/png;base64,${pngBase64}`,
    });
  });

  it("requestQrCode returns pageSrc when an HTML QR page has no image candidate", async () => {
    const html = "<!doctype html><html><body>qr page</body></html>";
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("get_bot_qrcode")) {
        return new Response(
          JSON.stringify({
            qrcode: "qr-key-html-url-fallback",
            qrcode_img_content: "https://liteapp.weixin.qq.com/qrcode-page-empty",
            ret: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });

    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl);
    const result = await adapter.requestQrCode();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.qrcode).toBe("qr-key-html-url-fallback");
    expect(result.mimeType).toBe("text/html");
    expect(result.imageSrc).toBe("");
    expect(result.pageSrc).toBe("https://liteapp.weixin.qq.com/qrcode-page-empty");
    expect(Buffer.from(result.base64, "base64").toString("utf8")).toBe(html);
  });

  it("requestQrCode normalizes base64url QR image content", async () => {
    const pngBase64 = "iVBORw0KGgo=";
    const base64Url = pngBase64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          qrcode: "qr-key-base64url",
          qrcode_img_content: base64Url,
          ret: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl);
    const result = await adapter.requestQrCode();

    expect(result.qrcode).toBe("qr-key-base64url");
    expect(result.mimeType).toBe("image/png");
    expect(result.base64).toBe(pngBase64);
    expect(result.imageSrc).toBe(`data:image/png;base64,${pngBase64}`);
  });

  it("requestQrCode returns a browser-ready imageSrc for raw PNG image content", async () => {
    const rawPng = "\u0089PNG\r\n\u001a\nraw";
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          qrcode: "qr-key-raw-png",
          qrcode_img_content: rawPng,
          ret: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl);
    const result = await adapter.requestQrCode();

    expect(result.qrcode).toBe("qr-key-raw-png");
    expect(result.mimeType).toBe("image/png");
    expect(result.imageSrc).toBe(`data:image/png;base64,${result.base64}`);
    expect(Buffer.from(result.base64, "base64").toString("latin1")).toBe(rawPng);
  });

  it("requestQrCode returns a browser-ready imageSrc for SVG QR image content", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="black"/></svg>`;
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          qrcode: "qr-key-svg",
          qrcode_img_content: svg,
          ret: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl);
    const result = await adapter.requestQrCode();

    expect(result.qrcode).toBe("qr-key-svg");
    expect(result.mimeType).toBe("image/svg+xml");
    expect(result.imageSrc).toBe(`data:image/svg+xml;base64,${result.base64}`);
    expect(Buffer.from(result.base64, "base64").toString("utf8")).toBe(svg);
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
      makeConfig({ qrCodeKey: "persisted-qr-key", wechatUin: "persisted-uin" }),
      fetchImpl,
    );
    const result = await adapter.pollQrCodeStatus();
    expect(result.status).toBe("waiting");

    const calledUrl = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toContain("persisted-qr-key");
    const headers = (fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers["x-wechat-uin"]).toBe("persisted-uin");
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
  it("caches inbound context_token so replies can be sent", async () => {
    let sentBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("getupdates")) {
        return new Response(
          JSON.stringify({
            item_list: [{
              msg_id: "msg-ctx-001",
              type: 1,
              content: "Hello from WeChat",
              from_user: "user-wx-1",
              to_user: "bot-001",
              context_token: "ctx-token-abc",
              timestamp: 1700000000,
            }],
            get_updates_buf: "buf-next",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("sendmessage")) {
        sentBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ msg_id: "out-msg-ctx-001" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    let resolveIngest!: (params: ChannelIngestParams) => void;
    const ingested = new Promise<ChannelIngestParams>((resolve) => {
      resolveIngest = resolve;
    });
    const onConfigUpdate = vi.fn();
    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl, {
      onIngest: async (params) => {
        resolveIngest(params);
      },
      onConfigUpdate,
    });

    adapter.start();
    const inbound = await ingested;
    adapter.stop();

    expect(inbound.externalChatId).toBe("user-wx-1");
    const getUpdatesHeaders = (fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(getUpdatesHeaders["x-wechat-uin"]).toMatch(/^UIN[0-9a-f]{16}$/);
    expect(getUpdatesHeaders.authorizationtype).toBe("ilink_bot_token");
    expect(onConfigUpdate).toHaveBeenCalledWith(
      "wechat-test",
      expect.objectContaining({ wechatUin: getUpdatesHeaders["x-wechat-uin"] }),
    );
    const result = await adapter.send({
      id: "outbound-ctx-1",
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

    expect(result.ok).toBe(true);
    expect(sentBody).toEqual(expect.objectContaining({
      msg: expect.objectContaining({
        to_user_id: "user-wx-1",
        message_type: 2,
        message_state: 2,
        context_token: "ctx-token-abc",
        item_list: [expect.objectContaining({
          type: 1,
          text_item: { text: "Hello back!" },
        })],
      }),
    }));
  });

  it("treats iLink sendmessage ret errors as failed delivery", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("getupdates")) {
        return new Response(
          JSON.stringify({
            item_list: [{
              msg_id: "msg-ctx-001",
              type: 1,
              content: "Hello from WeChat",
              from_user: "user-wx-1",
              to_user: "bot-001",
              context_token: "ctx-token-abc",
            }],
            get_updates_buf: "buf-next",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ ret: -2 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    let resolveIngest!: (params: ChannelIngestParams) => void;
    const ingested = new Promise<ChannelIngestParams>((resolve) => {
      resolveIngest = resolve;
    });
    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl, {
      onIngest: async (params) => resolveIngest(params),
      onConfigUpdate: vi.fn(),
    });

    adapter.start();
    await ingested;
    adapter.stop();
    const result = await adapter.send({
      id: "outbound-ret-1",
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

    expect(result).toEqual({ ok: false, error: "sendmessage ret -2" });
  });

  it("sends isFinal=false delta messages with message_state 1", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("getupdates")) {
        return new Response(
          JSON.stringify({
            item_list: [{
              msg_id: "msg-stream-001",
              type: 1,
              content: "Hello from WeChat",
              from_user: "user-wx-1",
              to_user: "bot-001",
              context_token: "ctx-token-stream",
            }],
            get_updates_buf: "buf-next",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ ret: 0, msg_id: "out-msg-stream-001" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    let resolveIngest!: (params: ChannelIngestParams) => void;
    const ingested = new Promise<ChannelIngestParams>((resolve) => {
      resolveIngest = resolve;
    });
    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl, {
      onIngest: async (params) => resolveIngest(params),
      onConfigUpdate: vi.fn(),
    });

    adapter.start();
    await ingested;
    adapter.stop();
    const result = await adapter.send({
      id: "outbound-stream-1",
      channelId: "wechat-test",
      bindingId: "binding-1",
      sessionId: "session-1",
      runId: "run-1",
      externalChatId: "user-wx-1",
      text: "streaming",
      isFinal: false,
      kind: "delta",
      attachments: [],
      createdAt: clock(),
      metadata: {},
    });

    expect(result.ok).toBe(true);
    const sentBody = JSON.parse((fetchImpl.mock.calls.at(-1)?.[1] as RequestInit | undefined)?.body as string ?? "{}");
    expect(sentBody.msg.message_state).toBe(1);
    expect(sentBody.msg.item_list[0].text_item.text).toBe("streaming");
  });

  it("start and stop without errors", () => {
    const adapter = new WechatChannelAdapter(makeConfig({ botToken: "" }));
    adapter.start();
    expect(adapter.status().state).toBe("running");
    adapter.stop();
    expect(adapter.status().state).toBe("stopped");
  });

  it("stops polling when iLink reports a session timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ errcode: -14, errmsg: "session timeout" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onConfigUpdate = vi.fn();
    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl, {
      onIngest: async () => undefined,
      onConfigUpdate,
    });

    adapter.start();

    await vi.waitFor(() => {
      expect(adapter.status().state).toBe("stopped");
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[WeChat:wechat-test] WeChat bot session timeout，请重新绑定该 WeChat channel",
    );
    expect(onConfigUpdate).toHaveBeenCalledWith(
      "wechat-test",
      expect.objectContaining({
        bound: false,
        botToken: "",
        updatesBuf: "",
      }),
    );
    consoleError.mockRestore();
  });

  it("ingests iLink msgs responses from getupdates", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          msgs: [{
            seq: 1,
            message_id: 7457081304998865000,
            from_user_id: "user-wx-1",
            to_user_id: "bot-001",
            create_time_ms: 1777906728893,
            message_type: 1,
            item_list: [{
              type: 1,
              text_item: { text: "hi" },
            }],
            context_token: "ctx-token-abc",
          }],
          get_updates_buf: "buf-next",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    let resolveIngest!: (params: ChannelIngestParams) => void;
    const ingested = new Promise<ChannelIngestParams>((resolve) => {
      resolveIngest = resolve;
    });
    const adapter = new WechatChannelAdapter(makeConfig(), fetchImpl, {
      onIngest: async (params) => resolveIngest(params),
      onConfigUpdate: vi.fn(),
    });

    adapter.start();
    const inbound = await ingested;
    adapter.stop();

    expect(inbound.externalChatId).toBe("user-wx-1");
    expect(inbound.text).toBe("hi");
    expect(inbound.metadata.contextToken).toBe("ctx-token-abc");
  });
});

// ---------------------------------------------------------------------------
// JSON-RPC integration
// ---------------------------------------------------------------------------

describe("wechat JSON-RPC methods", () => {
  it("does not auto-start wechat polling in one-shot runtime stores", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ item_list: [], get_updates_buf: "" }));
    });
    const store = new LocalRunStore({
      dataDir: path.join(tempDir, "runtime.db"),
      fetchImpl,
    });

    store.createChannel({
      channelId: "wechat-one-shot",
      label: "WeChat One Shot",
      kind: "wechat",
      config: {
        baseUrl: "https://ilinkai.weixin.qq.com",
        botToken: "test-bot-token",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("channels.wechat.requestQrCode delegates to adapter", async () => {
    const store = new LocalRunStore({
      dataDir: path.join(tempDir, "runtime.db"),
      clock,
      fetchImpl: async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("get_bot_qrcode")) {
          return new Response(
            JSON.stringify({ base64: "iVBORw0KGgo=", qrcode: "qr-key" }),
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

    expect(result.base64).toBe("iVBORw0KGgo=");
    expect(result.qrcode).toBe("qr-key");
  });

  it("serializes channels.wechat.requestQrCode with an explicit JSON-RPC result", async () => {
    const store = new LocalRunStore({
      dataDir: path.join(tempDir, "runtime.db"),
      clock,
      fetchImpl: async () => new Response(
        JSON.stringify({ base64: "iVBORw0KGgo=", qrcode: "qr-key" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    });
    const handler = createRuntimeMethodHandler(store);
    await handler(request("channels.create", {
      channelId: "wechat-rpc-json",
      label: "WeChat RPC JSON Test",
      kind: "wechat",
      config: {},
    }));

    const response = await handleJsonRpcLine(JSON.stringify({
      jsonrpc: "2.0",
      id: "wechat-qr",
      method: "channels.wechat.requestQrCode",
      params: { channelId: "wechat-rpc-json" },
    }), handler);

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "wechat-qr",
      result: {
        base64: "iVBORw0KGgo=",
        qrcode: "qr-key",
        mimeType: "image/png",
        imageSrc: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
  });

  it("turns undefined handler results into JSON-RPC errors instead of success responses", async () => {
    const response = await handleJsonRpcLine(JSON.stringify({
      jsonrpc: "2.0",
      id: "undefined-result",
      method: "channels.wechat.requestQrCode",
      params: { channelId: "wechat-rpc" },
    }), async () => undefined);

    expect(response && "error" in response).toBe(true);
    expect(response && "result" in response).toBe(false);
  });
});
