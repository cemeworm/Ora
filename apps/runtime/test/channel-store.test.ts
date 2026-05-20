import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelStore } from "../src/channels/store.js";
import { SqliteRuntimePersistence } from "../src/persistence/sqlite-backend.js";

let tempDir: string;
let nextId: number;
const clock = () => 1_700_000_000_000 + nextId;
const idFactory = () => `test-${nextId++}`;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-channel-store-"));
  nextId = 1;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createStore(): ChannelStore {
  const backend = new SqliteRuntimePersistence(path.join(tempDir, "runtime.db"));
  return new ChannelStore(backend, { clock, idFactory });
}

describe("ChannelStore", () => {
  it("stores redacted configs, bindings, inbound messages, and deliveries", () => {
    const store = createStore();
    const config = store.createConfig({
      label: "HTTP Webhook",
      kind: "http_webhook",
      config: {
        callbackUrl: "http://localhost:9876/callback",
        token: "secret-token",
      },
    });

    expect(config.channelId).toBe("channel-test-1");
    expect(config.config.token).toBe("[redacted]");
    expect(store.getConfigOrThrow(config.channelId).config.token).toBe("[redacted]");
    expect(store.getConfigOrThrow(config.channelId, { redact: false }).config.token).toBe("secret-token");

    const binding = store.createBinding({
      channelId: config.channelId,
      externalChatId: "chat-1",
      externalThreadId: "thread-1",
      externalUserId: "user-1",
      sessionId: "session-1",
    });
    expect(binding.bindingId).toBe("binding-test-2");
    expect(store.findBinding(config.channelId, "chat-1", "thread-1")?.sessionId).toBe("session-1");

    const rebound = store.createBinding({
      channelId: config.channelId,
      externalChatId: "chat-1",
      externalThreadId: "thread-1",
      sessionId: "session-2",
    });
    expect(rebound.bindingId).toBe(binding.bindingId);
    expect(rebound.sessionId).toBe("session-2");

    const inbound = {
      id: "inbound-1",
      channelId: config.channelId,
      channelKind: config.kind,
      externalMessageId: "msg-1",
      externalChatId: "chat-1",
      externalThreadId: "thread-1",
      type: "chat" as const,
      text: "hello",
      attachments: [],
      receivedAt: 1,
      metadata: {},
    };
    expect(store.recordInbound(inbound).duplicate).toBe(false);
    expect(store.recordInbound(inbound).duplicate).toBe(true);

    store.updateInboundRoute({
      inboundMessageId: inbound.id,
      channelId: config.channelId,
      bindingId: rebound.bindingId,
      sessionId: rebound.sessionId,
      runId: "run-1",
      payload: inbound,
    });

    const delivery = store.createDelivery({
      id: "outbound-1",
      channelId: config.channelId,
      bindingId: rebound.bindingId,
      sessionId: rebound.sessionId,
      runId: "run-1",
      externalChatId: "chat-1",
      externalThreadId: "thread-1",
      inReplyToExternalMessageId: "msg-1",
      text: "hello back",
      isFinal: true,
      kind: "final",
      attachments: [],
      createdAt: 2,
      metadata: {},
    });
    expect(delivery.status).toBe("queued");
    expect(delivery.deliveryId).toBe("delivery-test-3");

    const failed = store.updateDelivery(delivery.deliveryId, {
      status: "retry_scheduled",
      attemptCount: 1,
      nextAttemptAt: 10,
      lastError: "callback timeout",
    });
    expect(failed.status).toBe("retry_scheduled");
    expect(store.retryDelivery({ deliveryId: delivery.deliveryId }).status).toBe("queued");
    expect(store.listDeliveries({ channelId: config.channelId })).toHaveLength(1);
  });

  it("returns empty channel lists when limit is zero", () => {
    const backend = new SqliteRuntimePersistence(path.join(tempDir, "runtime.db"));
    const store = new ChannelStore(backend, { clock, idFactory });
    const config = store.createConfig({
      label: "HTTP Webhook",
      kind: "http_webhook",
      config: {
        callbackUrl: "http://localhost:9876/callback",
        token: "secret-token",
      },
    });

    const binding = store.createBinding({
      channelId: config.channelId,
      externalChatId: "chat-1",
      sessionId: "session-1",
    });
    store.recordInbound({
      id: "inbound-1",
      channelId: config.channelId,
      channelKind: config.kind,
      externalMessageId: "msg-1",
      externalChatId: "chat-1",
      type: "chat",
      text: "hello",
      attachments: [],
      receivedAt: 1,
      metadata: {},
    });
    store.createDelivery({
      id: "outbound-1",
      channelId: config.channelId,
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      runId: "run-1",
      externalChatId: "chat-1",
      text: "hello back",
      isFinal: true,
      kind: "final",
      attachments: [],
      createdAt: 2,
      metadata: {},
    });

    expect(backend.listChannelBindings({ limit: 0 })).toEqual([]);
    expect(backend.listChannelMessages({ limit: 0 })).toEqual([]);
    expect(backend.listChannelDeliveries({ limit: 0 })).toEqual([]);
  });
});
