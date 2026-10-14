import type { EvmQuoteProvider } from "@next/types";

const providers = ["0x", "1inch", "paraswap"] as const satisfies readonly EvmQuoteProvider[];

export interface AggregatorControlState {
  enabledProviders: EvmQuoteProvider[];
  updatedAt: string | null;
  updatedBy: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseState(value: unknown): AggregatorControlState {
  if (!isRecord(value) || !Array.isArray(value.enabledProviders)
    || !value.enabledProviders.every((provider) => providers.includes(provider as EvmQuoteProvider))
    || new Set(value.enabledProviders).size !== value.enabledProviders.length
    || (value.updatedAt !== null && (typeof value.updatedAt !== "string"
      || !Number.isFinite(Date.parse(value.updatedAt))))
    || (value.updatedBy !== null && typeof value.updatedBy !== "string")) {
    throw new Error("Aggregator control service returned an invalid response.");
  }
  return value as unknown as AggregatorControlState;
}

async function request(
  apiUrl: string,
  accessToken: string,
  method: "GET" | "PATCH",
  body?: { enabledProviders: readonly EvmQuoteProvider[]; reason: string },
): Promise<AggregatorControlState> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/+$/, "")}/admin/aggregator-controls/evm-quotes`, {
      method,
      headers: {
        authorization: ["Bearer", accessToken].join(" "),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Aggregator controls are unavailable.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Unable to load or update aggregator controls.");
  return parseState(data);
}

export function fetchAggregatorControls(apiUrl: string, accessToken: string) {
  return request(apiUrl, accessToken, "GET");
}

export function updateAggregatorControls(
  apiUrl: string,
  accessToken: string,
  enabledProviders: readonly EvmQuoteProvider[],
  reason: string,
) {
  return request(apiUrl, accessToken, "PATCH", { enabledProviders, reason });
}
