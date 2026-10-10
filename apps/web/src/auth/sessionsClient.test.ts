import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSessions, revokeOtherSessions, revokeSession } from "./sessionsClient";

afterEach(() => vi.unstubAllGlobals());

describe("authenticated refresh-session client", () => {
  it("validates and returns sanitized session records", async () => {
    const sessions = [{
      id: "c15c090e-2615-4e52-ad67-f212a4154074",
      createdAt: "2026-10-09T00:00:00.000Z",
      expiresAt: "2026-10-16T00:00:00.000Z",
      revokedAt: null,
      current: true,
    }];
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(sessions), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(fetchSessions("https://api.example/api/", "access-token")).resolves.toEqual(sessions);
    expect(fetch).toHaveBeenCalledWith("https://api.example/api/auth/sessions", expect.objectContaining({
      credentials: "include",
      headers: { authorization: ["Bearer", "access-token"].join(" ") },
    }));
  });

  it("rejects malformed session data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('[{"tokenHash":"secret"}]', { status: 200 })));

    await expect(fetchSessions("/api", "access-token")).rejects.toThrow(/invalid session data/i);
  });

  it("revokes the selected refresh session using the bearer access token", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const sessionId = "c15c090e-2615-4e52-ad67-f212a4154074";

    await expect(revokeSession("/api", "access-token", sessionId)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(`/api/auth/sessions/${sessionId}`, expect.objectContaining({
      method: "DELETE",
      headers: { authorization: ["Bearer", "access-token"].join(" ") },
    }));
  });

  it("surfaces API errors when revocation fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: "Session not found or already revoked." }),
      { status: 404 },
    )));

    await expect(revokeSession("/api", "access-token", "missing"))
      .rejects.toThrow(/Session not found/);
  });

  it("revokes other sessions while preserving the current session", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ revokedCount: 3 }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetch);

    await expect(revokeOtherSessions("/api/", "access-token")).resolves.toBe(3);
    expect(fetch).toHaveBeenCalledWith("/api/auth/sessions/revoke-others", expect.objectContaining({
      method: "DELETE",
      credentials: "include",
      headers: { authorization: ["Bearer", "access-token"].join(" ") },
    }));
  });

  it("rejects invalid other-session revocation results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ revokedCount: -1 }),
      { status: 200 },
    )));

    await expect(revokeOtherSessions("/api", "access-token"))
      .rejects.toThrow(/invalid session revocation result/i);
  });
});
