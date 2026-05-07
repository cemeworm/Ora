import { AlertCircle, Check, LoaderCircle } from "lucide-react";
import type { OraSessionBranchGroup, OraStateSnapshot } from "../lib/runtimeClient";
import { assistantTextFromSnapshot } from "../lib/viewModel";
import { cn } from "../lib/utils";
import { translateCopy, type AppLanguage } from "../lib/i18n";
import { MarkdownContent } from "./MarkdownContent";
import { Button } from "./ui/button";

interface BranchComparisonTurnProps {
  group: OraSessionBranchGroup;
  snapshots: Record<string, OraStateSnapshot | undefined>;
  language: AppLanguage;
  disabled?: boolean;
  onAdoptBranchGroup?: (branchGroupId: string, runId: string) => void;
}

export function BranchComparisonTurn({
  group,
  snapshots,
  language,
  disabled = false,
  onAdoptBranchGroup,
}: BranchComparisonTurnProps) {
  const t = (value: string) => translateCopy(language, value);
  const candidates = group.candidates.slice(0, 2);
  const allSettled = candidates.length === 2 && candidates.every((candidate) => isSettledStatus(candidate.status));

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-6 text-foreground">{t("Branch candidates")}</p>
          <p className="truncate text-xs text-muted-foreground">{group.prompt}</p>
        </div>
        <span className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
          {statusLabel(language, group.status)}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {candidates.map((candidate) => {
          const snapshot = snapshots[candidate.runId];
          const body = snapshot ? assistantTextFromSnapshot(snapshot) : candidate.outputPreview;
          const status = snapshot?.status ?? candidate.status;
          const settled = isSettledStatus(status);
          const succeeded = status === "succeeded";
          const canAdopt = allSettled && succeeded && !candidate.adopted && group.status !== "adopted";

          return (
            <section
              key={candidate.runId}
              className="flex min-h-[280px] min-w-0 flex-col rounded-md border border-border bg-card"
            >
              <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">{candidate.label ?? candidate.runId}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {candidate.modelRef ?? snapshot?.config.modelRef ?? t("No model")} · {candidate.modeId ?? snapshot?.modeId ?? "mode"}
                  </p>
                </div>
                <StatusPill language={language} status={status} />
              </div>

              <div className="min-h-0 flex-1 overflow-hidden px-3 py-3">
                {body?.trim() ? (
                  <MarkdownContent content={body} className="text-sm leading-6" />
                ) : (
                  <EmptyCandidateBody
                    language={language}
                    status={status}
                    error={snapshot?.error}
                  />
                )}
              </div>

              {allSettled ? (
                <div className="border-t border-border px-3 py-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={candidate.adopted ? "secondary" : "outline"}
                    className="w-full"
                    disabled={disabled || !canAdopt || !onAdoptBranchGroup}
                    onClick={() => onAdoptBranchGroup?.(group.branchGroupId, candidate.runId)}
                    title={t("Adopt branch candidate")}
                  >
                    <Check size={13} />
                    {candidate.adopted ? t("Adopted") : t("I prefer this")}
                  </Button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function EmptyCandidateBody({
  language,
  status,
  error,
}: {
  language: AppLanguage;
  status: string;
  error?: string;
}) {
  const t = (value: string) => translateCopy(language, value);
  if (status === "failed") {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle size={15} />
        <span>{error?.trim() || t("Failed")}</span>
      </div>
    );
  }
  if (status === "queued" || status === "running") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle size={15} className="animate-spin" />
        <span>{statusLabel(language, status)}</span>
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">{statusLabel(language, status)}</p>;
}

function StatusPill({ language, status }: { language: AppLanguage; status: string }) {
  const active = status === "queued" || status === "running";
  const failed = status === "failed" || status === "cancelled";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px]",
        active && "border-border bg-background text-muted-foreground",
        status === "succeeded" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        failed && "border-destructive/20 bg-destructive/10 text-destructive",
        !active && status !== "succeeded" && !failed && "border-border bg-background text-muted-foreground",
      )}
    >
      {active ? <LoaderCircle size={11} className="animate-spin" /> : null}
      {statusLabel(language, status)}
    </span>
  );
}

function isSettledStatus(status: string): boolean {
  return status !== "queued" && status !== "running";
}

function statusLabel(language: AppLanguage, status: string): string {
  switch (status) {
    case "running":
      return translateCopy(language, "Running");
    case "queued":
      return translateCopy(language, "Queued");
    case "succeeded":
      return translateCopy(language, "Succeeded");
    case "failed":
      return translateCopy(language, "Failed");
    case "adopted":
      return translateCopy(language, "Adopted");
    case "dismissed":
      return translateCopy(language, "Dismissed");
    default:
      return status.replace(/_/g, " ");
  }
}
