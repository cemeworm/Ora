import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ChannelGetParamsSchema } from "@cemeworm/shared";
import type { LocalRunStore } from "./run-store.js";
import { normalizeDingtalkWebhookPayload } from "./channels/dingtalk.js";
import { normalizeFeishuWebhookPayload, validateFeishuWebhookAuth } from "./channels/feishu.js";
import { validateHttpWebhookAuth } from "./channels/http-webhook.js";

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
};

export interface RuntimeHttpServerOptions {
  host?: string;
  port?: number;
  /** Allow /media?path= to serve files under this directory. */
  mediaRoot?: string;
}

export function createRuntimeHttpServer(store: LocalRunStore, options?: RuntimeHttpServerOptions): http.Server {
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

      // Serve media files (images, videos) for inline browser rendering
      if (request.method === "GET" && url.pathname === "/media") {
        return serveMediaFile(response, url, options?.mediaRoot);
      }

      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function serveMediaFile(
  response: http.ServerResponse,
  url: URL,
  mediaRoot?: string,
): void {
  const filePath = url.searchParams.get("path");
  if (!filePath) {
    sendJson(response, 400, { error: "Missing ?path= query parameter" });
    return;
  }

  if (!mediaRoot) {
    sendJson(response, 500, { error: "Media root not configured" });
    return;
  }

  // Resolve and validate the path stays within mediaRoot
  const resolved = path.resolve(mediaRoot, filePath);
  const normalizedRoot = path.resolve(mediaRoot) + path.sep;
  if (!resolved.startsWith(normalizedRoot) && resolved !== path.resolve(mediaRoot)) {
    sendJson(response, 403, { error: "Access denied" });
    return;
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      sendJson(response, 404, { error: "Not a file" });
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_MAP[ext] ?? "application/octet-stream";
    const fileStream = fs.createReadStream(resolved);

    response.statusCode = 200;
    response.setHeader("content-type", contentType);
    response.setHeader("content-length", stat.size);
    response.setHeader("cache-control", "public, max-age=3600");
    fileStream.pipe(response);
    fileStream.on("error", () => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: "Read error" });
      }
    });
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === "ENOENT") {
      sendJson(response, 404, { error: "File not found" });
    } else {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export function listenRuntimeHttpServer(store: LocalRunStore, options: RuntimeHttpServerOptions = {}): Promise<http.Server> {
  const server = createRuntimeHttpServer(store, options);
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
