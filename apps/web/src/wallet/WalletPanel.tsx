import { useState, type FormEvent } from "react";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { useWallet } from "./WalletContext";

export function WalletPanel() {
  const { account, balance, busy, error, connect, disconnect, refreshBalance, transfer, clearError } = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

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
              <FlashButton onClick={() => void refreshBalance().catch(() => undefined)} disabled={busy}>Refresh</FlashButton>
              <FlashButton variant="danger" onClick={() => void disconnect().catch(() => undefined)} disabled={busy}>Disconnect</FlashButton>
            </div>
          </div>
          <div className="balance-tile">
            <span className="muted">Native balance</span>
            <strong>{balance ? `${Number(balance.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${balance.asset}` : "Not loaded"}</strong>
          </div>
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
