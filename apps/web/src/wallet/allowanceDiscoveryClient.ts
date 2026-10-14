import type {
  DiscoveredEvmAllowance,
  EvmAllowanceDiscoveryRequest,
  EvmAllowanceDiscoveryResponse,
} from "@next/types";

const defaultApiUrl = "http://localhost:3001/api";
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApproval(value: unknown): value is DiscoveredEvmAllowance {
  if (!isRecord(value)) return false;
  return typeof value.tokenAddress === "string" && addressPattern.test(value.tokenAddress)
    && typeof value.tokenSymbol === "string" && value.tokenSymbol.length > 0 && value.tokenSymbol.length <= 32
    && typeof value.tokenDecimals === "number" && Number.isInteger(value.tokenDecimals)
    && value.tokenDecimals >= 0 && value.tokenDecimals <= 36
    && typeof value.spender === "string" && addressPattern.test(value.spender)
    && typeof value.allowanceRaw === "string" && /^(?:0|[1-9]\d{0,77})$/.test(value.allowanceRaw)
    && typeof value.allowance === "string" && /^\d+(?:\.\d+)?$/.test(value.allowance)
    && typeof value.lastApprovalBlock === "string" && /^(?:0|[1-9]\d{0,19})$/.test(value.lastApprovalBlock);
}

function isResponse(
  value: unknown,
  request: EvmAllowanceDiscoveryRequest,
): value is EvmAllowanceDiscoveryResponse {
  if (!isRecord(value) || value.chainId !== request.chainId.toLowerCase() || value.owner !== request.owner
    || typeof value.scannedFromBlock !== "string" || !/^(?:0|[1-9]\d{0,19})$/.test(value.scannedFromBlock)
    || typeof value.scannedToBlock !== "string" || !/^(?:0|[1-9]\d{0,19})$/.test(value.scannedToBlock)
    || typeof value.scannedBlockCount !== "number" || !Number.isInteger(value.scannedBlockCount)
    || value.scannedBlockCount < 1 || value.scannedBlockCount > 5_000
    || value.completeHistory !== false || !Array.isArray(value.approvals)
    || value.approvals.length > 50 || !value.approvals.every(isApproval)
    || typeof value.asOf !== "string" || !Number.isFinite(Date.parse(value.asOf))) return false;
  const requestedTokens = new Set(request.tokenAddresses.map((address) => address.toLowerCase()));
  const approvals = value.approvals as DiscoveredEvmAllowance[];
  const scannedFromBlock = value.scannedFromBlock as string;
  const scannedToBlock = value.scannedToBlock as string;
  const from = BigInt(scannedFromBlock);
  const to = BigInt(scannedToBlock);
  if (from > to || to - from + 1n !== BigInt(value.scannedBlockCount as number)) return false;
  return approvals.every((approval) => (
    requestedTokens.has(approval.tokenAddress.toLowerCase())
    && BigInt(approval.allowanceRaw) > 0n
    && BigInt(approval.lastApprovalBlock) >= BigInt(scannedFromBlock)
    && BigInt(approval.lastApprovalBlock) <= BigInt(scannedToBlock)
  ));
}

export async function discoverEvmAllowances(
  request: EvmAllowanceDiscoveryRequest,
  accessToken: string,
  signal?: AbortSignal,
): Promise<EvmAllowanceDiscoveryResponse> {
  const baseUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/portfolio/evm-allowances/discover`, {
      method: "POST",
      headers: {
        authorization: "Bearer " + accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal: signal ?? AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new Error("Allowance discovery service is unavailable.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Unable to discover allowances. Wait before retrying.");
  if (!isResponse(data, request)) throw new Error("Allowance discovery returned an invalid response.");
  return data;
}
