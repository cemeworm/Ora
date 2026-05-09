import * as fs from "node:fs";
import * as path from "node:path";

const MAX_SIZE = 512 * 1024; // 512KB
const LOG_DIR = path.join(process.cwd(), ".ora", "logs");
const LOG_PATH = path.join(LOG_DIR, "latency.log");

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_PATH)) return;
    if (fs.statSync(LOG_PATH).size <= MAX_SIZE) return;
    const content = fs.readFileSync(LOG_PATH, "utf-8");
    const trimmed = content.slice(-100 * 1024);
    fs.writeFileSync(
      LOG_PATH,
      `...truncated at ${new Date().toISOString()}\n${trimmed}`,
      "utf-8",
    );
  } catch {
    // best-effort
  }
}

export function logLatency(label: string, elapsed: number): void {
  ensureDir();
  rotateIfNeeded();
  const line = `${new Date().toISOString()} [latency] ${label}: ${elapsed}ms\n`;
  fs.appendFileSync(LOG_PATH, line, "utf-8");
}
