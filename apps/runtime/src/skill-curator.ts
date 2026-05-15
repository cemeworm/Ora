import type { SkillDescriptor } from "@cemeworm/shared";

export interface SkillCuratorConfig {
  staleThresholdMs: number;
  archivedThresholdMs: number;
  enabled: boolean;
}

export const DEFAULT_CURATOR_CONFIG: SkillCuratorConfig = {
  staleThresholdMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  archivedThresholdMs: 90 * 24 * 60 * 60 * 1000, // 90 days
  enabled: true,
};

export interface CuratorTransition {
  name: string;
  from: "active" | "stale" | "archived";
  to: "active" | "stale" | "archived";
}

export class SkillCurator {
  private readonly config: SkillCuratorConfig;
  private readonly applyTransition: (name: string, lifecycle: "active" | "stale" | "archived") => void;
  private readonly clock: () => number;

  constructor(options: {
    config?: Partial<SkillCuratorConfig>;
    applyTransition: (name: string, lifecycle: "active" | "stale" | "archived") => void;
    clock?: () => number;
  }) {
    this.config = { ...DEFAULT_CURATOR_CONFIG, ...options.config };
    this.applyTransition = options.applyTransition;
    this.clock = options.clock ?? Date.now;
  }

  evaluate(skills: SkillDescriptor[]): CuratorTransition[] {
    if (!this.config.enabled) {
      return [];
    }

    const now = this.clock();
    const transitions: CuratorTransition[] = [];

    for (const skill of skills) {
      if (skill.provenance !== "background_auto") {
        continue;
      }

      const lifecycle = skill.lifecycle ?? "active";
      if (lifecycle === "archived") {
        continue;
      }

      const lastUsedAt = skill.telemetry?.lastUsedAt ?? skill.updatedAt ?? skill.createdAt ?? 0;
      const age = now - lastUsedAt;

      if (age >= this.config.archivedThresholdMs && lifecycle === "stale") {
        transitions.push({ name: skill.name, from: lifecycle, to: "archived" });
      } else if (age >= this.config.staleThresholdMs && lifecycle === "active") {
        transitions.push({ name: skill.name, from: lifecycle, to: "stale" });
      }
    }

    return transitions;
  }

  applyTransitions(transitions: CuratorTransition[]): void {
    for (const transition of transitions) {
      this.applyTransition(transition.name, transition.to);
    }
  }
}
