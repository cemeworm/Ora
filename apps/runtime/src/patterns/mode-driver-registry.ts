import {
  CoordinationPatternSchema,
  type CoordinationPattern,
  type ModeSpec,
  type PatternDefinition,
  type RunConfig,
} from "@cemeworm/shared";
import type { PatternExecutionContext, PatternExecutionResult } from "./execution-context.js";

export interface ModeExecutionInput {
  context: PatternExecutionContext;
  prompt: string;
  config: RunConfig;
  modeSpec: ModeSpec;
  definition: PatternDefinition;
}

export type ModeDriverExecutor = (input: ModeExecutionInput) => Promise<PatternExecutionResult>;
export type BuiltInModeDriverExecutors = Record<CoordinationPattern, ModeDriverExecutor>;

export class ModeDriverRegistry {
  private readonly executors = new Map<CoordinationPattern, ModeDriverExecutor>();

  register(family: CoordinationPattern, executor: ModeDriverExecutor): this {
    if (this.executors.has(family)) {
      throw new Error(`Mode driver already registered for family "${family}"`);
    }
    this.executors.set(family, executor);
    return this;
  }

  execute(input: ModeExecutionInput): Promise<PatternExecutionResult> {
    const executor = this.executors.get(input.modeSpec.family);
    if (!executor) {
      throw new Error(`No mode driver registered for family "${input.modeSpec.family}"`);
    }
    return executor(input);
  }

  assertCoversBuiltInFamilies(): void {
    const missing = CoordinationPatternSchema.options.filter((family) => !this.executors.has(family));
    if (missing.length > 0) {
      throw new Error(`Missing built-in mode driver registrations: ${missing.join(", ")}`);
    }
  }
}

export function createBuiltInModeDriverRegistry(executors: BuiltInModeDriverExecutors): ModeDriverRegistry {
  const registry = new ModeDriverRegistry();
  for (const family of CoordinationPatternSchema.options) {
    registry.register(family, executors[family]);
  }
  registry.assertCoversBuiltInFamilies();
  return registry;
}
