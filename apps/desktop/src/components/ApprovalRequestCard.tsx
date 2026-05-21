import { AlertTriangle, FileCode, FileDiff, FilePlus, ShieldCheck, Terminal, XCircle } from "lucide-react";
import type { ActionRecord } from "../types";

interface ApprovalRequestCardProps {
  actions: ActionRecord[];
  onResume: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function ApprovalRequestCard({ actions, onResume, onCancel, disabled }: ApprovalRequestCardProps) {
  if (actions.length === 0) {
    return null;
  }

  const primaryAction = actions[0]!;
  const primaryRequest = approvalCopy(primaryAction);
  const isSingleAction = actions.length === 1;
  const structuredPreview = buildStructuredApprovalPreview(primaryAction);

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-amber-950 shadow-[0_1px_2px_rgba(120,53,15,0.08)]"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-100 text-amber-700">
            {structuredPreview ? structuredPreview.icon : <AlertTriangle size={15} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-foreground">
                {isSingleAction ? primaryRequest.title : "Your confirmation is needed"}
              </p>
              <span className="shrink-0 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                Waiting for approval
              </span>
              {!isSingleAction ? (
                <span className="shrink-0 rounded-full border border-amber-200 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  More actions pending
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-sm leading-5 text-muted-foreground">
              {isSingleAction
                ? primaryRequest.summary
                : "I need your confirmation for these actions before I continue."}
            </p>
            {isSingleAction && structuredPreview && (
              <div className="mt-2 rounded-md bg-white/60 px-2.5 py-2 ring-1 ring-inset ring-amber-200/60">
                {structuredPreview.content}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={onResume}
            disabled={disabled}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-signal-amber px-3 text-xs font-semibold text-bench-900 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldCheck size={14} />
            {primaryRequest.confirmLabel ?? "Approve and continue"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-amber-200 bg-background/70 px-3 text-xs font-semibold text-foreground transition hover:bg-background active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <XCircle size={14} />
            Cancel run
          </button>
        </div>
      </div>
    </div>
  );
}

function approvalCopy(action: ActionRecord) {
  return action.approvalRequest ?? {
    title: "Confirm before continuing",
    summary: action.consequence,
    whatWillChange: "This action may change the local environment.",
    whyNeeded: "It is needed to continue the current task.",
    riskNote: "Confirm this matches your expectations before continuing.",
    confirmLabel: "Approve and continue",
  };
}

interface StructuredApprovalPreview {
  icon: React.JSX.Element;
  content: React.JSX.Element;
}

function buildStructuredApprovalPreview(action: ActionRecord): StructuredApprovalPreview | undefined {
  const input = action.input && typeof action.input === "object" && !Array.isArray(action.input)
    ? action.input as Record<string, unknown>
    : undefined;
  if (!input) return undefined;

  switch (action.toolId) {
    case "file.patch": {
      const path = typeof input.path === "string" ? input.path : undefined;
      const edits = Array.isArray(input.edits) ? input.edits : undefined;
      const editCount = edits ? edits.length : 0;
      return {
        icon: <FileDiff size={15} />,
        content: (
          <div className="space-y-1">
            {path && <p className="text-xs font-mono text-bench-800 truncate">{path}</p>}
            <p className="text-xs text-bench-700">
              {editCount > 0
                ? `${editCount} 处修改`
                : "修改文件内容"}
            </p>
          </div>
        ),
      };
    }
    case "file.write": {
      const path = typeof input.path === "string" ? input.path : undefined;
      const content = typeof input.content === "string" ? input.content : undefined;
      const sizeBytes = content ? Buffer.byteLength(content) : 0;
      const preview = content ? content.slice(0, 120) : undefined;
      return {
        icon: <FilePlus size={15} />,
        content: (
          <div className="space-y-1">
            {path && <p className="text-xs font-mono text-bench-800 truncate">{path}</p>}
            <p className="text-xs text-bench-700">
              {sizeBytes > 0 ? `${sizeBytes.toLocaleString()} bytes` : "写入文件"}
            </p>
            {preview && (
              <pre className="mt-1 text-[11px] leading-4 text-bench-600 truncate font-mono bg-white/50 rounded px-1.5 py-0.5">
                {preview}{content && content.length > 120 ? "…" : ""}
              </pre>
            )}
          </div>
        ),
      };
    }
    case "shell.execute": {
      const command = typeof input.command === "string" ? input.command : undefined;
      return {
        icon: <Terminal size={15} />,
        content: (
          <div className="space-y-1">
            <p className="text-xs text-bench-700">执行命令</p>
            {command && (
              <pre className="text-[11px] leading-4 text-bench-800 truncate font-mono bg-white/50 rounded px-1.5 py-0.5">
                {command}
              </pre>
            )}
          </div>
        ),
      };
    }
    case "file.read": {
      const path = typeof input.path === "string" ? input.path : undefined;
      return {
        icon: <FileCode size={15} />,
        content: (
          <div className="space-y-1">
            {path && <p className="text-xs font-mono text-bench-800 truncate">{path}</p>}
            <p className="text-xs text-bench-700">读取文件</p>
          </div>
        ),
      };
    }
    default:
      return undefined;
  }
}
