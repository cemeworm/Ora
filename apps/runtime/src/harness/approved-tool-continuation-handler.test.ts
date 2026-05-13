import { describe, it, expect } from "vitest";
import type { ActionRecord } from "@cemeworm/shared";
import { fileContinuationHandler } from "./file-continuation-handler.js";
import { genericContinuationHandler } from "./generic-continuation-handler.js";
import {
  continuationHandlerRegistry,
  filterContinuableActions,
} from "./approved-tool-continuation-handler.js";
import { registerFileContinuationHandler } from "./file-continuation-handler.js";
import { registerGenericContinuationHandlers } from "./generic-continuation-handler.js";

function makeAction(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    id: `action-${Math.random().toString(36).slice(2, 8)}`,
    runId: "run-1",
    type: "file.write",
    riskLevel: "high",
    status: "approval_required",
    input: { path: "test.txt", content: "hello" },
    artifactIds: [],
    ...overrides,
  };
}

describe("ApprovedToolContinuationHandler", () => {
  describe("fileContinuationHandler", () => {
    it("canReplay returns true for file.write", () => {
      const action = makeAction({ type: "file.write" });
      expect(fileContinuationHandler.canReplay(action)).toBe(true);
    });

    it("canReplay returns true for file.patch", () => {
      const action = makeAction({ type: "file.patch", input: { path: "x.ts", edits: [{ oldText: "a", newText: "b" }] } });
      expect(fileContinuationHandler.canReplay(action)).toBe(true);
    });

    it("canReplay returns true for file.apply_patch", () => {
      const action = makeAction({ type: "file.apply_patch", input: { patch: "--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n" } });
      expect(fileContinuationHandler.canReplay(action)).toBe(true);
    });

    it("canReplay returns false for file.read", () => {
      const action = makeAction({ type: "file.read" });
      expect(fileContinuationHandler.canReplay(action)).toBe(false);
    });

    it("canReplay returns false for unknown tools", () => {
      const action = makeAction({ type: "unknown.tool" });
      expect(fileContinuationHandler.canReplay(action)).toBe(false);
    });

    it("shouldContinueKernelAfterTool returns true", () => {
      expect(fileContinuationHandler.shouldContinueKernelAfterTool({ output: {} })).toBe(true);
    });
  });

  describe("genericContinuationHandler", () => {
    it("canReplay returns true for shell.execute", () => {
      const action = makeAction({ type: "shell.execute", input: { command: "echo hello" } });
      expect(genericContinuationHandler.canReplay(action)).toBe(true);
    });

    it("canReplay returns true for skills.create", () => {
      const action = makeAction({ type: "skills.create" });
      expect(genericContinuationHandler.canReplay(action)).toBe(true);
    });

    it("canReplay returns true for mcp.call", () => {
      const action = makeAction({ type: "mcp.call" });
      expect(genericContinuationHandler.canReplay(action)).toBe(true);
    });

    it("canReplay returns true for package.promote", () => {
      const action = makeAction({ type: "package.promote" });
      expect(genericContinuationHandler.canReplay(action)).toBe(true);
    });

    it("canReplay returns true for package.switch", () => {
      const action = makeAction({ type: "package.switch" });
      expect(genericContinuationHandler.canReplay(action)).toBe(true);
    });

    it("canReplay returns true for package.rollback", () => {
      const action = makeAction({ type: "package.rollback" });
      expect(genericContinuationHandler.canReplay(action)).toBe(true);
    });

    it("canReplay returns false for unknown tools", () => {
      const action = makeAction({ type: "unknown.tool" });
      expect(genericContinuationHandler.canReplay(action)).toBe(false);
    });

    it("shouldContinueKernelAfterTool returns true", () => {
      expect(genericContinuationHandler.shouldContinueKernelAfterTool({ output: {} })).toBe(true);
    });
  });

  describe("ContinuationHandlerRegistry", () => {
    it("registers and retrieves handlers", () => {
      registerFileContinuationHandler();
      const handler = continuationHandlerRegistry.get("file.write");
      expect(handler).toBeDefined();
      expect(handler!.canReplay(makeAction({ type: "file.write" }))).toBe(true);
    });

    it("supportedToolIds includes registered tools", () => {
      registerFileContinuationHandler();
      registerGenericContinuationHandlers();
      const ids = continuationHandlerRegistry.supportedToolIds;
      expect(ids).toContain("file.write");
      expect(ids).toContain("file.patch");
      expect(ids).toContain("file.apply_patch");
      expect(ids).toContain("shell.execute");
      expect(ids).toContain("package.switch");
    });

    it("filterContinuableActions filters by handler availability", () => {
      registerFileContinuationHandler();
      const actions = [
        makeAction({ id: "a1", type: "file.write" }),
        makeAction({ id: "a2", type: "file.read" }),
        makeAction({ id: "a3", type: "shell.execute" }),
      ];
      registerGenericContinuationHandlers();
      const result = filterContinuableActions(actions, ["a1", "a2", "a3"]);
      expect(result.map((a) => a.id).sort()).toEqual(["a1", "a3"]);
    });

    it("filterContinuableActions excludes non-approved actions", () => {
      registerFileContinuationHandler();
      const actions = [
        makeAction({ id: "a1", type: "file.write" }),
        makeAction({ id: "a2", type: "file.patch", input: { path: "x.ts", edits: [{ oldText: "a", newText: "b" }] } }),
      ];
      const result = filterContinuableActions(actions, ["a1"]);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("a1");
    });
  });
});
