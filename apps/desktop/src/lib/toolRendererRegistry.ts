export interface RuntimeToolResultPreview {
  kind: string;
  summary: string;
  detail?: Record<string, unknown>;
  preview?: unknown;
}

/**
 * Tool-specific renderer descriptor.
 * Each entry maps a tool family to a visual renderer that can display
 * structured preview content (diff, command output, file content, etc.)
 * instead of the generic JSON blob view.
 */
export interface ToolRendererDescriptor {
  /** Tool ID or prefix (e.g. "file.patch" matches file.patch, "shell" matches shell.execute). */
  match: string;
  /** Human-readable label for the renderer. */
  label: string;
  /** Returns a React component name or key for the renderer. */
  component: string;
  /** Icon identifier for the tool card. */
  icon: string;
}

/**
 * Registry of tool renderers consumed by Desktop Trails and approval cards.
 */
export class ToolRendererRegistry {
  private renderers: ToolRendererDescriptor[] = [];

  register(descriptor: ToolRendererDescriptor): void {
    this.renderers = [
      ...this.renderers.filter((r) => r.match !== descriptor.match),
      descriptor,
    ];
  }

  get(toolId: string): ToolRendererDescriptor | undefined {
    return this.renderers.find((r) =>
      toolId === r.match || toolId.startsWith(r.match),
    );
  }

  list(): ToolRendererDescriptor[] {
    return [...this.renderers];
  }
}

export const toolRendererRegistry = new ToolRendererRegistry();

/**
 * Structured preview metadata for approval cards.
 * Consumed alongside RuntimeToolResultPreview for richer approval UI.
 */
export interface ToolApprovalCardPreview {
  toolId: string;
  kind: string;
  title: string;
  summary: string;
  detail?: Record<string, unknown>;
  preview?: unknown;
}

export function buildApprovalCardPreview(preview: RuntimeToolResultPreview, toolId: string): ToolApprovalCardPreview {
  return {
    toolId,
    kind: preview.kind,
    title: preview.summary,
    summary: preview.summary,
    detail: preview.detail,
    preview: preview.preview,
  };
}

// Register default tool renderers.
toolRendererRegistry.register({ match: "file.patch", label: "Diff 预览", component: "FileDiffPreview", icon: "file-diff" });
toolRendererRegistry.register({ match: "file.write", label: "文件写入预览", component: "FileWritePreview", icon: "file-plus" });
toolRendererRegistry.register({ match: "file.read", label: "代码预览", component: "FileReadPreview", icon: "file-code" });
toolRendererRegistry.register({ match: "shell.execute", label: "命令输出预览", component: "ShellOutputPreview", icon: "terminal" });
toolRendererRegistry.register({ match: "web.fetch", label: "网页内容预览", component: "WebFetchPreview", icon: "globe" });
