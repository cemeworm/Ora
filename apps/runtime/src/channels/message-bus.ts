import type { ChannelInboundMessage, ChannelOutboundMessage } from "@cemeworm/shared";

type OutboundSubscriber = (message: ChannelOutboundMessage) => Promise<void> | void;

export interface ChannelMessageBusStats {
  inboundQueueSize: number;
  inboundPublishedCount: number;
  outboundPublishedCount: number;
  outboundSubscriberFailures: number;
}

export class ChannelMessageBus {
  private readonly inboundQueue: ChannelInboundMessage[] = [];
  private readonly outboundSubscribers = new Set<OutboundSubscriber>();
  private inboundPublishedCount = 0;
  private outboundPublishedCount = 0;
  private outboundSubscriberFailures = 0;

  publishInbound(message: ChannelInboundMessage): void {
    this.inboundQueue.push(message);
    this.inboundPublishedCount += 1;
  }

  nextInbound(): ChannelInboundMessage | undefined {
    return this.inboundQueue.shift();
  }

  subscribeOutbound(subscriber: OutboundSubscriber): () => void {
    this.outboundSubscribers.add(subscriber);
    return () => this.outboundSubscribers.delete(subscriber);
  }

  async publishOutbound(message: ChannelOutboundMessage): Promise<void> {
    this.outboundPublishedCount += 1;
    await Promise.all([...this.outboundSubscribers].map(async (subscriber) => {
      try {
        await subscriber(message);
      } catch {
        this.outboundSubscriberFailures += 1;
      }
    }));
  }

  stats(): ChannelMessageBusStats {
    return {
      inboundQueueSize: this.inboundQueue.length,
      inboundPublishedCount: this.inboundPublishedCount,
      outboundPublishedCount: this.outboundPublishedCount,
      outboundSubscriberFailures: this.outboundSubscriberFailures,
    };
  }
}
