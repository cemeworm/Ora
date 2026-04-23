import { Sparkles } from "lucide-react";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import type { ActionRecord, AgentProfile, ChatMessage, CheckpointRecord, PlanItem, RuntimeBridgeStatus, SessionRun, StreamLine, TopologyEdge, TopologyNode, PatternCard } from "../types";
import type { OraStateSnapshot } from "../lib/runtimeClient";
import { useWorkbench } from "../lib/state";
import { cn } from "../lib/utils";

interface ChatViewProps {
  activePattern: PatternCard;
  patternCards: PatternCard[];
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
  patternCards,
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
  actionRecords,
  planItems,
  onResumeRun,
  onCancelRun,
}: ChatViewProps) {
  const { state, dispatch } = useWorkbench();
  const showWelcome = chatMessages.length <= 1 && !isRunning;
  const allProviders = state.providerRegistry?.providers ?? [];
  const configuredProviders = allProviders.filter((provider) => {
    if (provider.type === "local_smoke") return true;
    return state.providerSecretStatuses.some((status) => status.providerId === provider.id && status.hasSecret);
  });
  const providerOptions = configuredProviders.length > 0 ? configuredProviders : allProviders;
  const activeProvider =
    providerOptions.find((provider) => provider.id === state.selectedProviderId) ??
    allProviders.find((provider) => provider.id === state.selectedProviderId) ??
    providerOptions[0];

  return (
    <div className="relative flex h-full min-h-0 justify-between bg-background">
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
      <main className="flex min-h-0 max-w-full grow flex-col">
        {showWelcome && (
          <div className="pointer-events-none absolute left-0 right-0 top-[calc(50%-160px)] z-10 flex justify-center px-6">
            <div className="flex w-full max-w-container-sm flex-col items-center gap-2 text-center">
              <div className={cn("flex items-center gap-2 text-2xl font-bold", state.inputMode === "ultra" && "golden-text")}>
                <Sparkles size={22} />
                <span>Welcome back to Ora</span>
              </div>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                Ask Ora to plan, run, checkpoint, and inspect multi-agent work. The workspace keeps runtime state close without leaving the chat.
              </p>
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-1 justify-center">
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
        </div>
        <ChatInput
          composerPrompt={composerPrompt}
          isLoading={isLoading}
          isRunning={isRunning}
          activePattern={activePattern}
          patternOptions={patternCards}
          activeProvider={activeProvider}
          providerOptions={providerOptions}
          inputMode={state.inputMode}
          onInputModeChange={(mode) => dispatch({ type: "SET_INPUT_MODE", mode })}
          onPatternChange={(pattern) => dispatch({ type: "SET_PATTERN", pattern })}
          onProviderChange={(providerId) => dispatch({ type: "SET_PROVIDER", providerId })}
          onPromptChange={onComposerPromptChange}
          onStartRun={onStartRun}
          onStopRun={onInterruptRun}
        />
      </main>
    </div>
  );
}
