// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PlanDecisionPanel,
  nextPlanDecisionOption,
  planDecisionOptionLabel,
} from "./PlanDecisionPanel";

const cleanupCallbacks: Array<() => void> = [];

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

afterEach(() => {
  while (cleanupCallbacks.length > 0) {
    cleanupCallbacks.pop()?.();
  }
  document.body.innerHTML = "";
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

  return { container, unmount: cleanup };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("plan decision panel keyboard selection", () => {
  it("moves the active option with arrow keys", () => {
    expect(nextPlanDecisionOption("confirm", "ArrowDown")).toBe("decline");
    expect(nextPlanDecisionOption("decline", "ArrowDown")).toBe("confirm");
    expect(nextPlanDecisionOption("confirm", "ArrowUp")).toBe("decline");
    expect(nextPlanDecisionOption("decline", "ArrowUp")).toBe("confirm");
  });
});

describe("plan decision panel pending labels", () => {
  it("shows the clicked action as processing", () => {
    expect(planDecisionOptionLabel("confirm", "confirm")).toBe("正在开始实施...");
    expect(planDecisionOptionLabel("decline", "decline")).toBe("正在提交调整...");
    expect(planDecisionOptionLabel("confirm", "decline")).toBe("是，按该计划实施");
  });
});

describe("plan decision panel submit recovery", () => {
  it("re-enables confirm when the submit handler returns false", async () => {
    const onConfirm = vi.fn(async () => false);
    const { container } = renderElement(
      createElement(PlanDecisionPanel, {
        onConfirm,
        onDecline: () => {},
      }),
    );

    const confirmButton = container.querySelector("button") as HTMLButtonElement | null;
    expect(confirmButton).toBeTruthy();

    act(() => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmButton?.disabled).toBe(true);
    expect(confirmButton?.textContent).toContain("正在开始实施...");

    await flushMicrotasks();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirmButton?.disabled).toBe(false);
    expect(confirmButton?.textContent).toContain("是，按该计划实施");
  });
});
