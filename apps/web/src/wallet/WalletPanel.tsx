import { useEffect, useState, type FormEvent } from "react";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { useAuth } from "../auth/AuthContext";
import { useWallet } from "./WalletContext";
import { fetchEvmPortfolioPrices, fetchSolanaPortfolioPrices } from "./portfolioPriceClient";
import type { PortfolioPricesResponse } from "@next/types";
import { amountInUsd, calculatePortfolioUsdValue, formatUsd } from "./portfolioValuation";
import { addEvmTokenToWatchlist, loadEvmTokenWatchlist, removeEvmTokenFromWatchlist } from "./tokenWatchlist";
import { loadLatestOfflinePortfolio, saveOfflinePortfolio } from "./offlinePortfolio";
import type { OfflinePortfolioSnapshot } from "./offlinePortfolio";
import {
  readEvmTokenAllowances,
  readEvmTokenAllowance,
  revokeEvmTokenAllowance,
} from "./providers";
import type { NativeTransferSimulation } from "./providers";
import {
  addTrackedAllowance,
  loadTrackedAllowances,
  removeTrackedAllowance,
} from "./allowanceWatchlist";
import type { TrackedAllowance } from "./allowanceWatchlist";

const roleRank = { Guest: 0, Viewer: 1, Trader: 2, EnterpriseAdmin: 3, SuperAdmin: 4 } as const;

export function WalletPanel() {
  const { accessToken, user } = useAuth();
  const {
    account,
    balance,
    tokenBalances,
    busy,
    error,
    connect,
    disconnect,
    refreshPortfolio,
    simulateTransfer,
    transfer,
    clearError,
  } = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [trackedTokens, setTrackedTokens] = useState<string[]>([]);
  const [trackedAllowances, setTrackedAllowances] = useState<TrackedAllowance[]>([]);
  const [allowanceValues, setAllowanceValues] = useState<Record<string, string>>({});
  const [allowanceTokenAddress, setAllowanceTokenAddress] = useState("");
  const [allowanceSpender, setAllowanceSpender] = useState("");
  const [busyAllowance, setBusyAllowance] = useState<string | null>(null);
  const [transferSimulation, setTransferSimulation] = useState<NativeTransferSimulation | null>(null);
  const [portfolioPrices, setPortfolioPrices] = useState<PortfolioPricesResponse | null>(null);
  const [portfolioPriceError, setPortfolioPriceError] = useState<string | null>(null);
  const [busyPrices, setBusyPrices] = useState(false);
  const [priceRefreshVersion, setPriceRefreshVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [offlineSnapshot, setOfflineSnapshot] = useState<OfflinePortfolioSnapshot | null>(
    () => loadLatestOfflinePortfolio(),
  );
  const priceChainMatches = account !== null && portfolioPrices?.chainId ===
    (account.chain === "evm" ? account.chainId.toLowerCase() : account.chainId);
  const normalizePriceAddress = (address: string): string =>
    account?.chain === "evm" ? address.toLowerCase() : address;
  const tokenPrices = new Map(
    priceChainMatches
      ? portfolioPrices.tokenPrices.map(({ address, priceUsd }) => [normalizePriceAddress(address), priceUsd])
      : [],
  );
  const nativeUsdValue = balance && priceChainMatches && portfolioPrices
    ? amountInUsd(balance.amount, portfolioPrices.nativePriceUsd)
    : null;
  const tokenUsdValue = (address: string | undefined, amount: string): number | null =>
    address ? amountInUsd(amount, tokenPrices.get(normalizePriceAddress(address))) : null;
  const totalPortfolioUsd = account && priceChainMatches && portfolioPrices
    ? calculatePortfolioUsdValue(
      balance?.amount ?? null,
      portfolioPrices.nativePriceUsd,
      tokenBalances.map((token) => ({
        amount: token.amount,
        priceUsd: token.tokenAddress ? tokenPrices.get(normalizePriceAddress(token.tokenAddress)) : null,
      })),
      account.chain === "evm" ? trackedTokens.length : tokenBalances.length,
    )
    : null;

  useEffect(() => {
    setTransferSimulation(null);
    if (!account) {
      setTrackedTokens([]);
      setTrackedAllowances([]);
      setAllowanceValues({});
      return;
    }
    const tokens = loadEvmTokenWatchlist(account);
    setTrackedTokens(tokens);
    void refreshPortfolio(tokens).catch(() => undefined);
    const allowances = loadTrackedAllowances(account);
    setTrackedAllowances(allowances);
    setAllowanceValues({});
    if (account.chain === "evm") {
      let active = true;
      void readEvmTokenAllowances(account, allowances)
        .then((values) => {
          if (active) {
            setAllowanceValues(Object.fromEntries(
              allowances.map((entry, index) => [allowanceKey(entry), values[index]?.toString() ?? "Error: Invalid allowance response."]),
            ));
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            const message = cause instanceof Error ? cause.message : "Unable to read allowances.";
            setAllowanceValues(Object.fromEntries(
              allowances.map((entry) => [allowanceKey(entry), `Error: ${message}`]),
            ));
          }
        });
      return () => { active = false; };
    }
  }, [account, refreshPortfolio]);

  useEffect(() => {
    setPortfolioPrices(null);
    setPortfolioPriceError(null);
    if (!account) {
      setBusyPrices(false);
      return;
    }
    if (!accessToken || !user || roleRank[user.role] < roleRank.Viewer) {
      setBusyPrices(false);
      setPortfolioPriceError("Sign in with a Viewer role or higher to load indicative USD prices.");
      return;
    }
    const controller = new AbortController();
    let active = true;
    setBusyPrices(true);
    const priceAddresses = account.chain === "evm"
      ? trackedTokens
      : tokenBalances
        .flatMap((token) => token.tokenAddress ? [token.tokenAddress] : [])
        .filter((mint) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))
        .slice(0, 50);
    const loadPrices = account.chain === "evm"
      ? fetchEvmPortfolioPrices(account.chainId.toLowerCase(), priceAddresses, accessToken, controller.signal)
      : fetchSolanaPortfolioPrices(account.chainId, priceAddresses, accessToken, controller.signal);
    void loadPrices
      .then((prices) => {
        if (active) setPortfolioPrices(prices);
      })
      .catch((cause: unknown) => {
        if (active && !(cause instanceof DOMException && cause.name === "AbortError")) {
          setPortfolioPriceError(cause instanceof Error ? cause.message : "Portfolio pricing is unavailable.");
        }
      })
      .finally(() => {
        if (active) setBusyPrices(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [account, accessToken, user, trackedTokens, tokenBalances, priceRefreshVersion]);

  useEffect(() => {
    if (!account || !balance || balance.address.toLowerCase() !== account.address.toLowerCase()
      || balance.chain !== account.chain) return;
    const prices = priceChainMatches ? portfolioPrices : null;
    const snapshot = saveOfflinePortfolio(
      account,
      [balance, ...tokenBalances],
      account.chain === "evm" ? trackedTokens.length : tokenBalances.length,
      prices,
    );
    if (snapshot) setOfflineSnapshot(snapshot);
  }, [account, balance, tokenBalances, trackedTokens, portfolioPrices, priceChainMatches]);

  async function reviewTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setTransferSimulation(null);
    setNotice(null);
    try {
      const simulation = await simulateTransfer({
        chain: account.chain,
        to: recipient.trim(),
        amount: amount.trim(),
        chainId: account.chainId,
      });
      setTransferSimulation(simulation);
      setNotice("Simulation passed. Review the estimate before continuing to your wallet.");
    } catch {
      setTransferSimulation(null);
      setNotice(null);
    }
  }

  async function confirmTransfer() {
    if (!account || !transferSimulation) return;
    try {
      const receipt = await transfer({
        chain: account.chain,
        to: recipient.trim(),
        amount: amount.trim(),
        chainId: account.chainId,
      });
      setNotice(`Submitted ${receipt.transactionId}`);
      setRecipient("");
      setAmount("");
      setTransferSimulation(null);
    } catch {
      setTransferSimulation(null);
      setNotice(null);
    }
  }

  function addToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || account.chain !== "evm") return;
    try {
      const next = addEvmTokenToWatchlist(account, tokenAddress);
      setTrackedTokens(next);
      setTokenAddress("");
      setNotice("Token added. Refresh the portfolio to read its balance.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Unable to add the token.");
    }
  }

  async function removeToken(address: string) {
    if (!account || account.chain !== "evm") return;
    try {
      const next = removeEvmTokenFromWatchlist(account, address);
      setTrackedTokens(next);
      await refreshPortfolio(next);
      setNotice("Token removed from this account and network watchlist.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Unable to remove the token.");
    }
  }

  async function refreshAllowances(entries: readonly TrackedAllowance[] = trackedAllowances) {
    if (!account || account.chain !== "evm") return;
    setBusyAllowance("refresh");
    try {
      const values = await readEvmTokenAllowances(account, entries);
      setAllowanceValues(Object.fromEntries(
        entries.map((entry, index) => [allowanceKey(entry), values[index]?.toString() ?? "Error: Invalid allowance response."]),
      ));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to read allowances.";
      setAllowanceValues(Object.fromEntries(entries.map((entry) => [allowanceKey(entry), `Error: ${message}`])));
    } finally {
      setBusyAllowance(null);
    }
  }

  async function addAllowance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || account.chain !== "evm") return;
    setNotice(null);
    setBusyAllowance("add");
    try {
      const next = addTrackedAllowance(account, allowanceTokenAddress, allowanceSpender);
      const tokenAddress = allowanceTokenAddress.trim().toLowerCase();
      const spender = allowanceSpender.trim().toLowerCase();
      const allowance = await readEvmTokenAllowance(account, tokenAddress, spender);
      setTrackedAllowances(next);
      setAllowanceValues((current) => ({ ...current, [allowanceKey({ tokenAddress, spender })]: allowance.toString() }));
      setAllowanceTokenAddress("");
      setAllowanceSpender("");
      setNotice("Allowance pair added. Review spender permissions carefully before revoking.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Unable to read this token allowance.");
    } finally {
      setBusyAllowance(null);
    }
  }

  async function revokeAllowance(entry: TrackedAllowance) {
    if (!account || account.chain !== "evm") return;
    const key = allowanceKey(entry);
    setBusyAllowance(key);
    setNotice(null);
    try {
      const transactionId = await revokeEvmTokenAllowance(account, entry.tokenAddress, entry.spender);
      setAllowanceValues((current) => ({ ...current, [key]: "0" }));
      setNotice(`Allowance revoked and verified: ${transactionId}`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Unable to revoke token allowance.");
    } finally {
      setBusyAllowance(null);
    }
  }

  function forgetAllowance(entry: TrackedAllowance) {
    if (!account || account.chain !== "evm") return;
    const next = removeTrackedAllowance(account, entry);
    setTrackedAllowances(next);
    setAllowanceValues((current) => {
      const updated = { ...current };
      delete updated[allowanceKey(entry)];
      return updated;
    });
  }

  return (
    <GlassCard className="wallet-panel" glowColor={account ? "green" : "none"}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">SELF-CUSTODY</p>
          <h2>Wallet</h2>
        </div>
        {account && <GlowBadge tone="green">{account.chain === "evm" ? "EVM" : "SOLANA"}</GlowBadge>}
      </div>
      {!account ? (
        <>
          <div className="wallet-connect-actions">
            <p className="muted">Connect a wallet to view balances and send assets. Your keys remain in your wallet.</p>
            <div className="button-row">
              <FlashButton onClick={() => void connect("evm").catch(() => undefined)} disabled={busy}>Connect EVM</FlashButton>
              <FlashButton variant="success" onClick={() => void connect("solana").catch(() => undefined)} disabled={busy}>Connect Solana</FlashButton>
            </div>
          </div>
          {offlineSnapshot && (
            <OfflinePortfolioCard snapshot={offlineSnapshot} />
          )}
        </>
      ) : (
        <>
          <div className="wallet-account">
            <div><span className="muted">Connected account</span><strong>{account.address}</strong></div>
            <div className="button-row">
              <FlashButton
                onClick={() => void (account.chain === "evm" ? refreshPortfolio(trackedTokens) : refreshPortfolio())
                  .catch(() => undefined)}
                disabled={busy}
              >
                Refresh portfolio
              </FlashButton>
              <FlashButton variant="danger" onClick={() => void disconnect().catch(() => undefined)} disabled={busy}>Disconnect</FlashButton>
            </div>
          </div>
          <div className="balance-tile">
            <span className="muted">Native balance</span>
            <strong>{balance ? `${balance.amount} ${balance.asset}` : "Not loaded"}</strong>
            <span className="muted">{nativeUsdValue === null ? "USD price unavailable" : `≈ ${formatUsd(nativeUsdValue)}`}</span>
          </div>
          <div className="balance-tile portfolio-usd-value">
              <div className="section-heading">
                <span className="muted">Indicative portfolio value</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setPriceRefreshVersion((version) => version + 1)}
                  disabled={busyPrices}
                >
                  {busyPrices ? "Refreshing…" : "Refresh prices"}
                </button>
              </div>
              <strong>{totalPortfolioUsd === null ? "Incomplete or unavailable" : formatUsd(totalPortfolioUsd)}</strong>
              {portfolioPrices && (
                <span className="muted">
                  CoinGecko reference prices · as of {new Date(portfolioPrices.asOf).toLocaleString()}
                </span>
              )}
              {portfolioPriceError && <span className="muted">{portfolioPriceError}</span>}
              {portfolioPrices && totalPortfolioUsd === null && !portfolioPriceError && (
                <span className="muted">At least one balance or price is unavailable; the total is intentionally omitted.</span>
              )}
          </div>
          <section className="portfolio-assets" aria-label="Token balances">
            <div className="section-heading">
              <div><p className="eyebrow">SELF-CUSTODY</p><h3>Token balances</h3></div>
              <GlowBadge tone="neutral">{tokenBalances.length} ASSETS</GlowBadge>
            </div>
            {account.chain === "evm" && trackedTokens.length > 0
              ? <div className="portfolio-list">
                {trackedTokens.map((address) => {
                  const token = tokenBalances.find((balance) => balance.tokenAddress === address);
                  return (
                    <div className="portfolio-token" key={address}>
                      <div>
                        <strong>{token ? `${token.amount} ${token.asset}` : "Balance unavailable"}</strong>
                        <span className="muted">{address}</span>
                        {token && (
                          <span className="muted">
                            {tokenUsdValue(token.tokenAddress, token.amount) === null
                              ? "USD value unavailable"
                              : `≈ ${formatUsd(tokenUsdValue(token.tokenAddress, token.amount) ?? 0)}`}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="text-button session-revoke"
                        onClick={() => void removeToken(address)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
              : tokenBalances.length === 0
              ? <p className="muted">{account.chain === "evm"
                ? "Add ERC-20 contract addresses to track their balances on this network."
                : "No non-zero SPL token balances were returned by the connected wallet RPC."}</p>
              : <div className="portfolio-list">
                {tokenBalances.map((token) => (
                  <div className="portfolio-token" key={token.tokenAddress}>
                    <div>
                      <strong>{token.amount} {token.asset}</strong>
                      <span className="muted">{token.tokenAddress}</span>
                      <span className="muted">
                        {tokenUsdValue(token.tokenAddress, token.amount) === null
                          ? "USD value unavailable"
                          : `≈ ${formatUsd(tokenUsdValue(token.tokenAddress, token.amount) ?? 0)}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>}
            {account.chain === "evm" && (
              <form className="token-watchlist-form" onSubmit={addToken}>
                <label>ERC-20 contract address
                  <input
                    required
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={42}
                    value={tokenAddress}
                    onChange={(event) => setTokenAddress(event.target.value)}
                    placeholder="0x…"
                  />
                </label>
                <FlashButton type="submit" disabled={busy}>Track token</FlashButton>
                <p className="muted">Tracked on this browser for the connected account and network ({trackedTokens.length}/50). Verify each contract address independently.</p>
              </form>
            )}
          </section>
          {account.chain === "evm" && (
            <section className="allowance-manager" aria-label="ERC-20 token allowances">
              <div className="section-heading">
                <div><p className="eyebrow">APPROVAL SECURITY</p><h3>ERC-20 allowances</h3></div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void refreshAllowances()}
                  disabled={busyAllowance !== null}
                >
                  Refresh
                </button>
              </div>
              <p className="muted">Track a token and spender pair to read its allowance on this network. This is not automatic discovery; untracked approvals are not shown.</p>
              {trackedAllowances.length === 0
                ? <p className="muted">No token and spender pairs are tracked.</p>
                : <div className="portfolio-list">
                  {trackedAllowances.map((entry) => {
                    const key = allowanceKey(entry);
                    const value = allowanceValues[key];
                    const trackedToken = tokenBalances.find((token) => token.tokenAddress === entry.tokenAddress);
                    const amount = value && !value.startsWith("Error:")
                      ? `${trackedToken
                        ? `${formatAllowance(value, trackedToken.decimals)} ${trackedToken.asset}`
                        : `${value} raw units`}`
                      : value ?? "Loading allowance…";
                    return (
                      <div className="portfolio-token allowance-row" key={key}>
                        <div>
                          <strong>{amount}</strong>
                          <span className="muted">Token: {entry.tokenAddress}</span>
                          <span className="muted">Spender: {entry.spender}</span>
                        </div>
                        {value && !value.startsWith("Error:") && BigInt(value) > 0n && (
                          <FlashButton
                            type="button"
                            variant="danger"
                            disabled={busyAllowance !== null}
                            onClick={() => void revokeAllowance(entry)}
                          >
                            {busyAllowance === key ? "Waiting for wallet…" : "Revoke"}
                          </FlashButton>
                        )}
                        <button
                          type="button"
                          className="text-button"
                          disabled={busyAllowance !== null}
                          onClick={() => forgetAllowance(entry)}
                        >
                          Forget
                        </button>
                      </div>
                    );
                  })}
                </div>}
              <form className="token-watchlist-form" onSubmit={(event) => void addAllowance(event)}>
                <label>ERC-20 token contract
                  <input
                    required
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={42}
                    value={allowanceTokenAddress}
                    onChange={(event) => setAllowanceTokenAddress(event.target.value)}
                    placeholder="0x…"
                  />
                </label>
                <label>Approved spender
                  <input
                    required
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={42}
                    value={allowanceSpender}
                    onChange={(event) => setAllowanceSpender(event.target.value)}
                    placeholder="0x…"
                  />
                </label>
                <FlashButton type="submit" disabled={busyAllowance !== null}>Check allowance</FlashButton>
              </form>
              <p className="muted">Revocation is simulated, gas-estimated, and submitted only after approval in your wallet. Use “Forget” only to remove a pair from this browser; it does not revoke on-chain permission.</p>
            </section>
          )}
          <form className="transfer-form" onSubmit={(event) => void reviewTransfer(event)}>
            <h3>Send native asset</h3>
            <label>Recipient address<input required autoComplete="off" disabled={busy} value={recipient} onChange={(event) => {
              setRecipient(event.target.value);
              setTransferSimulation(null);
              setNotice(null);
            }} /></label>
            <label>Amount<input required inputMode="decimal" min="0" step="any" type="number" disabled={busy} value={amount} onChange={(event) => {
              setAmount(event.target.value);
              setTransferSimulation(null);
              setNotice(null);
            }} /></label>
            <FlashButton type="submit" disabled={busy}>Simulate transfer</FlashButton>
            {transferSimulation && (
              <div className="transfer-review" aria-label="Native transfer simulation result">
                <div className="section-heading">
                  <h4>Simulation passed</h4>
                  <GlowBadge tone="green">{transferSimulation.asset}</GlowBadge>
                </div>
                <dl>
                  <div><dt>Recipient</dt><dd>{transferSimulation.recipient}</dd></div>
                  <div><dt>Amount</dt><dd>{transferSimulation.amount} {transferSimulation.asset}</dd></div>
                  <div><dt>Estimated network fee</dt><dd>{transferSimulation.estimatedFee} {transferSimulation.asset}</dd></div>
                  <div><dt>Estimated total debit</dt><dd>{transferSimulation.totalEstimatedDebit} {transferSimulation.asset}</dd></div>
                </dl>
                <p className="muted">The transfer is simulated again immediately before opening your wallet. Network fees can change; your wallet is the final authority before signing.</p>
                <FlashButton type="button" variant="success" disabled={busy} onClick={() => void confirmTransfer()}>
                  Confirm and send with wallet
                </FlashButton>
              </div>
            )}
          </form>
        </>
      )}
      {error && <p className="message message--error" role="alert">{error} <button type="button" onClick={clearError}>Dismiss</button></p>}
      {notice && <p className="message" role="status">{notice}</p>}
      <p className="wallet-disclaimer">Transactions are sent to your wallet for approval. Verify chain, address, and amount before confirming.</p>
    </GlassCard>
  );
}

function OfflinePortfolioCard({ snapshot }: { snapshot: OfflinePortfolioSnapshot }) {
  const balance = snapshot.balances[0];
  if (!balance) return null;
  const prices = snapshot.prices?.chainId.toLowerCase() === snapshot.account.chainId.toLowerCase()
    ? snapshot.prices
    : null;
  const priceFor = (address: string | undefined, native = false): number | null | undefined => {
    if (!prices) return undefined;
    if (native) return prices.nativePriceUsd;
    return address
      ? prices.tokenPrices.find((entry) => snapshot.account.chain === "evm"
        ? entry.address.toLowerCase() === address.toLowerCase()
        : entry.address === address)?.priceUsd
      : undefined;
  };
  const total = calculatePortfolioUsdValue(
    balance.amount,
    priceFor(undefined, true),
    snapshot.balances.slice(1).map((asset) => ({
      amount: asset.amount,
      priceUsd: priceFor(asset.tokenAddress),
    })),
    snapshot.expectedTokenCount,
  );

  return (
    <section className="portfolio-assets" aria-label="Saved offline portfolio snapshot">
      <div className="section-heading">
        <div><p className="eyebrow">LOCAL SNAPSHOT</p><h3>Saved portfolio</h3></div>
        <GlowBadge tone="neutral">{snapshot.account.chain === "evm" ? "EVM" : "SOLANA"}</GlowBadge>
      </div>
      <p className="muted">{snapshot.account.address} · {snapshot.account.chainId}</p>
      <div className="balance-tile">
        <span className="muted">Native balance · {balance.asset}</span>
        <strong>{balance.amount}</strong>
        <span className="muted">{total === null ? "Complete USD value unavailable" : `≈ ${formatUsd(total)}`}</span>
      </div>
      <div className="portfolio-list">
        {snapshot.balances.slice(1).map((asset, index) => {
          const value = amountInUsd(asset.amount, priceFor(asset.tokenAddress));
          return (
            <div className="portfolio-token" key={`${asset.tokenAddress ?? asset.asset}-${index}`}>
              <div>
                <strong>{asset.amount} {asset.asset}</strong>
                <span className="muted">{asset.tokenAddress ?? "Native asset"}</span>
                <span className="muted">{value === null ? "USD value unavailable" : `≈ ${formatUsd(value)}`}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted">Saved {new Date(snapshot.capturedAt).toLocaleString()}. This device-only snapshot may be stale and is not a live balance.</p>
    </section>
  );
}

function allowanceKey(entry: TrackedAllowance): string {
  return `${entry.tokenAddress.toLowerCase()}:${entry.spender.toLowerCase()}`;
}

function formatAllowance(value: string, decimals: number): string {
  const amount = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
