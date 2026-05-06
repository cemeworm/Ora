import type { ModeSelection } from "@cemeworm/shared";
import { useCallback, useMemo, useState } from "react";
import { Check, GitBranchPlus, Plus, Trash2, X } from "lucide-react";
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
import type { OraRunConfig, OraSessionBranchGroup, OraSessionBranchGroupCreateParams, OraStateSnapshot } from "../lib/runtimeClient";
import { runnableProviderOptions } from "../lib/providerOptions";
import { useWorkbench, type ComposerLocalFileAttachment } from "../lib/state";
import { getWelcomeGreeting } from "../lib/welcomeGreeting";
import { translateCopy, type AppLanguage } from "../lib/i18n";

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
  onForkRun: () => void;
  onCreateAndRunBranchGroup: (params: OraSessionBranchGroupCreateParams) => void;
  onAdoptBranchGroup: (branchGroupId: string, runId: string) => void;
  onDismissBranchGroup: (branchGroupId: string) => void;
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
  onAcceptPlanDecisionAndStartImplementation,
  onResolvePlanDecision,
  onCancelRun,
  onCreateAndRunBranchGroup,
  onAdoptBranchGroup,
  onDismissBranchGroup,
  onOpenArtifact,
  onSubmitFeedback,
  onSubmitAllClarifications,
  onToggleDetailDrawer,
  detailDrawer,
  onSelectMode,
  onSelectModeSelection,
}: ChatViewProps) {
  const { state, dispatch } = useWorkbench();
  const showWelcome = chatMessages.length === 0 && !isRunning;
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
  const planDecisionPending =
    attention?.kind === "needs_plan_decision" && hasPendingPlanDecisionEntity;
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(0);
  const handleOverlayHeightChange = useCallback((height: number) => {
    setComposerOverlayHeight((current) => current === height ? current : height);
  }, []);

  const currentPlanSteps = useMemo<TurnPlanListStep[]>(() => {
    const snapshotPlan = activeSnapshot?.planList;
    if (snapshotPlan && snapshotPlan.length > 0) {
      return snapshotPlan.map((item) => ({
        step: item.step,
        status: item.status,
      }));
    }
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const planList = chatMessages[i]?.turn?.planList;
    if (planList && planList.length > 0) return planList;
    }
    return [];
  }, [activeSnapshot?.planList, chatMessages]);
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
            branchGroups={branchGroups}
            modeCards={modeCards}
            providerOptions={providerOptions}
            selectedProviderId={state.selectedProviderId}
            selectedModeId={state.selectedModeId}
            taskIntent={state.taskIntent}
            permissionMode={state.permissionMode}
            language={state.language}
            disabled={busyCommand !== undefined || isRunning}
            onCreateAndRunBranchGroup={onCreateAndRunBranchGroup}
            onAdoptBranchGroup={onAdoptBranchGroup}
            onDismissBranchGroup={onDismissBranchGroup}
          />
        )}
        <div className="flex min-h-0 flex-1">
          <ChatMessages
            chatMessages={chatMessages}
            actionRecords={actionRecords}
            hasApprovalTray={hasApprovalTray}
            hasClarificationTray={hasClarificationTray}
            hasPlanDecisionTray={planDecisionPending}
            hasPlanStepsTray={currentPlanSteps.length > 0}
            bottomInsetPx={composerOverlayHeight}
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

function formatBranchTarget(language: AppLanguage, target: OraSessionBranchGroup["target"]) {
  switch (target) {
    case "replace_latest":
      return translateCopy(language, "Replace latest turn");
    case "append_after_latest":
      return translateCopy(language, "Append after latest");
    case "empty_start":
      return translateCopy(language, "Empty session start");
  }
}

function formatBranchStatus(language: AppLanguage, status: OraSessionBranchGroup["status"] | string) {
  switch (status) {
    case "running":
      return translateCopy(language, "Running");
    case "ready":
      return translateCopy(language, "Ready");
    case "adopted":
      return translateCopy(language, "Adopted");
    case "dismissed":
      return translateCopy(language, "Dismissed");
    case "queued":
      return translateCopy(language, "Queued");
    case "succeeded":
      return translateCopy(language, "Succeeded");
    case "failed":
      return translateCopy(language, "Failed");
    default:
      return status;
  }
}

function BranchComparisonPanel({
  sessionId,
  composerPrompt,
  activeSnapshot,
  branchGroups,
  modeCards,
  providerOptions,
  selectedProviderId,
  selectedModeId,
  taskIntent,
  permissionMode,
  language,
  disabled,
  onCreateAndRunBranchGroup,
  onAdoptBranchGroup,
  onDismissBranchGroup,
}: {
  sessionId: string;
  composerPrompt: string;
  activeSnapshot?: OraStateSnapshot;
  branchGroups: OraSessionBranchGroup[];
  modeCards: ModeCard[];
  providerOptions: { id: string; label: string; modelId?: string }[];
  selectedProviderId?: string;
  selectedModeId: string;
  taskIntent: "chat" | "plan" | "implement";
  permissionMode: string;
  language: AppLanguage;
  disabled: boolean;
  onCreateAndRunBranchGroup: (params: OraSessionBranchGroupCreateParams) => void;
  onAdoptBranchGroup: (branchGroupId: string, runId: string) => void;
  onDismissBranchGroup: (branchGroupId: string) => void;
}) {
  const defaultProviderId = selectedProviderId ?? providerOptions[0]?.id ?? "local-smoke";
  const defaultModeId = selectedModeId || modeCards[0]?.id || "single_agent";
  const t = (value: string) => translateCopy(language, value);
  const [target, setTarget] = useState<OraSessionBranchGroupCreateParams["target"]>(
    activeSnapshot?.input.prompt ? "replace_latest" : "empty_start",
  );
  const [drafts, setDrafts] = useState<BranchDraft[]>([
    { id: "candidate-1", label: branchCandidateLabel(language, 1), providerId: defaultProviderId, modeId: defaultModeId },
    { id: "candidate-2", label: branchCandidateLabel(language, 2), providerId: defaultProviderId, modeId: defaultModeId },
  ]);

  function updateDraft(id: string, patch: Partial<BranchDraft>) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  }

  function addDraft() {
    setDrafts((current) => [
      ...current,
      {
        id: `candidate-${Date.now()}`,
        label: branchCandidateLabel(language, current.length + 1),
        providerId: defaultProviderId,
        modeId: defaultModeId,
      },
    ]);
  }

  function removeDraft(id: string) {
    setDrafts((current) => current.length <= 1 ? current : current.filter((draft) => draft.id !== id));
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
      target,
      ...(prompt ? { prompt } : {}),
      candidates,
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
          <Select
            value={target}
            onChange={(event) => setTarget(event.target.value as OraSessionBranchGroupCreateParams["target"])}
            className="h-8 min-w-[180px] text-xs"
            disabled={disabled}
          >
            <option value="replace_latest">{t("Replace latest turn")}</option>
            <option value="append_after_latest">{t("Append after latest")}</option>
            <option value="empty_start">{t("Empty session start")}</option>
          </Select>
          <Button size="sm" variant="secondary" onClick={startBranches} disabled={disabled || (target !== "replace_latest" && !composerPrompt.trim())}>
            <GitBranchPlus size={14} />
            {t("Run")}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {drafts.map((draft) => (
          <div key={draft.id} className="grid gap-2 rounded-md border border-border bg-card p-2 md:grid-cols-[1fr_1fr_auto]">
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
            <Button size="icon" variant="ghost" onClick={() => removeDraft(draft.id)} disabled={disabled || drafts.length <= 1} title={t("Remove candidate")}>
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost" onClick={addDraft} disabled={disabled || drafts.length >= 6} className="w-fit">
        <Plus size={14} />
        {t("Add candidate")}
      </Button>

      {branchGroups.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {branchGroups.map((group) => (
            <div key={group.branchGroupId} className="rounded-md border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{group.prompt}</div>
                  <div className="text-[11px] text-muted-foreground">{formatBranchTarget(language, group.target)} · {formatBranchStatus(language, group.status)}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => onDismissBranchGroup(group.branchGroupId)} disabled={disabled || group.status === "adopted"} title={t("Dismiss branch group")}>
                  <X size={14} />
                </Button>
              </div>
              <div className="grid gap-2">
                {group.candidates.map((candidate) => (
                  <div key={candidate.runId} className="rounded-md border border-border bg-background p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{candidate.label ?? candidate.runId}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{candidate.modelRef} · {candidate.modeId ?? "mode"}</div>
                      </div>
                      <Button
                        size="sm"
                        variant={candidate.adopted ? "secondary" : "ghost"}
                        onClick={() => onAdoptBranchGroup(group.branchGroupId, candidate.runId)}
                        disabled={disabled || candidate.adopted || candidate.status !== "succeeded"}
                        title={t("Adopt branch candidate")}
                      >
                        <Check size={13} />
                        {t("Adopt")}
                      </Button>
                    </div>
                    {candidate.outputPreview ? (
                      <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{candidate.outputPreview}</p>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">{formatBranchStatus(language, candidate.status)}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
