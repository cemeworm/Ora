import type {
  ChannelConfig,
  ChannelStatus,
  ChannelStatusResult,
} from "@ora/shared";
import { ChannelStatusResultSchema } from "@ora/shared";
import type { RuntimePersistenceBackend } from "../persistence/types.js";
import type { ChannelRunRuntime } from "./manager.js";
import { ChannelManager } from "./manager.js";
import { ChannelMessageBus } from "./message-bus.js";
import { ChannelStore } from "./store.js";
import type { ChannelAdapter } from "./base.js";
import { DingtalkChannelAdapter } from "./dingtalk.js";
import { DiscordChannelAdapter } from "./discord.js";
import { FeishuChannelAdapter } from "./feishu.js";
import { HttpWebhookChannelAdapter } from "./http-webhook.js";
import { SlackChannelAdapter } from "./slack.js";
import { TelegramChannelAdapter } from "./telegram.js";
import { WechatChannelAdapter } from "./wechat.js";
import { WecomChannelAdapter } from "./wecom.js";

export interface ChannelServiceOptions {
  clock?: () => number;
  idFactory?: () => string;
  fetchImpl?: typeof fetch;
}

export class ChannelService {
  readonly store: ChannelStore;
  readonly bus: ChannelMessageBus;
  readonly manager: ChannelManager;
  private readonly adapters = new Map<string, ChannelAdapter>();
  private readonly clock: () => number;
  private readonly fetchImpl: typeof fetch;

  constructor(backend: RuntimePersistenceBackend, runtime: ChannelRunRuntime, options: ChannelServiceOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.store = new ChannelStore(backend, options);
    this.bus = new ChannelMessageBus();
    this.manager = new ChannelManager(this.store, runtime, this.bus, options);
  }

  create(params: unknown): ChannelConfig {
    const config = this.store.createConfig(params);
    if (config.enabled) {
      const adapter = this.ensureAdapter(config.channelId);
      adapter.start();
    }
    return config;
  }

  list(params: unknown = {}): ChannelConfig[] {
    return this.store.listConfigs(params);
  }

  get(params: { channelId: string } | unknown, options: { redact?: boolean } = {}): ChannelConfig {
    const channelId = typeof params === "object" && params && "channelId" in params ? String((params as { channelId: unknown }).channelId) : "";
    return this.store.getConfigOrThrow(channelId, options);
  }

  update(params: unknown): ChannelConfig {
    const config = this.store.updateConfig(params);
    const oldAdapter = this.adapters.get(config.channelId);
    if (oldAdapter) {
      oldAdapter.stop();
    }
    this.adapters.delete(config.channelId);
    if (config.enabled) {
      const adapter = this.ensureAdapter(config.channelId);
      adapter.start();
    }
    return config;
  }

  delete(params: { channelId: string } | unknown): { deleted: true; channelId: string } {
    const channelId = typeof params === "object" && params && "channelId" in params ? String((params as { channelId: unknown }).channelId) : "";
    const oldAdapter = this.adapters.get(channelId);
    if (oldAdapter) {
      oldAdapter.stop();
    }
    this.adapters.delete(channelId);
    return this.store.deleteConfig(channelId);
  }

  async start(params: { channelId: string } | unknown): Promise<ChannelStatus> {
    const channelId = typeof params === "object" && params && "channelId" in params ? String((params as { channelId: unknown }).channelId) : "";
    const adapter = this.ensureAdapter(channelId);
    await adapter.start();
    return adapter.status();
  }

  async stop(params: { channelId: string } | unknown): Promise<ChannelStatus> {
    const channelId = typeof params === "object" && params && "channelId" in params ? String((params as { channelId: unknown }).channelId) : "";
    const adapter = this.ensureAdapter(channelId);
    await adapter.stop();
    return adapter.status();
  }

  async restart(params: { channelId: string } | unknown): Promise<ChannelStatus> {
    await this.stop(params);
    return this.start(params);
  }

  status(): ChannelStatusResult {
    const configs = this.store.listConfigs();
    const channels = configs.map((config) => {
      const adapter = this.adapters.get(config.channelId);
      return adapter?.status() ?? {
        channelId: config.channelId,
        kind: config.kind,
        label: config.label,
        enabled: config.enabled,
        state: "stopped" as const,
        queueSize: 0,
        runningCount: 0,
        updatedAt: this.clock(),
      };
    });
    return ChannelStatusResultSchema.parse({ channels, bus: this.bus.stats() });
  }

  ingest(params: unknown) {
    return this.manager.ingest(params);
  }

  listBindings(params: unknown = {}) {
    return this.store.listBindings(params);
  }

  listDeliveries(params: unknown = {}) {
    return this.store.listDeliveries(params);
  }

  retryDelivery(params: unknown) {
    return this.store.retryDelivery(params);
  }

  // -----------------------------------------------------------------------
  // WeChat QR code binding
  // -----------------------------------------------------------------------

  async wechatRequestQrCode(params: unknown): Promise<{ base64: string; qrcode: string; mimeType: string; imageSrc: string; pageSrc?: string }> {
    const { channelId } = params as { channelId: string };
    const adapter = this.getOrCreateWechatAdapter(channelId);
    return adapter.requestQrCode();
  }

  async wechatPollQrCodeStatus(params: unknown): Promise<{
    status: string;
    botToken?: string;
    baseUrl?: string;
  }> {
    const { channelId } = params as { channelId: string };
    const adapter = this.getOrCreateWechatAdapter(channelId);
    return adapter.pollQrCodeStatus();
  }

  private getOrCreateWechatAdapter(channelId: string): WechatChannelAdapter {
    const existing = this.adapters.get(channelId);
    if (existing && existing instanceof WechatChannelAdapter) {
      return existing;
    }
    const config = this.store.getConfigOrThrow(channelId, { redact: false });
    if (config.kind !== "wechat") {
      throw new Error(`Channel ${channelId} is not a wechat channel`);
    }
    const adapter = this.createAdapter(config);
    this.adapters.set(channelId, adapter);
    return adapter as WechatChannelAdapter;
  }

  private ensureAdapter(channelId: string): ChannelAdapter {
    const existing = this.adapters.get(channelId);
    if (existing) {
      return existing;
    }
    const config = this.store.getConfigOrThrow(channelId, { redact: false });
    const adapter = this.createAdapter(config);
    this.adapters.set(channelId, adapter);
    this.bus.subscribeOutbound(async (message) => {
      if (message.channelId !== channelId) {
        return;
      }
      const result = await adapter.send(message);
      const delivery = this.store.listDeliveries({ channelId, runId: message.runId, limit: 20 })
        .find((candidate) => candidate.outboundMessageId === message.id);
      if (!delivery) {
        return;
      }
      if (!result.ok) {
        this.store.updateDelivery(delivery.deliveryId, {
          status: "retry_scheduled",
          attemptCount: delivery.attemptCount + 1,
          nextAttemptAt: this.clock() + 1000,
          lastError: result.error,
        });
        return;
      }
      this.store.updateDelivery(delivery.deliveryId, {
        status: "sent",
        attemptCount: delivery.attemptCount + 1,
        lastError: undefined,
      });
    });
    return adapter;
  }

  private createAdapter(config: ChannelConfig): ChannelAdapter {
    switch (config.kind) {
      case "http_webhook":
        return new HttpWebhookChannelAdapter(config, this.fetchImpl);
      case "feishu":
        return new FeishuChannelAdapter(config, this.fetchImpl);
      case "wechat":
        return new WechatChannelAdapter(config, this.fetchImpl, {
          onIngest: (params) => this.manager.ingest(params),
          onConfigUpdate: (channelId, patch) =>
            this.store.updateConfig({
              channelId,
              config: patch,
            }),
        });
      case "telegram":
        return new TelegramChannelAdapter(config, this.fetchImpl, {
          onIngest: (params) => this.manager.ingest(params),
        });
      case "dingtalk":
        return new DingtalkChannelAdapter(config, this.fetchImpl);
      case "slack":
        return new SlackChannelAdapter(config, this.fetchImpl, {
          onIngest: (params) => this.manager.ingest(params),
        });
      case "wecom":
        return new WecomChannelAdapter(config, {
          onIngest: (params) => this.manager.ingest(params),
        });
      case "discord":
        return new DiscordChannelAdapter(config, this.fetchImpl, {
          onIngest: (params) => this.manager.ingest(params),
        });
      default:
        throw new Error(`Channel kind '${config.kind}' is not implemented yet.`);
    }
  }
}
