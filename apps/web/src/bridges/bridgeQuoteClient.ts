import type {
  CrossChainBridgeQuoteRequest,
  CrossChainBridgeQuoteResponse,
} from "@next/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQuote(value: unknown): value is CrossChainBridgeQuoteResponse {
  if (!isRecord(value) || value.provider !== "LI.FI" ||
      "transactionRequest" in value || "transaction" in value || "calldata" in value ||
      typeof value.fromChainId !== "number" ||
      typeof value.toChainId !== "number" ||
      typeof value.fromToken !== "string" ||
      typeof value.toToken !== "string" ||
      typeof value.fromAmount !== "string" ||
      typeof value.toAmount !== "string" ||
      typeof value.minimumToAmount !== "string" ||
      typeof value.fromTokenSymbol !== "string" ||
      typeof value.toTokenSymbol !== "string" ||
      typeof value.routeTool !== "string" ||
      typeof value.routeToolName !== "string" ||
      (value.estimatedDurationSeconds !== null &&
        (typeof value.estimatedDurationSeconds !== "number" ||
          !Number.isSafeInteger(value.estimatedDurationSeconds))) ||
      !Array.isArray(value.costs) ||
      !value.costs.every((cost) => isRecord(cost) &&
        (cost.kind === "fee" || cost.kind === "gas") &&
        typeof cost.name === "string" &&
        (cost.amount === null || typeof cost.amount === "string") &&
        (cost.tokenSymbol === null || typeof cost.tokenSymbol === "string") &&
        (cost.amountUsd === null || typeof cost.amountUsd === "string")) ||
      typeof value.quotedAt !== "string" ||
      !Number.isFinite(Date.parse(value.quotedAt)) ||
      typeof value.disclaimer !== "string") {
    return false;
  }
  return true;
}

export async function requestBridgeQuote(
  request: CrossChainBridgeQuoteRequest,
  accessToken: string,
): Promise<CrossChainBridgeQuoteResponse> {
  const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/bridges/quote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + accessToken,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error("Cross-chain quote service is unavailable.");
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? (data as { message?: unknown }).message
        : null;
    throw new Error(
      typeof message === "string"
        ? message
        : "No cross-chain quote is currently available.",
    );
  }
  if (!isQuote(data)) {
    throw new Error("Cross-chain quote service returned an invalid response.");
  }
  return data;
}
