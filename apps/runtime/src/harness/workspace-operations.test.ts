import { describe, it, expect } from "vitest";
import { createFakeWorkspaceOperations } from "./workspace-operations.fake.js";

describe("FakeWorkspaceOperations", () => {
  const files = {
    "src/hello.ts": { content: "export const hello = 'world';\nconsole.log(hello);\n" },
    "src/utils.ts": { content: "export function add(a: number, b: number): number {\n  return a + b;\n}\n" },
    "docs/readme.md": { content: "# Project\n\nHello world.\n" },
  };

  describe("readFile", () => {
    it("reads file content", () => {
      const ops = createFakeWorkspaceOperations(files);
      const result = ops.readFile("/fake", "src/hello.ts", 10_000);
      expect(result.content).toBe("export const hello = 'world';\nconsole.log(hello);\n");
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.binary).toBe(false);
    });

    it("throws ENOENT for missing files", () => {
      const ops = createFakeWorkspaceOperations(files);
      expect(() => ops.readFile("/fake", "nonexistent.ts", 10_000))
        .toThrow(/ENOENT/);
    });

    it("returns too_large when file exceeds maxBytes", () => {
      const ops = createFakeWorkspaceOperations(files);
      const result = ops.readFile("/fake", "src/hello.ts", 10);
      expect(result.skippedReason).toBe("too_large");
      expect(result.content).toBe("");
    });
  });

  describe("writeFile", () => {
    it("writes new file content", () => {
      const ops = createFakeWorkspaceOperations({ ...files });
      ops.writeFile("/fake", "src/new.ts", "export const x = 1;");
      const result = ops.readFile("/fake", "src/new.ts", 10_000);
      expect(result.content).toBe("export const x = 1;");
    });

    it("overwrites existing file", () => {
      const ops = createFakeWorkspaceOperations({ ...files });
      ops.writeFile("/fake", "src/hello.ts", "updated");
      const result = ops.readFile("/fake", "src/hello.ts", 10_000);
      expect(result.content).toBe("updated");
    });
  });

  describe("listFiles", () => {
    it("lists files in root", () => {
      const ops = createFakeWorkspaceOperations(files);
      const result = ops.listFiles("/fake", ".");
      expect(result).toHaveLength(2);
      expect(result.map((e) => e.path).sort()).toEqual(["docs", "src"]);
    });

    it("lists files in subdirectory", () => {
      const ops = createFakeWorkspaceOperations(files);
      const result = ops.listFiles("/fake", "src");
      expect(result).toHaveLength(2);
      expect(result.map((e) => e.path).sort()).toEqual([
        "src/hello.ts",
        "src/utils.ts",
      ]);
    });
  });

  describe("globFiles", () => {
    it("matches glob patterns", () => {
      const ops = createFakeWorkspaceOperations(files);
      const result = ops.globFiles("/fake", "src/*.ts");
      expect(result.sort()).toEqual(["src/hello.ts", "src/utils.ts"]);
    });

    it("returns empty for no match", () => {
      const ops = createFakeWorkspaceOperations(files);
      const result = ops.globFiles("/fake", "*.json");
      expect(result).toHaveLength(0);
    });
  });

  describe("grepFiles", () => {
    it("finds matching lines", () => {
      const ops = createFakeWorkspaceOperations(files);
      const result = ops.grepFiles("/fake", "hello", {
        maxFiles: 100,
        maxMatches: 100,
        maxBytes: 10_000,
        caseSensitive: false,
      });
      expect(result).toHaveLength(3); // "hello" appears twice in src/hello.ts + "Hello" in docs/readme.md
      expect([...new Set(result.map((m) => m.path))].sort()).toEqual(["docs/readme.md", "src/hello.ts"]);
    });

    it("respects include filter", () => {
      const ops = createFakeWorkspaceOperations(files);
      const result = ops.grepFiles("/fake", "hello", {
        include: "src/*.ts",
        maxFiles: 100,
        maxMatches: 100,
        maxBytes: 10_000,
      });
      expect(result).toHaveLength(2); // "hello" appears twice in src/hello.ts
      expect(result[0]!.path).toBe("src/hello.ts");
    });

    it("respects case sensitivity", () => {
      const ops = createFakeWorkspaceOperations(files);
      const lower = ops.grepFiles("/fake", "hello", {
        maxFiles: 100,
        maxMatches: 100,
        maxBytes: 10_000,
        caseSensitive: true,
      });
      const upper = ops.grepFiles("/fake", "HELLO", {
        maxFiles: 100,
        maxMatches: 100,
        maxBytes: 10_000,
        caseSensitive: true,
      });
      expect(lower.length).toBeGreaterThan(0);
      expect(upper).toHaveLength(0);
    });

    it("respects maxMatches", () => {
      const ops = createFakeWorkspaceOperations(files);
      const result = ops.grepFiles("/fake", "hello", {
        maxFiles: 100,
        maxMatches: 1,
        maxBytes: 10_000,
        caseSensitive: false,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("exec", () => {
    it("returns fake output", async () => {
      const ops = createFakeWorkspaceOperations(files);
      const result = await ops.exec("/fake", "echo hello", { timeoutMs: 5000, maxOutputBytes: 10_000 });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Fake output for: echo hello");
    });

    it("returns cached result for known command", async () => {
      const cached = new Map();
      cached.set("npm test", {
        command: "npm test",
        cwd: "/fake",
        exitCode: 0,
        stdout: "all tests passed",
        stderr: "",
        output: "all tests passed",
        truncated: false,
        durationMs: 42,
      });
      const ops = createFakeWorkspaceOperations(files, cached);
      const result = await ops.exec("/fake", "npm test", { timeoutMs: 5000, maxOutputBytes: 10_000 });
      expect(result.stdout).toBe("all tests passed");
      expect(result.durationMs).toBe(42);
    });
  });

  describe("readFile -> writeFile -> grepFiles roundtrip", () => {
    it("writes files and finds them via grep", () => {
      const ops = createFakeWorkspaceOperations({});
      ops.writeFile("/fake", "config.json", '{"key":"value","enabled":true}');
      ops.writeFile("/fake", "src/main.ts", 'import "./config.json";');
      const grepResult = ops.grepFiles("/fake", "enabled", {
        maxFiles: 100,
        maxMatches: 100,
        maxBytes: 10_000,
      });
      expect(grepResult).toHaveLength(1);
      expect(grepResult[0]!.path).toBe("config.json");
      expect(ops.readFile("/fake", "config.json", 1000).content).toBe('{"key":"value","enabled":true}');
    });
  });
});
