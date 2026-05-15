import { describe, expect, it } from "vitest";
import {
  ApprovalInterruptError,
  ClarificationInterruptError,
  isApprovalInterruptError,
  isClarificationInterruptError,
  isAnyInterruptError,
} from "./runtime-interrupts.js";

describe("interrupt error recognition", () => {
  describe("ApprovalInterruptError", () => {
    it("recognizes own instances via instanceof", () => {
      const error = new ApprovalInterruptError("action-1");
      expect(error instanceof ApprovalInterruptError).toBe(true);
      expect(isApprovalInterruptError(error)).toBe(true);
    });

    it("recognizes cross-realm instances via Symbol marker", () => {
      // Simulate module identity mismatch: same Symbol, different constructor
      const APPROVAL_SYMBOL = Symbol.for("ora.ApprovalInterrupt");
      const crossRealm = new Error("Waiting for your approval before continuing.");
      (crossRealm as unknown as Record<symbol, unknown>)[APPROVAL_SYMBOL] = true;

      // instanceof would fail — this is the core regression scenario
      expect(crossRealm instanceof ApprovalInterruptError).toBe(false);
      // But Symbol-based recognition still works
      expect(isApprovalInterruptError(crossRealm)).toBe(true);
    });

    it("rejects regular errors", () => {
      expect(isApprovalInterruptError(new Error("something"))).toBe(false);
      expect(isApprovalInterruptError(null)).toBe(false);
      expect(isApprovalInterruptError(undefined)).toBe(false);
      expect(isApprovalInterruptError("string")).toBe(false);
    });

    it("preserves actionId", () => {
      const error = new ApprovalInterruptError("action-42");
      expect(error.actionId).toBe("action-42");
      expect(error.name).toBe("ApprovalInterruptError");
    });
  });

  describe("ClarificationInterruptError", () => {
    it("recognizes own instances via instanceof", () => {
      const error = new ClarificationInterruptError({
        id: "clarify-1",
        question: "Which file?",
        nodeId: "node-1",
        nodeLabel: "Node 1",
        key: "file",
        requestedAt: Date.now(),
        options: [],
      });
      expect(error instanceof ClarificationInterruptError).toBe(true);
      expect(isClarificationInterruptError(error)).toBe(true);
    });

    it("recognizes cross-realm instances via Symbol marker", () => {
      const CLARIFICATION_SYMBOL = Symbol.for("ora.ClarificationInterrupt");
      const crossRealm = new Error("Which file?");
      (crossRealm as unknown as Record<symbol, unknown>)[CLARIFICATION_SYMBOL] = true;

      expect(crossRealm instanceof ClarificationInterruptError).toBe(false);
      expect(isClarificationInterruptError(crossRealm)).toBe(true);
    });

    it("rejects regular errors", () => {
      expect(isClarificationInterruptError(new Error("something"))).toBe(false);
    });
  });

  describe("isAnyInterruptError", () => {
    it("recognizes ApprovalInterruptError", () => {
      expect(isAnyInterruptError(new ApprovalInterruptError("a"))).toBe(true);
    });

    it("recognizes ClarificationInterruptError", () => {
      expect(isAnyInterruptError(new ClarificationInterruptError({
        id: "c",
        question: "q?",
        nodeId: "n",
        nodeLabel: "N",
        key: "k",
        requestedAt: Date.now(),
        options: [],
      }))).toBe(true);
    });

    it("rejects regular errors", () => {
      expect(isAnyInterruptError(new Error("fail"))).toBe(false);
      expect(isAnyInterruptError(null)).toBe(false);
    });

    it("recognizes cross-realm approval interrupt", () => {
      const APPROVAL_SYMBOL = Symbol.for("ora.ApprovalInterrupt");
      const crossRealm = new Error("Waiting for your approval before continuing.");
      (crossRealm as unknown as Record<symbol, unknown>)[APPROVAL_SYMBOL] = true;
      expect(isAnyInterruptError(crossRealm)).toBe(true);
    });
  });
});
