import { afterEach, describe, expect, it, vi } from "vitest";
import { changePassword, fetchSessions, revokeOtherSessions, revokeSession } from "./sessionsClient";

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

  it("changes the password with the current session and validates revoked-session count", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        revokedOtherSessions: 2,
        accessToken: "replacement-access-token",
        expiresIn: 900,
      }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetch);

    await expect(changePassword(
      "/api/",
      "access-token",
      "current-secure-password",
      "new-secure-password",
    )).resolves.toEqual({
      revokedOtherSessions: 2,
      accessToken: "replacement-access-token",
      expiresIn: 900,
    });
    expect(fetch).toHaveBeenCalledWith("/api/auth/password", expect.objectContaining({
      method: "PATCH",
      credentials: "include",
      headers: {
        authorization: ["Bearer", "access-token"].join(" "),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        currentPassword: "current-secure-password",
        newPassword: "new-secure-password",
      }),
    }));
  });

  it("rejects malformed password change results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        revokedOtherSessions: "two",
        accessToken: "replacement-access-token",
        expiresIn: 900,
      }),
      { status: 200 },
    )));

    await expect(changePassword("/api", "access-token", "current-password", "new-password"))
      .rejects.toThrow(/invalid password change result/i);
  });
});
