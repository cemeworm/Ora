import type { ModeSelection } from "@cemeworm/shared";
import { useCallback, useMemo, useState } from "react";
import { GitBranchPlus } from "lucide-react";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
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
  TurnPlanListStep,
} from "../types";
import type { OraRunConfig, OraSessionBranchGroupCreateParams, OraStateSnapshot } from "../lib/runtimeClient";
import { runnableProviderOptions } from "../lib/providerOptions";
import { useWorkbench, type ComposerLocalFileAttachment } from "../lib/state";
import { getWelcomeGreeting } from "../lib/welcomeGreeting";
import { translateCopy, type AppLanguage } from "../lib/i18n";
import type { DesktopRunInteractionState } from "../lib/runInteractionState";

const LOCAL_FILE_PREVIEW_MAX_BYTES = 256 * 1024;

interface ChatViewProps {
  activeMode: ModeCard;
  modeCards: ModeCard[];
  activeSnapshot?: OraStateSnapshot;
  actionRecords: ActionRecord[];
  agents: AgentProfile[];
  busyCommand?: string;
  chatMessages: ChatMessage[];
  turnSnapshots: Record<string, OraStateSnapshot | undefined>;
  checkpoints: CheckpointRecord[];
  composerPrompt: string;
  isLoading: boolean;
  runInteractionState: DesktopRunInteractionState;
  selectedSession: SessionRun;
  selectedCustomAgentId?: string;
  projectLabel?: string;
  streamLines: StreamLine[];
  topologyEdges: TopologyEdge[];
  topologyNodes: TopologyNode[];
  onCancelRun: () => void;
  onComposerPromptChange: (prompt: string) => void;
  onClearSelectedCustomAgent: () => void;
  onForkRun: () => void;
  onCreateAndRunBranchGroup: (params: OraSessionBranchGroupCreateParams) => void;
  onAdoptBranchGroup: (branchGroupId: string, runId: string) => void;
  onInterruptRun: () => void;
  onReplaySelection: () => void;
  onResumeRun: () => void;
  onAcceptPlanDecisionAndStartImplementation: () => void;
  onResolvePlanDecision: (status: "accepted" | "declined") => void;
  onOpenArtifact: (artifactId: string) => void;
  onSubmitFeedback: (
    message: ChatMessage,
    feedbackText: string,
  ) => Promise<void>;
  onSubmitAllClarifications: (answers: Record<string, string>) => void;
  onSelectMode: (modeId: string) => void;
  onSelectModeSelection: (selection: ModeSelection) => void;
  onSelectNode: (id: string) => void;
  onStartRun: () => void;
  onToggleDetailDrawer: (drawer: "trails" | "documents") => void;
  detailDrawer: "trails" | "documents" | undefined;
}

export function getActiveChatProvider<T extends { id: string }>(
  providerOptions: T[],
  selectedProviderId: string,
) {
  return (
    providerOptions.find((provider) => provider.id === selectedProviderId) ??
    providerOptions[0]
  );
}

export function getChatInputContextState({
  activeSnapshot,
  activeSessionDetail,
}: {
  activeSnapshot?: OraStateSnapshot;
  activeSessionDetail?: {
    latestSnapshot?: OraStateSnapshot;
    session: { contextState?: OraStateSnapshot["contextState"] };
  };
}) {
  return (
    activeSnapshot?.contextState ??
    activeSessionDetail?.latestSnapshot?.contextState ??
    activeSessionDetail?.session.contextState
  );
}

export function deriveProjectedGateTrays({
  attention,
  actionRecords,
  pendingClarifications,
}: {
  attention?: OraStateSnapshot["attention"];
  actionRecords: ActionRecord[];
  pendingClarifications: OraStateSnapshot["pendingClarifications"];
}) {
  const pendingApprovalIds = new Set(attention?.kind === "needs_approval" ? attention.pendingActionIds : []);
  const approvalActions = actionRecords.filter((action) =>
    action.state === "approval_required" && pendingApprovalIds.has(action.id)
  );
  const pendingClarificationIds = new Set(attention?.kind === "needs_clarification" ? attention.pendingClarificationIds : []);
  const clarificationQuestions = pendingClarifications.filter((clarification) =>
    pendingClarificationIds.has(clarification.id)
  );
  return {
    approvalActions,
    clarificationQuestions,
    hasApprovalTray: attention?.kind === "needs_approval" && approvalActions.length > 0,
    hasClarificationTray: attention?.kind === "needs_clarification" && clarificationQuestions.length > 0,
  };
}

export function deriveCurrentComposerPlanSteps({
  activeSnapshot,
  runInteractionState,
}: {
  activeSnapshot?: Pick<OraStateSnapshot, "planList">;
  runInteractionState: Pick<DesktopRunInteractionState, "isProcessing">;
}): TurnPlanListStep[] {
  if (!runInteractionState.isProcessing) {
    return [];
  }

  const snapshotPlan = activeSnapshot?.planList;
  if (!snapshotPlan || snapshotPlan.length === 0) {
    return [];
  }

  return snapshotPlan.map((item) => ({
    step: item.step,
    status: item.status,
  }));
}

export function ChatView({
  activeMode,
  activeSnapshot,
  actionRecords,
  modeCards,
  busyCommand,
  chatMessages,
  turnSnapshots,
  composerPrompt,
  isLoading,
  runInteractionState,
  selectedSession,
  selectedCustomAgentId,
  projectLabel,
  onStartRun,
  onComposerPromptChange,
  onClearSelectedCustomAgent,
  onInterruptRun,
  onResumeRun,
  onAcceptPlanDecisionAndStartImplementation,
  onResolvePlanDecision,
  onCancelRun,
  onCreateAndRunBranchGroup,
  onAdoptBranchGroup,
  onOpenArtifact,
  onSubmitFeedback,
  onSubmitAllClarifications,
  onToggleDetailDrawer,
  detailDrawer,
  onSelectMode,
  onSelectModeSelection,
}: ChatViewProps) {
  const { state, dispatch } = useWorkbench();
  const showWelcome = chatMessages.length === 0 && !runInteractionState.isProcessing;
  const allProviders = state.providerRegistry?.providers ?? [];
  const providerOptions = runnableProviderOptions(allProviders, state.providerSecretStatuses);
  const activeProvider = getActiveChatProvider(
    providerOptions,
    state.selectedProviderId,
  );
  const chatInputContextState = getChatInputContextState({
    activeSnapshot,
    activeSessionDetail: state.activeSessionDetail,
  });
  const projectFileAttachments = state.sessionProjectFileAttachments[selectedSession.id] ?? [];
  const localFileAttachments = state.sessionLocalFileAttachments[selectedSession.id] ?? [];
  const attention = activeSnapshot?.attention ?? state.activeSessionDetail?.session.attention;
  const {
    approvalActions: pendingApprovalActions,
    clarificationQuestions: pendingClarifications,
    hasApprovalTray,
    hasClarificationTray,
  } = deriveProjectedGateTrays({
    attention,
    actionRecords,
    pendingClarifications: activeSnapshot?.pendingClarifications ?? [],
  });
  const pendingPlanDecisionId =
    attention?.kind === "needs_plan_decision"
      ? attention.planDecisionId
      : undefined;
  const hasPendingPlanDecisionEntity = Boolean(
    pendingPlanDecisionId &&
      activeSnapshot?.planDecisions?.some((decision) =>
        decision.id === pendingPlanDecisionId && decision.status === "pending"
      )
  );
  const resolvingPlanDecision = Boolean(
    pendingPlanDecisionId &&
      state.pendingPlanDecisionResolution?.sessionId === selectedSession.id &&
      state.pendingPlanDecisionResolution.decisionId === pendingPlanDecisionId
  );
  const planDecisionPending =
    attention?.kind === "needs_plan_decision" &&
    hasPendingPlanDecisionEntity &&
    !resolvingPlanDecision;
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(0);
  const handleOverlayHeightChange = useCallback((height: number) => {
    setComposerOverlayHeight((current) => current === height ? current : height);
  }, []);

  const currentPlanSteps = useMemo<TurnPlanListStep[]>(
    () => deriveCurrentComposerPlanSteps({
      activeSnapshot,
      runInteractionState,
    }),
    [activeSnapshot?.planList, runInteractionState.isProcessing],
  );
  const branchGroups = state.activeSessionDetail?.branchGroups ?? [];
  const [branchPanelOpen, setBranchPanelOpen] = useState(false);

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

  async function handleFilesDropped(fileList: FileList) {
    try {
      const files = await Promise.all(
        Array.from(fileList).map(readBrowserFileAttachment),
      );
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
            : "File drop failed.",
      });
    }
  }

  return (
    <div className="relative flex h-full min-h-0 w-full bg-transparent">
      <ChatHeader
        busyCommand={busyCommand}
        selectedSession={selectedSession}
        onOpenBranches={() => setBranchPanelOpen((open) => !open)}
        onToggleDetailDrawer={onToggleDetailDrawer}
        detailDrawer={detailDrawer}
        language={state.language}
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
        {branchPanelOpen && (
          <BranchComparisonPanel
            sessionId={selectedSession.id}
            composerPrompt={composerPrompt}
            activeSnapshot={activeSnapshot}
            modeCards={modeCards}
            providerOptions={providerOptions}
            selectedProviderId={state.selectedProviderId}
            selectedModeId={state.selectedModeId}
            taskIntent={state.taskIntent}
            permissionMode={state.permissionMode}
            language={state.language}
            disabled={busyCommand !== undefined || runInteractionState.isProcessing}
            onCreateAndRunBranchGroup={(params) => {
              onCreateAndRunBranchGroup(params);
              setBranchPanelOpen(false);
            }}
          />
        )}
        <div className="flex min-h-0 flex-1">
          <ChatMessages
            chatMessages={chatMessages}
            branchGroups={branchGroups}
            turnSnapshots={turnSnapshots}
            language={state.language}
            actionRecords={actionRecords}
            hasApprovalTray={hasApprovalTray}
            hasClarificationTray={hasClarificationTray}
            hasPlanDecisionTray={planDecisionPending}
            hasPlanStepsTray={currentPlanSteps.length > 0}
            bottomInsetPx={composerOverlayHeight}
            onOpenArtifact={onOpenArtifact}
            onSubmitFeedback={onSubmitFeedback}
            onAdoptBranchGroup={onAdoptBranchGroup}
          />
        </div>
        <ChatInput
          sessionId={selectedSession.id}
          composerPrompt={composerPrompt}
          isLoading={isLoading}
          runInteractionState={runInteractionState}
          activeMode={activeMode}
          modeOptions={modeCards}
          selectedModeSelection={state.selectedModeSelection}
          activeProvider={activeProvider}
          contextState={chatInputContextState}
          providerOptions={providerOptions}
          skillOptions={state.skillRegistry?.skills ?? []}
          selectedSkillIds={state.selectedSkillIds}
          selectedCustomAgentId={selectedCustomAgentId}
          projectFileAttachments={projectFileAttachments}
          localFileAttachments={localFileAttachments}
          approvalActions={attention?.kind === "needs_approval" ? pendingApprovalActions : []}
          approvalDisabled={busyCommand !== undefined}
          onApprove={onResumeRun}
          onCancelApproval={onCancelRun}
          clarificationQuestions={pendingClarifications}
          onSubmitAllClarifications={onSubmitAllClarifications}
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
          planSteps={currentPlanSteps}
          onConfirmPlanDecision={onAcceptPlanDecisionAndStartImplementation}
          onDeclinePlanDecision={() => {
            onResolvePlanDecision("declined");
          }}
          onOverlayHeightChange={handleOverlayHeightChange}
          onOpenLocalFiles={() => void openLocalFiles()}
          onFilesDropped={handleFilesDropped}
          onClearSelectedCustomAgent={onClearSelectedCustomAgent}
          onStartRun={onStartRun}
          onStopRun={onCancelRun}
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

interface BranchDraft {
  id: string;
  label: string;
  providerId: string;
  modeId: string;
}

function branchCandidateLabel(language: AppLanguage, index: number) {
  return language === "zh" ? `候选 ${index}` : `Candidate ${index}`;
}

function BranchComparisonPanel({
  sessionId,
  composerPrompt,
  activeSnapshot,
  modeCards,
  providerOptions,
  selectedProviderId,
  selectedModeId,
  taskIntent,
  permissionMode,
  language,
  disabled,
  onCreateAndRunBranchGroup,
}: {
  sessionId: string;
  composerPrompt: string;
  activeSnapshot?: OraStateSnapshot;
  modeCards: ModeCard[];
  providerOptions: { id: string; label: string; modelId?: string }[];
  selectedProviderId?: string;
  selectedModeId: string;
  taskIntent: "chat" | "plan" | "implement";
  permissionMode: string;
  language: AppLanguage;
  disabled: boolean;
  onCreateAndRunBranchGroup: (params: OraSessionBranchGroupCreateParams) => void;
}) {
  const defaultProviderId = selectedProviderId ?? providerOptions[0]?.id ?? "local-smoke";
  const defaultModeId = selectedModeId || modeCards[0]?.id || "single_agent";
  const t = (value: string) => translateCopy(language, value);
  const [drafts, setDrafts] = useState<BranchDraft[]>([
    { id: "candidate-1", label: branchCandidateLabel(language, 1), providerId: defaultProviderId, modeId: defaultModeId },
    { id: "candidate-2", label: branchCandidateLabel(language, 2), providerId: defaultProviderId, modeId: defaultModeId },
  ]);

  function updateDraft(id: string, patch: Partial<BranchDraft>) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  }

  function startBranches() {
    const prompt = composerPrompt.trim();
    const candidates = drafts.map((draft) => {
      const provider = providerOptions.find((option) => option.id === draft.providerId);
      const mode = modeCards.find((option) => option.id === draft.modeId);
      const config: Partial<OraRunConfig> = {
        pattern: mode?.family,
        modeId: draft.modeId,
        modeSelection: "manual",
        providerId: draft.providerId,
        providerConfig: provider as OraRunConfig["providerConfig"],
        modelRef: provider?.modelId ?? "local/smoke-model",
        permissionMode: permissionMode as OraRunConfig["permissionMode"],
        metadata: {
          source: "desktop-branch-panel",
          taskIntent,
        },
      };
      return {
        label: draft.label.trim() || draft.id,
        config,
      };
    });
    onCreateAndRunBranchGroup({
      sessionId,
      target: "replace_latest",
      ...(prompt ? { prompt } : {}),
      candidates: candidates.slice(0, 2),
    });
  }

  return (
    <section className="mx-auto mt-4 flex w-full max-w-[88rem] flex-col gap-3 border-b border-border bg-background/95 px-4 pb-4 pt-3 shadow-sm md:px-6 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GitBranchPlus size={15} />
          <span>{t("Branch candidates")}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
            {t("Replace latest turn")}
          </span>
          <Button size="sm" variant="secondary" onClick={startBranches} disabled={disabled || !activeSnapshot?.input.prompt}>
            <GitBranchPlus size={14} />
            {t("Run")}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {drafts.map((draft) => (
          <div key={draft.id} className="grid gap-2 rounded-md border border-border bg-card p-2 md:grid-cols-3">
            <input
              value={draft.label}
              onChange={(event) => updateDraft(draft.id, { label: event.target.value })}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              disabled={disabled}
            />
            <Select value={draft.providerId} onChange={(event) => updateDraft(draft.id, { providerId: event.target.value })} className="h-8 text-xs" disabled={disabled}>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </Select>
            <Select value={draft.modeId} onChange={(event) => updateDraft(draft.id, { modeId: event.target.value })} className="h-8 text-xs" disabled={disabled}>
              {modeCards.map((mode) => (
                <option key={mode.id} value={mode.id}>{mode.label}</option>
              ))}
            </Select>
          </div>
        ))}
      </div>
    </section>
  );
}
