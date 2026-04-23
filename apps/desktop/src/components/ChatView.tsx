import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import type { ActionRecord, AgentProfile, ChatMessage, CheckpointRecord, PlanItem, RunBeat, RuntimeBridgeStatus, SessionRun, StreamLine, TopologyEdge, TopologyNode, PatternCard } from "../types";
import type { OraStateSnapshot, OraProviderConfig, OraProviderSecretStatus } from "../lib/runtimeClient";

interface ChatViewProps {
  activePattern: PatternCard;
  activeSnapshot?: OraStateSnapshot;
  agents: AgentProfile[];
  bridgeStatus: RuntimeBridgeStatus;
  busyCommand?: string;
  chatMessages: ChatMessage[];
  checkpoints: CheckpointRecord[];
  composerPrompt: string;
  isLoading: boolean;
  isRunning: boolean;
  isApprovalRequired: boolean;
  planItems: PlanItem[];
  actionRecords: ActionRecord[];
  selectedSession: SessionRun;
  streamLines: StreamLine[];
  topologyEdges: TopologyEdge[];
  topologyNodes: TopologyNode[];
  onCancelRun: () => void;
  onComposerPromptChange: (prompt: string) => void;
  onExportReport: () => void;
  onForkRun: () => void;
  onInterruptRun: () => void;
  onReplaySelection: () => void;
  onResumeRun: () => void;
  onSelectNode: (id: string) => void;
  onStartRun: () => void;
  onToggleDetailDrawer: () => void;
  detailDrawerOpen: boolean;
}

export function ChatView({
  activePattern,
  agents,
  bridgeStatus,
  busyCommand,
  chatMessages,
  composerPrompt,
  isLoading,
  isRunning,
  isApprovalRequired,
  selectedSession,
  onStartRun,
  onComposerPromptChange,
  onInterruptRun,
  onExportReport,
  onToggleDetailDrawer,
  detailDrawerOpen,
  activeSnapshot,
  actionRecords,
  checkpoints,
  planItems,
  topologyEdges,
  topologyNodes,
  onSelectNode,
  onResumeRun,
  onCancelRun,
  onForkRun,
  onReplaySelection,
  streamLines,
}: ChatViewProps) {
  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        bridgeStatus={bridgeStatus}
        busyCommand={busyCommand}
        isRunning={isRunning}
        isApprovalRequired={isApprovalRequired}
        selectedSession={selectedSession}
        onExportReport={onExportReport}
        onInterruptRun={onInterruptRun}
        onToggleDetailDrawer={onToggleDetailDrawer}
        detailDrawerOpen={detailDrawerOpen}
      />
      <ChatMessages
        chatMessages={chatMessages}
        agents={agents}
        actionRecords={actionRecords}
        planItems={planItems}
        isApprovalRequired={isApprovalRequired}
        onResumeRun={onResumeRun}
        onCancelRun={onCancelRun}
        busyCommand={busyCommand}
      />
      <ChatInput
        composerPrompt={composerPrompt}
        isLoading={isLoading}
        isRunning={isRunning}
        onPromptChange={onComposerPromptChange}
        onStartRun={onStartRun}
      />
    </div>
  );
}
