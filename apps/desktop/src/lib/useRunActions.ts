import { useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import { DEFAULT_WEB_TOOL_IDS } from "@cemeworm/shared";
import { USER_CANCELLED_MESSAGE, USER_INTERRUPTED_MESSAGE, USER_RESUMED_MESSAGE, getSharedRuntimeClient, type OraProjectSummary, type OraProviderConfig, type OraSessionBranchGroupCreateParams, type OraSessionDetail, type OraSessionSummary, type OraStateSnapshot } from "./runtimeClient";
import { buildRunSearchConfig } from "./searchSettings";
import { loadDesktopToolModelSettings } from "./toolModelSettings";
import { useWorkbench, type ComposerLocalFileAttachment, type ComposerProjectFileAttachment, type WorkbenchState } from "./state";
import { buildWorkbenchViewModel } from "./viewModel";

const PROJECT_CHAT_SAFE_TOOL_IDS = ["file.read", "file.list", "file.glob", "file.grep"];

const FILE_MODIFICATION_TOOL_IDS = [
  "file.write",
  "file.patch",
  "file.delete",
  "shell.execute",
  "skills.create",
  "skills.update",
  "skills.setEnabled",
  "package.buildCandidate",
  "package.verify",
  "package.promote",
  "package.switch",
  "package.rollback",
  "modes.applyDraft",
  "selfIteration.apply",
  "mcp.call",
];

type DesktopLatencyMark = NonNullable<OraStateSnapshot["latency"]>["marks"][number];
export const ACCEPTED_PLAN_IMPLEMENT_PROMPT = "请按照上述计划开始执行";

export function shouldEnableProgressNarration(taskIntent: WorkbenchState["taskIntent"]): boolean {
  return taskIntent === "implement";
}

export function acceptedPlanImplementationSubmission(): {
  prompt: string;
  taskIntent: WorkbenchState["taskIntent"];
} {
  return {
    prompt: ACCEPTED_PLAN_IMPLEMENT_PROMPT,
    taskIntent: "implement",
  };
}

function toolIdsForRun(modeToolIds: readonly string[] | undefined, projectId: string | undefined): string[] {
  const toolIds = [...new Set(modeToolIds ?? [])];
  if (!projectId) {
    return toolIds;
  }
  return [...new Set([...toolIds, ...PROJECT_CHAT_SAFE_TOOL_IDS])];
}

function modeDisablesDefaultWebTools(modeToolIds: readonly string[] | undefined): boolean {
  if (!modeToolIds) {
    return false;
  }
  const ids = new Set(modeToolIds ?? []);
  return DEFAULT_WEB_TOOL_IDS.some((toolId) => !ids.has(toolId));
}

function desktopLatencyMark(name: string, at = Date.now(), detail: Record<string, unknown> = {}): DesktopLatencyMark {
  return {
    name,
    at,
    source: "desktop",
    detail,
  };
}

function appendDesktopLatencyMarks(snapshot: OraStateSnapshot, marks: readonly DesktopLatencyMark[]): OraStateSnapshot {
  if (marks.length === 0) {
    return snapshot;
  }
  const existing = snapshot.latency?.marks ?? [];
  return {
    ...snapshot,
    latency: { marks: [...existing, ...marks] },
  };
}

export function buildDesktopRunContext(
  projectFileAttachments: readonly ComposerProjectFileAttachment[] = [],
  localFileAttachments: readonly ComposerLocalFileAttachment[] = [],
): Record<string, unknown> {
  return {
    source: "desktop-workbench",
    ...(projectFileAttachments.length > 0
      ? {
          attachedProjectFiles: projectFileAttachments.map((file) => ({
            projectId: file.projectId,
            path: file.path,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
          })),
        }
      : {}),
    ...(localFileAttachments.length > 0
      ? {
          attachedLocalFiles: localFileAttachments.map((file) => ({
            path: file.path,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            ...(typeof file.content === "string" ? { content: file.content } : {}),
            ...(file.truncated ? { truncated: true } : {}),
          })),
        }
      : {}),
  };
}

export function buildPendingClarificationResumePatch(
  snapshot: Pick<OraStateSnapshot, "pendingClarifications"> | undefined,
  answer: string,
): Record<string, unknown> | undefined {
  const trimmed = answer.trim();
  const clarification = snapshot?.pendingClarifications?.[0];
  if (!clarification || !trimmed) {
    return undefined;
  }
  return {
    clarifications: {
      [clarification.key]: trimmed,
    },
  };
}

export function clarificationOptionAnswer(option: { label: string; value?: string }): string {
  return (option.value ?? option.label).trim();
}

export function buildClarificationSubmissionPrompt(
  answers: Record<string, string>,
  pendingClarifications: Pick<OraStateSnapshot, "pendingClarifications">["pendingClarifications"] = [],
): string {
  const entries = Object.entries(answers)
    .map(([key, value]) => [key, value.trim()] as const)
    .filter(([, value]) => value.length > 0);
  if (entries.length === 0) return "";
  if (entries.length === 1) return entries[0]![1];

  const questionByKey = new Map(
    pendingClarifications.map((clarification) => [clarification.key, clarification.question.trim()] as const),
  );
  const orderedKeys = [
    ...pendingClarifications.map((clarification) => clarification.key),
    ...entries.map(([key]) => key),
  ];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const key of orderedKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const answer = answers[key]?.trim();
    if (!answer) continue;
    const label = questionByKey.get(key) ?? key;
    lines.push(`- ${label}: ${answer}`);
  }
  return ["已补充：", ...lines].join("\n");
}

export function waitForPendingRunPaint(): Promise<void> {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

export function isDisposableEmptySession(state: WorkbenchState, sessionId: string | undefined): boolean {
  if (!sessionId || state.pendingRun?.sessionId === sessionId) {
    return false;
  }

  const session = state.activeSessionDetail?.session.sessionId === sessionId
    ? state.activeSessionDetail.session
    : state.sessionDetailsById[sessionId]?.session
      ?? state.sessions.find((candidate) => candidate.sessionId === sessionId);
  if (!session || session.archivedAt !== undefined || session.status || session.turnCount !== 0) {
    return false;
  }

  if ((state.sessionPromptTexts[sessionId] ?? "").trim()) {
    return false;
  }
  if ((state.sessionSkillIds[sessionId]?.length ?? 0) > 0) {
    return false;
  }
  if ((state.sessionProjectFileAttachments[sessionId]?.length ?? 0) > 0) {
    return false;
  }
  if ((state.sessionLocalFileAttachments[sessionId]?.length ?? 0) > 0) {
    return false;
  }

  return true;
}

async function pickProjectDirectory(): Promise<string | null> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      recursive: true,
      title: "Select Project Folder",
    });
    return typeof selected === "string" && selected.trim() ? selected : null;
  }

  const entered = window.prompt("Project folder path");
  return typeof entered === "string" && entered.trim() ? entered.trim() : null;
}

interface UpsertCustomProviderOptions {
  select?: boolean;
  replacementForProviderId?: string;
}

interface DeleteCustomProviderOptions {
  replacementProviderId?: string;
  deleteSecret?: boolean;
}

export function useRunActions() {
  const { state, dispatch } = useWorkbench();
  const runtimeClient = getSharedRuntimeClient();
  const sessionRequestRef = useRef(0);
  const sessionPrefetchesRef = useRef(new Set<string>());

  const viewModel = useMemo(() => {
    if (state.patterns.length === 0 || !state.activeSessionDetail) return undefined;
    return buildWorkbenchViewModel(
      state.patterns,
      state.modes,
      state.sessions,
      state.activeSessionDetail,
      state.activeSnapshot,
      state.selectedPattern,
      state.selectedModeId,
    );
  }, [state.patterns, state.modes, state.sessions, state.activeSessionDetail, state.activeSnapshot, state.selectedPattern, state.selectedModeId]);

  const selectedSession = viewModel?.sessions.find((session) => session.id === state.selectedSessionId) ?? viewModel?.sessions[0];
  const selectedMode = state.modes.find((mode) => mode.id === state.selectedModeId);
  const selectedRunPattern = selectedMode?.family ?? state.selectedPattern;
  const selectedRunModeId = selectedMode?.id ?? state.selectedModeId;
  const selectedRunModeSelection = state.selectedModeSelection;
  const selectedNode = viewModel?.topologyNodes.find((node) => node.id === state.selectedNodeId) ?? viewModel?.topologyNodes[0];
  const selectedBeat = useMemo(() => {
    if (!state.detailDrawer && state.selectedBeatId === undefined) {
      return undefined;
    }
    return viewModel?.beats.find((beat) => beat.id === state.selectedBeatId) ?? viewModel?.beats[0];
  }, [viewModel, state.selectedBeatId, state.detailDrawer]);
  const selectedAgent = useMemo(() =>
    viewModel?.agents.find((agent) => agent.id === selectedNode?.agentId) ??
    viewModel?.agents.find((agent) => agent.id === selectedBeat?.agentId) ??
    viewModel?.agents[0],
  [viewModel, selectedNode?.agentId, selectedBeat?.agentId]);
  const selectedCheckpoint = useMemo(() =>
    viewModel?.checkpoints.find((checkpoint) => checkpoint.id === selectedBeat?.checkpointId) ?? viewModel?.checkpoints[0],
  [viewModel, selectedBeat?.checkpointId]);

  async function loadProjects(): Promise<OraProjectSummary[]> {
    const projects = await runtimeClient.listProjects();
    dispatch({ type: "SET_PROJECTS", projects });
    return projects;
  }

  async function hydrateSession(
    sessionId: string,
    snapshot?: OraStateSnapshot,
    feedback?: string,
    options: {
      refreshCollections?: boolean;
      shouldApply?: () => boolean;
    } = {},
  ) {
    const refreshCollections = options.refreshCollections ?? true;
    const [projects, sessions, detail] = await Promise.all([
      refreshCollections ? runtimeClient.listProjects() : Promise.resolve(state.projects),
      refreshCollections ? runtimeClient.listSessions() : Promise.resolve(state.sessions),
      runtimeClient.getSession(sessionId),
    ]);
    if (options.shouldApply && !options.shouldApply()) {
      return { projects, sessions, detail };
    }
    dispatch({ type: "HYDRATE_SESSION", projects, sessions, detail, snapshot, feedback });
    return { projects, sessions, detail };
  }

  async function archiveDisposableEmptySession(sessionId: string) {
    try {
      await runtimeClient.archiveSession(sessionId);
      const [projects, sessions] = await Promise.all([
        runtimeClient.listProjects(),
        runtimeClient.listSessions(),
      ]);
      dispatch({ type: "SET_COLLECTIONS", projects, sessions });
    } catch {
      // Empty-session cleanup is opportunistic and should never block navigation.
    }
  }

  function cleanupPreviousSessionIfDisposable(previousSessionId: string | undefined, nextSessionId: string) {
    if (previousSessionId && previousSessionId !== nextSessionId && isDisposableEmptySession(state, previousSessionId)) {
      void archiveDisposableEmptySession(previousSessionId);
    }
  }

  async function selectSession(sessionId: string) {
    const previousSessionId = state.selectedSessionId;
    const requestId = ++sessionRequestRef.current;
    dispatch({ type: "SET_LOADING", loading: true });
    if (state.sessionDetailsById[sessionId]) {
      dispatch({ type: "SELECT_SESSION", sessionId });
    }
    try {
      await hydrateSession(sessionId, undefined, undefined, {
        refreshCollections: false,
        shouldApply: () => sessionRequestRef.current === requestId,
      });
      cleanupPreviousSessionIfDisposable(previousSessionId, sessionId);
    } catch (error) {
      if (sessionRequestRef.current !== requestId) return;
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Session load failed." });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function prefetchSession(sessionId: string) {
    if (state.sessionDetailsById[sessionId] || sessionPrefetchesRef.current.has(sessionId)) {
      return;
    }
    sessionPrefetchesRef.current.add(sessionId);
    try {
      const detail = await runtimeClient.getSession(sessionId);
      dispatch({ type: "CACHE_SESSION_DETAIL", detail });
    } catch {
      // Prefetch is opportunistic; clicking the session still performs the authoritative load.
    } finally {
      sessionPrefetchesRef.current.delete(sessionId);
    }
  }

  async function prefetchSessions(sessionIds: string[]) {
    for (const sessionId of sessionIds) {
      await prefetchSession(sessionId);
    }
  }

  async function selectTurn(runId: string) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Load turn" });
    try {
      const snapshot = await runtimeClient.getRunState(runId);
      dispatch({ type: "SELECT_TURN", runId, snapshot });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Turn load failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function createSession() {
    const previousSessionId = state.selectedSessionId;
    const requestId = ++sessionRequestRef.current;
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      dispatch({ type: "SELECT_PROJECT", projectId: undefined });
      const created = await runtimeClient.createSession();
      await hydrateSession(created.sessionId, undefined, "Created a new empty chat session.", {
        shouldApply: () => sessionRequestRef.current === requestId,
      });
      cleanupPreviousSessionIfDisposable(previousSessionId, created.sessionId);
    } catch (error) {
      if (sessionRequestRef.current !== requestId) return;
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Session creation failed." });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function createProjectSession(projectId: string) {
    const previousSessionId = state.selectedSessionId;
    const requestId = ++sessionRequestRef.current;
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      const created = await runtimeClient.createSession({ projectId });
      dispatch({ type: "SELECT_PROJECT", projectId });
      await hydrateSession(created.sessionId, undefined, "Created a new project session.", {
        shouldApply: () => sessionRequestRef.current === requestId,
      });
      cleanupPreviousSessionIfDisposable(previousSessionId, created.sessionId);
    } catch (error) {
      if (sessionRequestRef.current !== requestId) return;
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Project session creation failed." });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function addProjectFromDialog() {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Add project" });
    try {
      const rootPath = await pickProjectDirectory();
      if (!rootPath) {
        dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
        return;
      }
      const project = await runtimeClient.createProject({ rootPath });
      await loadProjects();
      dispatch({ type: "SELECT_PROJECT", projectId: project.projectId });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Added project ${project.label}.` });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Project import failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function ensureInitialSession() {
    const [projects, sessions] = await Promise.all([
      runtimeClient.listProjects(),
      runtimeClient.listSessions(),
    ]);
    const firstSession = sessions[0] ?? await runtimeClient.createSession();
    const detail = await runtimeClient.getSession(firstSession.sessionId);
    dispatch({
      type: "HYDRATE_SESSION",
      projects,
      sessions: firstSession === sessions[0] ? sessions : [firstSession, ...sessions],
      detail,
    });
    return { projects, sessions, detail };
  }

  async function archiveSession(sessionId: string) {
    dispatch({ type: "ARCHIVE_SESSION_OPTIMISTIC", sessionId });
    try {
      const archived = await runtimeClient.archiveSession(sessionId);
      const [projects, sessions] = await Promise.all([
        runtimeClient.listProjects(),
        runtimeClient.listSessions(),
      ]);
      if (state.selectedSessionId !== sessionId) {
        dispatch({ type: "SET_COLLECTIONS", projects, sessions, feedback: "Archived chat session." });
        return;
      }

      const fallbackSession = sessions.find((session) => session.projectId === archived.projectId) ?? sessions[0]
        ?? await runtimeClient.createSession(archived.projectId ? { projectId: archived.projectId } : {});
      const refreshedSessions = fallbackSession === sessions[0]
        ? sessions
        : await runtimeClient.listSessions();
      const refreshedProjects = fallbackSession === sessions[0]
        ? projects
        : await runtimeClient.listProjects();
      const detail = await runtimeClient.getSession(fallbackSession.sessionId);
      dispatch({
        type: "HYDRATE_SESSION",
        projects: refreshedProjects,
        sessions: refreshedSessions,
        detail,
        feedback: "Archived chat session.",
      });
    } catch (error) {
      const feedback = error instanceof Error ? error.message : "Archive failed.";
      try {
        const [projects, sessions] = await Promise.all([
          runtimeClient.listProjects(),
          runtimeClient.listSessions(),
        ]);
        dispatch({ type: "SET_COLLECTIONS", projects, sessions, feedback });
      } catch {
        dispatch({ type: "SET_COMMAND_FEEDBACK", feedback });
        dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
      }
    }
  }

  async function refreshCurrentSession(snapshot?: OraStateSnapshot, feedback?: string) {
    const sessionId = snapshot?.sessionId ?? state.selectedSessionId;
    if (!sessionId) return;
    await hydrateSession(sessionId, snapshot, feedback);
  }

  async function submitClarificationOption(answer: string) {
    if (!state.selectedSessionId || !state.selectedTurnRunId) return;
    const clarificationPatch = buildPendingClarificationResumePatch(state.activeSnapshot, answer);
    if (!clarificationPatch) return;
    flushSync(() => {
      dispatch({
        type: "BEGIN_RUN_REQUEST",
        sessionId: state.selectedSessionId!,
        prompt: answer,
        createdAt: Date.now(),
      });
    });
    await waitForPendingRunPaint();
    try {
      const snapshot = await runtimeClient.resumeRun(
        state.selectedTurnRunId,
        USER_RESUMED_MESSAGE,
        clarificationPatch,
      );
      await refreshCurrentSession(snapshot, `Clarification submitted for ${snapshot.runId}.`);
    } catch (error) {
      dispatch({
        type: "SET_BRIDGE_STATUS",
        status: { mode: "error", ok: false, label: "Resume failed", detail: error instanceof Error ? error.message : "Unable to resume run." },
      });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function submitAllClarifications(answers: Record<string, string>) {
    if (!state.selectedSessionId || !state.selectedTurnRunId) return;
    if (Object.keys(answers).length === 0) return;

    const submittedPrompt = buildClarificationSubmissionPrompt(answers, state.activeSnapshot?.pendingClarifications ?? []);
    flushSync(() => {
      dispatch({
        type: "BEGIN_RUN_REQUEST",
        sessionId: state.selectedSessionId!,
        prompt: submittedPrompt,
        createdAt: Date.now(),
      });
    });
    await waitForPendingRunPaint();
    try {
      const snapshot = await runtimeClient.resumeRun(
        state.selectedTurnRunId,
        USER_RESUMED_MESSAGE,
        { clarifications: answers },
      );
      await refreshCurrentSession(snapshot, `Clarifications submitted for ${snapshot.runId}.`);
    } catch (error) {
      dispatch({
        type: "SET_BRIDGE_STATUS",
        status: { mode: "error", ok: false, label: "Resume failed", detail: error instanceof Error ? error.message : "Unable to resume run." },
      });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function startRunWithOptions(options: {
    prompt?: string;
    taskIntent?: WorkbenchState["taskIntent"];
    clearPromptIfMatched?: boolean;
  } = {}) {
    const prompt = options.prompt ?? state.promptText;
    const taskIntent = options.taskIntent ?? state.taskIntent;
    if (!state.selectedSessionId || !prompt.trim()) return;
    const desktopLatencyMarks: DesktopLatencyMark[] = [desktopLatencyMark("submitAt")];
    const sessionId = state.selectedSessionId;
    const submittedPrompt = prompt;
    const submittedProjectFileAttachments = state.sessionProjectFileAttachments[sessionId] ?? [];
    const submittedLocalFileAttachments = state.sessionLocalFileAttachments[sessionId] ?? [];
    const clarificationPatch = state.activeSnapshot?.runId === state.selectedTurnRunId
      ? buildPendingClarificationResumePatch(state.activeSnapshot, submittedPrompt)
      : undefined;
    flushSync(() => {
      dispatch({
        type: "BEGIN_RUN_REQUEST",
        sessionId,
        prompt: submittedPrompt,
        createdAt: Date.now(),
      });
      if (options.clearPromptIfMatched ?? true) {
        dispatch({ type: "CLEAR_PROMPT_IF_MATCH", text: submittedPrompt });
      }
      if (!clarificationPatch && submittedProjectFileAttachments.length > 0) {
        dispatch({ type: "CLEAR_PROJECT_FILE_ATTACHMENTS", sessionId });
      }
      if (!clarificationPatch && submittedLocalFileAttachments.length > 0) {
        dispatch({ type: "CLEAR_LOCAL_FILE_ATTACHMENTS", sessionId });
      }
    });
    await waitForPendingRunPaint();
    desktopLatencyMarks.push(desktopLatencyMark("pendingPaintedAt"));
    if (!clarificationPatch && selectedRunModeSelection === "auto") {
      dispatch({
        type: "SET_PENDING_RUN_PROGRESS",
        sessionId,
        progressText: "正在选择合适的工作模式",
      });
    }
    if (clarificationPatch && state.selectedTurnRunId) {
      try {
        const snapshot = await runtimeClient.resumeRun(
          state.selectedTurnRunId,
          USER_RESUMED_MESSAGE,
          clarificationPatch,
        );
        await refreshCurrentSession(snapshot, `Clarification submitted for ${snapshot.runId}.`);
        return;
      } catch (error) {
        dispatch({
          type: "SET_BRIDGE_STATUS",
          status: { mode: "error", ok: false, label: "Resume failed", detail: error instanceof Error ? error.message : "Unable to resume run." },
        });
        dispatch({ type: "SET_LOADING", loading: false });
        return;
      }
    }
    const provider = state.providerRegistry?.providers.find((entry) => entry.id === state.selectedProviderId);
    const projectId = state.activeSessionDetail?.session.projectId;
    const searchConfig = buildRunSearchConfig();
    const toolModelSettings = loadDesktopToolModelSettings();
    const selectedRunSkillIds = [...new Set([
      ...(selectedMode?.capabilityFlags.skillIds ?? []),
      ...state.selectedSkillIds,
    ])];
    try {
      const resolvedToolIds = toolIdsForRun(selectedMode?.capabilityFlags.toolIds, projectId);
      const filteredToolIds = (taskIntent === "chat" || taskIntent === "plan")
        ? resolvedToolIds.filter((id) => !(FILE_MODIFICATION_TOOL_IDS as readonly string[]).includes(id))
        : resolvedToolIds;
      desktopLatencyMarks.push(desktopLatencyMark("startStreamingRunCalledAt"));
      const handle = await runtimeClient.startStreamingRun(
        {
          prompt: submittedPrompt,
          projectId,
          context: buildDesktopRunContext(submittedProjectFileAttachments, submittedLocalFileAttachments),
        },
        {
          pattern: selectedRunPattern,
          modeId: selectedRunModeId,
          modeSelection: selectedRunModeSelection,
          providerId: state.selectedProviderId,
          providerConfig: provider,
          customAgentId: state.selectedCustomAgentId,
          modelRef: provider?.modelId ?? "local/smoke-model",
          ...(selectedRunSkillIds.length > 0 ? { skillIds: selectedRunSkillIds } : {}),
          toolIds: filteredToolIds,
          permissionMode: state.permissionMode,
          searchProvider: searchConfig.searchProvider,
          metadata: {
            providerId: state.selectedProviderId,
            clarificationPreflight: true,
            progressNarration: shouldEnableProgressNarration(taskIntent),
            disableDefaultWebTools: modeDisablesDefaultWebTools(selectedMode?.capabilityFlags.toolIds),
            taskIntent,
            toolModelProviderId: toolModelSettings.providerId,
            ...searchConfig.metadata,
            ...(state.selectedSkillIds.length > 0 ? { selectedSkillIds: state.selectedSkillIds } : {}),
            ...(state.selectedCustomAgentId ? { customAgentId: state.selectedCustomAgentId } : {}),
          },
        },
        sessionId,
      );
      desktopLatencyMarks.push(desktopLatencyMark("handleReceivedAt", Date.now(), { runId: handle.runId }));
      const snapshot = appendDesktopLatencyMarks(
        await runtimeClient.getRunState(handle.runId),
        [...desktopLatencyMarks, desktopLatencyMark("getRunStateReceivedAt", Date.now(), { runId: handle.runId })],
      );
      dispatch({ type: "SELECT_TURN", runId: handle.runId, snapshot });
      await refreshCurrentSession(snapshot, `Started turn ${snapshot.turnIndex ?? "?"}.`);
      const health = runtimeClient.getHealth();
      if (health) {
        dispatch({ type: "SET_BRIDGE_STATUS", status: { mode: health.mode, ok: health.ok, label: health.service, detail: health.detail } });
      }
    } catch (error) {
      dispatch({
        type: "SET_BRIDGE_STATUS",
        status: { mode: "error", ok: false, label: "Run failed", detail: error instanceof Error ? error.message : "Unable to start run." },
      });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function startRun() {
    await startRunWithOptions();
  }

  async function interruptRun() {
    if (!state.selectedTurnRunId) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Interrupt" });
    try {
      const snapshot = await runtimeClient.interruptRun(state.selectedTurnRunId, USER_INTERRUPTED_MESSAGE);
      await refreshCurrentSession(snapshot, `Interrupt completed against ${snapshot.runId}.`);
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Interrupt failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function resumeRun() {
    if (!state.selectedTurnRunId) return;
    const pendingApprovalIds = new Set(
      state.activeSnapshot?.attention?.kind === "needs_approval"
        ? state.activeSnapshot.attention.pendingActionIds
        : [],
    );
    const approvedActionIds = viewModel?.actions
      .filter((a) => a.state === "approval_required" && pendingApprovalIds.has(a.id))
      .map((a) => a.id) ?? [];
    flushSync(() => {
      dispatch({ type: "BEGIN_RUN_RESUME", runId: state.selectedTurnRunId!, approvedActionIds, updatedAt: Date.now() });
      dispatch({ type: "SET_BUSY_COMMAND", command: "Approve" });
    });
    await waitForPendingRunPaint();
    try {
      const handle = await runtimeClient.resumeStreamingRun(
        state.selectedTurnRunId,
        USER_RESUMED_MESSAGE,
        { approvedActionIds },
      );
      const snapshot = await runtimeClient.getRunState(handle.runId);
      await refreshCurrentSession(snapshot, `Approve completed against ${snapshot.runId}.`);
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Approve failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function cancelRun() {
    if (!state.selectedTurnRunId) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Cancel" });
    try {
      const snapshot = await runtimeClient.cancelRun(state.selectedTurnRunId, USER_CANCELLED_MESSAGE);
      await refreshCurrentSession(snapshot, `Cancel completed against ${snapshot.runId}.`);
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Cancel failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function resolvePlanDecision(status: "accepted" | "declined"): Promise<boolean> {
    if (state.pendingPlanDecisionResolution) {
      return false;
    }
    const sessionId = state.activeSessionDetail?.session.sessionId ?? state.selectedSessionId;
    const decisionId =
      state.activeSessionDetail?.session.attention?.planDecisionId ??
      state.activeSnapshot?.attention?.planDecisionId ??
      state.activeSnapshot?.planDecisions.find((decision) => decision.status === "pending")?.id;
    if (!sessionId || !decisionId) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: "No pending plan decision found." });
      return false;
    }
    const currentTaskIntent = state.taskIntent;
    const implementationPrompt = status === "accepted"
      ? acceptedPlanImplementationSubmission().prompt
      : undefined;
    const startedAt = Date.now();
    flushSync(() => {
      dispatch({
        type: "BEGIN_PLAN_DECISION_RESOLUTION",
        sessionId,
        decisionId,
        status,
        createdAt: startedAt,
        implementationPrompt,
      });
    });
    await waitForPendingRunPaint();
    try {
      const detail = await runtimeClient.resolvePlanDecision({ sessionId, decisionId, status });
      dispatch({
        type: "HYDRATE_SESSION",
        projects: state.projects,
        sessions: state.sessions,
        detail,
        feedback: status === "accepted" ? "Plan accepted." : "Plan decision dismissed.",
      });
      if (status === "declined") {
        dispatch({ type: "SET_TASK_INTENT", taskIntent: currentTaskIntent });
      }
      return true;
    } catch (error) {
      dispatch({
        type: "ROLLBACK_PLAN_DECISION_RESOLUTION",
        sessionId,
        decisionId,
        feedback: error instanceof Error ? error.message : "Plan decision update failed.",
      });
      return false;
    }
  }

  async function acceptPlanDecisionAndStartImplementation() {
    const accepted = await resolvePlanDecision("accepted");
    if (!accepted) return;
    const submission = acceptedPlanImplementationSubmission();
    dispatch({ type: "SET_TASK_INTENT", taskIntent: submission.taskIntent });
    await startRunWithOptions({
      prompt: submission.prompt,
      taskIntent: submission.taskIntent,
      clearPromptIfMatched: false,
    });
  }

  async function forkRun() {
    if (!state.selectedTurnRunId || !selectedCheckpoint) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: "Select a checkpoint before forking." });
      return;
    }
    dispatch({ type: "SET_BUSY_COMMAND", command: "Fork" });
    try {
      const snapshot = await runtimeClient.forkRun(
        state.selectedTurnRunId,
        selectedCheckpoint.id,
        {
          pattern: selectedRunPattern,
          modeId: selectedRunModeId,
          modeSelection: selectedRunModeSelection,
          metadata: { source: "desktop-workbench" },
        },
        { context: { selectedEventId: selectedBeat?.id, selectedEventSeq: selectedBeat?.eventSeq } },
      );
      await refreshCurrentSession(snapshot, `Fork completed against ${snapshot.runId}.`);
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Fork failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function createAndRunBranchGroup(params: OraSessionBranchGroupCreateParams) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Branch" });
    try {
      const group = await runtimeClient.createAndRunSessionBranchGroup(params);
      await hydrateSession(params.sessionId, undefined, `Started ${group.candidateRunIds.length} branch candidate${group.candidateRunIds.length === 1 ? "" : "s"}.`);
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Branch run failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function adoptBranchGroup(branchGroupId: string, runId: string) {
    const sessionId = state.selectedSessionId;
    if (!sessionId) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Adopt branch" });
    try {
      const detail = await runtimeClient.adoptSessionBranchGroup({ sessionId, branchGroupId, runId });
      const [projects, sessions] = await Promise.all([
        runtimeClient.listProjects(),
        runtimeClient.listSessions(),
      ]);
      dispatch({
        type: "HYDRATE_SESSION",
        projects,
        sessions,
        detail,
        feedback: "Branch adopted.",
      });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Branch adoption failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function dismissBranchGroup(branchGroupId: string) {
    const sessionId = state.selectedSessionId;
    if (!sessionId) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Dismiss branch" });
    try {
      await runtimeClient.dismissSessionBranchGroup({ sessionId, branchGroupId });
      await hydrateSession(sessionId, undefined, "Branch group dismissed.");
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Branch dismissal failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function replaySelection() {
    if (!state.selectedTurnRunId || !selectedBeat) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Replay" });
    try {
      const stream = await runtimeClient.replayRun(state.selectedTurnRunId, selectedBeat.checkpointId);
      const firstEvent = stream.events[0];
      if (firstEvent) dispatch({ type: "SELECT_BEAT", beatId: firstEvent.id });
      dispatch({
        type: "SET_COMMAND_FEEDBACK",
        feedback: `Replay restored ${stream.events.length} event${stream.events.length === 1 ? "" : "s"} from ${selectedBeat.label}.`,
      });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Replay failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function exportReport() {
    if (!state.selectedTurnRunId) return;
    dispatch({ type: "SET_BUSY_COMMAND", command: "Report" });
    try {
      const { artifact, snapshot } = await runtimeClient.exportReport(state.selectedTurnRunId);
      await refreshCurrentSession(snapshot, `Exported ${artifact.label} as ${artifact.mimeType}.`);
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Report export failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function storeProviderSecret(providerId: string, secret: string) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Save provider key" });
    try {
      const status = await runtimeClient.storeProviderSecret(providerId, secret);
      dispatch({ type: "SET_PROVIDER_SECRET_STATUS", status });
      const refreshed = await runtimeClient.refreshProviderSecretStatuses(state.providerRegistry?.providers ?? []);
      const statuses = refreshed.some((entry) => entry.providerId === providerId)
        ? refreshed
        : [status, ...refreshed.filter((entry) => entry.providerId !== providerId)];
      dispatch({ type: "SET_PROVIDER_SECRET_STATUSES", statuses });
      dispatch({
        type: "SET_PROVIDER_STATUSES",
        statuses: runtimeClient.refreshProviderStatuses(
          state.providerRegistry?.providers ?? [],
          statuses,
          state.providerStatuses,
        ),
      });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Provider key save failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function deleteProviderSecret(providerId: string) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Remove provider key" });
    try {
      const status = await runtimeClient.deleteProviderSecret(providerId);
      dispatch({ type: "SET_PROVIDER_SECRET_STATUS", status });
      const refreshed = await runtimeClient.refreshProviderSecretStatuses(state.providerRegistry?.providers ?? []);
      const statuses = refreshed.some((entry) => entry.providerId === providerId)
        ? refreshed
        : [status, ...refreshed.filter((entry) => entry.providerId !== providerId)];
      dispatch({ type: "SET_PROVIDER_SECRET_STATUSES", statuses });
      dispatch({
        type: "SET_PROVIDER_STATUSES",
        statuses: runtimeClient.refreshProviderStatuses(
          state.providerRegistry?.providers ?? [],
          statuses,
          state.providerStatuses,
        ),
      });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Provider key removal failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function verifyProvider(provider: OraProviderConfig) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Verify provider" });
    try {
      const status = await runtimeClient.verifyProvider(provider);
      dispatch({ type: "SET_PROVIDER_STATUS", status });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
      return status;
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Provider verification failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
      return undefined;
    }
  }

  async function upsertCustomProvider(provider: OraProviderConfig, options: UpsertCustomProviderOptions = {}) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Save provider" });
    try {
      const registry = await runtimeClient.upsertCustomProvider(provider);
      dispatch({ type: "SET_PROVIDER_REGISTRY", providerRegistry: registry });
      const shouldSelect = options.select ?? provider.enabled !== false;
      const replacesSelected = options.replacementForProviderId === state.selectedProviderId;
      if (provider.enabled !== false && (shouldSelect || replacesSelected)) {
        dispatch({ type: "SET_PROVIDER", providerId: provider.id });
      }
      const statuses = await runtimeClient.refreshProviderSecretStatuses(registry.providers);
      dispatch({ type: "SET_PROVIDER_SECRET_STATUSES", statuses });
      dispatch({
        type: "SET_PROVIDER_STATUSES",
        statuses: runtimeClient.refreshProviderStatuses(registry.providers, statuses, state.providerStatuses),
      });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `${provider.label} is ready to configure.` });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Provider save failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function deleteCustomProvider(providerId: string, options: DeleteCustomProviderOptions = {}) {
    dispatch({ type: "SET_BUSY_COMMAND", command: "Remove provider" });
    try {
      if (options.deleteSecret !== false) {
        await runtimeClient.deleteProviderSecret(providerId);
      }
      const registry = await runtimeClient.deleteCustomProvider(providerId);
      dispatch({ type: "DELETE_PROVIDER", providerId });
      dispatch({ type: "SET_PROVIDER_REGISTRY", providerRegistry: registry });
      if (options.replacementProviderId) {
        dispatch({ type: "SET_PROVIDER", providerId: options.replacementProviderId });
      }
      const statuses = await runtimeClient.refreshProviderSecretStatuses(registry.providers);
      dispatch({ type: "SET_PROVIDER_SECRET_STATUSES", statuses });
      dispatch({
        type: "SET_PROVIDER_STATUSES",
        statuses: runtimeClient.refreshProviderStatuses(registry.providers, statuses, state.providerStatuses),
      });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    } catch (error) {
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: error instanceof Error ? error.message : "Provider removal failed." });
      dispatch({ type: "SET_BUSY_COMMAND", command: undefined });
    }
  }

  async function openAgentChat(agentId: string) {
    dispatch({ type: "SET_SELECTED_CUSTOM_AGENT", agentId });
    dispatch({ type: "SET_VIEW", view: "chat" });
    await createSession();
  }

  function clearSelectedCustomAgent() {
    dispatch({ type: "SET_SELECTED_CUSTOM_AGENT", agentId: undefined });
  }

  return {
    runtimeClient,
    viewModel,
    selectedSession,
    selectedNode,
    selectedBeat,
    selectedAgent,
    selectedCheckpoint,
    actions: {
      addProjectFromDialog,
      createSession,
      createProjectSession,
      prefetchSession,
      prefetchSessions,
      ensureInitialSession,
      archiveSession,
      selectSession,
      selectTurn,
      startRun,
      submitClarificationOption,
      submitAllClarifications,
      interruptRun,
      resumeRun,
      cancelRun,
      resolvePlanDecision,
      acceptPlanDecisionAndStartImplementation,
      forkRun,
      createAndRunBranchGroup,
      adoptBranchGroup,
      dismissBranchGroup,
      replaySelection,
      exportReport,
      storeProviderSecret,
      deleteProviderSecret,
      verifyProvider,
      upsertCustomProvider,
      deleteCustomProvider,
      openAgentChat,
      clearSelectedCustomAgent,
    },
  };
}
