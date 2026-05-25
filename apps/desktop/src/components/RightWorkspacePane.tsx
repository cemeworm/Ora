import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  FileStack,
  FolderTree,
  MessageSquareText,
  Plus,
  Rows3,
  X,
} from "lucide-react";
import { ArtifactDrawer, ArtifactPreviewContent } from "./ArtifactDrawer";
import { AssistantTurnCard } from "./AssistantTurnCard";
import { DocumentsDrawer } from "./DocumentsDrawer";
import { MarkdownContent } from "./MarkdownContent";
import { MessageBubble } from "./MessageBubble";
import { TrailsDrawer } from "./TrailsDrawer";
import { Conversation, ConversationContent } from "./ai-elements/conversation";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import type { DesktopRunInteractionState } from "../lib/runInteractionState";
import type {
  OraSessionTurn,
  OraProjectFileEntry,
  OraProjectSummary,
  OraSessionDetail,
  OraStateSnapshot,
  RuntimeClient,
} from "../lib/runtimeClient";
import type {
  ArtifactRecord,
  AssistantTurnAttachment,
  ChatMessage,
  CheckpointRecord,
  PlanItem,
  SessionRun,
  TurnProcessStep,
  TurnAgentConversationMessage,
  TurnTimelineItem,
} from "../types";
import type {
  RightWorkspacePage,
  RightWorkspaceSessionState,
} from "../lib/state";
import { adaptChatMessages } from "../lib/viewModel";

interface RightWorkspacePaneProps {
  workspace: RightWorkspaceSessionState;
  runtimeClient: RuntimeClient;
  selectedSession: SessionRun;
  selectedProject?: OraProjectSummary;
  activeSnapshot?: OraStateSnapshot;
  busyCommand?: string;
  commandFeedback: string;
  checkpoints: CheckpointRecord[];
  planItems: PlanItem[];
  runInteractionState: DesktopRunInteractionState;
  chatMessages: ChatMessage[];
  turnSnapshots: Record<string, OraStateSnapshot | undefined>;
  sessionDetailsById: Record<string, OraSessionDetail>;
  onForkRun: () => void;
  onForkAndResumeRun: () => void;
  onReplaySelection: () => void;
  onResumeRun: () => void;
  onCancelRun: () => void;
  onCopyPath: (path: string) => void;
  onAddFileToChat: (file: OraProjectFileEntry) => void;
  onOpenChildSessionPage: (childSessionId: string, targetRunId?: string) => void;
  onOpenWorkspacePage: (page: RightWorkspacePage) => void;
  onCloseWorkspace: () => void;
  onSelectPage: (page: RightWorkspacePage) => void;
  onClosePage: (page: RightWorkspacePage) => void;
  onCacheSessionDetail: (detail: OraSessionDetail) => void;
}

export function RightWorkspacePane({
  workspace,
  runtimeClient,
  selectedSession,
  selectedProject,
  activeSnapshot,
  busyCommand,
  commandFeedback,
  checkpoints,
  planItems,
  runInteractionState,
  chatMessages,
  turnSnapshots,
  sessionDetailsById,
  onForkRun,
  onForkAndResumeRun,
  onReplaySelection,
  onResumeRun,
  onCancelRun,
  onCopyPath,
  onAddFileToChat,
  onOpenChildSessionPage,
  onOpenWorkspacePage,
  onCloseWorkspace,
  onSelectPage,
  onClosePage,
  onCacheSessionDetail,
}: RightWorkspacePaneProps) {
  function toArtifactRecord(artifact: {
    id: string;
    label: string;
    kind: "file" | "report" | "log";
    createdAt: number;
    mimeType: string;
    uri?: string;
    payload?: unknown;
    sizeBytes?: number;
  }): ArtifactRecord {
    return {
      id: artifact.id,
      label: artifact.label,
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      createdAt: new Date(artifact.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      uri: artifact.uri,
      sizeBytes: artifact.sizeBytes,
      payload: artifact.payload,
    };
  }

  const activePage =
    workspace.pages.find((page) => page.id === workspace.selectedPageId) ??
    workspace.pages.at(-1);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);

  function titleForPageKind(kind: RightWorkspacePage["kind"]) {
    switch (kind) {
      case "documents":
        return "文件";
      case "artifact":
        return "Artifact";
      case "child_session":
        return "子会话";
      case "trails":
      default:
        return "轨迹";
    }
  }

  function openWorkspacePage(kind: RightWorkspacePage["kind"]) {
    const page: RightWorkspacePage = {
      id: `${kind}:${crypto.randomUUID()}`,
      kind,
      title: titleForPageKind(kind),
      sessionId: selectedSession.id,
      ...(kind === "trails"
        ? { targetRunId: selectedSession.latestRunId }
        : kind === "documents"
          ? { projectId: selectedSession.projectId }
          : {}),
    };
    onOpenWorkspacePage(page);
    setIsAddMenuOpen(false);
  }
  const activeChildSessionDetail =
    activePage?.kind === "child_session"
      ? sessionDetailsById[activePage.childSessionId ?? ""]
      : undefined;
  const activeChildSessionSnapshot =
    activePage?.kind === "child_session" && activePage.targetRunId
      ? turnSnapshots[activePage.targetRunId] ??
        activeChildSessionDetail?.latestSnapshot
      : activeChildSessionDetail?.latestSnapshot;
  const selectedArtifact = useMemo(() => {
    if (activePage?.kind !== "artifact") {
      return undefined;
    }
    const artifactId = activePage.artifactId;
    if (!artifactId) {
      return undefined;
    }
    const fromChat = chatMessages
      .flatMap((message) => message.turn?.artifacts ?? [])
      .find((artifact) => artifact.id === artifactId);
    if (fromChat) {
      return {
        id: fromChat.id,
        label: fromChat.label,
        kind: fromChat.kind,
        mimeType: fromChat.mimeType,
        createdAt: fromChat.createdAt,
        uri: fromChat.uri,
        sizeBytes: fromChat.sizeBytes,
        payload: fromChat.payload,
      } satisfies ArtifactRecord;
    }
    const runtimeArtifact = activeSnapshot?.artifacts.find(
      (artifact) => artifact.id === artifactId,
    );
    return runtimeArtifact ? toArtifactRecord(runtimeArtifact) : undefined;
  }, [activePage, activeSnapshot?.artifacts, chatMessages]);

  useEffect(() => {
    const page = workspace.pages.find(
      (entry) => entry.id === workspace.selectedPageId,
    );
    if (!page || page.kind !== "child_session" || !page.childSessionId) {
      return;
    }
    if (sessionDetailsById[page.childSessionId]) {
      return;
    }
    void runtimeClient.getSession(page.childSessionId).then((detail) => {
      onCacheSessionDetail(detail);
    });
  }, [
    onCacheSessionDetail,
    runtimeClient,
    sessionDetailsById,
    workspace.pages,
    workspace.selectedPageId,
  ]);

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-transparent">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-card/74 px-3 backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {workspace.pages.length > 0 ? (
            <>
              {workspace.pages.map((page) => (
                <div
                  key={page.id}
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 transition",
                    page.id === workspace.selectedPageId
                      ? "bg-black/[0.04]"
                      : "bg-transparent hover:bg-black/[0.03]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectPage(page)}
                    aria-label={`Select ${page.title}`}
                    className={cn(
                      "rounded-sm px-1.5 py-0.5 text-[11px] font-medium transition",
                      page.id === workspace.selectedPageId
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {page.title}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${page.title}`}
                    className="rounded-sm p-0.5 text-[11px] text-muted-foreground transition hover:text-foreground"
                    onClick={() => onClosePage(page)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="relative shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="新增页面"
                  title="新增页面"
                  onClick={() => setIsAddMenuOpen((current) => !current)}
                >
                  <Plus size={14} />
                </Button>
                {isAddMenuOpen ? (
                  <WorkspacePagePicker onOpenPage={openWorkspacePage} />
                ) : null}
              </div>
            </>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="关闭侧边栏"
          title="关闭侧边栏"
          onClick={onCloseWorkspace}
        >
          <X size={14} />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          {activePage?.kind === "trails" && activeSnapshot ? (
            <TrailsDrawer
              open
              onClose={onCloseWorkspace}
              actions={[] as never}
              agents={[] as never}
              artifacts={activeSnapshot.artifacts.map(toArtifactRecord)}
              activeSnapshot={activeSnapshot}
              busyCommand={busyCommand}
              checkpoints={checkpoints as never}
              commandFeedback={commandFeedback}
              planItems={planItems as never}
              runInteractionState={runInteractionState}
              selectedSession={selectedSession}
              onForkRun={onForkRun}
              onForkAndResumeRun={onForkAndResumeRun}
              onReplaySelection={onReplaySelection}
              onResumeRun={onResumeRun}
              onCancelRun={onCancelRun}
            />
          ) : activePage?.kind === "documents" && selectedProject ? (
            <DocumentsDrawer
              projectId={selectedProject.projectId}
              projectLabel={selectedProject.label}
              runtimeClient={runtimeClient}
              onClose={onCloseWorkspace}
              onOpenFile={() => undefined}
              onCopyPath={onCopyPath}
              onAddFileToChat={onAddFileToChat}
            />
          ) : activePage?.kind === "artifact" && selectedArtifact ? (
            <ArtifactDrawer artifact={selectedArtifact} onClose={onCloseWorkspace} />
          ) : activePage?.kind === "child_session" ? (
            <ChildSessionWorkspacePage
              detail={activeChildSessionDetail}
              snapshot={activeChildSessionSnapshot}
              runtimeClient={runtimeClient}
              onOpenChildSessionPage={onOpenChildSessionPage}
            />
          ) : (
            <WorkspaceEmptyState onOpenPage={openWorkspacePage} />
          )}
        </div>
      </div>
    </aside>
  );
}

const WORKSPACE_PAGE_PICKER_OPTIONS: Array<{
  kind: RightWorkspacePage["kind"];
  title: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    kind: "trails",
    title: "轨迹",
    description: "查看当前会话的 timeline、状态和执行细节。",
    icon: <Rows3 size={16} />,
  },
  {
    kind: "documents",
    title: "文件",
    description: "浏览项目文件树，并继续把文件加入当前对话。",
    icon: <FolderTree size={16} />,
  },
];

function WorkspacePagePicker({
  onOpenPage,
}: {
  onOpenPage: (kind: RightWorkspacePage["kind"]) => void;
}) {
  return (
    <div className="absolute right-0 top-full z-40 mt-1 min-w-56 rounded-xl border border-border bg-popover p-2 shadow-lift">
      {WORKSPACE_PAGE_PICKER_OPTIONS.map((option) => (
        <button
          key={option.kind}
          type="button"
          onClick={() => onOpenPage(option.kind)}
          className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-accent hover:text-accent-foreground"
        >
          <span className="mt-0.5 text-muted-foreground">{option.icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{option.title}</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {option.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function WorkspaceEmptyState({
  onOpenPage,
}: {
  onOpenPage: (kind: RightWorkspacePage["kind"]) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col justify-center p-5">
      <div className="w-full max-w-sm space-y-2 self-center">
        {WORKSPACE_PAGE_PICKER_OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            onClick={() => onOpenPage(option.kind)}
            className="flex w-full items-start gap-3 rounded-xl border border-border/70 bg-background/80 px-3 py-3 text-left transition hover:bg-accent hover:text-accent-foreground"
          >
            <span className="mt-0.5 text-muted-foreground">{option.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                {option.title}
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {option.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChildSessionWorkspacePage({
  detail,
  snapshot,
  runtimeClient,
  onOpenChildSessionPage,
}: {
  detail?: OraSessionDetail;
  snapshot?: OraStateSnapshot;
  runtimeClient: RuntimeClient;
  onOpenChildSessionPage: (childSessionId: string, targetRunId?: string) => void;
}) {
  const [activeSection, setActiveSection] = useState<"conversation" | "turns" | "artifacts">("conversation");
  const [turnSnapshotsByRunId, setTurnSnapshotsByRunId] = useState<Record<string, OraStateSnapshot | undefined>>({});
  const [selectedTurnRunId, setSelectedTurnRunId] = useState<string | undefined>(snapshot?.runId ?? detail?.turns.at(-1)?.runId);

  useEffect(() => {
    if (!detail) {
      return;
    }
    setSelectedTurnRunId((current) => current ?? snapshot?.runId ?? detail.turns.at(-1)?.runId);
  }, [detail, snapshot?.runId]);

  useEffect(() => {
    const hasSnapshotAlready =
      Boolean(selectedTurnRunId && turnSnapshotsByRunId[selectedTurnRunId]) ||
      snapshot?.runId === selectedTurnRunId ||
      detail?.latestSnapshot?.runId === selectedTurnRunId;
    if (!detail || !selectedTurnRunId || hasSnapshotAlready) {
      return;
    }
    let cancelled = false;
    void runtimeClient.getRunState(selectedTurnRunId, {
      priority: "background",
      tag: "child-session-turn",
    }).then((nextSnapshot) => {
      if (cancelled) {
        return;
      }
      setTurnSnapshotsByRunId((current) => ({
        ...current,
        [selectedTurnRunId]: nextSnapshot,
      }));
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [detail, runtimeClient, selectedTurnRunId, turnSnapshotsByRunId]);

  if (!detail) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
          正在加载子代理会话内容…
        </div>
      </div>
    );
  }

  const latestTurn = detail.turns.at(-1);
  const status = snapshot?.status ?? latestTurn?.status ?? detail.session.status;
  const updatedAt = snapshot?.updatedAt ?? detail.session.updatedAt;
  const effectiveTurnSnapshots = {
    ...(detail.latestSnapshot ? { [detail.latestSnapshot.runId]: detail.latestSnapshot } : {}),
    ...(snapshot ? { [snapshot.runId]: snapshot } : {}),
    ...turnSnapshotsByRunId,
  };
  const selectedTurn = detail.turns.find((turn) => turn.runId === selectedTurnRunId) ?? latestTurn;
  const selectedTurnSnapshot = selectedTurn?.runId ? effectiveTurnSnapshots[selectedTurn.runId] : undefined;
  const childMessages = adaptChatMessages(detail.transcript, effectiveTurnSnapshots);
  const selectedAssistantMessage = selectedTurn
    ? childMessages.find((message) =>
      message.role === "assistant" && (message.metadata?.runId ?? message.turn?.runId) === selectedTurn.runId,
    )
    : undefined;
  const selectedAssistantTurn = selectedAssistantMessage?.turn;
  const selectedTimelineItems = selectedAssistantTurn?.timelineItems ?? [];
  const selectedAgentMessages = selectedAssistantTurn?.agentMessages ?? [];
  const selectedArtifacts = selectedTurnSnapshot?.artifacts ?? [];
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | undefined>(undefined);
  const effectiveSelectedArtifactId =
    selectedArtifactId && selectedArtifacts.some((artifact) => artifact.id === selectedArtifactId)
      ? selectedArtifactId
      : selectedArtifacts[0]?.id;

  const selectedArtifactRecord = useMemo(() => {
    if (!effectiveSelectedArtifactId) {
      return undefined;
    }
    const artifact = selectedArtifacts.find((entry) => entry.id === effectiveSelectedArtifactId);
    if (!artifact) {
      return undefined;
    }
    return toArtifactRecordForWorkspace(artifact);
  }, [effectiveSelectedArtifactId, selectedArtifacts]);
  const turnArtifactCountByRunId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const turn of detail.turns) {
      const count =
        turn.runId && effectiveTurnSnapshots[turn.runId]
          ? effectiveTurnSnapshots[turn.runId]?.artifacts.length ?? 0
          : turn.artifactCount;
      counts.set(turn.runId, count);
    }
    return counts;
  }, [detail.turns, effectiveTurnSnapshots]);

  function openSelectedTurnArtifacts(artifactId?: string) {
    if (artifactId) {
      setSelectedArtifactId(artifactId);
    }
    setActiveSection("artifacts");
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/60 p-3">
        <div className="rounded-xl border border-border bg-card/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {detail.session.title}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                Session ID: {detail.session.sessionId}
              </p>
            </div>
            <span className="rounded-full border border-border bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
              {status ?? "idle"}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span>{detail.turns.length} turns</span>
            <span>{detail.transcript.length} messages</span>
            <span>{formatTimestamp(updatedAt)}</span>
          </div>
          {latestTurn ? (
            <button
              type="button"
              onClick={() =>
                onOpenChildSessionPage(detail.session.sessionId, latestTurn.runId)
              }
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1 text-xs text-foreground transition hover:bg-accent hover:text-accent-foreground"
            >
              <Bot size={12} />
              在新页签打开最新回合
            </button>
          ) : null}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <SectionButton
            active={activeSection === "conversation"}
            icon={<MessageSquareText size={13} />}
            label="Conversation"
            onClick={() => setActiveSection("conversation")}
          />
          <SectionButton
            active={activeSection === "turns"}
            icon={<Rows3 size={13} />}
            label="Turns"
            onClick={() => setActiveSection("turns")}
          />
          <SectionButton
            active={activeSection === "artifacts"}
            icon={<FileStack size={13} />}
            label="Artifacts"
            onClick={() => setActiveSection("artifacts")}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeSection === "conversation" ? (
          detail.transcript.length > 0 ? (
          <Conversation className="min-h-0">
            <ConversationContent className="gap-4 p-0">
              {detail.transcript.map((message) => (
                <div key={message.id} className="space-y-1">
                  {message.role === "assistant" && message.agentLabel ? (
                    <p className="pl-1 text-xs font-medium text-muted-foreground">
                      {message.agentLabel}
                    </p>
                  ) : null}
                  <MessageBubble
                    role={message.role}
                    content=""
                    inlineContent={
                      message.role === "assistant" ? (
                        <MarkdownContent content={message.content} className="text-sm leading-6" />
                      ) : (
                        <span className="block whitespace-pre-wrap break-words leading-5 [overflow-wrap:anywhere]">
                          {message.content}
                        </span>
                      )
                    }
                  />
                  <p className="pl-1 text-[11px] text-muted-foreground">
                    {formatTimestamp(message.createdAt)}
                  </p>
                </div>
              ))}
            </ConversationContent>
          </Conversation>
          ) : (
            <div className="rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
              这个子代理会话还没有可展示的 transcript。
            </div>
          )
        ) : activeSection === "turns" ? (
          <div className="grid min-h-0 gap-3 lg:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="space-y-2">
              {detail.turns.map((turn) => (
                <button
                  key={turn.runId}
                  type="button"
                  onClick={() => setSelectedTurnRunId(turn.runId)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-2 text-left transition",
                    selectedTurnRunId === turn.runId
                      ? "border-border bg-card text-foreground"
                      : "border-border/70 bg-background/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <p className="text-xs font-medium">Turn {turn.turnIndex}</p>
                  <p className="mt-1 truncate text-[11px]">{turn.prompt}</p>
                </button>
              ))}
            </div>
            <div className="min-w-0">
              {selectedTurn && selectedAssistantTurn ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-card/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          Turn {selectedTurn.turnIndex}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {selectedTurn.status} · {formatTimestamp(selectedTurn.updatedAt)}
                        </p>
                      </div>
                      {selectedArtifacts.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => openSelectedTurnArtifacts()}
                          className="shrink-0 rounded-full border border-border bg-background/80 px-3 py-1 text-xs text-foreground transition hover:bg-accent hover:text-accent-foreground"
                        >
                          打开 Artifacts
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
                      {selectedTurn.prompt}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span>{selectedTimelineItems.length} timeline items</span>
                      <span>{selectedAgentMessages.length} agent messages</span>
                      <span>{selectedArtifacts.length} artifacts</span>
                    </div>
                  </div>
                  <AssistantTurnCard
                    content={selectedAssistantMessage?.content ?? ""}
                    turn={selectedAssistantTurn as AssistantTurnAttachment}
                    density="compact"
                    onOpenArtifact={openSelectedTurnArtifacts}
                  />
                  <ChildSessionTurnDrilldown
                    timelineItems={selectedTimelineItems}
                    agentMessages={selectedAgentMessages}
                    onOpenArtifact={openSelectedTurnArtifacts}
                  />
                </div>
              ) : selectedTurn ? (
                <div className="rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
                  正在加载这个回合的详情…
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
                  这个子代理会话还没有回合详情。
                </div>
              )}
            </div>
          </div>
        ) : selectedArtifacts.length > 0 ? (
          <div className="grid min-h-0 gap-3 xl:grid-cols-[11rem_15rem_minmax(0,1fr)]">
            <div className="space-y-3 min-h-0">
              <div className="rounded-xl border border-border bg-card/70 p-4">
                <p className="text-sm font-medium text-foreground">
                  Artifact turns
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {detail.turns.length} turns
                </p>
              </div>
              <div className="space-y-2">
                {detail.turns.map((turn) => (
                  <button
                    key={turn.runId}
                    type="button"
                    onClick={() => setSelectedTurnRunId(turn.runId)}
                    className={cn(
                      "w-full rounded-xl border px-3 py-3 text-left transition",
                      selectedTurnRunId === turn.runId
                        ? "border-border bg-card text-foreground"
                        : "border-border/70 bg-background/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <p className="text-xs font-medium">Turn {turn.turnIndex}</p>
                    <p className="mt-1 truncate text-[11px]">
                      {turnArtifactCountByRunId.get(turn.runId) ?? 0} artifacts
                    </p>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3 min-h-0">
              <div className="rounded-xl border border-border bg-card/70 p-4">
                <p className="text-sm font-medium text-foreground">
                  {selectedTurn ? `Turn ${selectedTurn.turnIndex} artifacts` : "Artifacts"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedArtifacts.length} items
                </p>
              </div>
              <div className="space-y-2">
                {selectedArtifacts.map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    onClick={() => setSelectedArtifactId(artifact.id)}
                    className={cn(
                      "w-full rounded-xl border px-3 py-3 text-left transition",
                      effectiveSelectedArtifactId === artifact.id
                        ? "border-border bg-card text-foreground"
                        : "border-border/70 bg-background/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {artifact.label}
                        </p>
                        <p className="mt-1 truncate text-[11px]">
                          {artifact.kind} · {artifact.mimeType}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px]">
                        {formatTimestamp(artifact.createdAt)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 overflow-hidden rounded-xl border border-border bg-card/70">
              {selectedArtifactRecord ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="shrink-0 border-b border-border/60 px-4 py-3">
                    <p className="truncate text-sm font-medium text-foreground">
                      {selectedArtifactRecord.label}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {selectedArtifactRecord.kind} · {selectedArtifactRecord.mimeType}
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto" data-testid="child-session-artifact-preview">
                    <ArtifactPreviewContent artifact={selectedArtifactRecord} />
                  </div>
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">
                  选择一个 artifact 以预览内容。
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
            当前选中回合还没有 artifacts。
          </div>
        )}
      </div>
    </div>
  );
}

function toArtifactRecordForWorkspace(artifact: {
  id: string;
  label: string;
  kind: "file" | "report" | "log";
  createdAt: number;
  mimeType: string;
  uri?: string;
  payload?: unknown;
  sizeBytes?: number;
}): ArtifactRecord {
  return {
    id: artifact.id,
    label: artifact.label,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    createdAt: new Date(artifact.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    uri: artifact.uri,
    sizeBytes: artifact.sizeBytes,
    payload: artifact.payload,
  };
}

function ChildSessionTurnDrilldown({
  timelineItems,
  agentMessages,
  onOpenArtifact,
}: {
  timelineItems: TurnTimelineItem[];
  agentMessages: TurnAgentConversationMessage[];
  onOpenArtifact: (artifactId?: string) => void;
}) {
  const statusGroups = useMemo(
    () =>
      timelineItems.filter(
        (item): item is Extract<TurnTimelineItem, { kind: "status_group" }> =>
          item.kind === "status_group",
      ),
    [timelineItems],
  );
  const [selectedStatusGroupId, setSelectedStatusGroupId] = useState<string | undefined>(undefined);
  const effectiveSelectedStatusGroup =
    selectedStatusGroupId
      ? statusGroups.find((item) => item.id === selectedStatusGroupId)
      : statusGroups[0];

  useEffect(() => {
    if (statusGroups.length === 0) {
      setSelectedStatusGroupId(undefined);
      return;
    }
    setSelectedStatusGroupId((current) =>
      current && statusGroups.some((item) => item.id === current)
        ? current
        : statusGroups[0]?.id,
    );
  }, [statusGroups]);

  return (
    <div className="space-y-3" data-testid="child-session-turn-drilldown">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.95fr)]">
        <div className="rounded-xl border border-border bg-card/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">Timeline drilldown</p>
            <span className="text-[11px] text-muted-foreground">{timelineItems.length} items</span>
          </div>
          {timelineItems.length > 0 ? (
            <div className="mt-3 space-y-2">
              {timelineItems.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/70 bg-background/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {timelineItemLabel(item)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">
                        {timelineItemSummary(item)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {item.timestamp}
                    </span>
                  </div>
                  {item.agentLabel ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {item.agentLabel}
                    </p>
                  ) : null}
                  {item.kind === "status_group" ? (
                    <button
                      type="button"
                      onClick={() => setSelectedStatusGroupId(item.id)}
                      className={cn(
                        "mt-3 rounded-full border px-3 py-1 text-xs transition",
                        effectiveSelectedStatusGroup?.id === item.id
                          ? "border-border bg-card text-foreground"
                          : "border-border/70 bg-background/80 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      查看 steps
                    </button>
                  ) : null}
                  {item.kind === "artifact" && item.artifactId ? (
                    <button
                      type="button"
                      onClick={() => onOpenArtifact(item.artifactId)}
                      className="mt-3 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground transition hover:bg-accent hover:text-accent-foreground"
                    >
                      预览 artifact
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">
              这个回合还没有 timeline 明细。
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">Agent messages</p>
            <span className="text-[11px] text-muted-foreground">{agentMessages.length} items</span>
          </div>
          {agentMessages.length > 0 ? (
            <div className="mt-3 space-y-2">
              {agentMessages.map((message) => (
                <div key={message.id} className="rounded-lg border border-border/70 bg-background/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        {[message.fromAgentLabel, message.toAgentLabels.join(", ") || "broadcast"].join(" -> ")}
                      </p>
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {message.kind} · {message.status}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {message.timestamp}
                    </span>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-foreground">
                    <MarkdownContent content={message.content} className="text-sm leading-6" />
                  </div>
                  {message.artifactIds.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.artifactIds.map((artifactId) => (
                        <button
                          key={artifactId}
                          type="button"
                          onClick={() => onOpenArtifact(artifactId)}
                          className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground transition hover:bg-accent hover:text-accent-foreground"
                        >
                          打开 {artifactId}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">
              这个回合还没有 agent message 明细。
            </div>
          )}
        </div>
      </div>
      {statusGroups.length > 0 ? (
        <ChildSessionStatusGroupDrilldown
          statusGroups={statusGroups}
          selectedStatusGroup={effectiveSelectedStatusGroup}
        />
      ) : null}
    </div>
  );
}

function ChildSessionStatusGroupDrilldown({
  statusGroups,
  selectedStatusGroup,
}: {
  statusGroups: Array<Extract<TurnTimelineItem, { kind: "status_group" }>>;
  selectedStatusGroup?: Extract<TurnTimelineItem, { kind: "status_group" }>;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-[16rem_minmax(0,1fr)]" data-testid="child-session-status-group-drilldown">
      <div className="rounded-xl border border-border bg-card/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Status groups</p>
          <span className="text-[11px] text-muted-foreground">{statusGroups.length} groups</span>
        </div>
        <div className="mt-3 space-y-2">
          {statusGroups.map((group) => (
            <div
              key={group.id}
              className={cn(
                "rounded-xl border px-3 py-3",
                selectedStatusGroup?.id === group.id
                  ? "border-border bg-background/90"
                  : "border-border/70 bg-background/70",
              )}
            >
              <p className="text-xs font-medium text-foreground">{group.summary}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {group.status} · {group.steps.length} steps · {group.timestamp}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Step drilldown</p>
          <span className="text-[11px] text-muted-foreground">
            {selectedStatusGroup?.steps.length ?? 0} steps
          </span>
        </div>
        {selectedStatusGroup ? (
          <div className="mt-3 space-y-3">
            <div className="rounded-xl border border-border/70 bg-background/70 p-4">
              <p className="text-sm font-medium text-foreground">{selectedStatusGroup.summary}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedStatusGroup.status} · {selectedStatusGroup.timestamp}
              </p>
              {selectedStatusGroup.agentLabel ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {selectedStatusGroup.agentLabel}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              {selectedStatusGroup.steps.map((step, index) => (
                <ChildSessionProcessStepCard key={`${selectedStatusGroup.id}:${step.id}:${step.timestamp}:${index}`} step={step} />
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm text-muted-foreground">
            选择一个 status group 查看 steps。
          </div>
        )}
      </div>
    </div>
  );
}

function ChildSessionProcessStepCard({ step }: { step: TurnProcessStep }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{step.label}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">
            {step.detail}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
          {step.status}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span>{step.timestamp}</span>
        <span>{step.eventType}</span>
        {step.contextLabel ? <span>{step.contextLabel}</span> : null}
        {step.toolId ? <span>{step.toolId}</span> : null}
        {step.agentId ? <span>{step.agentId}</span> : null}
      </div>
    </div>
  );
}

function timelineItemLabel(item: TurnTimelineItem) {
  switch (item.kind) {
    case "assistant_text":
      return "assistant text";
    case "final_text":
      return "final text";
    case "agent_message":
      return "agent message";
    case "status_group":
      return "status group";
    case "plan_update":
      return "plan update";
    case "artifact":
      return "artifact";
  }
}

function timelineItemSummary(item: TurnTimelineItem) {
  switch (item.kind) {
    case "assistant_text":
    case "final_text":
    case "agent_message":
      return item.content;
    case "status_group":
      return item.summary;
    case "plan_update":
      return item.summary;
    case "artifact":
      return item.summary;
  }
}

function SectionButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition",
        active
          ? "border-border bg-card text-foreground"
          : "border-border/70 bg-background/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function formatTimestamp(value: number | undefined) {
  if (!value) {
    return "No timestamp";
  }
  return new Date(value).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
