import type { OnboardingPreferenceStore, OnboardingProgress } from "@next/types";

const storageKey = "mega-gods-onboarding-v1";

export const localOnboardingStore: OnboardingPreferenceStore = {
  async save(progress) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(progress));
    } catch {
      return;
    }
  },
  async load() {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("step" in parsed) ||
        typeof parsed.step !== "number" ||
        !Number.isInteger(parsed.step) ||
        parsed.step < 0 ||
        parsed.step > 4 ||
        !("completed" in parsed) ||
        typeof parsed.completed !== "boolean" ||
        !("skipped" in parsed) ||
        typeof parsed.skipped !== "boolean" ||
        !("updatedAt" in parsed) ||
        typeof parsed.updatedAt !== "string"
      ) return null;
      return parsed as OnboardingProgress;
    } catch {
      return null;
    }
  },
};

export function backendOnboardingStore(endpoint: string): OnboardingPreferenceStore {
  const normalizedEndpoint = endpoint.replace(/\/+$/, "");
  return {
    async save(progress) {
      await localOnboardingStore.save(progress);
      try {
        await fetch(`${normalizedEndpoint}/onboarding/progress`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(progress),
        });
      } catch {
        return;
      }
    },
    async load() {
      try {
        const response = await fetch(`${normalizedEndpoint}/onboarding/progress`, { credentials: "include" });
        if (response.ok) {
          const data: unknown = await response.json();
          if (isOnboardingProgress(data)) return data;
        }
      } catch {
        return localOnboardingStore.load();
      }
      return localOnboardingStore.load();
    },
  };
}

function isOnboardingProgress(value: unknown): value is OnboardingProgress {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return Number.isInteger(data.step) && typeof data.step === "number" && data.step >= 0 && data.step <= 4 &&
    typeof data.completed === "boolean" && typeof data.skipped === "boolean" && typeof data.updatedAt === "string";
}
