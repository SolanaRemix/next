import type {
  SolanaSwapExecuteRequest,
  SolanaSwapExecuteResponse,
  SolanaSwapOrderRequest,
  SolanaSwapOrderResponse,
} from "@next/types";

const defaultApiUrl = "http://localhost:3001/api";
const base58Pattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrder(value: unknown): value is SolanaSwapOrderResponse {
  if (!isRecord(value)) return false;
  return typeof value.executionId === "string" &&
    typeof value.requestId === "string" &&
    typeof value.transaction === "string" &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value.transaction) &&
    typeof value.inputMint === "string" && base58Pattern.test(value.inputMint) &&
    typeof value.outputMint === "string" && base58Pattern.test(value.outputMint) &&
    typeof value.inAmount === "string" && /^[1-9]\d{0,19}$/.test(value.inAmount) &&
    typeof value.outAmount === "string" && /^[1-9]\d{0,19}$/.test(value.outAmount) &&
    typeof value.minimumOutputAmount === "string" &&
    /^[1-9]\d{0,19}$/.test(value.minimumOutputAmount) &&
    typeof value.slippageBps === "number" &&
    Number.isInteger(value.slippageBps) &&
    (typeof value.prioritizationFeeLamports === "number" ||
      value.prioritizationFeeLamports === null) &&
    (typeof value.router === "string" || value.router === null) &&
    typeof value.expiresAt === "string";
}

function isExecution(value: unknown): value is SolanaSwapExecuteResponse {
  if (!isRecord(value)) return false;
  return (value.status === "processing" || value.status === "success" || value.status === "failed") &&
    (typeof value.signature === "string" || value.signature === null) &&
    (typeof value.error === "string" || value.error === null);
}

async function postJson<T>(
  path: string,
  accessToken: string,
  body: unknown,
  validate: (value: unknown) => value is T,
  failureMessage: string,
): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        authorization: "Bearer " + accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Solana swap service is unavailable.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(data) && typeof data.message === "string"
      ? data.message
      : failureMessage;
    throw new Error(message);
  }
  if (!validate(data)) throw new Error("Solana swap service returned an invalid response.");
  return data;
}

export function requestSolanaSwapOrder(
  request: SolanaSwapOrderRequest,
  accessToken: string,
): Promise<SolanaSwapOrderResponse> {
  return postJson(
    "/swaps/solana/order",
    accessToken,
    request,
    isOrder,
    "Unable to request a Solana swap order.",
  );
}

export function executeSolanaSwap(
  request: SolanaSwapExecuteRequest,
  accessToken: string,
): Promise<SolanaSwapExecuteResponse> {
  return postJson(
    "/swaps/solana/execute",
    accessToken,
    request,
    isExecution,
    "Unable to execute the Solana swap.",
  );
}
