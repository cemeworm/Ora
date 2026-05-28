import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SINGLE_AGENT_MODE_ID } from "@cemeworm/shared";
import { LocalRunStore } from "./run-store.js";

const runtimeDirs: string[] = [];

function sqliteRuntimeDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-run-store-session-visibility-"));
  runtimeDirs.push(dir);
  return path.join(dir, "runtime.db");
}

function localSmokeRunParams(sessionId: string, prompt = "hello") {
  return {
    sessionId,
    input: { prompt },
    config: {
      pattern: "single_agent",
      modeId: SINGLE_AGENT_MODE_ID,
      modeSelection: "manual",
      providerId: "local-smoke",
      providerConfig: {
        id: "local-smoke",
        type: "local_smoke",
        label: "Local Smoke",
        modelId: "local/smoke-model",
        enabled: true,
        capabilities: ["chat"],
        headers: {},
      },
      modelRef: "local/smoke-model",
      metadata: {},
      toolIds: [],
      skillIds: [],
    },
  };
}

afterEach(() => {
  for (const dir of runtimeDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("run store cross-process session visibility", () => {
  it("starts a run for a session created by another store instance", async () => {
    const dataDir = sqliteRuntimeDbPath();
    const longLivedStore = new LocalRunStore({ dataDir, autoStartChannels: false });
    const creatorStore = new LocalRunStore({ dataDir, autoStartChannels: false });
    const session = creatorStore.createSession({});

    const handle = await longLivedStore.startStreamingRun(localSmokeRunParams(session.sessionId));

    expect(handle.sessionId).toBe(session.sessionId);
    expect(longLivedStore.getSession({ sessionId: session.sessionId }).session.sessionId).toBe(session.sessionId);
  });

  it("does not reuse a session id created by another store instance", () => {
    const dataDir = sqliteRuntimeDbPath();
    const longLivedStore = new LocalRunStore({ dataDir, autoStartChannels: false });
    const creatorStore = new LocalRunStore({ dataDir, autoStartChannels: false });
    const externallyCreated = creatorStore.createSession({});

    const locallyCreated = longLivedStore.createSession({});

    expect(locallyCreated.sessionId).not.toBe(externallyCreated.sessionId);
    expect(locallyCreated.sessionId).toBe("session-0002");
  });
});
