import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAuditLogs } from "./auditLogsClient";

const page = {
  entries: [{
    id: "c15c090e-2615-4e52-ad67-f212a4154074",
    actorId: "afe6024a-5cd2-48d4-b47c-69f0c73aa161",
    actorEmail: "admin@example.com",
    action: "admin.user.role_changed",
    metadata: { outcome: "success", previousRole: "Guest", newRole: "Trader" },
    createdAt: "2026-10-09T12:00:00.000Z",
  }],
  nextCursor: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("SuperAdmin audit log client", () => {
  it("requests authenticated, filtered pages and validates records", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(page));
    vi.stubGlobal("fetch", fetch);

    await expect(fetchAuditLogs("https://api.example/api/", "admin-token", {
      action: " admin.user.role_changed ",
      actorId: page.entries[0]!.actorId!,
      limit: 20,
    })).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.example/api/admin/audit-logs?limit=20&action=admin.user.role_changed&actorId=${page.entries[0]!.actorId}`,
      expect.objectContaining({
        credentials: "include",
        headers: { authorization: ["Bearer", "admin-token"].join(" ") },
      }),
    );
  });

  it("rejects malformed responses, invalid filters, and forbidden requests", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      ...page,
      entries: [{ ...page.entries[0], metadata: { nested: [[[[[[[[[[["too deep"]]]]]]]]]]] } }],
    }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchAuditLogs("/api", "admin-token")).rejects.toThrow(/invalid data/i);
    await expect(fetchAuditLogs("/api", "admin-token", { actorId: "not-a-uuid" }))
      .rejects.toThrow(/valid actor UUID/i);
    expect(fetch).toHaveBeenCalledOnce();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { message: "Forbidden resource" },
      { status: 403 },
    )));
    await expect(fetchAuditLogs("/api", "viewer-token")).rejects.toThrow("Forbidden resource");
  });
});
