import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { registerAppServiceWorker } from "./serviceWorker";

interface FetchEventMock {
  request: {
    method: string;
    url: string;
    mode: string;
    destination: string;
    headers: { has(name: string): boolean };
  };
  respondWith: (response: Promise<unknown>) => void;
  waitUntil: (promise: Promise<unknown>) => void;
}

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

describe("service worker cache policy", () => {
  it("never intercepts API or authenticated requests but serves cached static assets", async () => {
    const script = await readFile("public/sw.js", "utf8");
    const listeners = new Map<string, (event: FetchEventMock) => void>();
    const fetch = vi.fn();
    const caches = { match: vi.fn().mockResolvedValue("cached asset") };
    const workerGlobal = {
      location: { origin: "https://app.test" },
      addEventListener: vi.fn((name: string, listener: (event: FetchEventMock) => void) => {
        listeners.set(name, listener);
      }),
    };
    runInNewContext(script, { self: workerGlobal, caches, fetch, URL, Set, Promise });
    const handleFetch = listeners.get("fetch");
    if (!handleFetch) throw new Error("Service worker fetch handler was not registered.");

    const ignoredRequests = [
      { method: "GET", url: "https://app.test/api/portfolio/evm-prices", mode: "cors", destination: "", headers: { has: () => false } },
      { method: "GET", url: "https://app.test/assets/app.js", mode: "cors", destination: "script", headers: { has: (name: string) => name === "authorization" } },
      { method: "GET", url: "https://api.test/assets/app.js", mode: "cors", destination: "script", headers: { has: () => false } },
    ];
    for (const request of ignoredRequests) {
      handleFetch({ request, respondWith: vi.fn(), waitUntil: vi.fn() });
    }
    expect(caches.match).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    const respondWith = vi.fn();
    handleFetch({
      request: {
        method: "GET",
        url: "https://app.test/assets/app.js",
        mode: "cors",
        destination: "script",
        headers: { has: () => false },
      },
      respondWith,
      waitUntil: vi.fn(),
    });
    expect(respondWith).toHaveBeenCalledOnce();
    await expect(respondWith.mock.calls[0]?.[0]).resolves.toBe("cached asset");
  });
});
