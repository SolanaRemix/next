export interface SessionSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  current: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (!isRecord(value)) return false;
  const session = value;
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
    !isRecord(data) ||
    !("revokedCount" in data) ||
    typeof data.revokedCount !== "number" ||
    !Number.isSafeInteger(data.revokedCount) ||
    data.revokedCount < 0
  ) {
    throw new Error("Authentication service returned an invalid session revocation result.");
  }
  return data.revokedCount;
}

export interface PasswordChangeResult {
  revokedOtherSessions: number;
  accessToken: string;
  expiresIn: number;
}

export async function changePassword(
  apiUrl: string,
  accessToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<PasswordChangeResult> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/auth/password`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      authorization: "Bearer " + accessToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({ currentPassword, newPassword }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data: unknown = await response.json().catch(() => null);
  if (!isRecord(data)) {
    throw new Error("Authentication service returned an invalid password change result.");
  }
  if (
    typeof data.revokedOtherSessions !== "number" ||
    !Number.isSafeInteger(data.revokedOtherSessions) ||
    data.revokedOtherSessions < 0 ||
    typeof data.accessToken !== "string" ||
    data.accessToken.length === 0 ||
    typeof data.expiresIn !== "number" ||
    !Number.isSafeInteger(data.expiresIn) ||
    data.expiresIn < 1 ||
    data.expiresIn > 900
  ) {
    throw new Error("Authentication service returned an invalid password change result.");
  }
  return {
    revokedOtherSessions: data.revokedOtherSessions,
    accessToken: data.accessToken,
    expiresIn: data.expiresIn,
  };
}
