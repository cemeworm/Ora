import type { ModeSelection } from "@cemeworm/shared";
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
import { runnableProviderOptions } from "../lib/providerOptions";
import { useWorkbench, type ComposerLocalFileAttachment } from "../lib/state";
import { getWelcomeGreeting } from "../lib/welcomeGreeting";

const LOCAL_FILE_PREVIEW_MAX_BYTES = 256 * 1024;

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
  projectLabel?: string;
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
  onSubmitClarificationOption: (answer: string) => void;
  onSelectMode: (modeId: string) => void;
  onSelectModeSelection: (selection: ModeSelection) => void;
  onSelectNode: (id: string) => void;
  onStartRun: () => void;
  onToggleDetailDrawer: (drawer: "trails" | "documents") => void;
  detailDrawer: "trails" | "documents" | undefined;
}

export function ChatView({
  activeMode,
  activeSnapshot,
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
  projectLabel,
  onStartRun,
  onComposerPromptChange,
  onClearSelectedCustomAgent,
  onInterruptRun,
  onResumeRun,
  onCancelRun,
  onExportReport,
  onOpenArtifact,
  onSubmitFeedback,
  onSubmitClarificationOption,
  onToggleDetailDrawer,
  detailDrawer,
  onSelectMode,
  onSelectModeSelection,
}: ChatViewProps) {
  const { state, dispatch } = useWorkbench();
  const showWelcome = chatMessages.length === 0 && !isRunning;
  const allProviders = state.providerRegistry?.providers ?? [];
  const providerOptions = runnableProviderOptions(allProviders, state.providerSecretStatuses);
  const activeProvider =
    providerOptions.find(
      (provider) => provider.id === state.selectedProviderId,
    );
  const projectFileAttachments = state.sessionProjectFileAttachments[selectedSession.id] ?? [];
  const localFileAttachments = state.sessionLocalFileAttachments[selectedSession.id] ?? [];
  const pendingApprovalActions = actionRecords.filter((action) => action.state === "approval_required");
  const planDecisionPending = state.sessionPendingPlanDecision[selectedSession.id] ?? false;

  async function openLocalFiles() {
    try {
      const files = await pickLocalChatFiles();
      if (files.length === 0) return;
      files.forEach((file) => {
        dispatch({
          type: "ADD_LOCAL_FILE_ATTACHMENT",
          sessionId: selectedSession.id,
          file,
        });
      });
    } catch (error) {
      dispatch({
        type: "SET_COMMAND_FEEDBACK",
        feedback:
          error instanceof Error
            ? error.message
            : "File selection failed.",
      });
    }
  }

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
              <div className="flex items-center gap-2 text-2xl font-bold">
                <span>{getWelcomeGreeting(new Date(), state.language, projectLabel)}</span>
              </div>
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <ChatMessages
            chatMessages={chatMessages}
            actionRecords={actionRecords}
            hasApprovalTray={isApprovalRequired && pendingApprovalActions.length > 0}
            hasClarificationTray={Boolean(activeSnapshot?.pendingClarifications && activeSnapshot.pendingClarifications.length > 0)}
            hasPlanDecisionTray={planDecisionPending}
            onOpenArtifact={onOpenArtifact}
            onSubmitFeedback={onSubmitFeedback}
          />
        </div>
        <ChatInput
          sessionId={selectedSession.id}
          composerPrompt={composerPrompt}
          isLoading={isLoading}
          isRunning={isRunning}
          activeMode={activeMode}
          modeOptions={modeCards}
          selectedModeSelection={state.selectedModeSelection}
          activeProvider={activeProvider}
          providerOptions={providerOptions}
          skillOptions={state.skillRegistry?.skills ?? []}
          selectedSkillIds={state.selectedSkillIds}
          selectedCustomAgentId={selectedCustomAgentId}
          projectFileAttachments={projectFileAttachments}
          localFileAttachments={localFileAttachments}
          approvalActions={isApprovalRequired ? pendingApprovalActions : []}
          approvalDisabled={busyCommand !== undefined}
          onApprove={onResumeRun}
          onCancelApproval={onCancelRun}
          clarificationQuestions={activeSnapshot?.pendingClarifications ?? []}
          onSubmitClarificationOption={onSubmitClarificationOption}
          onModeChange={onSelectMode}
          onModeSelectionChange={onSelectModeSelection}
          onProviderChange={(providerId) =>
            dispatch({ type: "SET_PROVIDER", providerId })
          }
          onPromptChange={onComposerPromptChange}
          onSelectedSkillIdsChange={(skillIds) =>
            dispatch({ type: "SET_SELECTED_SKILL_IDS", skillIds })
          }
          onRemoveProjectFileAttachment={(path) =>
            dispatch({
              type: "REMOVE_PROJECT_FILE_ATTACHMENT",
              sessionId: selectedSession.id,
              path,
            })
          }
          onRemoveLocalFileAttachment={(path) =>
            dispatch({
              type: "REMOVE_LOCAL_FILE_ATTACHMENT",
              sessionId: selectedSession.id,
              path,
            })
          }
          permissionMode={state.permissionMode}
          onPermissionModeChange={(mode) => dispatch({ type: "SET_PERMISSION_MODE", permissionMode: mode })}
          taskIntent={state.taskIntent}
          onTaskIntentChange={(ti) => dispatch({ type: "SET_TASK_INTENT", taskIntent: ti })}
          planDecisionPending={planDecisionPending}
          onConfirmPlanDecision={() => {
            dispatch({ type: "SET_PLAN_DECISION_PENDING", sessionId: selectedSession.id, pending: false });
            dispatch({ type: "SET_TASK_INTENT", taskIntent: "implement" });
            onComposerPromptChange("请按照上述计划开始执行");
          }}
          onDeclinePlanDecision={() => {
            dispatch({ type: "SET_PLAN_DECISION_PENDING", sessionId: selectedSession.id, pending: false });
          }}
          onOpenLocalFiles={() => void openLocalFiles()}
          onClearSelectedCustomAgent={onClearSelectedCustomAgent}
          onStartRun={onStartRun}
          onStopRun={onInterruptRun}
        />
      </main>
    </div>
  );
}

async function pickLocalChatFiles(): Promise<ComposerLocalFileAttachment[]> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const [{ open }, { invoke }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/api/core"),
    ]);
    const selected = await open({
      directory: false,
      multiple: true,
      title: "选择要载入聊天的文件",
    });
    const paths = (Array.isArray(selected) ? selected : selected ? [selected] : [])
      .filter((path): path is string => typeof path === "string" && path.trim().length > 0);
    const files = await Promise.all(
      paths.map((path) =>
        invoke<ComposerLocalFileAttachment>("read_local_chat_file", { path }),
      ),
    );
    return files;
  }

  return pickLocalChatFilesInBrowser();
}

function pickLocalChatFilesInBrowser(): Promise<ComposerLocalFileAttachment[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.addEventListener("change", async () => {
      try {
        const files = await Promise.all(
          Array.from(input.files ?? []).map(readBrowserFileAttachment),
        );
        input.remove();
        resolve(files);
      } catch (error) {
        input.remove();
        reject(error);
      }
    }, { once: true });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve([]);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

async function readBrowserFileAttachment(file: File): Promise<ComposerLocalFileAttachment> {
  const truncated = file.size > LOCAL_FILE_PREVIEW_MAX_BYTES;
  const content = await file.slice(0, LOCAL_FILE_PREVIEW_MAX_BYTES).text().catch(() => undefined);
  return {
    path: file.name,
    name: file.name,
    mimeType: file.type || inferBrowserFileMimeType(file.name),
    sizeBytes: file.size,
    ...(content ? { content } : {}),
    ...(truncated ? { truncated: true } : {}),
  };
}

function inferBrowserFileMimeType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "css":
      return "text/css";
    case "csv":
      return "text/csv";
    case "html":
    case "htm":
      return "text/html";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "text/javascript";
    case "json":
    case "jsonc":
      return "application/json";
    case "md":
    case "mdx":
      return "text/markdown";
    case "rs":
      return "text/rust";
    case "ts":
    case "tsx":
      return "text/typescript";
    case "txt":
      return "text/plain";
    case "yaml":
    case "yml":
      return "text/yaml";
    default:
      return "application/octet-stream";
  }
}
