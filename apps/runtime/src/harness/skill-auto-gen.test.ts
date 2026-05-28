import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OraToolCallEnvelope, RunConfig } from "@cemeworm/shared";

vi.mock("../providers/registry.js", () => ({
  invokeRunProvider: vi.fn(),
  invokeRunProviderStream: vi.fn(),
  configuredProviderId: vi.fn(() => "mock"),
}));

import {
  computeFingerprint,
  upsertFingerprint,
  passesAggregateGate,
  loadState,
  saveState,
  candidateSkillName,
  SkillAutoGenService,
  type AutoGenState,
  type FingerprintEntry,
  type SkillAutoGenOptions,
  type ToolCallFingerprint,
} from "./skill-auto-gen.js";
import { RuntimeSkillRegistry } from "./capability-registries.js";
import { invokeRunProvider } from "../providers/registry.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-auto-gen-"));
}

function repoRoot(): string {
  let current = process.cwd();
  while (!fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
  return current;
}

function toolCall(overrides: Partial<OraToolCallEnvelope> = {}): OraToolCallEnvelope {
  return {
    id: overrides.id ?? `tc-${Math.random().toString(36).slice(2, 8)}`,
    runId: "run-1",
    toolId: "file.read",
    args: { filePath: "/tmp/test.txt" },
    source: "provider_native",
    status: "succeeded",
    requestedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function mockRunConfig(): RunConfig {
  return {
    pattern: "orchestrator_subagent",
    modeId: "single_agent",
    modeSelection: "manual",
    profileIds: [],
    skillIds: [],
    toolIds: [],
    approvalMode: "auto",
    permissionMode: "auto_review",
    patternOptions: {},
    metadata: {},
    causalInterventionLevel: "record_only",
    deterministicSeed: "test",
  };
}

function freshRegistry(): RuntimeSkillRegistry {
  const storeDir = freshStoreDir();
  return new RuntimeSkillRegistry({
    privateRootDir: path.join(storeDir, "private"),
    publicRootDir: path.join(storeDir, "public"),
    bundledPublicRootDir: path.join(repoRoot(), "skills"),
  });
}

function freshStatePath(): string {
  return path.join(freshStoreDir(), "auto-gen-state.json");
}

// ─── Test 1: computeFingerprint — valid input → fingerprint ──────────────────

describe("computeFingerprint", () => {
  it("returns fingerprint for 3+ succeeded tool calls with distinct toolIds", () => {
    const calls = [
      toolCall({ id: "a", toolId: "file.read", args: { filePath: "/a.txt" } }),
      toolCall({ id: "b", toolId: "file.write", args: { filePath: "/b.txt", content: "hi" } }),
      toolCall({ id: "c", toolId: "web.search", args: { query: "test" } }),
    ];

    const fp = computeFingerprint(calls);
    expect(fp).not.toBeNull();
    expect(fp!.toolSequence).toEqual(["file.read", "file.write", "web.search"]);
    expect(fp!.domains.length).toBeGreaterThanOrEqual(1);
    expect(fp!.fingerprintKey).toHaveLength(12);
    expect(fp!.argShape).toHaveProperty("file.read");
  });

  // ── Test 2: computeFingerprint — too few / all failed → null ─────────────

  it("returns null when fewer than 3 tool calls", () => {
    const calls = [
      toolCall({ toolId: "file.read" }),
      toolCall({ toolId: "web.search" }),
    ];
    expect(computeFingerprint(calls)).toBeNull();
  });

  it("returns null when fewer than 3 succeeded calls", () => {
    const calls = [
      toolCall({ toolId: "file.read", status: "succeeded" }),
      toolCall({ toolId: "web.search", status: "failed" }),
      toolCall({ toolId: "code.read", status: "failed" }),
    ];
    expect(computeFingerprint(calls)).toBeNull();
  });

  it("returns null when fewer than 2 distinct toolIds", () => {
    const calls = [
      toolCall({ toolId: "file.read", args: { filePath: "/a.txt" } }),
      toolCall({ toolId: "file.read", args: { filePath: "/b.txt" } }),
      toolCall({ toolId: "file.read", args: { filePath: "/c.txt" } }),
    ];
    expect(computeFingerprint(calls)).toBeNull();
  });

  // ── Test 3: computeFingerprint — 相同序列 → 相同 fingerprintKey ─────────

  it("produces same fingerprintKey for identical tool sequences", () => {
    const calls = [
      toolCall({ toolId: "file.read", args: { filePath: "/x.txt" } }),
      toolCall({ toolId: "file.write", args: { content: "ok" } }),
      toolCall({ toolId: "git.commit", args: { message: "fix" } }),
    ];
    const fp1 = computeFingerprint(calls);
    const fp2 = computeFingerprint(calls);
    expect(fp1!.fingerprintKey).toBe(fp2!.fingerprintKey);
  });

  it("produces different fingerprintKey for different sequences", () => {
    const calls1 = [
      toolCall({ toolId: "file.read" }),
      toolCall({ toolId: "file.write" }),
      toolCall({ toolId: "git.commit" }),
    ];
    const calls2 = [
      toolCall({ toolId: "web.search" }),
      toolCall({ toolId: "browser.navigate" }),
      toolCall({ toolId: "file.read" }),
    ];
    const fp1 = computeFingerprint(calls1);
    const fp2 = computeFingerprint(calls2);
    expect(fp1!.fingerprintKey).not.toBe(fp2!.fingerprintKey);
  });

  // ── Test 8: 模式类型分类 ────────────────────────────────────────────────

  it("classifies patterns as complex_task when 5+ calls and 3+ distinct tools", () => {
    const calls = [
      toolCall({ toolId: "file.read" }),
      toolCall({ toolId: "code.search" }),
      toolCall({ toolId: "file.write" }),
      toolCall({ toolId: "web.search" }),
      toolCall({ toolId: "git.commit" }),
    ];
    const fp = computeFingerprint(calls);
    expect(fp!.patternType).toBe("complex_task");
  });

  it("classifies patterns as error_recovery when errors present and 3+ succeeded", () => {
    const calls = [
      toolCall({ toolId: "file.read", status: "succeeded" }),
      toolCall({ toolId: "file.write", status: "failed", error: "permission denied" }),
      toolCall({ toolId: "file.write", status: "succeeded", args: { content: "retry" } }),
      toolCall({ toolId: "git.status", status: "succeeded" }),
    ];
    const fp = computeFingerprint(calls);
    expect(fp!.patternType).toBe("error_recovery");
  });

  it("classifies patterns as user_correction when repeated identical tool calls", () => {
    // Need 5+ calls, 2+ distinct tools, and enough repeats to hit the threshold
    const calls = [
      toolCall({ id: "a", toolId: "file.read", args: { filePath: "/a.txt" } }),
      toolCall({ id: "b", toolId: "file.read", args: { filePath: "/a.txt" } }),
      toolCall({ id: "c", toolId: "file.read", args: { filePath: "/a.txt" } }),
      toolCall({ id: "d", toolId: "file.read", args: { filePath: "/a.txt" } }),
      toolCall({ id: "e", toolId: "web.search", args: { query: "x" } }),
    ];
    const fp = computeFingerprint(calls);
    expect(fp).not.toBeNull();
    expect(fp!.patternType).toBe("user_correction");
  });
});

// ─── Tests 4-5: 聚合门控 ─────────────────────────────────────────────────────

describe("aggregate gates", () => {
  const baseOptions: SkillAutoGenOptions = {
    minOccurrences: 3,
    minTimeSpanHours: 6,
    statePath: "",
    clock: Date.now,
  };

  it("returns null on 1st occurrence (only recording)", () => {
    const state: AutoGenState = { version: 1, fingerprints: {} };
    const fp = makeFingerprint("aa");
    const entry = upsertFingerprint(state, fp, "run-1", 1000);
    expect(entry.occurrenceCount).toBe(1);
    expect(passesAggregateGate(entry, baseOptions)).toBe(false);
  });

  it("returns null on 2nd occurrence", () => {
    const state: AutoGenState = { version: 1, fingerprints: {} };
    const fp = makeFingerprint("bb");
    upsertFingerprint(state, fp, "run-1", 1000);
    const entry = upsertFingerprint(state, fp, "run-2", 2000);
    expect(entry.occurrenceCount).toBe(2);
    expect(passesAggregateGate(entry, baseOptions)).toBe(false);
  });

  it("passes gate on 3rd occurrence with sufficient time span", () => {
    const state: AutoGenState = { version: 1, fingerprints: {} };
    const fp = makeFingerprint("cc");
    upsertFingerprint(state, fp, "run-1", 0);
    // 7 hours later
    const t2 = 7 * 60 * 60 * 1000;
    upsertFingerprint(state, fp, "run-2", t2);
    const entry = upsertFingerprint(state, fp, "run-3", t2 + 1);
    expect(entry.occurrenceCount).toBe(3);
    expect(passesAggregateGate(entry, baseOptions)).toBe(true);
  });

  it("fails gate when time span is less than 6 hours", () => {
    const state: AutoGenState = { version: 1, fingerprints: {} };
    const fp = makeFingerprint("dd");
    upsertFingerprint(state, fp, "run-1", 0);
    // only 2 hours later
    const t2 = 2 * 60 * 60 * 1000;
    upsertFingerprint(state, fp, "run-2", t2);
    const entry = upsertFingerprint(state, fp, "run-3", t2 + 1);
    expect(entry.occurrenceCount).toBe(3);
    expect(passesAggregateGate(entry, baseOptions)).toBe(false);
  });
});

// ─── Test 6: 去重 — same fingerprint already created → skip ───────────────────

describe("dedup", () => {
  it("analyzeRun returns null for already-created fingerprint", () => {
    const registry = freshRegistry();
    const statePath = freshStatePath();
    const service = new SkillAutoGenService(registry, {
      statePath,
      minOccurrences: 1,
      minTimeSpanHours: 0,
    });

    // First run creates the skill
    const calls1 = [
      toolCall({ id: "a", toolId: "file.read", args: { filePath: "/x.txt" } }),
      toolCall({ id: "b", toolId: "file.write", args: { content: "ok" } }),
      toolCall({ id: "c", toolId: "git.commit", args: { message: "fix" } }),
    ];
    const action1 = service.analyzeRun("run-1", "succeeded", calls1);
    expect(action1).not.toBeNull();

    // Second run with same pattern should skip
    const calls2 = [
      toolCall({ id: "d", toolId: "file.read", args: { filePath: "/y.txt" } }),
      toolCall({ id: "e", toolId: "file.write", args: { content: "ok2" } }),
      toolCall({ id: "f", toolId: "git.commit", args: { message: "fix2" } }),
    ];
    const action2 = service.analyzeRun("run-2", "succeeded", calls2);
    expect(action2).toBeNull();
  });
});

// ─── Test 7: name conflict → handled ──────────────────────────────────────────

describe("name conflict", () => {
  it("analyzeRun returns null when candidate name already exists in registry", () => {
    const registry = freshRegistry();
    const statePath = freshStatePath();

    // Pre-create a skill with the same candidate name
    const calls = [
      toolCall({ id: "a", toolId: "file.read", args: { filePath: "/x.txt" } }),
      toolCall({ id: "b", toolId: "file.write", args: { content: "ok" } }),
      toolCall({ id: "c", toolId: "web.search", args: { query: "x" } }),
    ];
    const fp = computeFingerprint(calls)!;
    const candidateName = candidateSkillName(fp);

    // Manually create a skill with that name
    registry.create({
      name: candidateName,
      description: "Pre-existing skill",
      content: [
        "---",
        `name: ${candidateName}`,
        "description: Pre-existing skill",
        "---",
        "",
        "Content.",
      ].join("\n"),
    });

    const service = new SkillAutoGenService(registry, {
      statePath,
      minOccurrences: 1,
      minTimeSpanHours: 0,
    });
    const action = service.analyzeRun("run-1", "succeeded", calls);
    expect(action).toBeNull();
  });
});

// ─── Test 9: executeCreation — LLM returns valid SKILL.md → created ───────

describe("executeCreation", () => {
  it("creates skill when LLM returns valid SKILL.md", async () => {
    const registry = freshRegistry();
    const fp = makeFingerprint("ee");

    const service = new SkillAutoGenService(registry, {
      statePath: freshStatePath(),
      minOccurrences: 1,
      minTimeSpanHours: 0,
    });

    const action = {
      fingerprint: fp,
      sampleRunIds: ["run-1"],
      candidateName: "auto-file-ops-complex-test1",
      autoGenTag: `auto-gen:${fp.fingerprintKey}`,
    };

    // Mock invokeRunProvider to return valid SKILL.md
    (invokeRunProvider as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      providerId: "mock",
      providerType: "local_smoke",
      modelId: "mock",
      text: [
        "---",
        "name: auto-file-ops-complex-test1",
        "description: Test auto-generated skill",
        "---",
        "",
        "# auto-file-ops-complex-test1",
        "",
        "Follow these steps:",
        "1. Read the file",
        "2. Write changes",
        "3. Commit",
      ].join("\n"),
    });

    await service.executeCreation(action, mockRunConfig());

    // Verify the skill was created
    const created = registry.get({ name: "auto-file-ops-complex-test1" });
    expect(created.name).toBe("auto-file-ops-complex-test1");
    expect(created.provenance).toBe("background_auto");
  });

  // ── Test 10: executeCreation — LLM fails → no crash ─────────────────

  it("does not crash when LLM invocation fails", async () => {
    const registry = freshRegistry();
    const fp = makeFingerprint("ff");

    const service = new SkillAutoGenService(registry, {
      statePath: freshStatePath(),
      minOccurrences: 1,
      minTimeSpanHours: 0,
    });

    const action = {
      fingerprint: fp,
      sampleRunIds: ["run-1"],
      candidateName: "auto-file-ops-complex-test2",
      autoGenTag: `auto-gen:${fp.fingerprintKey}`,
    };

    (invokeRunProvider as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Provider unavailable"));

    // Should not throw
    await expect(
      service.executeCreation(action, mockRunConfig()),
    ).resolves.toBeUndefined();

    // Skill should NOT exist
    expect(() => registry.get({ name: "auto-file-ops-complex-test2" })).toThrow();
  });

  it("keeps fingerprint retryable when async creation fails", async () => {
    const registry = freshRegistry();
    const statePath = freshStatePath();
    const service = new SkillAutoGenService(registry, {
      statePath,
      minOccurrences: 1,
      minTimeSpanHours: 0,
    });

    const calls = [
      toolCall({ id: "a", toolId: "file.read" }),
      toolCall({ id: "b", toolId: "file.write" }),
      toolCall({ id: "c", toolId: "git.status" }),
    ];
    const action = service.analyzeRun("run-1", "succeeded", calls);
    expect(action).not.toBeNull();

    const analyzedState = loadState(statePath);
    const analyzedEntry = analyzedState.fingerprints[action!.fingerprint.fingerprintKey];
    expect(analyzedEntry?.creating).toBe(true);
    expect(analyzedEntry?.created).toBe(false);

    (invokeRunProvider as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Provider unavailable"));
    await service.executeCreation(action!, mockRunConfig());

    const failedState = loadState(statePath);
    const failedEntry = failedState.fingerprints[action!.fingerprint.fingerprintKey];
    expect(failedEntry?.creating).toBe(false);
    expect(failedEntry?.created).toBe(false);
  });
});

// ─── Test 11: persistence round-trip ─────────────────────────────────────────

describe("persistence", () => {
  it("saves and loads state correctly", () => {
    const statePath = freshStatePath();
    const fp = makeFingerprint("gg");

    const state: AutoGenState = { version: 1, fingerprints: {} };
    upsertFingerprint(state, fp, "run-1", 1000);
    upsertFingerprint(state, fp, "run-2", 2000);

    saveState(statePath, state);
    const loaded = loadState(statePath);

    expect(loaded.version).toBe(1);
    expect(loaded.fingerprints[fp.fingerprintKey]).toBeDefined();
    expect(loaded.fingerprints[fp.fingerprintKey]!.occurrenceCount).toBe(2);
    expect(loaded.fingerprints[fp.fingerprintKey]!.sampleRunIds).toEqual(["run-1", "run-2"]);
  });

  // ── Test 12: corrupted file degrades to empty state ────────────────────

  it("degrades to empty state on corrupted file", () => {
    const statePath = freshStatePath();
    fs.writeFileSync(statePath, "garbage{{not valid json!!", "utf8");
    const state = loadState(statePath);
    expect(state.version).toBe(1);
    expect(state.fingerprints).toEqual({});
  });

  it("degrades on missing file", () => {
    const state = loadState("/tmp/nonexistent-auto-gen-state.json");
    expect(state.version).toBe(1);
    expect(state.fingerprints).toEqual({});
  });
});

// ─── Test 13: interrupted status → only records, no action ───────────────────

describe("interrupted status", () => {
  it("analyzeRun returns null for interrupted runs", () => {
    const registry = freshRegistry();
    const service = new SkillAutoGenService(registry, {
      statePath: freshStatePath(),
      minOccurrences: 1,
      minTimeSpanHours: 0,
    });

    const calls = [
      toolCall({ id: "a", toolId: "file.read" }),
      toolCall({ id: "b", toolId: "file.write" }),
      toolCall({ id: "c", toolId: "git.commit" }),
    ];

    const action = service.analyzeRun("run-1", "interrupted", calls);
    expect(action).toBeNull();
  });
});

// ─── Test: candidateSkillName format ─────────────────────────────────────────

describe("candidateSkillName", () => {
  it("produces expected naming pattern", () => {
    const fp: ToolCallFingerprint = {
      toolSequence: ["file.read", "file.write"],
      argShape: { "file.read": ["filePath"], "file.write": ["content"] },
      patternType: "complex_task",
      domains: ["file-ops", "git"],
      fingerprintKey: "abcdef123456",
    };
    const name = candidateSkillName(fp);
    expect(name).toMatch(/^auto-file-ops-complex-task-[a-f0-9]{6}$/);
  });
});

// ─── Helpers for tests ───────────────────────────────────────────────────────

function makeFingerprint(seed: string): ToolCallFingerprint {
  return {
    toolSequence: ["file.read", "file.write", "git.commit"],
    argShape: {
      "file.read": ["filePath"],
      "file.write": ["content", "filePath"],
      "git.commit": ["message"],
    },
    patternType: "complex_task",
    domains: ["file-ops", "git"],
    fingerprintKey: `test-key-${seed}`,
  };
}
