import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalRequestCard } from "./ApprovalRequestCard";
import type { ActionRecord } from "../types";

describe("ApprovalRequestCard", () => {
  it("renders user-facing approval copy without internal action metadata", () => {
    const actions: ActionRecord[] = [{
      id: "run-1:action:solo_agent-tool-1",
      label: "skills create",
      state: "approval_required",
      consequence: "Please confirm this operation before I continue.",
      risk: "high",
      agentId: "solo_agent",
      artifactIds: [],
      approvalRequest: {
        title: "需要你确认安装技能",
        summary: "我准备把 Waza 的 think 技能安装到 Ora 的本地技能库。",
        whatWillChange: "会新增一个本地技能条目，并允许后续 agent 使用它。",
        whyNeeded: "这是完成你要求安装技能的必要步骤。",
        riskNote: "确认 GitHub 来源可信后再继续。",
        confirmLabel: "批准并继续",
      },
    }];

    const html = renderToStaticMarkup(
      <ApprovalRequestCard actions={actions} onResume={() => undefined} onCancel={() => undefined} />,
    );

    expect(html).toContain("需要你确认安装技能");
    expect(html).toContain("我准备把 Waza 的 think 技能安装到 Ora 的本地技能库。");
    expect(html).not.toContain("Review before continuing");
    expect(html).not.toContain("Review all items");
    expect(html).not.toContain("你正在批准的内容");
    expect(html).not.toContain("What you are approving");
    expect(html).not.toContain("会新增一个本地技能条目");
    expect(html).not.toContain("pending gate");
    expect(html).not.toContain("High-risk action requires");
    expect(html).not.toContain("agent:");
    expect(html).not.toContain("solo_agent");
    expect(html).not.toContain("skills create");
  });
});
