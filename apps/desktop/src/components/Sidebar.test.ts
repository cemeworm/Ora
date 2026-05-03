import { describe, expect, it } from "vitest";
import { statusFromSession } from "./Sidebar";

describe("sidebar session status", () => {
  it("prioritizes clarification and approval over plan decisions", () => {
    expect(statusFromSession("running", true, true)).toBe("clarification_required");
    expect(statusFromSession("interrupted", false, true)).toBe("approval_required");
    expect(statusFromSession("done", false, true)).toBe("decision_needed");
  });
});
