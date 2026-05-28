import { runStdioServer } from "./stdio.js";
import { LocalRunStore } from "./run-store.js";
import { shutdownLangfuseTelemetry } from "./telemetry/langfuse.js";
import { warmShellSnapshot } from "./harness/shell-snapshot.js";
import fs from "node:fs";
import path from "node:path";

// Redirect console.log/info/warn to stderr so they don't corrupt the JSON-RPC protocol on stdout
console.log = console.error;
console.info = console.error;
console.warn = console.error;

void warmShellSnapshot().catch((error) => {
  process.stderr.write(`[ShellSnapshot] warmup failed: ${error instanceof Error ? error.message : String(error)}\n`);
});

installHostProcessWatchdog();

async function runChannelDaemon(): Promise<void> {
  const lock = acquireChannelDaemonLock();
  const keepAlive = setInterval(() => undefined, 60_000);
  new LocalRunStore({
    autoStartChannels: true,
    autoStartAutomations: true,
    onChannelSessionUpdate(event) {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        method: "channels.sessionUpdated",
        params: event,
      })}\n`);
    },
  });
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  clearInterval(keepAlive);
  lock.release();
  await shutdownLangfuseTelemetry();
}

function installHostProcessWatchdog(): void {
  const rawPid = process.env.ORA_RUNTIME_HOST_PID;
  if (!rawPid) {
    return;
  }
  const hostPid = Number(rawPid);
  if (!Number.isInteger(hostPid) || hostPid <= 0 || hostPid === process.pid) {
    return;
  }
  const timer = setInterval(() => {
    if (!processIsAlive(hostPid)) {
      process.stderr.write(`[RuntimeSidecar] host process ${hostPid} is gone; exiting sidecar ${process.pid}\n`);
      process.exit(0);
    }
  }, 5_000);
  timer.unref();
}

function acquireChannelDaemonLock(): { release: () => void } {
  const dataDir = process.env.ORA_RUNTIME_STORE_DIR ?? path.join(process.cwd(), ".ora", "runtime.db");
  const lockDir = dataDir.endsWith(".db") ? path.dirname(dataDir) : dataDir;
  const lockPath = path.join(lockDir, "channel-daemon.lock");
  fs.mkdirSync(lockDir, { recursive: true });

  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
    fs.closeSync(fd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const existingPid = readLockPid(lockPath);
    if (existingPid && processIsAlive(existingPid)) {
      process.stderr.write(`[ChannelDaemon] another daemon is already running for ${dataDir} (pid ${existingPid}); exiting\n`);
      process.exit(0);
    }
    fs.rmSync(lockPath, { force: true });
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
    fs.closeSync(fd);
  }

  const release = () => {
    const existingPid = readLockPid(lockPath);
    if (existingPid === process.pid) {
      fs.rmSync(lockPath, { force: true });
    }
  };
  process.once("exit", release);
  return { release };
}

function readLockPid(lockPath: string): number | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid?: unknown };
    return typeof raw.pid === "number" && Number.isInteger(raw.pid) ? raw.pid : undefined;
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const entrypoint = process.argv.includes("--channel-daemon")
  ? runChannelDaemon
  : runStdioServer;

entrypoint().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
