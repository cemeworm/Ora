import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageBubble } from "./MessageBubble";

describe("MessageBubble", () => {
  it("renders inline content inside the bubble container", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        role="user"
        content=""
        inlineContent={<span data-testid="inline-skill">think</span>}
      />,
    );

    expect(html).toContain("rounded-2xl bg-muted px-3.5 py-2.5");
    expect(html).toContain('data-testid="inline-skill"');
    expect(html).toContain(">think<");
  });

  it("keeps children outside the bubble container", () => {
    const html = renderToStaticMarkup(
      <MessageBubble role="user" content="正文">
        <div data-testid="attachment-row">附件</div>
      </MessageBubble>,
    );

    expect(html).toContain(">正文<");
    expect(html).toContain('data-testid="attachment-row"');
    expect(html).toContain("</div><div data-testid=\"attachment-row\">");
  });
});
