import type {
  PerpetualRiskCheckRequest,
  PerpetualRiskCheckResult,
} from "@next/types";

const defaultApiUrl = "http://localhost:3001/api";

function isRiskCheckResult(value: unknown): value is PerpetualRiskCheckResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.eligible === "boolean" &&
    (typeof result.reason === "string" || result.reason === null) &&
    [
      "notional",
      "initialMargin",
      "requiredMargin",
      "estimatedLiquidationPrice",
      "unrealizedPnlAtMark",
      "maintenanceMarginAtMark",
    ].every((key) => typeof result[key] === "number" && Number.isFinite(result[key]));
}

export async function checkPerpetualRisk(
  request: PerpetualRiskCheckRequest,
): Promise<PerpetualRiskCheckResult> {
  const baseUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/perpetuals/risk-check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new Error("Risk service is unavailable. No order was submitted.");
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const serverMessage =
      data && typeof data === "object" && "message" in data
        ? (data as { message?: unknown }).message
        : null;
    throw new Error(
      typeof serverMessage === "string"
        ? serverMessage
        : "Risk check request was rejected. No order was submitted.",
    );
  }
  if (!isRiskCheckResult(data)) {
    throw new Error("Risk service returned an invalid response. No order was submitted.");
  }
  return data;
}
