import crypto from "node:crypto";
import {
  ChannelBindingSchema,
  ChannelConfigSchema,
  ChannelCreateParamsSchema,
  ChannelDeliverySchema,
  ChannelDeliveryRetryParamsSchema,
  ChannelDeliveriesListParamsSchema,
  ChannelInboundMessage,
  ChannelListParamsSchema,
  ChannelMessageRecordSchema,
  ChannelOutboundMessage,
  ChannelUpdateParamsSchema,
  type ChannelBinding,
  type ChannelConfig,
  type ChannelCreateParams,
  type ChannelDelivery,
  type ChannelDeliveryStatus,
  type ChannelInboundMessage as ChannelInboundMessageType,
  type ChannelMessageRecord,
  type ChannelOutboundMessage as ChannelOutboundMessageType,
  type ChannelUpdateParams,
} from "@cemeworm/shared";
import type { RuntimePersistenceBackend } from "../persistence/types.js";
import { OraRuntimeError } from "../runtime-errors.js";

const SECRET_KEY_PATTERN = /(token|secret|password|apiKey|authorization|signature)/i;

export interface ChannelStoreOptions {
  clock?: () => number;
  idFactory?: () => string;
}

export class ChannelStore {
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(private readonly backend: RuntimePersistenceBackend, options: ChannelStoreOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  createConfig(params: ChannelCreateParams | unknown): ChannelConfig {
    const parsed = ChannelCreateParamsSchema.parse(params);
    const now = this.clock();
    const config = ChannelConfigSchema.parse({
      channelId: parsed.channelId ?? `channel-${this.idFactory()}`,
      kind: parsed.kind,
      label: parsed.label,
      enabled: parsed.enabled,
      capabilities: parsed.capabilities ?? {},
      config: parsed.config,
      secretRefs: parsed.secretRefs,
      createdAt: now,
      updatedAt: now,
    });
    const normalized = normalizeChannelConfig(config);
    this.backend.saveChannelConfig(normalized);
    return this.redactConfig(normalized);
  }

  updateConfig(params: ChannelUpdateParams | unknown): ChannelConfig {
    const parsed = ChannelUpdateParamsSchema.parse(params);
    const existing = this.getConfigOrThrow(parsed.channelId, { redact: false });
    const next = normalizeChannelConfig(ChannelConfigSchema.parse({
      ...existing,
      label: parsed.label ?? existing.label,
      enabled: parsed.enabled ?? existing.enabled,
      capabilities: parsed.capabilities ? { ...existing.capabilities, ...parsed.capabilities } : existing.capabilities,
      config: parsed.config ? { ...existing.config, ...parsed.config } : existing.config,
      secretRefs: parsed.secretRefs ? { ...existing.secretRefs, ...parsed.secretRefs } : existing.secretRefs,
      updatedAt: this.clock(),
    }));
    this.backend.saveChannelConfig(next);
    return this.redactConfig(next);
  }

  listConfigs(params: unknown = {}): ChannelConfig[] {
    const parsed = ChannelListParamsSchema.parse(params ?? {});
    return this.backend.listChannelConfigs()
      .filter((config) => parsed.kind ? config.kind === parsed.kind : true)
      .filter((config) => parsed.enabled === undefined ? true : config.enabled === parsed.enabled)
      .slice(0, parsed.limit)
      .map((config) => this.redactConfig(this.normalizeStoredConfig(config)));
  }

  getConfig(channelId: string, options: { redact?: boolean } = {}): ChannelConfig | undefined {
    const config = this.backend.getChannelConfig(channelId);
    if (!config) {
      return undefined;
    }
    const normalized = this.normalizeStoredConfig(config);
    return options.redact === false ? normalized : this.redactConfig(normalized);
  }

  getConfigOrThrow(channelId: string, options: { redact?: boolean } = {}): ChannelConfig {
    const config = this.getConfig(channelId, options);
    if (!config) {
      throw new OraRuntimeError(`Channel '${channelId}' does not exist.`, -32004, { channelId });
    }
    return config;
  }

  deleteConfig(channelId: string): { deleted: true; channelId: string } {
    this.getConfigOrThrow(channelId);
    this.backend.deleteChannelConfig(channelId);
    return { deleted: true, channelId };
  }

  findBinding(channelId: string, externalChatId: string, externalThreadId?: string): ChannelBinding | undefined {
    return this.backend.getChannelBindingByExternalKey(channelId, externalChatId, externalThreadId);
  }

  createBinding(args: {
    channelId: string;
    externalChatId: string;
    externalThreadId?: string;
    externalUserId?: string;
    sessionId: string;
    metadata?: Record<string, unknown>;
  }): ChannelBinding {
    const now = this.clock();
    const existing = this.findBinding(args.channelId, args.externalChatId, args.externalThreadId);
    const binding = ChannelBindingSchema.parse({
      bindingId: existing?.bindingId ?? `binding-${this.idFactory()}`,
      channelId: args.channelId,
      externalChatId: args.externalChatId,
      externalThreadId: args.externalThreadId,
      externalUserId: args.externalUserId ?? existing?.externalUserId,
      sessionId: args.sessionId,
      metadata: { ...(existing?.metadata ?? {}), ...(args.metadata ?? {}) },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.backend.saveChannelBinding(binding);
    return binding;
  }

  updateBindingMetadata(binding: ChannelBinding, metadata: Record<string, unknown>): ChannelBinding {
    const next = ChannelBindingSchema.parse({
      ...binding,
      metadata,
      updatedAt: this.clock(),
    });
    this.backend.saveChannelBinding(next);
    return next;
  }

  listBindings(params: unknown = {}): ChannelBinding[] {
    return this.backend.listChannelBindings(params as Parameters<RuntimePersistenceBackend["listChannelBindings"]>[0]);
  }

  recordInbound(message: ChannelInboundMessageType): { duplicate: boolean; record: ChannelMessageRecord } {
    const existing = this.backend.getChannelMessageByExternalId(message.channelId, message.externalMessageId);
    if (existing) {
      return { duplicate: true, record: existing };
    }
    const record = ChannelMessageRecordSchema.parse({
      messageId: message.id,
      channelId: message.channelId,
      direction: "inbound",
      externalMessageId: message.externalMessageId,
      type: message.type,
      payload: message,
      createdAt: message.receivedAt,
    });
    this.backend.saveChannelMessage(record);
    return { duplicate: false, record };
  }

  updateInboundRoute(args: {
    inboundMessageId: string;
    channelId: string;
    bindingId: string;
    sessionId: string;
    runId?: string;
    payload: ChannelInboundMessage;
  }): ChannelMessageRecord {
    const record = ChannelMessageRecordSchema.parse({
      messageId: args.inboundMessageId,
      channelId: args.channelId,
      bindingId: args.bindingId,
      sessionId: args.sessionId,
      runId: args.runId,
      direction: "inbound",
      externalMessageId: args.payload.externalMessageId,
      type: args.payload.type,
      payload: args.payload,
      createdAt: args.payload.receivedAt,
    });
    this.backend.saveChannelMessage(record);
    return record;
  }

  recordOutbound(message: ChannelOutboundMessageType): ChannelMessageRecord {
    const record = ChannelMessageRecordSchema.parse({
      messageId: message.id,
      channelId: message.channelId,
      bindingId: message.bindingId,
      sessionId: message.sessionId,
      runId: message.runId,
      direction: "outbound",
      type: message.kind,
      payload: message,
      createdAt: message.createdAt,
    });
    this.backend.saveChannelMessage(record);
    return record;
  }

  createDelivery(message: ChannelOutboundMessageType, status: ChannelDeliveryStatus = "queued"): ChannelDelivery {
    this.recordOutbound(message);
    const now = this.clock();
    const delivery = ChannelDeliverySchema.parse({
      deliveryId: `delivery-${this.idFactory()}`,
      channelId: message.channelId,
      outboundMessageId: message.id,
      sessionId: message.sessionId,
      runId: message.runId,
      status,
      attemptCount: status === "sent" ? 1 : 0,
      message,
      createdAt: now,
      updatedAt: now,
    });
    this.backend.saveChannelDelivery(delivery);
    return delivery;
  }

  updateDelivery(deliveryId: string, patch: Partial<Pick<ChannelDelivery, "status" | "attemptCount" | "nextAttemptAt" | "lastError">>): ChannelDelivery {
    const existing = this.backend.getChannelDelivery(deliveryId);
    if (!existing) {
      throw new OraRuntimeError(`Channel delivery '${deliveryId}' does not exist.`, -32004, { deliveryId });
    }
    const next = ChannelDeliverySchema.parse({
      ...existing,
      ...patch,
      updatedAt: this.clock(),
    });
    this.backend.saveChannelDelivery(next);
    return next;
  }

  retryDelivery(params: unknown): ChannelDelivery {
    const parsed = ChannelDeliveryRetryParamsSchema.parse(params);
    return this.updateDelivery(parsed.deliveryId, { status: "queued", nextAttemptAt: undefined });
  }

  listRetryableDeliveries(now: number): ChannelDelivery[] {
    return this.backend.listChannelDeliveries({ status: "retry_scheduled" })
      .filter((d) => d.nextAttemptAt != null && d.nextAttemptAt <= now);
  }

  listDeliveries(params: unknown = {}): ChannelDelivery[] {
    const parsed = ChannelDeliveriesListParamsSchema.parse(params ?? {});
    return this.backend.listChannelDeliveries(parsed);
  }

  private redactConfig(config: ChannelConfig): ChannelConfig {
    const normalized = normalizeChannelConfig(config);
    const redactedConfig = Object.fromEntries(
      Object.entries(normalized.config).map(([key, value]) => [key, SECRET_KEY_PATTERN.test(key) ? "[redacted]" : value])
    );
    return ChannelConfigSchema.parse({ ...normalized, config: redactedConfig });
  }

  private normalizeStoredConfig(config: ChannelConfig): ChannelConfig {
    const normalized = normalizeChannelConfig(config);
    if (JSON.stringify(normalized) !== JSON.stringify(config)) {
      this.backend.saveChannelConfig(normalized);
    }
    return normalized;
  }
}

function normalizeChannelConfig(config: ChannelConfig): ChannelConfig {
  const runConfig = config.config.runConfig;
  if (!runConfig || typeof runConfig !== "object" || Array.isArray(runConfig)) {
    return config;
  }
  const metadata = (runConfig as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return config;
  }
  const metadataRecord = metadata as Record<string, unknown>;
  if (metadataRecord.taskIntent !== "chat" || metadataRecord.taskIntentMode !== undefined) {
    return config;
  }

  const restMetadata = { ...metadataRecord };
  delete restMetadata.taskIntent;
  return ChannelConfigSchema.parse({
    ...config,
    config: {
      ...config.config,
      runConfig: {
        ...(runConfig as Record<string, unknown>),
        metadata: {
          ...restMetadata,
          taskIntentMode: "auto",
        },
      },
    },
  });
}
