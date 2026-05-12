import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { RuntimeToolExecutionContext } from "./runtime-tool-executor.js";
import type { ResolvedToolLimits } from "./runtime-tool-executor.js";
import type { RuntimeToolResultPreview } from "./runtime-tool-definition-v2.js";
import { readPositiveInt, requireWorkspaceRoot, truncateText } from "./runtime-tool-utils.js";
import { prefersChinese, stringArg } from "./runtime-tool-approval.js";

export function shellToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  if (toolId !== "shell.execute") {
    return {};
  }
  return {
    promptExample: "{\"tool\":\"shell.execute\",\"args\":{\"command\":\"pnpm --filter @ora/runtime test\"}}",
    requiresApprovalCopy: true,
    actionRiskLevel: () => "high",
    approvalRequest: shellApprovalRequest,
    execute: async (args, context) => ({ output: await executeWorkspaceShell(requireWorkspaceRoot(context.workspace), args, context.limits, context.signal) }),
    resultPreview: (result) => shellResultPreview((result as { output: ShellExecuteResult }).output),
  };
}

function shellApprovalRequest(args: Record<string, unknown>, context: { userPrompt?: string }) {
  const zh = prefersChinese(context.userPrompt);
  const command = stringArg(args, "command", zh ? "这条命令" : "this command");
  return zh
    ? {
        title: "需要你确认运行命令",
        summary: `我准备在项目文件夹中运行：${command}`,
        whatWillChange: "命令可能读取或修改本地项目，具体取决于命令内容。",
        whyNeeded: "这是完成当前任务所需的本地执行步骤。",
        riskNote: "请确认这条命令符合你的预期，再允许 Ora 继续。",
        confirmLabel: "批准并继续",
      }
    : {
        title: "Confirm command execution",
        summary: `I am ready to run this command in the project folder: ${command}`,
        whatWillChange: "The command may read or modify local project files depending on what it does.",
        whyNeeded: "This local execution step is needed to continue the task.",
        riskNote: "Confirm the command matches your expectations before allowing Ora to continue.",
        confirmLabel: "Approve and continue",
      };
}

export interface ShellExecuteResult {
  command: string;
  cwd: string;
  shell: string;
  exitCode: number;
  signal?: string;
  stdout: string;
  stderr: string;
  output: string;
  truncated: boolean;
  fullOutputPath?: string;
  durationMs: number;
  interrupted?: boolean;
}

function shellResultPreview(result: ShellExecuteResult): RuntimeToolResultPreview {
  return {
    kind: "shell.execute",
    summary: `exit ${result.exitCode}${result.interrupted ? " (interrupted)" : ""} — ${result.durationMs}ms`,
    detail: {
      command: result.command,
      cwd: result.cwd,
      exitCode: result.exitCode,
      signal: result.signal,
      truncated: result.truncated,
      durationMs: result.durationMs,
      interrupted: result.interrupted,
    },
    preview: {
      stdout: result.stdout.slice(0, 2000),
      stderr: result.stderr.slice(0, 2000),
    },
  };
}

export async function executeWorkspaceShell(
  rootPath: string,
  args: Record<string, unknown>,
  limits: ResolvedToolLimits,
  signal?: AbortSignal,
): Promise<ShellExecuteResult> {
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command) {
    throw new Error("shell.execute requires a non-empty command.");
  }
  assertShellCommandStaysInWorkspace(rootPath, command);
  const timeoutMs = readPositiveInt(args.timeoutMs, limits.shellTimeoutMs, limits.shellTimeoutMs);
  const shell = process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : (process.env.SHELL ?? "/bin/sh");
  const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let fullOutput = "";
  let truncated = false;
  let timedOut = false;
  let interrupted = false;

  return await new Promise((resolve, reject) => {
    const child = spawn(shell, shellArgs, {
      cwd: rootPath,
      env: sanitizeShellEnvironment(process.env),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    const onAbort = () => {
      interrupted = true;
      killProcessTree(child);
    };
    if (signal) {
      if (signal.aborted) {
        interrupted = true;
        killProcessTree(child);
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const appendOutput = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      fullOutput += text;
      const currentBytes = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
      const remainingBytes = Math.max(0, limits.shellMaxOutputBytes - currentBytes);
      if (remainingBytes <= 0) {
        truncated = true;
        return;
      }
      const limited = truncateText(text, remainingBytes);
      truncated = truncated || limited.truncated;
      if (stream === "stdout") {
        stdout += limited.content;
      } else {
        stderr += limited.content;
      }
    };

    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code, signalVal) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      const effectiveCode = timedOut ? 124 : interrupted ? 130 : code ?? 1;
      const fullOutputPath = truncated ? writeFullShellOutput(command, fullOutput) : undefined;
      resolve({
        command,
        cwd: rootPath,
        shell,
        exitCode: effectiveCode,
        signal: signalVal ?? (interrupted ? "SIGTERM" : undefined),
        stdout,
        stderr: timedOut
          ? [stderr, `Command timed out after ${timeoutMs}ms.`].filter(Boolean).join("\n")
          : interrupted
            ? [stderr, "Command interrupted by run cancellation."].filter(Boolean).join("\n")
            : stderr,
        output: stdout || stderr,
        truncated,
        fullOutputPath,
        durationMs: Date.now() - startedAt,
        interrupted,
      });
    });
  });
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill("SIGTERM");
    return;
  }
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    child.kill("SIGTERM");
  }
}

function sanitizeShellEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowedKeys = new Set(["HOME", "LANG", "LC_ALL", "PATH", "PWD", "SHELL", "TERM", "TMPDIR", "USER"]);
  const next: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    const value = env[key];
    if (value !== undefined) {
      next[key] = value;
    }
  }
  if (!next.PATH) {
    next.PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }
  return next;
}

function writeFullShellOutput(command: string, output: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-shell-output-"));
  const fullOutputPath = path.join(dir, "output.txt");
  fs.writeFileSync(fullOutputPath, [`$ ${command}`, output].join("\n"), "utf8");
  return fullOutputPath;
}

function assertShellCommandStaysInWorkspace(rootPath: string, command: string): void {
  const absolutePathPattern = /(?:^|[\s"'(=])((?:\/(?!\/)[^\s"'`|;&<>)]+)+)/g;
  for (const match of command.matchAll(absolutePathPattern)) {
    const candidate = match[1];
    if (!candidate) {
      continue;
    }
    const resolved = path.resolve(candidate);
    const relative = path.relative(rootPath, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("shell.execute command paths must stay inside the project root.");
    }
  }
}

export function shellCommandRequiresHighRisk(args: Record<string, unknown>): boolean {
  const command = typeof args.command === "string" ? args.command.trim().toLowerCase() : "";
  if (!command) {
    return true;
  }
  return /(^|\s)rm\s+[^&|;\n]*-[^\n]*r/.test(command)
    || /(^|\s)git\s+reset\s+--hard\b/.test(command)
    || /(^|\s)git\s+clean\s+-[^\n]*[fd]/.test(command)
    || /(^|\s)git\s+push\b[^\n]*(--force|-f)\b/.test(command)
    || /\bdrop\s+database\b/.test(command)
    || /(^|\s)kubectl\s+delete\b/.test(command)
    || /(^|\s)chmod\s+-r\s+777\b/.test(command);
}
