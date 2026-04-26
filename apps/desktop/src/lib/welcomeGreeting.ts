import type { AppLanguage } from "./i18n";

export function getWelcomeGreeting(
  date = new Date(),
  language: AppLanguage = "en",
) {
  const hour = date.getHours();

  if (language === "zh") {
    if (hour >= 5 && hour < 12) return "早上好，想要做点什么？";
    if (hour >= 12 && hour < 14) return "中午好，想要做点什么？";
    if (hour >= 14 && hour < 18) return "下午好，想要做点什么？";
    return "晚上好，想要做点什么？";
  }

  if (hour >= 5 && hour < 12) return "Good morning, what would you like to do?";
  if (hour >= 12 && hour < 18)
    return "Good afternoon, what would you like to do?";
  return "Good evening, what would you like to do?";
}
