import { describe, expect, it } from "vitest";
import { parseAgentTeamReviewVerdict } from "./mode-driver-helpers.js";

describe("parseAgentTeamReviewVerdict", () => {
  it("parses explicit PASS verdict markers", () => {
    expect(parseAgentTeamReviewVerdict("Verdict: PASS\nEverything checks out.")).toMatchObject({
      verdict: "pass",
      source: "marker",
    });
  });

  it("maps JSON fail-style verdicts to needs_fix", () => {
    expect(parseAgentTeamReviewVerdict("{\"verdict\":\"fail\",\"issues\":[\"Missing tests\"]}")).toMatchObject({
      verdict: "needs_fix",
      source: "json",
      issues: ["Missing tests"],
    });
  });

  it("detects blocked verdicts in Chinese", () => {
    expect(parseAgentTeamReviewVerdict("裁定：阻塞\n- 缺少必要上下文")).toMatchObject({
      verdict: "blocked",
    });
  });

  it("blocks when no verdict is present", () => {
    expect(parseAgentTeamReviewVerdict("The work looks mostly fine, but I'm not sure.")).toMatchObject({
      verdict: "blocked",
      source: "missing",
    });
  });

  it("extracts accepted artifact IDs from JSON verdict", () => {
    const result = parseAgentTeamReviewVerdict(JSON.stringify({
      verdict: "pass",
      acceptedArtifactIds: ["gather", "analyze"],
    }));
    expect(result).toMatchObject({
      verdict: "pass",
      source: "json",
      acceptedArtifactIds: ["gather", "analyze"],
    });
  });

  it("extracts structured findings from JSON verdict", () => {
    const result = parseAgentTeamReviewVerdict(JSON.stringify({
      verdict: "needs_fix",
      findings: [
        { artifactId: "gather", severity: "blocking", issue: "Missing primary sources" },
        { artifactId: "analyze", severity: "concern", issue: "Weak causal reasoning" },
      ],
    }));
    expect(result.verdict).toBe("needs_fix");
    expect(result.findings).toHaveLength(2);
    expect(result.findings![0]).toMatchObject({
      artifactId: "gather",
      severity: "blocking",
      issue: "Missing primary sources",
    });
  });

  it("extracts accepted artifacts from text marker", () => {
    const result = parseAgentTeamReviewVerdict(
      "Verdict: NEEDS_FIX\nRework: gather\nAccepted: analyze\n- Source dossier for competitor analysis is solid",
    );
    expect(result).toMatchObject({
      verdict: "needs_fix",
      reworkNodeIds: ["gather"],
      acceptedArtifactIds: ["analyze"],
    });
  });
});
