import { useState, type FormEvent } from "react";
import type {
  CrossChainBridgeQuoteRequest,
  CrossChainBridgeQuoteResponse,
} from "@next/types";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { requestBridgeQuote } from "./bridgeQuoteClient";

const solanaChainId = 1151111081099710;
const chains = [
  { id: 1, name: "Ethereum" },
  { id: 10, name: "Optimism" },
  { id: 56, name: "BNB Chain" },
  { id: 137, name: "Polygon" },
  { id: 8453, name: "Base" },
  { id: 42161, name: "Arbitrum" },
  { id: 43114, name: "Avalanche" },
  { id: solanaChainId, name: "Solana" },
] as const;

const initialValues = {
  fromChainId: "1",
  toChainId: String(solanaChainId),
  fromToken: "",
  toToken: "",
  fromAmount: "",
  fromAddress: "",
  toAddress: "",
  slippagePercent: "0.5",
};

export function BridgeQuotePanel({
  accessToken,
  authenticated,
}: {
  accessToken: string | null;
  authenticated: boolean;
}) {
  const [values, setValues] = useState(initialValues);
  const [quote, setQuote] = useState<CrossChainBridgeQuoteResponse | null>(null);
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
      if (!accessToken) throw new Error("Sign in to access cross-chain quotes.");
      const slippagePercent = Number(values.slippagePercent);
      if (!Number.isFinite(slippagePercent) || slippagePercent <= 0 || slippagePercent > 50) {
        throw new Error("Maximum slippage must be greater than 0% and no more than 50%.");
      }
      const request: CrossChainBridgeQuoteRequest = {
        fromChainId: Number(values.fromChainId),
        toChainId: Number(values.toChainId),
        fromToken: values.fromToken.trim(),
        toToken: values.toToken.trim(),
        fromAmount: values.fromAmount.trim(),
        fromAddress: values.fromAddress.trim(),
        toAddress: values.toAddress.trim(),
        slippageBps: Math.round(slippagePercent * 100),
      };
      setQuote(await requestBridgeQuote(request, accessToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to request a cross-chain quote.");
    } finally {
      setBusy(false);
    }
  }

  const chainName = (chainId: number) =>
    chains.find((chain) => chain.id === chainId)?.name ?? `Chain ${chainId}`;

  return (
    <GlassCard className="swap-panel" glowColor={quote ? "orange" : "none"} flashOnUpdate={quote !== null}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">CROSS-CHAIN · LI.FI</p>
          <h2>Bridge quote</h2>
        </div>
        <GlowBadge tone={quote ? "green" : "neutral"}>{quote ? "QUOTE READY" : "QUOTE ONLY"}</GlowBadge>
      </div>
      <p className="muted">
        Request a live exact-input route estimate. Use token contract or mint addresses and smallest-unit
        amounts; Solana native SOL uses its wrapped-SOL mint.
      </p>
      <form className="swap-form" onSubmit={(event) => void getQuote(event)}>
        <div className="swap-form__row">
          <label>Source network
            <select disabled={busy} value={values.fromChainId} onChange={(event) => update("fromChainId", event.target.value)}>
              {chains.map((chain) => <option key={chain.id} value={chain.id}>{chain.name}</option>)}
            </select>
          </label>
          <label>Destination network
            <select disabled={busy} value={values.toChainId} onChange={(event) => update("toChainId", event.target.value)}>
              {chains.map((chain) => <option key={chain.id} value={chain.id}>{chain.name}</option>)}
            </select>
          </label>
        </div>
        <label>Source token address or mint
          <input disabled={busy} required spellCheck={false} autoComplete="off" value={values.fromToken} onChange={(event) => update("fromToken", event.target.value)} />
        </label>
        <label>Destination token address or mint
          <input disabled={busy} required spellCheck={false} autoComplete="off" value={values.toToken} onChange={(event) => update("toToken", event.target.value)} />
        </label>
        <label>Source amount in smallest units
          <input disabled={busy} required inputMode="numeric" pattern="[1-9][0-9]*" value={values.fromAmount} onChange={(event) => update("fromAmount", event.target.value)} />
        </label>
        <label>Source wallet address
          <input disabled={busy} required spellCheck={false} autoComplete="off" value={values.fromAddress} onChange={(event) => update("fromAddress", event.target.value)} />
        </label>
        <label>Destination wallet address
          <input disabled={busy} required spellCheck={false} autoComplete="off" value={values.toAddress} onChange={(event) => update("toAddress", event.target.value)} />
        </label>
        <label>Maximum slippage (%)
          <input disabled={busy} required min="0.01" max="50" step="0.01" type="number" value={values.slippagePercent} onChange={(event) => update("slippagePercent", event.target.value)} />
        </label>
        <FlashButton type="submit" disabled={busy || !accessToken}>
          {busy ? "Fetching bridge quote…" : accessToken ? "Request bridge quote" : authenticated ? "Viewer role required" : "Sign in to request a quote"}
        </FlashButton>
      </form>
      {error && <p className="message message--error" role="alert">{error}</p>}
      {quote && (
        <div className="swap-result" role="status" aria-live="polite">
          <p><strong>{chainName(quote.fromChainId)} → {chainName(quote.toChainId)}</strong></p>
          <div className="swap-route">
            <span>{quote.fromAmount} source units ({quote.fromTokenSymbol})</span>
            <span>{quote.toAmount} estimated output ({quote.toTokenSymbol})</span>
            <span className="muted">Minimum output: {quote.minimumToAmount}</span>
          </div>
          <p>Route: <strong>{quote.routeToolName}</strong>{quote.estimatedDurationSeconds !== null ? ` · estimated ${quote.estimatedDurationSeconds}s` : ""}</p>
          {quote.costs.length > 0 && (
            <div className="swap-route">
              <strong>Estimated costs</strong>
              {quote.costs.map((cost, index) => (
                <span key={`${cost.kind}-${cost.name}-${index}`}>
                  {cost.name}: {cost.amount ?? "—"} {cost.tokenSymbol ?? ""}
                  {cost.amountUsd ? ` · $${cost.amountUsd}` : ""}
                </span>
              ))}
            </div>
          )}
          <p className="muted">{quote.disclaimer}</p>
          <p className="muted">Quoted {new Date(quote.quotedAt).toLocaleString()}. Refresh before any future signing flow.</p>
        </div>
      )}
      <p className="wallet-disclaimer">
        This interface returns quote estimates only. It does not build, sign, approve, or broadcast bridge transactions.
        Review provider, token, wallet, fee, and slippage details independently.
      </p>
    </GlassCard>
  );
}
