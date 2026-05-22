import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { FileText } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { AssistantTurnCard } from "./AssistantTurnCard";
import { BranchComparisonTurn } from "./BranchComparisonTurn";
import type { ActionRecord, AgentProfile, AssistantTurnAttachment, ChatMessage, PlanItem } from "../types";
import type { OraSessionBranchGroup, OraStateSnapshot } from "../lib/runtimeClient";
import { Conversation, ConversationContent } from "./ai-elements/conversation";
import { cn } from "../lib/utils";
import type { AppLanguage } from "../lib/i18n";
import {
  CHAT_SURFACE_FRAME_WIDTH_CLASS,
  CHAT_SURFACE_SCROLLBAR_COMPENSATION_CLASS,
  CHAT_SURFACE_VIEWPORT_GUTTER_CLASS,
} from "./chatSurfaceLayout";

interface ChatMessagesProps {
  chatMessages: ChatMessage[];
  branchGroups?: OraSessionBranchGroup[];
  turnSnapshots?: Record<string, OraStateSnapshot | undefined>;
  language?: AppLanguage;
  agents?: AgentProfile[];
  actionRecords?: ActionRecord[];
  planItems?: PlanItem[];
  hasApprovalTray?: boolean;
  hasClarificationTray?: boolean;
  hasPlanDecisionTray?: boolean;
  hasPlanStepsTray?: boolean;
  bottomInsetPx?: number;
  surfaceFrameWidthClassName?: string;
  onOpenArtifact?: (artifactId: string) => void;
  onSubmitFeedback?: (message: ChatMessage, feedbackText: string) => Promise<void>;
  onAdoptBranchGroup?: (branchGroupId: string, runId: string) => void;
  projectRootPath?: string;
}

export const CHAT_MESSAGES_SCROLL_CLASS =
  `h-full min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto overscroll-contain ${CHAT_SURFACE_SCROLLBAR_COMPENSATION_CLASS}`;

const EMPTY_BRANCH_GROUPS: OraSessionBranchGroup[] = [];
const EMPTY_TURN_SNAPSHOTS: Record<string, OraStateSnapshot | undefined> = {};
const EMPTY_ACTION_RECORDS: ActionRecord[] = [];

export function messageBottomPaddingPx({
  hasTray,
  bottomInsetPx,
}: {
  hasTray: boolean;
  bottomInsetPx?: number;
}): number {
  const fallback = hasTray ? 240 : 176;
  if (typeof bottomInsetPx !== "number" || !Number.isFinite(bottomInsetPx) || bottomInsetPx <= 0) {
    return fallback;
  }
  return Math.max(Math.ceil(bottomInsetPx) + 24, fallback);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ChatMessages = memo(function ChatMessages({
  chatMessages,
  branchGroups = EMPTY_BRANCH_GROUPS,
  turnSnapshots = EMPTY_TURN_SNAPSHOTS,
  language = "zh",
  agents: _agents,
  actionRecords: _actionRecords = EMPTY_ACTION_RECORDS,
  planItems: _planItems,
  hasApprovalTray = false,
  hasClarificationTray = false,
  hasPlanDecisionTray = false,
  hasPlanStepsTray = false,
  bottomInsetPx,
  surfaceFrameWidthClassName = CHAT_SURFACE_FRAME_WIDTH_CLASS,
  onOpenArtifact,
  onSubmitFeedback,
  onAdoptBranchGroup,
  projectRootPath,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const hasTray = hasApprovalTray || hasClarificationTray || hasPlanDecisionTray || hasPlanStepsTray;
  const paddingBottom = messageBottomPaddingPx({ hasTray, bottomInsetPx });

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 64;
  }, []);

  useLayoutEffect(() => {
    if (scrollRef.current && shouldAutoScrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    logAssistantDuplicateDiagnostics(chatMessages);
  }, [chatMessages]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={CHAT_MESSAGES_SCROLL_CLASS}
    >
      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          className={cn(
            "mx-auto min-h-full gap-0 p-0",
            CHAT_SURFACE_VIEWPORT_GUTTER_CLASS,
          )}
          style={{ paddingBottom }}
        >
          <div
            data-testid="chat-messages-surface-frame"
            className={cn("mx-auto min-h-full", surfaceFrameWidthClassName)}
          >
            <div
              data-testid="chat-messages-content"
              className="flex min-h-full flex-col gap-8 pt-8"
            >
              {chatMessages.map((message) => {
                if (message.role === "assistant") {
                  return (
                    <AssistantMessageCard
                      key={message.id}
                      message={message}
                      branchGroups={branchGroups}
                      turnSnapshots={turnSnapshots}
                      language={language}
                      onOpenArtifact={onOpenArtifact}
                      onSubmitFeedback={onSubmitFeedback}
                      onAdoptBranchGroup={onAdoptBranchGroup}
                      projectRootPath={projectRootPath}
                    />
                  );
                }

                const hasImages = message.role === "user" && message.images && message.images.length > 0;
                const hasText = message.content.trim().length > 0;
                const bubbles: React.ReactNode[] = [];

                if (hasImages) {
                  message.images!.forEach((img, idx) => {
                    bubbles.push(
                      <MessageBubble
                        key={`${message.id}-img-${idx}`}
                        role="user"
                        content=""
                      >
                        <img
                          src={img.dataUrl}
                          alt={img.name}
                          className="max-w-full rounded-xl object-contain"
                          style={{ maxHeight: 400 }}
                        />
                      </MessageBubble>
                    );
                  });
                }

                if (hasText) {
                  bubbles.push(
                    <MessageBubble
                      key={message.id}
                      role={message.role}
                      content={message.content}
                    >
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {message.attachments.map((attachment, index) => (
                            <div
                              key={`${attachment.path}-${index}`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs text-muted-foreground"
                            >
                              <FileText size={11} />
                              <span className="max-w-[200px] truncate">{attachment.name}</span>
                              <span className="whitespace-nowrap text-[10px] text-muted-foreground/60">
                                {formatFileSize(attachment.sizeBytes)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </MessageBubble>
                  );
                }

                if (bubbles.length === 0) {
                  bubbles.push(
                    <MessageBubble
                      key={message.id}
                      role={message.role}
                      content={message.content}
                    />
                  );
                }

                return <Fragment key={message.id}>{bubbles}</Fragment>;
              })}
              <div className={cn("h-1", chatMessages.length === 0 && "flex-1")} />
            </div>
          </div>
        </ConversationContent>
      </Conversation>
    </div>
  );
});

ChatMessages.displayName = "ChatMessages";

const AssistantMessageCard = memo(function AssistantMessageCard({
  message,
  branchGroups,
  turnSnapshots,
  language,
  onOpenArtifact,
  onSubmitFeedback,
  onAdoptBranchGroup,
  projectRootPath,
}: {
  message: ChatMessage;
  branchGroups: readonly OraSessionBranchGroup[];
  turnSnapshots: Record<string, OraStateSnapshot | undefined>;
  language: AppLanguage;
  onOpenArtifact?: (artifactId: string) => void;
  onSubmitFeedback?: (message: ChatMessage, feedbackText: string) => Promise<void>;
  onAdoptBranchGroup?: (branchGroupId: string, runId: string) => void;
  projectRootPath?: string;
}) {
  const branchComparison = branchComparisonForMessage(branchGroups, message);
  const handleSubmitFeedback = useCallback(
    ({ feedbackText }: { turn: AssistantTurnAttachment; feedbackText: string }) => {
      if (!onSubmitFeedback) {
        return Promise.resolve();
      }
      return onSubmitFeedback(message, feedbackText);
    },
    [message, onSubmitFeedback],
  );

  if (branchComparison) {
    return (
      <div className="w-full">
        <BranchComparisonTurn
          group={branchComparison}
          snapshots={turnSnapshots}
          language={language}
          onAdoptBranchGroup={onAdoptBranchGroup}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <AssistantTurnCard
        content={message.content}
        turn={message.turn}
        isPlaceholder={message.isPlaceholder}
        onOpenArtifact={onOpenArtifact}
        onSubmitFeedback={message.turn && onSubmitFeedback ? handleSubmitFeedback : undefined}
        projectRootPath={projectRootPath}
      />
    </div>
  );
});

AssistantMessageCard.displayName = "AssistantMessageCard";

function logAssistantDuplicateDiagnostics(chatMessages: ChatMessage[]) {
  if (typeof window === "undefined" || import.meta.env.PROD) {
    return;
  }
  const assistantMessages = chatMessages.filter((message) => message.role === "assistant");
  const seen = new Map<string, ChatMessage[]>();
  for (const message of assistantMessages) {
    const key = normalizeDiagnosticText(message.content);
    if (!key || key.length < 24) {
      continue;
    }
    const bucket = seen.get(key) ?? [];
    bucket.push(message);
    seen.set(key, bucket);
  }
  const duplicatedMessages = [...seen.values()].filter((bucket) => bucket.length > 1);
  const duplicatedTimeline = assistantMessages.flatMap((message) => {
    const timelineItems = message.turn?.timelineItems ?? [];
    const timelineSeen = new Map<string, Array<{ id: string; kind: string; content: string }>>();
    for (const item of timelineItems) {
      if (!("content" in item)) {
        continue;
      }
      const key = normalizeDiagnosticText(item.content);
      if (!key || key.length < 24) {
        continue;
      }
      const bucket = timelineSeen.get(key) ?? [];
      bucket.push({ id: item.id, kind: item.kind, content: item.content });
      timelineSeen.set(key, bucket);
    }
    return [...timelineSeen.values()]
      .filter((bucket) => bucket.length > 1)
      .map((bucket) => ({
        messageId: message.id,
        runId: message.metadata?.runId ?? message.turn?.runId,
        items: bucket,
      }));
  });
  if (duplicatedMessages.length === 0 && duplicatedTimeline.length === 0) {
    return;
  }
  console.warn("[ora-chat] duplicate assistant render candidates", {
    duplicatedMessages: duplicatedMessages.map((bucket) =>
      bucket.map((message) => ({
        id: message.id,
        runId: message.metadata?.runId ?? message.turn?.runId,
        isPlaceholder: message.isPlaceholder,
        content: message.content,
      }))
    ),
    duplicatedTimeline,
    assistantMessages: assistantMessages.map((message) => ({
      id: message.id,
      runId: message.metadata?.runId ?? message.turn?.runId,
      isPlaceholder: message.isPlaceholder,
      content: message.content,
      timeline: (message.turn?.timelineItems ?? []).flatMap((item) =>
        "content" in item
          ? [{ id: item.id, kind: item.kind, content: item.content }]
          : []
      ),
    })),
  });
}

function normalizeDiagnosticText(text: string) {
  return text.trim().replace(/\s+/g, "");
}

function branchComparisonForMessage(
  branchGroups: readonly OraSessionBranchGroup[],
  message: ChatMessage,
): OraSessionBranchGroup | undefined {
  const runId = message.metadata?.runId;
  if (!runId) return undefined;
  return branchGroups.find((group) =>
    group.target === "replace_latest" &&
    group.replaceRunId === runId &&
    group.status !== "adopted" &&
    group.status !== "dismissed" &&
    group.candidates.length > 0
  );
}
