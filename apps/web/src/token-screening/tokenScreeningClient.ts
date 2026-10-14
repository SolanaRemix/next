import type {
  EvmTokenRiskScreeningResponse,
  EvmTokenRiskSignals,
  SolanaTokenRiskScreeningResponse,
  SolanaTokenRiskSignals,
} from "@next/types";

const defaultApiUrl = "http://localhost:3001/api";

const booleanSignalKeys = [
  "honeypot",
  "openSource",
  "proxy",
  "mintable",
  "ownershipRecoverable",
  "ownerCanChangeBalance",
  "hiddenOwner",
  "selfDestruct",
  "externalCall",
  "blacklisted",
  "transferPausable",
  "slippageModifiable",
] as const satisfies readonly (keyof EvmTokenRiskSignals)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSignal(value: unknown): value is boolean | null {
  return typeof value === "boolean" || value === null;
}

function isTax(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}

function isSignals(value: unknown): value is EvmTokenRiskSignals {
  if (!isRecord(value)) return false;
  return booleanSignalKeys.every((key) => isSignal(value[key])) &&
    isTax(value.buyTaxPercent) &&
    isTax(value.sellTaxPercent);
}

function isScreeningResponse(value: unknown): value is EvmTokenRiskScreeningResponse {
  if (!isRecord(value)) return false;
  return typeof value.chainId === "string" &&
    typeof value.tokenAddress === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(value.tokenAddress) &&
    value.source === "GoPlus" &&
    (typeof value.riskScore === "number" && Number.isFinite(value.riskScore) &&
      value.riskScore >= 0 && value.riskScore <= 100 || value.riskScore === null) &&
    ["unknown", "low", "medium", "high", "critical"].includes(String(value.riskLevel)) &&
    typeof value.observedSignals === "number" && Number.isInteger(value.observedSignals) &&
    value.observedSignals >= 0 &&
    typeof value.totalSignals === "number" && Number.isInteger(value.totalSignals) &&
    value.totalSignals === 14 && value.observedSignals <= value.totalSignals &&
    isSignals(value.signals) &&
    Array.isArray(value.indicators) &&
    value.indicators.every((indicator) => typeof indicator === "string") &&
    typeof value.asOf === "string" &&
    typeof value.disclaimer === "string";
}

const solanaSignalKeys = [
  "mintable",
  "freezable",
  "closable",
  "balanceMutable",
  "metadataMutable",
  "transferFeeEnabled",
  "transferFeeUpgradable",
  "transferHookPresent",
  "maliciousTransferHook",
  "transferHookUpgradable",
  "defaultAccountFrozen",
  "defaultAccountStateUpgradable",
  "nonTransferable",
  "trustedToken",
] as const satisfies readonly (keyof SolanaTokenRiskSignals)[];

function isSolanaSignals(value: unknown): value is SolanaTokenRiskSignals {
  return isRecord(value) && solanaSignalKeys.every((key) => isSignal(value[key]));
}

function isSolanaScreeningResponse(value: unknown): value is SolanaTokenRiskScreeningResponse {
  return isRecord(value) &&
    value.network === "solana-mainnet" &&
    typeof value.tokenAddress === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.tokenAddress) &&
    value.source === "GoPlus Solana beta" &&
    (typeof value.riskScore === "number" && Number.isFinite(value.riskScore) &&
      value.riskScore >= 0 && value.riskScore <= 100 || value.riskScore === null) &&
    ["unknown", "low", "medium", "high", "critical"].includes(String(value.riskLevel)) &&
    typeof value.observedSignals === "number" && Number.isInteger(value.observedSignals) &&
    value.observedSignals >= 0 &&
    typeof value.totalSignals === "number" && Number.isInteger(value.totalSignals) &&
    value.totalSignals === 14 && value.observedSignals <= value.totalSignals &&
    isSolanaSignals(value.signals) &&
    Array.isArray(value.indicators) &&
    value.indicators.every((indicator) => typeof indicator === "string") &&
    typeof value.asOf === "string" &&
    typeof value.disclaimer === "string";
}

async function fetchScreening(
  url: URL,
  accessToken: string,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: "Bearer " + accessToken },
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new Error("Token screening service is unavailable.");
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(data) && typeof data.message === "string"
      ? data.message
      : "Token screening request was rejected.";
    throw new Error(message);
  }
  return data;
}

export async function screenEvmToken(
  chainId: string,
  tokenAddress: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<EvmTokenRiskScreeningResponse> {
  const baseUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/token-screening/evm`);
  url.searchParams.set("chainId", chainId);
  url.searchParams.set("tokenAddress", tokenAddress);
  const data = await fetchScreening(url, accessToken, signal);
  if (!isScreeningResponse(data)) {
    throw new Error("Token screening service returned an invalid response.");
  }
  return data;
}

export async function screenSolanaToken(
  mint: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<SolanaTokenRiskScreeningResponse> {
  const baseUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/token-screening/solana`);
  url.searchParams.set("mint", mint);
  const data = await fetchScreening(url, accessToken, signal);
  if (!isSolanaScreeningResponse(data)) {
    throw new Error("Token screening service returned an invalid response.");
  }
  return data;
}
