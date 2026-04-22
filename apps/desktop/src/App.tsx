import {
  Activity,
  AlertTriangle,
  Bot,
  Boxes,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Command,
  Download,
  FileText,
  GitFork,
  Layers3,
  MemoryStick,
  Network,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { createRuntimeClient, type OraPatternDefinition, type OraStateSnapshot } from "./lib/runtimeClient";
import { buildWorkbenchViewModel } from "./lib/viewModel";
import type {
  ActionRecord,
  AgentProfile,
  ArtifactRecord,
  CheckpointRecord,
  CoordinationPattern,
  DockTab,
  MemoryRecord,
  PatternCard,
  PlanItem,
  RuntimeBridgeStatus,
  RunBeat,
  RunStatus,
  SessionRun,
  StreamLine,
  TopologyEdge,
  TopologyNode,
} from "./types";

const dockTabs: DockTab[] = [
  "Overview",
  "State",
  "Profile",
  "Memory",
  "Plan",
  "Actions",
  "Approvals",
  "Checkpoints",
];

const statusLabels: Record<RunStatus, string> = {
  running: "Running",
  approval_required: "Approval",
  checkpointed: "Checkpoint",
  done: "Done",
  failed: "Failed",
};

const nodeTone: Record<TopologyNode["status"], string> = {
  active: "border-signal-acid bg-lime-50 shadow-[0_0_0_3px_rgba(155,216,46,0.16)]",
  idle: "border-bench-200 bg-white",
  blocked: "border-signal-amber bg-amber-50 shadow-[0_0_0_3px_rgba(215,153,33,0.14)]",
  done: "border-emerald-200 bg-emerald-50",
};

const beatTone: Record<RunBeat["group"], string> = {
  plan: "bg-bench-900",
  dispatch: "bg-slate-500",
  tool: "bg-stone-500",
  approval: "bg-signal-amber",
  checkpoint: "bg-signal-acid",
  retry: "bg-orange-500",
  error: "bg-signal-red",
  done: "bg-emerald-600",
};

export function App() {
  const [selectedPattern, setSelectedPattern] =
    useState<CoordinationPattern>("orchestrator_subagent");
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState("run");
  const [selectedTab, setSelectedTab] = useState<DockTab>("Overview");
  const [selectedBeatId, setSelectedBeatId] = useState<string>();
  const [filmstripExpanded, setFilmstripExpanded] = useState(false);
  const [composerPrompt, setComposerPrompt] = useState(
    "Implement a smoke run that proves Ora can switch patterns, expose topology, stream events, and checkpoint state.",
  );
  const [patterns, setPatterns] = useState<OraPatternDefinition[]>([]);
  const [snapshots, setSnapshots] = useState<OraStateSnapshot[]>([]);
  const [bridgeStatus, setBridgeStatus] = useState<RuntimeBridgeStatus>({
    mode: "initializing",
    ok: false,
    label: "Runtime",
    detail: "Connecting to the Ora runtime bridge.",
  });
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [commandFeedback, setCommandFeedback] = useState("Select a checkpoint or event to replay, fork, approve, or export.");
  const [busyCommand, setBusyCommand] = useState<string>();

  const runtimeClient = useMemo(() => createRuntimeClient(), []);

  useEffect(() => {
    let cancelled = false;

    runtimeClient
      .bootstrap()
      .then((bootstrap) => {
        if (cancelled) {
          return;
        }
        setPatterns(bootstrap.patterns);
        setSnapshots([bootstrap.snapshot]);
        setSelectedSessionId(bootstrap.snapshot.runId);
        setSelectedPattern(bootstrap.snapshot.pattern);
        setSelectedNodeId(bootstrap.snapshot.topology.nodes[1]?.id ?? bootstrap.snapshot.topology.nodes[0]?.id ?? "run");
        setSelectedBeatId(bootstrap.snapshot.events[2]?.id ?? bootstrap.snapshot.events[0]?.id);
        setBridgeStatus({
          mode: bootstrap.health.mode,
          ok: bootstrap.health.ok,
          label: bootstrap.health.service,
          detail: bootstrap.health.detail,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setBridgeStatus({
          mode: "error",
          ok: false,
          label: "Runtime error",
          detail: error instanceof Error ? error.message : "Runtime bridge failed to initialize.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [runtimeClient]);

  const viewModel = useMemo(() => {
    if (patterns.length === 0 || snapshots.length === 0) {
      return undefined;
    }
    return buildWorkbenchViewModel(patterns, snapshots, selectedPattern, selectedSessionId);
  }, [patterns, snapshots, selectedPattern, selectedSessionId]);

  const selectedSession = viewModel?.sessions.find((session) => session.id === selectedSessionId) ?? viewModel?.sessions[0];
  const selectedNode = viewModel?.topologyNodes.find((node) => node.id === selectedNodeId) ?? viewModel?.topologyNodes[0];
  const selectedBeat = viewModel?.beats.find((beat) => beat.id === selectedBeatId) ?? viewModel?.beats[0];
  const selectedAgent =
    viewModel?.agents.find((agent) => agent.id === selectedNode?.agentId) ??
    viewModel?.agents.find((agent) => agent.id === selectedBeat?.agentId) ??
    viewModel?.agents[0];
  const selectedCheckpoint =
    viewModel?.checkpoints.find((checkpoint) => checkpoint.id === selectedBeat?.checkpointId) ?? viewModel?.checkpoints[0];

  function replaceSnapshot(snapshot: OraStateSnapshot) {
    setSnapshots((current) => [snapshot, ...current.filter((item) => item.runId !== snapshot.runId)]);
    setSelectedSessionId(snapshot.runId);
  }

  async function startRun() {
    setIsStartingRun(true);
    try {
      const snapshot = await runtimeClient.startRun(
        {
          prompt: composerPrompt,
          projectId: "ora-mvp",
          context: { source: "desktop-workbench" },
        },
        { pattern: selectedPattern },
      );
      replaceSnapshot(snapshot);
      setSelectedNodeId(snapshot.topology.nodes[1]?.id ?? snapshot.topology.nodes[0]?.id ?? "run");
      setSelectedBeatId(snapshot.events[0]?.id);
      setCommandFeedback("Started a contract-backed smoke run and refreshed workbench state.");
      const health = runtimeClient.getHealth();
      if (health) {
        setBridgeStatus({
          mode: health.mode,
          ok: health.ok,
          label: health.service,
          detail: health.detail,
        });
      }
    } catch (error) {
      setBridgeStatus({
        mode: "error",
        ok: false,
        label: "Run failed",
        detail: error instanceof Error ? error.message : "Unable to start run.",
      });
    } finally {
      setIsStartingRun(false);
    }
  }

  async function runSnapshotCommand(command: string, action: () => Promise<OraStateSnapshot>) {
    setBusyCommand(command);
    try {
      const snapshot = await action();
      replaceSnapshot(snapshot);
      setSelectedBeatId(snapshot.events.at(-1)?.id ?? selectedBeatId);
      setCommandFeedback(`${command} completed against ${snapshot.runId}.`);
    } catch (error) {
      setCommandFeedback(error instanceof Error ? error.message : `${command} failed.`);
    } finally {
      setBusyCommand(undefined);
    }
  }

  async function interruptRun() {
    if (!selectedSession) {
      return;
    }
    await runSnapshotCommand("Interrupt", () => runtimeClient.interruptRun(selectedSession.id, "Interrupted from Operator Workbench."));
  }

  async function resumeRun() {
    if (!selectedSession) {
      return;
    }
    await runSnapshotCommand("Approve", () =>
      runtimeClient.resumeRun(selectedSession.id, "Approved sidecar action from Context Dock.", {
        approvedActionIds: viewModel?.actions.filter((action) => action.state === "approval_required").map((action) => action.id) ?? [],
      }),
    );
  }

  async function cancelRun() {
    if (!selectedSession) {
      return;
    }
    await runSnapshotCommand("Cancel", () => runtimeClient.cancelRun(selectedSession.id));
  }

  async function forkRun() {
    if (!selectedSession || !selectedCheckpoint) {
      setCommandFeedback("Select a checkpoint before forking.");
      return;
    }
    await runSnapshotCommand("Fork", () =>
      runtimeClient.forkRun(
        selectedSession.id,
        selectedCheckpoint.id,
        { pattern: selectedPattern, metadata: { source: "desktop-workbench" } },
        { context: { selectedEventId: selectedBeat?.id, selectedEventSeq: selectedBeat?.eventSeq } },
      ),
    );
  }

  async function replaySelection() {
    if (!selectedSession || !selectedBeat) {
      return;
    }
    setBusyCommand("Replay");
    try {
      const stream = await runtimeClient.streamRun(selectedSession.id, Math.max(0, selectedBeat.eventSeq - 1));
      const firstEvent = stream.events[0];
      if (firstEvent) {
        setSelectedBeatId(firstEvent.id);
      }
      setCommandFeedback(`Replay loaded ${stream.events.length} event${stream.events.length === 1 ? "" : "s"} from ${selectedBeat.label}.`);
    } catch (error) {
      setCommandFeedback(error instanceof Error ? error.message : "Replay failed.");
    } finally {
      setBusyCommand(undefined);
    }
  }

  async function exportReport() {
    if (!selectedSession) {
      return;
    }
    setBusyCommand("Report");
    try {
      const { artifact, snapshot } = await runtimeClient.exportReport(selectedSession.id);
      replaceSnapshot(snapshot);
      setSelectedBeatId(snapshot.events.at(-1)?.id ?? selectedBeatId);
      setCommandFeedback(`Exported ${artifact.label} as ${artifact.mimeType}.`);
    } catch (error) {
      setCommandFeedback(error instanceof Error ? error.message : "Report export failed.");
    } finally {
      setBusyCommand(undefined);
    }
  }

  if (!viewModel || !selectedSession || !selectedNode || !selectedBeat || !selectedAgent) {
    return (
      <main className="flex h-screen min-h-[760px] items-center justify-center bg-bench-100 text-bench-900 antialiased">
        <div className="rounded-lg bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
          <p className="text-sm font-semibold">{bridgeStatus.label}</p>
          <p className="mt-2 max-w-sm text-xs leading-5 text-bench-700">{bridgeStatus.detail}</p>
        </div>
      </main>
    );
  }

  const {
    actions,
    agents,
    artifacts,
    beats,
    checkpoints,
    memoryRecords,
    patternCards,
    planItems,
    sessions,
    streamLines,
    topologyEdges,
    topologyNodes,
    activePattern,
  } = viewModel;

  return (
    <main className="flex h-screen min-h-[760px] bg-bench-100 text-bench-900 antialiased">
      <LeftRail />
      <section
        className={`grid min-w-0 flex-1 grid-cols-[280px_minmax(540px,1fr)_360px] gap-px bg-bench-200 ${
          filmstripExpanded ? "grid-rows-[minmax(0,1fr)_220px]" : "grid-rows-[minmax(0,1fr)_132px]"
        }`}
      >
        <SessionColumn
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
        />
        <Workspace
          activePattern={activePattern}
          bridgeStatus={bridgeStatus}
          busyCommand={busyCommand}
          commandFeedback={commandFeedback}
          composerPrompt={composerPrompt}
          isStartingRun={isStartingRun}
          patternCards={patternCards}
          selectedPattern={selectedPattern}
          selectedNodeId={selectedNodeId}
          streamLines={streamLines}
          topologyEdges={topologyEdges}
          topologyNodes={topologyNodes}
          onCancelRun={cancelRun}
          onComposerPromptChange={setComposerPrompt}
          onExportReport={exportReport}
          onForkRun={forkRun}
          onInterruptRun={interruptRun}
          onReplaySelection={replaySelection}
          onResumeRun={resumeRun}
          onSelectPattern={setSelectedPattern}
          onSelectNode={setSelectedNodeId}
          onStartRun={startRun}
        />
        <ContextDock
          actions={actions}
          agents={agents}
          artifacts={artifacts}
          busyCommand={busyCommand}
          checkpoints={checkpoints}
          commandFeedback={commandFeedback}
          memoryRecords={memoryRecords}
          planItems={planItems}
          selectedAgent={selectedAgent}
          selectedBeat={selectedBeat}
          selectedCheckpoint={selectedCheckpoint}
          selectedNode={selectedNode}
          selectedSession={selectedSession}
          selectedTab={selectedTab}
          onCancelRun={cancelRun}
          onExportReport={exportReport}
          onForkRun={forkRun}
          onReplaySelection={replaySelection}
          onResumeRun={resumeRun}
          onSelectTab={setSelectedTab}
        />
        <RunFilmstrip
          beats={beats}
          expanded={filmstripExpanded}
          selectedBeatId={selectedBeatId}
          onSelectBeat={setSelectedBeatId}
          onToggleExpanded={() => setFilmstripExpanded((expanded) => !expanded)}
        />
      </section>
    </main>
  );
}

function LeftRail() {
  const items = [
    { label: "Sessions", icon: Activity, active: true },
    { label: "Patterns", icon: Boxes },
    { label: "Agents", icon: Bot },
    { label: "Tools", icon: Wrench },
    { label: "Memory", icon: Brain },
    { label: "Settings", icon: Settings },
  ];

  return (
    <aside className="flex w-[76px] shrink-0 flex-col items-center border-r border-bench-200 bg-bench-50 py-4">
      <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md bg-bench-900 text-bench-50 shadow-pane">
        <Command size={20} />
      </div>
      <nav className="flex flex-1 flex-col items-center gap-2">
        {items.map(({ label, icon: Icon, active }) => (
          <button
            key={label}
            aria-label={label}
            className={`group relative flex h-11 w-11 items-center justify-center rounded-md transition duration-150 hover:bg-white hover:shadow-pane active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-amber ${
              active ? "bg-white text-bench-900 shadow-pane" : "text-bench-700"
            }`}
            title={label}
          >
            {active ? <span className="absolute left-[-17px] h-7 w-1 rounded-r bg-signal-acid" /> : null}
            <Icon size={20} strokeWidth={1.8} />
          </button>
        ))}
      </nav>
      <div className="h-2 w-2 rounded-full bg-signal-acid shadow-[0_0_0_4px_rgba(155,216,46,0.18)]" />
    </aside>
  );
}

function SessionColumn({
  sessions,
  selectedSessionId,
  onSelectSession,
}: {
  sessions: SessionRun[];
  selectedSessionId?: string;
  onSelectSession: (id: string) => void;
}) {
  return (
    <aside className="row-span-2 flex min-w-0 flex-col bg-bench-50">
      <div className="border-b border-bench-200 px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Project</p>
            <h1 className="mt-1 text-lg font-semibold leading-tight">Ora MVP</h1>
          </div>
          <button className="rounded-md border border-bench-200 bg-white p-2 text-bench-700 shadow-sm transition hover:text-bench-900 active:scale-95">
            <SlidersHorizontal size={17} />
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-md border border-bench-200 bg-white px-3 py-2 text-sm text-bench-700">
          <Search size={15} />
          <span>Search runs, workers, checkpoints</span>
        </div>
      </div>

      <div className="border-b border-bench-200 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {["All", "Running", "Blocked", "Forkable"].map((filter, index) => (
            <button
              key={filter}
              className={`rounded-full px-3 py-1 text-xs font-medium transition active:scale-95 ${
                index === 1
                  ? "bg-bench-900 text-bench-50"
                  : "bg-white text-bench-700 ring-1 ring-inset ring-bench-200 hover:text-bench-900"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-semibold text-bench-700">Recent runs</p>
          <ChevronDown size={15} className="text-bench-700" />
        </div>
        <div className="space-y-2">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={`w-full rounded-lg p-3 text-left transition duration-150 active:scale-[0.99] ${
                selectedSessionId === session.id
                  ? "bg-white shadow-pane ring-1 ring-inset ring-bench-200"
                  : "hover:bg-white/70"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{session.title}</p>
                  <p className="mt-1 truncate text-xs text-bench-700">{session.project}</p>
                </div>
                <StatusPill status={session.status} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-bench-700">
                <span className="font-mono">{session.id}</span>
                <span>{session.updatedAt}</span>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-bench-200">
                <div
                  className="h-1.5 rounded-full bg-signal-acid"
                  style={{ width: `${session.health}%` }}
                />
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-bench-200 p-4">
        <div className="rounded-lg bg-white p-3 shadow-pane">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MemoryStick size={16} />
            Project context
          </div>
          <p className="mt-2 text-xs leading-5 text-bench-700">
            Local-first Mac app. Pattern, profile, memory, plan, action, policy, topology, and
            event abstractions stay Ora-owned.
          </p>
        </div>
      </div>
    </aside>
  );
}

function Workspace({
  activePattern,
  bridgeStatus,
  busyCommand,
  commandFeedback,
  composerPrompt,
  isStartingRun,
  patternCards,
  selectedPattern,
  selectedNodeId,
  streamLines,
  topologyEdges,
  topologyNodes,
  onCancelRun,
  onComposerPromptChange,
  onExportReport,
  onForkRun,
  onInterruptRun,
  onReplaySelection,
  onResumeRun,
  onSelectPattern,
  onSelectNode,
  onStartRun,
}: {
  activePattern: PatternCard;
  bridgeStatus: RuntimeBridgeStatus;
  busyCommand?: string;
  commandFeedback: string;
  composerPrompt: string;
  isStartingRun: boolean;
  patternCards: PatternCard[];
  selectedPattern: CoordinationPattern;
  selectedNodeId: string;
  streamLines: StreamLine[];
  topologyEdges: TopologyEdge[];
  topologyNodes: TopologyNode[];
  onCancelRun: () => void;
  onComposerPromptChange: (prompt: string) => void;
  onExportReport: () => void;
  onForkRun: () => void;
  onInterruptRun: () => void;
  onReplaySelection: () => void;
  onResumeRun: () => void;
  onSelectPattern: (pattern: CoordinationPattern) => void;
  onSelectNode: (id: string) => void;
  onStartRun: () => void;
}) {
  return (
    <section className="flex min-w-0 flex-col bg-bench-100">
      <div className="border-b border-bench-200 bg-bench-50 px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">
              Operator Workbench
            </p>
            <h2 className="mt-1 text-xl font-semibold">Coordinate observable agent runs</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onInterruptRun}
              disabled={busyCommand !== undefined}
              className="inline-flex items-center gap-2 rounded-md border border-bench-200 bg-white px-3 py-2 text-sm font-medium shadow-sm transition hover:shadow-pane active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Pause size={16} />
              Interrupt
            </button>
            <button
              onClick={onStartRun}
              disabled={isStartingRun || busyCommand !== undefined}
              className="inline-flex items-center gap-2 rounded-md bg-bench-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-pane active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play size={16} />
              {isStartingRun ? "Starting" : "Start run"}
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-white p-3 shadow-pane ring-1 ring-inset ring-bench-200">
          <div className="flex items-start gap-3">
            <div className="mt-1 rounded-md bg-bench-100 p-2 text-bench-700">
              <FileText size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor="task-composer" className="text-xs font-semibold text-bench-700">
                Task composer
              </label>
              <textarea
                id="task-composer"
                className="mt-1 min-h-[66px] w-full resize-none border-0 bg-transparent text-sm leading-6 outline-none placeholder:text-bench-700"
                value={composerPrompt}
                onChange={(event) => onComposerPromptChange(event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-bench-700">
          <span
            className={`h-2 w-2 rounded-full ${
              bridgeStatus.ok ? "bg-signal-acid" : "bg-signal-red"
            }`}
          />
          <span className="font-semibold">{bridgeStatus.label}</span>
            <span className="truncate">{bridgeStatus.detail}</span>
        </div>
        <div className="mt-2 rounded-md bg-bench-100 px-3 py-2 text-xs text-bench-700">
          {busyCommand ? `${busyCommand} in progress.` : commandFeedback}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Pattern switcher</h3>
              <p className="text-xs text-bench-700">Preview topology and policy before execution.</p>
            </div>
            <span className="rounded-full bg-lime-50 px-3 py-1 text-xs font-semibold text-bench-900 ring-1 ring-inset ring-lime-200">
              Default: Orchestrator
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {patternCards.map((pattern) => (
              <button
                key={pattern.id}
                onClick={() => onSelectPattern(pattern.id)}
                className={`rounded-lg bg-white p-3 text-left shadow-sm ring-1 ring-inset transition duration-150 hover:shadow-pane active:scale-[0.99] ${
                  selectedPattern === pattern.id ? "ring-signal-acid" : "ring-bench-200"
                }`}
              >
                <PatternPreview pattern={pattern.id} active={selectedPattern === pattern.id} />
                <div className="mt-3 flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-5">{pattern.label}</p>
                  {pattern.id === "orchestrator_subagent" ? (
                    <span className="rounded-full bg-bench-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      Default
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-5 text-bench-700">{pattern.recommendedUse}</p>
                <div className="mt-3 space-y-1 border-t border-bench-200 pt-3 text-[11px] leading-4 text-bench-700">
                  <p>
                    <span className="font-semibold text-bench-900">Failure:</span> {pattern.failureMode}
                  </p>
                  <p>
                    <span className="font-semibold text-bench-900">Policy:</span> {pattern.constraints}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-5 grid grid-cols-[minmax(360px,1fr)_320px] gap-4">
          <div className="rounded-lg bg-white p-4 shadow-pane ring-1 ring-inset ring-bench-200">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Topology canvas</h3>
                <p className="text-xs text-bench-700">{activePattern.label} graph preview</p>
              </div>
              <Network size={18} className="text-bench-700" />
            </div>
            <TopologyCanvas
              selectedNodeId={selectedNodeId}
              topologyEdges={topologyEdges}
              topologyNodes={topologyNodes}
              onSelectNode={onSelectNode}
            />
          </div>

          <div className="rounded-lg bg-white p-4 shadow-pane ring-1 ring-inset ring-bench-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Run controls</h3>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-bench-900 ring-1 ring-inset ring-amber-200">
                1 approval
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                { label: "Pause", icon: Pause, action: onInterruptRun },
                { label: "Cancel", icon: Square, action: onCancelRun },
                { label: "Fork", icon: GitFork, action: onForkRun },
                { label: "Replay", icon: RotateCcw, action: onReplaySelection },
                { label: "Approve", icon: ShieldCheck, action: onResumeRun },
                { label: "Report", icon: Download, action: onExportReport },
              ].map(({ label, icon: Icon, action }) => (
                <button
                  key={label}
                  onClick={action}
                  disabled={busyCommand !== undefined}
                  className="flex h-16 flex-col items-center justify-center gap-1 rounded-md border border-bench-200 bg-bench-50 text-xs font-semibold transition hover:bg-white hover:shadow-sm active:scale-95"
                >
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-md bg-bench-100 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle size={16} className="text-signal-amber" />
                Sidecar spawn blocked
              </div>
              <p className="mt-2 text-xs leading-5 text-bench-700">
                Future runtime launch uses a Rust approval gate before any local process gets workspace
                authority.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-lg bg-bench-900 p-4 text-bench-50 shadow-pane">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Streamed output</h3>
              <p className="text-xs text-bench-300">Ora event envelopes adapted from runtime streams</p>
            </div>
            <TerminalSquare size={18} className="text-signal-acid" />
          </div>
          <div className="space-y-2 font-mono text-xs leading-5">
            {streamLines.map((line) => (
              <div key={line.text} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 rounded bg-white/5 px-3 py-2">
                <span className="text-signal-acid">{line.source}</span>
                <span className="min-w-0 text-bench-100">{line.text}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function PatternPreview({ pattern, active }: { pattern: CoordinationPattern; active: boolean }) {
  const tone = active ? "bg-signal-acid" : "bg-bench-300";

  if (pattern === "generator_verifier") {
    return (
      <div className="flex h-10 items-center gap-2">
        <span className={`h-6 w-6 rounded ${tone}`} />
        <span className="h-px flex-1 bg-bench-300" />
        <span className="h-6 w-6 rounded border border-bench-300 bg-white" />
      </div>
    );
  }

  if (pattern === "agent_teams") {
    return (
      <div className="grid h-10 grid-cols-4 items-center gap-2">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={`h-6 rounded ${index === 0 ? tone : "bg-bench-200"}`} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-10 items-center gap-2">
      <span className={`h-7 w-7 rounded ${tone}`} />
      <span className="h-px flex-1 bg-bench-300" />
      <span className="h-5 w-5 rounded bg-bench-200" />
      <span className="h-5 w-5 rounded bg-bench-200" />
    </div>
  );
}

function TopologyCanvas({
  selectedNodeId,
  topologyEdges,
  topologyNodes,
  onSelectNode,
}: {
  selectedNodeId: string;
  topologyEdges: TopologyEdge[];
  topologyNodes: TopologyNode[];
  onSelectNode: (id: string) => void;
}) {
  return (
    <div className="relative h-[260px] overflow-hidden rounded-md bg-bench-50 ring-1 ring-inset ring-bench-200">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 780 250" aria-hidden="true">
        {topologyEdges.map((edge) => {
          const from = topologyNodes.find((node) => node.id === edge.from)!;
          const to = topologyNodes.find((node) => node.id === edge.to)!;
          return (
            <g key={`${edge.from}-${edge.to}`}>
              <line
                x1={from.x + 58}
                y1={from.y + 28}
                x2={to.x + 58}
                y2={to.y + 28}
                stroke="#d2d2c7"
                strokeWidth="2"
              />
              <text
                x={(from.x + to.x) / 2 + 58}
                y={(from.y + to.y) / 2 + 22}
                textAnchor="middle"
                className="fill-bench-700 text-[11px]"
              >
                {edge.label}
              </text>
            </g>
          );
        })}
      </svg>
      {topologyNodes.map((node) => (
        <button
          key={node.id}
          onClick={() => onSelectNode(node.id)}
          className={`absolute w-[124px] rounded-md border p-2 text-left transition duration-150 hover:shadow-lift active:scale-[0.98] ${
            nodeTone[node.status]
          } ${selectedNodeId === node.id ? "outline outline-2 outline-offset-2 outline-bench-900" : ""}`}
          style={{ left: node.x, top: node.y }}
        >
          <div className="flex items-center gap-2">
            <CircleDot size={13} className={node.status === "active" ? "text-signal-acid" : "text-bench-700"} />
            <span className="truncate text-xs font-semibold">{node.label}</span>
          </div>
          <p className="mt-1 truncate text-[11px] text-bench-700">{node.role}</p>
        </button>
      ))}
    </div>
  );
}

function ContextDock({
  actions,
  agents,
  artifacts,
  busyCommand,
  checkpoints,
  commandFeedback,
  memoryRecords,
  planItems,
  selectedAgent,
  selectedBeat,
  selectedCheckpoint,
  selectedNode,
  selectedSession,
  selectedTab,
  onCancelRun,
  onExportReport,
  onForkRun,
  onReplaySelection,
  onResumeRun,
  onSelectTab,
}: {
  actions: ActionRecord[];
  agents: AgentProfile[];
  artifacts: ArtifactRecord[];
  busyCommand?: string;
  checkpoints: CheckpointRecord[];
  commandFeedback: string;
  memoryRecords: MemoryRecord[];
  planItems: PlanItem[];
  selectedAgent: AgentProfile;
  selectedBeat: RunBeat;
  selectedCheckpoint?: CheckpointRecord;
  selectedNode: TopologyNode;
  selectedSession: SessionRun;
  selectedTab: DockTab;
  onCancelRun: () => void;
  onExportReport: () => void;
  onForkRun: () => void;
  onReplaySelection: () => void;
  onResumeRun: () => void;
  onSelectTab: (tab: DockTab) => void;
}) {
  const approvals = actions.filter((action) => action.state === "approval_required");
  const nextAction = approvals[0];
  const scopedMemory = memoryRecords.filter((record) =>
    selectedAgent.memoryScopes.some((scope) => record.namespace.startsWith(scope)),
  );
  const selectedPlanItems = planItems.filter((item) => item.owner === (selectedNode.agentId ?? selectedAgent.id));

  return (
    <aside className="row-span-2 flex min-w-0 flex-col bg-bench-50">
      <div className="border-b border-bench-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Context Dock</p>
            <h2 className="mt-1 truncate text-lg font-semibold">{selectedNode.label}</h2>
            <p className="mt-1 text-xs text-bench-700">{selectedNode.role} selected</p>
          </div>
          <div className="rounded-md bg-amber-50 p-2 text-signal-amber ring-1 ring-inset ring-amber-200">
            <ShieldCheck size={18} />
          </div>
        </div>
        <div className="mt-4 rounded-lg bg-white p-3 shadow-pane">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{nextAction ? "Approval blocked" : "Selected event"}</p>
              <p className="mt-1 text-xs text-bench-700">
                {nextAction ? nextAction.label : `${selectedBeat.label} at ${selectedBeat.time}`}
              </p>
            </div>
            <button
              onClick={nextAction ? onResumeRun : onReplaySelection}
              disabled={busyCommand !== undefined}
              className="rounded-md bg-signal-amber px-3 py-2 text-xs font-semibold text-bench-900 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {nextAction ? "Approve" : "Replay"}
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-bench-200 px-3 py-3">
        <div className="grid grid-cols-4 gap-1">
          {dockTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => onSelectTab(tab)}
              className={`rounded px-2 py-1.5 text-[11px] font-semibold transition active:scale-95 ${
                selectedTab === tab ? "bg-bench-900 text-white" : "text-bench-700 hover:bg-white"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {selectedTab === "Overview" ? (
          <div className="space-y-3">
            <MetricRow label="Run" value={selectedSession.title} />
            <MetricRow label="Pattern" value={selectedSession.pattern.replace(/_/g, " ")} />
            <MetricRow label="Health" value={`${selectedSession.health}%`} />
            <MetricRow label="Selected beat" value={`${selectedBeat.label} · ${selectedBeat.time}`} />
            <DockCard title="Control result" icon={<Activity size={16} />}>
              <p>{commandFeedback}</p>
            </DockCard>
          </div>
        ) : null}

        {selectedTab === "State" ? (
          <div className="space-y-3">
            <DockCard title={selectedNode.label} icon={<CircleDot size={16} />}>
              <p>{selectedNode.role}</p>
              <p className="mt-2 font-mono text-[11px]">node:{selectedNode.id}</p>
              <p className="mt-1 font-mono text-[11px]">status:{selectedNode.status}</p>
            </DockCard>
            <DockCard title={selectedBeat.label} icon={<Layers3 size={16} />}>
              <p>{selectedBeat.detail}</p>
              <p className="mt-2 font-mono text-[11px]">
                seq:{selectedBeat.eventSeq} type:{selectedBeat.eventType}
              </p>
            </DockCard>
          </div>
        ) : null}

        {selectedTab === "Profile" ? (
          <div className="space-y-3">
            <DockCard title={selectedAgent.label} icon={<Bot size={16} />}>
              <p>{selectedAgent.role}</p>
              <p className="mt-2 font-mono text-[11px]">{selectedAgent.model}</p>
            </DockCard>
            <DockCard title="Tools" icon={<Wrench size={16} />}>
              <div className="flex flex-wrap gap-2">
                {selectedAgent.tools.map((tool) => (
                  <span key={tool} className="rounded-full bg-bench-100 px-2 py-1 font-mono text-[11px]">
                    {tool}
                  </span>
                ))}
              </div>
            </DockCard>
            <DockCard title="Budget" icon={<SlidersHorizontal size={16} />}>
              <p>{selectedAgent.budget}</p>
            </DockCard>
          </div>
        ) : null}

        {selectedTab === "Memory" ? (
          <div className="space-y-2">
            {(scopedMemory.length > 0 ? scopedMemory : memoryRecords).map((record) => (
              <DockCard key={record.id} title={record.namespace} icon={<Brain size={16} />}>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-bench-100 px-2 py-0.5 font-mono text-[11px]">{record.kind}</span>
                  <span className="font-mono text-[11px]">{record.updatedAt}</span>
                </div>
                <p className="mt-2">{record.value}</p>
              </DockCard>
            ))}
          </div>
        ) : null}

        {selectedTab === "Plan" ? (
          <div className="space-y-2">
            {(selectedPlanItems.length > 0 ? selectedPlanItems : planItems).map((item) => (
              <div key={item.id} className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-inset ring-bench-200">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-5">{item.title}</p>
                  <span className="rounded-full bg-bench-100 px-2 py-0.5 text-[11px] font-semibold">
                    {item.status}
                  </span>
                </div>
                <p className="mt-2 text-xs text-bench-700">
                  {item.owner} · {item.checkpoint}
                </p>
                {item.linkedActions.length > 0 ? (
                  <p className="mt-1 font-mono text-[11px] text-bench-700">{item.linkedActions.join(", ")}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {selectedTab === "Actions" || selectedTab === "Approvals" ? (
          <div className="space-y-2">
            {(selectedTab === "Approvals" ? approvals : actions).map((action) => (
              <div
                key={action.id}
                className={`rounded-lg p-3 ring-1 ring-inset ${
                  action.state === "approval_required"
                    ? "bg-amber-50 ring-amber-200"
                    : "bg-white ring-bench-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{action.label}</p>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold shadow-sm">
                    {action.state}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-bench-700">{action.consequence}</p>
                <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-bench-700">
                  <span className="font-mono">risk:{action.risk}</span>
                  <span className="font-mono">{action.agentId ?? "runtime"}</span>
                </div>
                {action.state === "approval_required" ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={onResumeRun}
                      disabled={busyCommand !== undefined}
                      className="rounded-md bg-signal-amber px-3 py-2 text-xs font-semibold text-bench-900 transition active:scale-95 disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      onClick={onCancelRun}
                      disabled={busyCommand !== undefined}
                      className="rounded-md border border-bench-200 bg-white px-3 py-2 text-xs font-semibold transition active:scale-95 disabled:opacity-60"
                    >
                      Deny
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {selectedTab === "Approvals" && approvals.length === 0 ? (
              <DockCard title="No approval gate" icon={<ShieldCheck size={16} />}>
                <p>Select an action beat or interrupt a run to inspect approval state here.</p>
              </DockCard>
            ) : null}
          </div>
        ) : null}

        {selectedTab === "Checkpoints" ? (
          <div className="space-y-3">
            <DockCard title={selectedCheckpoint?.label ?? selectedBeat.label} icon={<Clock3 size={16} />}>
              <p>{selectedBeat.detail}</p>
              <p className="mt-2 font-mono text-[11px]">
                {selectedCheckpoint ? `checkpoint:${selectedCheckpoint.id}` : `event:${selectedBeat.id}`}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  onClick={onForkRun}
                  disabled={busyCommand !== undefined || !selectedCheckpoint}
                  className="rounded-md bg-bench-900 px-3 py-2 text-xs font-semibold text-white transition active:scale-95 disabled:opacity-60"
                >
                  Fork
                </button>
                <button
                  onClick={onReplaySelection}
                  disabled={busyCommand !== undefined}
                  className="rounded-md border border-bench-200 bg-white px-3 py-2 text-xs font-semibold transition active:scale-95 disabled:opacity-60"
                >
                  Replay
                </button>
                <button
                  onClick={onExportReport}
                  disabled={busyCommand !== undefined}
                  className="rounded-md border border-bench-200 bg-white px-3 py-2 text-xs font-semibold transition active:scale-95 disabled:opacity-60"
                >
                  Report
                </button>
              </div>
            </DockCard>
            {checkpoints.map((checkpoint) => (
              <div
                key={checkpoint.id}
                className={`rounded-lg bg-white p-3 text-xs shadow-sm ring-1 ring-inset ${
                  checkpoint.id === selectedCheckpoint?.id ? "ring-bench-900" : "ring-bench-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{checkpoint.label}</p>
                  <span className="font-mono text-bench-700">seq:{checkpoint.eventSeq}</span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-bench-700">{checkpoint.stateHash ?? "state hash pending"}</p>
              </div>
            ))}
            {artifacts.length > 0 ? (
              <DockCard title="Reports" icon={<FileText size={16} />}>
                <div className="space-y-2">
                  {artifacts.map((artifact) => (
                    <div key={artifact.id} className="rounded-md bg-bench-100 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-bench-900">{artifact.label}</span>
                        <span className="font-mono text-[11px]">{artifact.kind}</span>
                      </div>
                      <p className="mt-1 font-mono text-[11px]">{artifact.mimeType}</p>
                    </div>
                  ))}
                </div>
              </DockCard>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function RunFilmstrip({
  beats,
  expanded,
  selectedBeatId,
  onSelectBeat,
  onToggleExpanded,
}: {
  beats: RunBeat[];
  expanded: boolean;
  selectedBeatId?: string;
  onSelectBeat: (id: string) => void;
  onToggleExpanded: () => void;
}) {
  return (
    <footer className="col-span-2 flex min-w-0 flex-col bg-bench-50">
      <div className="flex items-center justify-between border-b border-bench-200 px-4 py-2">
        <div className="flex items-center gap-2">
          <Layers3 size={17} />
          <h2 className="text-sm font-semibold">Run Filmstrip</h2>
          <span className="rounded-full bg-bench-100 px-2 py-0.5 text-xs text-bench-700">
            grouped beats
          </span>
        </div>
        <button
          onClick={onToggleExpanded}
          className="rounded-md border border-bench-200 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm transition active:scale-95"
        >
          {expanded ? "Compact trace" : "Expand trace"}
        </button>
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto px-4 py-3">
        <div className="flex min-w-max items-stretch gap-2">
          {beats.map((beat) => (
            <button
              key={beat.id}
              onClick={() => onSelectBeat(beat.id)}
              className={`flex w-[170px] flex-col rounded-lg bg-white p-3 text-left shadow-sm ring-1 ring-inset transition hover:shadow-pane active:scale-[0.99] ${
                selectedBeatId === beat.id ? "ring-bench-900" : "ring-bench-200"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${beatTone[beat.group]}`} />
                <span className="font-mono text-[11px] text-bench-700">
                  {beat.time} · #{beat.eventSeq}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold">{beat.label}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-bench-700">
                {beat.checkpointId ?? beat.eventType}
              </p>
              <p className={`${expanded ? "line-clamp-none" : "line-clamp-1"} mt-1 text-xs leading-5 text-bench-700`}>
                {beat.detail}
              </p>
            </button>
          ))}
        </div>
      </div>
    </footer>
  );
}

function StatusPill({ status }: { status: RunStatus }) {
  const attention = status === "running" || status === "approval_required";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        attention ? "bg-amber-50 text-bench-900 ring-1 ring-inset ring-amber-200" : "bg-bench-100 text-bench-700"
      }`}
    >
      {statusLabels[status]}
    </span>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-inset ring-bench-200">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-bench-700">{label}</p>
      <p className="mt-1 text-sm font-semibold capitalize leading-5">{value}</p>
    </div>
  );
}

function DockCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white p-3 text-xs leading-5 text-bench-700 shadow-sm ring-1 ring-inset ring-bench-200">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-bench-900">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
