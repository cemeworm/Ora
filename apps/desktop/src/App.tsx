import {
  Component,
  Suspense,
  lazy,
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
import { SettingsView } from "./components/SettingsView";
import { TrailsDrawer } from "./components/TrailsDrawer";
import { useRunActions } from "./lib/useRunActions";
import {
  mergeRunStreamSnapshot,
  mergeStateSnapshot,
  useWorkbench,
  WorkbenchProvider,
} from "./lib/state";
import type { AppView, ArtifactRecord, ChatMessage } from "./types";
import { cn } from "./lib/utils";
import {
  adaptChatMessages,
  adaptPendingRunMessages,
  isSessionProcessing,
} from "./lib/viewModel";
import type {
  OraProjectFileEntry,
  OraProjectFileReadResult,
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
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [detailPanelWidth, setDetailPanelWidth] = useState(
    DEFAULT_DETAIL_PANEL_WIDTH,
  );
  const [artifactPanelWidth, setArtifactPanelWidth] = useState(
    DEFAULT_ARTIFACT_PANEL_WIDTH,
  );
  const [turnSnapshots, setTurnSnapshots] = useState<
    Record<string, OraStateSnapshot>
  >({});
  const [projectFileArtifact, setProjectFileArtifact] =
    useState<ArtifactRecord>();
  useDocumentTranslations(state.language);

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
        dispatch({ type: "RESET_RUNTIME_VIEW" });
        const bootstrap = await runtimeClient.bootstrap();
        const projects = await runtimeClient.listProjects();
        if (cancelled) return;
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
        const sessions = await runtimeClient.listSessions();
        const firstSession =
          sessions[0] ?? (await runtimeClient.createSession());
        const detail = await runtimeClient.getSession(firstSession.sessionId);
        if (cancelled) return;
        dispatch({
          type: "HYDRATE_SESSION",
          projects,
          sessions:
            firstSession === sessions[0]
              ? sessions
              : [firstSession, ...sessions],
          detail,
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
        dispatch({ type: "APPLY_RUN_STREAM", stream });
        setTurnSnapshots((current) => {
          const merged = mergeRunStreamSnapshot(current[stream.runId], stream);
          return merged ? { ...current, [stream.runId]: merged } : current;
        });
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
    const snapshot = state.activeSnapshot;
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
  }, [state.activeSnapshot]);

  useEffect(() => {
    const turns = state.activeSessionDetail?.turns ?? [];
    const missingRunIds = turns
      .map((turn) => turn.runId)
      .filter((runId) => turnSnapshots[runId] === undefined);

    if (missingRunIds.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const runId of missingRunIds) {
        if (cancelled) return;
        try {
          const snapshot = await runtimeClient.getRunState(runId);
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
        } catch {
          // Missing historical snapshots should not block switching sessions.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runtimeClient, state.activeSessionDetail]);

  const activeSessionTurnSnapshots = useMemo(() => {
    const detail = state.activeSessionDetail;
    if (!detail) return {};

    const activeSessionId = detail.session.sessionId;
    const activeRunIds = new Set(detail.turns.map((turn) => turn.runId));
    const scopedSnapshots: Record<string, OraStateSnapshot> = {};
    for (const [runId, snapshot] of Object.entries(turnSnapshots)) {
      const snapshotMatchesSession = !snapshot.sessionId || snapshot.sessionId === activeSessionId;
      if ((activeRunIds.has(runId) && snapshotMatchesSession) || snapshot.sessionId === activeSessionId) {
        scopedSnapshots[runId] = snapshot;
      }
    }
    return scopedSnapshots;
  }, [state.activeSessionDetail, turnSnapshots]);

  // Chat messages derived from events
  const pendingRunMessages = useMemo(() => {
    const pendingRun = state.pendingRun;
    if (!pendingRun || pendingRun.sessionId !== state.selectedSessionId) {
      return [];
    }
    const runAlreadyMaterialized = Object.values(
      activeSessionTurnSnapshots,
    ).some(
      (snapshot) =>
        snapshot?.sessionId === pendingRun.sessionId &&
        snapshot.input.prompt === pendingRun.prompt &&
        (snapshot.status === "queued" || snapshot.status === "running"),
    );
    return runAlreadyMaterialized ? [] : adaptPendingRunMessages(pendingRun);
  }, [activeSessionTurnSnapshots, state.pendingRun, state.selectedSessionId]);

  const chatMessages = useMemo(() => {
    return [
      ...adaptChatMessages(
        state.activeSessionDetail?.transcript ?? [],
        activeSessionTurnSnapshots,
      ),
      ...pendingRunMessages,
    ];
  }, [
    activeSessionTurnSnapshots,
    pendingRunMessages,
    state.activeSessionDetail,
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
        feedback:
          error instanceof Error
            ? error.message
            : "Copy path failed.",
      });
    }
  }

  function handleAddProjectFileToChat(projectId: string, file: OraProjectFileEntry) {
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
  const isRunning = isSessionProcessing(selectedSession, state.pendingRun);
  const isApprovalRequired = selectedSession.status === "approval_required";
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
            activeSnapshot={state.activeSnapshot}
            agents={agents}
            busyCommand={state.busyCommand}
            chatMessages={chatMessages}
            checkpoints={checkpoints}
            modeCards={modeCards}
            composerPrompt={state.promptText}
            isLoading={state.isLoading}
            isRunning={isRunning}
            isApprovalRequired={isApprovalRequired}
            selectedSession={selectedSession}
            streamLines={streamLines}
            topologyEdges={topologyEdges}
            topologyNodes={topologyNodes}
            onComposerPromptChange={(text) =>
              dispatch({ type: "SET_PROMPT", text })
            }
            onClearSelectedCustomAgent={actions.clearSelectedCustomAgent}
            onExportReport={actions.exportReport}
            onForkRun={actions.forkRun}
            onInterruptRun={actions.interruptRun}
            onReplaySelection={actions.replaySelection}
            onResumeRun={actions.resumeRun}
            onCancelRun={actions.cancelRun}
            onOpenArtifact={(artifactId) =>
              dispatch({ type: "OPEN_ARTIFACT_PANEL", artifactId })
            }
            onSubmitFeedback={handleSubmitFeedback}
            onSubmitClarificationOption={(answer) => void actions.submitClarificationOption(answer)}
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
                  activeSnapshot={state.activeSnapshot}
                  busyCommand={state.busyCommand}
                  checkpoints={checkpoints}
                  commandFeedback={state.commandFeedback}
                  planItems={planItems}
                  selectedAgent={selectedAgent}
                  selectedBeat={selectedBeat}
                  selectedCheckpoint={selectedCheckpoint}
                  selectedNode={selectedNode}
                  selectedSession={selectedSession}
                  onExportReport={actions.exportReport}
                  onForkRun={actions.forkRun}
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
    </AppShell>
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
