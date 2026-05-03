import { useEffect, useRef } from "react";
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

export function ChatMessages({
  chatMessages,
  agents: _agents,
  actionRecords: _actionRecords = [],
  planItems: _planItems,
  hasApprovalTray = false,
  hasClarificationTray = false,
  hasPlanDecisionTray = false,
  bottomInsetPx,
  onOpenArtifact,
  onSubmitFeedback,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasTray = hasApprovalTray || hasClarificationTray || hasPlanDecisionTray;
  const paddingBottom = messageBottomPaddingPx({ hasTray, bottomInsetPx });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages.length]);

  return (
    <div ref={scrollRef} className="min-h-0 w-full flex-1 overflow-y-auto">
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
            />
          );
        })}
        <div className={cn("h-1", chatMessages.length === 0 && "flex-1")} />
        </ConversationContent>
      </Conversation>
    </div>
  );
}
