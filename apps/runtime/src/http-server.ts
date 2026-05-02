import http from "node:http";
import { ChannelGetParamsSchema } from "@cemeworm/shared";
import type { LocalRunStore } from "./run-store.js";
import { normalizeDingtalkWebhookPayload } from "./channels/dingtalk.js";
import { normalizeFeishuWebhookPayload, validateFeishuWebhookAuth } from "./channels/feishu.js";
import { validateHttpWebhookAuth } from "./channels/http-webhook.js";

export interface RuntimeHttpServerOptions {
  host?: string;
  port?: number;
}

export function createRuntimeHttpServer(store: LocalRunStore): http.Server {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/channels/status") {
        return sendJson(response, 200, store.channelStatus());
      }

      const healthMatch = /^\/channels\/([^/]+)\/health$/.exec(url.pathname);
      if (request.method === "GET" && healthMatch) {
        const channelId = decodeURIComponent(healthMatch[1]!);
        const status = store.channelStatus().channels.find((channel) => channel.channelId === channelId);
        return sendJson(response, status ? 200 : 404, status ?? { error: "Channel not found" });
      }

      const webhookMatch = /^\/channels\/([^/]+)\/webhook$/.exec(url.pathname);
      if (request.method === "POST" && webhookMatch) {
        const channelId = decodeURIComponent(webhookMatch[1]!);
        const config = store.getChannel(ChannelGetParamsSchema.parse({ channelId }), { redact: false });
        const rawBody = await readRequestBody(request);
        if (config.kind === "http_webhook" && !validateHttpWebhookAuth(config, new Headers(request.headers as Record<string, string>), rawBody)) {
          return sendJson(response, 401, { error: "Unauthorized" });
        }
        const payload = JSON.parse(rawBody || "{}");
        if (config.kind === "feishu") {
          if (!validateFeishuWebhookAuth(config, new Headers(request.headers as Record<string, string>), rawBody)) {
            return sendJson(response, 401, { error: "Unauthorized" });
          }
          const normalized = normalizeFeishuWebhookPayload(payload);
          if (normalized.kind === "challenge") {
            return sendJson(response, 200, { challenge: normalized.challenge });
          }
          const result = await store.ingestChannel({ channelId, ...normalized.params });
          return sendJson(response, 202, result);
        }
        if (config.kind === "dingtalk") {
          const normalized = normalizeDingtalkWebhookPayload(payload);
          if (!normalized) {
            return sendJson(response, 200, { ok: true });
          }
          const result = await store.ingestChannel({ channelId, ...normalized });
          return sendJson(response, 200, result);
        }
        const result = await store.ingestChannel({ channelId, ...payload });
        return sendJson(response, 202, result);
      }

      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function listenRuntimeHttpServer(store: LocalRunStore, options: RuntimeHttpServerOptions = {}): Promise<http.Server> {
  const server = createRuntimeHttpServer(store);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function readRequestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}
