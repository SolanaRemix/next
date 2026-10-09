import type { EvmPortfolioPricesResponse } from "@next/types";

const defaultApiUrl = "http://localhost:3001/api";

function isPrice(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isPriceResponse(
  value: unknown,
  chainId: string,
  addresses: readonly string[],
): value is EvmPortfolioPricesResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  if (
    response.chainId !== chainId ||
    !isPrice(response.nativePriceUsd) ||
    response.source !== "CoinGecko" ||
    typeof response.asOf !== "string" ||
    !Number.isFinite(Date.parse(response.asOf)) ||
    !Array.isArray(response.tokenPrices) ||
    response.tokenPrices.length !== new Set(addresses.map((address) => address.toLowerCase())).size
  ) {
    return false;
  }
  const returned = new Set<string>();
  for (const candidate of response.tokenPrices) {
    if (!candidate || typeof candidate !== "object") return false;
    const token = candidate as Record<string, unknown>;
    if (
      typeof token.address !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(token.address) ||
      !isPrice(token.priceUsd)
    ) return false;
    const address = token.address.toLowerCase();
    if (!addresses.some((requested) => requested.toLowerCase() === address) || returned.has(address)) return false;
    returned.add(address);
  }
  return true;
}

export async function fetchEvmPortfolioPrices(
  chainId: string,
  tokenAddresses: readonly string[],
  accessToken: string,
  signal?: AbortSignal,
): Promise<EvmPortfolioPricesResponse> {
  const baseUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/portfolio/evm-prices`, {
      method: "POST",
      headers: {
        authorization: "Bearer " + accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ chainId, tokenAddresses: [...tokenAddresses] }),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new Error("Portfolio pricing service is unavailable.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data
      ? (data as { message?: unknown }).message
      : null;
    throw new Error(typeof message === "string" ? message : "Portfolio pricing is unavailable.");
  }
  if (!isPriceResponse(data, chainId, tokenAddresses)) {
    throw new Error("Portfolio pricing service returned an invalid response.");
  }
  return data;
}
