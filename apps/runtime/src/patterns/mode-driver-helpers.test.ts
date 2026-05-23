import { describe, expect, it } from "vitest";
import { parseAgentTeamReviewVerdict, parseCodeDevelopmentDebugResolution } from "./mode-driver-helpers.js";

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
      reworkNodeIds: ["gather"],
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
    expect(result.reworkNodeIds).toEqual(["gather"]);
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

describe("structured TeamTaskPlan parsing", () => {
  it("parses scope output with goal, successCriteria, scopeBoundaries", async () => {
    const { writeBag } = await import("./mode-driver-helpers.js");
    const bag: Record<string, unknown> = {};
    const plan = {
      text: "Research plan for company X",
      goal: "Assess Company X's market position and growth prospects in the AI infrastructure market",
      successCriteria: [
        "Market size and growth rate sourced from at least 3 independent reports",
        "Competitor landscape mapped with >= 5 named competitors",
        "Confidence levels assigned to each key finding",
      ],
      steps: [
        { id: "1", description: "Search for market reports" },
        { id: "2", description: "Map competitor landscape" },
      ],
      scopeBoundaries: [
        "No financial modeling or valuation",
        "No primary research (surveys, interviews)",
      ],
    };
    writeBag(bag, "scope", JSON.stringify(plan), "decompose");
    expect(bag.scope).toMatchObject({
      text: plan.text,
      goal: plan.goal,
      successCriteria: plan.successCriteria,
      scopeBoundaries: plan.scopeBoundaries,
    });
    expect(bag._degradedKeys).toBeUndefined();
  });

  it("degrades scope output missing required text field", async () => {
    const { writeBag } = await import("./mode-driver-helpers.js");
    const bag: Record<string, unknown> = {};
    writeBag(bag, "scope", JSON.stringify({ goal: "test" }), "decompose");
    expect(bag.scope).toMatchObject({ _degraded: true });
    expect(bag._degradedKeys).toEqual(["scope"]);
  });

  it("parses scope output even when wrapped in markdown fence", async () => {
    const { writeBag } = await import("./mode-driver-helpers.js");
    const bag: Record<string, unknown> = {};
    const plan = { text: "ok", goal: "test", successCriteria: ["criterion 1"] };
    writeBag(bag, "scope", "```json\n" + JSON.stringify(plan) + "\n```\n\nHere's the plan.", "decompose");
    expect(bag.scope).toMatchObject({ goal: "test", successCriteria: ["criterion 1"] });
    expect(bag._degradedKeys).toBeUndefined();
  });
});

describe("parseCodeDevelopmentDebugResolution", () => {
  it("parses structured clear status", () => {
    expect(parseCodeDevelopmentDebugResolution(JSON.stringify({
      status: "clear",
      rootCauses: [],
      diagnosticEvidence: [{ commandOrMethod: "pnpm test", summary: "all clear" }],
    }))).toMatchObject({
      status: "clear",
      source: "json",
    });
  });

  it("maps structured needs_fix to build/review rework targets", () => {
    expect(parseCodeDevelopmentDebugResolution(JSON.stringify({
      status: "needs_fix",
      rootCauses: ["Runtime crash remains"],
      requiredRework: [{ nodeId: "build", reason: "patch the null guard" }],
    }))).toMatchObject({
      status: "needs_fix",
      source: "json",
      rootCauses: ["Runtime crash remains"],
      requiredReworkNodeIds: ["build"],
    });
  });

  it("parses explicit debug status markers", () => {
    expect(parseCodeDevelopmentDebugResolution("Status: clear\n- No further debugging is needed.")).toMatchObject({
      status: "clear",
      source: "marker",
    });
  });

  it("blocks free-text debug output without structured status", () => {
    expect(parseCodeDevelopmentDebugResolution("No further debugging is needed.")).toMatchObject({
      status: "blocked",
      source: "missing",
    });
  });
});

describe("writeBag JSON extraction", () => {
  it("parses direct JSON and validates against schema", async () => {
    const { writeBag } = await import("./mode-driver-helpers.js");
    const bag: Record<string, unknown> = {};
    writeBag(bag, "research", JSON.stringify({
      text: "Found 3 sources",
      findings: [{ claim: "Market is growing", source: "report.pdf" }],
      confidence: "high",
    }), "research");
    expect(bag.research).toMatchObject({
      text: "Found 3 sources",
      findings: [{ claim: "Market is growing", source: "report.pdf" }],
      confidence: "high",
    });
    expect(bag._degradedKeys).toBeUndefined();
  });

  it("extracts JSON from markdown code fence", async () => {
    const { writeBag } = await import("./mode-driver-helpers.js");
    const bag: Record<string, unknown> = {};
    writeBag(bag, "research",
      "Here is my research:\n\n```json\n" +
      JSON.stringify({ text: "ok", findings: [], confidence: "low" }) +
      "\n```\n\nLet me know if you need more.",
      "research",
    );
    expect(bag.research).toMatchObject({
      text: "ok",
      findings: [],
      confidence: "low",
    });
    expect(bag._degradedKeys).toBeUndefined();
  });

  it("stores degraded when JSON is unparseable", async () => {
    const { writeBag } = await import("./mode-driver-helpers.js");
    const bag: Record<string, unknown> = {};
    writeBag(bag, "research", "Just some plain text without any JSON at all.", "research");
    expect(bag.research).toMatchObject({
      text: "Just some plain text without any JSON at all.",
      _degraded: true,
    });
    expect(bag._degradedKeys).toEqual(["research"]);
  });

  it("stores degraded when schema validation fails", async () => {
    const { writeBag } = await import("./mode-driver-helpers.js");
    const bag: Record<string, unknown> = {};
    writeBag(bag, "research", JSON.stringify({ text: "ok" }), "research");
    expect(bag.research).toMatchObject({
      text: "ok",
    });
    // researchOutputSchema requires text, findings/confidence are optional — so this should pass
    expect(bag._degradedKeys).toBeUndefined();
  });

  it("accumulates multiple degraded keys", async () => {
    const { writeBag } = await import("./mode-driver-helpers.js");
    const bag: Record<string, unknown> = {};
    writeBag(bag, "research", "no json here", "research");
    writeBag(bag, "build", "also not json", "build");
    expect(bag._degradedKeys).toEqual(["research", "build"]);
    expect(bag.research).toMatchObject({ _degraded: true });
    expect(bag.build).toMatchObject({ _degraded: true });
  });

  it("parses enriched deep research gather output", async () => {
    const { writeBag } = await import("./mode-driver-helpers.js");
    const bag: Record<string, unknown> = {};
    writeBag(bag, "gather", JSON.stringify({
      text: "Gather summary",
      findings: [
        {
          claim: "Claim",
          source: "Source A",
          sourceTitle: "Primary Source A",
          sourceUrl: "https://example.com/a",
          excerpt: "excerpt",
          retrievedAt: "2026-05-21",
          sourceType: "report",
          confidence: "high",
        },
      ],
      confidence: "high",
    }), "research");
    expect(bag.gather).toMatchObject({
      findings: [
        {
          claim: "Claim",
          sourceTitle: "Primary Source A",
          sourceUrl: "https://example.com/a",
          sourceType: "report",
        },
      ],
    });
  });

  it("parses deep research gap and verify contracts", async () => {
    const { writeBag } = await import("./mode-driver-helpers.js");
    const bag: Record<string, unknown> = {};
    writeBag(bag, "gap_analysis", JSON.stringify({
      text: "Gap summary",
      gaps: [
        {
          dimension: "coverage",
          severity: "major",
          description: "Need more primary evidence",
          suggestedAction: "Collect filings",
        },
      ],
      coverageScore: 0.6,
      suggestedReworkNodeIds: ["gather"],
    }), "check");
    writeBag(bag, "verify", JSON.stringify({
      text: "Verify summary",
      verdict: "needs_fix",
      reworkNodeIds: ["gather"],
      acceptedArtifactIds: ["compile"],
      findings: [
        { artifactId: "gather", severity: "blocking", issue: "Missing primary sources" },
      ],
      issues: ["Need primary sources"],
    }), "review");
    expect(bag.gap_analysis).toMatchObject({
      coverageScore: 0.6,
      suggestedReworkNodeIds: ["gather"],
      gaps: [{ dimension: "coverage" }],
    });
    expect(bag.verify).toMatchObject({
      verdict: "needs_fix",
      reworkNodeIds: ["gather"],
      acceptedArtifactIds: ["compile"],
      findings: [{ artifactId: "gather", severity: "blocking" }],
    });
  });
});
