import { useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  FileImage,
  FileText,
  ListTodo,
  LoaderCircle,
  Paperclip,
} from "lucide-react";
import type { AssistantTurnAttachment, TurnArtifactAttachment, TurnProcessStep, TurnTodoItem } from "../types";
import { cn } from "../lib/utils";
import { Message, MessageContent } from "./ai-elements/message";
import { Artifact, ArtifactActions, ArtifactContent, ArtifactDescription, ArtifactHeader, ArtifactTitle } from "./ai-elements/artifact";
import { TaskItem, TaskItemMeta, TaskList, TaskListBody, TaskListHeader } from "./ai-elements/task";

interface AssistantTurnCardProps {
  content: string;
  timestamp: string;
  turn?: AssistantTurnAttachment;
  isPlaceholder?: boolean;
}

export function AssistantTurnCard({ content, timestamp, turn, isPlaceholder = false }: AssistantTurnCardProps) {
  const [processOpen, setProcessOpen] = useState(false);
  const [todosOpen, setTodosOpen] = useState(false);

  const statusToneClassName = useMemo(() => {
    switch (turn?.status) {
      case "done":
        return "bg-emerald-50 text-emerald-700 ring-emerald-200";
      case "approval_required":
        return "bg-amber-50 text-amber-700 ring-amber-200";
      case "failed":
        return "bg-rose-50 text-rose-700 ring-rose-200";
      default:
        return "bg-muted text-muted-foreground ring-border";
    }
  }, [turn?.status]);

  return (
    <Message from="assistant" className="w-full">
      <div className="flex max-w-full gap-3">
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs">
          {isPlaceholder ? <LoaderCircle size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <MessageContent className="w-full">
            <p className={cn("whitespace-pre-wrap break-words", isPlaceholder && "text-muted-foreground")}>{content}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>{timestamp}</span>
              {turn ? (
                <span className={cn("rounded-full px-2 py-0.5 ring-1 ring-inset", statusToneClassName)}>
                  {turn.status.replace(/_/g, " ")}
                </span>
              ) : null}
              {turn?.approvalCount ? <span>{turn.approvalCount} approval gate</span> : null}
              {turn?.clarificationCount ? <span>{turn.clarificationCount} clarification</span> : null}
            </div>
          </MessageContent>

          {turn && turn.processSteps.length > 0 ? (
            <CollapsibleCard
              open={processOpen}
              onToggle={() => setProcessOpen((current) => !current)}
              title={`Steps ${turn.processSteps.length}`}
              icon={<Clock3 size={14} />}
              summary={processSummary(turn.processSteps)}
            >
              {turn.processSteps.map((step) => (
                <ProcessStepItem key={step.id} step={step} />
              ))}
            </CollapsibleCard>
          ) : null}

          {turn && turn.artifacts.length > 0 ? (
            <div className="space-y-3">
              {turn.artifacts.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} />
              ))}
            </div>
          ) : null}

          {turn && turn.todos.length > 0 ? (
            <CollapsibleCard
              open={todosOpen}
              onToggle={() => setTodosOpen((current) => !current)}
              title={`To-dos ${turn.todos.length}`}
              icon={<ListTodo size={14} />}
              summary={todoSummary(turn.todos)}
            >
              {turn.todos.map((todo) => (
                <TodoItemRow key={todo.id} todo={todo} />
              ))}
            </CollapsibleCard>
          ) : null}
        </div>
      </div>
    </Message>
  );
}

function CollapsibleCard({
  open,
  onToggle,
  title,
  icon,
  summary,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  icon: ReactNode;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <TaskList>
      <button type="button" onClick={onToggle} className="w-full text-left">
        <TaskListHeader>
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            <span className="font-medium text-foreground">{title}</span>
            {summary ? <span className="truncate text-xs text-muted-foreground">{summary}</span> : null}
          </div>
          <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
        </TaskListHeader>
      </button>
      {open ? <TaskListBody>{children}</TaskListBody> : null}
    </TaskList>
  );
}

function ProcessStepItem({ step }: { step: TurnProcessStep }) {
  const toneClassName =
    step.tone === "warning"
      ? "text-amber-700"
      : step.tone === "accent"
        ? "text-emerald-700"
        : "text-foreground";

  return (
    <TaskItem className="relative">
      <div className="absolute -left-[1.05rem] top-3 h-2 w-2 rounded-full bg-border" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("font-medium", toneClassName)}>{step.label}</p>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{step.detail}</p>
          <TaskItemMeta>
            <span>{step.timestamp}</span>
            {step.contextLabel ? <span className="rounded-full bg-background px-2 py-0.5 ring-1 ring-inset ring-border">{step.contextLabel}</span> : null}
          </TaskItemMeta>
        </div>
        <StepStatusIcon step={step} />
      </div>
    </TaskItem>
  );
}

function StepStatusIcon({ step }: { step: TurnProcessStep }) {
  if (step.status === "blocked") {
    return <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-600" />;
  }
  if (step.status === "active") {
    return <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" />;
  }
  return <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />;
}

function ArtifactCard({ artifact }: { artifact: TurnArtifactAttachment }) {
  return (
    <Artifact>
      <ArtifactHeader>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/35 text-muted-foreground">
            {artifact.previewable ? <FileImage size={18} /> : <FileText size={18} />}
          </div>
          <div className="min-w-0">
            <ArtifactTitle className="truncate">{artifact.label}</ArtifactTitle>
            <ArtifactDescription>{artifact.kind} - {artifact.mimeType}</ArtifactDescription>
          </div>
        </div>
        <ArtifactActions>
          {artifact.uri ? (
            <a
              href={artifact.uri}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            >
              <Paperclip size={12} />
              Open
            </a>
          ) : null}
        </ArtifactActions>
      </ArtifactHeader>
      <ArtifactContent className="text-xs text-muted-foreground">
        Produced at {artifact.createdAt}.
      </ArtifactContent>
    </Artifact>
  );
}

function TodoItemRow({ todo }: { todo: TurnTodoItem }) {
  return (
    <TaskItem className="flex items-start gap-3">
      <TodoStatusIcon status={todo.status} />
      <div className="min-w-0 flex-1">
        <p className={cn("font-medium", todo.status === "done" && "text-muted-foreground line-through")}>{todo.label}</p>
        <TaskItemMeta>
          <span>{todo.status}</span>
          {todo.owner ? <span>{todo.owner}</span> : null}
          {todo.detail ? <span>{todo.detail}</span> : null}
        </TaskItemMeta>
      </div>
    </TaskItem>
  );
}

function TodoStatusIcon({ status }: { status: TurnTodoItem["status"] }) {
  switch (status) {
    case "done":
      return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />;
    case "running":
      return <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" />;
    case "blocked":
      return <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />;
    default:
      return <Circle size={16} className="mt-0.5 shrink-0 text-muted-foreground" />;
  }
}

function processSummary(steps: TurnProcessStep[]) {
  const active = steps.filter((step) => step.status === "active").length;
  const blocked = steps.filter((step) => step.status === "blocked").length;
  if (active > 0) {
    return `${active} active`;
  }
  if (blocked > 0) {
    return `${blocked} blocked`;
  }
  return `${steps.length} recorded`;
}

function todoSummary(todos: TurnTodoItem[]) {
  const done = todos.filter((todo) => todo.status === "done").length;
  return `${done}/${todos.length} done`;
}
