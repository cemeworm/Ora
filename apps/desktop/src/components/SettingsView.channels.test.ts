import { describe, expect, it } from "vitest";
import {
  channelStateLabel,
  channelLocalReadRootsText,
  isWechatReconnectRequired,
  normalizeChannelLocalReadRoots,
  shouldAutoRefreshChannelStatus,
  visibleLongTermMemorySections,
} from "./SettingsView";
import type { OraChannelConfig, OraLongTermMemoryProfile } from "../lib/runtimeClient";

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
    config: overrides.config ?? { bound: false, localReadRoots: [] },
    secretRefs: overrides.secretRefs ?? {},
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
  };
}

describe("SettingsView channel helpers", () => {
  it("marks enabled but unbound WeChat channels as disconnected", () => {
    const channel = makeChannel({ enabled: true, config: { bound: false, localReadRoots: [] } });

    expect(isWechatReconnectRequired(channel)).toBe(true);
    expect(channelStateLabel(channel, true)).toBe("已掉绑");
  });

  it("does not flag disabled or rebound WeChat channels", () => {
    expect(isWechatReconnectRequired(makeChannel({ enabled: false, config: { bound: false, localReadRoots: [] } }))).toBe(false);
    expect(isWechatReconnectRequired(makeChannel({ enabled: true, config: { bound: true, localReadRoots: [] } }))).toBe(false);
  });

  it("only auto-refreshes channel status while the WeChat tab is open", () => {
    expect(shouldAutoRefreshChannelStatus(true, "channels", "wechat")).toBe(true);
    expect(shouldAutoRefreshChannelStatus(false, "channels", "wechat")).toBe(false);
    expect(shouldAutoRefreshChannelStatus(true, "general", "wechat")).toBe(false);
    expect(shouldAutoRefreshChannelStatus(true, "channels", "feishu")).toBe(false);
  });

  it("normalizes channel local read roots from multiline input", () => {
    expect(normalizeChannelLocalReadRoots("/Users/me/a\n\n /Users/me/b \n/Users/me/a"))
      .toEqual(["/Users/me/a", "/Users/me/b"]);
  });

  it("renders saved local read roots back into textarea text", () => {
    const channel = makeChannel({
      config: {
        bound: true,
        localReadRoots: ["/Users/me/a", "/Users/me/b"],
      },
    });

    expect(channelLocalReadRootsText(channel)).toBe("/Users/me/a\n/Users/me/b");
    expect(channelLocalReadRootsText(makeChannel({ config: { bound: true, localReadRoots: [] } }))).toBe("");
  });
});

describe("SettingsView memory helpers", () => {
  it("treats an empty fallback memory profile as a valid empty state", () => {
    const memory: OraLongTermMemoryProfile = {
      version: "1.0",
      _version: 1,
      lastUpdated: "0",
      user: {
        workContext: { summary: "", updatedAt: "" },
        personalContext: { summary: "", updatedAt: "" },
        topOfMind: { summary: "", updatedAt: "" },
      },
      history: {
        recentMonths: { summary: "", updatedAt: "" },
        earlierContext: { summary: "", updatedAt: "" },
        longTermBackground: { summary: "", updatedAt: "" },
      },
      facts: [],
    };

    expect(visibleLongTermMemorySections(memory)).toEqual([]);
  });

  it("shows only non-empty long-term memory sections", () => {
    const memory: OraLongTermMemoryProfile = {
      version: "1.0",
      _version: 1,
      lastUpdated: "now",
      user: {
        workContext: { summary: "Uses Ora for desktop agent work.", updatedAt: "now" },
        personalContext: { summary: "", updatedAt: "" },
        topOfMind: { summary: "Debug bridge coverage first.", updatedAt: "now" },
      },
      history: {
        recentMonths: { summary: "", updatedAt: "" },
        earlierContext: { summary: "", updatedAt: "" },
        longTermBackground: { summary: "", updatedAt: "" },
      },
      facts: [],
    };

    expect(visibleLongTermMemorySections(memory).map((section) => section.label))
      .toEqual(["Work Context", "Top of Mind"]);
  });
});
