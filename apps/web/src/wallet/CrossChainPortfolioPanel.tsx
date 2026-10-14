import { useEffect, useState, type FormEvent } from "react";
import type { CrossChainPortfolioResponse, WalletAccount } from "@next/types";
import { FlashButton, GlowBadge } from "@next/ui";
import { fetchCrossChainPortfolio } from "./crossChainPortfolioClient";
import {
  isValidTrackedAccount,
  loadTrackedPortfolioAccounts,
  portfolioAccountKey,
  portfolioNetworks,
  saveTrackedPortfolioAccounts,
} from "./crossChainPortfolio";
import type { TrackedPortfolioAccount } from "./crossChainPortfolio";
import { formatUsd } from "./portfolioValuation";

interface CrossChainPortfolioPanelProps {
  accessToken: string | null;
  canView: boolean;
  connectedAccount: WalletAccount | null;
  userId: string | null;
}

export function CrossChainPortfolioPanel({
  accessToken,
  canView,
  connectedAccount,
  userId,
}: CrossChainPortfolioPanelProps) {
  const [accounts, setAccounts] = useState<TrackedPortfolioAccount[]>([]);
  const [accountsOwner, setAccountsOwner] = useState<string | null>(null);
  const [networkIndex, setNetworkIndex] = useState("0");
  const [address, setAddress] = useState("");
  const [tokenList, setTokenList] = useState("");
  const [portfolio, setPortfolio] = useState<CrossChainPortfolioResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const network = portfolioNetworks[Number(networkIndex)] ?? portfolioNetworks[0];
  const visibleAccounts = accountsOwner === userId ? accounts : [];
  const visiblePortfolio = accountsOwner === userId ? portfolio : null;
  const visibleError = accountsOwner === userId ? error : null;
  const networkLabel = (account: TrackedPortfolioAccount): string =>
    portfolioNetworks.find((entry) => entry.chain === account.chain && entry.chainId === account.chainId)?.label
      ?? account.chainId;

  useEffect(() => {
    setAccounts(userId ? loadTrackedPortfolioAccounts(userId) : []);
    setAccountsOwner(userId);
    setPortfolio(null);
    setError(null);
  }, [userId]);

  function persist(next: readonly TrackedPortfolioAccount[]) {
    if (!userId) return;
    try {
      const saved = saveTrackedPortfolioAccounts(userId, next);
      setAccounts(saved);
      setPortfolio(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update tracked accounts.");
    }
  }

  function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!network || !userId) return;
    const tokens = network.chain === "evm"
      ? tokenList.split(",").map((entry) => entry.trim()).filter(Boolean)
      : [];
    const nextAccount: TrackedPortfolioAccount = {
      address: address.trim(),
      chain: network.chain,
      chainId: network.chainId,
      tokenAddresses: [...new Set(tokens.map((token) => token.toLowerCase()))],
    };
    if (!isValidTrackedAccount(nextAccount)) {
      setError(network.chain === "evm"
        ? "Enter a valid wallet address and up to 50 valid ERC-20 contract addresses."
        : "Enter a valid Solana mainnet wallet address.");
      return;
    }
    if (visibleAccounts.length >= 8) {
      setError("Track up to 8 wallet accounts.");
      return;
    }
    if (visibleAccounts.some((account) => portfolioAccountKey(account) === portfolioAccountKey(nextAccount))) {
      setError("This wallet and network are already tracked.");
      return;
    }
    persist([...visibleAccounts, nextAccount]);
    setAddress("");
    setTokenList("");
  }

  function addConnectedAccount() {
    if (!connectedAccount || !userId) return;
    const index = portfolioNetworks.findIndex((entry) => (
      entry.chain === connectedAccount.chain
      && entry.chainId.toLowerCase() === connectedAccount.chainId.toLowerCase()
    ));
    if (index < 0) {
      setError("The connected wallet network is not supported by cross-chain aggregation.");
      return;
    }
    setNetworkIndex(String(index));
    setAddress(connectedAccount.address);
    setTokenList("");
  }

  async function refresh() {
    if (!accessToken || !canView || visibleAccounts.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setPortfolio(await fetchCrossChainPortfolio(visibleAccounts, accessToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the cross-chain portfolio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="portfolio-assets cross-chain-portfolio" aria-label="Cross-chain portfolio">
      <div className="section-heading">
        <div><p className="eyebrow">READ-ONLY · LOCAL WATCHLIST</p><h3>Cross-chain portfolio</h3></div>
        <GlowBadge tone="neutral">{visibleAccounts.length}/8 WALLETS</GlowBadge>
      </div>
      <p className="muted">
        Track public wallet addresses across supported EVM networks and Solana. Addresses stay in this browser;
        refreshes use configured server RPCs and never sign or submit transactions.
      </p>
      {!canView && <p className="muted">Sign in with a Viewer role or higher to load balances and reference prices.</p>}
      <form className="token-watchlist-form" onSubmit={addAccount}>
        <label>
          Network
          <select
            value={networkIndex}
            onChange={(event) => {
              setNetworkIndex(event.currentTarget.value);
              setTokenList("");
            }}
          >
            {portfolioNetworks.map((entry, index) => (
              <option value={String(index)} key={`${entry.chain}:${entry.chainId}`}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label>
          Wallet address
          <input
            autoComplete="off"
            maxLength={64}
            value={address}
            onChange={(event) => setAddress(event.currentTarget.value)}
            placeholder={network.chain === "evm" ? "0x…" : "Solana public key"}
          />
        </label>
        {network.chain === "evm" && (
          <label>
            ERC-20 contract addresses (comma-separated, optional)
            <input
              autoComplete="off"
              value={tokenList}
              onChange={(event) => setTokenList(event.currentTarget.value)}
              placeholder="0x…"
            />
          </label>
        )}
        <div className="button-row">
          <FlashButton type="submit" disabled={!userId || visibleAccounts.length >= 8}>Add wallet</FlashButton>
          {connectedAccount && (
            <FlashButton type="button" variant="success" onClick={addConnectedAccount}>
              Use connected wallet
            </FlashButton>
          )}
          <FlashButton type="button" onClick={() => void refresh()} disabled={!canView || busy || visibleAccounts.length === 0}>
            {busy ? "Loading…" : "Refresh all"}
          </FlashButton>
        </div>
      </form>
      {visibleError && <p className="muted" role="alert">{visibleError}</p>}
      {visibleAccounts.length > 0 && (
        <div className="portfolio-list">
          {visibleAccounts.map((account) => (
            <div className="portfolio-token" key={portfolioAccountKey(account)}>
              <div>
                <strong>{networkLabel(account)}</strong>
                <span className="muted">{account.address}</span>
                {account.chain === "evm" && (
                  <span className="muted">{account.tokenAddresses.length} tracked ERC-20 contracts</span>
                )}
              </div>
              <button
                type="button"
                className="text-button session-revoke"
                onClick={() => persist(visibleAccounts.filter((candidate) => (
                  portfolioAccountKey(candidate) !== portfolioAccountKey(account)
                )))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {visiblePortfolio && (
        <div className="cross-chain-results" aria-live="polite">
          <div className="balance-tile">
            <span className="muted">Combined indicative value</span>
            <strong>{visiblePortfolio.totalUsd === null ? "Incomplete or unavailable" : formatUsd(visiblePortfolio.totalUsd)}</strong>
            <span className="muted">
              {visiblePortfolio.complete
                ? `All tracked assets priced · as of ${new Date(visiblePortfolio.asOf).toLocaleString()}`
                : `One or more balances or reference prices are unavailable · as of ${new Date(visiblePortfolio.asOf).toLocaleString()}`}
            </span>
          </div>
          {visiblePortfolio.accounts.map((entry) => (
            <section className="portfolio-assets" key={portfolioAccountKey(entry.account)}>
              <div className="section-heading">
                <div>
                  <h4>{networkLabel({ ...entry.account, tokenAddresses: [] })}</h4>
                  <span className="muted">{entry.account.address}</span>
                </div>
                <GlowBadge tone={entry.available ? "green" : "red"}>
                  {entry.totalUsd === null ? (entry.available ? "VALUE INCOMPLETE" : "UNAVAILABLE") : formatUsd(entry.totalUsd)}
                </GlowBadge>
              </div>
              {!entry.available
                ? <p className="muted">Balance provider unavailable for this account and network.</p>
                : entry.assets.length === 0
                  ? <p className="muted">No native or non-zero tracked token balances were returned.</p>
                  : <div className="portfolio-list">
                    {entry.assets.map((asset, index) => (
                      <div className="portfolio-token" key={`${asset.balance.tokenAddress ?? "native"}:${index}`}>
                        <div>
                          <strong>{asset.balance.amount} {asset.balance.asset}</strong>
                          <span className="muted">{asset.balance.tokenAddress ?? "Native asset"}</span>
                          <span className="muted">
                            {asset.valueUsd === null ? "USD value unavailable" : `≈ ${formatUsd(asset.valueUsd)}`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>}
            </section>
          ))}
          <p className="muted">
            CoinGecko values are reference estimates, not executable quotes or guaranteed valuations.
          </p>
        </div>
      )}
    </section>
  );
}
