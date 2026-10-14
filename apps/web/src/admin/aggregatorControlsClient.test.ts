import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAggregatorControls, updateAggregatorControls } from "./aggregatorControlsClient";

afterEach(() => vi.unstubAllGlobals());

describe("aggregator control client", () => {
  it("loads validated SuperAdmin quote-provider state", async () => {
    const state = {
      enabledProviders: ["0x", "paraswap"],
      updatedAt: "2026-10-14T11:00:00.000Z",
      updatedBy: "admin-id",
    };
    const fetch = vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
      expect(options?.method).toBe("GET");
      expect(new Headers(options?.headers).get("authorization")).toBe(["Bearer", "token"].join(" "));
      return Response.json(state);
    });
    vi.stubGlobal("fetch", fetch);

    await expect(fetchAggregatorControls("http://localhost:3001/api", "token")).resolves.toEqual(state);
  });

  it("sends the enabled selection and audit reason", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
      expect(options?.method).toBe("PATCH");
      expect(JSON.parse(String(options?.body))).toEqual({
        enabledProviders: ["1inch"],
        reason: "incident response",
      });
      return Response.json({
        enabledProviders: ["1inch"],
        updatedAt: null,
        updatedBy: "admin-id",
      });
    });
    vi.stubGlobal("fetch", fetch);

    await updateAggregatorControls(
      "http://localhost:3001/api",
      "token",
      ["1inch"],
      "incident response",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects malformed states and provider failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      enabledProviders: ["unrecognized"],
      updatedAt: null,
      updatedBy: null,
    })));
    await expect(fetchAggregatorControls("http://localhost:3001/api", "token"))
      .rejects.toThrow("invalid response");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(fetchAggregatorControls("http://localhost:3001/api", "token"))
      .rejects.toThrow("Unable to load or update");
  });
});
