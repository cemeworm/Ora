import { describe, expect, it } from "vitest";
import { getWelcomeGreeting } from "./welcomeGreeting";

describe("welcome greeting", () => {
  it("uses a Chinese greeting for the current time of day", () => {
    expect(getWelcomeGreeting(new Date(2026, 3, 26, 8), "zh")).toBe(
      "早上好，想要做点什么？",
    );
    expect(getWelcomeGreeting(new Date(2026, 3, 26, 12), "zh")).toBe(
      "中午好，想要做点什么？",
    );
    expect(getWelcomeGreeting(new Date(2026, 3, 26, 15), "zh")).toBe(
      "下午好，想要做点什么？",
    );
    expect(getWelcomeGreeting(new Date(2026, 3, 26, 21), "zh")).toBe(
      "晚上好，想要做点什么？",
    );
  });

  it("uses an English greeting when the app language is English", () => {
    expect(getWelcomeGreeting(new Date(2026, 3, 26, 8), "en")).toBe(
      "Good morning, what would you like to do?",
    );
  });

  it("mentions the project when a project label is provided", () => {
    expect(getWelcomeGreeting(new Date(2026, 3, 26, 15), "zh", "ora")).toBe(
      "下午好，想在 ora 做点什么？",
    );
    expect(getWelcomeGreeting(new Date(2026, 3, 26, 15), "en", "ora")).toBe(
      "Good afternoon, what would you like to do in ora?",
    );
  });
});
