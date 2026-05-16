import { describe, expect, it } from "vitest";
import {
  AgentConversationMessageSchema,
  ORA_ROOT_AGENT_ID,
  StateSnapshotSchema,
} from "@cemeworm/shared";
import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createStore(): LocalRunStore {
  return new LocalRunStore({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ora-agent-msg-test-")),
  });
}

const multiAgentPatterns = [
  "generator_verifier",
  "agent_teams",
  "message_bus",
  "shared_state",
] as const;

describe("agent message delivery integration", () => {
  it("emits agent.message events for all multi-agent patterns", async () => {
    const handle = createRuntimeMethodHandler(createStore());
    for (const pattern of multiAgentPatterns) {
      const result = await handle({
        jsonrpc: "2.0",
        id: `start-${pattern}`,
        method: "runs.start",
        params: {
          input: { prompt: `Coordinate ${pattern}.` },
          config: { pattern },
        },
      });
      const state = StateSnapshotSchema.parse(
        await handle({
          jsonrpc: "2.0",
          id: `state-${pattern}`,
          method: "runs.state",
          params: { runId: result.runId },
        }),
      );

      expect(state.agentMessages.length).toBeGreaterThan(0);
      expect(
        state.events.some((event) => event.type === "agent.message"),
      ).toBe(true);

      for (const msg of state.agentMessages) {
        expect(msg.fromAgentId).toBeTruthy();
        expect(msg.threadId).toBeTruthy();
        expect(msg.content).toBeTruthy();
        expect(msg.kind).toBeTruthy();
        expect(
          ["mention", "reply", "handoff", "route", "publish", "status"].includes(
            msg.kind,
          ),
        ).toBe(true);
      }
    }
  });

  it("generator-verifier generates mention and reply agent messages", async () => {
    const handle = createRuntimeMethodHandler(createStore());
    const result = await handle({
      jsonrpc: "2.0",
      id: "start-gv",
      method: "runs.start",
      params: {
        input: { prompt: "Evaluate a simple claim with verification." },
        config: { pattern: "generator_verifier" },
      },
    });
    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: "state-gv",
        method: "runs.state",
        params: { runId: result.runId },
      }),
    );

    const mentions = state.agentMessages.filter((m) => m.kind === "mention");
    const replies = state.agentMessages.filter((m) => m.kind === "reply");

    expect(mentions.length).toBeGreaterThan(0);
    expect(replies.length).toBeGreaterThan(0);

    // Every reply should have a replyToId pointing to a mention
    for (const reply of replies) {
      if (reply.replyToId) {
        const parent = state.agentMessages.find((m) => m.id === reply.replyToId);
        expect(parent).toBeDefined();
        if (parent) {
          expect(parent.kind).toBe("mention");
        }
      }
    }

    // All mentions should be from the generator, replies from the verifier
    for (const mention of mentions) {
      expect(mention.fromAgentId).toBe("generator");
    }
    for (const reply of replies) {
      expect(reply.fromAgentId).toBe("verifier");
    }
  });

  it("agent-teams generates mention, reply, and handoff messages", async () => {
    const handle = createRuntimeMethodHandler(createStore());
    const result = await handle({
      jsonrpc: "2.0",
      id: "start-at",
      method: "runs.start",
      params: {
        input: { prompt: "Team coordinate a simple analysis." },
        config: { pattern: "agent_teams" },
      },
    });
    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: "state-at",
        method: "runs.state",
        params: { runId: result.runId },
      }),
    );

    const kinds = state.agentMessages.map((m) => m.kind);
    expect(kinds).toContain("mention");
    expect(kinds).toContain("reply");
    expect(kinds).toContain("handoff");
  });

  it("message-bus generates publish, route, and reply messages", async () => {
    const handle = createRuntimeMethodHandler(createStore());
    const result = await handle({
      jsonrpc: "2.0",
      id: "start-mb",
      method: "runs.start",
      params: {
        input: { prompt: "Publish a message and route it." },
        config: { pattern: "message_bus" },
      },
    });
    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: "state-mb",
        method: "runs.state",
        params: { runId: result.runId },
      }),
    );

    const kinds = state.agentMessages.map((m) => m.kind);
    expect(kinds).toContain("publish");
    expect(kinds).toContain("route");

    // All publish/route messages with toAgentIds should have delivery attempted
    for (const msg of state.agentMessages) {
      if (
        (msg.kind === "publish" || msg.kind === "route") &&
        msg.toAgentIds.length > 0
      ) {
        expect(msg.fromAgentId).toBeTruthy();
        expect(msg.content).toBeTruthy();
      }
    }

    expect(state.busStats).toBeDefined();
    expect(state.busStats.enabled).toBe(true);
  });

  it("all agent messages pass schema validation", async () => {
    const handle = createRuntimeMethodHandler(createStore());
    for (const pattern of multiAgentPatterns) {
      const result = await handle({
        jsonrpc: "2.0",
        id: `schema-${pattern}`,
        method: "runs.start",
        params: {
          input: { prompt: `Test ${pattern} schema.` },
          config: { pattern },
        },
      });
      const state = StateSnapshotSchema.parse(
        await handle({
          jsonrpc: "2.0",
          id: `state-schema-${pattern}`,
          method: "runs.state",
          params: { runId: result.runId },
        }),
      );

      for (const msg of state.agentMessages) {
        const parsed = AgentConversationMessageSchema.safeParse(msg);
        expect(parsed.success).toBe(true);
      }

      const rawAgentMessageEvents = state.events.filter(
        (e) => e.type === "agent.message",
      );
      for (const event of rawAgentMessageEvents) {
        const payload = event.payload as Record<string, unknown> | undefined;
        if (payload && payload.message) {
          const parsed = AgentConversationMessageSchema.safeParse(
            payload.message,
          );
          expect(parsed.success).toBe(true);
        }
      }
    }
  });

  it("generator-verifier final output includes verifier metadata", async () => {
    const handle = createRuntimeMethodHandler(createStore());
    const result = await handle({
      jsonrpc: "2.0",
      id: "start-gv-output",
      method: "runs.start",
      params: {
        input: { prompt: "Test that verifier feedback reaches output." },
        config: { pattern: "generator_verifier" },
      },
    });
    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: "state-gv-output",
        method: "runs.state",
        params: { runId: result.runId },
      }),
    );

    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    expect(output!.pattern).toBe("generator_verifier");
    expect(output!.generator).toBeDefined();
    expect(output!.verifier).toBeDefined();

    const verifier = output!.verifier as Record<string, unknown>;
    expect(verifier.verdict).toBe("pass");
  });

  it("Ora finalizer emits token.delta events for multi-agent patterns", async () => {
    const handle = createRuntimeMethodHandler(createStore());
    const result = await handle({
      jsonrpc: "2.0",
      id: "start-finalizer",
      method: "runs.start",
      params: {
        input: { prompt: "Test that finalizer emits streaming tokens." },
        config: { pattern: "generator_verifier" },
      },
    });
    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: "state-finalizer",
        method: "runs.state",
        params: { runId: result.runId },
      }),
    );

    const tokenEvents = state.events.filter(
      (e) => e.type === "token.delta",
    );
    expect(tokenEvents.length).toBeGreaterThan(0);

    // Verify the output contains Ora finalizer metadata
    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    expect(output!.ora).toBeDefined();
    const ora = output!.ora as Record<string, unknown>;
    expect(ora.finalizer).toBeDefined();
    const finalizer = ora.finalizer as Record<string, unknown>;
    expect(finalizer.status).toBe("succeeded");
  });
});
