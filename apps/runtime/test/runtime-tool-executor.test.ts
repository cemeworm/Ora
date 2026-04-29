import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MVP_TOOLS } from "@ora/shared";
import {
  IMPLEMENTED_RUNTIME_TOOL_IDS,
  RuntimeToolExecutor,
  extractRuntimeToolCallFromText,
} from "../src/harness/runtime-tool-executor.js";
import { RuntimeSkillRegistry } from "../src/harness/capability-registries.js";
import { PackageManager } from "../src/package-manager.js";

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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createSimplePdf(text: string): Buffer {
  const escapedText = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 24 Tf 50 100 Td (${escapedText}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
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

  it("tells agents to answer tool-capability questions from Ora runtime tools", () => {
    const { workspace } = createWorkspace();
    const executor = new RuntimeToolExecutor({ workspace, toolDescriptors: MVP_TOOLS });

    const prompt = executor.systemPrompt(["file.read", "file.list", "web.fetch", "skills.list", "skills.get"]) ?? "";

    expect(prompt).toContain("If the user asks what tools you can use");
    expect(prompt).toContain("- file.read:");
    expect(prompt).toContain("- file.list:");
    expect(prompt).toContain("- web.fetch:");
    expect(prompt).toContain("- skills.list:");
    expect(prompt).toContain("- skills.get:");
    expect(prompt).toContain("Use skills.list to discover enabled skills");
  });

  it("extracts XML-wrapped tool calls from provider text", () => {
    expect(extractRuntimeToolCallFromText(
      "<tool_call>\n{\"tool\":\"file.read\",\"args\":{\"path\":\"10-Wiki/项目/西芒杜项目.md\"}}\n</tool_call>",
      ["file.read"],
    )).toEqual({
      tool: "file.read",
      args: { path: "10-Wiki/项目/西芒杜项目.md" },
    });
  });

  it("lists and reads skills so agents can discover skill instructions during a conversation", async () => {
    const skillRegistry = new RuntimeSkillRegistry();
    const executor = new RuntimeToolExecutor({ toolDescriptors: MVP_TOOLS, skillRegistry });

    const listed = await executor.execute({
      tool: "skills.list",
      args: { query: "frontend", limit: 5 },
    }) as { skills: Array<{ name: string; description: string }> };
    expect(listed.skills.some((skill) => skill.name === "frontend-design")).toBe(true);

    const detail = await executor.execute({
      tool: "skills.get",
      args: { name: "frontend-design" },
    }) as { name: string; content: string; usageHint: string };
    expect(detail.name).toBe("frontend-design");
    expect(detail.content).toContain("## Output Requirements");
    expect(detail.usageHint).toContain("frontend-design");
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

    const write = await executor.executeWithMetadata(writeCall, { allowRisky: true });
    const patch = await executor.executeWithMetadata(patchCall, { allowRisky: true });

    expect(fs.readFileSync(path.join(rootPath, "notes", "result.md"), "utf8")).toBe("after\n");
    expect(write.fileChange).toMatchObject({
      kind: "file_change",
      path: "notes/result.md",
      operation: "write",
      beforeContent: "",
      afterContent: "before\n",
      additions: 2,
      deletions: 0,
      metadata: { created: true, sizeBytes: 7 },
    });
    expect(patch.fileChange).toMatchObject({
      kind: "file_change",
      path: "notes/result.md",
      operation: "patch",
      beforeContent: "before\n",
      afterContent: "after\n",
      additions: 1,
      deletions: 1,
      metadata: { created: false, replacements: 1, sizeBytes: 6 },
    });
  });

  it("routes package tools through the package manager", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-package-tool-repo-"));
    const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-package-tool-data-"));
    cleanupPaths.push(repoRoot, appDataRoot);
    fs.mkdirSync(path.join(repoRoot, "apps", "desktop", "dist"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "apps", "desktop", "dist", "index.html"), "<div>Ora</div>");
    fs.mkdirSync(path.join(repoRoot, "apps", "desktop", "src-tauri", "resources", "runtime-sidecar", "bin"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "apps", "desktop", "src-tauri", "resources", "runtime-sidecar", "app"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "apps", "desktop", "src-tauri", "resources", "runtime-sidecar", "bin", "node"), "");
    fs.writeFileSync(path.join(repoRoot, "apps", "desktop", "src-tauri", "resources", "runtime-sidecar", "app", "runtime-sidecar.cjs"), "");
    const packageManager = new PackageManager({
      appDataRoot,
      repoRoot,
      runCommand: (command) => `ran ${command}\n`,
    });
    const executor = new RuntimeToolExecutor({ toolDescriptors: MVP_TOOLS, packageManager });

    const candidate = await executor.execute({
      tool: "package.buildCandidate",
      args: { versionId: "slot-tool", semver: "0.1.9", verificationCommands: ["pnpm typecheck"] },
    }, { allowRisky: true }) as { versionId: string; verification: { status: string } };
    const promoted = await executor.execute({
      tool: "package.promote",
      args: { versionId: "slot-tool" },
    }, { allowRisky: true }) as { active: { activeVersionId?: string } };

    expect(executor.riskLevel({ tool: "package.promote", args: { versionId: "slot-tool" } })).toBe("high");
    expect(candidate.verification.status).toBe("passed");
    expect(promoted.active.activeVersionId).toBe("slot-tool");
  });

  it("builds natural approval copy for high-risk local tools", () => {
    const { workspace } = createWorkspace();
    const executor = new RuntimeToolExecutor({ workspace, toolDescriptors: MVP_TOOLS });
    const prompt = executor.systemPrompt(["skills.create"]) ?? "";
    const definition = executor.toolDefinitions(["skills.create"])[0];

    const writeRequest = executor.approvalRequest({
      tool: "file.write",
      args: { path: "notes/result.md", content: "before\n" },
    }, "请帮我写入这个文件");
    const shellRequest = executor.approvalRequest({
      tool: "shell.execute",
      args: { command: "node --version" },
    }, "请检查 node 版本");
    const skillRequest = executor.approvalRequest({
      tool: "skills.create",
      args: {
        name: "waza-think",
        approvalRequest: {
          title: "需要你确认安装技能",
          summary: "我准备安装 Waza 的 think 技能。",
          riskNote: "确认 GitHub 来源可信后再继续。",
        },
      },
    }, "帮我安装这个 skill");

    expect(prompt).toContain("include args.approvalRequest");
    expect(definition?.parameters?.properties).toMatchObject({
      approvalRequest: expect.objectContaining({
        required: ["title", "summary"],
      }),
    });
    expect(writeRequest.title).toBe("需要你确认写入文件");
    expect(writeRequest.summary).toContain("notes/result.md");
    expect(shellRequest.title).toBe("需要你确认运行命令");
    expect(shellRequest.summary).toContain("node --version");
    expect(skillRequest.summary).toBe("我准备安装 Waza 的 think 技能。");
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

  it("guides agents away from using web.fetch on PDF URLs", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end(createSimplePdf("Hello PDF from web fetch"));
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
        args: { url: `http://127.0.0.1:${address.port}/paper.pdf` },
      }) as { contentType?: string; text: string; truncated: boolean };

      expect(result.contentType).toBe("application/pdf");
      expect(result.text).toContain("Use document.extract");
      expect(result.text).not.toContain("%PDF");
      expect(result.truncated).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("extracts text from local PDF files with document.extract", async () => {
    const { rootPath, workspace } = createWorkspace();
    fs.writeFileSync(path.join(rootPath, "paper.pdf"), createSimplePdf("Hello PDF from Ora"));
    const executor = new RuntimeToolExecutor({ workspace, toolDescriptors: MVP_TOOLS });

    const result = await executor.execute({
      tool: "document.extract",
      args: { path: "paper.pdf", format: "text" },
    }) as { source: string; mimeType: string; pageCount?: number; text: string; truncated: boolean };

    expect(result.source).toBe("paper.pdf");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain("Hello PDF from Ora");
    expect(result.truncated).toBe(false);
  });

  it("extracts text from PDF URLs with document.extract", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end(createSimplePdf("Hello PDF URL"));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected local server address.");
      }
      const executor = new RuntimeToolExecutor({ toolDescriptors: MVP_TOOLS });
      const result = await executor.execute({
        tool: "document.extract",
        args: { url: `http://127.0.0.1:${address.port}/paper.pdf`, format: "markdown" },
      }) as { text: string; pageCount?: number };

      expect(result.text).toContain("Hello PDF URL");
      expect(result.pageCount).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects non-PDF files for document.extract", async () => {
    const { workspace } = createWorkspace();
    const executor = new RuntimeToolExecutor({ workspace, toolDescriptors: MVP_TOOLS });

    await expect(executor.execute({
      tool: "document.extract",
      args: { path: "README.md" },
    })).rejects.toThrow("document.extract currently supports PDF files only");
  });

  it("normalizes stable web.search provider responses", async () => {
    const cases = [
      {
        providerId: "brave" as const,
        env: { BRAVE_SEARCH_API_KEY: "brave-key" },
        payload: { web: { results: [{ title: "Brave Result", url: "https://example.com/brave", description: "brave snippet" }] } },
        expectedTitle: "Brave Result",
      },
      {
        providerId: "tavily" as const,
        env: { TAVILY_API_KEY: "tavily-key" },
        payload: { results: [{ title: "Tavily Result", url: "https://example.com/tavily", content: "tavily snippet" }] },
        expectedTitle: "Tavily Result",
      },
      {
        providerId: "serpapi" as const,
        env: { SERPAPI_API_KEY: "serp-key" },
        payload: { organic_results: [{ title: "Serp Result", link: "https://example.com/serp", snippet: "serp snippet" }] },
        expectedTitle: "Serp Result",
      },
      {
        providerId: "kagi" as const,
        env: { KAGI_API_KEY: "kagi-key" },
        payload: { data: [{ title: "Kagi Result", url: "https://example.com/kagi", snippet: "kagi snippet" }] },
        expectedTitle: "Kagi Result",
      },
    ];

    for (const entry of cases) {
      const fetchImpl = (async () => jsonResponse(entry.payload)) as typeof fetch;
      const executor = new RuntimeToolExecutor({
        toolDescriptors: MVP_TOOLS,
        fetchImpl,
        searchEnv: entry.env,
        searchProviderConfig: { id: entry.providerId },
      });
      const result = await executor.execute({ tool: "web.search", args: { query: "ora search", limit: 3 } }) as {
        providerId: string;
        results: Array<{ title: string; url: string; snippet?: string; source?: string }>;
      };

      expect(result.providerId).toBe(entry.providerId);
      expect(result.results).toEqual([
        expect.objectContaining({
          title: entry.expectedTitle,
          source: entry.providerId,
        }),
      ]);
    }
  });

  it("honors env provider selection when search config only sets neutral limits", async () => {
    const executor = new RuntimeToolExecutor({
      toolDescriptors: MVP_TOOLS,
      fetchImpl: (async () => jsonResponse({
        web: { results: [{ title: "Brave Env Result", url: "https://example.com/env", description: "env snippet" }] },
      })) as typeof fetch,
      searchEnv: { BRAVE_SEARCH_API_KEY: "brave-key" },
      searchProviderConfig: { maxResults: 3 },
    });

    const result = await executor.execute({ tool: "web.search", args: { query: "ora search", limit: 3 } }) as {
      providerId: string;
      results: Array<{ title: string }>;
    };

    expect(result.providerId).toBe("brave");
    expect(result.results[0]?.title).toBe("Brave Env Result");
  });


  it("handles web.search provider key, timeout, and malformed response edges", async () => {
    const missingKeyExecutor = new RuntimeToolExecutor({
      toolDescriptors: MVP_TOOLS,
      fetchImpl: (async () => jsonResponse({})) as typeof fetch,
      searchEnv: {},
      searchProviderConfig: { id: "brave" },
    });
    await expect(missingKeyExecutor.execute({ tool: "web.search", args: { query: "ora" } })).rejects.toThrow("Missing BRAVE_SEARCH_API_KEY");

    const timeoutExecutor = new RuntimeToolExecutor({
      toolDescriptors: MVP_TOOLS,
      fetchImpl: (async (_input, init) => {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });
        return jsonResponse({});
      }) as typeof fetch,
      searchEnv: { BRAVE_SEARCH_API_KEY: "brave-key" },
      searchProviderConfig: { id: "brave", timeoutMs: 1 },
    });
    await expect(timeoutExecutor.execute({ tool: "web.search", args: { query: "ora" } })).rejects.toThrow("timed out");

    const malformedExecutor = new RuntimeToolExecutor({
      toolDescriptors: MVP_TOOLS,
      fetchImpl: (async () => jsonResponse({ web: { results: [{ title: "Missing URL" }] } })) as typeof fetch,
      searchEnv: { BRAVE_SEARCH_API_KEY: "brave-key" },
      searchProviderConfig: { id: "brave" },
    });
    const malformed = await malformedExecutor.execute({ tool: "web.search", args: { query: "ora" } }) as { results: unknown[] };
    expect(malformed.results).toEqual([]);
  });

  it("uses DuckDuckGo as the explicit fallback web.search provider", async () => {
    const fetchImpl = (async () => new Response(`
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example <b>Docs</b></a>
      <a class="result__snippet">Example snippet</a>
    `)) as typeof fetch;
    const executor = new RuntimeToolExecutor({
      toolDescriptors: MVP_TOOLS,
      fetchImpl,
      searchProviderConfig: { id: "duckduckgo" },
    });

    const result = await executor.execute({ tool: "web.search", args: { query: "ora docs" } }) as {
      providerId: string;
      results: Array<{ title: string; url: string; snippet?: string }>;
    };

    expect(result.providerId).toBe("duckduckgo");
    expect(result.results[0]).toMatchObject({
      title: "Example Docs",
      url: "https://example.com/docs",
      snippet: "Example snippet",
    });
  });

  it("discovers, calls, reads resources, and searches from a configured stdio MCP server", async () => {
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
    result = { tools: [{ name: "echo", description: "Echo input" }, { name: "search", description: "Search docs" }] };
  } else if (request.method === "tools/call") {
    if (request.params.name === "search") {
      result = { content: [{ type: "text", text: JSON.stringify({ results: [{ title: "MCP Result", url: "https://example.com/mcp", snippet: request.params.arguments.query }] }) }] };
    } else {
      result = { content: [{ type: "text", text: JSON.stringify(request.params.arguments) }] };
    }
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
      searchProviderConfig: { id: "mcp", mcpServerId: "fake", mcpToolName: "search" },
    });
    const searchCall = { tool: "web.search" as const, args: { query: "ora", limit: 1 } };

    const tools = await executor.execute({ tool: "mcp.listTools", args: { server: "fake" } }) as { tools: Array<{ name: string }> };
    const call = await executor.execute(
      { tool: "mcp.call", args: { server: "fake", name: "echo", arguments: { q: "ora" } } },
      { allowRisky: true },
    ) as { content: Array<{ text: string }> };
    const resource = await executor.execute({ tool: "mcp.readResource", args: { server: "fake", uri: "docs://intro" } }) as {
      contents: Array<{ uri: string; text: string }>;
    };
    const search = await executor.execute(searchCall) as {
      providerId: string;
      results: Array<{ title: string; url: string; snippet?: string }>;
    };

    expect(executor.riskLevel(searchCall)).toBe("high");
    expect(tools.tools[0]?.name).toBe("echo");
    expect(call.content[0]?.text).toBe("{\"q\":\"ora\"}");
    expect(resource.contents[0]).toEqual({ uri: "docs://intro", text: "resource text" });
    expect(search.providerId).toBe("mcp");
    expect(search.results[0]).toMatchObject({ title: "MCP Result", url: "https://example.com/mcp", snippet: "ora" });
  });
});
