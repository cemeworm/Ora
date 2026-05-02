import type {
  ChannelConfig,
  ChannelInboundMessage,
  ChannelOutboundMessage,
  ChannelStatus,
} from "@cemeworm/shared";

export interface ChannelAdapter {
  readonly channelId: string;
  readonly config: ChannelConfig;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  send(message: ChannelOutboundMessage): Promise<{ ok: true; externalMessageId?: string } | { ok: false; error: string }>;
  status(): ChannelStatus;
  parseInbound?(raw: unknown): ChannelInboundMessage;
}
