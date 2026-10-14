import { useEffect, useState, type FormEvent } from "react";
import type { EvmQuoteProvider } from "@next/types";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { fetchAggregatorControls, updateAggregatorControls } from "./aggregatorControlsClient";
import type { AggregatorControlState } from "./aggregatorControlsClient";

const apiUrl = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/+$/, "");
const providerLabels: Record<EvmQuoteProvider, string> = {
  "0x": "0x",
  "1inch": "1inch",
  paraswap: "ParaSwap",
};
const providerDescriptions: Record<EvmQuoteProvider, string> = {
  "0x": "Quote comparison and separate 0x execution integration.",
  "1inch": "Indicative quote comparison; requires ONEINCH_API_KEY.",
  paraswap: "Indicative quote comparison; public quote endpoint.",
};
const supportedProviders = Object.keys(providerLabels) as EvmQuoteProvider[];

export function AggregatorControlsPanel({ accessToken }: { accessToken: string }) {
  const [state, setState] = useState<AggregatorControlState | null>(null);
  const [selection, setSelection] = useState<EvmQuoteProvider[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAggregatorControls(apiUrl, accessToken)
      .then((control) => {
        if (!active) return;
        setState(control);
        setSelection(control.enabledProviders);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load aggregator controls.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);

  function toggle(provider: EvmQuoteProvider, enabled: boolean) {
    setSelection((current) => enabled
      ? [...current, provider]
      : current.filter((candidate) => candidate !== provider));
    setNotice(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !state) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await updateAggregatorControls(apiUrl, accessToken, selection, reason);
      setState(next);
      setSelection(next.enabledProviders);
      setReason("");
      setNotice("EVM quote provider controls updated and audited.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update aggregator controls.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className="aggregator-controls-panel">
      <section aria-labelledby="aggregator-controls-heading">
        <div className="section-heading">
          <div><p className="eyebrow">SUPERADMIN CONTROL</p><h2 id="aggregator-controls-heading">EVM quote providers</h2></div>
          <GlowBadge tone={state && state.enabledProviders.length > 0 ? "green" : "red"}>
            {state ? `${state.enabledProviders.length} ENABLED` : "UNAVAILABLE"}
          </GlowBadge>
        </div>
        <p className="muted">
          Controls indicative quote fan-out only. Executable EVM swaps continue to use a fresh 0x order;
          disabling 0x here does not disable execution. Use the financial kill switch to stop new execution orders.
        </p>
        {loading && <p className="muted" role="status">Loading provider controls…</p>}
        {state && (
          <form className="financial-control-form" onSubmit={(event) => void submit(event)}>
            <div className="aggregator-provider-options">
              {supportedProviders.map((provider) => (
                <label className="financial-control-confirm" key={provider}>
                  <input
                    type="checkbox"
                    checked={selection.includes(provider)}
                    onChange={(event) => toggle(provider, event.currentTarget.checked)}
                    disabled={busy}
                  />
                  <span>
                    <strong>{providerLabels[provider]}</strong>
                    <span className="muted">{providerDescriptions[provider]}</span>
                  </span>
                </label>
              ))}
            </div>
            <label>
              Audit reason
              <textarea
                required
                minLength={3}
                maxLength={500}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
                placeholder="Explain the operational reason for this provider change"
              />
            </label>
            {selection.length === 0 && (
              <p className="message message--error">No providers selected: EVM quote requests will fail closed.</p>
            )}
            {state.updatedAt && (
              <p className="muted">Last changed {new Date(state.updatedAt).toLocaleString()}</p>
            )}
            <FlashButton
              type="submit"
              disabled={busy || !reason.trim() || (
                selection.length === state.enabledProviders.length
                && selection.every((provider) => state.enabledProviders.includes(provider))
              )}
            >
              {busy ? "Saving…" : "Save provider selection"}
            </FlashButton>
          </form>
        )}
        {error && <p className="message message--error" role="alert">{error}</p>}
        {notice && <p className="message message--success" role="status">{notice}</p>}
        <p className="muted">
          Provider API credentials remain server-side in environment configuration. Only the currently integrated
          0x, 1inch, and ParaSwap quote sources are available here.
        </p>
      </section>
    </GlassCard>
  );
}
