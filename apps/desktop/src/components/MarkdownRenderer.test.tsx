import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarkdownRenderer, { normalizeMarkdownContent } from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("normalizes compact headings before GFM table headers", () => {
    const markdown = [
      "##文档补全方案总览 | 文档 | 章节 | 操作 | 内容 |",
      "|---|---|---|---|",
      "| D1 | ora-graph-framework.md | §2.2 | 补充说明 |",
    ].join("\n");

    expect(normalizeMarkdownContent(markdown)).toBe([
      "## 文档补全方案总览",
      "",
      "| 文档 | 章节 | 操作 | 内容 |",
      "|---|---|---|---|",
      "| D1 | ora-graph-framework.md | §2.2 | 补充说明 |",
    ].join("\n"));
  });

  it("renders model-emitted compact heading plus table header as a real table", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        content={[
          "##文档补全方案总览 | 文档 | 章节 | 操作 | 内容 |",
          "|---|---|---|---|",
          "| D1 | ora-graph-framework.md | §2.2 | 补充说明 |",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<h2");
    expect(html).toContain("文档补全方案总览");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("文档");
    expect(html).not.toContain("##文档补全方案总览 | 文档");
  });

  it("does not normalize compact headings inside fenced code blocks", () => {
    const markdown = [
      "```md",
      "##标题 | A | B |",
      "|---|---|",
      "```",
    ].join("\n");

    expect(normalizeMarkdownContent(markdown)).toBe(markdown);
  });
});
