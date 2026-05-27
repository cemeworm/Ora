import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "./components/ui/button";
import { AppShell } from "./components/AppShell";
import { ChatView } from "./components/ChatView";
import { ChatMessages } from "./components/ChatMessages";
import { ProviderOnboardingStep } from "./components/onboarding/ProviderOnboardingStep";
import { RightWorkspacePane } from "./components/RightWorkspacePane";
import { SettingsView } from "./components/SettingsView";
import { SpaceFrame } from "./components/SpaceFrame";
import { useRunActions } from "./lib/useRunActions";
import {
  deriveRunInteractionState,
  type DesktopRunInteractionState,
} from "./lib/runInteractionState";
import {
  readOnboardingStatus,
  writeOnboardingStatus,
  type OnboardingStatus,
} from "./lib/onboarding";
import {
  DEFAULT_RIGHT_WORKSPACE_WIDTH,
  beginSessionHistorySnapshotLoad,
  beginSessionHistorySnapshotLoadRegistryLease,
  deriveSessionHistorySnapshotLoadKey,
  deriveSessionHistorySnapshotLoadPlan,
  deriveSessionHistorySnapshotLoadTarget,
  deriveRenderableTurnSnapshots,
  evictSessionTurnSnapshotCache,
  getActiveSnapshot,
  getPendingRunState,
  getRightWorkspaceSessionState,
  markSessionHistorySnapshotLoaded,
  mergeSessionHistorySnapshotBatch,
  mergeRunStreamSnapshot,
  mergeStateSnapshot,
  pruneTurnSnapshotsForActiveSession,
  releaseSessionHistorySnapshotLoadTarget,
  releaseSessionHistorySnapshotLoadRegistryLease,
  releaseSessionHistorySnapshotLoadRegistryTarget,
  sameSessionHistorySnapshotLoadTarget,
  sessionTurnSnapshotsForSession,
  type SessionHistorySnapshotLoadRegistry,
  type SessionHistorySnapshotLoadTarget,
  updateSessionTurnSnapshotCache,
  useWorkbench,
  WorkbenchProvider,
  type RightWorkspaceReplayChildRef,
} from "./lib/state";
import { clampRightWorkspaceWidth, getRightWorkspaceMaxWidth } from "./lib/rightWorkspaceLayout";
import type { AppView, ChatMessage, ActionRecord, CheckpointRecord, PlanItem, SessionRun, TopologyNode, TopologyEdge, AgentProfile, ArtifactRecord } from "./types";
import { cn } from "./lib/utils";
import { getRecords, clearRecords, timeStart, timeEnd, recordTiming } from "./lib/debugTiming";
import {
  adaptChatMessages,
  adaptRenderableChatMessages,
} from "./lib/viewModel";
import { buildChatMessagesCacheKey } from "./lib/chatMessageCache";
import type { ChatMessages as ChatMessagesType } from "./components/ChatMessages";
import type {
  RuntimeClient,
  OraProjectFileEntry,
  OraProjectFileReadResult,
  OraRunEventStream,
  OraStateSnapshot,
} from "./lib/runtimeClient";
import {
  translateCopy,
  useDocumentTranslations,
  type AppLanguage,
} from "./lib/i18n";

const AgentsView = lazy(() =>
  import("./components/AgentsView").then((module) => ({
    default: module.AgentsView,
  })),
);
const AutomationsView = lazy(() =>
  import("./components/AutomationsView").then((module) => ({
    default: module.AutomationsView,
  })),
);
const EvaluationView = lazy(() =>
  import("./components/EvaluationView").then((module) => ({
    default: module.EvaluationView,
  })),
);
const ModesView = lazy(() =>
  import("./components/ModesView").then((module) => ({
    default: module.ModesView,
  })),
);
const SpaceDashboardView = lazy(() =>
  import("./components/SpaceDashboardView").then((module) => ({
    default: module.SpaceDashboardView,
  })),
);
const SpaceLibraryView = lazy(() =>
  import("./components/SpaceLibraryView").then((module) => ({
    default: module.SpaceLibraryView,
  })),
);
const SkillsView = lazy(() =>
  import("./components/SkillsView").then((module) => ({
    default: module.SkillsView,
  })),
);

const MIN_DETAIL_PANEL_WIDTH = 360;
const WINDOW_TITLE_BASE = "Ora";
const MAX_TURN_SNAPSHOT_SESSIONS = 8;
const MAX_TURN_SNAPSHOTS_PER_SESSION = 40;
const HISTORY_SNAPSHOT_LOAD_CONCURRENCY = 4;

import {
  coalesceLiveDeltaStreams,
  isLiveDeltaOnlyStream,
  type BatchedStream,
} from "./lib/streamCoalesce";

function hasVerifiedRealProvider(
  providers: readonly { id: string; type: string }[] | undefined,
  statuses: readonly { providerId: string; state: string }[],
) {
  if (!providers) {
    return false;
  }
  const verifiedProviderIds = new Set(
    statuses
      .filter((status) => status.state === "verified")
      .map((status) => status.providerId),
  );
  return providers.some(
    (provider) =>
      verifiedProviderIds.has(provider.id),
  );
}

function windowTitleForView(
  activeView: AppView,
  settingsOpen: boolean,
  language: AppLanguage,
) {
  const base = translateCopy(language, WINDOW_TITLE_BASE);
  if (settingsOpen) return `${base} · ${translateCopy(language, "Settings")}`;

  switch (activeView) {
    case "agents":
      return `${base} · ${translateCopy(language, "Agents")}`;
    case "automations":
      return `${base} · ${translateCopy(language, "Automations")}`;
    case "skills":
      return `${base} · ${translateCopy(language, "Skills")}`;
    case "modes":
      return `${base} · ${translateCopy(language, "Modes")}`;
    case "evaluation":
      return `${base} · ${translateCopy(language, "Evaluation")}`;
    case "space-dashboard":
      return `${base} · ${translateCopy(language, "工作台")}`;
    case "space-library":
      return `${base} · ${translateCopy(language, "组件库")}`;
    case "chat":
    default:
      return `${base} · ${translateCopy(language, "Chat")}`;
  }
}

function WorkspacePane({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      className={cn(
        "relative flex h-full min-h-0 overflow-hidden rounded-[24px] border border-black/[0.025] bg-sidebar shadow-[0_1px_1px_rgba(23,23,23,0.04),0_8px_18px_rgba(23,23,23,0.024)]",
        className,
      )}
      style={style}
    >
      {children}
    </section>
  );
}

function LoadingPane() {
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <LoaderCircle size={24} className="animate-spin text-muted-foreground" />
    </div>
  );
}

function childSessionWorkspacePageTitle(title?: string): string {
  const trimmed = title?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "子会话";
}

class WorkbenchErrorBoundary extends Component<
  { children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Ora workbench render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <AppShell>
        <WorkspacePane className="w-full">
          <div className="flex h-full w-full items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-pane">
              <p className="text-sm font-semibold text-foreground">
                Ora hit a render error.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted/60 active:scale-95"
              >
                Reload workbench
              </button>
            </div>
          </div>
        </WorkspacePane>
      </AppShell>
    );
  }
}

function WorkbenchInner() {
  const { state, dispatch } = useWorkbench();
  const { runtimeClient, viewModel, selectedSession, actions } = useRunActions();
  const [onboardingStatus, setOnboardingStatus] = useState<
    OnboardingStatus | undefined
  >(() => readOnboardingStatus());
  const [onboardingRequired, setOnboardingRequired] = useState<
    boolean | undefined
  >();
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const resizePointerIdRef = useRef<number | null>(null);
  const closeWorkspaceTimerRef = useRef<number | undefined>(undefined);
  const openWorkspaceFrameRef = useRef<number | undefined>(undefined);
  const providerSecretRefreshKeyRef = useRef<string>("");
  const projectsRef = useRef(state.projects);
  const activeSessionIdRef = useRef<string | undefined>(
    state.activeSessionDetail?.session.sessionId,
  );

  useEffect(() => {
    projectsRef.current = state.projects;
  }, [state.projects]);

  useEffect(() => {
    activeSessionIdRef.current = state.activeSessionDetail?.session.sessionId;
  }, [state.activeSessionDetail?.session.sessionId]);

  const streamBatchRef = useRef<BatchedStream[]>([]);
  const streamFlushRafRef = useRef<number | undefined>(undefined);

  const flushStreamBatch = useCallback(() => {
    streamFlushRafRef.current = undefined;
    const entries = streamBatchRef.current;
    if (entries.length === 0) return;
    streamBatchRef.current = [];

    const coalesced = coalesceLiveDeltaStreams(entries);
    const deltaOnlyCount = entries.filter((e) => isLiveDeltaOnlyStream(e.stream)).length;
    const mergedDeltaCount = coalesced.filter((e) => isLiveDeltaOnlyStream(e.stream)).length;
    if (deltaOnlyCount > 0) {
      timeStart("raf-batch");
      recordTiming("raf-batch-entries", entries.length);
      recordTiming("raf-delta-before", deltaOnlyCount);
      recordTiming("raf-delta-after", mergedDeltaCount);
      const firstEntry = entries[0];
      const lastEntry = entries.at(-1);
      if (firstEntry && lastEntry) {
        const firstSeq = firstEntry.stream.events[0]?.seq;
        const lastSeq = lastEntry.stream.events.at(-1)?.seq;
        if (firstSeq !== undefined && lastSeq !== undefined) {
          recordTiming("raf-seq-span", lastSeq - firstSeq);
        }
      }
    }

    const flushedAt = Date.now();
    for (const { stream, receivedAt } of coalesced) {
      dispatch({ type: "APPLY_RUN_STREAM", stream, receivedAt, flushedAt });
    }

    if (deltaOnlyCount > 0) {
      timeEnd("raf-batch");
    }

    setTurnSnapshotsBySession((current) => {
      let next = current;
      for (const { stream } of coalesced) {
        if (isLiveDeltaOnlyStream(stream)) continue;
        const sessionId =
          stream.snapshot?.sessionId ??
          stream.sessionId ??
          activeSessionIdRef.current;
        if (!sessionId) continue;
        const existing = sessionTurnSnapshotsForSession(next, sessionId)[stream.runId];
        const merged = mergeRunStreamSnapshot(existing, stream);
        if (!merged) continue;
        if (
          existing &&
          existing.updatedAt === merged.updatedAt &&
          existing.events.length === merged.events.length
        ) {
          continue;
        }
        next = updateSessionTurnSnapshotCache({
          cache: next,
          sessionId,
          snapshots: { [stream.runId]: merged },
          maxSnapshots: MAX_TURN_SNAPSHOTS_PER_SESSION,
          now: flushedAt,
        });
      }
      return evictSessionTurnSnapshotCache({
        cache: next,
        activeSessionId: activeSessionIdRef.current,
        maxSessions: MAX_TURN_SNAPSHOT_SESSIONS,
      });
    });
  }, [dispatch]);

  const [turnSnapshotsBySession, setTurnSnapshotsBySession] = useState<
    Record<
      string,
      {
        snapshots: Record<string, OraStateSnapshot>;
        lastAccessedAt: number;
        loadedRevisionKey?: string;
      }
    >
  >({});
  useDocumentTranslations(state.language);

  function completeOnboarding(status: OnboardingStatus) {
    writeOnboardingStatus(status);
    setOnboardingStatus(status);
  }

  useEffect(() => {
    if (onboardingStatus || onboardingRequired !== undefined) {
      return;
    }
    if (!state.providerRegistry) {
      return;
    }
    setOnboardingRequired(
      !hasVerifiedRealProvider(
        state.providerRegistry.providers,
        state.providerStatuses,
      ),
    );
  }, [
    onboardingRequired,
    onboardingStatus,
    state.providerRegistry,
    state.providerStatuses,
  ]);

  const selectedSessionWorkspace = getRightWorkspaceSessionState(
    state,
    state.selectedSessionId,
  );
  const [visibleWorkspaceSessionId, setVisibleWorkspaceSessionId] = useState<string | undefined>(
    state.selectedSessionId,
  );
  const [workspaceClosingSessionId, setWorkspaceClosingSessionId] = useState<string | undefined>(undefined);
  const [workspaceAnimatedOpen, setWorkspaceAnimatedOpen] = useState(false);
  const [isResizingRightWorkspace, setIsResizingRightWorkspace] = useState(false);
  const [splitContainerWidth, setSplitContainerWidth] = useState<number | null>(null);
  const selectedWorkspaceWidth = clampRightWorkspaceWidth(
    selectedSessionWorkspace.width || DEFAULT_RIGHT_WORKSPACE_WIDTH,
    splitContainerWidth,
  );
  const isCurrentWorkspaceVisible =
    selectedSessionWorkspace.open ||
    (Boolean(state.selectedSessionId) &&
      visibleWorkspaceSessionId === state.selectedSessionId);

  useEffect(() => {
    const sessionId = state.selectedSessionId;
    if (!sessionId) {
      setVisibleWorkspaceSessionId(undefined);
      setWorkspaceClosingSessionId(undefined);
      if (closeWorkspaceTimerRef.current !== undefined) {
        window.clearTimeout(closeWorkspaceTimerRef.current);
        closeWorkspaceTimerRef.current = undefined;
      }
      return;
    }

    if (selectedSessionWorkspace.open) {
      if (closeWorkspaceTimerRef.current !== undefined) {
        window.clearTimeout(closeWorkspaceTimerRef.current);
        closeWorkspaceTimerRef.current = undefined;
      }
      if (openWorkspaceFrameRef.current !== undefined) {
        window.cancelAnimationFrame(openWorkspaceFrameRef.current);
        openWorkspaceFrameRef.current = undefined;
      }
      setWorkspaceClosingSessionId(undefined);
      if (visibleWorkspaceSessionId !== sessionId) {
        setVisibleWorkspaceSessionId(sessionId);
        setWorkspaceAnimatedOpen(false);
        openWorkspaceFrameRef.current = window.requestAnimationFrame(() => {
          setWorkspaceAnimatedOpen(true);
          openWorkspaceFrameRef.current = undefined;
        });
      } else {
        setWorkspaceAnimatedOpen(true);
      }
      return;
    }

    if (visibleWorkspaceSessionId !== sessionId) {
      return;
    }

    if (openWorkspaceFrameRef.current !== undefined) {
      window.cancelAnimationFrame(openWorkspaceFrameRef.current);
      openWorkspaceFrameRef.current = undefined;
    }
    setWorkspaceAnimatedOpen(false);
    setWorkspaceClosingSessionId(sessionId);
    if (closeWorkspaceTimerRef.current !== undefined) {
      window.clearTimeout(closeWorkspaceTimerRef.current);
    }
    closeWorkspaceTimerRef.current = window.setTimeout(() => {
      setVisibleWorkspaceSessionId((current) => (current === sessionId ? undefined : current));
      setWorkspaceClosingSessionId((current) => (current === sessionId ? undefined : current));
      setWorkspaceAnimatedOpen(false);
      closeWorkspaceTimerRef.current = undefined;
    }, 220);
  }, [selectedSessionWorkspace.open, state.selectedSessionId, visibleWorkspaceSessionId]);

  useEffect(() => {
    if (!splitContainerRef.current) {
      setSplitContainerWidth(null);
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.ceil(splitContainerRef.current?.getBoundingClientRect().width ?? 0);
      setSplitContainerWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(splitContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleRightWorkspaceResize = useCallback((clientX: number) => {
    const container = splitContainerRef.current;
    const sessionId = state.selectedSessionId;
    if (!container || !sessionId) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const nextWidth = rect.right - clientX;
    const clampedWidth = clampRightWorkspaceWidth(nextWidth, rect.width);
    dispatch({
      type: "SET_RIGHT_WORKSPACE_WIDTH",
      sessionId,
      width: clampedWidth,
    });
  }, [dispatch, state.selectedSessionId]);

  const handleResizePointerMove = useCallback((event: PointerEvent) => {
    if (resizePointerIdRef.current !== event.pointerId) {
      return;
    }
    handleRightWorkspaceResize(event.clientX);
  }, [handleRightWorkspaceResize]);

  const handleResizePointerUp = useCallback((event: PointerEvent) => {
    if (resizePointerIdRef.current !== event.pointerId) {
      return;
    }
    resizePointerIdRef.current = null;
    setIsResizingRightWorkspace(false);
    window.removeEventListener("pointermove", handleResizePointerMove);
    window.removeEventListener("pointerup", handleResizePointerUp);
  }, [handleResizePointerMove]);

  useEffect(() => {
    return () => {
      if (closeWorkspaceTimerRef.current !== undefined) {
        window.clearTimeout(closeWorkspaceTimerRef.current);
      }
      if (openWorkspaceFrameRef.current !== undefined) {
        window.cancelAnimationFrame(openWorkspaceFrameRef.current);
      }
      window.removeEventListener("pointermove", handleResizePointerMove);
      window.removeEventListener("pointerup", handleResizePointerUp);
    };
  }, [handleResizePointerMove, handleResizePointerUp]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const workbenchBootstrap = await runtimeClient.workbenchBootstrap();
        if (cancelled) return;
        const { bootstrap, projects, sessions, activeSessionDetail } =
          workbenchBootstrap;
        dispatch({
          type: "BOOTSTRAP",
          patterns: bootstrap.patterns,
          modes: bootstrap.modes,
          projects,
          providerRegistry: bootstrap.providerRegistry,
          toolRegistry: bootstrap.toolRegistry,
          packageStore: bootstrap.packageStore,
          skillRegistry: bootstrap.skillRegistry,
          providerSecretStatuses: bootstrap.providerSecretStatuses,
          providerStatuses: bootstrap.providerStatuses,
          health: bootstrap.health,
        });
        dispatch({
          type: "HYDRATE_SESSION",
          projects,
          sessions,
          detail: activeSessionDetail,
        });
      } catch (error) {
        if (cancelled) return;
        dispatch({
          type: "SET_BRIDGE_STATUS",
          status: {
            mode: "error",
            ok: false,
            label: "Runtime error",
            detail:
              error instanceof Error
                ? error.message
                : "Runtime bridge failed to initialize.",
          },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtimeClient, dispatch]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const providerRegistry = state.providerRegistry;
        if (!providerRegistry?.providers?.length) {
          return;
        }
        const refreshKey = [
          providerRegistry.defaultProviderId,
          ...providerRegistry.providers.map(
            (provider) => `${provider.id}:${provider.enabled !== false ? "1" : "0"}`,
          ),
        ].join("|");
        if (providerSecretRefreshKeyRef.current === refreshKey) {
          return;
        }
        providerSecretRefreshKeyRef.current = refreshKey;
        const secretStatuses = await runtimeClient.refreshProviderSecretStatuses(providerRegistry.providers);
        if (cancelled) return;
        dispatch({
          type: "SET_PROVIDER_SECRET_STATUSES",
          statuses: secretStatuses,
        });
        dispatch({
          type: "SET_PROVIDER_STATUSES",
          statuses: runtimeClient.refreshProviderStatuses(
            providerRegistry.providers,
            secretStatuses,
            state.providerStatuses,
          ),
        });
      } catch {
        // Keep booting even if Keychain lookup is slow or unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtimeClient, dispatch, state.providerRegistry]);

  useEffect(() => {
    const title = windowTitleForView(
      state.activeView,
      state.settingsOpen,
      state.language,
    );
    document.title = title;

    void import("@tauri-apps/api/webviewWindow")
      .then(({ getCurrentWebviewWindow }) =>
        getCurrentWebviewWindow().setTitle(title),
      )
      .catch(() => {});
  }, [state.activeView, state.settingsOpen, state.language]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void runtimeClient
      .subscribeRunEvents((stream) => {
        if (cancelled) return;
        const receivedAt = Date.now();
        const streamSessionId = stream.snapshot?.sessionId ?? stream.sessionId;
        const isActive =
          !streamSessionId ||
          !activeSessionIdRef.current ||
          streamSessionId === activeSessionIdRef.current;

        if (isActive) {
          streamBatchRef.current.push({ stream, receivedAt });
          if (streamFlushRafRef.current === undefined) {
            streamFlushRafRef.current = requestAnimationFrame(() => {
              flushStreamBatch();
            });
          }
        } else {
          dispatch({ type: "APPLY_RUN_STREAM", stream, receivedAt, flushedAt: receivedAt });
        }
      })
      .then((nextUnsubscribe) => {
        if (cancelled) {
          nextUnsubscribe();
          return;
        }
        unsubscribe = nextUnsubscribe;
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
      if (streamFlushRafRef.current !== undefined) {
        cancelAnimationFrame(streamFlushRafRef.current);
        streamFlushRafRef.current = undefined;
      }
      streamBatchRef.current = [];
    };
  }, [runtimeClient, dispatch, flushStreamBatch]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void runtimeClient
      .subscribeChannelSessionUpdates(async (event) => {
        try {
          const sessions = await runtimeClient.listSessions({
            priority: "background",
            tag: "channel-sync:list-sessions",
          });
          if (cancelled) return;
          dispatch({
            type: "SET_COLLECTIONS",
            projects: projectsRef.current,
            sessions,
          });

          if (!event.sessionId) return;
          // Avoid hydrating a session we don't know about — the runtime
          // fast-fails on missing ids, but skipping early avoids the RPC.
          const knownIds = new Set(sessions.map((s) => s.sessionId));
          if (!knownIds.has(event.sessionId)) return;
          const detail = await runtimeClient.getSession(
            event.sessionId,
            {},
            {
              priority: "background",
              tag: "channel-sync:get-session",
            },
          );
          if (cancelled) return;
          dispatch({
            type: "HYDRATE_SESSION",
            projects: projectsRef.current,
            sessions,
            detail,
            preserveSelection: true,
          });
        } catch {
          // Channel updates are best-effort UI sync; the next bootstrap/manual refresh will catch up.
        }
      })
      .then((nextUnsubscribe) => {
        if (cancelled) {
          nextUnsubscribe();
          return;
        }
        unsubscribe = nextUnsubscribe;
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [runtimeClient, dispatch]);

  useEffect(() => {
    const snapshot = getActiveSnapshot(state.runLifecycle);
    const sessionId = snapshot?.sessionId ?? state.selectedSessionId;
    if (!snapshot || !sessionId) return;

    setTurnSnapshotsBySession((current) => {
      const existing = sessionTurnSnapshotsForSession(current, sessionId)[snapshot.runId];
      const merged = mergeStateSnapshot(existing, snapshot);
      if (!merged) {
        return current;
      }
      if (
        existing &&
        existing.updatedAt === merged.updatedAt &&
        existing.events.length === merged.events.length &&
        existing.agentMessages.length === merged.agentMessages.length
      ) {
        return current;
      }
        return evictSessionTurnSnapshotCache({
          cache: updateSessionTurnSnapshotCache({
            cache: current,
            sessionId,
            snapshots: { [snapshot.runId]: merged },
            maxSnapshots: MAX_TURN_SNAPSHOTS_PER_SESSION,
            now: Date.now(),
          }),
        activeSessionId: state.activeSessionDetail?.session.sessionId ?? state.selectedSessionId,
        maxSessions: MAX_TURN_SNAPSHOT_SESSIONS,
      });
    });
  }, [
    getActiveSnapshot(state.runLifecycle),
    state.activeSessionDetail?.session.sessionId,
    state.selectedSessionId,
  ]);

  useEffect(() => {
    const sessionId = state.activeSessionDetail?.session.sessionId;
    if (!sessionId) {
      return;
    }
    setTurnSnapshotsBySession((current) => {
      const existing = sessionTurnSnapshotsForSession(current, sessionId);
      const pruned = pruneTurnSnapshotsForActiveSession(existing, state.activeSessionDetail);
      if (pruned === existing) {
        return current;
      }
      return updateSessionTurnSnapshotCache({
        cache: current,
        sessionId,
        snapshots: pruned,
        replaceSnapshots: true,
        maxSnapshots: MAX_TURN_SNAPSHOTS_PER_SESSION,
        now: Date.now(),
      });
    });
  }, [state.activeSessionDetail]);

  useEffect(() => {
    if (!state.selectedSessionId) {
      return;
    }
    setTurnSnapshotsBySession((current) =>
      evictSessionTurnSnapshotCache({
        cache: updateSessionTurnSnapshotCache({
          cache: current,
          sessionId: state.selectedSessionId!,
          now: Date.now(),
        }),
        activeSessionId: state.selectedSessionId,
        maxSessions: MAX_TURN_SNAPSHOT_SESSIONS,
      }),
    );
  }, [state.selectedSessionId]);

  const activeSessionHistoryLoadKey = useMemo(
    () => deriveSessionHistorySnapshotLoadKey(state.activeSessionDetail),
    [state.activeSessionDetail],
  );
  const activeSessionHistoryLoadTarget = useMemo(
    () => deriveSessionHistorySnapshotLoadTarget(state.activeSessionDetail),
    [state.activeSessionDetail],
  );
  const activeSessionCachedTurnSnapshots = useMemo(
    () => sessionTurnSnapshotsForSession(turnSnapshotsBySession, state.activeSessionDetail?.session.sessionId),
    [state.activeSessionDetail, turnSnapshotsBySession],
  );
  const historyLoadMountedRef = useRef(true);
  const historyLoadLeaseCounterRef = useRef(0);
  const previousHistoryLoadTargetRef = useRef<SessionHistorySnapshotLoadTarget | undefined>(undefined);
  const historyLoadRegistryRef = useRef<SessionHistorySnapshotLoadRegistry>({});

  useEffect(() => {
    return () => {
      historyLoadMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const detail = state.activeSessionDetail;
    const sessionId = detail?.session.sessionId;
    const loadPlan = deriveSessionHistorySnapshotLoadPlan({
      detail,
      cachedSnapshots: activeSessionCachedTurnSnapshots,
      cachedLoadedRevisionKey: sessionId ? turnSnapshotsBySession[sessionId]?.loadedRevisionKey : undefined,
      loadingLease: sessionId
        ? (() => {
            const lease = historyLoadRegistryRef.current[sessionId];
            return lease ? { sessionId, loadKey: lease.loadKey, leaseId: lease.leaseId } : undefined;
          })()
        : undefined,
    });
    if (loadPlan.kind === "skip") {
      return;
    }

    if (loadPlan.kind === "mark_loaded") {
      setTurnSnapshotsBySession((current) =>
        markSessionHistorySnapshotLoaded({
          cache: current,
          sessionId: loadPlan.sessionId,
          loadedRevisionKey: loadPlan.loadedRevisionKey,
          now: Date.now(),
        }),
      );
      return;
    }

    let cancelled = false;
    const lease = loadPlan.loadedRevisionKey
      ? {
          sessionId: loadPlan.sessionId,
          loadKey: loadPlan.loadedRevisionKey,
          leaseId: ++historyLoadLeaseCounterRef.current,
        }
      : undefined;
    if (lease) {
      historyLoadRegistryRef.current = beginSessionHistorySnapshotLoadRegistryLease(
        historyLoadRegistryRef.current,
        lease,
      );
    }
    void (async () => {
      const results: PromiseSettledResult<OraStateSnapshot>[] = [];
      for (let index = 0; index < loadPlan.missingRunIds.length; index += HISTORY_SNAPSHOT_LOAD_CONCURRENCY) {
        if (!historyLoadMountedRef.current) return;
        if (cancelled) break;
        const chunk = loadPlan.missingRunIds.slice(index, index + HISTORY_SNAPSHOT_LOAD_CONCURRENCY);
        const chunkResults = await Promise.allSettled(
          chunk.map((runId) =>
            runtimeClient.getRunState(runId, {
              priority: "background",
              tag: "history-snapshot-load",
            }),
          ),
        );
        results.push(...chunkResults);
      }
      if (!historyLoadMountedRef.current) return;
      if (lease) {
        const released = releaseSessionHistorySnapshotLoadRegistryLease({
          registry: historyLoadRegistryRef.current,
          lease,
        });
        historyLoadRegistryRef.current = released.registry;
        if (!released.matched) {
          setTurnSnapshotsBySession((current) =>
            evictSessionTurnSnapshotCache({
              cache: updateSessionTurnSnapshotCache({
                cache: current,
                sessionId: lease.sessionId,
                snapshots: mergeSessionHistorySnapshotBatch({
                  currentSnapshots: sessionTurnSnapshotsForSession(current, lease.sessionId),
                  results,
                  maxSnapshots: MAX_TURN_SNAPSHOTS_PER_SESSION,
                }).snapshots,
                replaceSnapshots: true,
                maxSnapshots: MAX_TURN_SNAPSHOTS_PER_SESSION,
                now: Date.now(),
              }),
              activeSessionId: state.selectedSessionId,
              maxSessions: MAX_TURN_SNAPSHOT_SESSIONS,
            }),
          );
          return;
        }
      }
      setTurnSnapshotsBySession((current) => {
        const batch = mergeSessionHistorySnapshotBatch({
          currentSnapshots: sessionTurnSnapshotsForSession(current, loadPlan.sessionId),
          results,
          loadedRevisionKey: loadPlan.loadedRevisionKey,
          maxSnapshots: MAX_TURN_SNAPSHOTS_PER_SESSION,
        });
        return evictSessionTurnSnapshotCache({
          cache: updateSessionTurnSnapshotCache({
            cache: current,
            sessionId: loadPlan.sessionId,
            snapshots: batch.snapshots,
            loadedRevisionKey: batch.loadedRevisionKey,
            replaceSnapshots: true,
            maxSnapshots: MAX_TURN_SNAPSHOTS_PER_SESSION,
            now: Date.now(),
          }),
          activeSessionId: state.selectedSessionId,
          maxSessions: MAX_TURN_SNAPSHOT_SESSIONS,
        });
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeSessionCachedTurnSnapshots,
    activeSessionHistoryLoadKey,
    runtimeClient,
    state.activeSessionDetail,
    state.selectedSessionId,
    turnSnapshotsBySession,
  ]);

  useEffect(() => {
    const previousTarget = previousHistoryLoadTargetRef.current;
    if (
      previousTarget &&
      !sameSessionHistorySnapshotLoadTarget(previousTarget, activeSessionHistoryLoadTarget)
    ) {
      historyLoadRegistryRef.current = releaseSessionHistorySnapshotLoadRegistryTarget({
        registry: historyLoadRegistryRef.current,
        target: previousTarget,
      });
    }
    previousHistoryLoadTargetRef.current = activeSessionHistoryLoadTarget;
  }, [activeSessionHistoryLoadTarget]);

  useEffect(() => {
    if (!selectedSessionWorkspace.open || !state.selectedTurnRunId) {
      return;
    }

    const cached = activeSessionCachedTurnSnapshots[state.selectedTurnRunId];
    if (cached) {
      if (
        getActiveSnapshot(state.runLifecycle)?.runId !== state.selectedTurnRunId
      ) {
        dispatch({
          type: "SELECT_TURN",
          runId: state.selectedTurnRunId,
          snapshot: cached,
        });
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await runtimeClient.getRunState(
          state.selectedTurnRunId!,
        );
        if (cancelled) return;
        const sessionId = snapshot.sessionId ?? state.selectedSessionId;
        if (!sessionId) {
          return;
        }
        setTurnSnapshotsBySession((current) => {
          const existing = sessionTurnSnapshotsForSession(current, sessionId)[snapshot.runId];
          const merged = mergeStateSnapshot(existing, snapshot);
          if (!merged) {
            return current;
          }
          if (
            existing?.updatedAt === merged.updatedAt &&
            existing.events.length === merged.events.length &&
            existing.agentMessages.length === merged.agentMessages.length
          ) {
            return current;
          }
          return evictSessionTurnSnapshotCache({
            cache: updateSessionTurnSnapshotCache({
              cache: current,
              sessionId,
              snapshots: { [snapshot.runId]: merged },
              maxSnapshots: MAX_TURN_SNAPSHOTS_PER_SESSION,
              now: Date.now(),
            }),
            activeSessionId: state.selectedSessionId,
            maxSessions: MAX_TURN_SNAPSHOT_SESSIONS,
          });
        });
        dispatch({
          type: "SELECT_TURN",
          runId: snapshot.runId,
          snapshot,
        });
      } catch {
        // Historical snapshots load on demand; a missing one should not block chat.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    runtimeClient,
    dispatch,
    getActiveSnapshot(state.runLifecycle)?.runId,
    selectedSessionWorkspace.open,
    state.selectedTurnRunId,
    activeSessionCachedTurnSnapshots,
    state.selectedSessionId,
  ]);

  const activeSessionTurnSnapshots = useMemo(
    () =>
      deriveRenderableTurnSnapshots({
        detail: state.activeSessionDetail,
        activeSnapshot: getActiveSnapshot(state.runLifecycle),
        turnSnapshots: activeSessionCachedTurnSnapshots,
        selectedSessionId: state.selectedSessionId,
        preservedSettledSnapshots: state.preservedSettledSnapshots,
        planDecisionResolutionOverrides: state.planDecisionResolutionOverrides,
      }),
    [
      state.activeSessionDetail,
      activeSessionCachedTurnSnapshots,
      getActiveSnapshot(state.runLifecycle),
      state.selectedSessionId,
      state.preservedSettledSnapshots,
      state.planDecisionResolutionOverrides,
    ],
  );
  const fallbackChildSessionWorkspaceSessionId =
    state.selectedSessionId ?? selectedSession?.id;

  const openChildSessionWorkspacePage = useCallback((params: {
    childId: string;
    targetRunId: string;
    title?: string;
    sessionId?: string;
    backing: "replay" | "session";
    backingSessionId?: string;
    replayParentRunId?: string;
    replayChildRef?: RightWorkspaceReplayChildRef;
  }) => {
    const sessionId =
      params.sessionId ?? fallbackChildSessionWorkspaceSessionId;
    if (!sessionId) {
      return;
    }
    dispatch({
      type: "OPEN_RIGHT_WORKSPACE_PAGE",
      page: params.backing === "session"
        ? {
            id: `child-session:session:${params.backingSessionId ?? params.childId}:${crypto.randomUUID()}`,
            kind: "child_session",
            title: childSessionWorkspacePageTitle(params.title),
            sessionId,
            childBacking: "session",
            childId: params.childId,
            targetRunId: params.targetRunId,
            backingSessionId: params.backingSessionId ?? params.childId,
            ...(params.replayParentRunId
              ? { fallbackReplayParentRunId: params.replayParentRunId }
              : {}),
            ...(params.replayChildRef
              ? { fallbackReplayChildRef: params.replayChildRef }
              : {}),
          }
        : {
            id: `child-session:replay:${params.childId}:${crypto.randomUUID()}`,
            kind: "child_session",
            title: childSessionWorkspacePageTitle(params.title),
            sessionId,
            childBacking: "replay",
            childId: params.childId,
            targetRunId: params.targetRunId,
            replayParentRunId: params.replayParentRunId ?? params.targetRunId,
            replayChildRef: params.replayChildRef ?? {
              id: params.childId,
              agentId: params.childId,
              label: childSessionWorkspacePageTitle(params.title),
              status: "running",
              updatedAt: Date.now(),
              artifactIds: [],
            },
          },
    });
  }, [dispatch, fallbackChildSessionWorkspaceSessionId]);

  const runInteractionState: DesktopRunInteractionState = useMemo(() => {
    const sessionSummary = state.sessions.find(
      (s) => s.sessionId === state.selectedSessionId,
    );
    return deriveRunInteractionState({
      selectedSessionId: state.selectedSessionId,
      sessionSummary,
      activeSessionDetail: state.activeSessionDetail,
      turnSnapshots: activeSessionTurnSnapshots,
      selectedTurnRunId: state.selectedTurnRunId,
      runLifecycle: state.runLifecycle,
      planDecisionResolutionOverrides: state.planDecisionResolutionOverrides,
    });
  }, [
    state.selectedSessionId,
    state.sessions,
    state.activeSessionDetail,
    state.runLifecycle,
    activeSessionTurnSnapshots,
    state.selectedTurnRunId,
    state.planDecisionResolutionOverrides,
  ]);

  const chatMessagesCacheRef = useRef<{
    key: string;
    result: ReturnType<typeof adaptChatMessages>;
  } | null>(null);

  const chatMessages = useMemo(() => {
    const transcript = state.activeSessionDetail?.transcript ?? [];
    const rawPendingRun = getPendingRunState(state.runLifecycle);
    const resolveSkills = (ids: string[]): { id: string; name: string }[] => {
      if (!state.skillRegistry?.skills || ids.length === 0) return [];
      const result: { id: string; name: string }[] = [];
      for (const id of ids) {
        const skill = state.skillRegistry.skills.find((s) => s.id === id);
        if (skill) result.push({ id: skill.id, name: skill.name });
      }
      return result;
    };
    const pendingRun = rawPendingRun
      ? {
          sessionId: rawPendingRun.sessionId,
          runId: rawPendingRun.runId,
          prompt: rawPendingRun.prompt,
          createdAt: rawPendingRun.createdAt,
          progressText: rawPendingRun.progressText,
          skills: rawPendingRun.skillIds?.length ? resolveSkills(rawPendingRun.skillIds) : undefined,
        }
      : undefined;
    const cacheKey = buildChatMessagesCacheKey({
      transcript,
      turnSnapshots: activeSessionTurnSnapshots,
    });

    const cache = chatMessagesCacheRef.current;
    const adapted =
      cache && cache.key === cacheKey
        ? cache.result
        : adaptChatMessages(transcript, activeSessionTurnSnapshots);
    if (!cache || cache.key !== cacheKey) {
      chatMessagesCacheRef.current = { key: cacheKey, result: adapted };
    }
    return adaptRenderableChatMessages({
      transcript,
      turnSnapshots: activeSessionTurnSnapshots,
      pendingRun,
      liveMessageDeltas: state.liveMessageDeltaBuffer,
      acceptedPlanDecisionTurns: Object.values(state.acceptedPlanDecisionTurnProjections),
      selectedSessionId: state.selectedSessionId,
      baseMessages: adapted,
    });
  }, [
    activeSessionTurnSnapshots,
    state.activeSessionDetail,
    state.acceptedPlanDecisionTurnProjections,
    state.liveMessageDeltaBuffer,
    state.runLifecycle,
    state.selectedSessionId,
  ]);
  async function handleCopyProjectPath(absolutePath: string) {
    try {
      await copyTextToClipboard(absolutePath);
      dispatch({
        type: "SET_COMMAND_FEEDBACK",
        feedback: `Copied ${absolutePath}.`,
      });
    } catch (error) {
      dispatch({
        type: "SET_COMMAND_FEEDBACK",
        feedback: error instanceof Error ? error.message : "Copy path failed.",
      });
    }
  }

  function handleAddProjectFileToChat(
    projectId: string,
    file: OraProjectFileEntry,
  ) {
    const sessionId = state.selectedSessionId;
    if (!sessionId) {
      dispatch({
        type: "SET_COMMAND_FEEDBACK",
        feedback: "Select a chat before adding a file.",
      });
      return;
    }
    dispatch({
      type: "ADD_PROJECT_FILE_ATTACHMENT",
      sessionId,
      file: {
        projectId,
        path: file.path,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      },
    });
  }

  async function handleSubmitFeedback(
    message: ChatMessage,
    feedbackText: string,
  ) {
    if (!message.turn) {
      throw new Error("Feedback requires an assistant turn.");
    }
    const record = await runtimeClient.submitEvaluationFeedback({
      runId: message.turn.runId,
      sessionId: state.activeSessionDetail?.session.sessionId,
      turnIndex: message.turn.turnIndex,
      messageId: message.id,
      feedbackText,
    });
    dispatch({
      type: "SET_COMMAND_FEEDBACK",
      feedback: `Feedback captured as ${record.id}. Review it in Evaluation.`,
    });
  }
  const settingsDialog = state.settingsOpen ? (
    <SettingsView
      open={state.settingsOpen}
      onOpenChange={(open) => dispatch({ type: "SET_SETTINGS_OPEN", open })}
    />
  ) : null;
  const shouldShowOnboarding = !onboardingStatus && onboardingRequired === true;

  if (shouldShowOnboarding) {
    return (
      <ProviderOnboardingStep
        onComplete={() => completeOnboarding("completed")}
        onSkip={() => completeOnboarding("skipped")}
      />
    );
  }

  // Loading / error state
  if (!viewModel || !selectedSession || !state.bridgeStatus) {
    return (
      <AppShell>
        {settingsDialog}
        <WorkspacePane className="w-full">
          <LoadingPane />
        </WorkspacePane>
      </AppShell>
    );
  }

  if (state.activeView === "evaluation") {
    return (
      <AppShell>
        {settingsDialog}
        <WorkspacePane className="w-full">
          <Suspense fallback={<LoadingPane />}>
            <EvaluationView
              runtimeClient={runtimeClient}
              bridgeStatus={state.bridgeStatus}
            />
          </Suspense>
        </WorkspacePane>
      </AppShell>
    );
  }

  if (state.activeView === "agents") {
    return (
      <AppShell>
        {settingsDialog}
        <WorkspacePane className="w-full">
          <Suspense fallback={<LoadingPane />}>
            <AgentsView
              runtimeClient={runtimeClient}
              selectedCustomAgentId={state.selectedCustomAgentId}
              onStartChat={actions.openAgentChat}
              onClearSelectedCustomAgent={actions.clearSelectedCustomAgent}
            />
          </Suspense>
        </WorkspacePane>
      </AppShell>
    );
  }

  if (state.activeView === "automations") {
    return (
      <AppShell>
        {settingsDialog}
        <WorkspacePane className="w-full">
          <Suspense fallback={<LoadingPane />}>
            <AutomationsView runtimeClient={runtimeClient} />
          </Suspense>
        </WorkspacePane>
      </AppShell>
    );
  }

  if (state.activeView === "skills") {
    return (
      <AppShell>
        {settingsDialog}
        <WorkspacePane className="w-full">
          <Suspense fallback={<LoadingPane />}>
            <SkillsView runtimeClient={runtimeClient} />
          </Suspense>
        </WorkspacePane>
      </AppShell>
    );
  }

  if (state.activeView === "space-dashboard") {
    return (
      <AppShell>
        {settingsDialog}
        <WorkspacePane className="w-full">
          <SpaceFrame
            activeView="space-dashboard"
            onSelectView={(view) => dispatch({ type: "SET_VIEW", view })}
          >
            <Suspense fallback={<LoadingPane />}>
              <SpaceDashboardView />
            </Suspense>
          </SpaceFrame>
        </WorkspacePane>
      </AppShell>
    );
  }

  if (state.activeView === "space-library") {
    return (
      <AppShell>
        {settingsDialog}
        <WorkspacePane className="w-full">
          <SpaceFrame
            activeView="space-library"
            onSelectView={(view) => dispatch({ type: "SET_VIEW", view })}
          >
            <Suspense fallback={<LoadingPane />}>
              <SpaceLibraryView />
            </Suspense>
          </SpaceFrame>
        </WorkspacePane>
      </AppShell>
    );
  }

  if (state.activeView === "modes") {
    return (
      <AppShell>
        {settingsDialog}
        <WorkspacePane className="w-full">
          <Suspense fallback={<LoadingPane />}>
            <ModesView runtimeClient={runtimeClient} />
          </Suspense>
        </WorkspacePane>
      </AppShell>
    );
  }

  // Chat view (default)
  const {
    actions: actionRecords,
    agents,
    artifacts,
    checkpoints,
    modeCards,
    planItems,
    streamLines,
    topologyEdges,
    topologyNodes,
    activeMode,
  } = viewModel;
  const selectedProject = selectedSession.projectId
    ? state.projects.find(
        (project) => project.projectId === selectedSession.projectId,
      )
    : undefined;

  return (
    <AppShell>
      {settingsDialog}
      <div
        ref={splitContainerRef}
        className="flex h-full min-h-0 items-stretch gap-px"
      >
        <WorkspacePane className="min-w-0 flex-1">
          <ChatView
            activeMode={activeMode}
            actionRecords={actionRecords}
            selectedCustomAgentId={state.selectedCustomAgentId}
            projectLabel={selectedProject?.label}
            projectRootPath={selectedProject?.rootPath}
            activeSnapshot={getActiveSnapshot(state.runLifecycle)}
            agents={agents}
            busyCommand={state.busyCommand}
            chatMessages={chatMessages}
            turnSnapshots={activeSessionTurnSnapshots}
            checkpoints={checkpoints}
            modeCards={modeCards}
            composerPrompt={state.promptText}
            isLoading={state.isLoading}
            runInteractionState={runInteractionState}
            selectedSession={selectedSession}
            streamLines={streamLines}
            topologyEdges={topologyEdges}
            topologyNodes={topologyNodes}
            onComposerPromptChange={(text) =>
              dispatch({ type: "SET_PROMPT", text })
            }
            onClearSelectedCustomAgent={actions.clearSelectedCustomAgent}
            onForkSessionFromTurn={(runId) =>
              void actions.forkSessionFromTurn(runId)
            }
            onAdoptBranchGroup={(branchGroupId: string, runId: string) =>
              void actions.adoptBranchGroup(branchGroupId, runId)
            }
            onInterruptRun={actions.interruptRun}
            onReplaySelection={actions.replaySelection}
            onResumeRun={actions.resumeRun}
            onOpenChildSessionPage={(params) =>
              openChildSessionWorkspacePage(params)
            }
            onAcceptPlanDecisionAndStartImplementation={
              actions.acceptPlanDecisionAndStartImplementation
            }
            onResolvePlanDecision={actions.resolvePlanDecision}
            onCancelRun={actions.cancelRun}
            onOpenArtifact={(artifactId) =>
              dispatch({
                type: "OPEN_RIGHT_WORKSPACE_PAGE",
                page: {
                  id: `artifact:${artifactId}:${crypto.randomUUID()}`,
                  kind: "artifact",
                  title: "Artifact",
                  sessionId: state.selectedSessionId ?? selectedSession.id,
                  artifactId,
                },
              })
            }
            onSubmitFeedback={handleSubmitFeedback}
            onSubmitAllClarifications={(answers) =>
              void actions.submitAllClarifications(answers)
            }
            onSelectMode={(modeId) => dispatch({ type: "SET_MODE", modeId })}
            onSelectModeSelection={(selection) =>
              dispatch({ type: "SET_MODE_SELECTION", selection })
            }
            onSelectNode={(id) => dispatch({ type: "SELECT_NODE", nodeId: id })}
            onSelectSession={(sessionId) => void actions.selectSession(sessionId)}
            onStartRun={actions.startRun}
            onSetRightWorkspaceOpen={(open) =>
              dispatch({
                type: "SET_RIGHT_WORKSPACE_OPEN",
                sessionId: state.selectedSessionId,
                open,
              })
            }
            selectedSessionWorkspace={selectedSessionWorkspace}
          />
        </WorkspacePane>

        {isCurrentWorkspaceVisible && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整侧边栏宽度"
              className={cn(
                "group relative shrink-0 overflow-hidden touch-none motion-reduce:transition-none",
                isResizingRightWorkspace
                  ? "transition-none"
                  : "transition-[width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                workspaceAnimatedOpen
                  ? "w-1.5 cursor-col-resize opacity-100"
                  : "pointer-events-none w-0 cursor-default opacity-0",
              )}
              onPointerDown={(event) => {
                if (!selectedSessionWorkspace.open) {
                  return;
                }
                setIsResizingRightWorkspace(true);
                resizePointerIdRef.current = event.pointerId;
                window.addEventListener("pointermove", handleResizePointerMove);
                window.addEventListener("pointerup", handleResizePointerUp);
              }}
            >
              <div className="absolute left-1/2 top-1/2 h-10 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/85" />
            </div>
            <div
              className={cn(
                "flex min-w-0 shrink-0 flex-none justify-end overflow-hidden motion-reduce:transition-none",
                isResizingRightWorkspace
                  ? "transition-none"
                  : "transition-[width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                workspaceAnimatedOpen
                  ? "opacity-100"
                  : "opacity-0",
                workspaceClosingSessionId === state.selectedSessionId ? "pointer-events-none" : "",
              )}
              style={{
                width: workspaceAnimatedOpen ? selectedWorkspaceWidth : 0,
                maxWidth: getRightWorkspaceMaxWidth(splitContainerWidth),
              }}
            >
              <WorkspacePane
                className="h-full min-w-0"
                style={{
                  width: selectedWorkspaceWidth,
                  minWidth: MIN_DETAIL_PANEL_WIDTH,
                  maxWidth: getRightWorkspaceMaxWidth(splitContainerWidth),
                }}
              >
                <RightWorkspacePane
                  workspace={selectedSessionWorkspace}
                  runtimeClient={runtimeClient}
                  selectedSession={selectedSession}
                  selectedProject={selectedProject}
                  activeSnapshot={getActiveSnapshot(state.runLifecycle)}
                  busyCommand={state.busyCommand}
                  checkpoints={checkpoints}
                  commandFeedback={state.commandFeedback}
                  planItems={planItems}
                  runInteractionState={runInteractionState}
                  chatMessages={chatMessages}
                  turnSnapshots={activeSessionTurnSnapshots}
                  sessionDetailsById={state.sessionDetailsById}
                  onForkRun={actions.forkRun}
                  onForkAndResumeRun={actions.forkAndResumeRun}
                  onReplaySelection={actions.replaySelection}
                  onResumeRun={actions.resumeRun}
                  onCancelRun={actions.cancelRun}
                  onCopyPath={(path) => void handleCopyProjectPath(path)}
                  onAddFileToChat={(file) =>
                    selectedSession.projectId
                      ? handleAddProjectFileToChat(selectedSession.projectId, file)
                      : undefined
                  }
                  onOpenChildSessionPage={(params) =>
                    openChildSessionWorkspacePage(params)
                  }
                  onOpenWorkspacePage={(page) =>
                    dispatch({ type: "OPEN_RIGHT_WORKSPACE_PAGE", page })
                  }
                  onCloseWorkspace={() =>
                    dispatch({
                      type: "CLOSE_RIGHT_WORKSPACE",
                      sessionId: state.selectedSessionId,
                    })
                  }
                  onSelectPage={(page) =>
                    dispatch({
                      type: "SELECT_RIGHT_WORKSPACE_PAGE",
                      sessionId: page.sessionId,
                      pageId: page.id,
                    })
                  }
                  onClosePage={(page) =>
                    dispatch({
                      type: "CLOSE_RIGHT_WORKSPACE_PAGE",
                      sessionId: page.sessionId,
                      pageId: page.id,
                    })
                  }
                  onCacheSessionDetail={(detail) =>
                    dispatch({
                      type: "CACHE_SESSION_DETAIL",
                      detail,
                    })
                  }
                />
              </WorkspacePane>
            </div>
          </>
        )}
      </div>
      <DebugTimingOverlay />
    </AppShell>
  );
}

function DebugTimingOverlay() {
  const [records, setRecords] = useState(getRecords());
  const [visible, setVisible] = useState(false);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setRecords(getRecords());
    }, 200);
    return () => clearInterval(interval);
  }, [visible]);

  const handleHotspotClick = () => {
    clickCountRef.current += 1;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      setVisible(true);
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickCountRef.current = 0;
      }, 600);
    }
  };

  if (!visible) {
    return (
      <div
        onClick={handleHotspotClick}
        className="fixed bottom-0 right-0 z-[9999] h-5 w-5"
      />
    );
  }

  return (
    <div className="fixed bottom-2 right-2 z-[9999] max-h-[320px] w-[280px] overflow-auto rounded-lg border border-gray-700 bg-gray-900/95 p-2 font-mono text-[10px] leading-relaxed shadow-xl backdrop-blur">
      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-gray-300">
        <span>⏱ 性能计时</span>
        <div className="flex gap-1">
          <button
            onClick={() => {
              clearRecords();
              setRecords([]);
            }}
            className="rounded px-1 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
          >
            清除
          </button>
          <button
            onClick={() => setVisible(false)}
            className="rounded px-1 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
          >
            ✕
          </button>
        </div>
      </div>
      {records.length === 0 ? (
        <div className="py-2 text-center text-gray-600">
          点击 session 查看耗时
        </div>
      ) : (
        records.map((r, i) => (
          <div
            key={i}
            className="flex justify-between border-b border-gray-800 py-0.5"
          >
            <span className="text-gray-400">{r.label}</span>
            <span
              className={cn(
                "tabular-nums",
                r.elapsed > 100
                  ? "text-red-400 font-semibold"
                  : r.elapsed > 30
                    ? "text-yellow-400"
                    : "text-green-400",
              )}
            >
              {r.elapsed.toFixed(1)}ms
            </span>
          </div>
        ))
      )}
    </div>
  );
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("Copy path failed.");
  }
}

export function App() {
  return (
    <WorkbenchProvider>
      <WorkbenchErrorBoundary>
        <WorkbenchInner />
      </WorkbenchErrorBoundary>
    </WorkbenchProvider>
  );
}
