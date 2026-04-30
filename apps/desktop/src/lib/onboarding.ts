export type OnboardingStatus = "completed" | "skipped";

export const ONBOARDING_STORAGE_KEY = "ora.onboarding.v1";

export function readOnboardingStatus(): OnboardingStatus | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const value = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
  return value === "completed" || value === "skipped" ? value : undefined;
}

export function writeOnboardingStatus(status: OnboardingStatus) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, status);
}

export function clearOnboardingStatus() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
}
