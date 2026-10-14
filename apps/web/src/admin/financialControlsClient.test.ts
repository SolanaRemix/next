import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchExecutionControl, updateExecutionControl } from "./financialControlsClient";

const state = {
  enabled: false,
  updatedAt: "2026-10-09T12:00:00.000Z",
  updatedBy: "admin-uuid",
};

afterEach(() => vi.unstubAllGlobals());

describe("financial execution control client", () => {
  it("loads and validates the authenticated control state", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(state));
    vi.stubGlobal("fetch", fetch);

    await expect(fetchExecutionControl("https://api.example/api/", "access-token")).resolves.toEqual(state);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example/api/admin/financial-controls/execution",
      expect.objectContaining({
        credentials: "include",
        headers: { authorization: "Bearer " + "access-token" },
      }),
    );
  });

  it("updates the control with a trimmed reason and returns its validated state", async () => {
    const enabledState = { ...state, enabled: true };
    const fetch = vi.fn().mockResolvedValue(Response.json(enabledState));
    vi.stubGlobal("fetch", fetch);

    await expect(updateExecutionControl("/api", "access-token", true, "  Approved rollout  "))
      .resolves.toEqual(enabledState);
    expect(fetch).toHaveBeenCalledWith("/api/admin/financial-controls/execution", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ enabled: true, reason: "Approved rollout" }),
    }));
  });

  it("rejects invalid response data and invalid reasons without making a request", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ enabled: "true" }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchExecutionControl("/api", "access-token")).rejects.toThrow(/invalid state/i);
    await expect(updateExecutionControl("/api", "access-token", false, "  "))
      .rejects.toThrow(/reason between 3 and 500/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces server authorization and availability errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { message: "Forbidden resource" },
      { status: 403 },
    )));

    await expect(fetchExecutionControl("/api", "viewer-token")).rejects.toThrow("Forbidden resource");
  });
});
