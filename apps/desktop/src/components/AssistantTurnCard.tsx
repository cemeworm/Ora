import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileImage,
  FileText,
  FolderOpen,
  ListTodo,
  LoaderCircle,
  MessageSquareWarning,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import type {
  AssistantTurnAttachment,
  ReviewGateInfo,
  TurnArtifactAttachment,
  TurnClarificationExchange,
  TurnFileChangeAttachment,
  TurnProcessStep,
  TurnTimelineItem,
} from "../types";
import { cn } from "../lib/utils";
import { Message, MessageContent } from "./ai-elements/message";
import {
  Artifact,
  ArtifactActions,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "./ai-elements/artifact";
import {
  TaskItem,
  TaskItemMeta,
  TaskList,
  TaskListBody,
  TaskListHeader,
} from "./ai-elements/task";
import { MarkdownContent } from "./MarkdownContent";
import { PlanCard } from "./PlanCard";
import { SourcesPopover } from "./SourcesPopover";
import { StageTranscript } from "./StageTranscript";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ContextMenu, type ContextMenuItem } from "./ui/context-menu";

interface AssistantTurnCardProps {
  content: string;
  turn?: AssistantTurnAttachment;
  isPlaceholder?: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  onSubmitFeedback?: (params: {
    turn: AssistantTurnAttachment;
    feedbackText: string;
  }) => Promise<void>;
  projectRootPath?: string;
}

export const AssistantTurnCard = memo(function AssistantTurnCard({
  content,
  turn,
  isPlaceholder = false,
  onOpenArtifact,
  onSubmitFeedback,
  projectRootPath,
}: AssistantTurnCardProps) {
  const processSteps = turn?.processSteps ?? [];
  const clarificationExchanges = turn?.clarificationExchanges ?? [];
  const agentMessages = turn?.agentMessages ?? [];
  const stageTranscriptMessages = agentMessages.filter(
    (message) => message.transcript,
  );
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackError, setFeedbackError] = useState<string | undefined>(
    undefined,
  );
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const bodyContent = shouldSuppressClarificationBody(content, clarificationExchanges)
    ? ""
    : content;
  const timelineItems = visibleTimelineItems(
    turn?.timelineItems ?? legacyTimelineItems(processSteps),
    turn,
    bodyContent,
    isPlaceholder,
  );
  const hasTimeline = timelineItems.length > 0;
  const hasStageTranscript = stageTranscriptMessages.length > 0;
  const visibleArtifacts = turn?.artifacts.filter(isContentArtifact) ?? [];
  const fileChanges = turn?.fileChanges ?? [];
  const artifactPathMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const fc of fileChanges) {
      if (fc.artifactId) {
        map.set(fc.artifactId, fc.path);
      }
    }
    return map;
  }, [fileChanges]);
  const canCopyContent = Boolean(
    !isPlaceholder && turn?.status !== "running" && bodyContent.trim(),
  );
  const canSubmitFeedback = Boolean(
    turn &&
    onSubmitFeedback &&
    !isPlaceholder &&
    turn.status !== "running" &&
    bodyContent.trim(),
  );
  const sources = turn?.sources ?? [];
  const canShowActions = canCopyContent || canSubmitFeedback || sources.length > 0;
  const currentAgentLabel = turn?.currentAgentLabel?.trim();
  const hasTimelineAgentLabel = timelineItems.some((item) => Boolean(timelineAgentLabel(item)));
  const timelineContainsAssistantBody = timelineItems.some((item) =>
    item.kind === "assistant_text" || item.kind === "final_text",
  );
  const showThinkingIndicator = shouldShowThinkingIndicator({
    isPlaceholder,
    turn,
  });

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
      setFeedbackError(
        error instanceof Error ? error.message : "Feedback submission failed.",
      );
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  async function handleCopyContent() {
    if (!bodyContent.trim()) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(bodyContent);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = bodyContent;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const copiedWithFallback = document.execCommand("copy");
        document.body.removeChild(textarea);

        if (!copiedWithFallback) {
          return;
        }
      }

      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Message from="assistant" className="w-full">
      <div className="max-w-full">
        <div className="min-w-0 flex-1 space-y-3 pt-1">
          {currentAgentLabel && !hasTimelineAgentLabel ? (
            <p className="text-sm font-semibold leading-6 text-foreground">
              {currentAgentLabel}
            </p>
          ) : null}

          {hasStageTranscript ? (
            <StageTranscript messages={stageTranscriptMessages} reviewGate={turn?.reviewGate} />
          ) : null}

          {turn?.reviewGate ? (
            <ReviewGateBanner gate={turn.reviewGate} />
          ) : null}

          {hasTimeline ? (
            <TurnTimeline
              items={timelineItems}
              activeLoadingItemId={
                turn?.activeLoadingTarget?.kind === "timeline"
                  ? turn.activeLoadingTarget.itemId
                  : undefined
              }
              onOpenArtifact={onOpenArtifact}
            />
          ) : null}

          {clarificationExchanges.length > 0 ? (
            <ClarificationExchangeList exchanges={clarificationExchanges} />
          ) : null}

          {turn?.proposedPlanStatus || (hasTimeline && timelineContainsAssistantBody) || !bodyContent.trim() ? null : (
            <MessageContent className="w-full">
              <MarkdownContent
                content={bodyContent}
                className={cn(isPlaceholder && "text-muted-foreground")}
                streaming={turn?.status === "running" || isPlaceholder}
              />
            </MessageContent>
          )}

          {turn?.hasProposedPlan && turn?.planContent ? (
            <PlanCard planSteps={turn.planList ?? []} planContent={turn.planContent} />
          ) : null}

          {showThinkingIndicator ? <ThinkingIndicator /> : null}

          {visibleArtifacts.length > 0 ? (
            <div className="space-y-3">
              {visibleArtifacts.map((artifact) => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  filePath={artifactPathMap.get(artifact.id) ?? artifact.label}
                  rootPath={projectRootPath}
                  onOpenArtifact={onOpenArtifact}
                />
              ))}
            </div>
          ) : null}

          {fileChanges.length > 0 ? (
            <FileChangeDiffPanel fileChanges={fileChanges} />
          ) : null}

          {canShowActions ? (
            <div className="flex items-center gap-1">
              {canCopyContent ? (
                <button
                  type="button"
                  onClick={() => void handleCopyContent()}
                  title={copied ? "已复制" : "复制"}
                  aria-label={copied ? "已复制" : "复制消息"}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              ) : null}
              {canSubmitFeedback ? (
                <button
                  type="button"
                  onClick={() => setFeedbackOpen(true)}
                  title="Feedback"
                  aria-label="Feedback"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                >
                  <MessageSquareWarning size={14} />
                </button>
              ) : null}
              {sources.length > 0 ? (
                <SourcesPopover sources={sources} />
              ) : null}
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
          {feedbackError ? (
            <p className="mt-2 text-xs text-red-700">{feedbackError}</p>
          ) : null}
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
              {feedbackSubmitting ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              Submit
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Message>
  );
});

function shouldSuppressClarificationBody(
  content: string,
  exchanges: TurnClarificationExchange[],
): boolean {
  const pendingQuestions = exchanges
    .filter((exchange) => exchange.status === "pending" && !exchange.answer)
    .map((exchange) => exchange.question.trim())
    .filter(Boolean);

  if (pendingQuestions.length === 0) {
    return false;
  }

  return normalizeComparableText(content) === normalizeComparableText(pendingQuestions.join("\n"));
}

function normalizeComparableText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function ClarificationExchangeList({
  exchanges,
}: {
  exchanges: TurnClarificationExchange[];
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      {exchanges.map((exchange) => (
        <div key={exchange.id} className="space-y-2">
          <div className="flex gap-2">
            <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-background text-[11px] font-semibold text-muted-foreground">
              Q
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-6 text-foreground">{exchange.question}</p>
              <p className="text-xs leading-5 text-muted-foreground">{exchange.requestedAt}</p>
            </div>
          </div>
          {exchange.answer ? (
            <div className="flex gap-2">
              <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-bench-900 text-[11px] font-semibold text-white">
                A
              </span>
              <div className="min-w-0 flex-1">
                <MarkdownContent content={exchange.answer} className="text-sm leading-6" />
                {exchange.answeredAt ? (
                  <p className="text-xs leading-5 text-muted-foreground">{exchange.answeredAt}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="pl-7 text-xs leading-5 text-muted-foreground">等待补充信息</p>
          )}
        </div>
      ))}
    </div>
  );
}

function legacyTimelineItems(processSteps: TurnProcessStep[]): TurnTimelineItem[] {
  if (processSteps.length === 0) {
    return [];
  }
  const latest = processSteps[processSteps.length - 1];
  const summaryParts = [
    latest?.eventType === "agent.handoff" ? latest.label : undefined,
    latest?.detail || (latest?.eventType === "agent.handoff" ? undefined : latest?.label),
    latest?.contextLabel ? `对象：${latest.contextLabel}` : undefined,
    latest?.eventType === "agent.handoff" ? "交接" : undefined,
  ].filter(Boolean);
  return [{
    id: `legacy-status:${latest?.id ?? "process"}`,
    kind: "status_group",
    summary: summaryParts.join(" ") || `${processSteps.length} 条执行状态`,
    steps: processSteps,
    timestamp: latest?.timestamp ?? "",
    status: legacyTimelineStatus(processSteps),
  }];
}

function legacyTimelineStatus(processSteps: TurnProcessStep[]): TurnProcessStep["status"] {
  if (processSteps.some((step) => step.status === "blocked")) {
    return "blocked";
  }
  if (processSteps.some((step) => step.status === "active")) {
    return "active";
  }
  return "complete";
}

function shouldShowThinkingIndicator({
  isPlaceholder,
  turn,
}: {
  isPlaceholder: boolean;
  turn?: AssistantTurnAttachment;
}) {
  if (turn) {
    return turn.activeLoadingTarget?.kind === "thinking";
  }
  if (isPlaceholder) {
    return true;
  }
  return false;
}

function visibleTimelineItems(
  items: TurnTimelineItem[],
  turn: AssistantTurnAttachment | undefined,
  bodyContent: string,
  isPlaceholder: boolean,
): TurnTimelineItem[] {
  if (
    turn?.status === "running" ||
    isPlaceholder ||
    !bodyContent.trim() ||
    items.some((item) => item.kind === "assistant_text" || item.kind === "final_text")
  ) {
    return items;
  }

  const latestNonStatusIndex = findLatestNonStatusTimelineIndex(items);
  return items.filter((item, index) => (
    item.kind !== "status_group" ||
    item.status !== "complete" ||
    !isTrivialCompletedStatusGroup(item) ||
    index < latestNonStatusIndex
  ));
}

function findLatestNonStatusTimelineIndex(items: TurnTimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind !== "status_group") {
      return index;
    }
  }
  return -1;
}

function isTrivialCompletedStatusGroup(
  item: Extract<TurnTimelineItem, { kind: "status_group" }>,
): boolean {
  const normalizedSummary = item.summary.trim();
  if (normalizedSummary !== "已完成") {
    return false;
  }
  return item.steps.every((step) =>
    [step.label, step.detail].every((text) => !text.trim() || text.trim() === "已完成"),
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle size={14} className="animate-spin" />
      <span>正在思考</span>
    </div>
  );
}

function TurnTimeline({
  items,
  activeLoadingItemId,
  onOpenArtifact,
}: {
  items: TurnTimelineItem[];
  activeLoadingItemId?: string;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const groups = groupTimelineItemsByAgent(items);
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.id} className="space-y-2">
          {group.agentLabel ? (
            <p className="text-sm font-semibold leading-6 text-foreground">
              {group.agentLabel}
            </p>
          ) : null}
          <div className="space-y-3">
            {group.items.map((item) => (
              <TurnTimelineRow
                key={item.id}
                item={item}
                showProgressLoading={activeLoadingItemId === item.id}
                onOpenArtifact={onOpenArtifact}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function groupTimelineItemsByAgent(items: TurnTimelineItem[]): Array<{
  id: string;
  agentLabel?: string;
  items: TurnTimelineItem[];
}> {
  const groups: Array<{ id: string; agentLabel?: string; items: TurnTimelineItem[] }> = [];
  for (const item of items) {
    const agentLabel = timelineAgentLabel(item);
    const latest = groups.at(-1);
    if (latest && latest.agentLabel === agentLabel) {
      latest.items.push(item);
      continue;
    }
    groups.push({
      id: `${item.id}:group`,
      agentLabel,
      items: [item],
    });
  }
  return groups;
}

function timelineAgentLabel(item: TurnTimelineItem): string | undefined {
  if (item.kind === "agent_message") {
    return item.agentLabel ?? item.fromAgentLabel;
  }
  return item.agentLabel;
}

function TurnTimelineRow({
  item,
  showProgressLoading = false,
  onOpenArtifact,
}: {
  item: TurnTimelineItem;
  showProgressLoading?: boolean;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  switch (item.kind) {
    case "assistant_text":
    case "final_text":
      return (
        <MessageContent className="w-full">
          <MarkdownContent content={item.content} />
        </MessageContent>
      );
    case "agent_message":
      return <AgentMessageTimelineItem item={item} />;
    case "status_group":
      return <TimelineStatusGroup item={item} showProgressLoading={showProgressLoading} />;
    case "artifact": {
      const content = (
        <InlineTimelineMeta icon={<FileText size={14} />}>
          {item.summary}
        </InlineTimelineMeta>
      );
      if (item.artifactId && onOpenArtifact) {
        return (
          <button type="button" onClick={() => onOpenArtifact(item.artifactId!)} className="block w-full text-left">
            {content}
          </button>
        );
      }
      return content;
    }
    case "plan_update":
      return (
        <InlineTimelineMeta icon={<ListTodo size={14} />}>
          {item.summary}
        </InlineTimelineMeta>
      );
  }
}

function AgentMessageTimelineItem({
  item,
}: {
  item: Extract<TurnTimelineItem, { kind: "agent_message" }>;
}) {
  return (
    <div className="space-y-1">
      <MessageContent className="w-full">
        <MarkdownContent content={item.content} />
      </MessageContent>
    </div>
  );
}

function TimelineStatusGroup({
  item,
  showProgressLoading = false,
}: {
  item: Extract<TurnTimelineItem, { kind: "status_group" }>;
  showProgressLoading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = item.status === "active" || showProgressLoading;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="group flex w-full items-center gap-3 text-left"
      >
        <InlineTimelineMeta
          icon={active ? <LoaderCircle size={14} className="animate-spin" /> : null}
        >
          {item.summary}
        </InlineTimelineMeta>
        <ChevronDown
          size={14}
          className={cn(
            "mr-1 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="ml-5 border-l border-border/70 pl-4">
          <div className="space-y-2">
            {item.steps.map((step) => (
              <ProcessStepItem key={step.id} step={step} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InlineTimelineMeta({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      {icon ? (
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function CollapsibleCard({
  open,
  onToggle,
  title,
  icon,
  summary,
  collapsedPreview,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  icon: ReactNode;
  summary?: string;
  collapsedPreview?: ReactNode;
  children: ReactNode;
}) {
  return (
    <TaskList>
      <button type="button" onClick={onToggle} className="w-full text-left">
        <TaskListHeader>
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            <span className="font-medium text-foreground">{title}</span>
            {summary ? (
              <span className="truncate text-xs text-muted-foreground">
                {summary}
              </span>
            ) : null}
          </div>
          <ChevronDown
            size={14}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </TaskListHeader>
      </button>
      {open ? (
        <TaskListBody>{children}</TaskListBody>
      ) : collapsedPreview ? (
        <TaskListBody>{collapsedPreview}</TaskListBody>
      ) : null}
    </TaskList>
  );
}

function ProcessStepItem({ step }: { step: TurnProcessStep }) {
  if (step.eventType === "agent.handoff") {
    return <HandoffStepItem step={step} />;
  }
  const detail = step.detail.trim();

  return (
    <TaskItem className="relative">
      <div className="absolute -left-[1.05rem] top-3.5 h-2 w-2 rounded-full bg-border" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{step.label}</p>
          {detail ? (
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
              {detail}
            </p>
          ) : null}
          <TaskItemMeta>
            {step.contextLabel ? <span>对象：{step.contextLabel}</span> : null}
            <span>{step.timestamp}</span>
          </TaskItemMeta>
        </div>
        <StepStatusIcon step={step} />
      </div>
    </TaskItem>
  );
}

function HandoffStepItem({ step }: { step: TurnProcessStep }) {
  const detail = step.detail.trim();

  return (
    <TaskItem className="relative">
      <div className="absolute -left-[1.05rem] top-3.5 h-2 w-2 rounded-full bg-border" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{step.label}</p>
          {detail ? (
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
              {detail}
            </p>
          ) : null}
          <TaskItemMeta>
            <span>交接</span>
            <span>{step.timestamp}</span>
          </TaskItemMeta>
        </div>
        <StepStatusIcon step={step} />
      </div>
    </TaskItem>
  );
}

function StepStatusIcon({ step }: { step: TurnProcessStep }) {
  if (step.status === "active") {
    return (
      <LoaderCircle
        size={14}
        className="mt-0.5 shrink-0 animate-spin text-muted-foreground"
      />
    );
  }
  return null;
}

function ArtifactCard({
  artifact,
  filePath,
  rootPath,
  onOpenArtifact,
}: {
  artifact: TurnArtifactAttachment;
  filePath?: string;
  rootPath?: string;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });

  const absolutePath = useMemo(() => {
    if (!rootPath || !filePath) return undefined;
    return rootPath.replace(/\/+$/, "") + "/" + filePath.replace(/^\/+/, "");
  }, [rootPath, filePath]);

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!absolutePath) return [];
    return [
      {
        label: "复制文件绝对路径",
        icon: <FolderOpen size={14} />,
        onClick: () => {
          void navigator.clipboard.writeText(absolutePath);
        },
      },
    ];
  }, [absolutePath]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!absolutePath) return;
      e.preventDefault();
      setContextMenu({ open: true, x: e.clientX, y: e.clientY });
    },
    [absolutePath],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenArtifact?.(artifact.id)}
        onContextMenu={handleContextMenu}
        className="block w-full text-left"
        disabled={!onOpenArtifact}
      >
        <Artifact
          className={cn(
            "transition",
            onOpenArtifact && "hover:bg-accent/25 active:scale-[0.995]",
          )}
        >
          <ArtifactHeader>
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/35 text-muted-foreground">
                {artifact.previewable ? (
                  <FileImage size={18} />
                ) : (
                  <FileText size={18} />
                )}
              </div>
              <div className="min-w-0">
                <ArtifactTitle className="truncate">
                  {artifact.label}
                </ArtifactTitle>
                <ArtifactDescription>
                  {artifact.kind} - {artifact.mimeType}
                </ArtifactDescription>
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
      <ContextMenu
        open={contextMenu.open}
        x={contextMenu.x}
        y={contextMenu.y}
        items={contextMenuItems}
        onClose={() => setContextMenu((prev) => ({ ...prev, open: false }))}
      />
    </>
  );
}

function FileChangeDiffPanel({
  fileChanges,
}: {
  fileChanges: TurnFileChangeAttachment[];
}) {
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set());
  const additions = fileChanges.reduce(
    (total, change) => total + change.additions,
    0,
  );
  const deletions = fileChanges.reduce(
    (total, change) => total + change.deletions,
    0,
  );

  function togglePath(path: string) {
    setOpenPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card/70 text-sm shadow-xs">
      <div className="flex h-10 items-center justify-between gap-3 bg-muted/35 px-3">
        <div className="min-w-0 font-medium text-foreground">
          <span>{fileChanges.length} 个文件已更改 </span>
          <span className="font-semibold text-emerald-700">+{additions}</span>
          <span className="mx-1 text-muted-foreground"> </span>
          <span className="font-semibold text-rose-700">-{deletions}</span>
        </div>
      </div>
      <div className="divide-y divide-border">
        {fileChanges.map((change) => {
          const open = openPaths.has(change.path);
          return (
            <div key={`${change.artifactId}:${change.path}`}>
              <button
                type="button"
                onClick={() => togglePath(change.path)}
                className="flex h-9 w-full items-center justify-between gap-3 bg-muted/55 px-3 text-left transition hover:bg-muted/75 active:scale-[0.998]"
              >
                <div className="min-w-0 truncate font-mono text-xs text-foreground">
                  {change.path}
                  <span className="ml-2 font-sans font-semibold text-emerald-700">
                    +{change.additions}
                  </span>
                  <span className="ml-1 font-sans font-semibold text-rose-700">
                    -{change.deletions}
                  </span>
                </div>
                <ChevronDown
                  size={14}
                  className={cn(
                    "shrink-0 text-muted-foreground transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>
              {open ? <DiffLines change={change} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DiffLines({ change }: { change: TurnFileChangeAttachment }) {
  const lines = buildLineDiff(change.beforeContent, change.afterContent).filter(
    (line) => line.kind !== "context",
  );
  return (
    <div className="max-h-[28rem] overflow-auto bg-background font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <div
          key={`${line.kind}:${line.beforeLine ?? ""}:${line.afterLine ?? ""}:${index}`}
          className={cn(
            "grid grid-cols-[3.25rem_1fr] border-l-2 pr-3",
            line.kind === "add" &&
              "border-emerald-500 bg-emerald-50/80 text-emerald-950",
            line.kind === "delete" &&
              "border-rose-400 bg-rose-50/80 text-rose-950",
            line.kind === "context" && "border-transparent text-foreground",
          )}
        >
          <span className="select-none px-3 text-right text-muted-foreground">
            {line.kind === "add" ? line.afterLine : line.beforeLine}
          </span>
          <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            <span
              className={cn(
                "mr-2 select-none",
                line.kind === "add" && "text-emerald-700",
                line.kind === "delete" && "text-rose-700",
              )}
            >
              {line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " "}
            </span>
            {line.text || " "}
          </span>
        </div>
      ))}
    </div>
  );
}

type DiffLine = {
  kind: "context" | "add" | "delete";
  text: string;
  beforeLine?: number;
  afterLine?: number;
};

function buildLineDiff(
  beforeContent: string,
  afterContent: string,
): DiffLine[] {
  const beforeLines = splitDiffLines(beforeContent);
  const afterLines = splitDiffLines(afterContent);
  const table = lcsTable(beforeLines, afterLines);
  const lines: DiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      lines.push({
        kind: "context",
        text: beforeLines[beforeIndex] ?? "",
        beforeLine: beforeIndex + 1,
        afterLine: afterIndex + 1,
      });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (
      (table[beforeIndex + 1]?.[afterIndex] ?? 0) >=
      (table[beforeIndex]?.[afterIndex + 1] ?? 0)
    ) {
      lines.push({
        kind: "delete",
        text: beforeLines[beforeIndex] ?? "",
        beforeLine: beforeIndex + 1,
      });
      beforeIndex += 1;
    } else {
      lines.push({
        kind: "add",
        text: afterLines[afterIndex] ?? "",
        afterLine: afterIndex + 1,
      });
      afterIndex += 1;
    }
  }
  while (beforeIndex < beforeLines.length) {
    lines.push({
      kind: "delete",
      text: beforeLines[beforeIndex] ?? "",
      beforeLine: beforeIndex + 1,
    });
    beforeIndex += 1;
  }
  while (afterIndex < afterLines.length) {
    lines.push({
      kind: "add",
      text: afterLines[afterIndex] ?? "",
      afterLine: afterIndex + 1,
    });
    afterIndex += 1;
  }
  return lines;
}

function splitDiffLines(content: string): string[] {
  if (!content) {
    return [];
  }
  return content.split(/\r?\n/);
}

function lcsTable(beforeLines: string[], afterLines: string[]): number[][] {
  const table = Array.from({ length: beforeLines.length + 1 }, () =>
    new Array(afterLines.length + 1).fill(0),
  );
  for (
    let beforeIndex = beforeLines.length - 1;
    beforeIndex >= 0;
    beforeIndex -= 1
  ) {
    for (
      let afterIndex = afterLines.length - 1;
      afterIndex >= 0;
      afterIndex -= 1
    ) {
      table[beforeIndex]![afterIndex] =
        beforeLines[beforeIndex] === afterLines[afterIndex]
          ? (table[beforeIndex + 1]?.[afterIndex + 1] ?? 0) + 1
          : Math.max(
              table[beforeIndex + 1]?.[afterIndex] ?? 0,
              table[beforeIndex]?.[afterIndex + 1] ?? 0,
            );
    }
  }
  return table;
}

function isContentArtifact(artifact: TurnArtifactAttachment): boolean {
  return artifact.label !== "Recovery artifact";
}

function ReviewGateBanner({ gate }: { gate: ReviewGateInfo }) {
  const { reviewVerdict, verificationBlocked, reviewReworkCount, reviewIssues, degradedDelivery } = gate;

  const isDegraded = degradedDelivery && reviewVerdict !== "pass";
  const config: {
    icon: ReactNode;
    label: string;
    bg: string;
    border: string;
    text: string;
    iconColor: string;
  } = isDegraded ? {
    icon: <AlertCircle size={16} />,
    label: reviewVerdict === "needs_fix"
      ? `降级交付 · 返工 ${reviewReworkCount}/2 轮未通过`
      : "降级交付 · 核查阻塞",
    bg: "bg-orange-50/70 dark:bg-orange-950/30",
    border: "border-orange-200 dark:border-orange-800/50",
    text: "text-orange-800 dark:text-orange-200",
    iconColor: "text-orange-600 dark:text-orange-400",
  } : {
    pass: {
      icon: <ShieldCheck size={16} />,
      label: "审查通过",
      bg: "bg-emerald-50/70 dark:bg-emerald-950/30",
      border: "border-emerald-200 dark:border-emerald-800/50",
      text: "text-emerald-800 dark:text-emerald-200",
      iconColor: "text-emerald-600 dark:text-emerald-400",
    },
    needs_fix: {
      icon: reviewReworkCount > 0 ? <RotateCcw size={16} /> : <AlertCircle size={16} />,
      label: reviewReworkCount > 0 ? `返工中 (${reviewReworkCount}/2)` : "需返工",
      bg: "bg-amber-50/70 dark:bg-amber-950/30",
      border: "border-amber-200 dark:border-amber-800/50",
      text: "text-amber-800 dark:text-amber-200",
      iconColor: "text-amber-600 dark:text-amber-400",
    },
    blocked: {
      icon: <ShieldX size={16} />,
      label: verificationBlocked ? "核查阻断" : "已阻塞",
      bg: "bg-red-50/70 dark:bg-red-950/30",
      border: "border-red-200 dark:border-red-800/50",
      text: "text-red-800 dark:text-red-200",
      iconColor: "text-red-600 dark:text-red-400",
    },
  }[reviewVerdict];

  return (
    <div className={cn("rounded-lg border px-4 py-3", config.bg, config.border)}>
      <div className="flex items-center gap-2.5">
        <span className={cn("shrink-0", config.iconColor)}>{config.icon}</span>
        <span className={cn("text-sm font-semibold", config.text)}>{config.label}</span>
      </div>
      {reviewIssues.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {reviewIssues.slice(0, 3).map((issue, index) => (
            <li key={index} className={cn("text-xs leading-5", config.text, "opacity-80")}>
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function processSummary(
  steps: TurnProcessStep[],
  status?: AssistantTurnAttachment["status"],
  isPlaceholder = false,
) {
  if (status === "running" || isPlaceholder) {
    return undefined;
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
