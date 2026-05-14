import { describe, expect, it } from "vitest";
import {
  cacheKeyForRuntimeTool,
  invalidatesRuntimeToolCache,
} from "../src/harness/runtime-tool-loop.js";

describe("runtime tool loop scheduling helpers", () => {
  it("builds same-run cache keys for deterministic read-only tools", () => {
    expect(cacheKeyForRuntimeTool({ tool: "file.read", args: { path: "src/index.ts" } })).toBe("file.read:src/index.ts");
    expect(cacheKeyForRuntimeTool({ tool: "file.read", args: { path: "src/index.ts", offset: 1, limit: 200 } })).toBe("file.read:path=src/index.ts:offset=1:limit=200");
    expect(cacheKeyForRuntimeTool({ tool: "file.read", args: { path: "src/index.ts", offset: "200" } })).toBe("file.read:path=src/index.ts:offset=200:limit=rest");
    expect(cacheKeyForRuntimeTool({ tool: "file.list", args: {} })).toBe("file.list:path=.:limit=default");
    expect(cacheKeyForRuntimeTool({ tool: "file.list", args: { path: "src", limit: 10 } })).toBe("file.list:path=src:limit=10");
    expect(cacheKeyForRuntimeTool({ tool: "file.glob", args: { pattern: "**/*.ts" } })).toBe("file.glob:path=.:pattern=**/*.ts:limit=default");
    expect(cacheKeyForRuntimeTool({ tool: "file.glob", args: { path: "src", pattern: "*.ts", limit: 20 } })).toBe("file.glob:path=src:pattern=*.ts:limit=20");
    expect(cacheKeyForRuntimeTool({ tool: "file.grep", args: { pattern: "needle", include: "src/**/*.ts" } })).toBe("file.grep:path=.:pattern=needle:include=src/**/*.ts:caseSensitive=true:limit=default");
    expect(cacheKeyForRuntimeTool({ tool: "file.grep", args: { path: "src", pattern: "needle", include: "*.ts", caseSensitive: false, limit: 25 } })).toBe("file.grep:path=src:pattern=needle:include=*.ts:caseSensitive=false:limit=25");
    expect(cacheKeyForRuntimeTool({ tool: "web.fetch", args: { url: "https://example.com", maxBytes: 1024 } })).toBe("web.fetch:url=https://example.com:maxBytes=1024");
    expect(cacheKeyForRuntimeTool({ tool: "web.search", args: { query: "Ora runtime", limit: 5 } })).toBe("web.search:ora runtime:5");
    expect(cacheKeyForRuntimeTool({ tool: "file.read", args: { path: "src/index.ts" } }, { readOnlyFileTools: false })).toBeUndefined();
  });

  it("separates cache keys for read-only tools when output-affecting args differ", () => {
    expect(cacheKeyForRuntimeTool({ tool: "file.list", args: { path: "src", limit: 10 } })).not.toBe(
      cacheKeyForRuntimeTool({ tool: "file.list", args: { path: "src", limit: 100 } }),
    );
    expect(cacheKeyForRuntimeTool({ tool: "file.glob", args: { path: "src/components", pattern: "*.tsx" } })).not.toBe(
      cacheKeyForRuntimeTool({ tool: "file.glob", args: { path: "src/lib", pattern: "*.tsx" } }),
    );
    expect(cacheKeyForRuntimeTool({ tool: "file.grep", args: { path: "src/lib/viewModel.ts", pattern: "chatMessages" } })).not.toBe(
      cacheKeyForRuntimeTool({ tool: "file.grep", args: { path: "src", pattern: "chatMessages" } }),
    );
    expect(cacheKeyForRuntimeTool({ tool: "file.grep", args: { path: "src", pattern: "chatMessages", caseSensitive: true } })).not.toBe(
      cacheKeyForRuntimeTool({ tool: "file.grep", args: { path: "src", pattern: "chatMessages", caseSensitive: false } }),
    );
    expect(cacheKeyForRuntimeTool({ tool: "web.fetch", args: { url: "https://example.com", maxBytes: 1024 } })).not.toBe(
      cacheKeyForRuntimeTool({ tool: "web.fetch", args: { url: "https://example.com", maxBytes: 4096 } }),
    );
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
