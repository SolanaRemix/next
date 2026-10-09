import { useState, type FormEvent } from "react";
import type { SwapQuoteRequest, SwapQuoteResponse } from "@next/types";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { requestSwapQuote } from "./swapClient";

const initialValues = {
  chainId: "1",
  sellToken: "",
  buyToken: "",
  sellAmount: "",
  sellDecimals: "18",
  buyDecimals: "18",
  slippagePercent: "0.5",
};

function decimalToBaseUnits(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("Token decimals must be between 0 and 36.");
  }
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    throw new Error("Enter a valid positive sell amount.");
  }
  const [whole = "", fractional = ""] = normalized.split(".");
  if (fractional.length > decimals) {
    throw new Error(`Sell amount supports at most ${decimals} decimal places.`);
  }
  const amount = BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fractional + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (amount <= 0n) throw new Error("Sell amount must be greater than zero.");
  return amount.toString();
}

function formatTokenAmount(value: string, decimals: number): string {
  const amount = BigInt(value);
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = (amount % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export interface SwapPanelProps {
  accessToken: string | null;
  authenticated: boolean;
}

export function SwapPanel({ accessToken, authenticated }: SwapPanelProps) {
  const [values, setValues] = useState(initialValues);
  const [quote, setQuote] = useState<SwapQuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(field: keyof typeof initialValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setQuote(null);
    setError(null);
  }

  async function getQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuote(null);
    setError(null);
    setBusy(true);
    try {
      if (!accessToken) throw new Error("Sign in to access swap quotes.");
      const chainId = Number(values.chainId);
      const sellDecimals = Number(values.sellDecimals);
      const buyDecimals = Number(values.buyDecimals);
      const slippagePercent = Number(values.slippagePercent);
      if (!Number.isFinite(slippagePercent) || slippagePercent <= 0 || slippagePercent > 50) {
        throw new Error("Maximum slippage must be greater than 0% and no more than 50%.");
      }
      const request: SwapQuoteRequest = {
        chainId,
        sellToken: values.sellToken.trim(),
        buyToken: values.buyToken.trim(),
        sellAmount: decimalToBaseUnits(values.sellAmount, sellDecimals),
        sellDecimals,
        buyDecimals,
        maxSlippageBps: Math.round(slippagePercent * 100),
      };
      if (!Number.isInteger(buyDecimals) || buyDecimals < 0 || buyDecimals > 36) {
        throw new Error("Buy token decimals must be between 0 and 36.");
      }
      setQuote(await requestSwapQuote(request, accessToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to request a swap quote.");
    } finally {
      setBusy(false);
    }
  }

  const bestRoute = quote?.routes[0];
  const buyDecimals = Number(values.buyDecimals);

  return (
    <GlassCard className="swap-panel" glowColor={bestRoute ? "orange" : "none"} flashOnUpdate={quote !== null}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">EVM · MULTI-AGGREGATOR</p>
          <h2>Swap quote</h2>
        </div>
        {bestRoute && <GlowBadge tone="green">BEST: {bestRoute.provider}</GlowBadge>}
      </div>
      <form className="swap-form" onSubmit={(event) => void getQuote(event)}>
        <label>Network
          <select value={values.chainId} onChange={(event) => update("chainId", event.target.value)}>
            <option value="1">Ethereum</option>
            <option value="10">Optimism</option>
            <option value="56">BNB Chain</option>
            <option value="137">Polygon</option>
            <option value="8453">Base</option>
            <option value="42161">Arbitrum</option>
            <option value="43114">Avalanche</option>
          </select>
        </label>
        <label>Sell token contract<input required spellCheck={false} autoComplete="off" placeholder="0x…" value={values.sellToken} onChange={(event) => update("sellToken", event.target.value)} /></label>
        <label>Buy token contract<input required spellCheck={false} autoComplete="off" placeholder="0x…" value={values.buyToken} onChange={(event) => update("buyToken", event.target.value)} /></label>
        <div className="swap-form__row">
          <label>Sell amount<input required min="0" step="any" type="number" value={values.sellAmount} onChange={(event) => update("sellAmount", event.target.value)} /></label>
          <label>Sell decimals<input required min="0" max="36" step="1" type="number" value={values.sellDecimals} onChange={(event) => update("sellDecimals", event.target.value)} /></label>
        </div>
        <div className="swap-form__row">
          <label>Buy decimals<input required min="0" max="36" step="1" type="number" value={values.buyDecimals} onChange={(event) => update("buyDecimals", event.target.value)} /></label>
          <label>Max slippage (%)<input required min="0.01" max="50" step="0.01" type="number" value={values.slippagePercent} onChange={(event) => update("slippagePercent", event.target.value)} /></label>
        </div>
        <FlashButton type="submit" disabled={busy || !accessToken}>{busy ? "Fetching routes…" : accessToken ? "Compare aggregator quotes" : authenticated ? "Viewer role required" : "Sign in to compare quotes"}</FlashButton>
      </form>
      {error && <p className="message message--error" role="alert">{error}</p>}
      {quote && (
        <div className="swap-result" role="status" aria-live="polite">
          <p className="muted">Routes ranked by quoted output. Indicative prices only.</p>
          {quote.routes.map((route) => (
            <div className="swap-route" key={route.provider}>
              <div><strong>{route.provider}</strong>{route.provider === bestRoute?.provider && <GlowBadge tone="green">BEST</GlowBadge>}</div>
              <div><span>{formatTokenAmount(route.buyAmount, buyDecimals)} output</span><span className="muted">Min. {formatTokenAmount(route.minimumBuyAmount, buyDecimals)}</span></div>
              {route.estimatedGas && <small className="muted">Estimated gas: {route.estimatedGas}</small>}
            </div>
          ))}
          {quote.unavailableProviders.length > 0 && (
            <p className="muted">Unavailable: {quote.unavailableProviders.join(", ")}</p>
          )}
        </div>
      )}
      <p className="wallet-disclaimer">Quotes are fetched server-side from 0x, 1inch, and ParaSwap. No swap transaction is built, signed, or broadcast. Verify token decimals and contract addresses before any future transaction.</p>
    </GlassCard>
  );
}
