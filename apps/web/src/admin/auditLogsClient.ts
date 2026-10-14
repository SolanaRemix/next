export type AuditJsonValue =
  | null
  | boolean
  | number
  | string
  | AuditJsonValue[]
  | { [key: string]: AuditJsonValue };

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  metadata: AuditJsonValue;
  createdAt: string;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  nextCursor: string | null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isJsonValue(value: unknown, depth = 0): value is AuditJsonValue {
  if (depth > 8) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 4_096;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 100 && value.every((entry) => isJsonValue(entry, depth + 1));
  if (typeof value !== "object") return false;
  const entries = Object.entries(value);
  return entries.length <= 100
    && entries.every(([key, entry]) => key.length <= 120 && isJsonValue(entry, depth + 1));
}

function isAuditLogEntry(value: unknown): value is AuditLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return isUuid(entry.id)
    && (entry.actorId === null || isUuid(entry.actorId))
    && (entry.actorEmail === null || (typeof entry.actorEmail === "string" && entry.actorEmail.length <= 254))
    && typeof entry.action === "string" && entry.action.length > 0 && entry.action.length <= 120
    && isJsonValue(entry.metadata)
    && typeof entry.createdAt === "string"
    && Number.isFinite(Date.parse(entry.createdAt));
}

async function errorMessage(response: Response): Promise<string> {
  const data: unknown = await response.json().catch(() => null);
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string") return message.trim().slice(0, 500);
  }
  return "Audit log request failed.";
}

export async function fetchAuditLogs(
  apiUrl: string,
  accessToken: string,
  filters: { action?: string; actorId?: string; cursor?: string; limit?: number } = {},
): Promise<AuditLogPage> {
  const limit = filters.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Audit page size must be between 1 and 100.");
  }
  const action = filters.action?.trim();
  if (action && action.length > 120) throw new Error("Action filter must not exceed 120 characters.");
  const actorId = filters.actorId?.trim();
  if (actorId && !isUuid(actorId)) throw new Error("Enter a valid actor UUID.");
  if (filters.cursor && !isUuid(filters.cursor)) throw new Error("Invalid audit page cursor.");
  const query = new URLSearchParams({ limit: String(limit) });
  if (action) query.set("action", action);
  if (actorId) query.set("actorId", actorId);
  if (filters.cursor) query.set("cursor", filters.cursor);
  const response = await fetch(
    `${apiUrl.replace(/\/+$/, "")}/admin/audit-logs?${query.toString()}`,
    {
      credentials: "include",
      headers: { authorization: "Bearer " + accessToken },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object") throw new Error("Audit service returned invalid data.");
  const page = data as Record<string, unknown>;
  if (!Array.isArray(page.entries) || page.entries.length > limit || !page.entries.every(isAuditLogEntry)
    || !(page.nextCursor === null || isUuid(page.nextCursor))) {
    throw new Error("Audit service returned invalid data.");
  }
  return { entries: page.entries, nextCursor: page.nextCursor };
}
