import type { UserRole } from "@next/types";

export type AdminAccountStatus = "Active" | "Restricted";
export type AccountRestrictionReason =
  | "account_compromise"
  | "policy_review"
  | "legal_request"
  | "other";

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  accountStatus: AdminAccountStatus;
  createdAt: string;
}

const userRoles: readonly UserRole[] = [
  "SuperAdmin",
  "EnterpriseAdmin",
  "Trader",
  "Viewer",
  "Guest",
];
const restrictionReasons: readonly AccountRestrictionReason[] = [
  "account_compromise",
  "policy_review",
  "legal_request",
  "other",
];

function isAdminUser(value: unknown): value is AdminUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string"
    && typeof user.email === "string"
    && userRoles.includes(user.role as UserRole)
    && (user.accountStatus === "Active" || user.accountStatus === "Restricted")
    && typeof user.createdAt === "string"
    && Number.isFinite(Date.parse(user.createdAt));
}

async function errorMessage(response: Response): Promise<string> {
  const data: unknown = await response.json().catch(() => null);
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && message.every((entry) => typeof entry === "string")) {
      return message.join(" ");
    }
  }
  return "Administrator user request failed.";
}

async function readObject<T>(
  response: Response,
  isValue: (value: unknown) => value is T,
): Promise<T> {
  if (!response.ok) throw new Error(await errorMessage(response));
  const data: unknown = await response.json().catch(() => null);
  if (!isValue(data)) throw new Error("Administrator service returned invalid user data.");
  return data;
}

function usersEndpoint(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/auth/users`;
}

function authHeaders(accessToken: string): HeadersInit {
  return { authorization: "Bearer " + accessToken };
}

export async function fetchAdminUsers(
  apiUrl: string,
  accessToken: string,
  cursor?: string,
  limit = 50,
): Promise<AdminUser[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("User page size must be between 1 and 100.");
  }
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`${usersEndpoint(apiUrl)}?${query.toString()}`, {
    credentials: "include",
    headers: authHeaders(accessToken),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const data: unknown = await response.json().catch(() => null);
  if (!Array.isArray(data) || !data.every(isAdminUser)) {
    throw new Error("Administrator service returned invalid user data.");
  }
  return data;
}

export async function assignAdminUserRole(
  apiUrl: string,
  accessToken: string,
  userId: string,
  role: UserRole,
): Promise<Pick<AdminUser, "id" | "email" | "role">> {
  if (!userRoles.includes(role)) throw new Error("Select a supported account role.");
  const response = await fetch(`${usersEndpoint(apiUrl)}/${encodeURIComponent(userId)}/role`, {
    method: "PATCH",
    credentials: "include",
    headers: { ...authHeaders(accessToken), "content-type": "application/json" },
    body: JSON.stringify({ role }),
    signal: AbortSignal.timeout(10_000),
  });
  const user = await readObject(response, (value): value is Pick<AdminUser, "id" | "email" | "role"> => {
    if (!value || typeof value !== "object") return false;
    const result = value as Record<string, unknown>;
    return typeof result.id === "string" && typeof result.email === "string"
      && userRoles.includes(result.role as UserRole);
  });
  if (user.id !== userId) throw new Error("Administrator service returned a different user.");
  return user;
}

export async function setAdminUserStatus(
  apiUrl: string,
  accessToken: string,
  userId: string,
  status: AdminAccountStatus,
  reason: AccountRestrictionReason,
): Promise<AdminUser> {
  if (status !== "Active" && status !== "Restricted") {
    throw new Error("Select a supported account status.");
  }
  if (!restrictionReasons.includes(reason)) throw new Error("Select a supported restriction reason.");
  const response = await fetch(`${usersEndpoint(apiUrl)}/${encodeURIComponent(userId)}/status`, {
    method: "PATCH",
    credentials: "include",
    headers: { ...authHeaders(accessToken), "content-type": "application/json" },
    body: JSON.stringify({ status, reason }),
    signal: AbortSignal.timeout(10_000),
  });
  const user = await readObject(response, isAdminUser);
  if (user.id !== userId) throw new Error("Administrator service returned a different user.");
  return user;
}
