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
  type PointerEvent,
  type ReactNode,
} from "react";
import { LoaderCircle } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { ArtifactDrawer } from "./components/ArtifactDrawer";
import { ChatView } from "./components/ChatView";
import { DocumentsDrawer } from "./components/DocumentsDrawer";
import { OnboardingView } from "./components/onboarding/OnboardingView";
import { SettingsView } from "./components/SettingsView";
import { TrailsDrawer } from "./components/TrailsDrawer";
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
  deriveRenderableTurnSnapshots,
  getActiveSnapshot,
  getPendingRunState,
  mergeRunStreamSnapshot,
  mergeStateSnapshot,
  pruneTurnSnapshotsForActiveSession,
  useWorkbench,
  WorkbenchProvider,
} from "./lib/state";
import type { AppView, ArtifactRecord, ChatMessage } from "./types";
import { cn } from "./lib/utils";
import { getRecords, clearRecords } from "./lib/debugTiming";
import {
  adaptChatMessages,
  adaptRenderableChatMessages,
} from "./lib/viewModel";
import { buildChatMessagesCacheKey } from "./lib/chatMessageCache";
import type {
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
const SkillsView = lazy(() =>
  import("./components/SkillsView").then((module) => ({
    default: module.SkillsView,
  })),
);

const DEFAULT_DETAIL_PANEL_WIDTH = 460;
const DEFAULT_ARTIFACT_PANEL_WIDTH = 420;
const MIN_DETAIL_PANEL_WIDTH = 360;
const MIN_ARTIFACT_PANEL_WIDTH = 320;
const MIN_MAIN_PANEL_WIDTH = 640;
const WINDOW_TITLE_BASE = "Ora";
const MAX_TURN_SNAPSHOTS = 40;

interface BatchedStream {
  stream: OraRunEventStream;
  receivedAt: number;
}

function isLiveDeltaOnlyStream(stream: OraRunEventStream): boolean {
  return (
    !stream.snapshot &&
    stream.events.length > 0 &&
    stream.events.every(
      (event) => event.type === "message.delta" || event.type === "token.delta",
    )
  );
}

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
      provider.type !== "local_smoke" && verifiedProviderIds.has(provider.id),
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
      return `${base} · ${translateCopy(language, "定时任务")}`;
    case "skills":
      return `${base} · ${translateCopy(language, "Skills")}`;
    case "modes":
      return `${base} · ${translateCopy(language, "Modes")}`;
    case "evaluation":
      return `${base} · ${translateCopy(language, "Evaluation")}`;
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
  const {
    runtimeClient,
    viewModel,
    selectedSession,
    selectedNode,
    selectedBeat,
    selectedAgent,
    selectedCheckpoint,
    actions,
  } = useRunActions();
  const [onboardingStatus, setOnboardingStatus] = useState<
    OnboardingStatus | undefined
  >(() => readOnboardingStatus());
  const [onboardingRequired, setOnboardingRequired] = useState<
    boolean | undefined
  >();
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [detailPanelWidth, setDetailPanelWidth] = useState(
    DEFAULT_DETAIL_PANEL_WIDTH,
  );
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

    for (const { stream, receivedAt } of entries) {
      dispatch({ type: "APPLY_RUN_STREAM", stream, receivedAt });
    }

    setTurnSnapshots((current) => {
      let next = current;
      for (const { stream } of entries) {
        if (isLiveDeltaOnlyStream(stream)) continue;
        const merged = mergeRunStreamSnapshot(next[stream.runId], stream);
        if (!merged) continue;
        if (
          next[stream.runId] &&
          next[stream.runId]!.updatedAt === merged.updatedAt &&
          next[stream.runId]!.events.length === merged.events.length
        ) {
          continue;
        }
        next = { ...next, [stream.runId]: merged };
      }

      const keys = Object.keys(next);
      if (keys.length > MAX_TURN_SNAPSHOTS) {
        const evict = keys.slice(0, keys.length - MAX_TURN_SNAPSHOTS);
        for (const key of evict) {
          delete next[key];
        }
      }
      return next;
    });
  }, [dispatch]);

  const [artifactPanelWidth, setArtifactPanelWidth] = useState(
    DEFAULT_ARTIFACT_PANEL_WIDTH,
  );
  const [turnSnapshots, setTurnSnapshots] = useState<
    Record<string, OraStateSnapshot>
  >({});
  const [projectFileArtifact, setProjectFileArtifact] =
    useState<ArtifactRecord>();
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

  function clampDetailPanelWidth(nextWidth: number) {
    const containerWidth =
      splitContainerRef.current?.getBoundingClientRect().width ?? 0;
    if (containerWidth <= 0) return nextWidth;
    const reservedArtifactWidth = state.artifactPanelOpen
      ? artifactPanelWidth + 8
      : 0;

    const maxAllowedWidth = Math.max(
      MIN_DETAIL_PANEL_WIDTH,
      Math.min(
        720,
        containerWidth - MIN_MAIN_PANEL_WIDTH - reservedArtifactWidth - 24,
      ),
    );

    return Math.min(
      Math.max(nextWidth, MIN_DETAIL_PANEL_WIDTH),
      maxAllowedWidth,
    );
  }

  function clampArtifactPanelWidth(nextWidth: number) {
    const containerWidth =
      splitContainerRef.current?.getBoundingClientRect().width ?? 0;
    if (containerWidth <= 0) return nextWidth;
    const reservedDetailWidth = state.detailDrawer ? detailPanelWidth + 8 : 0;

    const maxAllowedWidth = Math.max(
      MIN_ARTIFACT_PANEL_WIDTH,
      Math.min(
        680,
        containerWidth - MIN_MAIN_PANEL_WIDTH - reservedDetailWidth - 24,
      ),
    );

    return Math.min(
      Math.max(nextWidth, MIN_ARTIFACT_PANEL_WIDTH),
      maxAllowedWidth,
    );
  }

  function handleDetailResizeStart(event: PointerEvent<HTMLButtonElement>) {
    if (!state.detailDrawer) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = detailPanelWidth;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setDetailPanelWidth(clampDetailPanelWidth(startWidth - deltaX));
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function handleArtifactResizeStart(event: PointerEvent<HTMLButtonElement>) {
    if (!state.artifactPanelOpen) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = artifactPanelWidth;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setArtifactPanelWidth(clampArtifactPanelWidth(startWidth - deltaX));
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

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
    if (!state.detailDrawer && !state.artifactPanelOpen) return;

    const syncPanelWidth = () => {
      setDetailPanelWidth((currentWidth) =>
        clampDetailPanelWidth(currentWidth),
      );
      setArtifactPanelWidth((currentWidth) =>
        clampArtifactPanelWidth(currentWidth),
      );
    };

    syncPanelWidth();
    window.addEventListener("resize", syncPanelWidth);
    return () => window.removeEventListener("resize", syncPanelWidth);
  }, [
    state.detailDrawer,
    state.artifactPanelOpen,
    detailPanelWidth,
    artifactPanelWidth,
  ]);

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
          dispatch({ type: "APPLY_RUN_STREAM", stream, receivedAt });
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
          const sessions = await runtimeClient.listSessions();
          if (cancelled) return;
          dispatch({
            type: "SET_COLLECTIONS",
            projects: projectsRef.current,
            sessions,
          });

          if (!event.sessionId) return;
          const detail = await runtimeClient.getSession(event.sessionId);
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
    if (!snapshot) return;

    setTurnSnapshots((current) => {
      const existing = current[snapshot.runId];
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
      return { ...current, [snapshot.runId]: merged };
    });
  }, [getActiveSnapshot(state.runLifecycle)]);

  function limitTurnSnapshots(
    current: Record<string, OraStateSnapshot>,
  ): Record<string, OraStateSnapshot> {
    const keys = Object.keys(current);
    if (keys.length <= MAX_TURN_SNAPSHOTS) return current;
    const evict = keys.slice(0, keys.length - MAX_TURN_SNAPSHOTS);
    const next = { ...current };
    for (const key of evict) {
      delete next[key];
    }
    return next;
  }

  useEffect(() => {
    setTurnSnapshots((current) =>
      limitTurnSnapshots(
        pruneTurnSnapshotsForActiveSession(current, state.activeSessionDetail),
      ),
    );
  }, [state.activeSessionDetail]);

  useEffect(() => {
    if (state.detailDrawer !== "trails" || !state.selectedTurnRunId) {
      return;
    }

    const cached = turnSnapshots[state.selectedTurnRunId];
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
        setTurnSnapshots((current) => {
          const existing = current[snapshot.runId];
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
          return { ...current, [snapshot.runId]: merged };
        });
        dispatch({
          type: "SELECT_TURN",
          runId: snapshot.runId,
          snapshot,
        });
        setTurnSnapshots(limitTurnSnapshots);
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
    state.detailDrawer,
    state.selectedTurnRunId,
    turnSnapshots,
  ]);

  const activeSessionTurnSnapshots = useMemo(
    () =>
      deriveRenderableTurnSnapshots({
        detail: state.activeSessionDetail,
        activeSnapshot: getActiveSnapshot(state.runLifecycle),
        turnSnapshots,
        selectedSessionId: state.selectedSessionId,
      }),
    [
      state.activeSessionDetail,
      turnSnapshots,
      getActiveSnapshot(state.runLifecycle),
      state.selectedSessionId,
    ],
  );

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
    });
  }, [
    state.selectedSessionId,
    state.sessions,
    state.activeSessionDetail,
    state.runLifecycle,
    activeSessionTurnSnapshots,
    state.selectedTurnRunId,
  ]);

  const chatMessagesCacheRef = useRef<{
    key: string;
    result: ReturnType<typeof adaptChatMessages>;
  } | null>(null);

  const chatMessages = useMemo(() => {
    const transcript = state.activeSessionDetail?.transcript ?? [];
    const pendingRun = getPendingRunState(state.runLifecycle);
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
      selectedSessionId: state.selectedSessionId,
      baseMessages: adapted,
    });
  }, [
    activeSessionTurnSnapshots,
    state.activeSessionDetail,
    state.liveMessageDeltaBuffer,
    state.runLifecycle,
    state.selectedSessionId,
  ]);
  const selectedArtifact = useMemo(() => {
    if (!state.selectedArtifactId) return undefined;

    if (projectFileArtifact?.id === state.selectedArtifactId) {
      return projectFileArtifact;
    }

    const activeArtifact = viewModel?.artifacts.find(
      (artifact) => artifact.id === state.selectedArtifactId,
    );
    if (activeArtifact) return activeArtifact;

    return chatMessages
      .flatMap((message) => message.turn?.artifacts ?? [])
      .find((artifact) => artifact.id === state.selectedArtifactId);
  }, [
    chatMessages,
    projectFileArtifact,
    state.selectedArtifactId,
    viewModel?.artifacts,
  ]);

  async function handleOpenProjectFile(projectId: string, path: string) {
    try {
      const file = await runtimeClient.readProjectFile(projectId, path);
      const artifact = projectFileToArtifact(file);
      setProjectFileArtifact(artifact);
      dispatch({ type: "OPEN_ARTIFACT_PANEL", artifactId: artifact.id });
    } catch (error) {
      dispatch({
        type: "SET_COMMAND_FEEDBACK",
        feedback:
          error instanceof Error
            ? error.message
            : "Project file preview failed.",
      });
    }
  }

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
      <OnboardingView
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
        className="flex h-full min-h-0 items-stretch gap-0.5"
      >
        <WorkspacePane className="min-w-0 flex-1">
          <ChatView
            activeMode={activeMode}
            actionRecords={actionRecords}
            selectedCustomAgentId={state.selectedCustomAgentId}
            projectLabel={selectedProject?.label}
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
            onForkRun={actions.forkRun}
            onCreateAndRunBranchGroup={(params) =>
              void actions.createAndRunBranchGroup(params)
            }
            onAdoptBranchGroup={(branchGroupId: string, runId: string) =>
              void actions.adoptBranchGroup(branchGroupId, runId)
            }
            onInterruptRun={actions.interruptRun}
            onReplaySelection={actions.replaySelection}
            onResumeRun={actions.resumeRun}
            onAcceptPlanDecisionAndStartImplementation={() =>
              void actions.acceptPlanDecisionAndStartImplementation()
            }
            onResolvePlanDecision={(status) =>
              void actions.resolvePlanDecision(status)
            }
            onCancelRun={actions.cancelRun}
            onOpenArtifact={(artifactId) =>
              dispatch({ type: "OPEN_ARTIFACT_PANEL", artifactId })
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
            onStartRun={actions.startRun}
            onToggleDetailDrawer={(drawer) =>
              dispatch({ type: "TOGGLE_DETAIL_DRAWER", drawer })
            }
            detailDrawer={state.detailDrawer}
          />
        </WorkspacePane>

        {state.detailDrawer && (
          <>
            <button
              type="button"
              aria-label="Resize trails panel"
              onPointerDown={handleDetailResizeStart}
              className="group flex h-full w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-transparent"
            >
              <span className="h-10 w-0.5 rounded-full bg-black/90 transition-colors group-hover:bg-black" />
            </button>

            <WorkspacePane
              className="min-w-0 shrink-0 flex-none"
              style={{ width: detailPanelWidth }}
            >
              {state.detailDrawer === "documents" &&
              selectedSession.projectId ? (
                <DocumentsDrawer
                  projectId={selectedSession.projectId}
                  projectLabel={
                    selectedProject?.label ?? selectedSession.project
                  }
                  runtimeClient={runtimeClient}
                  onClose={() => dispatch({ type: "CLOSE_DETAIL_DRAWER" })}
                  onOpenFile={(path) =>
                    void handleOpenProjectFile(selectedSession.projectId!, path)
                  }
                  onCopyPath={(path) => void handleCopyProjectPath(path)}
                  onAddFileToChat={(file) =>
                    handleAddProjectFileToChat(selectedSession.projectId!, file)
                  }
                />
              ) : (
                <TrailsDrawer
                  open={state.detailDrawer === "trails"}
                  onClose={() => dispatch({ type: "CLOSE_DETAIL_DRAWER" })}
                  actions={actionRecords}
                  agents={agents}
                  artifacts={artifacts}
                  activeSnapshot={getActiveSnapshot(state.runLifecycle)}
                  busyCommand={state.busyCommand}
                  checkpoints={checkpoints}
                  commandFeedback={state.commandFeedback}
                  planItems={planItems}
                  selectedAgent={selectedAgent}
                  selectedBeat={selectedBeat}
                  selectedCheckpoint={selectedCheckpoint}
                  selectedNode={selectedNode}
                  runInteractionState={runInteractionState}
                  selectedSession={selectedSession}
                  onForkRun={actions.forkRun}
                  onForkAndResumeRun={actions.forkAndResumeRun}
                  onReplaySelection={actions.replaySelection}
                  onResumeRun={actions.resumeRun}
                  onCancelRun={actions.cancelRun}
                />
              )}
            </WorkspacePane>
          </>
        )}

        {state.artifactPanelOpen && (
          <>
            <button
              type="button"
              aria-label="Resize artifact panel"
              onPointerDown={handleArtifactResizeStart}
              className="group flex h-full w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-transparent"
            >
              <span className="h-10 w-0.5 rounded-full bg-black/90 transition-colors group-hover:bg-black" />
            </button>

            <WorkspacePane
              className="min-w-0 shrink-0 flex-none"
              style={{ width: artifactPanelWidth }}
            >
              <ArtifactDrawer
                artifact={
                  selectedArtifact
                    ? toArtifactRecord(selectedArtifact)
                    : undefined
                }
                onClose={() => dispatch({ type: "CLOSE_ARTIFACT_PANEL" })}
              />
            </WorkspacePane>
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
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>();

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

function toArtifactRecord(artifact: ArtifactRecord): ArtifactRecord {
  return {
    id: artifact.id,
    label: artifact.label,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    createdAt: artifact.createdAt,
    uri: artifact.uri,
    sizeBytes: artifact.sizeBytes,
    payload: artifact.payload,
  };
}

function projectFileToArtifact(file: OraProjectFileReadResult): ArtifactRecord {
  return {
    id: `project-file:${file.projectId}:${file.path}`,
    label: file.path,
    kind: "file",
    mimeType: file.mimeType,
    createdAt: formatArtifactTime(file.modifiedAt),
    uri: file.uri,
    sizeBytes: file.sizeBytes,
    payload: file.payload,
  };
}

function formatArtifactTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Unknown";
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
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
