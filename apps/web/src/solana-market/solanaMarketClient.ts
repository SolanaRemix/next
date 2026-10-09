import type { SolanaMarketSearchResponse, SolanaMarketToken } from "@next/types";

const defaultApiUrl = "http://localhost:3001/api";

function isToken(value: unknown): value is SolanaMarketToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Record<string, unknown>;
  return typeof token.mint === "string" &&
    typeof token.name === "string" &&
    typeof token.symbol === "string" &&
    (typeof token.decimals === "number" || token.decimals === null) &&
    (typeof token.logoUri === "string" || token.logoUri === null) &&
    (typeof token.priceUsd === "number" || token.priceUsd === null) &&
    (typeof token.marketSpreadBps === "number" || token.marketSpreadBps === null) &&
    (typeof token.liquidityUsd === "number" || token.liquidityUsd === null) &&
    (typeof token.volume24hUsd === "number" || token.volume24hUsd === null) &&
    Array.isArray(token.venues) && token.venues.every((venue) => typeof venue === "string") &&
    (token.priceSource === "Jupiter" || token.priceSource === "DEX Screener" ||
      token.priceSource === null);
}

function isMarketResponse(value: unknown): value is SolanaMarketSearchResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return typeof response.query === "string" &&
    Array.isArray(response.tokens) && response.tokens.every(isToken) &&
    Array.isArray(response.unavailableProviders) &&
    response.unavailableProviders.every((provider) =>
      provider === "Jupiter" || provider === "DEX Screener") &&
    typeof response.asOf === "string";
}

export async function searchSolanaMarket(
  query: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<SolanaMarketSearchResponse> {
  const baseUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
  let response: Response;
  try {
    const url = new URL(`${baseUrl.replace(/\/+$/, "")}/solana-market/search`);
    url.searchParams.set("query", query);
    response = await fetch(url, {
      headers: { authorization: "Bearer " + accessToken },
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new Error("Solana market data service is unavailable.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data
      ? (data as { message?: unknown }).message
      : null;
    throw new Error(typeof message === "string" ? message : "No Solana market data is available.");
  }
  if (!isMarketResponse(data)) throw new Error("Market data service returned an invalid response.");
  return data;
}
