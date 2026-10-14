export interface PricedPortfolioAsset {
  amount: string;
  priceUsd: number | null | undefined;
}

export function amountInUsd(amount: string, priceUsd: number | null | undefined): number | null {
  if (priceUsd === null || priceUsd === undefined) return null;
  const value = Number(amount) * priceUsd;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function calculatePortfolioUsdValue(
  nativeAmount: string | null,
  nativePriceUsd: number | null | undefined,
  tokenAssets: readonly PricedPortfolioAsset[],
  expectedTokenCount: number,
): number | null {
  if (nativeAmount === null || tokenAssets.length !== expectedTokenCount) return null;
  const nativeValue = amountInUsd(nativeAmount, nativePriceUsd);
  if (nativeValue === null) return null;
  const tokenValues = tokenAssets.map((asset) => amountInUsd(asset.amount, asset.priceUsd));
  if (tokenValues.some((value) => value === null)) return null;
  return tokenValues.reduce<number>((total, value) => total + (value ?? 0), nativeValue);
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
