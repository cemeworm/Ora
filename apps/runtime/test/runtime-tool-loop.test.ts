import { describe, expect, it } from "vitest";
import {
  cacheKeyForRuntimeTool,
  invalidatesRuntimeToolCache,
} from "../src/harness/runtime-tool-loop.js";

describe("runtime tool loop scheduling helpers", () => {
  it("builds same-run cache keys for deterministic read-only tools", () => {
    expect(cacheKeyForRuntimeTool({ tool: "file.read", args: { path: "src/index.ts" } })).toBe("file.read:src/index.ts");
    expect(cacheKeyForRuntimeTool({ tool: "file.list", args: {} })).toBe("file.list:.");
    expect(cacheKeyForRuntimeTool({ tool: "file.glob", args: { pattern: "**/*.ts" } })).toBe("file.glob:**/*.ts");
    expect(cacheKeyForRuntimeTool({ tool: "file.grep", args: { pattern: "needle", include: "src/**/*.ts" } })).toBe("file.grep:needle:src/**/*.ts");
    expect(cacheKeyForRuntimeTool({ tool: "web.search", args: { query: "Ora runtime", limit: 5 } })).toBe("web.search:ora runtime:5");
    expect(cacheKeyForRuntimeTool({ tool: "file.read", args: { path: "src/index.ts" } }, { readOnlyFileTools: false })).toBeUndefined();
  });

  it("identifies mutating tools that invalidate read caches", () => {
    expect(invalidatesRuntimeToolCache({ tool: "file.write", args: {} })).toBe(true);
    expect(invalidatesRuntimeToolCache({ tool: "file.patch", args: {} })).toBe(true);
    expect(invalidatesRuntimeToolCache({ tool: "shell.execute", args: {} })).toBe(true);
    expect(invalidatesRuntimeToolCache({ tool: "skills.update", args: {} })).toBe(true);
    expect(invalidatesRuntimeToolCache({ tool: "file.read", args: {} })).toBe(false);
    expect(invalidatesRuntimeToolCache({ tool: "web.search", args: {} })).toBe(false);
  });
});
