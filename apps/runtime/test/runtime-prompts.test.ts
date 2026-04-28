import { describe, expect, it } from "vitest";
import { attachedLocalFilesSystemPrompt, attachedProjectFilesSystemPrompt, normalizeProgressNarration } from "../src/harness/runtime-prompts.js";

describe("runtime prompts", () => {
  it("keeps complete Chinese progress narration", () => {
    expect(normalizeProgressNarration("正在读取该文件夹内容，接下来会安装 5 个技能。")).toBe(
      "正在读取该文件夹内容，接下来会安装 5 个技能。",
    );
  });

  it("drops incomplete Chinese progress narration", () => {
    expect(normalizeProgressNarration("正在读取该文件夹的内容，已列出其中包含的5个技能，接下来准备逐一")).toBeUndefined();
  });

  it("trims long progress narration to the last complete sentence boundary", () => {
    const first = "正在读取该文件夹内容，接下来会安装 5 个技能。";
    const second = "已经确认这些技能都包含可安装的说明文件。";
    const unfinishedTail = "后续还会继续检查每个技能的描述、权限、类别以及安装后的可见状态，接下来准备逐一";
    const longTail = "补充说明".repeat(40);

    expect(normalizeProgressNarration(`${first}${second}${unfinishedTail}${longTail}`)).toBe(`${first}${second}`);
  });

  it("keeps complete English progress narration", () => {
    expect(normalizeProgressNarration("Reading the skill files and preparing the install step.")).toBe(
      "Reading the skill files and preparing the install step.",
    );
    expect(normalizeProgressNarration("Reading the skill files and preparing the install step")).toBeUndefined();
  });

  it("formats attached project files for agent file tools", () => {
    expect(attachedProjectFilesSystemPrompt([
      {
        projectId: "project-a",
        path: "src/App.tsx",
        name: "App.tsx",
        mimeType: "text/typescript",
        sizeBytes: 128,
      },
    ])).toBe([
      "<attached_project_files>",
      "The user attached these project files to this message:",
      "",
      "- App.tsx (text/typescript, 128 bytes)",
      "  Path: src/App.tsx",
      "",
      "Use the `file.read` tool with the shown project-relative paths before answering questions about file contents.",
      "These files are already inside the selected Ora project workspace; do not ask the user to upload them again.",
      "</attached_project_files>",
    ].join("\n"));
  });

  it("ignores missing or malformed attached project files", () => {
    expect(attachedProjectFilesSystemPrompt(undefined)).toBeUndefined();
    expect(attachedProjectFilesSystemPrompt([{
      path: "../outside.txt",
      name: "outside.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
    }])).toBeUndefined();
  });

  it("embeds attached local file previews", () => {
    expect(attachedLocalFilesSystemPrompt([
      {
        path: "/tmp/notes.md",
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 128,
        content: "# Notes",
        truncated: true,
      },
    ])).toContain("# Notes");
  });
});
