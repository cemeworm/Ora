import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessages, messageBottomPaddingPx } from "./ChatMessages";

describe("ChatMessages bottom inset", () => {
  it("uses dynamic bottom padding when measured overlay height is larger than fallback", () => {
    expect(messageBottomPaddingPx({ hasTray: true, bottomInsetPx: 360 })).toBe(384);
  });

  it("keeps fallback padding when no measured overlay height is available", () => {
    expect(messageBottomPaddingPx({ hasTray: false })).toBe(176);
    expect(messageBottomPaddingPx({ hasTray: true })).toBe(240);
  });

  it("renders dynamic padding on the conversation content", () => {
    const html = renderToStaticMarkup(
      <ChatMessages
        chatMessages={[]}
        hasClarificationTray
        bottomInsetPx={300}
      />,
    );

    expect(html).toContain("padding-bottom:324px");
  });

  it("keeps the message list as the only scroll container", () => {
    const html = renderToStaticMarkup(<ChatMessages chatMessages={[]} />);

    expect(html).toContain("overflow-y-auto overscroll-contain");
    expect(html).not.toContain("relative flex flex-1 flex-col overflow-y-auto");
  });
});
