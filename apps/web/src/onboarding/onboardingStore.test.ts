import { afterEach, describe, expect, it } from "vitest";
import { localOnboardingStore } from "./onboardingStore";

describe("local onboarding progress", () => {
  afterEach(() => window.localStorage.clear());

  it("persists and reads a valid step", async () => {
    const progress = { step: 2, completed: false, skipped: false, updatedAt: "2026-10-08T00:00:00.000Z" };
    await localOnboardingStore.save(progress);
    await expect(localOnboardingStore.load()).resolves.toEqual(progress);
  });

  it("ignores malformed stored data", async () => {
    window.localStorage.setItem("mega-gods-onboarding-v1", '{"step":99,"completed":false}');
    await expect(localOnboardingStore.load()).resolves.toBeNull();
  });
});
