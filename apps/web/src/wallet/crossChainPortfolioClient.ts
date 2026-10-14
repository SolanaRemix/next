import type {
  CrossChainPortfolioAccountRequest,
  CrossChainPortfolioAsset,
  CrossChainPortfolioResponse,
  WalletBalance,
} from "@next/types";

const defaultApiUrl = "http://localhost:3001/api";
const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const solanaAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validBalance(value: unknown, account: CrossChainPortfolioAccountRequest): value is WalletBalance {
  if (!isRecord(value) || value.address !== account.address || value.chain !== account.chain
    || typeof value.asset !== "string" || value.asset.length < 1 || value.asset.length > 64
    || typeof value.amount !== "string" || !/^\d+(?:\.\d+)?$/.test(value.amount)
    || value.amount.length > 100 || typeof value.decimals !== "number"
    || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 255
    || (value.kind !== "native" && value.kind !== "token")) return false;
  if (value.kind === "native") return value.tokenAddress === undefined;
  return typeof value.tokenAddress === "string"
    && (account.chain === "evm"
      ? evmAddressPattern.test(value.tokenAddress)
      : solanaAddressPattern.test(value.tokenAddress));
}

function validAsset(
  value: unknown,
  account: CrossChainPortfolioAccountRequest,
): value is CrossChainPortfolioAsset {
  if (!isRecord(value) || !validBalance(value.balance, account)) return false;
  const validPrice = (price: unknown): price is number | null => price === null
    || (typeof price === "number" && Number.isFinite(price) && price >= 0);
  return validPrice(value.priceUsd) && validPrice(value.valueUsd);
}

function validateResponse(
  value: unknown,
  requested: readonly CrossChainPortfolioAccountRequest[],
): value is CrossChainPortfolioResponse {
  if (!isRecord(value) || !Array.isArray(value.accounts) || value.accounts.length !== requested.length
    || typeof value.complete !== "boolean" || typeof value.asOf !== "string"
    || !Number.isFinite(Date.parse(value.asOf))
    || (value.totalUsd !== null
      && (typeof value.totalUsd !== "number" || !Number.isFinite(value.totalUsd) || value.totalUsd < 0))) {
    return false;
  }
  const accounts = value.accounts;
  for (const [index, candidate] of accounts.entries()) {
    const expected = requested[index];
    if (!expected || !isRecord(candidate) || !isRecord(candidate.account)
      || candidate.account.address !== expected.address
      || candidate.account.chain !== expected.chain
      || candidate.account.chainId !== expected.chainId
      || typeof candidate.available !== "boolean" || !Array.isArray(candidate.assets)
      || !candidate.assets.every((asset: unknown) => validAsset(asset, expected))
      || (candidate.totalUsd !== null
        && (typeof candidate.totalUsd !== "number" || !Number.isFinite(candidate.totalUsd) || candidate.totalUsd < 0))) {
      return false;
    }
    if (!candidate.available && (candidate.assets.length !== 0 || candidate.totalUsd !== null)) return false;
  }
  if (value.complete !== (accounts.length > 0 && accounts.every((candidate) => (
    isRecord(candidate) && candidate.available && typeof candidate.totalUsd === "number"
  )))) return false;
  if (value.complete !== (typeof value.totalUsd === "number")) return false;
  return true;
}

export async function fetchCrossChainPortfolio(
  accounts: readonly CrossChainPortfolioAccountRequest[],
  accessToken: string,
  signal?: AbortSignal,
): Promise<CrossChainPortfolioResponse> {
  const baseUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/portfolio/aggregate`, {
      method: "POST",
      headers: {
        authorization: "Bearer " + accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ accounts }),
      signal: signal ?? AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new Error("Cross-chain portfolio service is unavailable.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Unable to load the cross-chain portfolio.");
  if (!validateResponse(data, accounts)) {
    throw new Error("Cross-chain portfolio service returned an invalid response.");
  }
  return data;
}
