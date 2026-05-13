import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { RuntimeToolExecutionContext } from "./runtime-tool-executor.js";
import type { ResolvedToolLimits } from "./runtime-tool-executor.js";
import type { RuntimeToolResultPreview } from "./runtime-tool-definition-v2.js";
import { readPositiveInt, requireWorkspaceRoot } from "./runtime-tool-utils.js";
import { prefersChinese, stringArg } from "./runtime-tool-approval.js";
import { getShellExecutionContext } from "./shell-snapshot.js";

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
  login: boolean;
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
      shell: result.shell,
      login: result.login,
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

interface ShellOutputAccumulator {
  content: string;
  keptBytes: number;
  truncated: boolean;
}

const UTF8_FATAL_DECODER = new TextDecoder("utf-8", { fatal: true });

function createShellOutputAccumulator(): ShellOutputAccumulator {
  return {
    content: "",
    keptBytes: 0,
    truncated: false,
  };
}

function shellOutputTruncationNotice(maxBytes: number): string {
  return `\n... [output truncated, exceeded ${formatShellOutputByteLimit(maxBytes)}]`;
}

function formatShellOutputByteLimit(maxBytes: number): string {
  if (maxBytes % (1024 * 1024) === 0) {
    return `${maxBytes / (1024 * 1024)}MB`;
  }
  if (maxBytes % 1024 === 0) {
    return `${maxBytes / 1024}KB`;
  }
  return `${maxBytes} bytes`;
}

function truncateUtf8Content(text: string, maxBytes: number): { content: string; bytes: number; truncated: boolean } {
  if (maxBytes <= 0 || text.length === 0) {
    return { content: "", bytes: 0, truncated: text.length > 0 };
  }
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= maxBytes) {
    return { content: text, bytes: encoded.length, truncated: false };
  }
  let end = Math.min(maxBytes, encoded.length);
  while (end > 0) {
    try {
      return {
        content: UTF8_FATAL_DECODER.decode(encoded.subarray(0, end)),
        bytes: end,
        truncated: true,
      };
    } catch {
      end -= 1;
    }
  }
  return { content: "", bytes: 0, truncated: true };
}

function appendShellStreamChunk(state: ShellOutputAccumulator, text: string, maxBytes: number): void {
  if (!text || state.truncated) {
    return;
  }
  const fullNotice = shellOutputTruncationNotice(maxBytes);
  const notice = truncateUtf8Content(fullNotice, maxBytes).content || fullNotice;
  const noticeBytes = Buffer.byteLength(notice);
  const contentBudget = Math.max(0, maxBytes - noticeBytes);
  const incomingBytes = Buffer.byteLength(text);
  if (state.keptBytes + incomingBytes <= maxBytes) {
    state.content += text;
    state.keptBytes += incomingBytes;
    return;
  }
  if (state.keptBytes > contentBudget) {
    const trimmed = truncateUtf8Content(state.content, contentBudget);
    state.content = trimmed.content;
    state.keptBytes = trimmed.bytes;
  }
  const remainingContentBytes = Math.max(0, contentBudget - state.keptBytes);
  if (remainingContentBytes > 0) {
    const limited = truncateUtf8Content(text, remainingContentBytes);
    state.content += limited.content;
    state.keptBytes += limited.bytes;
  }
  state.content += notice;
  state.truncated = true;
}

type ShellFlavor = "posix" | "powershell" | "cmd";

function quoteForPosixShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function readShellExecutableArg(args: Record<string, unknown>): string | undefined {
  const shell = typeof args.shell === "string" ? args.shell.trim() : "";
  return shell.length > 0 ? shell : undefined;
}

function readShellLoginArg(args: Record<string, unknown>): boolean {
  return args.login === true;
}

function detectShellFlavor(shell: string): ShellFlavor {
  const shellName = normalizeShellName(shell);
  if (shellName === "powershell" || shellName === "pwsh") {
    return "powershell";
  }
  if (shellName === "cmd" || shellName === "command") {
    return "cmd";
  }
  return "posix";
}

function normalizeShellName(shell: string): string {
  return path.basename(shell).toLowerCase().replace(/\.exe$/, "");
}

function shellBootstrapCommand(shell: string, login: boolean): string[] {
  if (!login) {
    return [];
  }
  switch (normalizeShellName(shell)) {
    case "zsh":
      return ["[ -f ~/.zshrc ] && . ~/.zshrc >/dev/null 2>&1 || true"];
    case "bash":
      return [
        "shopt -s expand_aliases",
        "[ -f ~/.bashrc ] && . ~/.bashrc >/dev/null 2>&1 || true",
      ];
    case "fish":
      return ["if test -f ~/.config/fish/config.fish; source ~/.config/fish/config.fish >/dev/null 2>&1; end"];
    default:
      return [];
  }
}

function prepareShellCommand(shell: string, command: string, login: boolean): string {
  const bootstrap = shellBootstrapCommand(shell, login);
  if (!login || bootstrap.length === 0) {
    return command;
  }
  return [...bootstrap, `eval -- ${quoteForPosixShell(command)}`].join("\n");
}

function buildShellArgs(shell: string, command: string, login: boolean): string[] {
  const preparedCommand = prepareShellCommand(shell, command, login);
  const flavor = detectShellFlavor(shell);
  if (flavor === "powershell") {
    return login ? ["-Login", "-Command", preparedCommand] : ["-Command", preparedCommand];
  }
  if (flavor === "cmd") {
    if (login) {
      throw new Error("shell.execute login=true is not supported for cmd.exe. Provide a POSIX shell or PowerShell via args.shell.");
    }
    return ["/d", "/s", "/c", preparedCommand];
  }
  return login ? ["-lc", preparedCommand] : ["-c", preparedCommand];
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
  const login = readShellLoginArg(args);
  const { env, shellPath } = await getShellExecutionContext();
  const shell = readShellExecutableArg(args) ?? (process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : shellPath);
  const shellArgs = buildShellArgs(shell, command, login);
  const startedAt = Date.now();
  const stdoutState = createShellOutputAccumulator();
  const stderrState = createShellOutputAccumulator();
  let fullOutput = "";
  let timedOut = false;
  let interrupted = false;

  return await new Promise((resolve, reject) => {
    const child = spawn(shell, shellArgs, {
      cwd: rootPath,
      env: process.platform === "win32" ? env : { ...env, SHELL: shell },
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
      appendShellStreamChunk(stream === "stdout" ? stdoutState : stderrState, text, limits.shellMaxOutputBytes);
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
      const truncated = stdoutState.truncated || stderrState.truncated;
      const fullOutputPath = truncated ? writeFullShellOutput(command, fullOutput) : undefined;
      const stdout = stdoutState.content;
      const stderr = timedOut
        ? [stderrState.content, `Command timed out after ${timeoutMs}ms.`].filter(Boolean).join("\n")
        : interrupted
          ? [stderrState.content, "Command interrupted by run cancellation."].filter(Boolean).join("\n")
          : stderrState.content;
      resolve({
        command,
        cwd: rootPath,
        shell,
        login,
        exitCode: effectiveCode,
        signal: signalVal ?? (interrupted ? "SIGTERM" : undefined),
        stdout,
        stderr,
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

function writeFullShellOutput(command: string, output: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-shell-output-"));
  const fullOutputPath = path.join(dir, "output.txt");
  fs.writeFileSync(fullOutputPath, [`$ ${command}`, output].join("\n"), "utf8");
  return fullOutputPath;
}

interface ShellToken {
  text: string;
  start: number;
  end: number;
  kind: "word" | "separator";
}

interface SourceRange {
  start: number;
  end: number;
}

function assertShellCommandStaysInWorkspace(rootPath: string, command: string): void {
  const ignoredRanges = collectShellScriptExpressionRanges(command);
  const absolutePathPattern = /(?:^|[\s"'(=])((?:\/(?!\/)[^\s"'`|;&<>)]+)+)/g;
  for (const match of command.matchAll(absolutePathPattern)) {
    const candidate = match[1];
    if (!candidate) {
      continue;
    }
    const candidateStart = match.index + match[0].lastIndexOf(candidate);
    const candidateEnd = candidateStart + candidate.length;
    if (sourceRangeContains(ignoredRanges, candidateStart, candidateEnd)) {
      continue;
    }
    const resolved = path.resolve(candidate);
    const relative = path.relative(rootPath, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("shell.execute command paths must stay inside the project root.");
    }
  }
}

function collectShellScriptExpressionRanges(command: string): SourceRange[] {
  const tokens = tokenizeShellCommand(command);
  const ranges: SourceRange[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.kind !== "word" || !isSedCommandName(token.text) || !isCommandPosition(tokens, index)) {
      continue;
    }
    collectSedExpressionRanges(tokens, index + 1, ranges);
  }
  return ranges;
}

function collectSedExpressionRanges(tokens: ShellToken[], startIndex: number, ranges: SourceRange[]): void {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.kind === "separator") {
      return;
    }
    if (token.text === "-e" || token.text === "--expression") {
      const expression = nextWordToken(tokens, index + 1);
      if (expression) {
        ranges.push({ start: expression.start, end: expression.end });
        index = tokens.indexOf(expression);
      }
      continue;
    }
    if (token.text === "-f" || token.text === "--file") {
      const scriptFile = nextWordToken(tokens, index + 1);
      if (scriptFile) {
        index = tokens.indexOf(scriptFile);
      }
      continue;
    }
    if (token.text.startsWith("-") && token.text !== "-") {
      continue;
    }
    ranges.push({ start: token.start, end: token.end });
    return;
  }
}

function tokenizeShellCommand(command: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let index = 0;
  while (index < command.length) {
    const char = command[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (isShellSeparator(char)) {
      const start = index;
      index += 1;
      if ((char === "&" || char === "|") && command[index] === char) {
        index += 1;
      }
      tokens.push({ text: command.slice(start, index), start, end: index, kind: "separator" });
      continue;
    }
    const start = index;
    let text = "";
    while (index < command.length) {
      const current = command[index];
      if (/\s/.test(current) || isShellSeparator(current)) {
        break;
      }
      if (current === "'" || current === '"') {
        const quote = current;
        index += 1;
        while (index < command.length && command[index] !== quote) {
          if (quote === '"' && command[index] === "\\" && index + 1 < command.length) {
            index += 1;
          }
          text += command[index];
          index += 1;
        }
        if (command[index] === quote) {
          index += 1;
        }
        continue;
      }
      if (current === "\\" && index + 1 < command.length) {
        index += 1;
        text += command[index];
        index += 1;
        continue;
      }
      text += current;
      index += 1;
    }
    tokens.push({ text, start, end: index, kind: "word" });
  }
  return tokens;
}

function isShellSeparator(char: string): boolean {
  return char === ";" || char === "|" || char === "&" || char === "\n" || char === "(" || char === ")";
}

function isSedCommandName(commandName: string): boolean {
  const name = path.basename(commandName);
  return name === "sed" || name === "gsed";
}

function isCommandPosition(tokens: ShellToken[], index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const token = tokens[cursor];
    if (!token) {
      continue;
    }
    if (token.kind === "separator") {
      return true;
    }
    return false;
  }
  return true;
}

function nextWordToken(tokens: ShellToken[], startIndex: number): ShellToken | undefined {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.kind === "separator") {
      return undefined;
    }
    if (token.kind === "word") {
      return token;
    }
  }
  return undefined;
}

function sourceRangeContains(ranges: SourceRange[], start: number, end: number): boolean {
  return ranges.some((range) => start >= range.start && end <= range.end);
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
