import type { AppLanguage } from "./i18n";

export function getWelcomeGreeting(
  date = new Date(),
  language: AppLanguage = "en",
  projectLabel?: string,
) {
  const hour = date.getHours();
  const trimmedProjectLabel = projectLabel?.trim();

  if (language === "zh") {
    const promptText = trimmedProjectLabel
      ? `想在 ${trimmedProjectLabel} 做点什么？`
      : "想要做点什么？";
    if (hour >= 5 && hour < 12) return `早上好，${promptText}`;
    if (hour >= 12 && hour < 14) return `中午好，${promptText}`;
    if (hour >= 14 && hour < 18) return `下午好，${promptText}`;
    return `晚上好，${promptText}`;
  }

  const promptText = trimmedProjectLabel
    ? `what would you like to do in ${trimmedProjectLabel}?`
    : "what would you like to do?";
  if (hour >= 5 && hour < 12) return `Good morning, ${promptText}`;
  if (hour >= 12 && hour < 18) return `Good afternoon, ${promptText}`;
  return `Good evening, ${promptText}`;
}
