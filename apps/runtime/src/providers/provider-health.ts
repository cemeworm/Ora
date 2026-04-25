import type { ModelResponse } from "./types.js";

export interface ProviderHealthGuardOptions {
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
  clock?: () => number;
}

interface ProviderHealthState {
  failureCount: number;
  state: "closed" | "open" | "half_open";
  openUntil: number;
  probeInFlight: boolean;
  lastError?: string;
}

const TRANSIENT_PATTERNS = [
  "408",
  "409",
  "425",
  "429",
  "500",
  "502",
  "503",
  "504",
  "timeout",
  "timed out",
  "connection",
  "server busy",
  "temporarily unavailable",
  "try again later",
  "please retry",
  "overloaded",
  "rate limit",
  "服务繁忙",
  "稍后重试",
] as const;

const HARD_FAILURE_PATTERNS = [
  "api key",
  "authentication",
  "unauthorized",
  "forbidden",
  "access denied",
  "permission",
  "quota",
  "billing",
  "credit",
  "payment",
  "余额不足",
  "额度不足",
] as const;

export class ProviderCircuitOpenError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly retryAfterMs: number,
    public readonly lastError?: string,
  ) {
    super(
      `Provider circuit breaker open for ${providerId}: provider is temporarily unavailable due to continuous failures.`
      + ` Retry after ${Math.max(0, retryAfterMs)}ms.`
      + (lastError ? ` Last error: ${lastError}` : ""),
    );
    this.name = "ProviderCircuitOpenError";
  }
}

export class ProviderHealthGuard {
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly clock: () => number;
  private readonly states = new Map<string, ProviderHealthState>();

  constructor(options: ProviderHealthGuardOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 60_000;
    this.clock = options.clock ?? Date.now;
  }

  async run<T extends ModelResponse>(
    providerId: string,
    invoke: () => Promise<T>,
  ): Promise<T> {
    this.assertAvailable(providerId);
    try {
      const result = await invoke();
      this.recordSuccess(providerId);
      return result;
    } catch (error) {
      this.recordFailure(providerId, error);
      throw error;
    }
  }

  snapshot(providerId: string): ProviderHealthState | undefined {
    const state = this.states.get(providerId);
    return state ? { ...state } : undefined;
  }

  reset(providerId?: string): void {
    if (providerId) {
      this.states.delete(providerId);
      return;
    }
    this.states.clear();
  }

  private assertAvailable(providerId: string): void {
    const state = this.stateFor(providerId);
    if (state.state === "half_open") {
      throw new ProviderCircuitOpenError(providerId, 0, state.lastError);
    }
    if (state.state !== "open") {
      return;
    }

    const now = this.clock();
    if (now < state.openUntil) {
      throw new ProviderCircuitOpenError(providerId, state.openUntil - now, state.lastError);
    }

    state.state = "half_open";
    state.probeInFlight = true;
  }

  private recordSuccess(providerId: string): void {
    const state = this.stateFor(providerId);
    state.failureCount = 0;
    state.state = "closed";
    state.openUntil = 0;
    state.probeInFlight = false;
    state.lastError = undefined;
  }

  private recordFailure(providerId: string, error: unknown): void {
    const state = this.stateFor(providerId);
    const detail = errorDetail(error);
    if (!isTransientProviderFailure(detail)) {
      if (state.state === "half_open") {
        state.state = "open";
        state.openUntil = this.clock() + this.recoveryTimeoutMs;
        state.probeInFlight = false;
        state.lastError = detail;
      }
      return;
    }

    state.lastError = detail;
    if (state.state === "half_open") {
      state.state = "open";
      state.openUntil = this.clock() + this.recoveryTimeoutMs;
      state.probeInFlight = false;
      return;
    }

    state.failureCount += 1;
    if (state.failureCount >= this.failureThreshold) {
      state.state = "open";
      state.openUntil = this.clock() + this.recoveryTimeoutMs;
      state.probeInFlight = false;
    }
  }

  private stateFor(providerId: string): ProviderHealthState {
    const existing = this.states.get(providerId);
    if (existing) {
      return existing;
    }
    const state: ProviderHealthState = {
      failureCount: 0,
      state: "closed",
      openUntil: 0,
      probeInFlight: false,
    };
    this.states.set(providerId, state);
    return state;
  }
}

export function isTransientProviderFailure(detail: string): boolean {
  const lowered = detail.toLowerCase();
  if (HARD_FAILURE_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return false;
  }
  return TRANSIENT_PATTERNS.some((pattern) => lowered.includes(pattern));
}

export function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  const detail = String(error).trim();
  return detail || "Unknown provider error";
}

export const defaultProviderHealthGuard = new ProviderHealthGuard();
