import { useCallback, useLayoutEffect, useRef } from "react";
import { FileText } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { AssistantTurnCard } from "./AssistantTurnCard";
import type { ActionRecord, AgentProfile, ChatMessage, PlanItem } from "../types";
import { Conversation, ConversationContent } from "./ai-elements/conversation";
import { cn } from "../lib/utils";

interface ChatMessagesProps {
  chatMessages: ChatMessage[];
  agents?: AgentProfile[];
  actionRecords?: ActionRecord[];
  planItems?: PlanItem[];
  hasApprovalTray?: boolean;
  hasClarificationTray?: boolean;
  hasPlanDecisionTray?: boolean;
  hasPlanStepsTray?: boolean;
  bottomInsetPx?: number;
  onOpenArtifact?: (artifactId: string) => void;
  onSubmitFeedback?: (message: ChatMessage, feedbackText: string) => Promise<void>;
}

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

export function ChatMessages({
  chatMessages,
  agents: _agents,
  actionRecords: _actionRecords = [],
  planItems: _planItems,
  hasApprovalTray = false,
  hasClarificationTray = false,
  hasPlanDecisionTray = false,
  hasPlanStepsTray = false,
  bottomInsetPx,
  onOpenArtifact,
  onSubmitFeedback,
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

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 w-full flex-1 overflow-y-auto overscroll-contain">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          className="mx-auto min-h-full w-full max-w-[88rem] gap-8 px-4 pt-8 md:px-6 xl:px-8"
          style={{ paddingBottom }}
        >
        {chatMessages.map((message) => {
          if (message.role === "assistant") {
            return (
              <div key={message.id} className="w-full">
                <AssistantTurnCard
                  content={message.content}
                  turn={message.turn}
                  isPlaceholder={message.isPlaceholder}
                  onOpenArtifact={onOpenArtifact}
                  onSubmitFeedback={message.turn && onSubmitFeedback
                    ? ({ feedbackText }) => onSubmitFeedback(message, feedbackText)
                    : undefined}
                />
              </div>
            );
          }

          return (
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
        })}
        <div className={cn("h-1", chatMessages.length === 0 && "flex-1")} />
        </ConversationContent>
      </Conversation>
    </div>
  );
}
