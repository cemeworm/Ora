import { deriveSnapshotGateProjection, type ModeSelection } from "@cemeworm/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, GitBranchPlus } from "lucide-react";
import { AssistantTurnCard } from "./AssistantTurnCard";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { PlanStepsTray } from "./PlanStepsTray";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { cn } from "../lib/utils";
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
import { useWorkbench, type ComposerImageAttachment, type ComposerLocalFileAttachment } from "../lib/state";
import { derivePresentedAssistantTurnFromSnapshot } from "../lib/viewModel";
import { getWelcomeGreeting } from "../lib/welcomeGreeting";
import { translateCopy, type AppLanguage } from "../lib/i18n";
import type { DesktopRunInteractionState } from "../lib/runInteractionState";

const LOCAL_FILE_PREVIEW_MAX_BYTES = 256 * 1024;
export const CHAT_VIEW_ROOT_CLASS =
  "relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent";
export const CHAT_VIEW_MAIN_CLASS =
  "relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden pt-12";
export const CHAT_VIEW_CONTENT_ROW_CLASS =
  "relative flex min-h-0 min-w-0 flex-1 overflow-hidden";
export const CHAT_VIEW_MESSAGES_PANEL_CLASS =
  "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden";
export const CHAT_VIEW_STABLE_CONTENT_WIDTH_CLASS =
  "w-full max-w-[54rem] pl-4 pr-4 md:pl-6 md:pr-6 xl:pl-8 xl:pr-8";
export const CHAT_VIEW_COLLABORATION_SHIFT_CLASS = "lg:-translate-x-8";
export const CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS =
  "pointer-events-none absolute right-4 top-3 z-20 hidden lg:block xl:right-6 xl:top-4";
export const CHAT_VIEW_DESKTOP_OVERLAY_STACK_CLASS =
  "pointer-events-auto flex w-[min(24rem,calc(100vw-6rem))] flex-col gap-3";
const DESKTOP_FLOATING_OVERLAY_MEDIA_QUERY = "(min-width: 1024px)";

function matchesDesktopFloatingOverlayViewport() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DESKTOP_FLOATING_OVERLAY_MEDIA_QUERY).matches;
}

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
  projectRootPath?: string;
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
  onAcceptPlanDecisionAndStartImplementation: () =>
    | void
    | boolean
    | Promise<void | boolean>;
  onResolvePlanDecision: (status: "accepted" | "declined") =>
    | void
    | boolean
    | Promise<void | boolean>;
  onOpenArtifact: (artifactId: string) => void;
  onSubmitFeedback: (
    message: ChatMessage,
    feedbackText: string,
  ) => Promise<void>;
  onSubmitAllClarifications: (answers: Record<string, string>) => void;
  onSelectMode: (modeId: string) => void;
  onSelectModeSelection: (selection: ModeSelection) => void;
  onSelectNode: (id: string) => void;
  onSelectSession: (sessionId: string) => void | Promise<void>;
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

export function resolveComposerGateSnapshot({
  activeSnapshot,
  turnSnapshots,
  sourceRunId,
}: {
  activeSnapshot?: OraStateSnapshot;
  turnSnapshots: Record<string, OraStateSnapshot | undefined>;
  sourceRunId?: string;
}) {
  if (sourceRunId && turnSnapshots[sourceRunId]) {
    return turnSnapshots[sourceRunId];
  }
  return activeSnapshot;
}

export function deriveCurrentComposerPlanSteps({
  activeSnapshot,
  runInteractionState,
}: {
  activeSnapshot?: Pick<OraStateSnapshot, "planList">;
  runInteractionState: Pick<DesktopRunInteractionState, "isProcessing" | "gateKind" | "status">;
}): TurnPlanListStep[] {
  const snapshotPlan = activeSnapshot?.planList;
  if (!snapshotPlan || snapshotPlan.length === 0) {
    return [];
  }
  if (runInteractionState.gateKind) {
    return [];
  }

  return snapshotPlan.map((item) => ({
    step: item.step,
    status: item.status,
  }));
}

export function deriveComposerPlanDecisionState({
  activeSnapshot,
  pendingResolution,
  sessionId,
}: {
  activeSnapshot?: OraStateSnapshot;
  pendingResolution?: { sessionId: string; decisionId: string };
  sessionId: string;
}) {
  if (!activeSnapshot) {
    return {
      pendingPlanDecisionId: undefined,
      planDecisionPending: false,
    };
  }
  const gate = deriveSnapshotGateProjection(activeSnapshot);
  const pendingPlanDecisionId = gate?.kind === "plan_decision"
    ? gate.planDecisionId ?? gate.gateIds[0]
    : undefined;
  const resolvingPlanDecision = Boolean(
    pendingPlanDecisionId &&
      pendingResolution?.sessionId === sessionId &&
      pendingResolution.decisionId === pendingPlanDecisionId,
  );
  return {
    pendingPlanDecisionId,
    planDecisionPending: Boolean(pendingPlanDecisionId && !resolvingPlanDecision),
  };
}

export function deriveChildReplaySelection({
  snapshot,
  child,
}: {
  snapshot?: OraStateSnapshot;
  child: NonNullable<OraStateSnapshot["childSessions"]>[number];
}): { runId: string; beatId?: string } | undefined {
  const replayRef = child.replayRef;
  if (!snapshot || !replayRef || replayRef.runId !== snapshot.runId) {
    return undefined;
  }
  const preferredSeqs = [replayRef.fromSeq, replayRef.toSeq]
    .filter((seq): seq is number => typeof seq === "number");
  const beatId = preferredSeqs
    .map((seq) => snapshot.events.find((event) => event.seq === seq)?.id)
    .find((id): id is string => typeof id === "string");
  return { runId: snapshot.runId, beatId };
}

export function deriveVisibleCollaborationChildren(
  snapshot?: Pick<OraStateSnapshot, "childSessions">,
): NonNullable<OraStateSnapshot["childSessions"]> {
  return (snapshot?.childSessions ?? []).filter((child) =>
    child.status === "queued" ||
    child.status === "running" ||
    child.deliveryStatus === "awaiting_pickup"
  );
}

export function shouldShowCollaborationOverlay(
  snapshot?: Pick<OraStateSnapshot, "childSessions">,
): boolean {
  return deriveVisibleCollaborationChildren(snapshot).length > 0;
}

export function toggleExpandedOverlayChildId(
  expandedChildId: string | undefined,
  childId: string,
): string | undefined {
  return expandedChildId === childId ? undefined : childId;
}

export function resolveOverlayChildSnapshot(
  child: NonNullable<OraStateSnapshot["childSessions"]>[number],
  turnSnapshots: Record<string, OraStateSnapshot | undefined>,
): OraStateSnapshot | undefined {
  const childSnapshot = turnSnapshots[child.id];
  if (childSnapshot?.runId === child.id) {
    return childSnapshot;
  }
  return deriveOverlayReplayChildSnapshot(child, turnSnapshots);
}

export function deriveOverlayChildTurnView(
  child: NonNullable<OraStateSnapshot["childSessions"]>[number],
  turnSnapshots: Record<string, OraStateSnapshot | undefined>,
) {
  const snapshot = resolveOverlayChildSnapshot(child, turnSnapshots);
  return snapshot ? derivePresentedAssistantTurnFromSnapshot(snapshot) : undefined;
}

function deriveOverlayReplayChildSnapshot(
  child: NonNullable<OraStateSnapshot["childSessions"]>[number],
  turnSnapshots: Record<string, OraStateSnapshot | undefined>,
): OraStateSnapshot | undefined {
  const replayRef = child.replayRef;
  if (!replayRef || replayRef.kind !== "event_range") {
    return undefined;
  }
  const parentSnapshot = turnSnapshots[replayRef.runId];
  if (!parentSnapshot || parentSnapshot.runId !== replayRef.runId) {
    return undefined;
  }
  return deriveOverlayChildSnapshotFromParentReplay({
    parentSnapshot,
    child,
  });
}

function deriveOverlayChildSnapshotFromParentReplay({
  parentSnapshot,
  child,
}: {
  parentSnapshot: OraStateSnapshot;
  child: NonNullable<OraStateSnapshot["childSessions"]>[number];
}): OraStateSnapshot | undefined {
  const replayRef = child.replayRef;
  if (!replayRef || replayRef.kind !== "event_range") {
    return undefined;
  }
  const fromSeq = typeof replayRef.fromSeq === "number" ? replayRef.fromSeq : 0;
  const toSeq = typeof replayRef.toSeq === "number"
    ? replayRef.toSeq
    : Number.MAX_SAFE_INTEGER;
  const childEvents = parentSnapshot.events
    .filter((event) =>
      event.runId === parentSnapshot.runId &&
      event.seq >= fromSeq &&
      event.seq <= toSeq &&
      isOverlayReplayChildEvent(event, child)
    )
    .map((event) => sanitizeOverlayReplayChildEvent(event, child.id));
  const childAgentMessages = (parentSnapshot.agentMessages ?? [])
    .filter((message) => isOverlayReplayChildAgentMessage(message, child))
    .map((message) => ({
      ...message,
      toAgentIds: [...message.toAgentIds],
      artifactIds: [...message.artifactIds],
    }));
  const artifactIds = collectOverlayReplayArtifactIds({
    child,
    events: childEvents,
    agentMessages: childAgentMessages,
  });
  const fallbackOutputText = deriveOverlayReplayFallbackOutput({
    child,
    events: childEvents,
  });
  const hasReplayMaterial =
    childEvents.length > 0 ||
    childAgentMessages.length > 0 ||
    artifactIds.size > 0 ||
    Boolean(fallbackOutputText);
  if (!hasReplayMaterial) {
    return undefined;
  }

  return {
    ...parentSnapshot,
    runId: child.id,
    sessionId: child.sourceSessionId ?? parentSnapshot.sessionId,
    status: child.status,
    profiles: deriveOverlayReplayProfiles(parentSnapshot, child, childEvents, childAgentMessages),
    events: childEvents,
    agentMessages: childAgentMessages,
    childSessions: [],
    parentCoordination: undefined,
    artifacts: parentSnapshot.artifacts.filter((artifact) => artifactIds.has(artifact.id)),
    activeAgents:
      child.status === "queued" || child.status === "running" || child.deliveryStatus === "awaiting_pickup"
        ? [child.agentId]
        : [],
    pendingClarifications: [],
    pendingApprovals: [],
    output: fallbackOutputText ? { text: fallbackOutputText } : undefined,
    updatedAt: child.updatedAt,
  };
}

function isOverlayReplayChildEvent(
  event: OraStateSnapshot["events"][number],
  child: NonNullable<OraStateSnapshot["childSessions"]>[number],
): boolean {
  if (event.agentId === child.agentId || event.nodeId === child.agentId) {
    return true;
  }
  if (
    event.type === "child_session.updated" &&
    isRecord(event.payload) &&
    isRecord(event.payload.childSession)
  ) {
    return event.payload.childSession.id === child.id ||
      event.payload.childSession.agentId === child.agentId;
  }
  if (
    event.type === "agent.message" &&
    isRecord(event.payload) &&
    isRecord(event.payload.message)
  ) {
    const fromAgentId = event.payload.message.fromAgentId;
    const toAgentIds = Array.isArray(event.payload.message.toAgentIds)
      ? event.payload.message.toAgentIds
      : [];
    return fromAgentId === child.agentId ||
      toAgentIds.some((agentId) => agentId === child.agentId);
  }
  return false;
}

function sanitizeOverlayReplayChildEvent(
  event: OraStateSnapshot["events"][number],
  childRunId: string,
): OraStateSnapshot["events"][number] {
  if (event.type !== "message.delta" || !isRecord(event.payload)) {
    return {
      ...event,
      runId: childRunId,
      payload: clonePayload(event.payload),
    };
  }
  const payload = { ...event.payload };
  delete payload.visibility;
  delete payload.audience;
  delete payload.surface;
  delete payload.public;
  return {
    ...event,
    runId: childRunId,
    payload,
  };
}

function isOverlayReplayChildAgentMessage(
  message: OraStateSnapshot["agentMessages"][number],
  child: NonNullable<OraStateSnapshot["childSessions"]>[number],
): boolean {
  return message.fromAgentId === child.agentId;
}

function collectOverlayReplayArtifactIds({
  child,
  events,
  agentMessages,
}: {
  child: NonNullable<OraStateSnapshot["childSessions"]>[number];
  events: OraStateSnapshot["events"];
  agentMessages: OraStateSnapshot["agentMessages"];
}): Set<string> {
  const artifactIds = new Set(child.artifactIds);
  for (const message of agentMessages) {
    for (const artifactId of message.artifactIds) {
      artifactIds.add(artifactId);
    }
  }
  for (const event of events) {
    if (!isRecord(event.payload)) {
      continue;
    }
    const payloadArtifactId = event.payload.artifactId;
    if (typeof payloadArtifactId === "string" && payloadArtifactId.trim()) {
      artifactIds.add(payloadArtifactId);
    }
    const payloadArtifactIds = event.payload.artifactIds;
    if (Array.isArray(payloadArtifactIds)) {
      for (const artifactId of payloadArtifactIds) {
        if (typeof artifactId === "string" && artifactId.trim()) {
          artifactIds.add(artifactId);
        }
      }
    }
  }
  return artifactIds;
}

function deriveOverlayReplayFallbackOutput({
  child,
  events,
}: {
  child: NonNullable<OraStateSnapshot["childSessions"]>[number];
  events: OraStateSnapshot["events"];
}): string | undefined {
  const hasAssistantDelta = events.some((event) =>
    event.type === "message.delta" &&
    event.agentId === child.agentId &&
    isRecord(event.payload) &&
    event.payload.role === "assistant" &&
    typeof event.payload.content === "string" &&
    event.payload.content.trim().length > 0
  );
  if (hasAssistantDelta) {
    return undefined;
  }
  return child.lastMessage?.trim() || child.summary?.trim() || undefined;
}

function deriveOverlayReplayProfiles(
  parentSnapshot: OraStateSnapshot,
  child: NonNullable<OraStateSnapshot["childSessions"]>[number],
  events: OraStateSnapshot["events"],
  agentMessages: OraStateSnapshot["agentMessages"],
): OraStateSnapshot["profiles"] {
  const referencedAgentIds = new Set<string>([child.agentId]);
  for (const event of events) {
    if (typeof event.agentId === "string" && event.agentId.trim()) {
      referencedAgentIds.add(event.agentId);
    }
    if (typeof event.nodeId === "string" && event.nodeId.trim()) {
      referencedAgentIds.add(event.nodeId);
    }
  }
  for (const message of agentMessages) {
    referencedAgentIds.add(message.fromAgentId);
    for (const agentId of message.toAgentIds) {
      referencedAgentIds.add(agentId);
    }
  }
  const filteredProfiles = parentSnapshot.profiles.filter((profile) =>
    referencedAgentIds.has(profile.id)
  );
  return filteredProfiles.length > 0 ? filteredProfiles : parentSnapshot.profiles;
}

function clonePayload<T>(payload: T): T {
  if (!isRecord(payload) && !Array.isArray(payload)) {
    return payload;
  }
  return JSON.parse(JSON.stringify(payload)) as T;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function derivePlanStepsPresentation({
  planSteps,
  isDesktopViewport,
}: {
  planSteps: TurnPlanListStep[];
  isDesktopViewport: boolean;
}) {
  if (planSteps.length === 0) {
    return {
      inlinePlanSteps: [] as TurnPlanListStep[],
      floatingPlanSteps: [] as TurnPlanListStep[],
    };
  }
  return isDesktopViewport
    ? {
        inlinePlanSteps: [] as TurnPlanListStep[],
        floatingPlanSteps: planSteps,
      }
    : {
        inlinePlanSteps: planSteps,
        floatingPlanSteps: [] as TurnPlanListStep[],
      };
}

export function shouldShowDesktopOverlayRail({
  hasCollaborationOverlay,
  hasFloatingPlanSteps,
}: {
  hasCollaborationOverlay: boolean;
  hasFloatingPlanSteps: boolean;
}) {
  return hasCollaborationOverlay || hasFloatingPlanSteps;
}

export function deriveChatSurfaceContentWidthClassName(
  _hasCollaborationOverlay: boolean,
): string {
  return CHAT_VIEW_STABLE_CONTENT_WIDTH_CLASS;
}

export function deriveChatSurfaceShiftClassName(
  hasCollaborationOverlay: boolean,
): string {
  return hasCollaborationOverlay ? CHAT_VIEW_COLLABORATION_SHIFT_CLASS : "";
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
  projectRootPath,
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
  const imageAttachments = state.sessionImageAttachments[selectedSession.id] ?? [];
  const composerGateSnapshot = resolveComposerGateSnapshot({
    activeSnapshot,
    turnSnapshots,
    sourceRunId: runInteractionState.sourceRunId,
  });
  const attention =
    composerGateSnapshot?.attention ?? state.activeSessionDetail?.session.attention;
  const {
    approvalActions: pendingApprovalActions,
    clarificationQuestions: pendingClarifications,
    hasApprovalTray,
    hasClarificationTray,
  } = deriveProjectedGateTrays({
    attention,
    actionRecords,
    pendingClarifications: composerGateSnapshot?.pendingClarifications ?? [],
  });
  const { planDecisionPending } = deriveComposerPlanDecisionState({
    activeSnapshot: composerGateSnapshot,
    pendingResolution: state.pendingPlanDecisionResolution,
    sessionId: selectedSession.id,
  });
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(0);
  const [isDesktopViewport, setIsDesktopViewport] = useState(
    matchesDesktopFloatingOverlayViewport,
  );
  const handleOverlayHeightChange = useCallback((height: number) => {
    setComposerOverlayHeight((current) => current === height ? current : height);
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mediaQuery = window.matchMedia(DESKTOP_FLOATING_OVERLAY_MEDIA_QUERY);
    const handleChange = () => setIsDesktopViewport(mediaQuery.matches);
    handleChange();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const gateKind = runInteractionState.gateKind;
  const currentPlanSteps = useMemo<TurnPlanListStep[]>(
    () => deriveCurrentComposerPlanSteps({
      activeSnapshot: composerGateSnapshot,
      runInteractionState,
    }),
    [composerGateSnapshot, gateKind],
  );
  const visibleCollaborationChildren = useMemo(
    () => deriveVisibleCollaborationChildren(activeSnapshot),
    [activeSnapshot],
  );
  const showCollaborationOverlay = useMemo(
    () => shouldShowCollaborationOverlay(activeSnapshot),
    [activeSnapshot],
  );
  const { inlinePlanSteps, floatingPlanSteps } = useMemo(
    () => derivePlanStepsPresentation({
      planSteps: currentPlanSteps,
      isDesktopViewport,
    }),
    [currentPlanSteps, isDesktopViewport],
  );
  const showDesktopOverlayRail = useMemo(
    () => shouldShowDesktopOverlayRail({
      hasCollaborationOverlay: showCollaborationOverlay,
      hasFloatingPlanSteps: floatingPlanSteps.length > 0,
    }),
    [showCollaborationOverlay, floatingPlanSteps],
  );
  const chatSurfaceContentWidthClassName = useMemo(
    () => deriveChatSurfaceContentWidthClassName(showDesktopOverlayRail),
    [showDesktopOverlayRail],
  );
  const chatSurfaceShiftClassName = useMemo(
    () => deriveChatSurfaceShiftClassName(showDesktopOverlayRail),
    [showDesktopOverlayRail],
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

  function handleImagePasted(image: ComposerImageAttachment) {
    dispatch({
      type: "ADD_IMAGE_ATTACHMENT",
      sessionId: selectedSession.id,
      image,
    });
  }

  return (
    <div className={CHAT_VIEW_ROOT_CLASS}>
      <ChatHeader
        busyCommand={busyCommand}
        selectedSession={selectedSession}
        onOpenBranches={() => setBranchPanelOpen((open) => !open)}
        onToggleDetailDrawer={onToggleDetailDrawer}
        detailDrawer={detailDrawer}
        language={state.language}
      />
      <main className={CHAT_VIEW_MAIN_CLASS}>
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
        <div className={CHAT_VIEW_CONTENT_ROW_CLASS}>
          <div className={CHAT_VIEW_MESSAGES_PANEL_CLASS}>
            <div
              className={cn(
                "relative flex min-h-0 flex-1 flex-col transition-transform duration-200 motion-reduce:transition-none",
                chatSurfaceShiftClassName,
              )}
            >
              {showWelcome && (
                <div className="pointer-events-none absolute left-0 right-0 top-[calc(50%-160px)] z-10 flex justify-center">
                  <div
                    className={cn(
                      "flex w-full flex-col items-center gap-2 text-center",
                      chatSurfaceContentWidthClassName,
                    )}
                  >
                    <div className="flex items-center gap-2 text-2xl font-bold">
                      <span>{getWelcomeGreeting(new Date(), state.language, projectLabel)}</span>
                    </div>
                  </div>
                </div>
              )}
              <ChatMessages
                chatMessages={chatMessages}
                branchGroups={branchGroups}
                turnSnapshots={turnSnapshots}
                language={state.language}
                actionRecords={actionRecords}
                hasApprovalTray={hasApprovalTray}
                hasClarificationTray={hasClarificationTray}
                hasPlanDecisionTray={planDecisionPending}
                hasPlanStepsTray={inlinePlanSteps.length > 0}
                bottomInsetPx={composerOverlayHeight}
                contentWidthClassName={chatSurfaceContentWidthClassName}
                projectRootPath={projectRootPath}
                onOpenArtifact={onOpenArtifact}
                onSubmitFeedback={onSubmitFeedback}
                onAdoptBranchGroup={onAdoptBranchGroup}
              />
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
                imageAttachments={imageAttachments}
                onRemoveImageAttachment={(name) =>
                  dispatch({
                    type: "REMOVE_IMAGE_ATTACHMENT",
                    sessionId: selectedSession.id,
                    name,
                  })
                }
                onAddImageAttachment={handleImagePasted}
                permissionMode={state.permissionMode}
                onPermissionModeChange={(mode) => dispatch({ type: "SET_PERMISSION_MODE", permissionMode: mode })}
                taskIntent={state.taskIntent}
                onTaskIntentChange={(ti) => dispatch({ type: "SET_TASK_INTENT", taskIntent: ti })}
                planDecisionPending={planDecisionPending}
                planSteps={inlinePlanSteps}
                onConfirmPlanDecision={onAcceptPlanDecisionAndStartImplementation}
                onDeclinePlanDecision={() => onResolvePlanDecision("declined")}
                onOverlayHeightChange={handleOverlayHeightChange}
                contentWidthClassName={chatSurfaceContentWidthClassName}
                onOpenLocalFiles={() => void openLocalFiles()}
                onFilesDropped={handleFilesDropped}
                onClearSelectedCustomAgent={onClearSelectedCustomAgent}
                onStartRun={onStartRun}
                onStopRun={onCancelRun}
              />
            </div>
          </div>
          <DesktopOverlayRail
            childSessions={visibleCollaborationChildren}
            planSteps={floatingPlanSteps}
            turnSnapshots={turnSnapshots}
            projectRootPath={projectRootPath}
            onOpenArtifact={onOpenArtifact}
          />
        </div>
      </main>
    </div>
  );
}

export function DesktopOverlayRail({
  childSessions,
  planSteps,
  turnSnapshots,
  projectRootPath,
  onOpenArtifact,
}: {
  childSessions: NonNullable<OraStateSnapshot["childSessions"]>;
  planSteps: TurnPlanListStep[];
  turnSnapshots: Record<string, OraStateSnapshot | undefined>;
  projectRootPath?: string;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const [expandedChildId, setExpandedChildId] = useState<string | undefined>(
    undefined,
  );

  if (childSessions.length === 0 && planSteps.length === 0) {
    return null;
  }

  return (
    <div className={CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS}>
      <div className={CHAT_VIEW_DESKTOP_OVERLAY_STACK_CLASS}>
        {childSessions.length > 0 ? (
          <section className="rounded-3xl border border-border/70 bg-background/92 p-3 shadow-lift backdrop-blur-md">
            <div className="flex items-center gap-2 px-1 pb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-muted text-foreground">
                <Bot className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  子代理协作中
                </p>
                <p className="text-xs text-muted-foreground">
                  {childSessions.length} 个任务仍在协作流程中
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {childSessions.map((child) => {
                const expanded = expandedChildId === child.id;
                const childTurnView = deriveOverlayChildTurnView(child, turnSnapshots);
                return (
                  <section
                    key={child.id}
                    className="rounded-2xl border border-border/70 bg-card/80 p-2.5"
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setExpandedChildId((current) =>
                        toggleExpandedOverlayChildId(current, child.id)
                      )}
                      className="flex w-full items-start justify-between gap-3 text-left"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {child.label}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {child.summary ?? child.lastMessage ?? "正在等待子代理返回最新进展。"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                          {childStatusLabel(child.status, child.deliveryStatus)}
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            expanded && "rotate-180",
                          )}
                        />
                      </div>
                    </button>
                    {expanded ? (
                      <div className="mt-2 rounded-[1rem] border border-border/70 bg-background/82 p-2 max-h-[min(72vh,42rem)] overflow-y-auto overscroll-contain">
                        {childTurnView ? (
                          <AssistantTurnCard
                            content={childTurnView.content}
                            turn={childTurnView.turn}
                            density="compact"
                            onOpenArtifact={onOpenArtifact}
                            projectRootPath={projectRootPath}
                          />
                        ) : (
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">
                              等待子代理内容同步
                            </p>
                            <p className="text-xs leading-5 text-muted-foreground">
                              当前只拿到了子代理摘要；待对应 session snapshot 进入本地状态后，这里会自动显示完整 timeline / process / body 内容。
                            </p>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </section>
        ) : null}
        {planSteps.length > 0 ? (
          <PlanStepsTray planSteps={planSteps} variant="floating" />
        ) : null}
      </div>
    </div>
  );
}

function childStatusLabel(
  status: NonNullable<OraStateSnapshot["childSessions"]>[number]["status"],
  deliveryStatus?: NonNullable<OraStateSnapshot["childSessions"]>[number]["deliveryStatus"],
): string {
  if (status === "succeeded" && deliveryStatus === "awaiting_pickup") {
    return "待接收";
  }
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "执行中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
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
  const defaultProviderId = selectedProviderId ?? providerOptions[0]?.id ?? "";
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
        modelRef: provider?.modelId ?? "",
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
