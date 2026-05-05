import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function defaultRuntimeStoreDir(): string {
  return fileURLToPath(pathToFileURL(path.join(process.cwd(), ".ora", "runtime.db")));
}

export function defaultEvaluationStoreDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "evaluation-store")
    : path.join(runtimeDataDir, "evaluation-store");
}

export function defaultFeedbackLoopStoreDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "feedback-loop-store")
    : path.join(runtimeDataDir, "feedback-loop-store");
}

export function defaultSelfIterationStoreDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "self-iteration-store")
    : path.join(runtimeDataDir, "self-iteration-store");
}

export function defaultAutomationsDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "automations")
    : path.join(runtimeDataDir, "automations");
}

export function defaultCustomAgentsDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "agents")
    : path.join(runtimeDataDir, "agents");
}

export function defaultSystemAgentOverridesDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "agent-overrides")
    : path.join(runtimeDataDir, "agent-overrides");
}

export function defaultModesDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "modes")
    : path.join(runtimeDataDir, "modes");
}

export function defaultSkillsDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "skills", "private")
    : path.join(runtimeDataDir, "skills", "private");
}

export function defaultPublicSkillsDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "skills", "public")
    : path.join(runtimeDataDir, "skills", "public");
}

export function defaultMemoryDir(runtimeDataDir: string): string {
  return runtimeDataDir.endsWith(".db")
    ? path.join(path.dirname(runtimeDataDir), "memory")
    : path.join(runtimeDataDir, "memory");
}

export function defaultBundledSkillsDir(): string {
  const cwdBased = path.join(process.cwd(), "skills");
  if (fs.existsSync(cwdBased)) return cwdBased;
  // Fallback: walk up to repo root (dev / test environments)
  let current = process.cwd();
  while (true) {
    const candidate = path.join(current, "skills");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return cwdBased;
}
