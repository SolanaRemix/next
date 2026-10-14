import type { PortfolioPricesResponse } from "@next/types";

const defaultApiUrl = "http://localhost:3001/api";

function isPrice(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isPriceResponse(
  value: unknown,
  chainId: string,
  addresses: readonly string[],
  isValidAddress: (address: string) => boolean,
  normalizeAddress: (address: string) => string,
): value is PortfolioPricesResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  if (
    response.chainId !== chainId ||
    !isPrice(response.nativePriceUsd) ||
    response.source !== "CoinGecko" ||
    typeof response.asOf !== "string" ||
    !Number.isFinite(Date.parse(response.asOf)) ||
    !Array.isArray(response.tokenPrices) ||
    response.tokenPrices.length !== new Set(addresses.map(normalizeAddress)).size
  ) {
    return false;
  }
  const returned = new Set<string>();
  for (const candidate of response.tokenPrices) {
    if (!candidate || typeof candidate !== "object") return false;
    const token = candidate as Record<string, unknown>;
    if (
      typeof token.address !== "string" ||
      !isValidAddress(token.address) ||
      !isPrice(token.priceUsd)
    ) return false;
    const address = normalizeAddress(token.address);
    if (!addresses.some((requested) => normalizeAddress(requested) === address) || returned.has(address)) return false;
    returned.add(address);
  }
  return true;
}

export async function fetchEvmPortfolioPrices(
  chainId: string,
  tokenAddresses: readonly string[],
  accessToken: string,
  signal?: AbortSignal,
): Promise<PortfolioPricesResponse> {
  return fetchPortfolioPrices(
    "evm",
    chainId,
    tokenAddresses,
    accessToken,
    signal,
  );
}

export async function fetchSolanaPortfolioPrices(
  chainId: string,
  tokenMints: readonly string[],
  accessToken: string,
  signal?: AbortSignal,
): Promise<PortfolioPricesResponse> {
  return fetchPortfolioPrices("solana", chainId, tokenMints, accessToken, signal);
}

async function fetchPortfolioPrices(
  chain: "evm" | "solana",
  chainId: string,
  tokenAddresses: readonly string[],
  accessToken: string,
  signal?: AbortSignal,
): Promise<PortfolioPricesResponse> {
  const baseUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/portfolio/${chain}-prices`, {
      method: "POST",
      headers: {
        authorization: "Bearer " + accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chainId,
        ...(chain === "evm" ? { tokenAddresses: [...tokenAddresses] } : { tokenMints: [...tokenAddresses] }),
      }),
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
  const validAddress = chain === "evm"
    ? (address: string) => /^0x[a-fA-F0-9]{40}$/.test(address)
    : (address: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  const normalizeAddress = chain === "evm"
    ? (address: string) => address.toLowerCase()
    : (address: string) => address;
  if (!isPriceResponse(data, chainId, tokenAddresses, validAddress, normalizeAddress)) {
    throw new Error("Portfolio pricing service returned an invalid response.");
  }
  return data;
}
