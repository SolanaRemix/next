import { useEffect, useState, type FormEvent } from "react";
import type { SolanaMarketSearchResponse, SolanaMarketToken } from "@next/types";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { searchSolanaMarket } from "./solanaMarketClient";

export interface SolanaMarketPanelProps {
  accessToken: string | null;
}

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumSignificantDigits: 7,
  }).format(value);
}

function TokenRow({ token }: { token: SolanaMarketToken }) {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <article className="solana-token-row">
      <div className="solana-token-identity">
        {token.logoUri && !logoFailed
          ? <img src={token.logoUri} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setLogoFailed(true)} />
          : <span className="solana-token-fallback" aria-hidden="true">{token.symbol.slice(0, 1)}</span>}
        <div>
          <strong>{token.symbol}</strong>
          <span className="muted">{token.name}</span>
        </div>
      </div>
      <div className="solana-token-market">
        <strong>{formatUsd(token.priceUsd)}</strong>
        <span className="muted">{token.priceSource ? `Price: ${token.priceSource}` : "Price unavailable"}</span>
      </div>
      <div className="solana-token-market">
        <strong>{formatUsd(token.liquidityUsd)}</strong>
        <span className="muted">Liquidity</span>
      </div>
      <div className="solana-token-market">
        <strong>{token.marketSpreadBps === null ? "—" : `${(token.marketSpreadBps / 100).toFixed(2)}%`}</strong>
        <span className="muted">Observed venue spread</span>
      </div>
      <div className="solana-token-venues">
        {token.venues.length > 0
          ? token.venues.map((venue) => <GlowBadge key={venue} tone="orange">{venue}</GlowBadge>)
          : <span className="muted">DEX venue unavailable</span>}
      </div>
    </article>
  );
}

export function SolanaMarketPanel({ accessToken }: SolanaMarketPanelProps) {
  const [query, setQuery] = useState("SOL");
  const [activeQuery, setActiveQuery] = useState("SOL");
  const [data, setData] = useState<SolanaMarketSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!accessToken) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void searchSolanaMarket(activeQuery, accessToken, controller.signal)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Unable to load market data.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, activeQuery, refreshCount]);

  useEffect(() => {
    if (!accessToken) return;
    const timer = window.setInterval(() => setRefreshCount((count) => count + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [accessToken]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveQuery(query.trim());
  }

  return (
    <GlassCard className="solana-market-panel" flashOnUpdate={data !== null}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">SOLANA · LIVE MARKET DATA</p>
          <h2>Token markets</h2>
        </div>
        <GlowBadge tone={data ? "green" : "orange"}>{loading ? "UPDATING" : data ? "LIVE · 30S" : "MARKET"}</GlowBadge>
      </div>
      <p className="muted">Token metadata and prices from Jupiter, with venue liquidity and price observations from DEX Screener.</p>
      <form className="solana-market-search" onSubmit={submitSearch}>
        <label htmlFor="solana-market-query">Search Solana token</label>
        <input
          id="solana-market-query"
          autoComplete="off"
          maxLength={32}
          minLength={2}
          pattern="[a-zA-Z0-9 ._-]+"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          required
        />
        <FlashButton type="submit" disabled={!accessToken || loading}>
          {accessToken ? "Search markets" : "Sign in to view markets"}
        </FlashButton>
      </form>
      {error && <p className="message message--error" role="alert">{error}</p>}
      {data && (
        <div className="solana-market-list" aria-live="polite">
          {data.tokens.length === 0
            ? <p className="muted">No Solana tokens matched this search.</p>
            : data.tokens.map((token) => <TokenRow key={token.mint} token={token} />)}
          {data.unavailableProviders.length > 0 &&
            <p className="muted">Unavailable providers: {data.unavailableProviders.join(", ")}</p>}
          <small className="muted">Updated {new Date(data.asOf).toLocaleTimeString()}</small>
        </div>
      )}
      <p className="wallet-disclaimer">
        Market prices are indicative, may be stale, and are not executable quotes. Venue spread is observed across indexed pools;
        it is not a slippage guarantee, price-impact estimate, or MEV protection.
      </p>
    </GlassCard>
  );
}
