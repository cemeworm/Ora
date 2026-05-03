import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClarificationPanel } from "./ClarificationPanel";
import type { OraStateSnapshot } from "../lib/runtimeClient";

const pendingClarifications = [
  {
    id: "clarification:env",
    nodeId: "root",
    nodeLabel: "Ora",
    key: "target_environment",
    question: "目标环境是什么？",
    options: [
      { id: "staging", label: "预发", value: "staging" },
      { id: "production", label: "生产", value: "production" },
    ],
    requestedAt: 1,
  },
  {
    id: "clarification:scope",
    nodeId: "root",
    nodeLabel: "Ora",
    key: "scope",
    question: "计划范围是什么？",
    options: [],
    requestedAt: 2,
  },
] satisfies OraStateSnapshot["pendingClarifications"];

describe("ClarificationPanel", () => {
  it("renders a batch clarification form with options and free-text questions", () => {
    const html = renderToStaticMarkup(
      <ClarificationPanel
        pendingClarifications={pendingClarifications}
        onSubmitAll={() => undefined}
      />,
    );

    expect(html).toContain("需要补充 2 个信息后继续计划");
    expect(html).toContain("目标环境是什么？");
    expect(html).toContain("预发");
    expect(html).toContain("或输入自己的回答");
    expect(html).toContain("计划范围是什么？");
    expect(html).toContain("输入补充信息");
    expect(html).toContain("继续计划");
  });
});
