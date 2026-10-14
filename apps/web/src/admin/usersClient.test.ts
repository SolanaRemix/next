import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@next/types";
import {
  assignAdminUserRole,
  fetchAdminUsers,
  setAdminUserStatus,
} from "./usersClient";

const user = {
  id: "c15c090e-2615-4e52-ad67-f212a4154074",
  email: "trader@example.com",
  role: "Trader" as const,
  accountStatus: "Active" as const,
  createdAt: "2026-10-09T12:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("SuperAdmin user management client", () => {
  it("loads a validated page with an authenticated cursor request", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json([user]));
    vi.stubGlobal("fetch", fetch);

    await expect(fetchAdminUsers("https://api.example/api/", "admin-token", user.id, 10))
      .resolves.toEqual([user]);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.example/api/auth/users?limit=10&cursor=${user.id}`,
      expect.objectContaining({
        credentials: "include",
        headers: { authorization: ["Bearer", "admin-token"].join(" ") },
      }),
    );
  });

  it("assigns a validated role and rejects a mismatched user response", async () => {
    const updated = { id: user.id, email: user.email, role: "Viewer" as const };
    const fetch = vi.fn().mockResolvedValue(Response.json(updated));
    vi.stubGlobal("fetch", fetch);

    await expect(assignAdminUserRole("/api", "admin-token", user.id, "Viewer")).resolves.toEqual(updated);
    expect(fetch).toHaveBeenCalledWith(`/api/auth/users/${user.id}/role`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ role: "Viewer" }),
    }));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...updated, id: "another-user" })));
    await expect(assignAdminUserRole("/api", "admin-token", user.id, "Viewer"))
      .rejects.toThrow(/different user/i);
  });

  it("changes account status with the enumerated audit reason", async () => {
    const updated = { ...user, accountStatus: "Restricted" as const };
    const fetch = vi.fn().mockResolvedValue(Response.json(updated));
    vi.stubGlobal("fetch", fetch);

    await expect(setAdminUserStatus("/api", "admin-token", user.id, "Restricted", "policy_review"))
      .resolves.toEqual(updated);
    expect(fetch).toHaveBeenCalledWith(`/api/auth/users/${user.id}/status`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ status: "Restricted", reason: "policy_review" }),
    }));
  });

  it("rejects malformed data, unsupported values, and server authorization errors", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json([{ ...user, accountStatus: "Deleted" }]));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchAdminUsers("/api", "viewer-token")).rejects.toThrow(/invalid user data/i);
    await expect(fetchAdminUsers("/api", "admin-token", undefined, 101)).rejects.toThrow(/page size/i);
    await expect(assignAdminUserRole("/api", "admin-token", user.id, "Trader"))
      .rejects.toThrow(/invalid user data/i);
    await expect(assignAdminUserRole("/api", "admin-token", user.id, "invalid" as UserRole))
      .rejects.toThrow(/supported account role/i);
    expect(fetch).toHaveBeenCalledTimes(2);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { message: ["Forbidden resource", "SuperAdmin required"] },
      { status: 403 },
    )));
    await expect(fetchAdminUsers("/api", "viewer-token")).rejects.toThrow(/Forbidden resource SuperAdmin required/);
  });

  it("bounds administrator error messages before returning them to UI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { message: `  ${"x".repeat(700)}  ` },
      { status: 403 },
    )));

    try {
      await fetchAdminUsers("/api", "viewer-token");
    } catch (cause) {
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).toHaveLength(500);
    }
  });
});
