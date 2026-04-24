import {
  ActionRecord,
  ActionRecordSchema,
  ActionRiskLevel,
  AgentProfile,
  MemoryKind,
  MemoryRecord,
  MemoryRecordSchema,
  PatternDefinition,
  PlanItem,
  PlanItemSchema,
  PolicyDecision,
  PolicyDecisionSchema
} from "@ora/shared";

export class AgentProfileRegistry {
  constructor(private readonly definition: PatternDefinition) {}

  list(profileIds: string[] = []): AgentProfile[] {
    if (profileIds.length === 0) {
      return this.definition.profiles;
    }

    const wanted = new Set(profileIds);
    return this.definition.profiles.filter((profile) => wanted.has(profile.id));
  }
}

export class MemoryService {
  private readonly records: MemoryRecord[] = [];

  constructor(
    private readonly runId: string,
    private readonly clock: () => number
  ) {}

  remember(params: {
    id: string;
    namespace: string[];
    kind: MemoryKind;
    value: unknown;
    sourceActionId?: string;
  }): MemoryRecord {
    const now = this.clock();
    const record = MemoryRecordSchema.parse({
      id: `${this.runId}:memory:${params.id}`,
      namespace: params.namespace,
      kind: params.kind,
      value: params.value,
      sourceRunId: this.runId,
      sourceActionId: params.sourceActionId,
      createdAt: now,
      updatedAt: now
    });
    this.records.push(record);
    return record;
  }

  list(): MemoryRecord[] {
    return this.records;
  }
}

export class MemoryCaptureQueue {
  private readonly pending = new Map<string, {
    id: string;
    namespace: string[];
    kind: MemoryKind;
    value: unknown;
    sourceActionId?: string;
  }>();

  enqueue(params: {
    id: string;
    namespace: string[];
    kind: MemoryKind;
    value: unknown;
    sourceActionId?: string;
  }) {
    this.pending.set(params.id, params);
    return params;
  }

  flush(memoryService: MemoryService): MemoryRecord[] {
    const records = [...this.pending.values()].map((params) => memoryService.remember(params));
    this.pending.clear();
    return records;
  }

  size(): number {
    return this.pending.size;
  }
}

export class PlanService {
  private readonly items: PlanItem[];

  constructor(
    private readonly runId: string,
    definition: PatternDefinition
  ) {
    this.items = definition.planTemplate.map((item, index) =>
      PlanItemSchema.parse({
        id: `${runId}:${item.id}`,
        runId,
        ownerAgentId: item.ownerAgentId,
        status: index === 0 ? "ready" : "planned",
        title: item.title,
        dependencies: item.dependencies.map((dependency) => `${runId}:${dependency}`),
        linkedActionIds: [],
        checkpointIds: []
      })
    );
  }

  list(): PlanItem[] {
    return this.items;
  }

  firstItem(): PlanItem {
    const item = this.items[0];
    if (!item) {
      throw new Error("Pattern plan template must contain at least one item.");
    }
    return item;
  }

  linkAction(planItemId: string, actionId: string): PlanItem[] {
    this.update(planItemId, (item) => ({
      ...item,
      linkedActionIds: [...new Set([...item.linkedActionIds, actionId])]
    }));
    return this.items;
  }

  attachCheckpoint(checkpointId: string): PlanItem[] {
    for (const item of this.items) {
      item.checkpointIds = [...new Set([...item.checkpointIds, checkpointId])];
    }
    return this.items;
  }

  setStatus(planItemId: string, status: PlanItem["status"]): PlanItem[] {
    this.update(planItemId, (item) => ({
      ...item,
      status
    }));
    return this.items;
  }

  findByTemplateId(templateId: string): PlanItem | undefined {
    return this.items.find((item) => item.id === `${this.runId}:${templateId}`);
  }

  markAll(status: PlanItem["status"]): PlanItem[] {
    for (const item of this.items) {
      item.status = status;
    }
    return this.items;
  }

  markReadyByDependencies(): PlanItem[] {
    const done = new Set(this.items.filter((item) => item.status === "done").map((item) => item.id));
    for (const item of this.items) {
      if (
        item.status === "planned" &&
        item.dependencies.every((dependency) => done.has(dependency))
      ) {
        item.status = "ready";
      }
    }
    return this.items;
  }

  private update(planItemId: string, mapper: (item: PlanItem) => PlanItem): void {
    const index = this.items.findIndex((item) => item.id === planItemId);
    if (index < 0) {
      throw new Error(`Plan item not found: ${planItemId}`);
    }
    this.items[index] = PlanItemSchema.parse(mapper(this.items[index]!));
  }
}

export class PolicyService {
  constructor(
    private readonly runId: string,
    private readonly clock: () => number
  ) {}

  evaluate(action: ActionRecord): PolicyDecision {
    const requiredApproval = action.riskLevel === "high";
    return PolicyDecisionSchema.parse({
      id: `${action.id}:policy`,
      runId: this.runId,
      actionId: action.id,
      policyId: action.agentId
        ? `${action.agentId}.tool_policy`
        : "runtime.default_policy",
      requiredApproval,
      reason: requiredApproval
        ? "High-risk external effect must pass the Ora approval gate."
        : "Low and medium-risk deterministic actions may execute without pausing.",
      createdAt: this.clock()
    });
  }
}

export class ActionLedger {
  private readonly records: ActionRecord[] = [];

  constructor(private readonly runId: string) {}

  propose(params: {
    id: string;
    type: string;
    riskLevel: ActionRiskLevel;
    input: unknown;
    planItemId?: string;
    agentId?: string;
  }): ActionRecord {
    const record = ActionRecordSchema.parse({
      id: `${this.runId}:action:${params.id}`,
      runId: this.runId,
      planItemId: params.planItemId,
      agentId: params.agentId,
      type: params.type,
      riskLevel: params.riskLevel,
      status: "proposed",
      input: params.input,
      artifactIds: []
    });
    this.records.push(record);
    return record;
  }

  transition(
    actionId: string,
    status: ActionRecord["status"],
    patch: Partial<Pick<ActionRecord, "output" | "error" | "artifactIds">> = {}
  ): ActionRecord {
    const index = this.records.findIndex((record) => record.id === actionId);
    if (index < 0) {
      throw new Error(`Action not found: ${actionId}`);
    }

    const current = this.records[index]!;
    const next = ActionRecordSchema.parse({
      ...current,
      ...patch,
      artifactIds: patch.artifactIds ?? current.artifactIds,
      status
    });
    this.records[index] = next;
    return next;
  }

  list(): ActionRecord[] {
    return this.records;
  }
}
