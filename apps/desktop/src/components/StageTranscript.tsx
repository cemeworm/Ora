import { AlertCircle, CheckCircle2, Circle, LoaderCircle, MessagesSquare, RotateCcw, ShieldCheck, ShieldX } from "lucide-react";
import type { ReviewGateInfo, TurnAgentConversationMessage } from "../types";
import { cn } from "../lib/utils";
import { MarkdownContent } from "./MarkdownContent";
import { TaskList, TaskListBody, TaskListHeader } from "./ai-elements/task";

export interface StageTranscriptGroup {
  id: string;
  label: string;
  entries: TurnAgentConversationMessage[];
  layout?: TranscriptLayout;
}

type TranscriptMetadata = NonNullable<TurnAgentConversationMessage["transcript"]>;
type TranscriptStance = TranscriptMetadata["stance"];
type TranscriptLayout = NonNullable<TranscriptMetadata["layout"]>;
type TranscriptRendererId =
  | "stage_list"
  | "two_sided_duel"
  | "role_lanes"
  | "rubric_matrix"
  | "judge_panel"
  | "evidence_board"
  | "comparison_table"
  | "artifact_gallery"
  | "kanban_pipeline";

export function groupStageTranscriptMessages(messages: TurnAgentConversationMessage[]): StageTranscriptGroup[] {
  const byGroup = new Map<string, StageTranscriptGroup>();
  for (const message of messages.filter((item) => item.transcript)) {
    const transcript = message.transcript!;
    const group = byGroup.get(transcript.groupId) ?? {
      id: transcript.groupId,
      label: transcript.groupLabel ?? "Stage Transcript",
      entries: [],
      layout: transcript.layout,
    };
    if (!group.layout && transcript.layout) {
      group.layout = transcript.layout;
    }
    group.entries.push(message);
    byGroup.set(group.id, group);
  }

  return [...byGroup.values()]
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort((left, right) =>
        (left.transcript?.sequence ?? 0) - (right.transcript?.sequence ?? 0) ||
        left.id.localeCompare(right.id)
      ),
    }))
    .sort((left, right) =>
      (left.entries[0]?.transcript?.sequence ?? 0) - (right.entries[0]?.transcript?.sequence ?? 0) ||
      left.id.localeCompare(right.id)
    );
}

function pivotTranscriptEntries(entries: TurnAgentConversationMessage[]) {
  const stanceOrder: string[] = [];
  const stageOrder: string[] = [];
  const stageLabels = new Map<string, string>();
  const seenStance = new Set<string>();
  const seenStage = new Set<string>();
  for (const entry of entries) {
    const t = entry.transcript!;
    if (!seenStance.has(t.stance)) { stanceOrder.push(t.stance); seenStance.add(t.stance); }
    if (!seenStage.has(t.stageId)) { stageOrder.push(t.stageId); stageLabels.set(t.stageId, t.stageLabel); seenStage.add(t.stageId); }
  }
  const byKey = new Map<string, TurnAgentConversationMessage>();
  for (const entry of entries) {
    const t = entry.transcript!;
    byKey.set(`${t.stageId}:${t.stance}`, entry);
  }
  return { stances: stanceOrder, stages: stageOrder, stageLabels, byKey };
}

function groupByTranscriptField(
  entries: TurnAgentConversationMessage[],
  field: "stance" | "speakerId" | "stageId",
): Map<string, TurnAgentConversationMessage[]> {
  const groups = new Map<string, TurnAgentConversationMessage[]>();
  for (const entry of entries) {
    const key = (entry.transcript![field] as string) ?? "unknown";
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return groups;
}

function renderTranscriptGroup(renderer: TranscriptRendererId, group: StageTranscriptGroup, reviewGate?: ReviewGateInfo) {
  switch (renderer) {
    case "two_sided_duel": return <TwoSidedDuelTranscriptRenderer group={group} />;
    case "rubric_matrix": return <RubricMatrixRenderer group={group} />;
    case "judge_panel": return <JudgePanelRenderer group={group} />;
    case "evidence_board": return <EvidenceBoardRenderer group={group} />;
    case "comparison_table": return <ComparisonTableRenderer group={group} />;
    case "artifact_gallery": return <ArtifactGalleryRenderer group={group} />;
    case "kanban_pipeline": return <KanbanPipelineRenderer group={group} />;
    case "role_lanes": return <RoleLanesRenderer group={group} reviewGate={reviewGate} />;
    default: return group.entries.map((message) => (
      <StageTranscriptEntry key={message.id} message={message} />
    ));
  }
}

export function StageTranscript({ messages, reviewGate }: { messages: TurnAgentConversationMessage[]; reviewGate?: ReviewGateInfo }) {
  const groups = groupStageTranscriptMessages(messages);
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const renderer = resolveTranscriptRenderer(group);
        return (
          <TaskList key={group.id}>
            <TaskListHeader>
              <div className="flex min-w-0 items-center gap-2">
                <MessagesSquare size={14} />
                <span className="font-medium text-foreground">{group.label}</span>
                <span className="truncate text-xs text-muted-foreground">{group.entries.length} 个阶段</span>
                {reviewGate ? <VerdictLaneBadge gate={reviewGate} /> : null}
              </div>
            </TaskListHeader>
            <TaskListBody className={cn("border-l-0 pl-0", renderer === "stage_list" && "divide-y divide-border")}>
              {renderTranscriptGroup(renderer, group, reviewGate)}
            </TaskListBody>
          </TaskList>
        );
      })}
    </div>
  );
}

function resolveTranscriptRenderer(group: StageTranscriptGroup): TranscriptRendererId {
  switch (group.layout?.style) {
    case "two_sided_duel":
    case "role_lanes":
    case "rubric_matrix":
    case "judge_panel":
    case "evidence_board":
    case "comparison_table":
    case "artifact_gallery":
    case "kanban_pipeline":
      return group.layout!.style;
    default:
      break;
  }
  // 兼容旧 transcript 元数据
  const label = group.label.toLowerCase();
  const hasDebateLabel = label.includes("debate") || group.label.includes("辩论");
  const hasBothSides = group.entries.some((message) => message.transcript?.stance === "affirmative") &&
    group.entries.some((message) => message.transcript?.stance === "negative");

  return hasDebateLabel && hasBothSides ? "two_sided_duel" : "stage_list";
}

function TwoSidedDuelTranscriptRenderer({ group }: { group: StageTranscriptGroup }) {
  return (
    <div className="space-y-4 px-1 py-3 sm:px-2">
      {group.entries.map((message) => (
        <TwoSidedDuelRow key={message.id} group={group} message={message} />
      ))}
    </div>
  );
}

function TwoSidedDuelRow({ group, message }: { group: StageTranscriptGroup; message: TurnAgentConversationMessage }) {
  const transcript = message.transcript!;
  const side = sideForTranscript(group, transcript);

  if (side === "center") {
    return <TwoSidedDuelCenterRow group={group} message={message} />;
  }

  return (
    <article>
      <div className="md:hidden">
        <TwoSidedDuelCard group={group} message={message} />
      </div>
      <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)] md:items-start md:gap-4">
        <div className="min-w-0">
          {side === "left" ? <TwoSidedDuelCard group={group} message={message} align="left" /> : null}
        </div>
        <DuelStageAxis group={group} message={message} />
        <div className="min-w-0">
          {side === "right" ? <TwoSidedDuelCard group={group} message={message} align="right" /> : null}
        </div>
      </div>
    </article>
  );
}

function TwoSidedDuelCenterRow({ group, message }: { group: StageTranscriptGroup; message: TurnAgentConversationMessage }) {
  return (
    <article>
      <div className="md:hidden">
        <TwoSidedDuelCard group={group} message={message} />
      </div>
      <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)] md:items-start md:gap-4">
        <div />
        <DuelStageAxis group={group} message={message} />
        <div />
      </div>
      <div className="hidden md:block md:px-12 md:pt-2">
        <TwoSidedDuelCard group={group} message={message} emphasis="summary" />
      </div>
    </article>
  );
}

function DuelStageAxis({ group, message }: { group: StageTranscriptGroup; message: TurnAgentConversationMessage }) {
  const transcript = message.transcript!;
  return (
    <div className="flex min-h-full flex-col items-center text-center">
      <div className="h-3 w-px bg-border" />
      <div className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold shadow-sm",
        stanceTone(transcript.stance, group.layout),
      )}>
        {transcript.sequence + 1}
      </div>
      <div className="mt-2 flex max-w-16 flex-col items-center gap-1">
        <TranscriptStatusIcon status={transcript.status} />
        <span className="text-[10px] leading-4 text-muted-foreground">{transcript.stageLabel}</span>
      </div>
      <div className="mt-2 min-h-6 flex-1 w-px bg-border" />
    </div>
  );
}

function TwoSidedDuelCard({
  group,
  message,
  align = "left",
  emphasis = "turn",
}: {
  group: StageTranscriptGroup;
  message: TurnAgentConversationMessage;
  align?: "left" | "right";
  emphasis?: "turn" | "summary";
}) {
  const transcript = message.transcript!;
  const isSummary = emphasis === "summary";

  return (
    <section className={cn(
      "relative min-w-0 overflow-hidden rounded-2xl border bg-background/80 p-4 shadow-sm",
      cardTone(transcript.stance, group.layout),
      isSummary && "mx-auto max-w-3xl",
    )}>
      <div className={cn(
        "absolute inset-y-0 w-1",
        align === "right" && !isSummary ? "right-0" : "left-0",
        accentTone(transcript.stance, group.layout),
      )} />
      <div className={cn("flex items-start justify-between gap-3", align === "right" && !isSummary && "md:flex-row-reverse md:text-right")}>
        <div className="min-w-0 space-y-1">
          <div className={cn("flex flex-wrap items-center gap-2", align === "right" && !isSummary && "md:justify-end")}>
            <span className="text-sm font-semibold text-foreground">{transcript.speakerLabel}</span>
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", stancePillTone(transcript.stance, group.layout))}>
              {stanceLabel(transcript.stance, group.layout)}
            </span>
          </div>
          <div className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", align === "right" && !isSummary && "md:justify-end")}>
            <span>{transcript.stageLabel}</span>
            <span>{message.timestamp}</span>
          </div>
        </div>
        <div className="md:hidden">
          <TranscriptStatusIcon status={transcript.status} />
        </div>
      </div>
      <MarkdownContent content={message.content} className={cn(
        "mt-3 text-sm leading-7 text-foreground",
        align === "right" && !isSummary && "md:text-left",
      )} />
    </section>
  );
}

function StageTranscriptEntry({ message }: { message: TurnAgentConversationMessage }) {
  const transcript = message.transcript!;
  return (
    <article className="px-4 py-4">
      <div className="flex items-start gap-3">
        <div className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
          stanceTone(transcript.stance, transcript.layout),
        )}>
          {transcript.sequence + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{transcript.speakerLabel}</span>
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", stancePillTone(transcript.stance, transcript.layout))}>
              {stanceLabel(transcript.stance, transcript.layout)}
            </span>
            <span className="text-xs text-muted-foreground">{transcript.stageLabel}</span>
            <span className="text-xs text-muted-foreground">{message.timestamp}</span>
          </div>
          <MarkdownContent content={message.content} className="mt-2 text-sm leading-7 text-foreground" />
        </div>
        <TranscriptStatusIcon status={transcript.status} />
      </div>
    </article>
  );
}

// ── rubric_matrix ──────────────────────────────────────────────────────

function RubricMatrixRenderer({ group }: { group: StageTranscriptGroup }) {
  const { stances, stages, stageLabels, byKey } = pivotTranscriptEntries(group.entries);
  const layout = group.layout;

  return (
    <div className="overflow-x-auto px-2 py-3">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground" />
            {stances.map((stance) => (
              <th key={stance} className="px-3 py-2 text-left">
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", stancePillTone(stance, layout))}>
                  {stanceLabel(stance, layout)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stages.map((stageId, rowIdx) => (
            <tr key={stageId} className={cn(rowIdx < stages.length - 1 && "border-b border-border")}>
              <td className="whitespace-nowrap px-3 py-3 text-xs font-medium text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold", stanceTone("neutral", layout))}>
                    {rowIdx + 1}
                  </span>
                  {stageLabels.get(stageId) ?? stageId}
                </div>
              </td>
              {stances.map((stance) => {
                const entry = byKey.get(`${stageId}:${stance}`);
                return (
                  <td key={stance} className="px-3 py-3 align-top">
                    {entry ? (
                      <MarkdownContent content={entry.content} className="text-sm leading-7 text-foreground" />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── judge_panel ───────────────────────────────────────────────────────

function JudgePanelRenderer({ group }: { group: StageTranscriptGroup }) {
  const layout = group.layout;
  const summaryStances = layout?.summaryStances ?? [];
  const reviews = group.entries.filter((e) => !summaryStances.includes(e.transcript!.stance));
  const verdicts = group.entries.filter((e) => summaryStances.includes(e.transcript!.stance));

  return (
    <div className="space-y-3 px-2 py-3">
      {reviews.map((message) => (
        <JudgeCard key={message.id} group={group} message={message} />
      ))}
      {verdicts.length > 0 && (
        <>
          <div className="mx-4 border-t border-border" />
          {verdicts.map((message) => (
            <JudgeCard key={message.id} group={group} message={message} emphasis="verdict" />
          ))}
        </>
      )}
    </div>
  );
}

function JudgeCard({ group, message, emphasis = "review" }: { group: StageTranscriptGroup; message: TurnAgentConversationMessage; emphasis?: "review" | "verdict" }) {
  const transcript = message.transcript!;
  const isVerdict = emphasis === "verdict";

  return (
    <section className={cn(
      "relative overflow-hidden rounded-2xl border p-4",
      isVerdict ? "mx-auto max-w-3xl bg-background/90 shadow-sm" : "bg-background/60",
      cardTone(transcript.stance, group.layout),
    )}>
      {isVerdict && <div className={cn("absolute inset-x-0 top-0 h-1", accentTone(transcript.stance, group.layout))} />}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{transcript.speakerLabel}</span>
          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", stancePillTone(transcript.stance, group.layout))}>
            {stanceLabel(transcript.stance, group.layout)}
          </span>
        </div>
        <TranscriptStatusIcon status={transcript.status} />
      </div>
      <MarkdownContent content={message.content} className="mt-3 text-sm leading-7 text-foreground" />
    </section>
  );
}

// ── evidence_board ────────────────────────────────────────────────────

function EvidenceBoardRenderer({ group }: { group: StageTranscriptGroup }) {
  const layout = group.layout;
  const grouped = groupByTranscriptField(group.entries, "stance");

  return (
    <div className="space-y-4 px-2 py-3">
      {[...grouped.entries()].map(([stance, entries]) => (
        <div key={stance}>
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className={cn("h-2 w-2 rounded-full", accentDot(stance, layout))} />
            <span className="text-xs font-semibold text-foreground">{stanceLabel(stance, layout)}</span>
            <span className="text-xs text-muted-foreground">{entries.length}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {entries.map((message) => (
              <EvidenceCard key={message.id} group={group} message={message} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EvidenceCard({ group, message }: { group: StageTranscriptGroup; message: TurnAgentConversationMessage }) {
  const transcript = message.transcript!;
  return (
    <section className={cn("relative overflow-hidden rounded-xl border bg-background/70 p-3 shadow-sm", cardTone(transcript.stance, group.layout))}>
      <div className={cn("absolute inset-y-0 left-0 w-1", accentTone(transcript.stance, group.layout))} />
      <div className="flex items-center gap-2 pl-2">
        <span className="text-xs font-semibold text-foreground">{transcript.speakerLabel}</span>
        <span className="text-xs text-muted-foreground">{transcript.stageLabel}</span>
      </div>
      <MarkdownContent content={message.content} className="mt-2 pl-2 text-sm leading-7 text-foreground" />
    </section>
  );
}

// ── comparison_table ──────────────────────────────────────────────────

function ComparisonTableRenderer({ group }: { group: StageTranscriptGroup }) {
  const { stances, stages, stageLabels, byKey } = pivotTranscriptEntries(group.entries);
  const layout = group.layout;

  return (
    <div className="space-y-3 px-2 py-3">
      {stages.map((stageId) => (
        <div key={stageId} className="overflow-hidden rounded-xl border border-border">
          <div className="bg-muted/40 px-4 py-2 text-xs font-semibold text-foreground">
            {stageLabels.get(stageId) ?? stageId}
          </div>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${stances.length}, minmax(0, 1fr))` }}>
            {stances.map((stance, idx) => {
              const entry = byKey.get(`${stageId}:${stance}`);
              return (
                <div key={stance} className={cn("px-4 py-3", idx > 0 && "border-l border-border")}>
                  <span className={cn("mb-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", stancePillTone(stance, layout))}>
                    {stanceLabel(stance, layout)}
                  </span>
                  {entry ? (
                    <MarkdownContent content={entry.content} className="text-sm leading-7 text-foreground" />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── artifact_gallery ──────────────────────────────────────────────────

function ArtifactGalleryRenderer({ group }: { group: StageTranscriptGroup }) {
  return (
    <div className="grid gap-3 px-2 py-3 sm:grid-cols-2 lg:grid-cols-3">
      {group.entries.map((message) => (
        <ArtifactCard key={message.id} group={group} message={message} />
      ))}
    </div>
  );
}

function ArtifactCard({ group, message }: { group: StageTranscriptGroup; message: TurnAgentConversationMessage }) {
  const transcript = message.transcript!;
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-background/70 shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold", stanceTone(transcript.stance, group.layout))}>
          {transcript.sequence + 1}
        </span>
        <span className="truncate text-xs font-semibold text-foreground">{transcript.speakerLabel}</span>
        <span className="truncate text-xs text-muted-foreground">{transcript.stageLabel}</span>
      </div>
      <div className="flex-1 px-3 py-3">
        <MarkdownContent content={message.content} className="text-sm leading-7 text-foreground" />
      </div>
    </section>
  );
}

// ── role_lanes ────────────────────────────────────────────────────────

function RoleLanesRenderer({ group, reviewGate }: { group: StageTranscriptGroup; reviewGate?: ReviewGateInfo }) {
  const layout = group.layout;
  const lanes = layout?.lanes;
  const columns: Array<{ id: string; label: string; entries: TurnAgentConversationMessage[] }> = lanes
    ? lanes.map((lane) => ({
        id: lane.id,
        label: lane.label,
        entries: group.entries
          .filter((e) => {
            const assigned = layout?.laneBySpeaker?.[e.transcript!.speakerId ?? ""] ?? e.transcript!.stageId;
            return assigned === lane.id;
          })
          .sort((a, b) => (a.transcript?.sequence ?? 0) - (b.transcript?.sequence ?? 0)),
      }))
    : [...groupByTranscriptField(group.entries, "speakerId").entries()].map(([id, entries]) => ({
        id,
        label: entries[0]?.transcript?.speakerLabel ?? id,
        entries: [...entries].sort((a, b) => (a.transcript?.sequence ?? 0) - (b.transcript?.sequence ?? 0)),
      }));

  const VERIFIER_STAGE_IDS = new Set(["verify", "review", "check"]);

  return (
    <div className="space-y-4 px-2 py-3">
      {columns.map((col) => {
        const isVerifierLane = reviewGate && col.entries.some(
          (e) => VERIFIER_STAGE_IDS.has(e.transcript?.stageId ?? ""),
        );
        return (
        <div key={col.id} className="rounded-xl border border-border bg-muted/15">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <span className="text-xs font-semibold text-foreground">{col.label}</span>
            <span className="text-xs text-muted-foreground">{col.entries.length}</span>
            {isVerifierLane ? <VerdictLaneBadge gate={reviewGate!} /> : null}
          </div>
          <div className="flex flex-wrap gap-3 p-3">
            {col.entries.length === 0 ? (
              <span className="px-2 py-4 text-xs text-muted-foreground">暂无输出</span>
            ) : (
              col.entries.map((message) => (
                <RoleLaneCard key={message.id} group={group} message={message} />
              ))
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}

function VerdictLaneBadge({ gate }: { gate: ReviewGateInfo }) {
  const { reviewVerdict, reviewReworkCount, reviewIssues, reviewFindings } = gate;
  const config = {
    pass: {
      icon: <ShieldCheck size={12} />,
      label: "通过",
      className: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700/50",
    },
    needs_fix: {
      icon: reviewReworkCount > 0 ? <RotateCcw size={12} /> : <AlertCircle size={12} />,
      label: reviewReworkCount > 0 ? `返工 ${reviewReworkCount}/2` : "需返工",
      className: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/50",
    },
    blocked: {
      icon: <ShieldX size={12} />,
      label: "阻断",
      className: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700/50",
    },
  }[reviewVerdict];

  const findingsCount = reviewFindings?.length ?? 0;
  const labelWithCount = findingsCount > 0 ? `${config.label} (${findingsCount})` : config.label;

  const tooltipLines: string[] = [];
  if (reviewFindings?.length) {
    for (const f of reviewFindings) {
      const prefix = f.severity === "blocking" ? "!!" : f.severity === "concern" ? "!" : "·";
      tooltipLines.push(`${prefix} [${f.artifactId ?? "general"}] ${f.issue}`);
    }
  } else if (reviewIssues.length > 0) {
    tooltipLines.push(...reviewIssues.slice(0, 3));
  }
  const title = tooltipLines.length > 0 ? tooltipLines.join("\n") : undefined;

  return (
    <span
      title={title}
      className={cn(
        "ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        config.className,
      )}
    >
      {config.icon}
      {labelWithCount}
    </span>
  );
}

function RoleLaneCard({ group, message }: { group: StageTranscriptGroup; message: TurnAgentConversationMessage }) {
  const transcript = message.transcript!;
  return (
    <section className={cn(
      "flex min-w-[18rem] max-w-md flex-col rounded-lg border bg-background p-3 shadow-sm",
      cardTone(transcript.stance, group.layout),
    )}>
      <div className="flex items-center gap-2">
        <span className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
          stanceTone(transcript.stance, group.layout),
        )}>
          {transcript.sequence + 1}
        </span>
        <span className="truncate text-xs font-semibold text-foreground">{transcript.speakerLabel}</span>
        <span className="truncate text-xs text-muted-foreground">{transcript.stageLabel}</span>
        <TranscriptStatusIcon status={transcript.status} />
      </div>
      <MarkdownContent content={message.content} className="mt-2 text-sm leading-7 text-foreground" />
    </section>
  );
}

// ── kanban_pipeline ───────────────────────────────────────────────────

function KanbanPipelineRenderer({ group }: { group: StageTranscriptGroup }) {
  const layout = group.layout;
  const lanes = layout?.lanes;
  const columns: Array<{ id: string; label: string; entries: TurnAgentConversationMessage[] }> = lanes
    ? lanes.map((lane) => ({
        id: lane.id,
        label: lane.label,
        entries: group.entries.filter((e) => {
          const assigned = layout?.laneBySpeaker?.[e.transcript!.speakerId ?? ""] ?? e.transcript!.stageId;
          return assigned === lane.id;
        }),
      }))
    : [...groupByTranscriptField(group.entries, "stageId").entries()].map(([id, entries]) => ({
        id,
        label: entries[0]?.transcript?.stageLabel ?? id,
        entries: [...entries],
      }));

  return (
    <div className="flex gap-3 overflow-x-auto px-2 py-3">
      {columns.map((col) => (
        <div key={col.id} className="flex w-64 min-w-[16rem] shrink-0 flex-col rounded-xl border border-border bg-muted/20">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-foreground">{col.label}</span>
            <span className="text-xs text-muted-foreground">{col.entries.length}</span>
          </div>
          <div className="flex flex-col gap-2 p-2">
            {col.entries.map((message) => (
              <KanbanCard key={message.id} group={group} message={message} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function KanbanCard({ group, message }: { group: StageTranscriptGroup; message: TurnAgentConversationMessage }) {
  const transcript = message.transcript!;
  return (
    <section className="rounded-lg border border-border bg-background p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-foreground">{transcript.speakerLabel}</span>
        {transcript.stance !== "neutral" && (
          <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium", stancePillTone(transcript.stance, group.layout))}>
            {stanceLabel(transcript.stance, group.layout)}
          </span>
        )}
      </div>
      <MarkdownContent content={message.content} className="mt-2 text-xs leading-6 text-foreground" />
    </section>
  );
}

function sideForTranscript(group: StageTranscriptGroup, transcript: TranscriptMetadata): "left" | "right" | "center" {
  const configuredSide = group.layout?.sideByStance?.[transcript.stance];
  if (configuredSide) {
    return configuredSide;
  }
  if (group.layout?.summaryStances?.includes(transcript.stance) || transcript.stance === "moderator" || transcript.stance === "neutral") {
    return "center";
  }
  return transcript.stance === "negative" ? "right" : "left";
}

function stanceLabel(stance: TranscriptStance, layout?: TranscriptLayout) {
  return layout?.stanceLabels?.[stance] ?? {
    affirmative: "正方",
    negative: "反方",
    moderator: "主持",
    neutral: "中立",
  }[stance] ?? stance;
}

function toneForStance(stance: TranscriptStance, layout?: TranscriptLayout) {
  return layout?.stanceTones?.[stance] ?? {
    affirmative: "green",
    negative: "blue",
    moderator: "violet",
    neutral: "gray",
  }[stance] ?? "gray";
}

function stanceTone(stance: TranscriptStance, layout?: TranscriptLayout) {
  switch (toneForStance(stance, layout)) {
    case "green":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "blue":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "violet":
      return "border-violet-200 bg-violet-50 text-violet-800";
    case "amber":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "red":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "gray":
    default:
      return "border-border bg-muted/35 text-foreground";
  }
}

function stancePillTone(stance: TranscriptStance, layout?: TranscriptLayout) {
  switch (toneForStance(stance, layout)) {
    case "green":
      return "bg-emerald-50 text-emerald-800";
    case "blue":
      return "bg-sky-50 text-sky-800";
    case "violet":
      return "bg-violet-50 text-violet-800";
    case "amber":
      return "bg-amber-50 text-amber-800";
    case "red":
      return "bg-rose-50 text-rose-800";
    case "gray":
    default:
      return "bg-muted text-muted-foreground";
  }
}

function cardTone(stance: TranscriptStance, layout?: TranscriptLayout) {
  switch (toneForStance(stance, layout)) {
    case "green":
      return "border-emerald-200/80 bg-emerald-50/30";
    case "blue":
      return "border-sky-200/80 bg-sky-50/30";
    case "violet":
      return "border-violet-200/80 bg-violet-50/30";
    case "amber":
      return "border-amber-200/80 bg-amber-50/30";
    case "red":
      return "border-rose-200/80 bg-rose-50/30";
    case "gray":
    default:
      return "border-border bg-muted/25";
  }
}

function accentTone(stance: TranscriptStance, layout?: TranscriptLayout) {
  switch (toneForStance(stance, layout)) {
    case "green":
      return "bg-emerald-400/70";
    case "blue":
      return "bg-sky-400/70";
    case "violet":
      return "bg-violet-400/70";
    case "amber":
      return "bg-amber-400/70";
    case "red":
      return "bg-rose-400/70";
    case "gray":
    default:
      return "bg-border";
  }
}

function accentDot(stance: TranscriptStance, layout?: TranscriptLayout) {
  switch (toneForStance(stance, layout)) {
    case "green": return "bg-emerald-400";
    case "blue": return "bg-sky-400";
    case "violet": return "bg-violet-400";
    case "amber": return "bg-amber-400";
    case "red": return "bg-rose-400";
    default: return "bg-border";
  }
}

function TranscriptStatusIcon({ status }: { status: TranscriptMetadata["status"] }) {
  if (status === "running") {
    return <LoaderCircle size={14} className="mt-1 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (status === "done") {
    return <CheckCircle2 size={14} className="mt-1 shrink-0 text-emerald-600" />;
  }
  return <Circle size={14} className="mt-1 shrink-0 text-muted-foreground" />;
}
