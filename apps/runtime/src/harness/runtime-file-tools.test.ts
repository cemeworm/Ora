import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MVP_TOOLS } from "@cemeworm/shared";
import { RuntimeToolExecutor } from "./runtime-tool-executor.js";
import "./runtime-patch-tool.js";

function tempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-file-tools-"));
}

function executor(rootPath: string): RuntimeToolExecutor {
  return new RuntimeToolExecutor({
    workspace: { rootPath },
    toolDescriptors: MVP_TOOLS,
  });
}

function executorWithoutWorkspace(): RuntimeToolExecutor {
  return new RuntimeToolExecutor({
    toolDescriptors: MVP_TOOLS,
  });
}

describe("runtime file tools", () => {
  it("hides workspace-root-dependent tools when no project folder is selected", () => {
    const visible = executorWithoutWorkspace().enabledToolIds([
      "repo.explore",
      "file.read",
      "file.write",
      "shell.execute",
      "package.list",
      "web.fetch",
      "web.search",
    ]);

    expect(visible).toEqual(["web.fetch", "web.search"]);
  });

  it("resolves workspace package aliases from node_modules for read-only tools", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
    fs.mkdirSync(path.join(rootPath, "packages", "shared", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(rootPath, "packages", "shared", "package.json"),
      JSON.stringify({ name: "@cemeworm/shared" }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootPath, "packages", "shared", "src", "example.ts"),
      "export const agentLabelFromSnapshot = true;\n",
      "utf8",
    );

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.grep",
      args: {
        path: "node_modules/@cemeworm/shared",
        pattern: "agentLabelFromSnapshot",
      },
    });

    expect(result.output).toMatchObject({
      path: "packages/shared",
      matches: [{
        path: "packages/shared/src/example.ts",
        line: 1,
        text: "export const agentLabelFromSnapshot = true;",
      }],
    });
  });

  it("does not rewrite third-party node_modules paths into workspace aliases", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
    fs.mkdirSync(path.join(rootPath, "packages", "shared"), { recursive: true });
    fs.writeFileSync(
      path.join(rootPath, "packages", "shared", "package.json"),
      JSON.stringify({ name: "@cemeworm/shared" }, null, 2),
      "utf8",
    );

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.list",
      args: {
        path: "node_modules/react",
      },
    });

    expect(result.output).toMatchObject({
      path: "node_modules/react",
      entries: [],
      missing: true,
    });
  });

  it("patches multiple exact edits against the original file and returns diff metadata", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "sample.txt"), "alpha\nbeta\ngamma\n", "utf8");

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.patch",
      args: {
        path: "sample.txt",
        edits: [
          { oldText: "alpha", newText: "ALPHA" },
          { oldText: "gamma", newText: "GAMMA" },
        ],
      },
    });

    expect(fs.readFileSync(path.join(rootPath, "sample.txt"), "utf8")).toBe("ALPHA\nbeta\nGAMMA\n");
    expect(result.output).toMatchObject({
      path: "sample.txt",
      replacements: 2,
      firstChangedLine: 1,
    });
    expect(result.fileChange?.metadata).toMatchObject({
      replacements: 2,
      firstChangedLine: 1,
      created: false,
    });
    expect(result.fileChange?.metadata.diff).toContain("--- a/sample.txt");
    expect(result.fileChange?.metadata.diff).toContain("+++ b/sample.txt");
  });

  it("keeps the legacy search and replace arguments working", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "legacy.txt"), "hello old world", "utf8");

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.patch",
      args: {
        path: "legacy.txt",
        search: "old",
        replace: "new",
      },
    });

    expect(fs.readFileSync(path.join(rootPath, "legacy.txt"), "utf8")).toBe("hello new world");
    expect(result.output).toMatchObject({
      path: "legacy.txt",
      replacements: 1,
    });
  });

  it("rejects oldText that matches more than once", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "duplicate.txt"), "same\nsame\n", "utf8");

    await expect(executor(rootPath).executeWithMetadata({
      tool: "file.patch",
      args: {
        path: "duplicate.txt",
        edits: [{ oldText: "same", newText: "changed" }],
      },
    })).rejects.toThrow("matched more than once");

    expect(fs.readFileSync(path.join(rootPath, "duplicate.txt"), "utf8")).toBe("same\nsame\n");
  });

  it("rejects overlapping edits resolved against the original file", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "overlap.txt"), "abcdef", "utf8");

    await expect(executor(rootPath).executeWithMetadata({
      tool: "file.patch",
      args: {
        path: "overlap.txt",
        edits: [
          { oldText: "abc", newText: "ABC" },
          { oldText: "bcd", newText: "BCD" },
        ],
      },
    })).rejects.toThrow("must not overlap");

    expect(fs.readFileSync(path.join(rootPath, "overlap.txt"), "utf8")).toBe("abcdef");
  });

  it("applies a unified diff across multiple files", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "a.txt"), "alpha\nbeta\n", "utf8");
    fs.writeFileSync(path.join(rootPath, "b.txt"), "one\ntwo\n", "utf8");

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.apply_patch",
      args: {
        patch: [
          "--- a/a.txt",
          "+++ b/a.txt",
          "@@ -1,2 +1,2 @@",
          " alpha",
          "-beta",
          "+BETA",
          "--- a/b.txt",
          "+++ b/b.txt",
          "@@ -1,2 +1,2 @@",
          " one",
          "-two",
          "+TWO",
          "",
        ].join("\n"),
      },
    });

    expect(fs.readFileSync(path.join(rootPath, "a.txt"), "utf8")).toBe("alpha\nBETA\n");
    expect(fs.readFileSync(path.join(rootPath, "b.txt"), "utf8")).toBe("one\nTWO\n");
    expect(result.output).toMatchObject({
      fileCount: 2,
      additions: 2,
      deletions: 2,
    });
    expect(result.fileChange).toBeUndefined();
  });

  it("creates a new file from unified diff", async () => {
    const rootPath = tempWorkspace();

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.apply_patch",
      args: {
        patch: [
          "--- /dev/null",
          "+++ b/nested/new.txt",
          "@@ -0,0 +1,2 @@",
          "+hello",
          "+world",
          "",
        ].join("\n"),
      },
    });

    expect(fs.readFileSync(path.join(rootPath, "nested", "new.txt"), "utf8")).toBe("hello\nworld\n");
    expect(result.output).toMatchObject({
      fileCount: 1,
      createdCount: 1,
    });
    expect(result.fileChange?.metadata.created).toBe(true);
  });

  it("rejects unified diff context mismatches", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "mismatch.txt"), "alpha\nbeta\n", "utf8");

    await expect(executor(rootPath).executeWithMetadata({
      tool: "file.apply_patch",
      args: {
        patch: [
          "--- a/mismatch.txt",
          "+++ b/mismatch.txt",
          "@@ -1,2 +1,2 @@",
          " alpha",
          "-gamma",
          "+GAMMA",
          "",
        ].join("\n"),
      },
    })).rejects.toThrow("context mismatch");
  });

  it("rejects unified diff path escape attempts", async () => {
    const rootPath = tempWorkspace();

    await expect(executor(rootPath).executeWithMetadata({
      tool: "file.apply_patch",
      args: {
        patch: [
          "--- /dev/null",
          "+++ b/../../../etc/passwd",
          "@@ -0,0 +1,1 @@",
          "+oops",
          "",
        ].join("\n"),
      },
    })).rejects.toThrow("inside the project root");
  });

  it("exposes structured file, web, and document schemas in tool definitions", () => {
    const definitions = executor(tempWorkspace()).toolDefinitions([
      "file.read",
      "file.write",
      "file.patch",
      "file.apply_patch",
      "web.fetch",
      "web.search",
      "document.extract",
    ]);
    const byId = new Map(definitions.map((definition) => [definition.id, definition.parameters]));

    expect(byId.get("file.read")).toMatchObject({ required: ["path"] });
    expect(byId.get("file.write")).toMatchObject({ required: ["path", "content"] });
    expect(byId.get("file.patch")).toMatchObject({
      anyOf: [
        { required: ["edits"] },
        { required: ["search", "replace"] },
      ],
      properties: {
        path: expect.any(Object),
        edits: expect.any(Object),
        approvalRequest: expect.any(Object),
      },
    });
    expect(byId.get("file.apply_patch")).toMatchObject({
      required: ["patch"],
      properties: {
        patch: expect.any(Object),
        approvalRequest: expect.any(Object),
      },
    });
    expect(byId.get("web.fetch")).toMatchObject({ required: ["url"] });
    expect(byId.get("web.search")).toMatchObject({ required: ["query"] });
    expect(byId.get("document.extract")).toMatchObject({
      oneOf: [
        { required: ["path"] },
        { required: ["url"] },
      ],
      properties: {
        path: expect.any(Object),
        url: expect.any(Object),
        format: expect.any(Object),
      },
    });
  });
});
