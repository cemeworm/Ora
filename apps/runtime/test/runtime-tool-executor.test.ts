import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MVP_TOOLS } from "@ora/shared";
import {
  IMPLEMENTED_RUNTIME_TOOL_IDS,
  RuntimeToolExecutor,
} from "../src/harness/runtime-tool-executor.js";

const cleanupPaths: string[] = [];

function createWorkspace() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ora-tool-test-"));
  cleanupPaths.push(rootPath);
  fs.mkdirSync(path.join(rootPath, "src"), { recursive: true });
  fs.writeFileSync(path.join(rootPath, "README.md"), "Ora local agent tools\n", "utf8");
  fs.writeFileSync(path.join(rootPath, "src", "alpha.ts"), "export const alpha = 1;\n", "utf8");
  fs.writeFileSync(path.join(rootPath, "src", "beta.ts"), "export const beta = alpha + 1;\n", "utf8");
  return {
    rootPath,
    workspace: {
      label: "Tool Test",
      rootPath,
    },
  };
}

afterEach(() => {
  for (const cleanupPath of cleanupPaths.splice(0)) {
    fs.rmSync(cleanupPath, { recursive: true, force: true });
  }
});

describe("RuntimeToolExecutor", () => {
  it("has executors for every implemented MVP tool descriptor", () => {
    const implementedIds = new Set(IMPLEMENTED_RUNTIME_TOOL_IDS);
    const implementedDescriptors = MVP_TOOLS.filter((tool) => tool.implemented !== false);

    expect(implementedDescriptors.map((tool) => tool.id).sort()).toEqual([...implementedIds].sort());
  });

  it("reads, lists, globs, and greps files inside the workspace root", async () => {
    const { workspace } = createWorkspace();
    const executor = new RuntimeToolExecutor({ workspace, toolDescriptors: MVP_TOOLS });

    await expect(executor.execute({ tool: "file.read", args: { path: "../outside.txt" } })).rejects.toThrow(
      "Workspace tool path must stay inside the project root",
    );

    const read = await executor.execute({ tool: "file.read", args: { path: "README.md" } }) as { content: string };
    const list = await executor.execute({ tool: "file.list", args: { path: "src" } }) as { entries: Array<{ name: string }> };
    const glob = await executor.execute({ tool: "file.glob", args: { pattern: "src/*.ts" } }) as { matches: string[] };
    const grep = await executor.execute({ tool: "file.grep", args: { pattern: "alpha", include: "src/*.ts" } }) as {
      matches: Array<{ path: string; line: number }>;
    };

    expect(read.content).toContain("Ora local agent tools");
    expect(list.entries.map((entry) => entry.name)).toEqual(["alpha.ts", "beta.ts"]);
    expect(glob.matches.sort()).toEqual(["src/alpha.ts", "src/beta.ts"]);
    expect(grep.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/alpha.ts", line: 1 }),
      expect.objectContaining({ path: "src/beta.ts", line: 1 }),
    ]));
  });

  it("writes and patches files through approval-scoped tools", async () => {
    const { rootPath, workspace } = createWorkspace();
    const executor = new RuntimeToolExecutor({ workspace, toolDescriptors: MVP_TOOLS });

    const writeCall = { tool: "file.write" as const, args: { path: "notes/result.md", content: "before\n" } };
    const patchCall = { tool: "file.patch" as const, args: { path: "notes/result.md", search: "before", replace: "after" } };

    expect(executor.riskLevel(writeCall)).toBe("high");
    expect(executor.riskLevel(patchCall)).toBe("high");

    await executor.execute(writeCall, { allowRisky: true });
    await executor.execute(patchCall, { allowRisky: true });

    expect(fs.readFileSync(path.join(rootPath, "notes", "result.md"), "utf8")).toBe("after\n");
  });

  it("keeps read-only shell commands low risk and gates broader commands", async () => {
    const { workspace } = createWorkspace();
    const executor = new RuntimeToolExecutor({ workspace, toolDescriptors: MVP_TOOLS });
    const readOnly = { tool: "shell.execute" as const, args: { command: "pwd" } };
    const broader = { tool: "shell.execute" as const, args: { command: "node --version" } };

    expect(executor.riskLevel(readOnly)).toBe("low");
    expect(executor.riskLevel(broader)).toBe("high");

    const readOnlyResult = await executor.execute(readOnly) as { exitCode: number; stdout: string };
    expect(readOnlyResult.exitCode).toBe(0);
    expect(readOnlyResult.stdout).toContain((workspace as { rootPath: string }).rootPath);

    await expect(executor.execute(broader)).rejects.toThrow("shell.execute command must be one of");
    const approvedResult = await executor.execute(broader, { allowRisky: true }) as { exitCode: number; stdout: string };
    expect(approvedResult.exitCode).toBe(0);
    expect(approvedResult.stdout.trim()).toMatch(/^v\d+/);
  });

  it("fetches HTTP content for web.fetch", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("hello from ora");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected local server address.");
      }
      const executor = new RuntimeToolExecutor({ toolDescriptors: MVP_TOOLS });
      const result = await executor.execute({
        tool: "web.fetch",
        args: { url: `http://127.0.0.1:${address.port}/docs` },
      }) as { status: number; text: string };

      expect(result.status).toBe(200);
      expect(result.text).toBe("hello from ora");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("discovers, calls, and reads resources from a configured stdio MCP server", async () => {
    const { rootPath, workspace } = createWorkspace();
    const serverPath = path.join(rootPath, "fake-mcp.cjs");
    const configPath = path.join(rootPath, ".ora", "mcp.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(serverPath, `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  let result = {};
  if (request.method === "tools/list") {
    result = { tools: [{ name: "echo", description: "Echo input" }] };
  } else if (request.method === "tools/call") {
    result = { content: [{ type: "text", text: JSON.stringify(request.params.arguments) }] };
  } else if (request.method === "resources/read") {
    result = { contents: [{ uri: request.params.uri, text: "resource text" }] };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
});
`, "utf8");
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        fake: {
          command: process.execPath,
          args: [serverPath],
        },
      },
    }, null, 2), "utf8");

    const executor = new RuntimeToolExecutor({
      workspace,
      toolDescriptors: MVP_TOOLS,
      mcpConfigPaths: [configPath],
    });

    const tools = await executor.execute({ tool: "mcp.listTools", args: { server: "fake" } }) as { tools: Array<{ name: string }> };
    const call = await executor.execute(
      { tool: "mcp.call", args: { server: "fake", name: "echo", arguments: { q: "ora" } } },
      { allowRisky: true },
    ) as { content: Array<{ text: string }> };
    const resource = await executor.execute({ tool: "mcp.readResource", args: { server: "fake", uri: "docs://intro" } }) as {
      contents: Array<{ uri: string; text: string }>;
    };

    expect(tools.tools[0]?.name).toBe("echo");
    expect(call.content[0]?.text).toBe("{\"q\":\"ora\"}");
    expect(resource.contents[0]).toEqual({ uri: "docs://intro", text: "resource text" });
  });
});
