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

  it("implicitly routes absolute read-only paths into the most specific host grant when no workspace is selected", async () => {
    const outerDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-channel-host-outer-"));
    const nestedDir = path.join(outerDir, "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    const nestedFile = path.join(nestedDir, "note.txt");
    fs.writeFileSync(nestedFile, "nested note", "utf8");
    const hostFilesystem: HostFilesystemState = {
      grants: [
        {
          id: `channel-local-read:${outerDir}`,
          rootPath: outerDir,
          label: `Channel local read root (${outerDir})`,
          source: "user_approved",
          capabilities: ["read", "list", "search"],
          expiresWithRun: true,
        },
        {
          id: `channel-local-read:${nestedDir}`,
          rootPath: nestedDir,
          label: `Channel local read root (${nestedDir})`,
          source: "user_approved",
          capabilities: ["read", "list", "search"],
          expiresWithRun: true,
        },
      ],
      allowDynamicGrant: false,
    };

    const readResult = await executorWithoutWorkspace(hostFilesystem).executeWithMetadata({
      tool: "file.read",
      args: {
        path: nestedFile,
      },
    });

    expect(readResult.output).toMatchObject({
      scope: "host_grant",
      grantId: `channel-local-read:${nestedDir}`,
      path: nestedFile,
      content: "nested note",
    });

    const listResult = await executorWithoutWorkspace(hostFilesystem).executeWithMetadata({
      tool: "file.list",
      args: {
        path: nestedDir,
      },
    });

    expect(listResult.output).toMatchObject({
      scope: "host_grant",
      grantId: `channel-local-read:${nestedDir}`,
      path: nestedDir,
    });
  });

  it("uses the only readable host grant for default list/glob/grep calls without a workspace", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-channel-host-default-"));
    fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "src", "alpha.ts"), "export const alpha = 1;\n", "utf8");
    fs.writeFileSync(path.join(rootDir, "README.md"), "# host root\n", "utf8");
    const hostFilesystem: HostFilesystemState = {
      grants: [{
        id: `channel-local-read:${rootDir}`,
        rootPath: rootDir,
        label: `Channel local read root (${rootDir})`,
        source: "user_approved",
        capabilities: ["read", "list", "search"],
        expiresWithRun: true,
      }],
      allowDynamicGrant: false,
    };

    const listResult = await executorWithoutWorkspace(hostFilesystem).executeWithMetadata({
      tool: "file.list",
      args: {},
    });

    expect(listResult.output).toMatchObject({
      scope: "host_grant",
      grantId: `channel-local-read:${rootDir}`,
      path: rootDir,
    });
    expect(listResult.output).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ name: "src", kind: "directory" }),
        expect.objectContaining({ name: "README.md", kind: "file" }),
      ]),
    });

    const globResult = await executorWithoutWorkspace(hostFilesystem).executeWithMetadata({
      tool: "file.glob",
      args: {
        pattern: "**/*.ts",
      },
    });

    expect(globResult.output).toMatchObject({
      scope: "host_grant",
      grantId: `channel-local-read:${rootDir}`,
      path: rootDir,
      matches: expect.arrayContaining([path.join(rootDir, "src", "alpha.ts")]),
    });

    const grepResult = await executorWithoutWorkspace(hostFilesystem).executeWithMetadata({
      tool: "file.grep",
      args: {
        pattern: "alpha",
      },
    });

    expect(grepResult.output).toMatchObject({
      scope: "host_grant",
      grantId: `channel-local-read:${rootDir}`,
      path: rootDir,
      truncated: false,
      matches: expect.arrayContaining([
        expect.objectContaining({
          path: path.join(rootDir, "src", "alpha.ts"),
          text: "export const alpha = 1;",
        }),
      ]),
    });
  });

  it("supports relative host-grant paths without a workspace only when there is a single readable grant", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-channel-host-relative-"));
    fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "src", "beta.ts"), "export const beta = 2;\n", "utf8");
    const hostFilesystem: HostFilesystemState = {
      grants: [{
        id: `channel-local-read:${rootDir}`,
        rootPath: rootDir,
        label: `Channel local read root (${rootDir})`,
        source: "user_approved",
        capabilities: ["read", "list", "search"],
        expiresWithRun: true,
      }],
      allowDynamicGrant: false,
    };

    const readResult = await executorWithoutWorkspace(hostFilesystem).executeWithMetadata({
      tool: "file.read",
      args: {
        path: "src/beta.ts",
      },
    });

    expect(readResult.output).toMatchObject({
      scope: "host_grant",
      grantId: `channel-local-read:${rootDir}`,
      path: path.join(rootDir, "src", "beta.ts"),
      content: "export const beta = 2;\n",
    });
  });

  it("does not guess among multiple readable host grants for relative paths without a workspace", async () => {
    const firstDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-channel-host-first-"));
    const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-channel-host-second-"));
    const hostFilesystem: HostFilesystemState = {
      grants: [
        {
          id: `channel-local-read:${firstDir}`,
          rootPath: firstDir,
          label: `Channel local read root (${firstDir})`,
          source: "user_approved",
          capabilities: ["read", "list", "search"],
          expiresWithRun: true,
        },
        {
          id: `channel-local-read:${secondDir}`,
          rootPath: secondDir,
          label: `Channel local read root (${secondDir})`,
          source: "user_approved",
          capabilities: ["read", "list", "search"],
          expiresWithRun: true,
        },
      ],
      allowDynamicGrant: false,
    };

    await expect(executorWithoutWorkspace(hostFilesystem).executeWithMetadata({
      tool: "file.glob",
      args: {
        pattern: "**/*.ts",
      },
    })).rejects.toThrow("A selected project folder is required for this tool.");
  });

  it("extracts local PDFs through host grants without a workspace", async () => {
    const attachmentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-document-host-grant-"));
    const pdfPath = path.join(attachmentDir, "sample.pdf");
    const pdfData = Buffer.from([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
      0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a,
      0x3c, 0x3c, 0x20, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x20, 0x2f, 0x43, 0x61, 0x74, 0x61, 0x6c, 0x6f, 0x67, 0x20, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x73, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x20, 0x3e, 0x3e, 0x0a,
      0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a,
      0x32, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a,
      0x3c, 0x3c, 0x20, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x20, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x73, 0x20, 0x2f, 0x4b, 0x69, 0x64, 0x73, 0x20, 0x5b, 0x33, 0x20, 0x30, 0x20, 0x52, 0x5d, 0x20, 0x2f, 0x43, 0x6f, 0x75, 0x6e, 0x74, 0x20, 0x31, 0x20, 0x3e, 0x3e, 0x0a,
      0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a,
      0x33, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a,
      0x3c, 0x3c, 0x20, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x20, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x20, 0x2f, 0x50, 0x61, 0x72, 0x65, 0x6e, 0x74, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x20, 0x2f, 0x4d, 0x65, 0x64, 0x69, 0x61, 0x42, 0x6f, 0x78, 0x20, 0x5b, 0x30, 0x20, 0x30, 0x20, 0x33, 0x30, 0x30, 0x20, 0x31, 0x34, 0x34, 0x5d, 0x20, 0x2f, 0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x73, 0x20, 0x34, 0x20, 0x30, 0x20, 0x52, 0x20, 0x2f, 0x52, 0x65, 0x73, 0x6f, 0x75, 0x72, 0x63, 0x65, 0x73, 0x20, 0x3c, 0x3c, 0x20, 0x2f, 0x46, 0x6f, 0x6e, 0x74, 0x20, 0x3c, 0x3c, 0x20, 0x2f, 0x46, 0x31, 0x20, 0x35, 0x20, 0x30, 0x20, 0x52, 0x20, 0x3e, 0x3e, 0x20, 0x3e, 0x3e, 0x20, 0x3e, 0x3e, 0x0a,
      0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a,
      0x34, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a,
      0x3c, 0x3c, 0x20, 0x2f, 0x4c, 0x65, 0x6e, 0x67, 0x74, 0x68, 0x20, 0x32, 0x39, 0x20, 0x3e, 0x3e, 0x0a,
      0x73, 0x74, 0x72, 0x65, 0x61, 0x6d, 0x0a,
      0x42, 0x54, 0x0a,
      0x2f, 0x46, 0x31, 0x20, 0x31, 0x32, 0x20, 0x54, 0x66, 0x0a,
      0x37, 0x32, 0x20, 0x37, 0x32, 0x20, 0x54, 0x64, 0x0a,
      0x28, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x50, 0x44, 0x46, 0x29, 0x20, 0x54, 0x6a, 0x0a,
      0x45, 0x54, 0x0a,
      0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d, 0x0a,
      0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a,
      0x35, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a,
      0x3c, 0x3c, 0x20, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x20, 0x2f, 0x46, 0x6f, 0x6e, 0x74, 0x20, 0x2f, 0x53, 0x75, 0x62, 0x74, 0x79, 0x70, 0x65, 0x20, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x31, 0x20, 0x2f, 0x42, 0x61, 0x73, 0x65, 0x46, 0x6f, 0x6e, 0x74, 0x20, 0x2f, 0x48, 0x65, 0x6c, 0x76, 0x65, 0x74, 0x69, 0x63, 0x61, 0x20, 0x3e, 0x3e, 0x0a,
      0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a,
      0x78, 0x72, 0x65, 0x66, 0x0a,
      0x30, 0x20, 0x36, 0x0a,
      0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x36, 0x35, 0x35, 0x33, 0x35, 0x20, 0x66, 0x20, 0x0a,
      0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x31, 0x30, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x20, 0x0a,
      0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x36, 0x33, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x20, 0x0a,
      0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x31, 0x32, 0x32, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x20, 0x0a,
      0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x32, 0x34, 0x39, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x20, 0x0a,
      0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x33, 0x32, 0x37, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x20, 0x0a,
      0x74, 0x72, 0x61, 0x69, 0x6c, 0x65, 0x72, 0x0a,
      0x3c, 0x3c, 0x20, 0x2f, 0x52, 0x6f, 0x6f, 0x74, 0x20, 0x31, 0x20, 0x30, 0x20, 0x52, 0x20, 0x2f, 0x53, 0x69, 0x7a, 0x65, 0x20, 0x36, 0x20, 0x3e, 0x3e, 0x0a,
      0x73, 0x74, 0x61, 0x72, 0x74, 0x78, 0x72, 0x65, 0x66, 0x0a,
      0x33, 0x39, 0x37, 0x0a,
      0x25, 0x25, 0x45, 0x4f, 0x46, 0x0a,
    ]);
    fs.writeFileSync(pdfPath, pdfData);
    const hostFilesystem: HostFilesystemState = {
      grants: [{
        id: `channel-local-read:${attachmentDir}`,
        rootPath: attachmentDir,
        label: `Channel local read root (${attachmentDir})`,
        source: "user_approved",
        capabilities: ["read", "list", "search"],
        expiresWithRun: true,
      }],
      allowDynamicGrant: false,
    };

    const result = await executorWithoutWorkspace(hostFilesystem).executeWithMetadata({
      tool: "document.extract",
      args: {
        path: pdfPath,
        format: "text",
      },
    });

    expect(result.output).toMatchObject({
      source: pdfPath,
      mimeType: "application/pdf",
      text: expect.stringContaining("Hello PDF"),
    });
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
        scope: expect.any(Object),
        grantId: expect.any(Object),
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

  it("reads utf16 markdown files instead of treating them as binary", async () => {
    const rootPath = tempWorkspace();
    const filePath = path.join(rootPath, "notes.md");
    fs.writeFileSync(filePath, Buffer.from([0xff, 0xfe, ...Buffer.from("# hi\n", "utf16le")]));

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.read",
      args: { path: "notes.md" },
    });

    expect(result.output).toMatchObject({
      path: "notes.md",
      content: "# hi\n",
    });
  });

  it("still skips true binary files", async () => {
    const rootPath = tempWorkspace();
    const filePath = path.join(rootPath, "blob.bin");
    fs.writeFileSync(filePath, Buffer.from([0x00, 0x13, 0x37, 0x00, 0xff, 0x01]));

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.read",
      args: { path: "blob.bin" },
    });

    expect(result.output).toMatchObject({
      path: "blob.bin",
      binary: true,
      skippedReason: "binary_file",
      content: "",
    });
  });

  it("grep scans utf16 text files", async () => {
    const rootPath = tempWorkspace();
    const filePath = path.join(rootPath, "docs");
    fs.mkdirSync(filePath, { recursive: true });
    fs.writeFileSync(path.join(filePath, "note.md"), Buffer.from([0xff, 0xfe, ...Buffer.from("needle\n", "utf16le")]));

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.grep",
      args: { pattern: "needle", include: "**/*.md" },
    });

    expect(result.output).toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({ path: "docs/note.md", text: "needle" }),
      ]),
    });
  });
});
