export interface ExecutionControlState {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

function isExecutionControlState(value: unknown): value is ExecutionControlState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return typeof state.enabled === "boolean"
    && (state.updatedAt === null
      || (typeof state.updatedAt === "string" && Number.isFinite(Date.parse(state.updatedAt))))
    && (state.updatedBy === null || typeof state.updatedBy === "string");
}

async function errorMessage(response: Response): Promise<string> {
  const data: unknown = await response.json().catch(() => null);
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string") return message.trim().slice(0, 500);
  }
  return "Financial execution control request failed.";
}

async function requestState(response: Response): Promise<ExecutionControlState> {
  if (!response.ok) throw new Error(await errorMessage(response));
  const data: unknown = await response.json().catch(() => null);
  if (!isExecutionControlState(data)) {
    throw new Error("Financial control service returned invalid state.");
  }
  return data;
}

function endpoint(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/admin/financial-controls/execution`;
}

export async function fetchExecutionControl(
  apiUrl: string,
  accessToken: string,
): Promise<ExecutionControlState> {
  const response = await fetch(endpoint(apiUrl), {
    credentials: "include",
    headers: { authorization: "Bearer " + accessToken },
    signal: AbortSignal.timeout(10_000),
  });
  return requestState(response);
}

export async function updateExecutionControl(
  apiUrl: string,
  accessToken: string,
  enabled: boolean,
  reason: string,
): Promise<ExecutionControlState> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 500) {
    throw new Error("Enter a reason between 3 and 500 characters.");
  }
  const response = await fetch(endpoint(apiUrl), {
    method: "PATCH",
    credentials: "include",
    headers: {
      authorization: "Bearer " + accessToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({ enabled, reason: normalizedReason }),
    signal: AbortSignal.timeout(10_000),
  });
  return requestState(response);
}
