import { CheckCircle2, Circle, LoaderCircle, MessagesSquare } from "lucide-react";
import type { TurnAgentConversationMessage } from "../types";
import { cn } from "../lib/utils";
import { MarkdownContent } from "./MarkdownContent";
import { TaskList, TaskListBody, TaskListHeader } from "./ai-elements/task";

export interface StageTranscriptGroup {
  id: string;
  label: string;
  entries: TurnAgentConversationMessage[];
}

type TranscriptMetadata = NonNullable<TurnAgentConversationMessage["transcript"]>;
type TranscriptStance = TranscriptMetadata["stance"];

export function groupStageTranscriptMessages(messages: TurnAgentConversationMessage[]): StageTranscriptGroup[] {
  const byGroup = new Map<string, StageTranscriptGroup>();
  for (const message of messages.filter((item) => item.transcript)) {
    const transcript = message.transcript!;
    const group = byGroup.get(transcript.groupId) ?? {
      id: transcript.groupId,
      label: transcript.groupLabel ?? "Stage Transcript",
      entries: [],
    };
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

export function StageTranscript({ messages }: { messages: TurnAgentConversationMessage[] }) {
  const groups = groupStageTranscriptMessages(messages);
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const isDebateGroup = isDebateTranscriptGroup(group);
        return (
          <TaskList key={group.id}>
            <TaskListHeader>
              <div className="flex min-w-0 items-center gap-2">
                <MessagesSquare size={14} />
                <span className="font-medium text-foreground">{group.label}</span>
                <span className="truncate text-xs text-muted-foreground">{group.entries.length} 个阶段</span>
              </div>
            </TaskListHeader>
            <TaskListBody className={cn("border-l-0 pl-0", !isDebateGroup && "divide-y divide-border")}>
              {isDebateGroup ? (
                <DebateTranscriptBody entries={group.entries} />
              ) : (
                group.entries.map((message) => (
                  <StageTranscriptEntry key={message.id} message={message} />
                ))
              )}
            </TaskListBody>
          </TaskList>
        );
      })}
    </div>
  );
}

function isDebateTranscriptGroup(group: StageTranscriptGroup) {
  if (group.id === "debate") {
    return true;
  }

  const label = group.label.toLowerCase();
  const hasDebateLabel = label.includes("debate") || group.label.includes("辩论");
  const hasBothSides = group.entries.some((message) => message.transcript?.stance === "affirmative") &&
    group.entries.some((message) => message.transcript?.stance === "negative");

  return hasDebateLabel && hasBothSides;
}

function DebateTranscriptBody({ entries }: { entries: TurnAgentConversationMessage[] }) {
  return (
    <div className="space-y-4 px-1 py-3 sm:px-2">
      {entries.map((message) => (
        <DebateTranscriptRow key={message.id} message={message} />
      ))}
    </div>
  );
}

function DebateTranscriptRow({ message }: { message: TurnAgentConversationMessage }) {
  const transcript = message.transcript!;

  if (transcript.stance === "moderator" || transcript.stance === "neutral") {
    return <DebateModeratorRow message={message} />;
  }

  const isAffirmative = transcript.stance === "affirmative";

  return (
    <article>
      <div className="md:hidden">
        <DebateTranscriptCard message={message} />
      </div>
      <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)] md:items-start md:gap-4">
        <div className="min-w-0">
          {isAffirmative ? <DebateTranscriptCard message={message} align="left" /> : null}
        </div>
        <DebateRoundAxis message={message} />
        <div className="min-w-0">
          {!isAffirmative ? <DebateTranscriptCard message={message} align="right" /> : null}
        </div>
      </div>
    </article>
  );
}

function DebateModeratorRow({ message }: { message: TurnAgentConversationMessage }) {
  return (
    <article>
      <div className="md:hidden">
        <DebateTranscriptCard message={message} />
      </div>
      <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)] md:items-start md:gap-4">
        <div />
        <DebateRoundAxis message={message} />
        <div />
      </div>
      <div className="hidden md:block md:px-12 md:pt-2">
        <DebateTranscriptCard message={message} emphasis="summary" />
      </div>
    </article>
  );
}

function DebateRoundAxis({ message }: { message: TurnAgentConversationMessage }) {
  const transcript = message.transcript!;
  return (
    <div className="flex min-h-full flex-col items-center text-center">
      <div className="h-3 w-px bg-border" />
      <div className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold shadow-sm",
        stanceTone(transcript.stance),
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

function DebateTranscriptCard({
  message,
  align = "left",
  emphasis = "turn",
}: {
  message: TurnAgentConversationMessage;
  align?: "left" | "right";
  emphasis?: "turn" | "summary";
}) {
  const transcript = message.transcript!;
  const isSummary = emphasis === "summary";

  return (
    <section className={cn(
      "relative min-w-0 overflow-hidden rounded-2xl border bg-background/80 p-4 shadow-sm",
      debateCardTone(transcript.stance),
      isSummary && "mx-auto max-w-3xl border-violet-200 bg-violet-50/50",
    )}>
      <div className={cn(
        "absolute inset-y-0 w-1",
        transcript.stance === "negative" && !isSummary ? "right-0 bg-sky-400/70" : "left-0 bg-emerald-400/70",
        transcript.stance === "moderator" && "left-0 bg-violet-400/70",
        transcript.stance === "neutral" && "left-0 bg-border",
      )} />
      <div className={cn("flex items-start justify-between gap-3", align === "right" && !isSummary && "md:flex-row-reverse md:text-right")}>
        <div className="min-w-0 space-y-1">
          <div className={cn("flex flex-wrap items-center gap-2", align === "right" && !isSummary && "md:justify-end")}>
            <span className="text-sm font-semibold text-foreground">{isSummary ? "主持总结" : transcript.speakerLabel}</span>
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", stancePillTone(transcript.stance))}>
              {stanceLabel(transcript.stance)}
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
          stanceTone(transcript.stance),
        )}>
          {transcript.sequence + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{transcript.speakerLabel}</span>
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", stancePillTone(transcript.stance))}>
              {stanceLabel(transcript.stance)}
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

function stanceLabel(stance: TranscriptStance) {
  switch (stance) {
    case "affirmative":
      return "正方";
    case "negative":
      return "反方";
    case "moderator":
      return "主持";
    case "neutral":
      return "中立";
  }
}

function stanceTone(stance: TranscriptStance) {
  switch (stance) {
    case "affirmative":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "negative":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "moderator":
      return "border-violet-200 bg-violet-50 text-violet-800";
    case "neutral":
      return "border-border bg-muted/35 text-foreground";
  }
}

function stancePillTone(stance: TranscriptStance) {
  switch (stance) {
    case "affirmative":
      return "bg-emerald-50 text-emerald-800";
    case "negative":
      return "bg-sky-50 text-sky-800";
    case "moderator":
      return "bg-violet-50 text-violet-800";
    case "neutral":
      return "bg-muted text-muted-foreground";
  }
}

function debateCardTone(stance: TranscriptStance) {
  switch (stance) {
    case "affirmative":
      return "border-emerald-200/80 bg-emerald-50/30";
    case "negative":
      return "border-sky-200/80 bg-sky-50/30";
    case "moderator":
      return "border-violet-200/80 bg-violet-50/30";
    case "neutral":
      return "border-border bg-muted/25";
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
