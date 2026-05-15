import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PromptSectionCache } from "../src/harness/prompt-cache.js";
import { buildAgentPromptContext } from "../src/harness/prompt-context.js";
import type { SkillDescriptor } from "@cemeworm/shared";

function tmpSnapshotPath(): string {
  return path.join(os.tmpdir(), `prompt-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

const availableSkills: SkillDescriptor[] = [
  {
    id: "deep-research",
    name: "deep-research",
    description: "Follow the source-backed deep research workflow.",
    path: "skills/deep-research/SKILL.md",
    category: "public",
    enabled: true,
    editable: true,
    allowedPatterns: [],
    tags: [],
  },
  {
    id: "code-review",
    name: "code-review",
    description: "Review code changes for correctness and style.",
    path: "skills/code-review/SKILL.md",
    category: "public",
    enabled: true,
    editable: true,
    allowedPatterns: [],
    tags: [],
  },
];

describe("PromptSectionCache", () => {
  let snapshotPath: string;

  beforeEach(() => {
    snapshotPath = tmpSnapshotPath();
  });

  afterEach(() => {
    try { fs.unlinkSync(snapshotPath); } catch { /* ok */ }
  });

  it("stores and retrieves cached sections", () => {
    const cache = new PromptSectionCache({ maxEntries: 10 });
    cache.set("operating_protocol", "static:v1", "cached content");
    expect(cache.get("operating_protocol", "static:v1")).toBe("cached content");
  });

  it("returns undefined on cache miss", () => {
    const cache = new PromptSectionCache({ maxEntries: 10 });
    expect(cache.get("operating_protocol", "static:v1")).toBeUndefined();
  });

  it("evicts LRU entry when exceeding maxEntries", () => {
    const cache = new PromptSectionCache({ maxEntries: 3 });

    cache.set("a", "1", "content-a");
    cache.set("b", "2", "content-b");
    cache.set("c", "3", "content-c");
    // Access a and b so c becomes LRU
    cache.get("a", "1");
    cache.get("b", "2");
    // Now add a 4th entry, c should be evicted
    cache.set("d", "4", "content-d");

    expect(cache.get("a", "1")).toBe("content-a");
    expect(cache.get("b", "2")).toBe("content-b");
    expect(cache.get("c", "3")).toBeUndefined();
    expect(cache.get("d", "4")).toBe("content-d");
  });

  it("updates existing entry on set", () => {
    const cache = new PromptSectionCache({ maxEntries: 10 });
    cache.set("a", "1", "content-a");
    cache.set("a", "1", "updated-content");
    expect(cache.get("a", "1")).toBe("updated-content");
    expect(cache._size()).toBe(1);
  });

  it("hashInput produces stable deterministic hashes", () => {
    const cache = new PromptSectionCache();
    const h1 = cache.hashInput({ foo: "bar", baz: 1 });
    const h2 = cache.hashInput({ baz: 1, foo: "bar" });
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
  });

  it("hashInput differentiates different inputs", () => {
    const cache = new PromptSectionCache();
    const h1 = cache.hashInput("hello");
    const h2 = cache.hashInput("world");
    expect(h1).not.toBe(h2);
  });

  it("saves and loads snapshot round-trip", () => {
    const cache1 = new PromptSectionCache({ maxEntries: 10, snapshotPath });
    cache1.set("operating_protocol", "static:v1", "cached-protocol");
    cache1.set("skills_guidance", "static:v1", "cached-guidance");
    cache1.saveSnapshot();

    expect(fs.existsSync(snapshotPath)).toBe(true);

    const cache2 = new PromptSectionCache({ maxEntries: 10, snapshotPath });
    expect(cache2.get("operating_protocol", "static:v1")).toBe("cached-protocol");
    expect(cache2.get("skills_guidance", "static:v1")).toBe("cached-guidance");
  });

  it("handles corrupted snapshot gracefully", () => {
    fs.writeFileSync(snapshotPath, "not valid json", "utf-8");
    const cache = new PromptSectionCache({ maxEntries: 10, snapshotPath });
    expect(cache._size()).toBe(0);
    // Should still work after loading corrupted data
    cache.set("a", "1", "content-a");
    expect(cache.get("a", "1")).toBe("content-a");
  });

  it("handles missing snapshot file gracefully", () => {
    const nonExistent = path.join(os.tmpdir(), `nonexistent-${Date.now()}.json`);
    const cache = new PromptSectionCache({ maxEntries: 10, snapshotPath: nonExistent });
    expect(cache._size()).toBe(0);
  });

  it("only saves when dirty", () => {
    const cache = new PromptSectionCache({ maxEntries: 10, snapshotPath });
    // First save should create file (dirty from set)
    cache.set("a", "1", "content");
    cache.saveSnapshot();
    expect(fs.existsSync(snapshotPath)).toBe(true);

    // Second save should be no-op if nothing changed
    const mtime1 = fs.statSync(snapshotPath).mtimeMs;
    cache.saveSnapshot();
    const mtime2 = fs.statSync(snapshotPath).mtimeMs;
    expect(mtime2).toBe(mtime1);
  });

  it("evicts excess entries after loading large snapshot", () => {
    const cache1 = new PromptSectionCache({ maxEntries: 100, snapshotPath });
    for (let i = 0; i < 50; i++) {
      cache1.set(`section-${i}`, `hash-${i}`, `content-${i}`);
    }
    cache1.saveSnapshot();

    const cache2 = new PromptSectionCache({ maxEntries: 5, snapshotPath });
    expect(cache2._size()).toBeLessThanOrEqual(5);
  });
});

describe("buildAgentPromptContext with cache", () => {
  it("hits cache for static operating_protocol section", () => {
    const cache = new PromptSectionCache({ maxEntries: 10 });

    const ctx1 = buildAgentPromptContext({
      agentId: "test",
      stageSystem: "You are a test agent.",
      cache,
    });
    const firstProtocol = ctx1.sections.find((s) => s.id === "operating_protocol")?.content;

    const ctx2 = buildAgentPromptContext({
      agentId: "test",
      stageSystem: "You are a test agent.",
      cache,
    });
    const secondProtocol = ctx2.sections.find((s) => s.id === "operating_protocol")?.content;

    expect(firstProtocol).toBeDefined();
    expect(secondProtocol).toBe(firstProtocol);
    // Static sections should have exactly one cache entry
    expect(cache.get("operating_protocol", "static:v1")).toBe(firstProtocol);
  });

  it("hits cache for static skills_guidance section", () => {
    const cache = new PromptSectionCache({ maxEntries: 10 });

    buildAgentPromptContext({
      agentId: "test",
      stageSystem: "You are a test agent.",
      cache,
    });

    expect(cache.get("skills_guidance", "static:v1")).toBeDefined();
  });

  it("hits cache for available_skills with same skills list", () => {
    const cache = new PromptSectionCache({ maxEntries: 10 });

    const ctx1 = buildAgentPromptContext({
      agentId: "test",
      stageSystem: "You are a test agent.",
      availableSkills,
      cache,
    });
    const hash1 = cache.hashInput(availableSkills);

    const ctx2 = buildAgentPromptContext({
      agentId: "test",
      stageSystem: "You are a test agent.",
      availableSkills,
      cache,
    });

    const skills1 = ctx1.sections.find((s) => s.id === "available_skills")?.content;
    const skills2 = ctx2.sections.find((s) => s.id === "available_skills")?.content;
    expect(skills1).toBeDefined();
    expect(skills2).toBe(skills1);
    expect(cache.get("available_skills", hash1)).toBe(skills1);
  });

  it("misses cache for available_skills with different skills list", () => {
    const cache = new PromptSectionCache({ maxEntries: 10 });

    const ctx1 = buildAgentPromptContext({
      agentId: "test",
      stageSystem: "You are a test agent.",
      availableSkills: [availableSkills[0]!],
      cache,
    });
    const ctx2 = buildAgentPromptContext({
      agentId: "test",
      stageSystem: "You are a test agent.",
      availableSkills: [availableSkills[1]!],
      cache,
    });

    const skills1 = ctx1.sections.find((s) => s.id === "available_skills")?.content;
    const skills2 = ctx2.sections.find((s) => s.id === "available_skills")?.content;
    expect(skills1).toBeDefined();
    expect(skills2).toBeDefined();
    expect(skills1).not.toBe(skills2);
  });

  it("works without cache (backward compatible)", () => {
    const ctx = buildAgentPromptContext({
      agentId: "test",
      stageSystem: "You are a test agent.",
      availableSkills,
    });
    expect(ctx.sections.some((s) => s.id === "operating_protocol")).toBe(true);
    expect(ctx.sections.some((s) => s.id === "skills_guidance")).toBe(true);
    expect(ctx.sections.some((s) => s.id === "available_skills")).toBe(true);
    expect(ctx.system).toContain("You are a test agent.");
  });

  it("does not cache dynamic sections (workspace, temporal, memory)", () => {
    const cache = new PromptSectionCache({ maxEntries: 10 });

    buildAgentPromptContext({
      agentId: "test",
      stageSystem: "You are a test agent.",
      workspaceContext: "Root: /tmp/project-1",
      temporalContext: "Date: 2025-01-01",
      memoryContext: "Memory: session-1",
      clarificationContext: "Clarification: use staging",
      cache,
    });

    // Dynamic sections should NOT be in the cache
    const entries = cache._entries();
    const dynamicSectionKeys = entries.filter(([key]) =>
      key.startsWith("workspace_context:") ||
      key.startsWith("temporal_context:") ||
      key.startsWith("memory_context:") ||
      key.startsWith("clarification_context:")
    );
    expect(dynamicSectionKeys).toHaveLength(0);
  });

  it("caches custom_persona based on hash of input", () => {
    const cache = new PromptSectionCache({ maxEntries: 10 });

    const ctx1 = buildAgentPromptContext({
      agentId: "test",
      stageSystem: "You are a test agent.",
      customPersona: "Persona-A",
      cache,
    });
    const ctx2 = buildAgentPromptContext({
      agentId: "test",
      stageSystem: "You are a test agent.",
      customPersona: "Persona-A",
      cache,
    });

    const p1 = ctx1.sections.find((s) => s.id === "custom_persona")?.content;
    const p2 = ctx2.sections.find((s) => s.id === "custom_persona")?.content;
    expect(p1).toBeDefined();
    expect(p2).toBe(p1);
  });

  it("caches agent_profile based on hash of profile inputs", () => {
    const cache = new PromptSectionCache({ maxEntries: 10 });
    const profile = {
      id: "researcher",
      label: "Researcher",
      role: "Do research.",
      memoryNamespaces: [],
    };

    const ctx1 = buildAgentPromptContext({
      agentId: "researcher",
      profile,
      stageSystem: "You are a test agent.",
      cache,
    });
    const ctx2 = buildAgentPromptContext({
      agentId: "researcher",
      profile,
      stageSystem: "You are a test agent.",
      cache,
    });

    const ap1 = ctx1.sections.find((s) => s.id === "agent_profile")?.content;
    const ap2 = ctx2.sections.find((s) => s.id === "agent_profile")?.content;
    expect(ap1).toBeDefined();
    expect(ap2).toBe(ap1);
  });
});
