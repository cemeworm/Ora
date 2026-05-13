import { describe, it, expect } from "vitest";
import { deriveSessionBranchGroupStatus } from "@cemeworm/shared";

describe("deriveSessionBranchGroupStatus", () => {
  it("returns 'running' when any candidate is queued or running", () => {
    const result = deriveSessionBranchGroupStatus({
      status: "running",
      adoptedRunId: undefined,
      candidates: [
        { runId: "run-001", status: "succeeded", label: "A", prompt: "p", updatedAt: 1, adopted: false },
        { runId: "run-002", status: "running", label: "B", prompt: "p", updatedAt: 1, adopted: false },
      ],
    });
    expect(result).toBe("running");
  });

  it("returns 'ready' when all candidates are terminal (succeeded/failed/cancelled)", () => {
    const result = deriveSessionBranchGroupStatus({
      status: "running",
      adoptedRunId: undefined,
      candidates: [
        { runId: "run-001", status: "succeeded", label: "A", prompt: "p", updatedAt: 2, adopted: false },
        { runId: "run-002", status: "succeeded", label: "B", prompt: "p", updatedAt: 3, adopted: false },
      ],
    });
    expect(result).toBe("ready");
  });

  it("returns 'ready' with mixed terminal statuses (succeeded + failed)", () => {
    const result = deriveSessionBranchGroupStatus({
      status: "running",
      adoptedRunId: undefined,
      candidates: [
        { runId: "run-001", status: "succeeded", label: "A", prompt: "p", updatedAt: 2, adopted: false },
        { runId: "run-002", status: "failed", label: "B", prompt: "p", updatedAt: 3, adopted: false },
        { runId: "run-003", status: "cancelled", label: "C", prompt: "p", updatedAt: 4, adopted: false },
      ],
    });
    expect(result).toBe("ready");
  });

  it("returns 'adopted' when adoptedRunId is set", () => {
    const result = deriveSessionBranchGroupStatus({
      status: "running",
      adoptedRunId: "run-001",
      candidates: [
        { runId: "run-001", status: "succeeded", label: "A", prompt: "p", updatedAt: 2, adopted: false },
        { runId: "run-002", status: "running", label: "B", prompt: "p", updatedAt: 1, adopted: false },
      ],
    });
    expect(result).toBe("adopted");
  });

  it("returns 'adopted' when any candidate has adopted=true", () => {
    const result = deriveSessionBranchGroupStatus({
      status: "running",
      adoptedRunId: undefined,
      candidates: [
        { runId: "run-001", status: "succeeded", label: "A", prompt: "p", updatedAt: 2, adopted: true },
        { runId: "run-002", status: "running", label: "B", prompt: "p", updatedAt: 1, adopted: false },
      ],
    });
    expect(result).toBe("adopted");
  });

  it("returns 'dismissed' when status is dismissed", () => {
    const result = deriveSessionBranchGroupStatus({
      status: "dismissed",
      adoptedRunId: undefined,
      candidates: [
        { runId: "run-001", status: "succeeded", label: "A", prompt: "p", updatedAt: 2, adopted: false },
        { runId: "run-002", status: "succeeded", label: "B", prompt: "p", updatedAt: 3, adopted: false },
      ],
    });
    expect(result).toBe("dismissed");
  });
});
