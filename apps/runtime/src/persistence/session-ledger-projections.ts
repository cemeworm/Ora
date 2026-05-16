import {
  deriveRunSnapshot,
  deriveSessionProjection,
  type RuntimeSessionLedger,
  type RuntimeSessionProjection,
} from "@cemeworm/shared";
import type { RuntimeRunReadModel, RuntimeSessionReadModel } from "./types.js";

/**
 * 投影缓存，key = sessionId:leafEntryId。
 * leafEntryId 不变时投影结果相同，跳过全量 replay。
 * 简单 Map 实现，对于 session 数量不大的 solo-developer 场景足够。
 */
const projectionCache = new Map<string, RuntimeSessionProjection>();
const MAX_CACHE_SIZE = 512;

function cacheKey(ledger: RuntimeSessionLedger): string {
  return `${ledger.sessionId}:${ledger.leafEntryId ?? "nil"}`;
}

function cachedProjection(ledger: RuntimeSessionLedger): RuntimeSessionProjection {
  const key = cacheKey(ledger);
  const cached = projectionCache.get(key);
  if (cached) return cached;
  const projection = deriveSessionProjection(ledger);
  if (projectionCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = projectionCache.keys().next().value;
    if (oldestKey !== undefined) projectionCache.delete(oldestKey);
  }
  projectionCache.set(key, projection);
  return projection;
}

export function deriveRuntimeReadModelsFromLedgers(ledgers: RuntimeSessionLedger[]): {
  runs: RuntimeRunReadModel[];
  sessions: RuntimeSessionReadModel[];
} {
  const sessions: RuntimeSessionReadModel[] = [];
  const runs: RuntimeRunReadModel[] = [];
  for (const ledger of ledgers) {
    const projection = cachedProjection(ledger);
    sessions.push(projection.session);
    for (const run of projection.runs) {
      const snapshot = deriveRunSnapshot(ledger, run.runId, undefined, projection);
      if (snapshot) {
        runs.push(snapshot);
      }
    }
  }
  return {
    runs: runs.sort((a, b) => a.runId.localeCompare(b.runId)),
    sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId)),
  };
}

export function deriveRuntimeSessionReadModelsFromLedgers(ledgers: RuntimeSessionLedger[]): RuntimeSessionReadModel[] {
  return ledgers
    .map((ledger) => cachedProjection(ledger).session)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
}

/** 写入新 entry 后使缓存失效 */
export function invalidateProjectionCache(sessionId: string): void {
  for (const key of projectionCache.keys()) {
    if (key.startsWith(`${sessionId}:`)) projectionCache.delete(key);
  }
}

/**
 * 预热投影缓存（进程启动 / load 时调用）。
 * 批量预计算所有 session 的投影，后续 API 读取直接命中缓存。
 * 非阻塞：可改为异步，但当前 ledger 数量通常 <1000，同步预热足够。
 */
export function warmProjectionCache(ledgers: RuntimeSessionLedger[]): void {
  for (const ledger of ledgers) {
    cachedProjection(ledger);
  }
}

/** 清空全部缓存（测试 / 重置场景） */
export function clearProjectionCache(): void {
  projectionCache.clear();
}
