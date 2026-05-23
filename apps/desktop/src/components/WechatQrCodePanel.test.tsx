// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WechatQrCodePanel } from "./WechatQrCodePanel";
import type { RuntimeClient } from "../lib/runtimeClient";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

describe("WechatQrCodePanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns to the binding CTA when runtime marks the channel unbound", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const runtimeClient = {
      wechatRequestQrCode: vi.fn(),
      wechatPollQrCodeStatus: vi.fn(),
    } as unknown as RuntimeClient;

    act(() => {
      root.render(
        createElement(WechatQrCodePanel, {
          channelId: "wechat-1",
          isBound: true,
          onBind: vi.fn(),
          runtimeClient,
        }),
      );
    });

    expect(container.textContent).toContain("微信 Bot 已绑定");

    act(() => {
      root.render(
        createElement(WechatQrCodePanel, {
          channelId: "wechat-1",
          isBound: false,
          onBind: vi.fn(),
          runtimeClient,
        }),
      );
    });

    expect(container.textContent).toContain("扫码绑定微信 Bot");
    expect(container.textContent).not.toContain("微信 Bot 已绑定");

    act(() => {
      root.unmount();
    });
  });
});
