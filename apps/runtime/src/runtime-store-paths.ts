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
