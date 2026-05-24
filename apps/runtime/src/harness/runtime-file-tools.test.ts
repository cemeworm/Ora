import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MVP_TOOLS, type HostFilesystemState } from "@cemeworm/shared";
import { RuntimeToolExecutor } from "./runtime-tool-executor.js";
import { ClarificationInterruptError, isClarificationInterruptError } from "./runtime-interrupts.js";
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

function executorWithoutWorkspace(hostFilesystem?: HostFilesystemState): RuntimeToolExecutor {
  return new RuntimeToolExecutor({
    hostFilesystem,
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

  it("enables file tools without a project folder when host grants are present", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-host-grant-"));
    const visible = executorWithoutWorkspace({
      grants: [{
        id: `attached-local-file:${tempDir}`,
        rootPath: tempDir,
        label: `Attached local file directory (${tempDir})`,
        source: "attached_local_file",
        capabilities: ["read", "list", "search"],
        expiresWithRun: true,
      }],
      allowDynamicGrant: false,
    }).enabledToolIds([
      "file.read",
      "file.write",
      "web.fetch",
    ]);

    expect(visible).toEqual(["file.read", "web.fetch"]);
  });

  it("reads and writes host tmp files through explicit host_tmp scope", async () => {
    const tmpDir = fs.mkdtempSync("/tmp/ora-host-tmp-");
    const tmpFile = path.join(tmpDir, "sample.txt");

    const writeResult = await executorWithoutWorkspace({
      grants: [
        {
          id: "system-tmp:/tmp",
          rootPath: "/tmp",
          label: "Temporary directory (/tmp)",
          source: "system_tmp",
          capabilities: ["read", "list", "search", "write", "patch"],
          expiresWithRun: true,
        },
        {
          id: "system-tmp:/private/tmp",
          rootPath: "/private/tmp",
          label: "Temporary directory (/private/tmp)",
          source: "system_tmp",
          capabilities: ["read", "list", "search", "write", "patch"],
          expiresWithRun: true,
        },
      ],
      allowDynamicGrant: false,
    }).executeWithMetadata({
      tool: "file.write",
      args: {
        scope: "host_tmp",
        path: tmpFile,
        content: "hello host tmp",
      },
    });

    expect(writeResult.output).toMatchObject({
      scope: "host_tmp",
      path: tmpFile,
      sizeBytes: 14,
    });

    const readResult = await executorWithoutWorkspace({
      grants: [
        {
          id: "system-tmp:/tmp",
          rootPath: "/tmp",
          label: "Temporary directory (/tmp)",
          source: "system_tmp",
          capabilities: ["read", "list", "search", "write", "patch"],
          expiresWithRun: true,
        },
      ],
      allowDynamicGrant: false,
    }).executeWithMetadata({
      tool: "file.read",
      args: {
        scope: "host_tmp",
        path: tmpFile,
      },
    });

    expect(readResult.output).toMatchObject({
      scope: "host_tmp",
      path: tmpFile,
      content: "hello host tmp",
    });
  });

  it("rejects host_tmp access when the run did not receive tmp grants", async () => {
    const rootPath = tempWorkspace();

    await expect(executor(rootPath).executeWithMetadata({
      tool: "file.list",
      args: {
        scope: "host_tmp",
        path: "/tmp",
      },
    })).rejects.toThrow("Host file path must stay inside the approved grant root.");
  });

  it("supports read-only attached local file grants and blocks writes", async () => {
    const attachmentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-attached-local-file-"));
    const attachmentFile = path.join(attachmentDir, "note.txt");
    fs.writeFileSync(attachmentFile, "attached note", "utf8");
    const hostFilesystem: HostFilesystemState = {
      grants: [{
        id: `attached-local-file:${attachmentDir}`,
        rootPath: attachmentDir,
        label: `Attached local file directory (${attachmentDir})`,
        source: "attached_local_file",
        capabilities: ["read", "list", "search"],
        expiresWithRun: true,
      }],
      allowDynamicGrant: false,
    };

    const readResult = await executorWithoutWorkspace(hostFilesystem).executeWithMetadata({
      tool: "file.read",
      args: {
        scope: "host_grant",
        grantId: `attached-local-file:${attachmentDir}`,
        path: attachmentFile,
      },
    });

    expect(readResult.output).toMatchObject({
      scope: "host_grant",
      grantId: `attached-local-file:${attachmentDir}`,
      path: attachmentFile,
      content: "attached note",
    });

    await expect(executorWithoutWorkspace(hostFilesystem).executeWithMetadata({
      tool: "file.write",
      args: {
        scope: "host_grant",
        grantId: `attached-local-file:${attachmentDir}`,
        path: attachmentFile,
        content: "mutated",
      },
    })).rejects.toThrow("Host file grant does not allow write access.");
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

  it("normalizes workspace-absolute file.read paths into workspace-relative reads", async () => {
    const rootPath = tempWorkspace();
    const absoluteFilePath = path.join(rootPath, "README.md");
    fs.writeFileSync(absoluteFilePath, "absolute path read\n", "utf8");

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.read",
      args: {
        path: absoluteFilePath,
      },
    });

    expect(result.output).toMatchObject({
      path: "README.md",
      content: "absolute path read\n",
    });
  });

  it("raises a clarification interrupt for ambiguous workspace file.read targets when clarification context is available", async () => {
    const rootPath = tempWorkspace();
    fs.mkdirSync(path.join(rootPath, "src"), { recursive: true });
    fs.writeFileSync(path.join(rootPath, "src", "state.tsx"), "export const stateTsx = 1;\n", "utf8");
    fs.writeFileSync(path.join(rootPath, "src", "state.js"), "export const stateJs = 1;\n", "utf8");
    const toolExecutor = executor(rootPath);

    await expect(toolExecutor.executeWithMetadata({
      tool: "file.read",
      args: { path: "src/state.ts" },
    }, {
      currentNodeId: "node-file-read",
      currentNodeLabel: "Read candidate file",
      ensureClarification: async (params) => {
        throw new ClarificationInterruptError({
          id: params.id,
          key: params.key,
          nodeId: params.nodeId,
          nodeLabel: params.nodeLabel,
          question: params.question,
          options: params.options ?? [],
          requestedAt: 1,
        });
      },
    })).rejects.toSatisfy((error: unknown) => {
      if (!isClarificationInterruptError(error)) {
        return false;
      }
      expect(error.clarification).toMatchObject({
        nodeId: "node-file-read",
        nodeLabel: "Read candidate file",
        question: "我找到了多个可能匹配“src/state.ts”的文件，请选择你要我读取的目标。",
        options: [
          { id: "candidate_1", label: "src/state.js", value: "src/state.js", description: "读取 src/state.js" },
          { id: "candidate_2", label: "src/state.tsx", value: "src/state.tsx", description: "读取 src/state.tsx" },
        ],
      });
      expect(error.clarification.id).toMatch(/^clarification:file-read-target:[0-9a-f]{10}$/);
      expect(error.clarification.key).toMatch(/^file_read_target_[0-9a-f]{10}$/);
      return true;
    });
  });

  it("resumes ambiguous workspace file.read from a clarification answer", async () => {
    const rootPath = tempWorkspace();
    fs.mkdirSync(path.join(rootPath, "src"), { recursive: true });
    fs.writeFileSync(path.join(rootPath, "src", "state.tsx"), "export const stateTsx = 1;\n", "utf8");
    fs.writeFileSync(path.join(rootPath, "src", "state.js"), "export const stateJs = 1;\n", "utf8");
    const toolExecutor = executor(rootPath);

    const result = await toolExecutor.executeWithMetadata({
      tool: "file.read",
      args: { path: "src/state.ts" },
    }, {
      currentNodeId: "node-file-read",
      currentNodeLabel: "Read candidate file",
      ensureClarification: async () => "src/state.tsx",
    });

    expect(result.output).toMatchObject({
      scope: "workspace",
      path: "src/state.tsx",
      content: "export const stateTsx = 1;\n",
    });
  });
});
