import type { OraProjectSummary, OraSessionSummary } from "./runtimeClient";

export interface SessionSearchResult {
  id: string;
  title: string;
  projectLabel?: string;
}

export type SidebarSearchResult =
  | {
      kind: "project";
      id: string;
      title: string;
      sessionCount: number;
    }
  | {
      kind: "session";
      id: string;
      title: string;
      projectLabel?: string;
    };

export function buildSidebarSearchResults(
  sessions: OraSessionSummary[],
  projects: OraProjectSummary[],
  query: string,
  limit: number,
): SidebarSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  const projectLabels = new Map(projects.map((project) => [project.projectId, project.label]));
  const sessionMatches = sessions
    .filter((session) => !session.archivedAt)
    .filter((session) => {
      if (!normalizedQuery) return true;
      const projectLabel = session.projectId ? projectLabels.get(session.projectId) : undefined;
      return (
        session.title.toLowerCase().includes(normalizedQuery) ||
        (projectLabel?.toLowerCase().includes(normalizedQuery) ?? false)
      );
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    .map<SidebarSearchResult>((session) => ({
      kind: "session",
      id: session.sessionId,
      title: session.title,
      projectLabel: session.projectId ? projectLabels.get(session.projectId) : undefined,
    }));

  if (!normalizedQuery) {
    return sessionMatches.slice(0, limit);
  }

  const projectMatches = projects
    .filter((project) => project.label.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.projectId.localeCompare(b.projectId))
    .map<SidebarSearchResult>((project) => ({
      kind: "project",
      id: project.projectId,
      title: project.label,
      sessionCount: project.sessionCount,
    }));

  return [...projectMatches, ...sessionMatches].slice(0, limit);
}

export function buildSessionSearchResults(
  sessions: OraSessionSummary[],
  projects: OraProjectSummary[],
  query: string,
  limit: number,
): SessionSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  const projectLabels = new Map(projects.map((project) => [project.projectId, project.label]));

  return sessions
    .filter((session) => !session.archivedAt)
    .filter((session) => {
      if (!normalizedQuery) return true;
      return session.title.toLowerCase().includes(normalizedQuery);
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    .slice(0, limit)
    .map((session) => ({
      id: session.sessionId,
      title: session.title,
      projectLabel: session.projectId ? projectLabels.get(session.projectId) : undefined,
    }));
}
