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
  StateSnapshot
} from "@ora/shared";
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
    .map((session) => SessionSummarySchema.parse(session));
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
  const session = deps.getSessionOrThrow(parsed.sessionId);
  const turns: SessionTurn[] = deps.runsForSession(parsed.sessionId).map((run) => toSessionTurn(attachTraceMetadata(run)));
  const latestSnapshot = turns.length > 0
    ? attachTraceMetadata(deps.getRunOrThrow(turns.at(-1)!.runId))
    : undefined;
  return SessionDetailSchema.parse({
    session,
    turns,
    transcript: deps.sessionTranscript(parsed.sessionId),
    latestSnapshot,
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
