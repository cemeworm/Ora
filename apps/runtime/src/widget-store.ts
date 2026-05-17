import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  WidgetCreateParamsSchema,
  WidgetIdParamsSchema,
  WidgetListParamsSchema,
  WidgetUpdateParamsSchema,
  WidgetVersionListParamsSchema,
  WidgetVersionRestoreParamsSchema,
  WidgetSchema,
  WidgetVersionSchema,
  defaultWidgetState,
  type Widget,
  type WidgetKind,
  type WidgetListParams,
  type WidgetManifest,
  type WidgetStatus,
  type WidgetVersion,
  type WidgetVersionRestoreParams,
} from "@cemeworm/shared";

type WidgetLifecycleEvent = {
  widgetId: string;
  event: "created" | "updated" | "archived" | "restored" | "deleted" | "pinned" | "unpinned" | "error";
  at: number;
  detail: string;
};

type WidgetStoreFile = {
  version: 2;
  widgets: Widget[];
  versions: WidgetVersion[];
  events: WidgetLifecycleEvent[];
};

const MAX_EVENTS = 1000;
const MAX_VERSIONS_PER_WIDGET = 50;
const STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export interface WidgetStoreDeps {
  rootDir: string;
  clock?: () => number;
}

export class WidgetStore {
  private readonly storePath: string;
  private readonly eventsPath: string;
  private readonly clock: () => number;
  private widgets: Widget[] = [];
  private versions: WidgetVersion[] = [];
  private events: WidgetLifecycleEvent[] = [];

  constructor(private readonly deps: WidgetStoreDeps) {
    this.storePath = path.join(deps.rootDir, "widgets.json");
    this.eventsPath = path.join(deps.rootDir, "widgets-events.jsonl");
    this.clock = deps.clock ?? Date.now;
    const data = this.load();
    this.widgets = data.widgets;
    this.versions = data.versions;
    this.events = this.loadEvents(data.events);
  }

  // === Persistence ===

  private load(): WidgetStoreFile {
    try {
      const raw = fs.readFileSync(this.storePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.version === 1 || parsed.version === 2)) {
        return {
          version: 2 as const,
          widgets: (parsed.widgets || []).map((w: unknown) => WidgetSchema.parse(w)),
          versions: (parsed.versions || []).map((v: unknown) => WidgetVersionSchema.parse(v)),
          events: parsed.events || [],
        };
      }
    } catch {
      // First run or corrupt file — start fresh
    }
    return { version: 2, widgets: [], versions: [], events: [] };
  }

  private loadEvents(oldEvents: WidgetLifecycleEvent[]): WidgetLifecycleEvent[] {
    try {
      const raw = fs.readFileSync(this.eventsPath, "utf-8");
      return raw
        .trim()
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as WidgetLifecycleEvent)
        .slice(-MAX_EVENTS);
    } catch {
      // Migrate events from legacy widgets.json
      if (oldEvents.length > 0) {
        const toKeep = oldEvents.slice(-MAX_EVENTS);
        const dir = path.dirname(this.eventsPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(
          this.eventsPath,
          toKeep.map((e) => JSON.stringify(e)).join("\n") + "\n",
          "utf-8",
        );
        return toKeep;
      }
      return [];
    }
  }

  private save(): void {
    // Cap versions per widget (keep most recent)
    const versionCounts = new Map<string, number>();
    const keptVersions: WidgetVersion[] = [];
    for (let i = this.versions.length - 1; i >= 0; i--) {
      const v = this.versions[i];
      const count = versionCounts.get(v.widgetId) || 0;
      if (count < MAX_VERSIONS_PER_WIDGET) {
        keptVersions.unshift(v);
        versionCounts.set(v.widgetId, count + 1);
      }
    }
    this.versions = keptVersions;

    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const file: WidgetStoreFile = {
      version: 2,
      widgets: this.widgets,
      versions: this.versions,
      events: [],
    };
    const tmpPath = this.storePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.storePath);
  }

  private recordEvent(widgetId: string, event: WidgetLifecycleEvent["event"], detail: string): void {
    const entry: WidgetLifecycleEvent = { widgetId, event, at: this.clock(), detail };
    this.events.push(entry);
    if (this.events.length > MAX_EVENTS * 2) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
    const dir = path.dirname(this.eventsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(this.eventsPath, JSON.stringify(entry) + "\n", "utf-8");
  }

  // === Widget CRUD ===

  list(params?: WidgetListParams): Widget[] {
    let result = [...this.widgets];
    if (params?.workspaceId) {
      result = result.filter((w) => w.workspaceId === params.workspaceId);
    }
    if (params?.kind) {
      result = result.filter((w) => w.kind === params.kind);
    }
    if (!params?.includeArchived) {
      result = result.filter((w) => w.status !== "archived");
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Widget | undefined {
    return this.widgets.find((w) => w.id === id);
  }

  create(params: unknown): Widget {
    const parsed = WidgetCreateParamsSchema.parse(params);
    const now = this.clock();
    const id = randomUUID();
    const versionId = randomUUID();
    const state = parsed.state ?? defaultWidgetState(parsed.kind);

    const manifest: WidgetManifest = {
      id,
      workspaceId: parsed.workspaceId,
      title: parsed.title,
      kind: parsed.kind,
      status: "active",
      layout: parsed.layout ?? { x: 0, y: 0, w: 2, h: 2, pinned: false },
      manifestVersion: 1,
      dataSource: parsed.dataSource,
      actions: parsed.actions,
      schedule: parsed.schedule,
      permissions: parsed.permissions,
      artifactIds: [],
      automationIds: [],
      builderSessionId: parsed.builderSessionId,
      builderSkillId: parsed.builderSkillId,
      componentSkillId: parsed.componentSkillId,
      currentVersionId: versionId,
      createdAt: now,
      updatedAt: now,
    };

    const widget: Widget = {
      ...manifest,
      state,
      currentVersionId: versionId,
    };

    const version: WidgetVersion = {
      id: versionId,
      widgetId: id,
      version: 1,
      createdAt: now,
      summary: `Created widget "${parsed.title}"`,
      changeReason: "initial creation",
      manifestSnapshot: manifest,
      layoutSnapshot: manifest.layout,
      stateSchemaSnapshot: {},
      automationBindingSnapshot: {},
      componentSkillId: parsed.componentSkillId,
      skillContentHash: undefined,
      migrationNote: "",
    };

    this.widgets.push(widget);
    this.versions.push(version);
    this.recordEvent(id, "created", `Widget "${parsed.title}" (${parsed.kind}) created`);
    this.save();
    return widget;
  }

  /** Check if a similar widget already exists to prevent duplicates */
  findDuplicate(title: string, kind?: WidgetKind): Widget | undefined {
    const normalizedTitle = title.trim().toLowerCase();
    return this.widgets.find(
      (w) =>
        w.status !== "archived" &&
        w.title.trim().toLowerCase() === normalizedTitle &&
        (!kind || w.kind === kind),
    );
  }

  update(params: unknown, createVersion = false, changeReason = ""): Widget {
    const parsed = WidgetUpdateParamsSchema.parse(params);
    const idx = this.widgets.findIndex((w) => w.id === parsed.id);
    if (idx === -1) {
      throw new Error(`Widget not found: ${parsed.id}`);
    }

    const existing = this.widgets[idx];
    const now = this.clock();
    const isStructural =
      createVersion ||
      parsed.title !== undefined ||
      parsed.layout !== undefined ||
      parsed.dataSource !== undefined ||
      parsed.schedule !== undefined ||
      parsed.permissions !== undefined ||
      parsed.actions !== undefined ||
      parsed.componentSkillId !== undefined;

    const updated: Widget = {
      ...existing,
      title: parsed.title ?? existing.title,
      status: parsed.status ?? existing.status,
      layout: parsed.layout ?? existing.layout,
      dataSource: "dataSource" in parsed ? (parsed.dataSource ?? undefined) : existing.dataSource,
      actions: parsed.actions ?? existing.actions,
      schedule: "schedule" in parsed ? (parsed.schedule ?? undefined) : existing.schedule,
      permissions: parsed.permissions ?? existing.permissions,
      state: parsed.state ?? existing.state,
      componentSkillId: "componentSkillId" in parsed ? (parsed.componentSkillId ?? undefined) : existing.componentSkillId,
      manifestVersion: isStructural ? existing.manifestVersion + 1 : existing.manifestVersion,
      updatedAt: now,
    };

    // If structural change, create a new version
    if (isStructural) {
      const versionId = randomUUID();
      const manifestSnapshot: WidgetManifest = {
        id: updated.id,
        workspaceId: updated.workspaceId,
        title: updated.title,
        kind: updated.kind,
        status: updated.status,
        layout: updated.layout,
        manifestVersion: updated.manifestVersion,
        dataSource: updated.dataSource,
        actions: updated.actions,
        schedule: updated.schedule,
        permissions: updated.permissions,
        artifactIds: updated.artifactIds,
        automationIds: updated.automationIds,
        builderSessionId: updated.builderSessionId,
        builderSkillId: updated.builderSkillId,
        componentSkillId: updated.componentSkillId,
        currentVersionId: versionId,
        createdAt: updated.createdAt,
        updatedAt: now,
      };

      const version: WidgetVersion = {
        id: versionId,
        widgetId: updated.id,
        version: this.getLatestVersionNumber(existing.id) + 1,
        createdAt: now,
        summary: `Updated widget "${updated.title}"`,
        changeReason: changeReason || "structural update",
        manifestSnapshot,
        layoutSnapshot: updated.layout,
        stateSchemaSnapshot: {},
        automationBindingSnapshot: {},
        componentSkillId: updated.componentSkillId,
        skillContentHash: undefined,
        migrationNote: "",
      };

      updated.currentVersionId = versionId;
      this.versions.push(version);
    }

    this.widgets[idx] = updated;
    this.recordEvent(parsed.id, "updated", `Widget "${updated.title}" updated`);
    if (updated.status === "error") {
      this.recordEvent(parsed.id, "error", `Widget "${updated.title}" entered error state`);
    }
    this.save();
    return updated;
  }

  archive(id: string): Widget {
    const idx = this.widgets.findIndex((w) => w.id === id);
    if (idx === -1) {
      throw new Error(`Widget not found: ${id}`);
    }
    this.widgets[idx] = {
      ...this.widgets[idx],
      status: "archived",
      updatedAt: this.clock(),
    };
    this.recordEvent(id, "archived", `Widget "${this.widgets[idx].title}" archived`);
    this.save();
    return this.widgets[idx];
  }

  restore(id: string): Widget {
    const idx = this.widgets.findIndex((w) => w.id === id);
    if (idx === -1) {
      throw new Error(`Widget not found: ${id}`);
    }
    if (this.widgets[idx].status !== "archived") {
      throw new Error(`Widget is not archived: ${id}`);
    }
    this.widgets[idx] = {
      ...this.widgets[idx],
      status: "active",
      updatedAt: this.clock(),
    };
    this.recordEvent(id, "restored", `Widget "${this.widgets[idx].title}" restored`);
    this.save();
    return this.widgets[idx];
  }

  delete(id: string): void {
    const idx = this.widgets.findIndex((w) => w.id === id);
    if (idx === -1) {
      throw new Error(`Widget not found: ${id}`);
    }
    const widget = this.widgets[idx];
    this.widgets.splice(idx, 1);
    this.recordEvent(widget.id, "deleted", `Widget "${widget.title}" deleted`);
    // Keep versions for historical reference
    this.save();
  }

  // === Lifecycle ===

  togglePin(id: string): Widget {
    const idx = this.widgets.findIndex((w) => w.id === id);
    if (idx === -1) throw new Error(`Widget not found: ${id}`);
    const pinned = !this.widgets[idx].layout.pinned;
    this.widgets[idx] = {
      ...this.widgets[idx],
      layout: { ...this.widgets[idx].layout, pinned },
      updatedAt: this.clock(),
    };
    this.recordEvent(id, pinned ? "pinned" : "unpinned", `Widget "${this.widgets[idx].title}" ${pinned ? "pinned" : "unpinned"}`);
    this.save();
    return this.widgets[idx];
  }

  listStale(): Widget[] {
    const now = this.clock();
    return this.widgets.filter(
      (w) =>
        w.status === "active" &&
        now - w.updatedAt > STALE_THRESHOLD_MS &&
        (!w.schedule || w.schedule.kind === "manual"),
    );
  }

  listEvents(widgetId?: string, limit = 50): WidgetLifecycleEvent[] {
    const filtered = widgetId
      ? this.events.filter((e) => e.widgetId === widgetId)
      : this.events;
    return filtered.slice(-limit).reverse();
  }

  // === Versions ===

  private getLatestVersionNumber(widgetId: string): number {
    const widgetVersions = this.versions.filter((v) => v.widgetId === widgetId);
    if (widgetVersions.length === 0) return 0;
    return Math.max(...widgetVersions.map((v) => v.version));
  }

  listVersions(widgetId: string): WidgetVersion[] {
    return this.versions
      .filter((v) => v.widgetId === widgetId)
      .sort((a, b) => b.version - a.version);
  }

  getVersion(versionId: string): WidgetVersion | undefined {
    return this.versions.find((v) => v.id === versionId);
  }

  compareVersions(versionIdA: string, versionIdB: string): {
    a: WidgetVersion;
    b: WidgetVersion;
  } {
    const a = this.versions.find((v) => v.id === versionIdA);
    const b = this.versions.find((v) => v.id === versionIdB);
    if (!a) throw new Error(`Version not found: ${versionIdA}`);
    if (!b) throw new Error(`Version not found: ${versionIdB}`);
    return { a, b };
  }

  restoreVersion(params: WidgetVersionRestoreParams): Widget {
    const version = this.versions.find((v) => v.id === params.versionId);
    if (!version) {
      throw new Error(`Version not found: ${params.versionId}`);
    }
    if (version.widgetId !== params.widgetId) {
      throw new Error(`Version ${params.versionId} does not belong to widget ${params.widgetId}`);
    }

    const widget = this.get(params.widgetId);
    if (!widget) {
      throw new Error(`Widget not found: ${params.widgetId}`);
    }

    // Restore manifest/layout/schedule/componentSkillId from version, preserve state data
    const now = this.clock();
    const newVersionId = randomUUID();

    const restoredWidget: Widget = {
      ...widget,
      title: version.manifestSnapshot.title,
      kind: version.manifestSnapshot.kind,
      layout: version.layoutSnapshot,
      dataSource: version.manifestSnapshot.dataSource,
      actions: version.manifestSnapshot.actions,
      schedule: version.manifestSnapshot.schedule,
      permissions: version.manifestSnapshot.permissions,
      componentSkillId: version.manifestSnapshot.componentSkillId,
      manifestVersion: widget.manifestVersion + 1,
      currentVersionId: newVersionId,
      lastRestoredVersionId: version.id,
      updatedAt: now,
    };

    // Create a new version recording this restore
    const restoreVersion: WidgetVersion = {
      id: newVersionId,
      widgetId: widget.id,
      version: this.getLatestVersionNumber(widget.id) + 1,
      createdAt: now,
      summary: params.restoreSummary ?? `Restored to version ${version.version}`,
      changeReason: `Restored from version ${version.id}`,
      manifestSnapshot: {
        id: restoredWidget.id,
        workspaceId: restoredWidget.workspaceId,
        title: restoredWidget.title,
        kind: restoredWidget.kind,
        status: restoredWidget.status,
        layout: restoredWidget.layout,
        manifestVersion: restoredWidget.manifestVersion,
        dataSource: restoredWidget.dataSource,
        actions: restoredWidget.actions,
        schedule: restoredWidget.schedule,
        permissions: restoredWidget.permissions,
        artifactIds: restoredWidget.artifactIds,
        automationIds: restoredWidget.automationIds,
        builderSessionId: restoredWidget.builderSessionId,
        builderSkillId: restoredWidget.builderSkillId,
        componentSkillId: restoredWidget.componentSkillId,
        currentVersionId: newVersionId,
        createdAt: restoredWidget.createdAt,
        updatedAt: now,
      },
      layoutSnapshot: restoredWidget.layout,
      stateSchemaSnapshot: {},
      automationBindingSnapshot: {},
      componentSkillId: restoredWidget.componentSkillId,
      skillContentHash: undefined,
      migrationNote: "",
    };

    this.versions.push(restoreVersion);

    const idx = this.widgets.findIndex((w) => w.id === params.widgetId);
    this.widgets[idx] = restoredWidget;
    this.save();
    return restoredWidget;
  }
}
