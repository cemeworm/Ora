import { Sparkles } from "lucide-react";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import type { ActionRecord, AgentProfile, ChatMessage, CheckpointRecord, ModeCard, PlanItem, SessionRun, SessionTurnItem, StreamLine, TopologyEdge, TopologyNode } from "../types";
import type { OraStateSnapshot } from "../lib/runtimeClient";
import { useWorkbench } from "../lib/state";
import { cn } from "../lib/utils";

interface ChatViewProps {
  activeMode: ModeCard;
  modeCards: ModeCard[];
  activeSnapshot?: OraStateSnapshot;
  agents: AgentProfile[];
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
  sessionTurns: SessionTurnItem[];
  selectedTurnRunId?: string;
  selectedCustomAgentId?: string;
  streamLines: StreamLine[];
  topologyEdges: TopologyEdge[];
  topologyNodes: TopologyNode[];
  onCancelRun: () => void;
  onComposerPromptChange: (prompt: string) => void;
  onClearSelectedCustomAgent: () => void;
  onExportReport: () => void;
  onForkRun: () => void;
  onInterruptRun: () => void;
  onReplaySelection: () => void;
  onResumeRun: () => void;
  onSelectMode: (modeId: string) => void;
  onSelectNode: (id: string) => void;
  onSelectTurn: (runId: string) => void;
  onStartRun: () => void;
  onToggleDetailDrawer: () => void;
  detailDrawerOpen: boolean;
}

export function ChatView({
  activeMode,
  modeCards,
  agents,
  busyCommand,
  chatMessages,
  composerPrompt,
  isLoading,
  isRunning,
  isApprovalRequired,
  selectedSession,
  sessionTurns,
  selectedTurnRunId,
  selectedCustomAgentId,
  onStartRun,
  onComposerPromptChange,
  onClearSelectedCustomAgent,
  onInterruptRun,
  onExportReport,
  onToggleDetailDrawer,
  detailDrawerOpen,
  actionRecords,
  planItems,
  onResumeRun,
  onCancelRun,
  onSelectMode,
  onSelectTurn,
}: ChatViewProps) {
  const { state, dispatch } = useWorkbench();
  const showWelcome = chatMessages.length === 0 && !isRunning;
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
  const workspaceContentClassName = "mx-auto flex min-h-0 w-full max-w-[88rem]";

  return (
    <div className="relative flex h-full min-h-0 w-full bg-transparent">
      <ChatHeader
        busyCommand={busyCommand}
        isRunning={isRunning}
        isApprovalRequired={isApprovalRequired}
        selectedSession={selectedSession}
        turns={sessionTurns}
        selectedTurnRunId={selectedTurnRunId}
        onSelectTurn={onSelectTurn}
        onExportReport={onExportReport}
        onInterruptRun={onInterruptRun}
        onToggleDetailDrawer={onToggleDetailDrawer}
        detailDrawerOpen={detailDrawerOpen}
      />
      <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        {showWelcome && (
          <div className="pointer-events-none absolute left-0 right-0 top-[calc(50%-160px)] z-10 flex justify-center px-6">
            <div className="flex w-full max-w-container-md flex-col items-center gap-2 text-center">
              <div className={cn("flex items-center gap-2 text-2xl font-bold", state.inputMode === "ultra" && "golden-text")}>
                <Sparkles size={22} />
                <span>Welcome back to Ora</span>
              </div>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                Start a new session, pick one of the five agent modes for the next turn, and keep the session transcript while inspecting each turn’s Trails view on the right.
              </p>
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className={workspaceContentClassName}>
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
        </div>
        <ChatInput
          composerPrompt={composerPrompt}
          isLoading={isLoading}
          isRunning={isRunning}
          activeMode={activeMode}
          modeOptions={modeCards}
          activeProvider={activeProvider}
          providerOptions={providerOptions}
          selectedCustomAgentId={selectedCustomAgentId}
          inputMode={state.inputMode}
          onInputModeChange={(mode) => dispatch({ type: "SET_INPUT_MODE", mode })}
          onModeChange={onSelectMode}
          onProviderChange={(providerId) => dispatch({ type: "SET_PROVIDER", providerId })}
          onPromptChange={onComposerPromptChange}
          onClearSelectedCustomAgent={onClearSelectedCustomAgent}
          onStartRun={onStartRun}
          onStopRun={onInterruptRun}
        />
      </main>
    </div>
  );
}
