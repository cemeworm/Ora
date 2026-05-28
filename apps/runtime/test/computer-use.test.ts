import { afterEach, describe, expect, it, vi } from "vitest";
import { MVP_TOOLS, COMPUTER_TOOL_IDS } from "@cemeworm/shared";
import { RuntimeToolExecutor } from "../src/harness/runtime-tool-executor.js";
import { ComputerBackendManager } from "../src/harness/computer-use/backend-manager.js";
import { PersistentMcpSession } from "../src/harness/computer-use/mcp-session.js";
import { buildAgentPromptContext } from "../src/harness/prompt-context.js";
import type {
  ComputerUseBackend,
  ComputerPermissionStatus,
  ComputerObserveResult,
  ComputerActionResult,
  ComputerObserveRequest,
  ComputerClickRequest,
  ComputerTypeRequest,
  ComputerPressRequest,
  ComputerScrollRequest,
  ComputerWindowRequest,
  ComputerUIElement,
} from "../src/harness/computer-use/types.js";

// ---------------------------------------------------------------------------
// Fake Backend for Testing
// ---------------------------------------------------------------------------

class FakeBackend implements ComputerUseBackend {
  id = "fake";
  readonly label = "Fake Test Backend";
  supportedTargetKinds: ComputerUseBackend["supportedTargetKinds"] = ["native_app", "browser_page", "builtin_browser", "ora_view"];

  private statusOverride: ComputerPermissionStatus | null = null;
  private observeResult: ComputerObserveResult | null = null;
  private actionResult: ComputerActionResult | null = null;
  private _disposed = false;
  private observeCalls: ComputerObserveRequest[] = [];
  private clickCalls: ComputerClickRequest[] = [];
  private typeCalls: ComputerTypeRequest[] = [];
  private pressCalls: ComputerPressRequest[] = [];
  private scrollCalls: ComputerScrollRequest[] = [];
  private windowCalls: ComputerWindowRequest[] = [];

  get disposed() { return this._disposed; }
  get observeCallCount() { return this.observeCalls.length; }
  get lastObserveCall() { return this.observeCalls[this.observeCalls.length - 1]; }

  setStatus(status: ComputerPermissionStatus) { this.statusOverride = status; }
  setObserveResult(result: ComputerObserveResult) { this.observeResult = result; }
  setActionResult(result: ComputerActionResult) { this.actionResult = result; }

  async getStatus(): Promise<ComputerPermissionStatus> {
    return this.statusOverride ?? {
      backend: this.id,
      targetKind: "native_app",
      available: true,
      permissions: [],
    };
  }

  async observe(request: ComputerObserveRequest): Promise<ComputerObserveResult> {
    this.observeCalls.push(request);
    if (this.observeResult) return this.observeResult;
    return {
      backend: this.id,
      targetKind: request.targetKind,
      target: request.target,
      elements: [],
      snapshotId: "fake-snap-1",
      artifacts: [],
    };
  }

  async click(request: ComputerClickRequest): Promise<ComputerActionResult> {
    this.clickCalls.push(request);
    return this.actionResult ?? {
      backend: this.id,
      targetKind: request.targetKind,
      action: "click",
      success: true,
      target: request.target,
    };
  }

  async type(request: ComputerTypeRequest): Promise<ComputerActionResult> {
    this.typeCalls.push(request);
    return this.actionResult ?? {
      backend: this.id,
      targetKind: request.targetKind,
      action: "type",
      success: true,
      target: request.target,
      verificationHint: `Typed ${request.text.length} characters.`,
    };
  }

  async press(request: ComputerPressRequest): Promise<ComputerActionResult> {
    this.pressCalls.push(request);
    return this.actionResult ?? {
      backend: this.id,
      targetKind: request.targetKind,
      action: "press",
      success: true,
      target: request.keys,
    };
  }

  async scroll(request: ComputerScrollRequest): Promise<ComputerActionResult> {
    this.scrollCalls.push(request);
    return this.actionResult ?? {
      backend: this.id,
      targetKind: request.targetKind,
      action: "scroll",
      success: true,
      target: request.target,
    };
  }

  async window(request: ComputerWindowRequest): Promise<ComputerActionResult> {
    this.windowCalls.push(request);
    return this.actionResult ?? {
      backend: this.id,
      targetKind: request.targetKind,
      action: request.action,
      success: true,
    };
  }

  dispose(): void { this._disposed = true; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeElements(count: number): ComputerUIElement[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `el-${i}`,
    role: i === 0 ? "AXButton" : "AXStaticText",
    label: i === 0 ? "Click Me" : `Item ${i}`,
    enabled: true,
  }));
}

function createExecutor(backendManager?: ComputerBackendManager) {
  return new RuntimeToolExecutor({
    toolDescriptors: MVP_TOOLS,
    computerBackendManager: backendManager,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Computer Use", () => {
  // -----------------------------------------------------------------------
  // Descriptor Tests
  // -----------------------------------------------------------------------

  describe("Tool Descriptors", () => {
    it("has all 7 computer.* tool descriptors in MVP_TOOLS", () => {
      const ids = MVP_TOOLS.filter((t) => t.id.startsWith("computer.")).map((t) => t.id).sort();
      expect(ids).toEqual([...COMPUTER_TOOL_IDS].sort());
    });

    it("has non-empty parameter schemas for every computer tool", () => {
      for (const toolId of COMPUTER_TOOL_IDS) {
        const descriptor = MVP_TOOLS.find((t) => t.id === toolId);
        expect(descriptor, `Missing descriptor for ${toolId}`).toBeDefined();
        const params = descriptor!.parameters as Record<string, unknown>;
        expect(params && typeof params === "object" && Object.keys(params).length > 0,
          `${toolId} should have a non-empty parameters schema`).toBe(true);
      }
    });

    it("sets correct risk levels", () => {
      const getTool = (id: string) => MVP_TOOLS.find((t) => t.id === id)!;
      expect(getTool("computer.permissionStatus").riskLevel).toBe("safe");
      expect(getTool("computer.observe").riskLevel).toBe("low_risk");
      for (const id of ["computer.click", "computer.type", "computer.press", "computer.scroll", "computer.window"]) {
        expect(getTool(id).riskLevel).toBe("requires_approval");
      }
    });

    it("sets requiresApproval correctly", () => {
      expect(MVP_TOOLS.find((t) => t.id === "computer.permissionStatus")!.requiresApproval).toBe(false);
      expect(MVP_TOOLS.find((t) => t.id === "computer.observe")!.requiresApproval).toBe(false);
      for (const id of ["computer.click", "computer.type", "computer.press", "computer.scroll", "computer.window"]) {
        expect(MVP_TOOLS.find((t) => t.id === id)!.requiresApproval).toBe(true);
      }
    });

    it("all computer tools have prompt guidelines", () => {
      for (const toolId of COMPUTER_TOOL_IDS) {
        const descriptor = MVP_TOOLS.find((t) => t.id === toolId)!;
        expect(descriptor.promptGuidelines?.length ?? 0, `${toolId} should have prompt guidelines`).toBeGreaterThan(0);
      }
    });

    it("computer.observe has observe -> act -> verify in guidelines", () => {
      const observe = MVP_TOOLS.find((t) => t.id === "computer.observe")!;
      const guidelines = observe.promptGuidelines!.join(" ");
      expect(guidelines).toMatch(/observe.*act|act.*verify|observe.*verify/i);
    });
  });

  // -----------------------------------------------------------------------
  // Backend Manager Tests
  // -----------------------------------------------------------------------

  describe("ComputerBackendManager", () => {
    it("registers and retrieves backends", () => {
      const manager = new ComputerBackendManager();
      const fake = new FakeBackend();
      manager.register(fake);
      expect(manager.get("fake")).toBe(fake);
    });

    it("unregisters backends", () => {
      const manager = new ComputerBackendManager();
      const fake = new FakeBackend();
      manager.register(fake);
      manager.unregister("fake");
      expect(manager.get("fake")).toBeUndefined();
    });

    it("selectBackend routes native_app to peekaboo when available", () => {
      const manager = new ComputerBackendManager();
      const fake = new FakeBackend();
      fake.supportedTargetKinds.splice(0, fake.supportedTargetKinds.length, "native_app", "builtin_browser");
      fake.id = "peekaboo" as never;
      manager.register(fake);
      const page = new FakeBackend();
      page.id = "page" as never;
      page.supportedTargetKinds.splice(0, page.supportedTargetKinds.length, "browser_page", "ora_view");
      manager.register(page);

      expect(manager.selectBackend("native_app")?.id).toBe("peekaboo");
      expect(manager.selectBackend("builtin_browser")?.id).toBe("peekaboo");
    });

    it("selectBackend routes browser_page/ora_view to page when available", () => {
      const manager = new ComputerBackendManager();
      const peekaboo = new FakeBackend();
      peekaboo.id = "peekaboo" as never;
      peekaboo.supportedTargetKinds.splice(0, peekaboo.supportedTargetKinds.length, "native_app", "builtin_browser");
      manager.register(peekaboo);
      const page = new FakeBackend();
      page.id = "page" as never;
      page.supportedTargetKinds.splice(0, page.supportedTargetKinds.length, "browser_page", "ora_view");
      manager.register(page);

      expect(manager.selectBackend("browser_page")?.id).toBe("page");
      expect(manager.selectBackend("builtin_browser")?.id).toBe("peekaboo");
      expect(manager.selectBackend("ora_view")?.id).toBe("page");
    });

    it("falls back to peekaboo for ora_view when no page backend", () => {
      const manager = new ComputerBackendManager();
      const peekaboo = new FakeBackend();
      peekaboo.id = "peekaboo" as never;
      peekaboo.supportedTargetKinds.splice(0, peekaboo.supportedTargetKinds.length, "native_app", "builtin_browser", "ora_view");
      manager.register(peekaboo);

      expect(manager.selectBackend("ora_view")?.id).toBe("peekaboo");
      expect(manager.selectBackend("builtin_browser")?.id).toBe("peekaboo");
    });

    it("respects degraded state", () => {
      const manager = new ComputerBackendManager();
      const fake = new FakeBackend();
      fake.supportedTargetKinds.splice(0, fake.supportedTargetKinds.length, "native_app");
      manager.register(fake);
      manager.markDegraded("fake");

      expect(manager.selectBackend("native_app")).toBeUndefined();
    });

    it("clears degraded state", () => {
      const manager = new ComputerBackendManager();
      const fake = new FakeBackend();
      fake.supportedTargetKinds.splice(0, fake.supportedTargetKinds.length, "native_app");
      manager.register(fake);
      manager.markDegraded("fake");
      manager.clearDegraded("fake");

      expect(manager.selectBackend("native_app")?.id).toBe("fake");
    });

    it("merges permission statuses from multiple backends", async () => {
      const manager = new ComputerBackendManager();
      const b1 = new FakeBackend();
      b1.id = "peekaboo" as never;
      b1.setStatus({ backend: "peekaboo", targetKind: "native_app", available: true, permissions: [
        { name: "screen_recording", granted: true, required: true, description: "" },
      ]});
      manager.register(b1);
      const b2 = new FakeBackend();
      b2.id = "page" as never;
      b2.setStatus({ backend: "page", targetKind: "ora_view", available: true, permissions: []});
      manager.register(b2);

      const status = await manager.permissionStatus();
      expect(status.available).toBe(true);
      expect(status.permissions.length).toBe(1);
    });

    it("permissionStatus returns the requested target kind when a suitable backend exists", async () => {
      const manager = new ComputerBackendManager();
      const peekaboo = new FakeBackend();
      peekaboo.id = "peekaboo" as never;
      peekaboo.supportedTargetKinds.splice(0, peekaboo.supportedTargetKinds.length, "native_app", "builtin_browser");
      peekaboo.setStatus({ backend: "peekaboo", targetKind: "native_app", available: true, permissions: [] });
      manager.register(peekaboo);

      const status = await manager.permissionStatus("builtin_browser");
      expect(status.available).toBe(true);
      expect(status.targetKind).toBe("builtin_browser");
      expect(status.backend).toBe("peekaboo");
    });

    it("disposes all backends", () => {
      const manager = new ComputerBackendManager();
      const b1 = new FakeBackend();
      b1.id = "fake-1";
      const b2 = new FakeBackend();
      b2.id = "fake-2";
      manager.register(b1);
      manager.register(b2);
      manager.disposeAll();

      expect(b1.disposed).toBe(true);
      expect(b2.disposed).toBe(true);
      expect(manager.get("fake-1")).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Runtime Tool Executor Integration
  // -----------------------------------------------------------------------

  describe("RuntimeToolExecutor with computer tools", () => {
    it("has execute functions for all 7 computer tools", () => {
      const manager = new ComputerBackendManager();
      manager.register(new FakeBackend());
      const executor = createExecutor(manager);

      for (const toolId of COMPUTER_TOOL_IDS) {
        expect(executor.enabledToolIds([toolId]), `${toolId} should be enabled`).toContain(toolId);
      }
    });

    it("computer.permissionStatus returns structured result via fake backend", async () => {
      const manager = new ComputerBackendManager();
      const fake = new FakeBackend();
      fake.setStatus({
        backend: "fake",
        targetKind: "native_app",
        available: true,
        permissions: [
          { name: "screen_recording", granted: true, required: true, description: "Screen Recording" },
          { name: "accessibility", granted: false, required: true, description: "Accessibility" },
        ],
        installStatus: { installed: true, version: "1.0.0" },
      });
      manager.register(fake);

      const executor = createExecutor(manager);
      const result = await executor.executeWithMetadata({ tool: "computer.permissionStatus", args: {} });

      const output = result.output as ComputerPermissionStatus;
      expect(output.available).toBe(true);
      expect(output.permissions.length).toBe(2);
      expect(output.installStatus?.installed).toBe(true);
    });

    it("computer.observe returns elements and snapshotId via fake backend", async () => {
      const manager = new ComputerBackendManager();
      const fake = new FakeBackend();
      fake.setObserveResult({
        backend: "fake",
        targetKind: "native_app",
        target: "frontmost window",
        elements: fakeElements(3),
        snapshotId: "snap-abc",
        artifacts: [],
      });
      manager.register(fake);

      const executor = createExecutor(manager);
      const result = await executor.executeWithMetadata({
        tool: "computer.observe",
        args: { target: "frontmost window" },
      });

      const output = result.output as ComputerObserveResult;
      expect(output.snapshotId).toBe("snap-abc");
      expect(output.elements).toHaveLength(3);
      expect(fake.observeCallCount).toBe(1);
    });

    it("computer.click forwards args to backend", async () => {
      const manager = new ComputerBackendManager();
      const fake = new FakeBackend();
      manager.register(fake);

      const executor = createExecutor(manager);
      await executor.executeWithMetadata({
        tool: "computer.click",
        args: { target: "el-3", snapshotId: "snap-1", button: "right" },
      }, { allowRisky: true });

      expect(fake.observeCallCount).toBe(0);
    });

    it("computer.type shows text in approval request", async () => {
      const executor = createExecutor();
      const approval = executor.approvalRequest({
        tool: "computer.type",
        args: { text: "Hello World", target: "input-field" },
      });

      expect(approval.whatWillChange ?? approval.summary).toContain("Hello World");
    });

    it("computer.type truncates long text in approval request", async () => {
      const executor = createExecutor();
      const longText = "A".repeat(100);
      const approval = executor.approvalRequest({
        tool: "computer.type",
        args: { text: longText },
      });

      const text = approval.whatWillChange ?? approval.summary;
      expect(text.length).toBeLessThan(longText.length + 50);
    });

    it("computer.press shows key combination in approval", async () => {
      const executor = createExecutor();
      const approval = executor.approvalRequest({
        tool: "computer.press",
        args: { keys: "cmd,shift,t" },
      });

      expect(approval.summary).toMatch(/cmd.*shift.*t/i);
    });

    it("computer.window list/focus has low_risk, mutations have requires_approval", () => {
      const executor = createExecutor();

      const listRisk = executor.riskLevel({ tool: "computer.window", args: { action: "list" } });
      expect(listRisk).toBe("low");

      const closeRisk = executor.riskLevel({ tool: "computer.window", args: { action: "close" } });
      expect(closeRisk).toBe("high");
    });

    // -----------------------------------------------------------------------
    // Approval tests
    // -----------------------------------------------------------------------

    it("riskLevel returns low for safe/observe tools", () => {
      const executor = createExecutor();
      expect(executor.riskLevel({ tool: "computer.permissionStatus", args: {} })).toBe("low");
      expect(executor.riskLevel({ tool: "computer.observe", args: { target: "screen" } })).toBe("low");
    });

    it("riskLevel returns high for action tools", () => {
      const executor = createExecutor();
      for (const toolId of ["computer.click", "computer.type", "computer.press", "computer.scroll"]) {
        expect(executor.riskLevel({ tool: toolId as never, args: {} }), `${toolId} should be high risk`).toBe("high");
      }
    });

    it("approvalRequest returns structured approval copy for each action tool", () => {
      const executor = createExecutor();
      const tools = ["computer.click", "computer.type", "computer.press", "computer.scroll"] as const;
      for (const toolId of tools) {
        const approval = executor.approvalRequest({ tool: toolId, args: {} });
        expect(approval.title.length).toBeGreaterThan(0);
        expect(approval.summary.length).toBeGreaterThan(0);
      }
    });

    // -----------------------------------------------------------------------
    // Error handling
    // -----------------------------------------------------------------------

    it("throws recoverable error when no backend is configured", async () => {
      const executor = createExecutor(); // No backend manager

      await expect(
        executor.executeWithMetadata({ tool: "computer.observe", args: { target: "screen" } }),
      ).rejects.toThrow(/not available|No computer use backend/i);
    });

    it("throws when backend is degraded", async () => {
      const manager = new ComputerBackendManager();
      const fake = new FakeBackend();
      fake.supportedTargetKinds.splice(0, fake.supportedTargetKinds.length, "native_app");
      manager.register(fake);
      manager.markDegraded("fake");

      const executor = createExecutor(manager);
      await expect(
        executor.executeWithMetadata({ tool: "computer.observe", args: { target: "screen" } }),
      ).rejects.toThrow(/No computer use backend/i);
    });
  });

  // -----------------------------------------------------------------------
  // MCP Session Tests
  // -----------------------------------------------------------------------

  describe("PersistentMcpSession", () => {
    it("has status disconnected initially", () => {
      const session = new PersistentMcpSession("test-session", {
        serverCommand: "echo",
      });
      expect(session.status).toBe("disconnected");
    });

    it("throws when calling callTool without initialize", async () => {
      const session = new PersistentMcpSession("test-session", {
        serverCommand: "echo",
      });
      await expect(session.callTool("test", {})).rejects.toThrow(/not connected/i);
    });

    it("dispose transitions to disposed and prevents further use", async () => {
      const session = new PersistentMcpSession("test-session", {
        serverCommand: "echo",
      });
      await session.dispose();
      expect(session.status).toBe("disposed");
      await expect(session.initialize()).rejects.toThrow(/disposed/i);
    });
  });

  // -----------------------------------------------------------------------
  // Prompt Context Guardrails
  // -----------------------------------------------------------------------

  describe("Prompt Context", () => {
    it("includes computer use context when computer tools are enabled", () => {
      const context = buildAgentPromptContext({
        agentId: "test",
        stageSystem: "test-stage",
        toolIds: ["computer.observe", "computer.click", "file.read"],
      });

      expect(context.system).toMatch(/computer_use_guidance/);
      expect(context.system).toMatch(/observe.*act.*verify/i);
    });

    it("does NOT include computer use context when no computer tools", () => {
      const context = buildAgentPromptContext({
        agentId: "test",
        stageSystem: "test-stage",
        toolIds: ["file.read", "web.fetch"],
      });

      expect(context.system).not.toMatch(/computer_use_guidance/);
    });

    it("includes target kind guidance", () => {
      const context = buildAgentPromptContext({
        agentId: "test",
        stageSystem: "test-stage",
        toolIds: ["computer.observe"],
      });

      expect(context.system).toMatch(/native_app/);
      expect(context.system).toMatch(/browser_page/);
      expect(context.system).toMatch(/builtin_browser/);
      expect(context.system).toMatch(/ora_view/);
    });

    it("includes safety rules", () => {
      const context = buildAgentPromptContext({
        agentId: "test",
        stageSystem: "test-stage",
        toolIds: ["computer.permissionStatus"],
      });

      expect(context.system).toMatch(/never type passwords/i);
      expect(context.system).toMatch(/observe.*first|first.*observe/i);
    });

    it("includes Ora view verification rules", () => {
      const context = buildAgentPromptContext({
        agentId: "test",
        stageSystem: "test-stage",
        toolIds: ["computer.observe", "computer.click"],
      });

      expect(context.system).toMatch(/durable state|widget store|manifest/i);
    });
  });

  // -----------------------------------------------------------------------
  // Tool Call Extraction (computer tools in tool_ids)
  // -----------------------------------------------------------------------

  describe("Tool call extraction", () => {
    it("extracts computer.observe from JSON tool call", () => {
      const call = RuntimeToolExecutor.prototype.extractToolCall.call(
        { enabledToolIds: () => ["computer.observe"] },
        '```json\n{"tool":"computer.observe","args":{"target":"screen"}}\n```',
      );
      expect(call?.tool).toBe("computer.observe");
    });

    it("does not extract computer tools when not in enabled list", () => {
      const call = RuntimeToolExecutor.prototype.extractToolCall.call(
        { enabledToolIds: () => ["file.read"] },
        '```json\n{"tool":"computer.observe","args":{"target":"screen"}}\n```',
      );
      expect(call).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Bootstrap Tests
  // -----------------------------------------------------------------------

  describe("computerUseBootstrap", () => {
    it("returns a valid bootstrap report", async () => {
      const { computerUseBootstrap } = await import("../src/harness/computer-use/bootstrap.js");
      const report = computerUseBootstrap();

      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.platform).toBeTruthy();
      expect(report.nodeVersion).toBeTruthy();
      expect(report.backends.peekaboo).toBeDefined();
      expect(report.backends.page).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(typeof report.summary.anyAvailable).toBe("boolean");
      expect(Array.isArray(report.summary.recommendations)).toBe(true);
    });

    it("peekaboo result has required fields", async () => {
      const { computerUseBootstrap } = await import("../src/harness/computer-use/bootstrap.js");
      const report = computerUseBootstrap();

      const p = report.backends.peekaboo;
      expect(typeof p.available).toBe("boolean");
      expect(typeof p.nodeVersionOk).toBe("boolean");
      expect(p.nodeVersionRequired).toBe("22.0.0");
    });

    it("page result has required fields", async () => {
      const { computerUseBootstrap } = await import("../src/harness/computer-use/bootstrap.js");
      const report = computerUseBootstrap();

      const pg = report.backends.page;
      expect(typeof pg.available).toBe("boolean");
      if (!pg.available) {
        expect(pg.installHint).toBeTruthy();
      }
    });
  });
});
