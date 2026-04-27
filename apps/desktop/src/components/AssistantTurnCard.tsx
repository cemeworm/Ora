import { useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  AtSign,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  FileImage,
  FileText,
  GitBranch,
  ListTodo,
  LoaderCircle,
  MessageSquareWarning,
  Reply,
  Send,
} from "lucide-react";
import type { AssistantTurnAttachment, TurnAgentConversationMessage, TurnArtifactAttachment, TurnProcessStep, TurnTodoItem } from "../types";
import { cn } from "../lib/utils";
import { Message, MessageContent } from "./ai-elements/message";
import { Artifact, ArtifactActions, ArtifactDescription, ArtifactHeader, ArtifactTitle } from "./ai-elements/artifact";
import { TaskItem, TaskItemMeta, TaskList, TaskListBody, TaskListHeader } from "./ai-elements/task";
import { MarkdownContent } from "./MarkdownContent";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

interface AssistantTurnCardProps {
  content: string;
  turn?: AssistantTurnAttachment;
  isPlaceholder?: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  onSubmitFeedback?: (params: { turn: AssistantTurnAttachment; feedbackText: string }) => Promise<void>;
}

export function AssistantTurnCard({ content, turn, isPlaceholder = false, onOpenArtifact, onSubmitFeedback }: AssistantTurnCardProps) {
  const processSteps = turn?.processSteps ?? [];
  const agentMessages = turn?.agentMessages ?? [];
  const processNeedsAttention =
    turn?.status === "failed" ||
    turn?.status === "approval_required" ||
    processSteps.some((step) => step.status === "blocked");
  const processShouldOpen =
    isPlaceholder ||
    turn?.status === "running" ||
    processSteps.some((step) => step.status === "active") ||
    processNeedsAttention;
  const [processOpen, setProcessOpen] = useState(processShouldOpen);
  const [todosOpen, setTodosOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackError, setFeedbackError] = useState<string | undefined>(undefined);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const hasProcessSteps = processSteps.length > 0;
  const hasVisibleAgentMessages = visibleAgentMessages(agentMessages, turn?.status).length > 0;
  const canSubmitFeedback = Boolean(turn && onSubmitFeedback && !isPlaceholder && turn.status !== "running" && content.trim());

  useEffect(() => {
    setProcessOpen(processShouldOpen);
  }, [processShouldOpen]);

  async function handleSubmitFeedback() {
    if (!turn || !onSubmitFeedback || !feedbackText.trim()) {
      return;
    }
    setFeedbackSubmitting(true);
    setFeedbackError(undefined);
    try {
      await onSubmitFeedback({ turn, feedbackText: feedbackText.trim() });
      setFeedbackText("");
      setFeedbackOpen(false);
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : "Feedback submission failed.");
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  return (
    <Message from="assistant" className="w-full">
      <div className="flex max-w-full gap-3">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs",
            hasProcessSteps ? "mt-[13px]" : "mt-1",
          )}
        >
          <TurnStatusIcon status={turn?.status} isPlaceholder={isPlaceholder} />
        </div>
        <div className="min-w-0 flex-1 space-y-3 pt-1">
          {hasProcessSteps ? (
            <CollapsibleCard
              open={processOpen}
              onToggle={() => setProcessOpen((current) => !current)}
              title="运行进度"
              icon={<Clock3 size={14} />}
              summary={processSummary(processSteps, turn?.status, isPlaceholder)}
            >
              {processSteps.map((step) => (
                <ProcessStepItem key={step.id} step={step} />
              ))}
            </CollapsibleCard>
          ) : null}

          {hasVisibleAgentMessages ? (
            <AgentConversationTimeline messages={agentMessages} status={turn?.status} isPlaceholder={isPlaceholder} />
          ) : null}

          <MessageContent className="w-full">
            <MarkdownContent content={content} className={cn(isPlaceholder && "text-muted-foreground")} />
          </MessageContent>

          {turn && turn.artifacts.length > 0 ? (
            <div className="space-y-3">
              {turn.artifacts.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} onOpenArtifact={onOpenArtifact} />
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

          {canSubmitFeedback ? (
            <div className="flex">
              <button
                type="button"
                onClick={() => setFeedbackOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-accent/35 hover:text-foreground"
              >
                <MessageSquareWarning size={13} />
                Feedback
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="w-full max-w-lg">
          <DialogHeader>
            <DialogTitle>Feedback</DialogTitle>
          </DialogHeader>
          <textarea
            value={feedbackText}
            onChange={(event) => setFeedbackText(event.target.value)}
            placeholder="Describe what was wrong, missing, confusing, or should be evaluated next time."
            className="min-h-32 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-bench-900/15"
          />
          {feedbackError ? <p className="mt-2 text-xs text-red-700">{feedbackError}</p> : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setFeedbackOpen(false)}
              className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm font-medium"
              disabled={feedbackSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmitFeedback()}
              disabled={!feedbackText.trim() || feedbackSubmitting}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-bench-900 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {feedbackSubmitting ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
              Submit
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Message>
  );
}

function AgentConversationTimeline({
  messages,
  status,
  isPlaceholder,
}: {
  messages: TurnAgentConversationMessage[];
  status?: AssistantTurnAttachment["status"];
  isPlaceholder: boolean;
}) {
  const conversationActive = isPlaceholder || status === "running" || messages.some((message) => message.status === "running");
  const [open, setOpen] = useState(conversationActive);
  const byId = new Map(messages.map((message) => [message.id, message]));
  const visibleMessages = visibleAgentMessages(messages, status);

  useEffect(() => {
    if (!conversationActive) {
      setOpen(false);
      return;
    }
    setOpen(true);
  }, [conversationActive]);

  return (
    <TaskList>
      <button type="button" onClick={() => setOpen((current) => !current)} className="w-full text-left" aria-expanded={open}>
        <TaskListHeader>
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch size={14} />
            <span className="font-medium text-foreground">协作轨迹</span>
            <span className="truncate text-xs text-muted-foreground">{agentConversationSummary(messages)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
          </div>
        </TaskListHeader>
      </button>
      {open ? (
        <TaskListBody className="max-h-[min(70vh,42rem)] divide-y divide-border overflow-y-auto overscroll-contain border-l-0 pl-0">
          {visibleMessages.map((message) => (
            <AgentConversationItem
              key={message.id}
              message={message}
              replyTo={message.replyToId ? byId.get(message.replyToId) : undefined}
              spacious
            />
          ))}
        </TaskListBody>
      ) : null}
    </TaskList>
  );
}

function AgentConversationItem({
  message,
  replyTo,
  spacious = false,
}: {
  message: TurnAgentConversationMessage;
  replyTo?: TurnAgentConversationMessage;
  spacious?: boolean;
}) {
  return (
    <div className={cn(spacious ? "px-4 py-4" : "px-3 py-3", message.replyToId && (spacious ? "pl-10" : "pl-8"))}>
      {replyTo ? (
        <div className="mb-2 border-l-2 border-border pl-2 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">{replyTo.fromAgentLabel}</span>
          <span className="break-words">: {spacious ? replyTo.content : truncate(replyTo.content, 120)}</span>
        </div>
      ) : null}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/35 text-xs font-semibold text-foreground">
          {initials(message.fromAgentLabel)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{message.fromAgentLabel}</span>
            <KindPill message={message} />
            {message.toAgentLabels.map((label, index) => (
              <span key={`${message.id}:to:${message.toAgentIds[index] ?? label}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <AtSign size={11} />
                {label}
              </span>
            ))}
            <span className="text-xs text-muted-foreground">{message.timestamp}</span>
          </div>
          <p className={cn("mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-foreground [overflow-wrap:anywhere]", spacious && "leading-7")}>{message.content}</p>
          {(message.topic || message.correlationId) ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {message.topic ? <span>topic: {message.topic}</span> : null}
              {message.correlationId ? <span>correlation: {message.correlationId}</span> : null}
            </div>
          ) : null}
        </div>
        <AgentMessageStatusIcon status={message.status} />
      </div>
    </div>
  );
}

function KindPill({ message }: { message: TurnAgentConversationMessage }) {
  const icon = message.kind === "reply"
    ? <Reply size={11} />
    : message.kind === "route"
      ? <GitBranch size={11} />
      : <AtSign size={11} />;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {icon}
      {agentMessageDisplayKind(message)}
    </span>
  );
}

function AgentMessageStatusIcon({ status }: { status: TurnAgentConversationMessage["status"] }) {
  if (status === "failed") {
    return <AlertCircle size={14} className="mt-1 shrink-0 text-amber-600" />;
  }
  if (status === "running") {
    return <LoaderCircle size={14} className="mt-1 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (status === "done") {
    return <CheckCircle2 size={14} className="mt-1 shrink-0 text-emerald-600" />;
  }
  return <Circle size={14} className="mt-1 shrink-0 text-muted-foreground" />;
}

function initials(value: string): string {
  return value
    .split(/[\s_-]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "A";
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function TurnStatusIcon({ status, isPlaceholder }: { status?: AssistantTurnAttachment["status"]; isPlaceholder: boolean }) {
  if (status === "approval_required") {
    return <AlertCircle size={14} className="text-amber-600" />;
  }
  if (status === "failed") {
    return <AlertCircle size={14} className="text-rose-600" />;
  }
  if (status === "done") {
    return <CheckCircle2 size={14} />;
  }
  if (isPlaceholder || status === "running") {
    return <LoaderCircle size={14} className="animate-spin" />;
  }
  return <CheckCircle2 size={14} />;
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

function ArtifactCard({ artifact, onOpenArtifact }: { artifact: TurnArtifactAttachment; onOpenArtifact?: (artifactId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpenArtifact?.(artifact.id)}
      className="block w-full text-left"
      disabled={!onOpenArtifact}
    >
      <Artifact className={cn("transition", onOpenArtifact && "hover:bg-accent/25 active:scale-[0.995]")}>
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
            <span className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
              Preview
            </span>
          </ArtifactActions>
        </ArtifactHeader>
      </Artifact>
    </button>
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

export function processSummary(steps: TurnProcessStep[], status?: AssistantTurnAttachment["status"], isPlaceholder = false) {
  if ((status === "running" || isPlaceholder) && steps.length > 0) {
    let latestActiveStep: TurnProcessStep | undefined;
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      if (steps[index]?.status === "active") {
        latestActiveStep = steps[index];
        break;
      }
    }
    const currentStep = latestActiveStep ?? steps[steps.length - 1];
    const currentAction = currentStep?.detail.trim() || currentStep?.label.trim();
    if (currentAction) {
      return `正在：${currentAction}`;
    }
  }

  const active = steps.filter((step) => step.status === "active").length;
  const blocked = steps.filter((step) => step.status === "blocked").length;
  if (active > 0) {
    return `${active} 个进行中`;
  }
  if (blocked > 0) {
    return `${blocked} 个需处理`;
  }
  return `${steps.length} 条记录`;
}

function todoSummary(todos: TurnTodoItem[]) {
  const done = todos.filter((todo) => todo.status === "done").length;
  return `${done}/${todos.length} done`;
}

export function agentConversationSummary(messages: TurnAgentConversationMessage[]): string {
  const agentLabels = new Set<string>();
  for (const message of messages) {
    agentLabels.add(message.fromAgentLabel);
    for (const label of message.toAgentLabels) {
      agentLabels.add(label);
    }
  }
  const handoffCount = highValueAgentMessages(messages).length || messages.filter((message) => message.content.trim()).length;
  if (agentLabels.size > 0 && handoffCount > 0) {
    return `${agentLabels.size} 个 agent，${handoffCount} 次交接`;
  }
  if (agentLabels.size > 0) {
    return `${agentLabels.size} 个 agent`;
  }
  return `${messages.length} 条记录`;
}

export function visibleAgentMessages(
  messages: TurnAgentConversationMessage[],
  status?: AssistantTurnAttachment["status"],
): TurnAgentConversationMessage[] {
  const highValueMessages = highValueAgentMessages(messages);
  const displayMessages = highValueMessages.length > 0
    ? highValueMessages
    : messages.filter((message) => message.content.trim() && message.kind !== "publish" && message.kind !== "status");

  if (status === "running") {
    return displayMessages.slice(-2);
  }
  return displayMessages;
}

export function agentMessageDisplayKind(message: TurnAgentConversationMessage): string {
  switch (message.kind) {
    case "handoff":
      return "交接";
    case "reply":
      return "回复";
    case "route":
      return "路由";
    case "mention":
      return "提及";
    case "publish":
      return "发布";
    case "status":
      return "状态";
  }
}

function highValueAgentMessages(messages: TurnAgentConversationMessage[]): TurnAgentConversationMessage[] {
  return messages.filter((message) =>
    message.content.trim().length > 0 &&
    (message.kind === "handoff" || message.kind === "reply" || message.kind === "route")
  );
}
