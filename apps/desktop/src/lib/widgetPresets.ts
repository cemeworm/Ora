import type { OraWidget, OraWidgetCreateParams } from "./runtimeClient";

const TASKLIST_PRESET_KEY = "ora.widgets.presets.tasklist.v1";

const TASKLIST_DEFAULTS = {
  title: "任务清单",
  kind: "todo" as const,
  layout: { x: 0, y: 0, w: 1, h: 1, pinned: false },
} satisfies Partial<OraWidgetCreateParams>;

export interface PresetClient {
  createWidget(params: OraWidgetCreateParams): Promise<OraWidget>;
  findDuplicateWidget(title: string, kind?: string): Promise<OraWidget | null>;
}

let runningInit: Promise<OraWidget | null> | null = null;

export async function ensureTasklistPreset(
  client: PresetClient,
  existingWidgets: OraWidget[],
): Promise<OraWidget | null> {
  // Shared promise prevents parallel creation (e.g. React Strict Mode double-mount)
  if (runningInit) return runningInit;

  runningInit = (async () => {
    // 1. Check in-memory list first (fast path, no RPC)
    const existing = existingWidgets.find(
      (w) =>
        w.title === TASKLIST_DEFAULTS.title &&
        w.kind === TASKLIST_DEFAULTS.kind,
    );
    if (existing) return null;

    // 2. Check store for existing widget (authoritative, handles stale localStorage)
    const duplicate = await client.findDuplicateWidget(
      TASKLIST_DEFAULTS.title,
      TASKLIST_DEFAULTS.kind,
    );
    if (duplicate) {
      localStorage.setItem(TASKLIST_PRESET_KEY, "created");
      return null;
    }

    // 3. Create the preset widget
    const widget = await client.createWidget(TASKLIST_DEFAULTS);
    localStorage.setItem(TASKLIST_PRESET_KEY, "created");
    return widget;
  })();

  try {
    return await runningInit;
  } finally {
    runningInit = null;
  }
}
