// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkbenchState } from "../lib/state";
import type {
  OraProjectInsight,
  OraProjectSignal,
  RuntimeClient,
} from "../lib/runtimeClient";
import { ProjectSignalsView } from "./ProjectSignalsView";

const mocks = vi.hoisted(() => ({
  workbench: null as any,
  dispatch: vi.fn(),
}));

vi.mock("../lib/state", async () => {
  const actual = await vi.importActual("../lib/state");
  return {
    ...actual,
    useWorkbench: () => ({
      state: mocks.workbench,
      dispatch: mocks.dispatch,
    }),
  };
});

const cleanupCallbacks: Array<() => void> = [];

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

beforeEach(() => {
  mocks.workbench = {
    ...initialWorkbenchState,
    language: "en",
    projects: [{ projectId: "project-1", label: "Ora", status: "active", updatedAt: 1 }],
  };
  mocks.dispatch.mockReset();
});

afterEach(() => {
  while (cleanupCallbacks.length > 0) {
    cleanupCallbacks.pop()?.();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function renderElement(element: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  const cleanup = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  cleanupCallbacks.push(cleanup);

  return { container };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function runtimeClientMock(overrides: Partial<RuntimeClient> = {}): RuntimeClient {
  return {
    listProjectSignals: vi.fn(async () => [projectSignal()]),
    listProjectInsights: vi.fn(async () => [projectInsight()]),
    listFeedbackLoopRules: vi.fn(async () => []),
    listSelfIterationCandidates: vi.fn(async () => []),
    getSelfIterationPolicy: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as RuntimeClient;
}

function projectSignal(): OraProjectSignal {
  return {
    id: "signal-1",
    projectId: "project-1",
    source: "evaluation_feedback",
    sourceRef: "feedback-1",
    title: "Feedback needs triage",
    summary: "A recent evaluation feedback item needs review.",
    severity: "warning",
    confidence: 0.82,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    evidence: [],
    metadata: { feedbackStatus: "pending" },
  };
}

function projectInsight(): OraProjectInsight {
  return {
    id: "insight-1",
    projectId: "project-1",
    title: "Evaluation feedback cluster",
    summary: "Several feedback records point to the same behavior.",
    status: "open",
    signalIds: ["signal-1"],
    recommendedActions: [],
    confidence: 0.78,
    createdAt: 1_700_000_000_100,
    updatedAt: 1_700_000_000_100,
  };
}

describe("ProjectSignalsView refresh", () => {
  it("keeps primary signals visible when optional feedback-loop RPCs fail", async () => {
    const runtimeClient = runtimeClientMock({
      listFeedbackLoopRules: vi.fn(async () => {
        throw new Error("Method not found: feedbackLoop.rules.list");
      }),
    });

    const { container } = renderElement(
      createElement(ProjectSignalsView, {
        runtimeClient,
        bridgeStatus: {
          mode: "tauri",
          ok: true,
          label: "Runtime",
          detail: "Connected",
        },
      }),
    );

    await flushMicrotasks();

    expect(runtimeClient.listProjectSignals).toHaveBeenCalledWith({ projectId: undefined, limit: 200 });
    expect(runtimeClient.listProjectInsights).toHaveBeenCalledWith({ projectId: undefined, limit: 100 });
    expect(container.textContent).toContain("Feedback needs triage");
    expect(container.textContent).toContain("Evaluation feedback cluster");
    expect(container.textContent).not.toContain("Method not found");
  });
});
