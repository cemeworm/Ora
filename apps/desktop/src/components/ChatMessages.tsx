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
  onOpenArtifact?: (artifactId: string) => void;
  onSubmitFeedback?: (message: ChatMessage, feedbackText: string) => Promise<void>;
  onSubmitClarificationOption?: (answer: string) => void;
}

export function ChatMessages({
  chatMessages,
  agents: _agents,
  actionRecords: _actionRecords = [],
  planItems: _planItems,
  hasApprovalTray = false,
  onOpenArtifact,
  onSubmitFeedback,
  onSubmitClarificationOption,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages.length]);

  return (
    <div ref={scrollRef} className="min-h-0 w-full flex-1 overflow-y-auto">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className={cn("mx-auto min-h-full w-full max-w-[88rem] gap-8 px-4 pt-8 md:px-6 xl:px-8", hasApprovalTray ? "pb-60" : "pb-44")}>
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
                {message.clarificationOptions && message.clarificationOptions.length > 0 && onSubmitClarificationOption ? (
                  <div className="mx-auto mt-3 flex w-full max-w-container-md flex-wrap gap-2 px-2">
                    {message.clarificationOptions.map((option) => {
                      const answer = option.value?.trim() || option.label.trim();
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className="rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition hover:border-primary/50 hover:bg-muted active:scale-[0.98]"
                          title={option.description}
                          onClick={() => onSubmitClarificationOption(answer)}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
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
