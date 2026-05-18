import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RunConfig } from "@cemeworm/shared";
import { LocalRunStore } from "../src/index.js";

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-turn-metadata-"));
}

function baseConfig(): RunConfig {
  return {
    pattern: "single_agent",
    modeId: "single_agent",
    modeSelection: "manual",
    profileIds: ["solo_agent"],
    skillIds: [],
    toolIds: [],
    providerId: "local-smoke",
    modelRef: "local/test-model",
    approvalMode: "high_risk_only",
    patternOptions: {},
    metadata: {},
  };
}

describe("LocalRunStore turn-local metadata preparation", () => {
  it("prepends current-turn metadata before context compaction accounting runs", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock: () => Date.parse("2026-05-09T01:23:45.000Z") });
    const session = store.createSession({});
    const prepareConversationMessagesForRun = (store as unknown as {
      prepareConversationMessagesForRun: (
        sessionId: string,
        currentPrompt: string,
        config: RunConfig,
        turnIndex: number,
        runId: string,
        currentTurnCreatedAt?: number,
        currentTurnContext?: Record<string, unknown>,
      ) => Promise<Array<{ role: string; content: string }>>;
    }).prepareConversationMessagesForRun.bind(store);

    const messages = await prepareConversationMessagesForRun(
      session.sessionId,
      "Explain the failure.",
      baseConfig(),
      1,
      "run-turn-local-metadata",
      Date.parse("2026-05-09T01:23:45.000Z"),
      {
        userTemporalContext: {
          timezone: "Asia/Shanghai",
          locale: "zh-CN",
        },
        clarifications: {
          scope: "narrow fix",
        },
      },
    );

    const currentTurn = messages.at(-1);
    expect(currentTurn).toMatchObject({ role: "user" });
    expect(currentTurn?.content).toContain("<turn_local_metadata>");
    expect(currentTurn?.content).toContain("Current local date: 2026-05-09");
    expect(currentTurn?.content).toContain("- scope: narrow fix");
    expect(currentTurn?.content).toContain("Explain the failure.");
  });
});
