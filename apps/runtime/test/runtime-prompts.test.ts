import { describe, expect, it } from "vitest";
import { attachedLocalFilesSystemPrompt, attachedProjectFilesSystemPrompt, projectInstructionsSystemPrompt } from "../src/harness/runtime-prompts.js";

describe("runtime prompts", () => {
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

describe("project instructions prompt", () => {
  it("formats AGENTS.md content with project_instructions wrapper", () => {
    const result = projectInstructionsSystemPrompt("Use tabs for indentation.");
    expect(result).toContain("<project_instructions>");
    expect(result).toContain("Use tabs for indentation.");
    expect(result).toContain("</project_instructions>");
    expect(result).toContain("AGENTS.md");
  });

  it("truncates long content and appends truncation notice", () => {
    const longContent = "x".repeat(9000);
    const result = projectInstructionsSystemPrompt(longContent);
    expect(result.length).toBeLessThan(longContent.length);
    expect(result).toContain("truncated");
  });

  it("returns empty string for whitespace-only content", () => {
    expect(projectInstructionsSystemPrompt("  \n  ")).toBe("");
  });
});
