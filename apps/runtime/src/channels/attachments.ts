import crypto from "node:crypto";
import { ChannelAttachmentSchema, type ChannelAttachment } from "@ora/shared";

export interface ChannelAttachmentPipelineOptions {
  fetchImpl?: typeof fetch;
  clock?: () => number;
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024;
const TEXT_MIME_PATTERN = /^(text\/|application\/(json|xml|javascript|x-ndjson))/i;

export async function enrichChannelAttachments(
  attachments: readonly ChannelAttachment[],
  options: ChannelAttachmentPipelineOptions = {},
): Promise<ChannelAttachment[]> {
  if (attachments.length === 0) {
    return [];
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const clock = options.clock ?? Date.now;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  return Promise.all(attachments.map((attachment) => enrichChannelAttachment(attachment, { fetchImpl, clock, maxBytes })));
}

async function enrichChannelAttachment(
  attachment: ChannelAttachment,
  options: Required<Pick<ChannelAttachmentPipelineOptions, "fetchImpl" | "clock" | "maxBytes">>,
): Promise<ChannelAttachment> {
  const parsed = ChannelAttachmentSchema.parse(attachment);
  if (!parsed.url || !/^https?:\/\//i.test(parsed.url)) {
    return parsed;
  }

  try {
    const response = await options.fetchImpl(parsed.url);
    if (!response.ok) {
      return withDownloadMetadata(parsed, {
        status: "failed",
        error: `HTTP ${response.status}`,
        fetchedAt: options.clock(),
      });
    }
    const contentType = response.headers.get("content-type") ?? parsed.mimeType ?? "application/octet-stream";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const baseMetadata = {
      status: buffer.byteLength > options.maxBytes ? "too_large" : "downloaded",
      fetchedAt: options.clock(),
      mimeType: contentType,
      sizeBytes: buffer.byteLength,
      sha256,
      maxBytes: options.maxBytes,
    };
    if (buffer.byteLength > options.maxBytes) {
      return withDownloadMetadata(parsed, baseMetadata);
    }
    if (TEXT_MIME_PATTERN.test(contentType)) {
      return withDownloadMetadata(parsed, {
        ...baseMetadata,
        textPreview: buffer.toString("utf8").slice(0, 16_000),
      });
    }
    return withDownloadMetadata(parsed, {
      ...baseMetadata,
      dataBase64: buffer.toString("base64"),
    });
  } catch (error) {
    return withDownloadMetadata(parsed, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      fetchedAt: options.clock(),
    });
  }
}

function withDownloadMetadata(attachment: ChannelAttachment, download: Record<string, unknown>): ChannelAttachment {
  return ChannelAttachmentSchema.parse({
    ...attachment,
    mimeType: typeof download.mimeType === "string" ? download.mimeType : attachment.mimeType,
    sizeBytes: typeof download.sizeBytes === "number" ? download.sizeBytes : attachment.sizeBytes,
    metadata: {
      ...attachment.metadata,
      download,
    },
  });
}
