export interface GeneratorVerifierAssessment {
  verdict: "pass" | "fail";
  rationale: string;
  missingRequirements: string[];
  rawText: string;
}

interface AssessmentParams {
  candidate: string;
  verifierResponse: string;
  providerId?: string;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function failureAssessment(
  rationale: string,
  rawText: string,
  missingRequirements: string[] = [],
): GeneratorVerifierAssessment {
  return {
    verdict: "fail",
    rationale,
    missingRequirements,
    rawText,
  };
}

function passAssessment(
  rationale: string,
  rawText: string,
  missingRequirements: string[] = [],
): GeneratorVerifierAssessment {
  return {
    verdict: "pass",
    rationale,
    missingRequirements,
    rawText,
  };
}

function extractJsonCandidate(text: string): string | undefined {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    return fenced.trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return undefined;
}

function parseJsonAssessment(text: string): GeneratorVerifierAssessment | undefined {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const verdict = parsed.verdict;
    if (verdict !== "pass" && verdict !== "fail") {
      return undefined;
    }

    const rationale = typeof parsed.rationale === "string" && parsed.rationale.trim()
      ? parsed.rationale.trim()
      : verdict === "pass"
        ? "Verifier approved the candidate."
        : "Verifier rejected the candidate.";
    const missingRequirements = Array.isArray(parsed.missingRequirements)
      ? parsed.missingRequirements.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

    return verdict === "pass"
      ? passAssessment(rationale, text, missingRequirements)
      : failureAssessment(rationale, text, missingRequirements);
  } catch {
    return undefined;
  }
}

function parseKeywordAssessment(text: string): GeneratorVerifierAssessment | undefined {
  const verdictMatch = text.match(/^\s*verdict\s*[:=-]\s*["']?(pass|fail)["']?/im)
    ?? text.match(/^\s*(pass|fail)\b/i);
  if (!verdictMatch) {
    return undefined;
  }

  const verdict = verdictMatch[1]?.toLowerCase() === "pass" ? "pass" : "fail";
  const rationaleMatch = text.match(/\brationale\b\s*[:=-]\s*(.+)$/im)
    ?? text.match(/\breason\b\s*[:=-]\s*(.+)$/im);
  const rationale = rationaleMatch?.[1]?.trim()
    || (verdict === "pass"
      ? "Verifier approved the candidate."
      : "Verifier rejected the candidate.");
  return verdict === "pass"
    ? passAssessment(rationale, text)
    : failureAssessment(rationale, text);
}

function hasFailureMarker(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("[tool-error-boundary]")
    || normalized.includes("provider failure")
    || normalized.includes("failed with ")
    || /runtime\s+(error|exception|failure)/i.test(normalized)
    || normalized.includes("unavailable");
}

export function assessGeneratorVerifierResponse(params: AssessmentParams): GeneratorVerifierAssessment {
  const candidate = params.candidate.trim();
  const verifierResponse = params.verifierResponse.trim();

  if (!candidate) {
    return failureAssessment(
      "Generator returned an empty candidate.",
      verifierResponse,
      ["candidate must be non-empty"],
    );
  }

  if (hasFailureMarker(candidate) || hasFailureMarker(verifierResponse)) {
    return failureAssessment(
      "Provider degradation markers were detected in the candidate or verifier response.",
      verifierResponse,
      ["candidate must come from a healthy provider call"],
    );
  }

  if (params.providerId === "local-smoke") {
    return passAssessment(
      "Local smoke provider produced a deterministic non-empty candidate without runtime failure markers.",
      verifierResponse,
    );
  }

  const jsonAssessment = parseJsonAssessment(verifierResponse);
  if (jsonAssessment) {
    return jsonAssessment;
  }

  const keywordAssessment = parseKeywordAssessment(verifierResponse);
  if (keywordAssessment) {
    return keywordAssessment;
  }

  if (normalize(verifierResponse) === normalize(candidate)) {
    return failureAssessment(
      "Verifier echoed the candidate instead of issuing an explicit pass/fail judgment.",
      verifierResponse,
      ["verifier must return an explicit verdict"],
    );
  }

  return failureAssessment(
    "Verifier response did not contain a parseable pass/fail verdict.",
    verifierResponse,
    ["verifier must return JSON or a clear VERDICT line"],
  );
}
