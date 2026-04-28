import { describe, expect, it } from "vitest";
import { buildDesktopRunContext } from "./useRunActions";

describe("desktop run actions", () => {
  it("includes attached project files in run context", () => {
    expect(buildDesktopRunContext([
      {
        projectId: "project-a",
        path: "src/App.tsx",
        name: "App.tsx",
        mimeType: "text/typescript",
        sizeBytes: 128,
      },
    ])).toEqual({
      source: "desktop-workbench",
      attachedProjectFiles: [
        {
          projectId: "project-a",
          path: "src/App.tsx",
          name: "App.tsx",
          mimeType: "text/typescript",
          sizeBytes: 128,
        },
      ],
    });
  });

  it("omits attached project files when none are pending", () => {
    expect(buildDesktopRunContext()).toEqual({ source: "desktop-workbench" });
  });

  it("includes attached local files in run context", () => {
    expect(buildDesktopRunContext([], [
      {
        path: "/tmp/notes.md",
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 128,
        content: "# Notes",
        truncated: true,
      },
    ])).toEqual({
      source: "desktop-workbench",
      attachedLocalFiles: [
        {
          path: "/tmp/notes.md",
          name: "notes.md",
          mimeType: "text/markdown",
          sizeBytes: 128,
          content: "# Notes",
          truncated: true,
        },
      ],
    });
  });
});
