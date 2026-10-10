export interface SessionSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  current: boolean;
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return typeof session.id === "string" &&
    typeof session.createdAt === "string" &&
    Number.isFinite(Date.parse(session.createdAt)) &&
    typeof session.expiresAt === "string" &&
    Number.isFinite(Date.parse(session.expiresAt)) &&
    (session.revokedAt === null ||
      (typeof session.revokedAt === "string" && Number.isFinite(Date.parse(session.revokedAt)))) &&
    typeof session.current === "boolean";
}

async function readError(response: Response): Promise<string> {
  const data: unknown = await response.json().catch(() => null);
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string") return message.slice(0, 500);
  }
  return "Session request failed.";
}

export async function fetchSessions(apiUrl: string, accessToken: string): Promise<SessionSummary[]> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/auth/sessions`, {
    credentials: "include",
    headers: { authorization: "Bearer " + accessToken },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data: unknown = await response.json().catch(() => null);
  if (!Array.isArray(data) || !data.every(isSessionSummary)) {
    throw new Error("Authentication service returned invalid session data.");
  }
  return data;
}

export async function revokeSession(
  apiUrl: string,
  accessToken: string,
  sessionId: string,
): Promise<void> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { authorization: "Bearer " + accessToken },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function revokeOtherSessions(
  apiUrl: string,
  accessToken: string,
): Promise<number> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/auth/sessions/revoke-others`, {
    method: "DELETE",
    credentials: "include",
    headers: { authorization: "Bearer " + accessToken },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data: unknown = await response.json().catch(() => null);
  if (
    !data ||
    typeof data !== "object" ||
    !("revokedCount" in data) ||
    typeof data.revokedCount !== "number" ||
    !Number.isSafeInteger(data.revokedCount) ||
    data.revokedCount < 0
  ) {
    throw new Error("Authentication service returned an invalid session revocation result.");
  }
  return data.revokedCount;
}
