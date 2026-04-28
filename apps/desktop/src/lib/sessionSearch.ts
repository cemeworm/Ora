import type { OraProjectSummary, OraSessionSummary } from "./runtimeClient";

export interface SessionSearchResult {
  id: string;
  title: string;
  projectLabel?: string;
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
