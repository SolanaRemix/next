import type {
  SwapQuoteRequest,
  SwapQuoteResponse,
  SwapRouteQuote,
} from "@next/types";

const defaultApiUrl = "http://localhost:3001/api";

function isQuote(value: unknown): value is SwapQuoteResponse {
  if (!value || typeof value !== "object") return false;
  const quote = value as Record<string, unknown>;
  return typeof quote.chainId === "number" &&
    typeof quote.sellToken === "string" &&
    typeof quote.buyToken === "string" &&
    typeof quote.sellAmount === "string" &&
    typeof quote.maxSlippageBps === "number" &&
    Array.isArray(quote.routes) &&
    quote.routes.every(isRoute) &&
    Array.isArray(quote.unavailableProviders) &&
    typeof quote.quotedAt === "string";
}

function isRoute(value: unknown): value is SwapRouteQuote {
  if (!value || typeof value !== "object") return false;
  const route = value as Record<string, unknown>;
  return ["0x", "1inch", "paraswap"].includes(String(route.provider)) &&
    typeof route.buyAmount === "string" &&
    typeof route.minimumBuyAmount === "string" &&
    (route.estimatedGas === undefined || typeof route.estimatedGas === "string");
}

export async function requestSwapQuote(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
  const baseUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/swaps/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new Error("Swap quote service is unavailable.");
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
        : "No aggregator quote is currently available.",
    );
  }
  if (!isQuote(data)) throw new Error("Swap quote service returned an invalid response.");
  return data;
}
