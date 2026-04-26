import { Sparkles } from "lucide-react";
import type { ModeSelection } from "@ora/shared";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import type {
  ActionRecord,
  AgentProfile,
  ChatMessage,
  CheckpointRecord,
  ModeCard,
  SessionRun,
  StreamLine,
  TopologyEdge,
  TopologyNode,
} from "../types";
import type { OraStateSnapshot } from "../lib/runtimeClient";
import { useWorkbench } from "../lib/state";
import { cn } from "../lib/utils";
import { getWelcomeGreeting } from "../lib/welcomeGreeting";

interface ChatViewProps {
  activeMode: ModeCard;
  modeCards: ModeCard[];
  activeSnapshot?: OraStateSnapshot;
  actionRecords: ActionRecord[];
  agents: AgentProfile[];
  busyCommand?: string;
  chatMessages: ChatMessage[];
  checkpoints: CheckpointRecord[];
  composerPrompt: string;
  isLoading: boolean;
  isRunning: boolean;
  isApprovalRequired: boolean;
  selectedSession: SessionRun;
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
  onOpenArtifact: (artifactId: string) => void;
  onSubmitFeedback: (
    message: ChatMessage,
    feedbackText: string,
  ) => Promise<void>;
  onSelectMode: (modeId: string) => void;
  onSelectModeSelection: (selection: ModeSelection) => void;
  onSelectNode: (id: string) => void;
  onStartRun: () => void;
  onToggleDetailDrawer: (drawer: "trails" | "documents") => void;
  detailDrawer: "trails" | "documents" | undefined;
}

export function ChatView({
  activeMode,
  actionRecords,
  modeCards,
  busyCommand,
  chatMessages,
  composerPrompt,
  isLoading,
  isRunning,
  isApprovalRequired,
  selectedSession,
  selectedCustomAgentId,
  onStartRun,
  onComposerPromptChange,
  onClearSelectedCustomAgent,
  onInterruptRun,
  onResumeRun,
  onCancelRun,
  onExportReport,
  onOpenArtifact,
  onSubmitFeedback,
  onToggleDetailDrawer,
  detailDrawer,
  onSelectMode,
  onSelectModeSelection,
}: ChatViewProps) {
  const { state, dispatch } = useWorkbench();
  const showWelcome = chatMessages.length === 0 && !isRunning;
  const allProviders = state.providerRegistry?.providers ?? [];
  const configuredProviders = allProviders.filter((provider) => {
    if (provider.type === "local_smoke") return true;
    return state.providerSecretStatuses.some(
      (status) => status.providerId === provider.id && status.hasSecret,
    );
  });
  const providerOptions =
    configuredProviders.length > 0 ? configuredProviders : allProviders;
  const activeProvider =
    providerOptions.find(
      (provider) => provider.id === state.selectedProviderId,
    ) ??
    allProviders.find((provider) => provider.id === state.selectedProviderId) ??
    providerOptions[0];
  return (
    <div className="relative flex h-full min-h-0 w-full bg-transparent">
      <ChatHeader
        busyCommand={busyCommand}
        selectedSession={selectedSession}
        onExportReport={onExportReport}
        onToggleDetailDrawer={onToggleDetailDrawer}
        detailDrawer={detailDrawer}
      />
      <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col pt-12">
        {showWelcome && (
          <div className="pointer-events-none absolute left-0 right-0 top-[calc(50%-160px)] z-10 flex justify-center px-6">
            <div className="flex w-full max-w-container-md flex-col items-center gap-2 text-center">
              <div
                className={cn(
                  "flex items-center gap-2 text-2xl font-bold",
                  state.inputMode === "ultra" && "golden-text",
                )}
              >
                <span>{getWelcomeGreeting(new Date(), state.language)}</span>
              </div>
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <ChatMessages
            chatMessages={chatMessages}
            actionRecords={actionRecords}
            isApprovalRequired={isApprovalRequired}
            onResumeRun={onResumeRun}
            onCancelRun={onCancelRun}
            onOpenArtifact={onOpenArtifact}
            onSubmitFeedback={onSubmitFeedback}
            busyCommand={busyCommand}
          />
        </div>
        <ChatInput
          composerPrompt={composerPrompt}
          isLoading={isLoading}
          isRunning={isRunning}
          activeMode={activeMode}
          modeOptions={modeCards}
          selectedModeSelection={state.selectedModeSelection}
          activeProvider={activeProvider}
          providerOptions={providerOptions}
          selectedCustomAgentId={selectedCustomAgentId}
          inputMode={state.inputMode}
          onInputModeChange={(mode) =>
            dispatch({ type: "SET_INPUT_MODE", mode })
          }
          onModeChange={onSelectMode}
          onModeSelectionChange={onSelectModeSelection}
          onProviderChange={(providerId) =>
            dispatch({ type: "SET_PROVIDER", providerId })
          }
          onPromptChange={onComposerPromptChange}
          onClearSelectedCustomAgent={onClearSelectedCustomAgent}
          onStartRun={onStartRun}
          onStopRun={onInterruptRun}
        />
      </main>
    </div>
  );
}
