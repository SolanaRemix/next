import type {
  EvmSwapExecuteResponse,
  EvmSwapOrderRequest,
  EvmSwapOrderResponse,
} from "@next/types";

const defaultApiUrl = "http://localhost:3001/api";

function isEvmOrder(value: unknown): value is EvmSwapOrderResponse {
  if (!value || typeof value !== "object") return false;
  const order = value as Record<string, unknown>;
  const transaction = order.transaction;
  return typeof order.executionId === "string" &&
    typeof order.chainId === "number" &&
    typeof order.taker === "string" &&
    typeof order.sellToken === "string" &&
    typeof order.buyToken === "string" &&
    typeof order.sellAmount === "string" &&
    typeof order.buyAmount === "string" &&
    typeof order.minimumBuyAmount === "string" &&
    typeof order.allowanceSpender === "string" &&
    typeof order.expiresAt === "string" &&
    transaction !== null && typeof transaction === "object" &&
    typeof (transaction as Record<string, unknown>).to === "string" &&
    typeof (transaction as Record<string, unknown>).data === "string" &&
    typeof (transaction as Record<string, unknown>).value === "string";
}

function isExecution(value: unknown): value is EvmSwapExecuteResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return ["processing", "success", "failed"].includes(String(result.status)) &&
    (result.transactionHash === null || typeof result.transactionHash === "string") &&
    (result.error === null || typeof result.error === "string");
}

async function apiRequest<T>(
  path: string,
  accessToken: string,
  method: "GET" | "POST",
  body: unknown,
  validate: (value: unknown) => value is T,
): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      method,
      headers: {
        authorization: "Bearer " + accessToken,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("EVM swap service is unavailable.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data
      ? (data as { message?: unknown }).message
      : null;
    throw new Error(typeof message === "string" ? message : "EVM swap request failed.");
  }
  if (!validate(data)) throw new Error("EVM swap service returned an invalid response.");
  return data;
}

export function requestEvmSwapOrder(
  request: EvmSwapOrderRequest,
  accessToken: string,
): Promise<EvmSwapOrderResponse> {
  return apiRequest("/swaps/evm/order", accessToken, "POST", request, isEvmOrder);
}

export function submitEvmSwap(
  executionId: string,
  transactionHash: string,
  idempotencyKey: string,
  accessToken: string,
): Promise<EvmSwapExecuteResponse> {
  return apiRequest("/swaps/evm/execute", accessToken, "POST", {
    executionId,
    transactionHash,
    idempotencyKey,
  }, isExecution);
}

export function getEvmSwapStatus(
  executionId: string,
  accessToken: string,
): Promise<EvmSwapExecuteResponse> {
  return apiRequest(
    `/swaps/evm/${encodeURIComponent(executionId)}`,
    accessToken,
    "GET",
    null,
    isExecution,
  );
}
