import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  EvmTokenRiskScreeningResponse,
  EvmTokenRiskSignals,
  SolanaTokenRiskScreeningResponse,
  SolanaTokenRiskSignals,
} from "@next/types";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { screenEvmToken, screenSolanaToken } from "./tokenScreeningClient";

export interface TokenScreeningPanelProps {
  accessToken: string | null;
}

const networks = [
  { chainId: "1", label: "Ethereum" },
  { chainId: "10", label: "Optimism" },
  { chainId: "56", label: "BNB Chain" },
  { chainId: "137", label: "Polygon" },
  { chainId: "8453", label: "Base" },
  { chainId: "42161", label: "Arbitrum" },
  { chainId: "43114", label: "Avalanche" },
] as const;

type BooleanSignalKey = {
  [Key in keyof EvmTokenRiskSignals]: EvmTokenRiskSignals[Key] extends boolean | null ? Key : never;
}[keyof EvmTokenRiskSignals];

const booleanSignalLabels: ReadonlyArray<[BooleanSignalKey, string]> = [
  ["honeypot", "Honeypot detected"],
  ["openSource", "Source verified"],
  ["proxy", "Proxy contract"],
  ["mintable", "Mintable supply"],
  ["ownershipRecoverable", "Ownership recoverable"],
  ["ownerCanChangeBalance", "Owner can change balances"],
  ["hiddenOwner", "Hidden owner"],
  ["selfDestruct", "Self-destruct capability"],
  ["externalCall", "External calls"],
  ["blacklisted", "Blacklist controls"],
  ["transferPausable", "Transfers pausable"],
  ["slippageModifiable", "Slippage modifiable"],
];

type SolanaBooleanSignalKey = {
  [Key in keyof SolanaTokenRiskSignals]: SolanaTokenRiskSignals[Key] extends boolean | null ? Key : never;
}[keyof SolanaTokenRiskSignals];

const solanaBooleanSignalLabels: ReadonlyArray<[SolanaBooleanSignalKey, string]> = [
  ["mintable", "Mint authority active"],
  ["freezable", "Freeze authority active"],
  ["closable", "Program closable"],
  ["balanceMutable", "Balances modifiable"],
  ["metadataMutable", "Metadata mutable"],
  ["transferFeeEnabled", "Transfer fee enabled"],
  ["transferFeeUpgradable", "Transfer fee changeable"],
  ["transferHookPresent", "Transfer hook present"],
  ["maliciousTransferHook", "Malicious hook reported"],
  ["transferHookUpgradable", "Hook configuration changeable"],
  ["defaultAccountFrozen", "Accounts default frozen"],
  ["defaultAccountStateUpgradable", "Default state changeable"],
  ["nonTransferable", "Non-transferable"],
  ["trustedToken", "Provider trusted-token label"],
];

function signalText(value: boolean | null): string {
  if (value === null) return "Unknown";
  return value ? "Yes / active" : "No / inactive";
}

type ScreeningResult = EvmTokenRiskScreeningResponse | SolanaTokenRiskScreeningResponse;

function riskTone(level: ScreeningResult["riskLevel"]): "green" | "orange" | "red" | "neutral" {
  if (level === "low") return "green";
  if (level === "medium") return "orange";
  if (level === "high" || level === "critical") return "red";
  return "neutral";
}

export function TokenScreeningPanel({ accessToken }: TokenScreeningPanelProps) {
  const [network, setNetwork] = useState("1");
  const [tokenAddress, setTokenAddress] = useState("");
  const [result, setResult] = useState<ScreeningResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    setLoading(false);
    return () => {
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [accessToken, network]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    setResult(null);
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const screening = network === "solana"
        ? screenSolanaToken(tokenAddress.trim(), accessToken, controller.signal)
        : screenEvmToken(network, tokenAddress.trim(), accessToken, controller.signal);
      setResult(await screening);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Unable to screen this token.");
      }
    } finally {
      if (!controller.signal.aborted) {
        requestController.current = null;
        setLoading(false);
      }
    }
  }

  const isSolana = network === "solana";
  const canSubmit = accessToken !== null && (isSolana
    ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenAddress.trim())
    : /^0x[a-fA-F0-9]{40}$/.test(tokenAddress.trim()));

  return (
    <GlassCard className="token-screening-panel" flashOnUpdate={result !== null}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">MULTI-CHAIN · CONTRACT INDICATORS</p>
          <h2>Token screening</h2>
        </div>
        <GlowBadge tone={result ? riskTone(result.riskLevel) : "orange"}>
          {loading ? "SCREENING" : result ? result.riskLevel.toUpperCase() : "RISK CHECK"}
        </GlowBadge>
      </div>
      <p className="muted">
        Review provider-reported contract signals before interacting with a token.
        This is not AI analysis or a safety guarantee.
      </p>
      <form className="token-screening-form" onSubmit={(event) => void submit(event)}>
        <label>
          Network
          <select
            value={network}
            onChange={(event) => {
              setNetwork(event.target.value);
              setResult(null);
              setError(null);
            }}
          >
            {networks.map((item) => (
              <option key={item.chainId} value={item.chainId}>{item.label}</option>
            ))}
            <option value="solana">Solana Mainnet</option>
          </select>
        </label>
        <label>
          {isSolana ? "Token mint address" : "Token contract address"}
          <input
            autoComplete="off"
            inputMode="text"
            maxLength={isSolana ? 44 : 42}
            pattern={isSolana ? "[1-9A-HJ-NP-Za-km-z]{32,44}" : "0x[a-fA-F0-9]{40}"}
            placeholder={isSolana ? "Base58 mint address" : "0x…"}
            value={tokenAddress}
            onChange={(event) => setTokenAddress(event.target.value)}
            required
          />
        </label>
        <FlashButton type="submit" disabled={!canSubmit || loading}>
          {!accessToken ? "Sign in to screen tokens" : loading ? "Checking…" : "Screen token"}
        </FlashButton>
      </form>
      {error && <p className="message message--error" role="alert">{error}</p>}
      {result && (
        <section className="token-screening-result" aria-live="polite" aria-label="Token screening result">
          <div className="token-screening-result__heading">
            <div>
              <p className="eyebrow">PROVIDER · {result.source}</p>
              <h3>{result.riskScore === null ? "Assessment unavailable" : `Risk score · ${result.riskScore}/100`}</h3>
              <small className="muted">
                {result.source === "GoPlus Solana beta"
                  ? "Solana Mainnet"
                  : networks.find((item) => item.chainId === result.chainId)?.label ?? `Chain ${result.chainId}`}
                {" · "}
                <code>{result.tokenAddress}</code>
              </small>
            </div>
            <GlowBadge tone={riskTone(result.riskLevel)}>{result.riskLevel.toUpperCase()}</GlowBadge>
          </div>
          <p className="muted">
            Signals observed: {result.observedSignals}/{result.totalSignals}
            {result.riskLevel === "unknown" && " · Incomplete data is not considered low risk."}
          </p>
          {result.indicators.length > 0
            ? <ul className="token-screening-indicators">{result.indicators.map((indicator) => <li key={indicator}>{indicator}</li>)}</ul>
            : result.riskLevel === "low" && <p className="muted">No concerning signals were reported in the available data.</p>}
          <dl className="token-screening-signals">
            {result.source === "GoPlus"
              ? <>
                  {booleanSignalLabels.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{signalText(result.signals[key])}</dd>
                    </div>
                  ))}
                  <div><dt>Buy tax</dt><dd>{result.signals.buyTaxPercent === null ? "Unknown" : `${result.signals.buyTaxPercent}%`}</dd></div>
                  <div><dt>Sell tax</dt><dd>{result.signals.sellTaxPercent === null ? "Unknown" : `${result.signals.sellTaxPercent}%`}</dd></div>
                </>
              : solanaBooleanSignalLabels.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{signalText(result.signals[key])}</dd>
                  </div>
                ))}
          </dl>
          <small className="muted">Updated {new Date(result.asOf).toLocaleString()}</small>
          <p className="wallet-disclaimer">{result.disclaimer}</p>
        </section>
      )}
    </GlassCard>
  );
}
