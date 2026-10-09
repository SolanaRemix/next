import { useState, type FormEvent } from "react";
import type {
  EvmSwapExecuteResponse,
  EvmSwapOrderRequest,
  EvmSwapOrderResponse,
  SwapQuoteRequest,
  SwapQuoteResponse,
  WalletAccount,
} from "@next/types";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { executeEvmSwap } from "../wallet/providers";
import { getEvmSwapStatus, requestEvmSwapOrder, submitEvmSwap } from "./evmSwapClient";
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
  executionToken: string | null;
  account: WalletAccount | null;
  authenticated: boolean;
}

export function SwapPanel({ accessToken, executionToken, account, authenticated }: SwapPanelProps) {
  const [values, setValues] = useState(initialValues);
  const [quote, setQuote] = useState<SwapQuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [executionBusy, setExecutionBusy] = useState(false);
  const [evmOrder, setEvmOrder] = useState<EvmSwapOrderResponse | null>(null);
  const [orderIdempotencyKey, setOrderIdempotencyKey] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<EvmSwapExecuteResponse | null>(null);
  const [settlementExecutionId, setSettlementExecutionId] = useState<string | null>(null);

  function update(field: keyof typeof initialValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setQuote(null);
    setEvmOrder(null);
    setOrderIdempotencyKey(null);
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

  function createOrderRequest(idempotencyKey: string = crypto.randomUUID()): EvmSwapOrderRequest {
    if (!account || account.chain !== "evm") {
      throw new Error("Connect an EVM wallet before creating a swap order.");
    }
    const chainId = Number(values.chainId);
    if (Number.parseInt(account.chainId, 16) !== chainId) {
      throw new Error("Switch your connected EVM wallet to the selected network.");
    }
    const sellDecimals = Number(values.sellDecimals);
    const buyDecimals = Number(values.buyDecimals);
    const slippagePercent = Number(values.slippagePercent);
    if (!Number.isFinite(slippagePercent) || slippagePercent <= 0 || slippagePercent > 50) {
      throw new Error("Maximum slippage must be greater than 0% and no more than 50%.");
    }
    if (!Number.isInteger(buyDecimals) || buyDecimals < 0 || buyDecimals > 36) {
      throw new Error("Buy token decimals must be between 0 and 36.");
    }
    return {
      chainId,
      sellToken: values.sellToken.trim(),
      buyToken: values.buyToken.trim(),
      sellAmount: decimalToBaseUnits(values.sellAmount, sellDecimals),
      sellDecimals,
      buyDecimals,
      maxSlippageBps: Math.round(slippagePercent * 100),
      taker: account.address,
      idempotencyKey,
    };
  }

  async function prepareSwapOrder() {
    setExecutionResult(null);
    setSettlementExecutionId(null);
    setError(null);
    setExecutionBusy(true);
    try {
      if (!executionToken) throw new Error("Trader role is required to execute EVM swaps.");
      if (!account || account.chain !== "evm") throw new Error("Connect an EVM wallet before trading.");
      const request = createOrderRequest(orderIdempotencyKey ?? crypto.randomUUID());
      setOrderIdempotencyKey(request.idempotencyKey);
      const order = await requestEvmSwapOrder(request, executionToken);
      if (Date.parse(order.expiresAt) <= Date.now()) {
        setOrderIdempotencyKey(null);
        throw new Error("Swap quote expired before it could be reviewed. Request a new order.");
      }
      setEvmOrder(order);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to request an executable 0x quote.";
      if (message.includes("order expired")) setOrderIdempotencyKey(null);
      setError(message);
    } finally {
      setExecutionBusy(false);
    }
  }

  async function executeSwap() {
    setError(null);
    setExecutionResult(null);
    setExecutionBusy(true);
    let sentTransactionHash: string | null = null;
    try {
      if (!executionToken) throw new Error("Trader role is required to execute EVM swaps.");
      if (!account || account.chain !== "evm" || !evmOrder || !orderIdempotencyKey) {
        throw new Error("Create and review an executable quote before signing.");
      }
      if (Date.parse(evmOrder.expiresAt) <= Date.now()) {
        setEvmOrder(null);
        setOrderIdempotencyKey(null);
        throw new Error("Swap order expired. Request a fresh executable quote.");
      }
      sentTransactionHash = await executeEvmSwap(account, evmOrder, (transactionHash) => {
        sentTransactionHash = transactionHash;
        setSettlementExecutionId(evmOrder.executionId);
        setExecutionResult({ status: "processing", transactionHash, error: null });
      });
      let result: EvmSwapExecuteResponse | null = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          result = await submitEvmSwap(
            evmOrder.executionId,
            sentTransactionHash,
            orderIdempotencyKey,
            executionToken,
          );
          break;
        } catch (cause) {
          if (!(cause instanceof Error) ||
              !cause.message.includes("not visible on the configured EVM RPC yet") ||
              attempt === 4) throw cause;
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
      for (let attempt = 0; result?.status === "processing" && attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        result = await getEvmSwapStatus(evmOrder.executionId, executionToken);
      }
      setExecutionResult(result);
      setSettlementExecutionId(evmOrder.executionId);
      setEvmOrder(null);
      setOrderIdempotencyKey(null);
      if (result?.status === "processing") {
        setError("Swap is still pending on-chain. Check settlement status shortly.");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to execute the EVM swap.";
      if (sentTransactionHash) {
        setEvmOrder(null);
        setOrderIdempotencyKey(null);
        setError(`Transaction ${sentTransactionHash} was submitted, but settlement verification failed: ${message}`);
      } else {
        setError(message);
      }
    } finally {
      setExecutionBusy(false);
    }
  }

  async function refreshSettlement() {
    if (!settlementExecutionId || !executionToken) return;
    setExecutionBusy(true);
    setError(null);
    try {
      setExecutionResult(await getEvmSwapStatus(settlementExecutionId, executionToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to refresh settlement status.");
    } finally {
      setExecutionBusy(false);
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
        {evmOrder
          ? <GlowBadge tone="neutral">REVIEW BEFORE SIGNING</GlowBadge>
          : bestRoute && <GlowBadge tone="green">BEST: {bestRoute.provider}</GlowBadge>}
      </div>
      <form className="swap-form" onSubmit={(event) => void getQuote(event)}>
        <label>Network
          <select disabled={busy || executionBusy} value={values.chainId} onChange={(event) => update("chainId", event.target.value)}>
            <option value="1">Ethereum</option>
            <option value="10">Optimism</option>
            <option value="56">BNB Chain</option>
            <option value="137">Polygon</option>
            <option value="8453">Base</option>
            <option value="42161">Arbitrum</option>
            <option value="43114">Avalanche</option>
          </select>
        </label>
        <label>Sell token contract<input disabled={busy || executionBusy} required spellCheck={false} autoComplete="off" placeholder="0x…" value={values.sellToken} onChange={(event) => update("sellToken", event.target.value)} /></label>
        <label>Buy token contract<input disabled={busy || executionBusy} required spellCheck={false} autoComplete="off" placeholder="0x…" value={values.buyToken} onChange={(event) => update("buyToken", event.target.value)} /></label>
        <div className="swap-form__row">
          <label>Sell amount<input disabled={busy || executionBusy} required min="0" step="any" type="number" value={values.sellAmount} onChange={(event) => update("sellAmount", event.target.value)} /></label>
          <label>Sell decimals<input disabled={busy || executionBusy} required min="0" max="36" step="1" type="number" value={values.sellDecimals} onChange={(event) => update("sellDecimals", event.target.value)} /></label>
        </div>
        <div className="swap-form__row">
          <label>Buy decimals<input disabled={busy || executionBusy} required min="0" max="36" step="1" type="number" value={values.buyDecimals} onChange={(event) => update("buyDecimals", event.target.value)} /></label>
          <label>Max slippage (%)<input disabled={busy || executionBusy} required min="0.01" max="50" step="0.01" type="number" value={values.slippagePercent} onChange={(event) => update("slippagePercent", event.target.value)} /></label>
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
      <div className="swap-execution">
        {!evmOrder ? (
          <FlashButton
            type="button"
            onClick={() => void prepareSwapOrder()}
            disabled={executionBusy || !executionToken || account?.chain !== "evm"}
          >
            {executionBusy
              ? "Requesting executable quote…"
              : executionToken
                ? "Get executable 0x quote"
                : "Trader role required to execute"}
          </FlashButton>
        ) : (
          <div className="swap-result swap-result--review">
            <h3>Review before wallet approval</h3>
            <p>Sell <strong>{formatTokenAmount(evmOrder.sellAmount, Number(values.sellDecimals))}</strong> for at least <strong>{formatTokenAmount(evmOrder.minimumBuyAmount, Number(values.buyDecimals))}</strong>.</p>
            <p className="muted">Sell token: <code>{evmOrder.sellToken}</code></p>
            <p className="muted">Buy token: <code>{evmOrder.buyToken}</code></p>
            <p className="muted">Chain {evmOrder.chainId} · Max slippage {values.slippagePercent}%</p>
            <p className="muted">Allowance spender: <code>{evmOrder.allowanceSpender}</code></p>
            <p className="muted">Swap contract: <code>{evmOrder.transaction.to}</code></p>
            <FlashButton
              type="button"
              onClick={() => void executeSwap()}
              disabled={executionBusy || !executionToken || account?.chain !== "evm"}
            >
              {executionBusy ? "Waiting for wallet…" : "Approve exact amount and swap"}
            </FlashButton>
            <button type="button" className="text-button" disabled={executionBusy} onClick={() => {
              setEvmOrder(null);
              setOrderIdempotencyKey(null);
            }}>Discard quote</button>
          </div>
        )}
        {executionResult && (
          <p className={executionResult.status === "success" ? "message message--success" : "muted"} role="status">
            EVM settlement: {executionResult.status}
            {executionResult.transactionHash ? ` · ${executionResult.transactionHash}` : ""}
            {executionResult.error ? ` · ${executionResult.error}` : ""}
          </p>
        )}
        {executionResult?.status === "processing" && settlementExecutionId && (
          <FlashButton type="button" onClick={() => void refreshSettlement()} disabled={executionBusy}>
            {executionBusy ? "Checking settlement…" : "Refresh settlement status"}
          </FlashButton>
        )}
      </div>
      <p className="wallet-disclaimer">Quotes compare 0x, 1inch, and ParaSwap. Settlement uses a fresh 0x quote, wallet-confirmed exact-input approval and swap transactions, and server-side RPC receipt verification. The app never holds keys. Confirm token addresses, amounts, spender, network, and wallet prompts before signing.</p>
    </GlassCard>
  );
}
