import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { AgentCard } from "./AgentCard";
import type { ActionRecord, AgentProfile, ChatMessage, PlanItem } from "../types";
import { cn } from "../lib/utils";

interface ChatMessagesProps {
  chatMessages: ChatMessage[];
  agents: AgentProfile[];
  actionRecords: ActionRecord[];
  planItems: PlanItem[];
  isApprovalRequired: boolean;
  onResumeRun: () => void;
  onCancelRun: () => void;
  busyCommand?: string;
}

export function ChatMessages({
  chatMessages,
  agents,
  actionRecords,
  planItems,
  isApprovalRequired,
  onResumeRun,
  onCancelRun,
  busyCommand,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages.length]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-container-md flex-col gap-8 px-4 pb-44 pt-20">
        {chatMessages.map((message) => {
          if (
            message.role === "system" &&
            message.metadata?.eventType &&
            ["plan.updated", "action.updated", "approval.required"].includes(message.metadata.eventType)
          ) {
            const agentId = message.metadata.agentId;
            const agent = agents.find((a) => a.id === agentId);
            const relatedActions = actionRecords.filter((a) => a.agentId === agentId);
            const relatedPlans = planItems.filter((p) => p.owner === agentId);

            return (
              <div key={message.id} className="w-full">
                <AgentCard
                  agent={agent}
                  content={message.content}
                  eventType={message.metadata.eventType}
                  actions={relatedActions}
                  planItems={relatedPlans}
                  isApprovalRequired={isApprovalRequired}
                  onResumeRun={onResumeRun}
                  onCancelRun={onCancelRun}
                  busyCommand={busyCommand}
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
      </div>
    </div>
  );
}
