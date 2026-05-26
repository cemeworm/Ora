import { deriveSnapshotGateProjection, type ModeSelection } from "@cemeworm/shared";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, ChevronDown } from "lucide-react";
import { AssistantTurnCard } from "./AssistantTurnCard";
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import {
  FLOATING_OVERLAY_BADGE_BASE_CLASS,
  FLOATING_OVERLAY_CARD_CLASS,
  FLOATING_OVERLAY_DETAIL_CLASS,
  FLOATING_OVERLAY_ICON_PLATE_CLASS,
  FLOATING_OVERLAY_PANEL_CLASS,
  PLAN_STEPS_TRAY_HEADER_CHEVRON_CLASS,
  PlanStepsList,
  nextPlanTrayOpenState,
} from "./PlanStepsTray";
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
import type { OraStateSnapshot } from "../lib/runtimeClient";
import { runnableProviderOptions } from "../lib/providerOptions";
import {
  useWorkbench,
  type ComposerImageAttachment,
  type ComposerLocalFileAttachment,
  type RightWorkspaceSessionState,
} from "../lib/state";
import { derivePresentedAssistantTurnFromSnapshot } from "../lib/viewModel";
import { getWelcomeGreeting } from "../lib/welcomeGreeting";
import type { DesktopRunInteractionState } from "../lib/runInteractionState";
import type { PlanDecisionResolutionOverride } from "../lib/state";
import {
  CHAT_SURFACE_FRAME_WIDTH_CLASS,
  CHAT_SURFACE_VIEWPORT_GUTTER_CLASS,
} from "./chatSurfaceLayout";

const LOCAL_FILE_PREVIEW_MAX_BYTES = 256 * 1024;
export const CHAT_VIEW_ROOT_CLASS =
  "relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent";
export const CHAT_VIEW_MAIN_CLASS =
  "relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden pt-12";
export const CHAT_VIEW_CONTENT_ROW_CLASS =
  "relative flex min-h-0 min-w-0 flex-1 overflow-hidden";
export const CHAT_VIEW_MESSAGES_PANEL_CLASS =
  "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden";
export const CHAT_VIEW_STABLE_CONTENT_WIDTH_CLASS = CHAT_SURFACE_FRAME_WIDTH_CLASS;
export const CHAT_VIEW_WELCOME_VIEWPORT_CLASS = CHAT_SURFACE_VIEWPORT_GUTTER_CLASS;
export const CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS =
  "pointer-events-none absolute right-8 top-7 z-20 hidden lg:block xl:right-10 xl:top-8";
export const CHAT_VIEW_DESKTOP_FLOATING_STACK_CLASS =
  "pointer-events-auto flex w-[min(20rem,calc(100vw-8.5rem))] flex-col gap-2.5";
export const CHAT_VIEW_OVERLAY_PANEL_CLASS = FLOATING_OVERLAY_PANEL_CLASS;
export const CHAT_VIEW_OVERLAY_SECTION_CLASS = "border-t border-border/55 pt-3 first:border-t-0 first:pt-0";
export const CHAT_VIEW_OVERLAY_SECTION_HEADER_CLASS =
  "flex items-center justify-between gap-3 px-1 pb-2";
export const CHAT_VIEW_OVERLAY_SECTION_TITLE_CLASS =
  "text-sm font-semibold text-foreground";
export const CHAT_VIEW_OVERLAY_SECTION_SUMMARY_CLASS =
  "truncate text-xs text-muted-foreground";
export const CHAT_VIEW_COLLABORATION_PANEL_CLASS = "space-y-1.5";
export const CHAT_VIEW_COLLABORATION_ICON_PLATE_CLASS = cn(
  FLOATING_OVERLAY_ICON_PLATE_CLASS,
  "bg-muted/40",
);
export const CHAT_VIEW_COLLABORATION_ITEM_CLASS = FLOATING_OVERLAY_CARD_CLASS;
export const CHAT_VIEW_COLLABORATION_DETAIL_CLASS = FLOATING_OVERLAY_DETAIL_CLASS;
export const CHAT_VIEW_DESKTOP_OVERLAY_MIN_CONTENT_ROW_WIDTH = 1272;
const OVERLAY_CHILD_CARD_SUMMARY_MAX_CHARS = 280;
const DESKTOP_FLOATING_OVERLAY_MEDIA_QUERY = "(min-width: 1024px)";

function matchesDesktopFloatingOverlayViewport() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DESKTOP_FLOATING_OVERLAY_MEDIA_QUERY).matches;
}

function planStepsIdentity(planSteps: TurnPlanListStep[]) {
  return planSteps.map((item) => item.step).join("\n");
}

function planSummary(items: TurnPlanListStep[]) {
  const done = items.filter((s) => s.status === "completed").length;
  const active = items.find((s) => s.status === "in_progress");
  if (active) {
    return `正在进行 - ${active.step}`;
  }
  return "";
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
  onForkSessionFromTurn: (runId: string) => void;
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
  onSetRightWorkspaceOpen: (open: boolean) => void;
  selectedSessionWorkspace: RightWorkspaceSessionState;
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
  const sourceSnapshot = sourceRunId ? turnSnapshots[sourceRunId] : undefined;
  if (sourceSnapshot && activeSnapshot?.runId === sourceSnapshot.runId) {
    return (activeSnapshot.updatedAt ?? 0) >= (sourceSnapshot.updatedAt ?? 0)
      ? activeSnapshot
      : sourceSnapshot;
  }
  if (sourceSnapshot) {
    return sourceSnapshot;
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
  planDecisionResolutionOverrides,
}: {
  activeSnapshot?: OraStateSnapshot;
  pendingResolution?: { sessionId: string; decisionId: string };
  sessionId: string;
  planDecisionResolutionOverrides?: Record<string, PlanDecisionResolutionOverride>;
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
  const overridden = Boolean(
    pendingPlanDecisionId &&
    planDecisionResolutionOverrides?.[`${sessionId}:${pendingPlanDecisionId}`],
  );
  const resolvingPlanDecision = Boolean(
    pendingPlanDecisionId &&
      pendingResolution?.sessionId === sessionId &&
      pendingResolution.decisionId === pendingPlanDecisionId,
  );
  return {
    pendingPlanDecisionId: overridden ? undefined : pendingPlanDecisionId,
    planDecisionPending: Boolean(pendingPlanDecisionId && !overridden && !resolvingPlanDecision),
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
  const preferredSeqs = [
    replayRef.fromSeq,
    deriveOverlayReplayUpperBound(snapshot, child, replayRef),
  ]
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
    isDynamicSpawnOverlayChild(child) && isOverlayChildActive(child)
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

function isOverlayChildActive(
  child: NonNullable<OraStateSnapshot["childSessions"]>[number],
): boolean {
  const lifecyclePhase = effectiveOverlayChildLifecyclePhase(child);
  return lifecyclePhase === "queued" ||
    lifecyclePhase === "running" ||
    lifecyclePhase === "produced_output" ||
    lifecyclePhase === "awaiting_pickup" ||
    lifecyclePhase === "stalled";
}

function isDynamicSpawnOverlayChild(
  child: NonNullable<OraStateSnapshot["childSessions"]>[number],
): boolean {
  if (child.authoritySource === "dynamic_spawn" || child.delegationKind === "dynamic_spawn") {
    return true;
  }
  return !child.authoritySource &&
    !child.delegationKind &&
    child.sessionClass === "temporary_spawn";
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
  const toSeq = deriveOverlayReplayUpperBound(parentSnapshot, child, replayRef);
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
    activeAgents: isOverlayChildActive(child) ? [child.agentId] : [],
    pendingClarifications: [],
    pendingApprovals: [],
    output: fallbackOutputText ? { text: fallbackOutputText } : undefined,
    updatedAt: child.updatedAt,
  };
}

function deriveOverlayReplayUpperBound(
  parentSnapshot: OraStateSnapshot,
  child: NonNullable<OraStateSnapshot["childSessions"]>[number],
  replayRef: NonNullable<NonNullable<OraStateSnapshot["childSessions"]>[number]["replayRef"]>,
): number {
  const persistedToSeq = typeof replayRef.toSeq === "number"
    ? replayRef.toSeq
    : Number.MAX_SAFE_INTEGER;
  if (!isOverlayChildActive(child)) {
    return persistedToSeq;
  }
  const liveToSeq = latestOverlayReplayChildEventSeq(parentSnapshot, child);
  if (liveToSeq === undefined) {
    return persistedToSeq;
  }
  return persistedToSeq === Number.MAX_SAFE_INTEGER
    ? liveToSeq
    : Math.max(persistedToSeq, liveToSeq);
}

function latestOverlayReplayChildEventSeq(
  parentSnapshot: OraStateSnapshot,
  child: NonNullable<OraStateSnapshot["childSessions"]>[number],
): number | undefined {
  let latestSeq: number | undefined;
  for (const event of parentSnapshot.events) {
    if (event.runId !== parentSnapshot.runId) {
      continue;
    }
    if (!isOverlayReplayChildEvent(event, child)) {
      continue;
    }
    latestSeq = event.seq;
  }
  return latestSeq;
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
  return bestAvailableOverlayChildSummaryText([
    child.lastMessage,
    child.summary,
  ]);
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

function deriveOverlayChildCardSummaryText({
  child,
  childTurnView,
}: {
  child: NonNullable<OraStateSnapshot["childSessions"]>[number];
  childTurnView?: ReturnType<typeof derivePresentedAssistantTurnFromSnapshot>;
}): string {
  const liveContent = normalizeOverlayChildSummaryText(childTurnView?.content);
  if (liveContent && isUsefulOverlayChildSummaryText(liveContent)) {
    return liveContent;
  }
  return bestAvailableOverlayChildSummaryText([
    child.lastMessage,
    child.summary,
  ]) ?? "正在等待子代理返回最新进展。";
}

function bestAvailableOverlayChildSummaryText(
  values: Array<string | undefined>,
): string | undefined {
  const normalizedValues = values
    .map((value) => normalizeOverlayChildSummaryText(value))
    .filter((value): value is string => value !== undefined);
  const preferred = normalizedValues.find((value) =>
    isUsefulOverlayChildSummaryText(value)
  );
  return preferred ?? normalizedValues[0];
}

function normalizeOverlayChildSummaryText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const normalized = clipOverlayChildSummaryText(
    text.replace(/\s+/g, " ").trim(),
  );
  if (!normalized || isInternalOverlayChildSummaryText(normalized)) {
    return undefined;
  }
  return normalized;
}

function clipOverlayChildSummaryText(text: string): string {
  if (text.length <= OVERLAY_CHILD_CARD_SUMMARY_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, OVERLAY_CHILD_CARD_SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
}

function isUsefulOverlayChildSummaryText(text: string): boolean {
  if (isGenericOverlayChildSummaryText(text)) {
    return false;
  }
  return text.replace(/[#>*`\-\s]/g, "").length >= 6;
}

function isInternalOverlayChildSummaryText(text: string): boolean {
  return text.startsWith("[tool-error-boundary]") ||
    text.startsWith("[recovery:fallback]");
}

function isGenericOverlayChildSummaryText(text: string): boolean {
  return text === "后台子 Agent 正在执行任务。" ||
    text === "子 Agent 正在执行任务。" ||
    text === "已进入后台协作队列。" ||
    text === "后台子 Agent 已完成。" ||
    text === "子 Agent 已完成。";
}

export function derivePlanStepsPresentation({
  planSteps,
  canUseDesktopOverlayRail,
}: {
  planSteps: TurnPlanListStep[];
  canUseDesktopOverlayRail: boolean;
}) {
  if (planSteps.length === 0) {
    return {
      inlinePlanSteps: [] as TurnPlanListStep[],
      floatingPlanSteps: [] as TurnPlanListStep[],
    };
  }
  return canUseDesktopOverlayRail
    ? {
        inlinePlanSteps: [] as TurnPlanListStep[],
        floatingPlanSteps: planSteps,
      }
    : {
        inlinePlanSteps: planSteps,
        floatingPlanSteps: [] as TurnPlanListStep[],
      };
}

export function canUseDesktopOverlayRail({
  isDesktopViewport,
  contentRowWidth,
}: {
  isDesktopViewport: boolean;
  contentRowWidth: number | null;
}) {
  return isDesktopViewport &&
    typeof contentRowWidth === "number" &&
    contentRowWidth >= CHAT_VIEW_DESKTOP_OVERLAY_MIN_CONTENT_ROW_WIDTH;
}

export function shouldShowDesktopOverlayRail({
  hasCollaborationOverlay,
  hasFloatingPlanSteps,
  canUseDesktopOverlayRail,
}: {
  hasCollaborationOverlay: boolean;
  hasFloatingPlanSteps: boolean;
  canUseDesktopOverlayRail: boolean;
}) {
  return canUseDesktopOverlayRail &&
    (hasCollaborationOverlay || hasFloatingPlanSteps);
}

export function deriveChatSurfaceContentWidthClassName(
  _hasCollaborationOverlay: boolean,
): string {
  return CHAT_VIEW_STABLE_CONTENT_WIDTH_CLASS;
}

export function deriveChatSurfaceShiftClassName(
  _hasDesktopOverlayRail: boolean,
): string {
  return "";
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
  onForkSessionFromTurn,
  onAdoptBranchGroup,
  onOpenArtifact,
  onSubmitFeedback,
  onSubmitAllClarifications,
  onSetRightWorkspaceOpen,
  selectedSessionWorkspace,
  onSelectMode,
  onSelectModeSelection,
}: ChatViewProps) {
  const { state, dispatch } = useWorkbench();
  const [contentRowElement, setContentRowElement] = useState<HTMLDivElement | null>(null);
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
    planDecisionResolutionOverrides: state.planDecisionResolutionOverrides,
  });
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(0);
  const [isDesktopViewport, setIsDesktopViewport] = useState(
    matchesDesktopFloatingOverlayViewport,
  );
  const [contentRowWidth, setContentRowWidth] = useState<number | null>(null);
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

  useEffect(() => {
    if (!contentRowElement) {
      setContentRowWidth(null);
      return;
    }

    const reportWidth = () => {
      const nextWidth = Math.ceil(contentRowElement.getBoundingClientRect().width);
      setContentRowWidth((current) => current === nextWidth ? current : nextWidth);
    };

    reportWidth();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (typeof nextWidth === "number") {
        const normalizedWidth = Math.ceil(nextWidth);
        setContentRowWidth((current) =>
          current === normalizedWidth ? current : normalizedWidth
        );
      }
    });
    observer.observe(contentRowElement);
    return () => observer.disconnect();
  }, [contentRowElement]);

  const gateKind = runInteractionState.gateKind;
  const canShowDesktopOverlayRail = useMemo(
    () => canUseDesktopOverlayRail({
      isDesktopViewport,
      contentRowWidth,
    }),
    [contentRowWidth, isDesktopViewport],
  );
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
      canUseDesktopOverlayRail: canShowDesktopOverlayRail,
    }),
    [canShowDesktopOverlayRail, currentPlanSteps],
  );
  const showDesktopOverlayRail = useMemo(
    () => shouldShowDesktopOverlayRail({
      hasCollaborationOverlay: showCollaborationOverlay,
      hasFloatingPlanSteps: floatingPlanSteps.length > 0,
      canUseDesktopOverlayRail: canShowDesktopOverlayRail,
    }),
    [canShowDesktopOverlayRail, showCollaborationOverlay, floatingPlanSteps],
  );
  const chatSurfaceContentWidthClassName = useMemo(
    () => deriveChatSurfaceContentWidthClassName(showDesktopOverlayRail),
    [showDesktopOverlayRail],
  );
  const chatSurfaceShiftClassName = useMemo(
    () => deriveChatSurfaceShiftClassName(showDesktopOverlayRail),
    [showDesktopOverlayRail],
  );
  const [overlayPlanSectionOpen, setOverlayPlanSectionOpen] = useState(true);
  const [overlayCollaborationSectionOpen, setOverlayCollaborationSectionOpen] = useState(true);
  const [expandedOverlayChildId, setExpandedOverlayChildId] = useState<string | undefined>(
    undefined,
  );
  const floatingPlanIdentity = useMemo(
    () => planStepsIdentity(floatingPlanSteps),
    [floatingPlanSteps],
  );
  const previousFloatingPlanIdentity = useRef("");
  const previousFloatingPlanAllCompleted = useRef(false);

  useEffect(() => {
    if (floatingPlanSteps.length === 0) {
      previousFloatingPlanIdentity.current = "";
      previousFloatingPlanAllCompleted.current = false;
      return;
    }

    const nextAllCompleted = floatingPlanSteps.length > 0 &&
      floatingPlanSteps.every((step) => step.status === "completed");
    const nextOpen = nextPlanTrayOpenState({
      currentOpen: overlayPlanSectionOpen,
      planSteps: floatingPlanSteps,
      previousPlanIdentity: previousFloatingPlanIdentity.current,
      nextPlanIdentity: floatingPlanIdentity,
      previousAllCompleted: previousFloatingPlanAllCompleted.current,
    });

    previousFloatingPlanIdentity.current = floatingPlanIdentity;
    previousFloatingPlanAllCompleted.current = nextAllCompleted;

    if (nextOpen !== overlayPlanSectionOpen) {
      setOverlayPlanSectionOpen(nextOpen);
    }
  }, [floatingPlanIdentity, floatingPlanSteps, overlayPlanSectionOpen]);
  const branchGroups = state.activeSessionDetail?.branchGroups ?? [];

  const openLocalFiles = useCallback(async () => {
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
  }, [dispatch, selectedSession.id]);

  const handleFilesDropped = useCallback(async (fileList: FileList) => {
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
  }, [dispatch, selectedSession.id]);

  const handleImagePasted = useCallback((image: ComposerImageAttachment) => {
    dispatch({
      type: "ADD_IMAGE_ATTACHMENT",
      sessionId: selectedSession.id,
      image,
    });
  }, [dispatch, selectedSession.id]);

  const handleProviderChange = useCallback((providerId: string) => {
    dispatch({ type: "SET_PROVIDER", providerId });
  }, [dispatch]);

  const handleSelectedSkillIdsChange = useCallback((skillIds: string[]) => {
    dispatch({ type: "SET_SELECTED_SKILL_IDS", skillIds });
  }, [dispatch]);

  const handleRemoveProjectFileAttachment = useCallback((path: string) => {
    dispatch({
      type: "REMOVE_PROJECT_FILE_ATTACHMENT",
      sessionId: selectedSession.id,
      path,
    });
  }, [dispatch, selectedSession.id]);

  const handleRemoveLocalFileAttachment = useCallback((path: string) => {
    dispatch({
      type: "REMOVE_LOCAL_FILE_ATTACHMENT",
      sessionId: selectedSession.id,
      path,
    });
  }, [dispatch, selectedSession.id]);

  const handleRemoveImageAttachment = useCallback((name: string) => {
    dispatch({
      type: "REMOVE_IMAGE_ATTACHMENT",
      sessionId: selectedSession.id,
      name,
    });
  }, [dispatch, selectedSession.id]);

  const handlePermissionModeChange = useCallback((mode: typeof state.permissionMode) => {
    dispatch({ type: "SET_PERMISSION_MODE", permissionMode: mode });
  }, [dispatch]);

  const handleTaskIntentChange = useCallback((taskIntent: typeof state.taskIntent) => {
    dispatch({ type: "SET_TASK_INTENT", taskIntent });
  }, [dispatch]);

  const handleDeclinePlanDecision = useCallback(() => {
    return onResolvePlanDecision("declined");
  }, [onResolvePlanDecision]);

  const handleOpenLocalFiles = useCallback(() => {
    void openLocalFiles();
  }, [openLocalFiles]);

  return (
    <div className={CHAT_VIEW_ROOT_CLASS}>
      <ChatHeader
        busyCommand={busyCommand}
        selectedSession={selectedSession}
        selectedWorkspace={selectedSessionWorkspace}
        onSetRightWorkspaceOpen={onSetRightWorkspaceOpen}
        language={state.language}
      />
      <main className={CHAT_VIEW_MAIN_CLASS}>
        <div
          ref={setContentRowElement}
          className={CHAT_VIEW_CONTENT_ROW_CLASS}
        >
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
                    data-testid="chat-welcome-viewport"
                    className={cn(
                      "w-full",
                      CHAT_VIEW_WELCOME_VIEWPORT_CLASS,
                    )}
                  >
                    <div
                      data-testid="chat-welcome-surface-frame"
                      className={cn(
                        "mx-auto flex w-full flex-col items-center gap-2 text-center",
                        chatSurfaceContentWidthClassName,
                      )}
                    >
                      <div className="flex items-center gap-2 text-2xl font-bold">
                        <span>{getWelcomeGreeting(new Date(), state.language, projectLabel)}</span>
                      </div>
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
                surfaceFrameWidthClassName={chatSurfaceContentWidthClassName}
                projectRootPath={projectRootPath}
                onOpenArtifact={onOpenArtifact}
                onSubmitFeedback={onSubmitFeedback}
                onForkSessionFromTurn={onForkSessionFromTurn}
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
                language={state.language}
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
                onProviderChange={handleProviderChange}
                onPromptChange={onComposerPromptChange}
                onSelectedSkillIdsChange={handleSelectedSkillIdsChange}
                onRemoveProjectFileAttachment={handleRemoveProjectFileAttachment}
                onRemoveLocalFileAttachment={handleRemoveLocalFileAttachment}
                imageAttachments={imageAttachments}
                onRemoveImageAttachment={handleRemoveImageAttachment}
                onAddImageAttachment={handleImagePasted}
                permissionMode={state.permissionMode}
                onPermissionModeChange={handlePermissionModeChange}
                taskIntent={state.taskIntent}
                onTaskIntentChange={handleTaskIntentChange}
                planDecisionPending={planDecisionPending}
                planSteps={inlinePlanSteps}
                onConfirmPlanDecision={onAcceptPlanDecisionAndStartImplementation}
                onDeclinePlanDecision={handleDeclinePlanDecision}
                onOverlayHeightChange={handleOverlayHeightChange}
                surfaceFrameWidthClassName={chatSurfaceContentWidthClassName}
                onOpenLocalFiles={handleOpenLocalFiles}
                onFilesDropped={handleFilesDropped}
                onClearSelectedCustomAgent={onClearSelectedCustomAgent}
                onStartRun={onStartRun}
                onStopRun={onCancelRun}
              />
            </div>
          </div>
          {showDesktopOverlayRail ? (
            <DesktopOverlayRail
              childSessions={visibleCollaborationChildren}
              planSteps={floatingPlanSteps}
              planSectionOpen={overlayPlanSectionOpen}
              collaborationSectionOpen={overlayCollaborationSectionOpen}
              expandedChildId={expandedOverlayChildId}
              onTogglePlanSection={() => setOverlayPlanSectionOpen((current) => !current)}
              onToggleCollaborationSection={() => setOverlayCollaborationSectionOpen((current) => !current)}
              onToggleChild={(childId) => setExpandedOverlayChildId((current) =>
                toggleExpandedOverlayChildId(current, childId)
              )}
              turnSnapshots={turnSnapshots}
              projectRootPath={projectRootPath}
              onOpenArtifact={onOpenArtifact}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

export function DesktopOverlayRail({
  childSessions,
  planSteps,
  planSectionOpen,
  collaborationSectionOpen,
  expandedChildId,
  onTogglePlanSection,
  onToggleCollaborationSection,
  onToggleChild,
  turnSnapshots,
  projectRootPath,
  onOpenArtifact,
}: {
  childSessions: NonNullable<OraStateSnapshot["childSessions"]>;
  planSteps: TurnPlanListStep[];
  planSectionOpen: boolean;
  collaborationSectionOpen: boolean;
  expandedChildId?: string;
  onTogglePlanSection: () => void;
  onToggleCollaborationSection: () => void;
  onToggleChild: (childId: string) => void;
  turnSnapshots: Record<string, OraStateSnapshot | undefined>;
  projectRootPath?: string;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  if (childSessions.length === 0 && planSteps.length === 0) {
    return null;
  }

  return (
    <div className={CHAT_VIEW_DESKTOP_OVERLAY_RAIL_CLASS}>
      <div className={CHAT_VIEW_DESKTOP_FLOATING_STACK_CLASS}>
        <section className={CHAT_VIEW_OVERLAY_PANEL_CLASS}>
          {planSteps.length > 0 ? (
            <OverlayRailSection
              title="进度"
              summary={planSummary(planSteps)}
              open={planSectionOpen}
              onToggle={onTogglePlanSection}
            >
              {planSectionOpen ? <PlanStepsList planSteps={planSteps} /> : null}
            </OverlayRailSection>
          ) : null}
          {childSessions.length > 0 ? (
            <OverlayRailSection
              title="协作"
              summary={`${childSessions.length} 个任务仍在协作流程中`}
              open={collaborationSectionOpen}
              onToggle={onToggleCollaborationSection}
              sectionClassName={planSteps.length > 0 ? undefined : "pt-0"}
            >
              {collaborationSectionOpen ? (
                <section className={CHAT_VIEW_COLLABORATION_PANEL_CLASS}>
                  <div className="space-y-1.5">
                    {childSessions.map((child) => {
                      const expanded = expandedChildId === child.id;
                      const childSnapshot = resolveOverlayChildSnapshot(child, turnSnapshots);
                      const childTurnView = childSnapshot
                        ? derivePresentedAssistantTurnFromSnapshot(childSnapshot)
                        : undefined;
                      const childSummaryText = deriveOverlayChildCardSummaryText({
                        child,
                        childTurnView,
                      });
                      const childStatusText = deriveOverlayChildStatusLabel({
                        child,
                        childTurnView,
                      });

                      return (
                        <section
                          key={child.id}
                          className={CHAT_VIEW_COLLABORATION_ITEM_CLASS}
                        >
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => onToggleChild(child.id)}
                            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 text-left"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {child.label}
                              </p>
                              <p className="mt-0.5 overflow-hidden text-xs leading-5 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] break-words">
                                {childSummaryText}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 self-start pl-1">
                              <span
                                className={collaborationStatusBadgeClassName(
                                  child.status,
                                  child.lifecyclePhase,
                                  child.deliveryStatus,
                                )}
                              >
                                {childStatusText}
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
                            <div className={CHAT_VIEW_COLLABORATION_DETAIL_CLASS}>
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
            </OverlayRailSection>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function OverlayRailSection({
  title,
  summary,
  open,
  onToggle,
  children,
  sectionClassName,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  sectionClassName?: string;
}) {
  return (
    <section className={cn(CHAT_VIEW_OVERLAY_SECTION_CLASS, sectionClassName)}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(CHAT_VIEW_OVERLAY_SECTION_HEADER_CLASS, "w-full text-left")}
      >
        <div className="min-w-0">
          <p className={CHAT_VIEW_OVERLAY_SECTION_TITLE_CLASS}>{title}</p>
          <p className={CHAT_VIEW_OVERLAY_SECTION_SUMMARY_CLASS}>{summary}</p>
        </div>
        <ChevronDown
          size={14}
          className={cn(PLAN_STEPS_TRAY_HEADER_CHEVRON_CLASS, open && "rotate-180")}
        />
      </button>
      {children}
    </section>
  );
}

function effectiveOverlayChildLifecyclePhase(
  child: NonNullable<OraStateSnapshot["childSessions"]>[number],
) {
  if (child.lifecyclePhase) {
    return child.lifecyclePhase;
  }
  if (child.deliveryStatus === "awaiting_pickup") {
    return "awaiting_pickup" as const;
  }
  return child.status;
}

export function deriveOverlayChildStatusLabel({
  child,
  childTurnView,
}: {
  child: NonNullable<OraStateSnapshot["childSessions"]>[number];
  childTurnView?: ReturnType<typeof derivePresentedAssistantTurnFromSnapshot>;
}): string {
  const lifecyclePhase = effectiveOverlayChildLifecyclePhase(child);
  switch (lifecyclePhase) {
    case "queued":
      return "排队中";
    case "produced_output":
      return "完善中";
    case "running":
      return child.lifecyclePhase
        ? "执行中"
        : overlayChildHasMeaningfulVisibleContent({ child, childTurnView })
          ? "完善中"
          : "执行中";
    case "awaiting_pickup":
      return "待整合";
    case "picked_up":
      return "已接收";
    case "stalled":
      return "卡住";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return child.status;
  }
}

function overlayChildHasMeaningfulVisibleContent({
  child,
  childTurnView,
}: {
  child: NonNullable<OraStateSnapshot["childSessions"]>[number];
  childTurnView?: ReturnType<typeof derivePresentedAssistantTurnFromSnapshot>;
}): boolean {
  const liveContent = normalizeOverlayChildSummaryText(childTurnView?.content);
  if (liveContent && isUsefulOverlayChildSummaryText(liveContent)) {
    return true;
  }
  return [child.lastMessage, child.summary]
    .map((value) => normalizeOverlayChildSummaryText(value))
    .some((value) => value !== undefined && isUsefulOverlayChildSummaryText(value));
}

export function collaborationStatusBadgeClassName(
  status: NonNullable<OraStateSnapshot["childSessions"]>[number]["status"],
  lifecyclePhase?: NonNullable<OraStateSnapshot["childSessions"]>[number]["lifecyclePhase"],
  deliveryStatus?: NonNullable<OraStateSnapshot["childSessions"]>[number]["deliveryStatus"],
) {
  const effectivePhase = lifecyclePhase ?? (
    deliveryStatus === "awaiting_pickup" ? "awaiting_pickup" : status
  );
  if (effectivePhase === "awaiting_pickup") {
    return cn(
      FLOATING_OVERLAY_BADGE_BASE_CLASS,
      "border-emerald-300/55 bg-emerald-50/70 text-emerald-700",
    );
  }
  switch (effectivePhase) {
    case "produced_output":
    case "running":
      return cn(
        FLOATING_OVERLAY_BADGE_BASE_CLASS,
        "bg-accent/80 text-foreground",
      );
    case "queued":
      return cn(
        FLOATING_OVERLAY_BADGE_BASE_CLASS,
        "bg-muted/65 text-muted-foreground",
      );
    case "failed":
    case "stalled":
      return cn(
        FLOATING_OVERLAY_BADGE_BASE_CLASS,
        "border-destructive/25 bg-destructive/10 text-destructive",
      );
    default:
      return cn(
        FLOATING_OVERLAY_BADGE_BASE_CLASS,
        "bg-muted/65 text-foreground",
      );
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
