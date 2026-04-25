import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { AssistantTurnCard } from "./AssistantTurnCard";
import type { ActionRecord, AgentProfile, ChatMessage, PlanItem } from "../types";
import { Conversation, ConversationContent } from "./ai-elements/conversation";
import { cn } from "../lib/utils";
import { ApprovalRequestCard } from "./ApprovalRequestCard";

interface ChatMessagesProps {
  chatMessages: ChatMessage[];
  agents?: AgentProfile[];
  actionRecords?: ActionRecord[];
  planItems?: PlanItem[];
  isApprovalRequired?: boolean;
  onResumeRun?: () => void;
  onCancelRun?: () => void;
  onOpenArtifact?: (artifactId: string) => void;
  busyCommand?: string;
}

export function ChatMessages({
  chatMessages,
  agents: _agents,
  actionRecords = [],
  planItems: _planItems,
  isApprovalRequired = false,
  onResumeRun,
  onCancelRun,
  onOpenArtifact,
  busyCommand,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingApprovals = actionRecords.filter((action) => action.state === "approval_required");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages.length, isApprovalRequired, pendingApprovals.length]);

  return (
    <div ref={scrollRef} className="min-h-0 w-full flex-1 overflow-y-auto">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto min-h-full w-full max-w-[88rem] gap-8 px-4 pb-44 pt-8 md:px-6 xl:px-8">
        {chatMessages.map((message) => {
          if (message.role === "assistant") {
            return (
              <div key={message.id} className="w-full">
                <AssistantTurnCard
                  content={message.content}
                  turn={message.turn}
                  isPlaceholder={message.isPlaceholder}
                  onOpenArtifact={onOpenArtifact}
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
        {isApprovalRequired && pendingApprovals.length > 0 && onResumeRun && onCancelRun ? (
          <ApprovalRequestCard
            actions={pendingApprovals}
            onResume={onResumeRun}
            onCancel={onCancelRun}
            disabled={busyCommand !== undefined}
          />
        ) : null}
        <div className={cn("h-1", chatMessages.length === 0 && "flex-1")} />
        </ConversationContent>
      </Conversation>
    </div>
  );
}
