import { describe, expect, it, vi } from "vitest";
import { registerAppServiceWorker } from "./serviceWorker";

describe("registerAppServiceWorker", () => {
  it("registers only in production", () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const serviceWorker = { register } as unknown as ServiceWorkerContainer;

    registerAppServiceWorker(false, serviceWorker);
    expect(register).not.toHaveBeenCalled();

    registerAppServiceWorker(true, serviceWorker);
    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("tolerates browsers without service worker support", () => {
    expect(() => registerAppServiceWorker(true, undefined)).not.toThrow();
  });

  it("contains registration failures without rejecting application startup", async () => {
    const register = vi.fn().mockRejectedValue(new Error("registration denied"));
    const serviceWorker = { register } as unknown as ServiceWorkerContainer;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => registerAppServiceWorker(true, serviceWorker)).not.toThrow();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
  });
});
