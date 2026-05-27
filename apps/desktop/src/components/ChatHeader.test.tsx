// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatHeader } from "./ChatHeader";
import type { RightWorkspaceBasePage, RightWorkspacePage, RightWorkspaceSessionState } from "../lib/state";
import type { SessionRun } from "../types";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

function session(): SessionRun {
  return {
    id: "session-1",
    title: "Main Session",
    project: "Ora",
    projectId: "project-1",
    status: "running",
    pattern: "orchestrator_subagent",
    modeId: "debate",
    updatedAt: "2026-05-25 23:30",
    health: 100,
    latestRunId: "run-1",
    turnCount: 3,
  };
}

function page(overrides: Partial<RightWorkspaceBasePage> = {}): RightWorkspaceBasePage {
  return {
    id: overrides.id ?? "trails:1",
    kind: overrides.kind ?? "trails",
    title: overrides.title ?? "Trails",
    sessionId: overrides.sessionId ?? "session-1",
    targetRunId: overrides.targetRunId ?? "run-1",
    projectId: overrides.projectId,
    artifactId: overrides.artifactId,
  };
}

function workspace(overrides: Partial<RightWorkspaceSessionState> = {}): RightWorkspaceSessionState {
  return {
    open: overrides.open ?? true,
    pages: overrides.pages ?? [page()],
    selectedPageId: overrides.selectedPageId ?? overrides.pages?.[0]?.id ?? "trails:1",
    width: overrides.width ?? 460,
  };
}

describe("ChatHeader", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("toggles the right workspace from the icon-only entry", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSetRightWorkspaceOpen = vi.fn();

    act(() => {
      root.render(
        createElement(ChatHeader, {
          busyCommand: "Running",
          selectedSession: session(),
          selectedWorkspace: workspace({ open: false, pages: [] }),
          onSetRightWorkspaceOpen,
          language: "en",
        }),
      );
    });

    const sidebarButton = container.querySelector('button[aria-label="Open right workspace"]');
    expect(sidebarButton).toBeTruthy();

    act(() => {
      sidebarButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSetRightWorkspaceOpen).toHaveBeenCalledWith(true);

    act(() => {
      root.unmount();
    });
  });

  it("closes the right workspace when the icon is pressed while open", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSetRightWorkspaceOpen = vi.fn();

    act(() => {
      root.render(
        createElement(ChatHeader, {
          busyCommand: undefined,
          selectedSession: session(),
          selectedWorkspace: workspace({
            pages: [
              page({ id: "trails:1", title: "Trails" }),
              page({ id: "docs:1", kind: "documents", title: "Documents", targetRunId: undefined, projectId: "project-1" }),
            ],
            selectedPageId: "trails:1",
          }),
          onSetRightWorkspaceOpen,
          language: "en",
        }),
      );
    });

    const sidebarButton = container.querySelector('button[aria-label="Open right workspace"]');
    expect(sidebarButton).toBeTruthy();

    act(() => {
      sidebarButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSetRightWorkspaceOpen).toHaveBeenCalledWith(false);

    act(() => {
      root.unmount();
    });
  });
});
