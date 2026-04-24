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
  isApprovalRequired?: boolean;
  onResumeRun?: () => void;
  onCancelRun?: () => void;
  busyCommand?: string;
}

export function ChatMessages({
  chatMessages,
  agents: _agents,
  actionRecords: _actionRecords,
  planItems: _planItems,
  isApprovalRequired: _isApprovalRequired,
  onResumeRun: _onResumeRun,
  onCancelRun: _onCancelRun,
  busyCommand: _busyCommand,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages.length]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="min-h-full w-full gap-8 px-4 pb-44 pt-20 md:px-6 xl:px-8">
        {chatMessages.map((message) => {
          if (message.role === "assistant") {
            return (
              <div key={message.id} className="w-full">
                <AssistantTurnCard
                  content={message.content}
                  timestamp={message.timestamp}
                  turn={message.turn}
                  isPlaceholder={message.isPlaceholder}
                />
              </div>
            );
          }

          return (
            <MessageBubble
              key={message.id}
              role={message.role}
              content={message.content}
              timestamp={message.timestamp}
            />
          );
        })}
        <div className={cn("h-1", chatMessages.length === 0 && "flex-1")} />
        </ConversationContent>
      </Conversation>
    </div>
  );
}
