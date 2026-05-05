import desktopPackage from "../../package.json";

const ORA_LATEST_RELEASE_URL = "https://api.github.com/repos/cemeworm/Ora/releases/latest";

export type ReleaseUpdateStatus = {
  available: boolean;
  latestVersion?: string;
  releaseUrl?: string;
  error?: string;
};

type ReleaseFetch = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

export async function checkOraReleaseUpdate(
  fetchImpl: ReleaseFetch = fetch,
  currentVersion = desktopPackage.version,
): Promise<ReleaseUpdateStatus> {
  try {
    const response = await fetchImpl(ORA_LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      return { available: false, error: "GitHub release check failed." };
    }

    const payload = await response.json();
    if (!isRecord(payload)) {
      return { available: false, error: "GitHub release response was malformed." };
    }

    const latestVersion = stringValue(payload.tag_name);
    const releaseUrl = stringValue(payload.html_url);
    if (!latestVersion || !releaseUrl || !isReleaseNewer(latestVersion, currentVersion)) {
      return { available: false, latestVersion, releaseUrl };
    }

    return { available: true, latestVersion, releaseUrl };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "GitHub release check failed.",
    };
  }
}

export function isReleaseNewer(latestVersion: string, currentVersion: string): boolean {
  const latest = parseReleaseVersion(latestVersion);
  const current = parseReleaseVersion(currentVersion);
  if (!latest || !current) return false;

  const length = Math.max(latest.length, current.length);
  for (let index = 0; index < length; index += 1) {
    const latestPart = latest[index] ?? 0;
    const currentPart = current[index] ?? 0;
    if (latestPart > currentPart) return true;
    if (latestPart < currentPart) return false;
  }
  return false;
}

function parseReleaseVersion(value: string): number[] | undefined {
  const match = value.trim().match(/^v?(\d+(?:\.\d+){0,2})(?:[-+].*)?$/i);
  if (!match) return undefined;
  return match[1].split(".").map((part) => Number(part));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
