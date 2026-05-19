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

type UpdaterCheck = () => Promise<{
  version: string;
} | null>;

type ReleasePageInfo = {
  latestVersion?: string;
  releaseUrl?: string;
  error?: string;
};

export async function checkOraReleaseUpdate(
  checkImpl: UpdaterCheck,
  fetchImpl: ReleaseFetch = fetch,
): Promise<ReleaseUpdateStatus> {
  const [releaseInfo, updateResult] = await Promise.allSettled([
    fetchOraReleasePageInfo(fetchImpl),
    checkImpl(),
  ]);

  const resolvedReleaseInfo = releaseInfo.status === "fulfilled"
    ? releaseInfo.value
    : {
        error: releaseInfo.reason instanceof Error
          ? releaseInfo.reason.message
          : "GitHub release check failed.",
      };

  if (updateResult.status === "fulfilled") {
    const update = updateResult.value;
    if (!update) {
      return {
        available: false,
        latestVersion: resolvedReleaseInfo.latestVersion,
        releaseUrl: resolvedReleaseInfo.releaseUrl,
        error: resolvedReleaseInfo.error,
      };
    }

    return {
      available: true,
      latestVersion: update.version,
      releaseUrl: resolvedReleaseInfo.releaseUrl,
      error: resolvedReleaseInfo.error,
    };
  }

  return {
    available: false,
    latestVersion: resolvedReleaseInfo.latestVersion,
    releaseUrl: resolvedReleaseInfo.releaseUrl,
    error: updateResult.reason instanceof Error
      ? updateResult.reason.message
      : "Ora updater check failed.",
  };
}

async function fetchOraReleasePageInfo(
  fetchImpl: ReleaseFetch = fetch,
): Promise<ReleasePageInfo> {
  try {
    const response = await fetchImpl(ORA_LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      return { error: "GitHub release check failed." };
    }

    const payload = await response.json();
    if (!isRecord(payload)) {
      return { error: "GitHub release response was malformed." };
    }

    const latestVersion = stringValue(payload.tag_name);
    const releaseUrl = stringValue(payload.html_url);
    return { latestVersion, releaseUrl };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "GitHub release check failed.",
    };
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
