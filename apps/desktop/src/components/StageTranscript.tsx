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
      {groups.map((group) => (
        <TaskList key={group.id}>
          <TaskListHeader>
            <div className="flex min-w-0 items-center gap-2">
              <MessagesSquare size={14} />
              <span className="font-medium text-foreground">{group.label}</span>
              <span className="truncate text-xs text-muted-foreground">{group.entries.length} 个阶段</span>
            </div>
          </TaskListHeader>
          <TaskListBody className="divide-y divide-border border-l-0 pl-0">
            {group.entries.map((message) => (
              <StageTranscriptEntry key={message.id} message={message} />
            ))}
          </TaskListBody>
        </TaskList>
      ))}
    </div>
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

function stanceLabel(stance: NonNullable<TurnAgentConversationMessage["transcript"]>["stance"]) {
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

function stanceTone(stance: NonNullable<TurnAgentConversationMessage["transcript"]>["stance"]) {
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

function stancePillTone(stance: NonNullable<TurnAgentConversationMessage["transcript"]>["stance"]) {
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

function TranscriptStatusIcon({ status }: { status: NonNullable<TurnAgentConversationMessage["transcript"]>["status"] }) {
  if (status === "running") {
    return <LoaderCircle size={14} className="mt-1 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (status === "done") {
    return <CheckCircle2 size={14} className="mt-1 shrink-0 text-emerald-600" />;
  }
  return <Circle size={14} className="mt-1 shrink-0 text-muted-foreground" />;
}
