import { useState, type FormEvent } from "react";
import type {
  MarginMode,
  PerpetualRiskCheckRequest,
  PerpetualRiskCheckResult,
  PerpetualSide,
} from "@next/types";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { checkPerpetualRisk } from "./riskClient";

const initialValues = {
  entryPrice: "68000",
  markPrice: "68000",
  quantity: "0.01",
  availableMargin: "150",
  takeProfit: "",
  stopLoss: "",
};

function currency(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function PerpetualTradingPanel() {
  const [side, setSide] = useState<PerpetualSide>("long");
  const [marginMode, setMarginMode] = useState<MarginMode>("isolated");
  const [leverage, setLeverage] = useState(5);
  const [values, setValues] = useState(initialValues);
  const [result, setResult] = useState<PerpetualRiskCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setField(field: keyof typeof initialValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setResult(null);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const request: PerpetualRiskCheckRequest = {
        side,
        marginMode,
        leverage,
        entryPrice: Number(values.entryPrice),
        markPrice: Number(values.markPrice),
        quantity: Number(values.quantity),
        availableMargin: Number(values.availableMargin),
        ...(values.takeProfit ? { takeProfit: Number(values.takeProfit) } : {}),
        ...(values.stopLoss ? { stopLoss: Number(values.stopLoss) } : {}),
      };
      setResult(await checkPerpetualRisk(request));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete the risk check.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className="perpetual-panel" glowColor={result?.eligible ? "green" : "none"} flashOnUpdate={result !== null}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">RISK-GATED · SIMULATION ONLY</p>
          <h2>Perpetual risk check</h2>
        </div>
        <GlowBadge tone="orange">{leverage}× leverage</GlowBadge>
      </div>
      <form className="perpetual-form" onSubmit={(event) => void submit(event)}>
        <div className="trade-toggle" role="group" aria-label="Position direction">
          <button type="button" aria-pressed={side === "long"} className={side === "long" ? "is-selected is-long" : ""} onClick={() => { setSide("long"); setResult(null); }}>Long</button>
          <button type="button" aria-pressed={side === "short"} className={side === "short" ? "is-selected is-short" : ""} onClick={() => { setSide("short"); setResult(null); }}>Short</button>
        </div>
        <label className="leverage-control">
          <span>Leverage <strong>{leverage}×</strong></span>
          <input aria-label="Leverage" type="range" min="1" max="100" step="1" value={leverage} onChange={(event) => { setLeverage(Number(event.target.value)); setResult(null); }} />
          <span className="range-labels"><span>1×</span><span>100×</span></span>
        </label>
        <div className="perpetual-fields">
          <label>Margin mode
            <select value={marginMode} onChange={(event) => { setMarginMode(event.target.value as MarginMode); setResult(null); }}>
              <option value="isolated">Isolated</option>
              <option value="cross">Cross</option>
            </select>
          </label>
          <label>Entry price<input required min="0.00000001" step="any" type="number" value={values.entryPrice} onChange={(event) => setField("entryPrice", event.target.value)} /></label>
          <label>Mark price<input required min="0.00000001" step="any" type="number" value={values.markPrice} onChange={(event) => setField("markPrice", event.target.value)} /></label>
          <label>Quantity<input required min="0.00000001" step="any" type="number" value={values.quantity} onChange={(event) => setField("quantity", event.target.value)} /></label>
          <label>Available margin (USD)<input required min="0" step="any" type="number" value={values.availableMargin} onChange={(event) => setField("availableMargin", event.target.value)} /></label>
          <label>Take-profit (optional)<input min="0.00000001" step="any" type="number" value={values.takeProfit} onChange={(event) => setField("takeProfit", event.target.value)} /></label>
          <label>Stop-loss (optional)<input min="0.00000001" step="any" type="number" value={values.stopLoss} onChange={(event) => setField("stopLoss", event.target.value)} /></label>
        </div>
        <FlashButton type="submit" disabled={busy}>{busy ? "Checking risk…" : "Run backend risk check"}</FlashButton>
      </form>
      {error && <p className="message message--error" role="alert">{error}</p>}
      {result && (
        <div className="risk-result" role="status" aria-live="polite">
          <div className="risk-result__heading">
            <h3>{result.eligible ? "Risk check passed" : "Order would be rejected"}</h3>
            <GlowBadge tone={result.eligible ? "green" : "red"}>{result.eligible ? "ELIGIBLE" : "BLOCKED"}</GlowBadge>
          </div>
          {result.reason && <p className="message--error">{result.reason}</p>}
          <dl>
            <div><dt>Position notional</dt><dd>${currency(result.notional)}</dd></div>
            <div><dt>Initial margin</dt><dd>${currency(result.initialMargin)}</dd></div>
            <div><dt>Required with buffer</dt><dd>${currency(result.requiredMargin)}</dd></div>
            <div><dt>Estimated liquidation</dt><dd>${currency(result.estimatedLiquidationPrice)}</dd></div>
            <div><dt>Unrealized PnL at mark</dt><dd>${currency(result.unrealizedPnlAtMark)}</dd></div>
          </dl>
        </div>
      )}
      <p className="wallet-disclaimer">Simulation only. This endpoint does not place orders or broadcast transactions. Liquidation estimates use a simplified maintenance and fee-buffer model and are not an exchange quote.</p>
    </GlassCard>
  );
}
