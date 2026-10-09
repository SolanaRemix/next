import { useEffect, useState, type FormEvent } from "react";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { useWallet } from "./WalletContext";
import { addEvmTokenToWatchlist, loadEvmTokenWatchlist, removeEvmTokenFromWatchlist } from "./tokenWatchlist";

export function WalletPanel() {
  const {
    account,
    balance,
    tokenBalances,
    busy,
    error,
    connect,
    disconnect,
    refreshPortfolio,
    transfer,
    clearError,
  } = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [trackedTokens, setTrackedTokens] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!account) {
      setTrackedTokens([]);
      return;
    }
    const tokens = loadEvmTokenWatchlist(account);
    setTrackedTokens(tokens);
    void refreshPortfolio(tokens).catch(() => undefined);
  }, [account, refreshPortfolio]);

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setNotice(null);
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
    } catch {
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
        <div className="wallet-connect-actions">
          <p className="muted">Connect a wallet to view balances and send assets. Your keys remain in your wallet.</p>
          <div className="button-row">
            <FlashButton onClick={() => void connect("evm").catch(() => undefined)} disabled={busy}>Connect EVM</FlashButton>
            <FlashButton variant="success" onClick={() => void connect("solana").catch(() => undefined)} disabled={busy}>Connect Solana</FlashButton>
          </div>
        </div>
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
          <form className="transfer-form" onSubmit={(event) => void submitTransfer(event)}>
            <h3>Send native asset</h3>
            <label>Recipient address<input required autoComplete="off" value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>
            <label>Amount<input required inputMode="decimal" min="0" step="any" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
            <FlashButton type="submit" disabled={busy}>Review and send</FlashButton>
          </form>
        </>
      )}
      {error && <p className="message message--error" role="alert">{error} <button type="button" onClick={clearError}>Dismiss</button></p>}
      {notice && <p className="message" role="status">{notice}</p>}
      <p className="wallet-disclaimer">Transactions are sent to your wallet for approval. Verify chain, address, and amount before confirming.</p>
    </GlassCard>
  );
}
