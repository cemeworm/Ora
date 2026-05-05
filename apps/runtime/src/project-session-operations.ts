import path from "node:path";
import {
  ProjectCreateParamsSchema,
  ProjectDetail,
  ProjectDetailSchema,
  ProjectFileReadParamsSchema,
  ProjectFileReadResult,
  ProjectFilesParamsSchema,
  ProjectFilesResult,
  ProjectGetParamsSchema,
  ProjectListParamsSchema,
  ProjectSummary,
  ProjectSummarySchema,
  RunsListParamsSchema,
  RunSummary,
  SessionBranchGroup,
  SessionBranchGroupSchema,
  SessionArchiveParamsSchema,
  SessionCreateParamsSchema,
  SessionDetail,
  SessionDetailSchema,
  SessionGetParamsSchema,
  SessionListParamsSchema,
  SessionSummary,
  SessionSummarySchema,
  SessionTranscriptMessage,
  SessionTurn,
  StateSnapshot,
  deriveRunAttention
} from "@cemeworm/shared";
import {
  listProjectFilesForProject,
  normalizeProjectRootPath,
  readProjectFileForProject
} from "./project-workspace.js";
import { attachTraceMetadata, toRunSummary, toSessionTurn } from "./run-projections.js";
import { DEFAULT_SESSION_TITLE } from "./session-title.js";

export interface ProjectSessionOperationDeps {
  projects: Map<string, ProjectSummary>;
  sessions: Map<string, SessionSummary>;
  runs: Map<string, StateSnapshot>;
  now: () => number;
  nextProjectId: () => string;
  nextSessionId: () => string;
  persistProject: (project: ProjectSummary) => void;
  persistSession: (session: SessionSummary) => void;
  getProjectOrThrow: (projectId: string) => ProjectSummary;
  getSessionOrThrow: (sessionId: string) => SessionSummary;
  getRunOrThrow: (runId: string) => StateSnapshot;
  runsForSession: (sessionId: string) => StateSnapshot[];
  sessionTranscript: (sessionId: string) => SessionTranscriptMessage[];
}

export function createProject(params: unknown, deps: ProjectSessionOperationDeps): ProjectSummary {
  const parsed = ProjectCreateParamsSchema.parse(params ?? {});
  const normalizedRootPath = normalizeProjectRootPath(parsed.rootPath);
  const existing = [...deps.projects.values()].find((project) => project.rootPath === normalizedRootPath);
  if (existing) {
    return ProjectSummarySchema.parse(existing);
  }

  const now = deps.now();
  const project = ProjectSummarySchema.parse({
    projectId: deps.nextProjectId(),
    label: parsed.label?.trim() || path.basename(normalizedRootPath) || normalizedRootPath,
    rootPath: normalizedRootPath,
    sessionCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  deps.persistProject(project);
  return project;
}

export function listProjects(params: unknown, deps: ProjectSessionOperationDeps): ProjectSummary[] {
  const parsed = ProjectListParamsSchema.parse(params ?? {});
  return [...deps.projects.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || a.projectId.localeCompare(b.projectId))
    .slice(0, parsed.limit)
    .map((project) => ProjectSummarySchema.parse(project));
}

export function getProject(params: unknown, deps: ProjectSessionOperationDeps): ProjectDetail {
  const parsed = ProjectGetParamsSchema.parse(params);
  const project = deps.getProjectOrThrow(parsed.projectId);
  return ProjectDetailSchema.parse({
    project,
    sessions: listSessions({ projectId: parsed.projectId }, deps),
  });
}

export function listProjectFiles(params: unknown, deps: ProjectSessionOperationDeps): ProjectFilesResult {
  const parsed = ProjectFilesParamsSchema.parse(params);
  const project = deps.getProjectOrThrow(parsed.projectId);
  return listProjectFilesForProject(project);
}

export function readProjectFile(params: unknown, deps: ProjectSessionOperationDeps): ProjectFileReadResult {
  const parsed = ProjectFileReadParamsSchema.parse(params);
  const project = deps.getProjectOrThrow(parsed.projectId);
  return readProjectFileForProject(project, parsed.path);
}

export function createSession(params: unknown, deps: ProjectSessionOperationDeps): SessionSummary {
  const parsed = SessionCreateParamsSchema.parse(params ?? {});
  if (parsed.projectId) {
    deps.getProjectOrThrow(parsed.projectId);
  }
  const now = deps.now();
  const session = SessionSummarySchema.parse({
    sessionId: deps.nextSessionId(),
    title: parsed.label?.trim() || DEFAULT_SESSION_TITLE,
    projectId: parsed.projectId,
    turnCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  deps.persistSession(session);
  return session;
}

export function listSessions(params: unknown, deps: ProjectSessionOperationDeps): SessionSummary[] {
  const parsed = SessionListParamsSchema.parse(params ?? {});
  return [...deps.sessions.values()]
    .filter((session) => session.archivedAt === undefined)
    .filter((session) => (parsed.projectId ? session.projectId === parsed.projectId : true))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    .slice(0, parsed.limit)
    .map((session) => SessionSummarySchema.parse(sessionWithLatestAttention(session, deps)));
}

export function archiveSession(params: unknown, deps: ProjectSessionOperationDeps): SessionSummary {
  const parsed = SessionArchiveParamsSchema.parse(params);
  const existing = deps.getSessionOrThrow(parsed.sessionId);
  const archivedAt = existing.archivedAt ?? deps.now();
  const session = SessionSummarySchema.parse({
    ...existing,
    archivedAt,
    updatedAt: Math.max(existing.updatedAt, archivedAt),
  });
  deps.persistSession(session);
  return session;
}

export function getSession(params: unknown, deps: ProjectSessionOperationDeps): SessionDetail {
  const parsed = SessionGetParamsSchema.parse(params);
  const session = sessionWithLatestAttention(deps.getSessionOrThrow(parsed.sessionId), deps);
  const turns: SessionTurn[] = deps.runsForSession(parsed.sessionId).map((run) => toSessionTurn(attachTraceMetadata(run)));
  const latestSnapshot = turns.length > 0
    ? attachTraceMetadata(deps.getRunOrThrow(turns.at(-1)!.runId))
    : undefined;
  return SessionDetailSchema.parse({
    session,
    turns,
    transcript: deps.sessionTranscript(parsed.sessionId),
    branchGroups: branchGroupsForSession(parsed.sessionId, [...deps.runs.values()]),
    latestSnapshot,
  });
}

function sessionWithLatestAttention(session: SessionSummary, deps: ProjectSessionOperationDeps): SessionSummary {
  const latestRun = session.latestRunId ? deps.runs.get(session.latestRunId) : deps.runsForSession(session.sessionId).at(-1);
  if (!latestRun) {
    return SessionSummarySchema.parse(session);
  }
  return SessionSummarySchema.parse({
    ...session,
    attention: deriveRunAttention(latestRun),
  });
}

export function listRuns(params: unknown, deps: ProjectSessionOperationDeps): RunSummary[] {
  const parsed = RunsListParamsSchema.parse(params ?? {});
  return [...deps.runs.values()]
    .filter((run) => (parsed.status ? run.status === parsed.status : true))
    .filter((run) => (parsed.sessionId ? run.sessionId === parsed.sessionId : true))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.runId.localeCompare(b.runId))
    .slice(0, parsed.limit)
    .map((run) => toRunSummary(run));
}

export function branchGroupsForSession(sessionId: string, runs: StateSnapshot[]): SessionBranchGroup[] {
  const candidates = runs
    .filter((run) => run.sessionId === sessionId)
    .filter((run) => typeof run.config.metadata.branchGroupId === "string");
  const groups = new Map<string, StateSnapshot[]>();
  for (const run of candidates) {
    const branchGroupId = String(run.config.metadata.branchGroupId);
    groups.set(branchGroupId, [...(groups.get(branchGroupId) ?? []), run]);
  }

  return [...groups.entries()]
    .map(([branchGroupId, groupRuns]) => {
      const sortedRuns = groupRuns.sort((a, b) => a.updatedAt - b.updatedAt || a.runId.localeCompare(b.runId));
      const first = sortedRuns[0]!;
      const metadata = first.config.metadata;
      const adopted = sortedRuns.find((run) => run.config.metadata.branchRole === "adopted");
      const dismissed = sortedRuns.every((run) => run.config.metadata.branchDismissed === true);
      const allSettled = sortedRuns.every((run) => run.status !== "queued" && run.status !== "running");
      const createdAt = numberMetadata(metadata.branchGroupCreatedAt) ?? first.input.createdAt ?? first.updatedAt;
      const updatedAt = sortedRuns.reduce((max, run) => Math.max(max, run.updatedAt), createdAt);
      return SessionBranchGroupSchema.parse({
        branchGroupId,
        sessionId,
        target: stringMetadata(metadata.branchTarget) ?? "append_after_latest",
        baseRunId: stringMetadata(metadata.branchBaseRunId),
        replaceRunId: stringMetadata(metadata.branchReplaceRunId),
        baseTurnIndex: numberMetadata(metadata.branchBaseTurnIndex) ?? 0,
        prompt: stringMetadata(metadata.branchPrompt) ?? first.input.prompt,
        status: adopted ? "adopted" : dismissed ? "dismissed" : allSettled ? "ready" : "running",
        candidateRunIds: sortedRuns.map((run) => run.runId),
        candidates: sortedRuns.map((run) => ({
          runId: run.runId,
          status: run.status,
          label: stringMetadata(run.config.metadata.branchCandidateLabel),
          modeId: run.modeId,
          providerId: typeof run.config.providerId === "string" ? run.config.providerId : undefined,
          modelRef: run.config.modelRef,
          adopted: run.config.metadata.branchRole === "adopted",
          prompt: run.input.prompt,
          outputPreview: outputPreviewForRun(run),
          updatedAt: run.updatedAt,
        })),
        adoptedRunId: adopted?.runId,
        createdAt,
        updatedAt,
      });
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || a.branchGroupId.localeCompare(b.branchGroupId));
}

export function isUnadoptedBranchCandidate(run: StateSnapshot): boolean {
  return run.config.metadata.branchRole === "candidate";
}

export function isSupersededRun(run: StateSnapshot): boolean {
  return typeof run.config.metadata.supersededByRunId === "string";
}

export function isVisibleMainlineRun(run: StateSnapshot): boolean {
  return !isUnadoptedBranchCandidate(run) && !isSupersededRun(run);
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberMetadata(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function outputPreviewForRun(run: StateSnapshot): string | undefined {
  if (typeof run.output === "object" && run.output !== null && typeof (run.output as { text?: unknown }).text === "string") {
    return (run.output as { text: string }).text.slice(0, 500);
  }
  if (typeof run.output === "string") {
    return run.output.slice(0, 500);
  }
  const content = run.events
    .filter((event) => event.type === "message.delta")
    .map((event) => event.payload)
    .filter((payload): payload is { content: string } =>
      typeof payload === "object" && payload !== null && typeof (payload as { content?: unknown }).content === "string"
    )
    .map((payload) => payload.content)
    .join("");
  return content ? content.slice(0, 500) : undefined;
}
