import { describe, expect, it } from "vitest";
import { buildSessionSearchResults } from "./sessionSearch";
import type { OraProjectSummary, OraSessionSummary } from "./runtimeClient";

function sessionSummary(
  sessionId: string,
  title: string,
  updatedAt: number,
  projectId?: string,
): OraSessionSummary {
  return {
    sessionId,
    title,
    projectId,
    turnCount: 0,
    createdAt: updatedAt,
    updatedAt,
  };
}

const projects: OraProjectSummary[] = [{
  projectId: "project-ora",
  label: "ora",
  sourceKind: "local_folder",
  rootPath: "/tmp/ora",
  sessionCount: 1,
  createdAt: 1,
  updatedAt: 1,
}];

describe("Sidebar session search", () => {
  it("shows recent sessions when the query is empty", () => {
    const results = buildSessionSearchResults([
      sessionSummary("session-a", "older chat", 1),
      sessionSummary("session-b", "newer chat", 3, "project-ora"),
      sessionSummary("session-c", "middle chat", 2),
    ], projects, "", 9);

    expect(results.map((session) => session.id)).toEqual([
      "session-b",
      "session-c",
      "session-a",
    ]);
    expect(results[0]?.projectLabel).toBe("ora");
  });

  it("matches sessions by title text only", () => {
    const results = buildSessionSearchResults([
      sessionSummary("session-a", "继续实施 runtime 方案", 1),
      sessionSummary("session-b", "补齐输出框载入文件", 3, "project-ora"),
      sessionSummary("session-c", "升级 Skills 脚本支持", 2),
    ], projects, "runtime", 9);

    expect(results.map((session) => session.id)).toEqual(["session-a"]);
  });

  it("limits the result count", () => {
    const sessions = Array.from({ length: 12 }, (_, index) =>
      sessionSummary(`session-${index}`, `chat ${index}`, index),
    );

    const results = buildSessionSearchResults(sessions, projects, "", 5);

    expect(results).toHaveLength(5);
    expect(results[0]?.id).toBe("session-11");
  });
});
