import { useState, type FormEvent } from "react";
import type { SolanaSwapExecuteResponse, SolanaSwapOrderResponse, WalletAccount } from "@next/types";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { executeSolanaSwap, requestSolanaSwapOrder } from "./solanaSwapClient";
import { signSolanaSwapTransaction } from "../wallet/providers";

const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function toBaseUnits(amountValue: string, decimalsValue: string): string {
  const decimals = Number(decimalsValue);
  const amount = amountValue.trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("Token decimals must be between 0 and 18.");
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) {
    throw new Error("Enter a valid positive swap amount.");
  }
  const [whole = "", fractional = ""] = amount.split(".");
  if (fractional.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places.`);
  }
  const baseUnits = BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fractional + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (baseUnits <= 0n || baseUnits > 18_446_744_073_709_551_615n) {
    throw new Error("Amount is outside the supported Solana token range.");
  }
  return baseUnits.toString();
}

export interface SolanaSwapPanelProps {
  accessToken: string | null;
  account: WalletAccount | null;
  onConnectWallet: () => void;
}

export function SolanaSwapPanel({
  accessToken,
  account,
  onConnectWallet,
}: SolanaSwapPanelProps) {
  const [inputMint, setInputMint] = useState("");
  const [outputMint, setOutputMint] = useState("");
  const [amount, setAmount] = useState("");
  const [inputDecimals, setInputDecimals] = useState("9");
  const [order, setOrder] = useState<SolanaSwapOrderResponse | null>(null);
  const [result, setResult] = useState<SolanaSwapExecuteResponse | null>(null);
  const [pending, setPending] = useState<{
    signedTransaction: string;
    idempotencyKey: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearOrder() {
    setOrder(null);
    setResult(null);
    setPending(null);
    setError(null);
  }

  async function getOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearOrder();
    setBusy(true);
    try {
      if (!accessToken) throw new Error("Sign in with the Trader role to place a swap.");
      if (!account || account.chain !== "solana") {
        throw new Error("Connect a Solana wallet before requesting a swap order.");
      }
      const from = inputMint.trim();
      const to = outputMint.trim();
      if (!mintPattern.test(from) || !mintPattern.test(to)) {
        throw new Error("Enter valid Solana token mint addresses.");
      }
      if (from === to) throw new Error("Input and output tokens must be different.");
      const response = await requestSolanaSwapOrder({
        inputMint: from,
        outputMint: to,
        amount: toBaseUnits(amount, inputDecimals),
        taker: account.address,
        idempotencyKey: crypto.randomUUID(),
      }, accessToken);
      setOrder(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to request a swap order.");
    } finally {
      setBusy(false);
    }
  }

  async function signAndExecute() {
    if (!order || !accessToken || !account || account.chain !== "solana") return;
    setBusy(true);
    setError(null);
    try {
      const submission = pending ?? {
        signedTransaction: await signSolanaSwapTransaction(account, order.transaction),
        idempotencyKey: crypto.randomUUID(),
      };
      if (!pending) setPending(submission);
      const response = await executeSolanaSwap({
        executionId: order.executionId,
        requestId: order.requestId,
        signedTransaction: submission.signedTransaction,
        idempotencyKey: submission.idempotencyKey,
      }, accessToken);
      setResult(response);
      if (response.status !== "processing") setPending(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit the signed swap.");
    } finally {
      setBusy(false);
    }
  }

  const walletReady = account?.chain === "solana";

  return (
    <GlassCard className="swap-panel solana-swap-panel" glowColor={order ? "orange" : "none"} flashOnUpdate={order !== null || result !== null}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">SOLANA · JUPITER SWAP V2</p>
          <h2>On-chain token swap</h2>
        </div>
        <GlowBadge tone={result?.status === "success" ? "green" : "orange"}>
          {result?.status === "success" ? "SUBMITTED" : "WALLET-SIGNED"}
        </GlowBadge>
      </div>
      {!walletReady && (
        <div className="message">
          <p className="muted">A connected Solana wallet is required. The wallet signs locally; the app never receives private keys.</p>
          <FlashButton type="button" onClick={onConnectWallet} disabled={!accessToken}>
            {accessToken ? "Connect Solana wallet" : "Sign in as Trader to swap"}
          </FlashButton>
        </div>
      )}
      <form className="swap-form" onSubmit={(event) => void getOrder(event)}>
        <label>Input token mint
          <input required autoComplete="off" spellCheck={false} value={inputMint} onChange={(event) => { setInputMint(event.target.value); clearOrder(); }} placeholder="So11111111111111111111111111111111111111112" />
        </label>
        <label>Output token mint
          <input required autoComplete="off" spellCheck={false} value={outputMint} onChange={(event) => { setOutputMint(event.target.value); clearOrder(); }} placeholder="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" />
        </label>
        <div className="swap-form__row">
          <label>Input amount
            <input required type="number" min="0" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); clearOrder(); }} />
          </label>
          <label>Input token decimals
            <input required type="number" min="0" max="18" step="1" value={inputDecimals} onChange={(event) => { setInputDecimals(event.target.value); clearOrder(); }} />
          </label>
        </div>
        <p className="muted">Dynamic slippage (Jupiter RTSE) and provider-optimized landing fees are enabled. Jupiter handles submission and confirmation; MEV mitigation is not a guarantee.</p>
        <FlashButton type="submit" disabled={busy || !accessToken || !walletReady}>
          {busy ? "Requesting order…" : "Get dynamic swap order"}
        </FlashButton>
      </form>
      {error && <p className="message message--error" role="alert">{error}</p>}
      {order && (
        <div className="swap-result" aria-live="polite">
          <p><strong>Minimum output:</strong> {order.minimumOutputAmount} base units</p>
          <p><strong>Dynamic slippage:</strong> {order.slippageBps} bps</p>
          <p><strong>Estimated landing fee:</strong> {order.prioritizationFeeLamports === null ? "Provider-managed" : `${order.prioritizationFeeLamports} lamports`}</p>
          <p><strong>Route:</strong> {order.router ?? "Jupiter multi-router"}</p>
          <p className="muted">Review the transaction in your wallet before approving. Order expires at {new Date(order.expiresAt).toLocaleTimeString()}.</p>
          <FlashButton type="button" onClick={() => void signAndExecute()} disabled={busy || !walletReady}>
            {busy ? "Submitting…" : pending ? "Retry the same submission" : "Review, sign & swap"}
          </FlashButton>
        </div>
      )}
      {result && (
        <div className="swap-result" role="status">
          <p>{result.status === "success" ? "Swap submitted successfully." : result.status === "failed" ? "Jupiter reported that the swap failed." : "Swap execution is still processing."}</p>
          {result.signature && <a href={`https://explorer.solana.com/tx/${encodeURIComponent(result.signature)}`} target="_blank" rel="noreferrer">View transaction</a>}
          {result.error && <p className="message message--error">{result.error}</p>}
        </div>
      )}
      <p className="wallet-disclaimer">This execution path uses Jupiter order/execute; it does not use indexed market spreads as executable slippage. Verify token mints, fees, and outputs in your wallet.</p>
    </GlassCard>
  );
}
