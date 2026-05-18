import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessages, messageBottomPaddingPx } from "./ChatMessages";
import type { OraSessionBranchGroup, OraStateSnapshot } from "../lib/runtimeClient";

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

  it("renders user messages without an avatar icon", () => {
    const html = renderToStaticMarkup(
      <ChatMessages
        chatMessages={[{
          id: "user-1",
          role: "user",
          content: "你好",
          timestamp: "18:30",
        }]}
      />,
    );

    expect(html).toContain("你好");
    expect(html).not.toContain("lucide-user");
  });

  it("renders user messages with a compact right-anchored bubble", () => {
    const html = renderToStaticMarkup(
      <ChatMessages
        chatMessages={[{
          id: "user-1",
          role: "user",
          content: "我叫QC，记住",
          timestamp: "18:30",
        }]}
      />,
    );

    expect(html).toContain("flex items-center rounded-2xl rounded-br-md bg-card px-3.5 py-2.5");
    expect(html).toContain("whitespace-pre-wrap break-words leading-5");
    expect(html).not.toContain("<p class=\"my-2");
    expect(html).toContain("h-6 w-6");
  });

  it("renders replace-latest branch candidates as a side-by-side assistant turn", () => {
    const branchGroup = {
      branchGroupId: "session-1:branch-1",
      sessionId: "session-1",
      target: "replace_latest",
      replaceRunId: "run-base",
      prompt: "Try two answers",
      status: "ready",
      candidates: [
        {
          runId: "run-left",
          status: "succeeded",
          label: "候选 1",
          modelRef: "left-model",
          prompt: "Try two answers",
          updatedAt: 1,
        },
        {
          runId: "run-right",
          status: "succeeded",
          label: "候选 2",
          modelRef: "right-model",
          prompt: "Try two answers",
          updatedAt: 2,
        },
      ],
      candidateRunIds: ["run-left", "run-right"],
      baseTurnIndex: 0,
      createdAt: 1,
      updatedAt: 2,
    } as unknown as OraSessionBranchGroup;
    const snapshots = {
      "run-left": {
        runId: "run-left",
        status: "succeeded",
        output: { text: "左侧回答" },
        config: { metadata: {}, modelRef: "left-model" },
        events: [],
      } as unknown as OraStateSnapshot,
      "run-right": {
        runId: "run-right",
        status: "succeeded",
        output: { text: "右侧回答" },
        config: { metadata: {}, modelRef: "right-model" },
        events: [],
      } as unknown as OraStateSnapshot,
    };

    const html = renderToStaticMarkup(
      <ChatMessages
        chatMessages={[{
          id: "assistant-base",
          role: "assistant",
          content: "原回答不应显示",
          timestamp: "18:31",
          metadata: { runId: "run-base", turnIndex: 1 },
        }]}
        branchGroups={[branchGroup]}
        turnSnapshots={snapshots}
        language="zh"
      />,
    );

    expect(html).toContain("左侧回答");
    expect(html).toContain("右侧回答");
    expect(html).toContain("我更喜欢这个");
    expect(html).not.toContain("原回答不应显示");
  });
});
