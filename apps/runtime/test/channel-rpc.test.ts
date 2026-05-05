import fs from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelDeliverySchema, ChannelIngestResultSchema, ChannelStatusResultSchema, SINGLE_AGENT_MODE_ID, StateSnapshotSchema } from "@cemeworm/shared";
import { createRuntimeHttpServer, createRuntimeMethodHandler, LocalRunStore } from "../src/index.js";
import { createRunningRunSnapshot } from "../src/run-snapshots.js";
import { validateHttpWebhookAuth } from "../src/channels/http-webhook.js";

let tempDir: string;
let currentTime: number;
const clock = () => currentTime++;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-channel-rpc-"));
  currentTime = 1_700_000_000_000;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createStore(): LocalRunStore {
  return new LocalRunStore({ dataDir: path.join(tempDir, "runtime.db"), clock });
}

function request(method: string, params?: unknown) {
  return { jsonrpc: "2.0" as const, id: method, method, params };
}

describe("channel JSON-RPC", () => {
  it("creates a channel, ingests chat into a stable session, dedupes inbound ids, and records sent delivery", async () => {
    const store = createStore();
    const handler = createRuntimeMethodHandler(store);
    const channel = await handler(request("channels.create", {
      channelId: "channel-http",
      label: "HTTP Webhook",
      kind: "http_webhook",
      config: { token: "secret-token" },
    })) as { channelId: string; config: Record<string, unknown> };
    expect(channel.channelId).toBe("channel-http");
    expect(channel.config.token).toBe("[redacted]");

    const first = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
      channelId: channel.channelId,
      externalMessageId: "msg-1",
      externalChatId: "chat-1",
      externalThreadId: "thread-1",
      text: "Say hello from a channel.",
    })));
    expect(first.accepted).toBe(true);
    expect(first.sessionId).toBeTruthy();
    expect(first.runId).toBeTruthy();
    expect(first.outboundMessage?.kind).toBe("final");

    const duplicate = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
      channelId: channel.channelId,
      externalMessageId: "msg-1",
      externalChatId: "chat-1",
      externalThreadId: "thread-1",
      text: "Duplicate should not run.",
    })));
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.runId).toBe(first.runId);

    const second = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
      channelId: channel.channelId,
      externalMessageId: "msg-2",
      externalChatId: "chat-1",
      externalThreadId: "thread-1",
      text: "Continue in the same channel thread.",
    })));
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.runId).not.toBe(first.runId);

    const detail = store.getSession({ sessionId: first.sessionId });
    expect(detail.turns.map((turn) => turn.turnIndex)).toEqual([1, 2]);

    const deliveries = await handler(request("channels.deliveries.list", { channelId: channel.channelId })) as unknown[];
    expect(deliveries).toHaveLength(2);
    expect(ChannelDeliverySchema.parse(deliveries[0]).status).toBe("sent");
    const status = ChannelStatusResultSchema.parse(await handler(request("channels.status")));
    expect(status.channels[0]?.channelId).toBe(channel.channelId);
  });

  it("passes channel runConfig into channel-originated runs", async () => {
    const store = createStore();
    const handler = createRuntimeMethodHandler(store);
    await handler(request("channels.create", {
      channelId: "channel-model",
      label: "Model",
      kind: "http_webhook",
      config: {
        runConfig: {
          providerId: "local-smoke",
          modelRef: "channel-selected-model",
        },
      },
    }));

    const result = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
      channelId: "channel-model",
      externalMessageId: "model-1",
      externalChatId: "chat-model",
      text: "Use the channel model.",
    })));
    const snapshot = StateSnapshotSchema.parse(store.getRunState({ runId: result.runId }));
    expect(snapshot.config.providerId).toBe("local-smoke");
    expect(snapshot.config.modelRef).toBe("channel-selected-model");
    expect(snapshot.config.modeSelection).toBe("auto");
    expect(snapshot.config.permissionMode).toBe("default");
    expect(snapshot.config.metadata.taskIntentMode).toBe("auto");
    expect(snapshot.config.metadata.taskIntent).toBe("plan");
    expect(snapshot.config.metadata.autoModeRouter).toMatchObject({
      selectedTaskIntent: "plan",
      status: "fallback",
    });
  });

  it("migrates legacy channel chat targets to auto and preserves explicit fixed targets", async () => {
    const store = createStore();
    const handler = createRuntimeMethodHandler(store);
    const migrated = await handler(request("channels.create", {
      channelId: "channel-legacy-target",
      label: "Legacy Target",
      kind: "http_webhook",
      config: {
        runConfig: {
          metadata: { taskIntent: "chat" },
        },
      },
    })) as { config: { runConfig?: { metadata?: Record<string, unknown> } } };
    expect(migrated.config.runConfig?.metadata).toMatchObject({ taskIntentMode: "auto" });
    expect(migrated.config.runConfig?.metadata?.taskIntent).toBeUndefined();

    await handler(request("channels.create", {
      channelId: "channel-fixed-target",
      label: "Fixed Target",
      kind: "http_webhook",
      config: {
        runConfig: {
          metadata: { taskIntentMode: "fixed", taskIntent: "chat" },
        },
      },
    }));
    const result = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
      channelId: "channel-fixed-target",
      externalMessageId: "fixed-1",
      externalChatId: "chat-fixed",
      text: "Keep this as chat.",
    })));
    const snapshot = StateSnapshotSchema.parse(store.getRunState({ runId: result.runId }));
    expect(snapshot.config.metadata.taskIntentMode).toBe("fixed");
    expect(snapshot.config.metadata.taskIntent).toBe("chat");
  });

  it("handles /help, /status, and /new without normal run execution", async () => {
    const store = createStore();
    const handler = createRuntimeMethodHandler(store);
    await handler(request("channels.create", { channelId: "channel-cmd", label: "Commands", kind: "http_webhook" }));

    const help = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
      channelId: "channel-cmd",
      externalMessageId: "cmd-1",
      externalChatId: "chat-cmd",
      type: "command",
      text: "/help",
    })));
    expect(help.outboundMessage?.kind).toBe("command_response");
    expect(help.outboundMessage?.text).toContain("/status");
    expect(help.runId).toBeUndefined();
    expect(store.listRuns({ sessionId: help.sessionId })).toHaveLength(0);

    const status = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
      channelId: "channel-cmd",
      externalMessageId: "cmd-2",
      externalChatId: "chat-cmd",
      type: "command",
      text: "/status",
    })));
    expect(status.sessionId).toBe(help.sessionId);
    expect(status.outboundMessage?.text).toContain("Session:");

    const fresh = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
      channelId: "channel-cmd",
      externalMessageId: "cmd-3",
      externalChatId: "chat-cmd",
      type: "command",
      text: "/new",
    })));
    expect(fresh.sessionId).not.toBe(help.sessionId);
  });

  it("serializes concurrent messages for the same external thread", async () => {
    const store = createStore();
    const handler = createRuntimeMethodHandler(store);
    await handler(request("channels.create", { channelId: "channel-serial", label: "Serial", kind: "http_webhook" }));

    const [first, second] = await Promise.all([
      handler(request("channels.ingest", {
        channelId: "channel-serial",
        externalMessageId: "serial-1",
        externalChatId: "chat-serial",
        text: "first channel message",
      })),
      handler(request("channels.ingest", {
        channelId: "channel-serial",
        externalMessageId: "serial-2",
        externalChatId: "chat-serial",
        text: "second channel message",
      })),
    ]);
    const parsedFirst = ChannelIngestResultSchema.parse(first);
    const parsedSecond = ChannelIngestResultSchema.parse(second);
    expect(parsedSecond.sessionId).toBe(parsedFirst.sessionId);
    const detail = store.getSession({ sessionId: parsedFirst.sessionId });
    expect(detail.turns.map((turn) => turn.turnIndex)).toEqual([1, 2]);
  });

  it("schedules callback delivery retry when the callback endpoint fails", async () => {
    const callbackServer = http.createServer((_request, response) => {
      response.statusCode = 500;
      response.end("nope");
    });
    await new Promise<void>((resolve) => callbackServer.listen(0, "127.0.0.1", () => resolve()));
    const address = callbackServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected callback server address.");
    }

    try {
      const store = createStore();
      const handler = createRuntimeMethodHandler(store);
      await handler(request("channels.create", {
        channelId: "channel-callback",
        label: "Callback",
        kind: "http_webhook",
        config: { callbackUrl: `http://127.0.0.1:${address.port}/callback` },
      }));
      const result = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
        channelId: "channel-callback",
        externalMessageId: "cb-1",
        externalChatId: "chat-cb",
        type: "command",
        text: "/help",
      })));
      const deliveries = store.listChannelDeliveries({ channelId: "channel-callback" });
      expect(deliveries.find((delivery) => delivery.deliveryId === result.deliveryId)?.status).toBe("retry_scheduled");
    } finally {
      await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
    }
  });

  it("downloads small text attachments into run context", async () => {
    const attachmentServer = http.createServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end("attachment body from channel");
    });
    await new Promise<void>((resolve) => attachmentServer.listen(0, "127.0.0.1", () => resolve()));
    const address = attachmentServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected attachment server address.");
    }
    try {
      const store = createStore();
      const handler = createRuntimeMethodHandler(store);
      await handler(request("channels.create", { channelId: "channel-attachment", label: "Attachments", kind: "http_webhook" }));
      const result = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
        channelId: "channel-attachment",
        externalMessageId: "att-1",
        externalChatId: "chat-attachment",
        text: "Summarize this attachment.",
        attachments: [{ id: "att-text", kind: "file", url: `http://127.0.0.1:${address.port}/note.txt` }],
      })));
      const snapshot = StateSnapshotSchema.parse(store.getRunState({ runId: result.runId }));
      const attachments = snapshot.input.context.attachments as Array<{ metadata?: Record<string, unknown> }>;
      expect(attachments[0]?.metadata?.download).toMatchObject({
        status: "downloaded",
        textPreview: "attachment body from channel",
      });
    } finally {
      await new Promise<void>((resolve) => attachmentServer.close(() => resolve()));
    }
  });

  it("uses channel replies to answer pending clarifications", async () => {
    const store = createStore();
    const handler = createRuntimeMethodHandler(store);
    await handler(request("channels.create", { channelId: "channel-clarify", label: "Clarify", kind: "http_webhook" }));
    const help = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
      channelId: "channel-clarify",
      externalMessageId: "clarify-help",
      externalChatId: "chat-clarify",
      type: "command",
      text: "/help",
    })));

    const handle = await store.startRunWithSnapshot({
      sessionId: help.sessionId,
      input: { prompt: "Need more info before proceeding." },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        providerId: "channel-clarify-provider",
        modelRef: "channel-clarify-model",
        providerConfig: {
          id: "channel-clarify-provider",
          label: "Channel Clarify Provider",
          type: "openai_compatible",
          modelId: "channel-clarify-model",
          baseUrl: "https://channel-clarify.test/v1",
          apiKeyEnv: "CHANNEL_CLARIFY_KEY",
          capabilities: ["chat"],
          headers: {},
        },
      },
    }, async (args) => {
      const base = createRunningRunSnapshot({ ...args, clock });
      return StateSnapshotSchema.parse({
        ...base,
        status: "interrupted",
        pendingClarifications: [{
          id: "clarification:ora:target",
          key: "target",
          nodeId: "ora",
          nodeLabel: "Ora",
          question: "Which target?",
          options: [],
          requestedAt: clock(),
        }],
        events: [{
          id: `${base.runId}:evt-0`,
          runId: base.runId,
          seq: 0,
          type: "clarification.required",
          createdAt: clock(),
          pattern: base.pattern,
          nodeId: "ora",
          agentId: "ora",
          payload: { clarificationId: "clarification:ora:target" },
        }],
      });
    });

    const blockedSnapshot = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));
    expect(blockedSnapshot.status).toBe("interrupted");
    expect(blockedSnapshot.pendingClarifications[0]?.key).toBe("target");

    const previousFetch = globalThis.fetch;
    process.env.CHANNEL_CLARIFY_KEY = "test";
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "Resumed with staging." } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
    try {
      const resumed = ChannelIngestResultSchema.parse(await handler(request("channels.ingest", {
        channelId: "channel-clarify",
        externalMessageId: "clarify-answer",
        externalChatId: "chat-clarify",
        text: "staging",
      })));
      expect(resumed.runId).toBe(handle.runId);
      expect(resumed.outboundMessage?.text).toContain("staging");
      const resumedSnapshot = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));
      expect(resumedSnapshot.status).toBe("succeeded");
      expect(resumedSnapshot.events.map((event) => event.type)).toContain("clarification.resolved");
    } finally {
      globalThis.fetch = previousFetch;
      delete process.env.CHANNEL_CLARIFY_KEY;
    }
  });
});

describe("channel HTTP webhook", () => {

  it("validates HMAC webhook signatures", () => {
    const rawBody = JSON.stringify({ externalMessageId: "hmac-1" });
    const signature = crypto.createHmac("sha256", "signing-secret").update(rawBody).digest("hex");
    const config = {
      channelId: "channel-hmac",
      kind: "http_webhook" as const,
      label: "HMAC",
      enabled: true,
      capabilities: {},
      config: { signingSecret: "signing-secret" },
      secretRefs: {},
      createdAt: 1,
      updatedAt: 1,
    };
    expect(validateHttpWebhookAuth(config, new Headers({ "x-ora-signature": `sha256=${signature}` }), rawBody)).toBe(true);
    expect(validateHttpWebhookAuth(config, new Headers({ "x-ora-signature": "sha256=00" }), rawBody)).toBe(false);
  });

  it("rejects invalid token and accepts authenticated webhook payloads", async () => {
    const store = createStore();
    store.createChannel({
      channelId: "channel-http-auth",
      label: "HTTP Auth",
      kind: "http_webhook",
      config: { token: "secret-token" },
    });
    const server = createRuntimeHttpServer(store);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server address.");
    }
    const url = `http://127.0.0.1:${address.port}/channels/channel-http-auth/webhook`;
    try {
      const rejected = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalMessageId: "http-1", externalChatId: "chat-http", type: "command", text: "/help" }),
      });
      expect(rejected.status).toBe(401);

      const accepted = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer secret-token" },
        body: JSON.stringify({ externalMessageId: "http-1", externalChatId: "chat-http", type: "command", text: "/help" }),
      });
      expect(accepted.status).toBe(202);
      const body = ChannelIngestResultSchema.parse(await accepted.json());
      expect(body.outboundMessage?.kind).toBe("command_response");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("handles Feishu challenge and message webhooks", async () => {
    const store = createStore();
    store.createChannel({
      channelId: "channel-feishu",
      label: "Feishu",
      kind: "feishu",
      config: { verificationToken: "verify-token" },
    });
    const server = createRuntimeHttpServer(store);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server address.");
    }
    const url = `http://127.0.0.1:${address.port}/channels/channel-feishu/webhook`;
    try {
      const challenge = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "verify-token", challenge: "challenge-code" }),
      });
      expect(challenge.status).toBe(200);
      expect(await challenge.json()).toEqual({ challenge: "challenge-code" });

      const accepted = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "verify-token",
          header: { event_id: "event-1", event_type: "im.message.receive_v1" },
          event: {
            sender: { sender_id: { open_id: "ou_1" }, sender_type: "user" },
            message: {
              message_id: "om_1",
              chat_id: "oc_1",
              content: JSON.stringify({ text: "/help" }),
            },
          },
        }),
      });
      expect(accepted.status).toBe(202);
      const body = ChannelIngestResultSchema.parse(await accepted.json());
      expect(body.outboundMessage?.kind).toBe("command_response");
      expect(body.sessionId).toBeTruthy();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
