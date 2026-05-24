import { describe, expect, it } from "vitest";
import {
  channelStateLabel,
  isWechatReconnectRequired,
  shouldAutoRefreshChannelStatus,
} from "./SettingsView";
import type { OraChannelConfig } from "../lib/runtimeClient";

function makeChannel(overrides: Partial<OraChannelConfig> = {}): OraChannelConfig {
  return {
    channelId: overrides.channelId ?? "wechat-1",
    kind: overrides.kind ?? "wechat",
    label: overrides.label ?? "WeChat",
    enabled: overrides.enabled ?? true,
    capabilities: overrides.capabilities ?? {
      supportsStreamingUpdates: true,
      supportsThreadReplies: false,
      supportsReactions: false,
      supportsFileInbound: false,
      supportsFileOutbound: false,
      supportsMessageUpdate: false,
    },
    config: overrides.config ?? { bound: false },
    secretRefs: overrides.secretRefs ?? {},
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
  };
}

describe("SettingsView channel helpers", () => {
  it("marks enabled but unbound WeChat channels as disconnected", () => {
    const channel = makeChannel({ enabled: true, config: { bound: false } });

    expect(isWechatReconnectRequired(channel)).toBe(true);
    expect(channelStateLabel(channel, true)).toBe("已掉绑");
  });

  it("does not flag disabled or rebound WeChat channels", () => {
    expect(isWechatReconnectRequired(makeChannel({ enabled: false, config: { bound: false } }))).toBe(false);
    expect(isWechatReconnectRequired(makeChannel({ enabled: true, config: { bound: true } }))).toBe(false);
  });

  it("only auto-refreshes channel status while the WeChat tab is open", () => {
    expect(shouldAutoRefreshChannelStatus(true, "channels", "wechat")).toBe(true);
    expect(shouldAutoRefreshChannelStatus(false, "channels", "wechat")).toBe(false);
    expect(shouldAutoRefreshChannelStatus(true, "general", "wechat")).toBe(false);
    expect(shouldAutoRefreshChannelStatus(true, "channels", "feishu")).toBe(false);
  });
});
