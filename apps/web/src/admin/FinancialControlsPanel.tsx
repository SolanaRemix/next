import { useEffect, useState, type FormEvent } from "react";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { fetchExecutionControl, updateExecutionControl } from "./financialControlsClient";
import type { ExecutionControlState } from "./financialControlsClient";

const apiUrl = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/+$/, "");

export function FinancialControlsPanel({ accessToken }: { accessToken: string }) {
  const [state, setState] = useState<ExecutionControlState | null>(null);
  const [reason, setReason] = useState("");
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setState(await fetchExecutionControl(apiUrl, accessToken));
    } catch (cause) {
      setState(null);
      setError(cause instanceof Error ? cause.message : "Unable to load financial controls.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchExecutionControl(apiUrl, accessToken)
      .then((control) => { if (active) setState(control); })
      .catch((cause: unknown) => {
        if (active) {
          setState(null);
          setError(cause instanceof Error ? cause.message : "Unable to load financial controls.");
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || busy) return;
    const enabled = !state.enabled;
    if (enabled && !confirmEnable) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await updateExecutionControl(apiUrl, accessToken, enabled, reason);
      setState(next);
      setReason("");
      setConfirmEnable(false);
      setNotice(enabled
        ? "Financial execution enabled. Verify your rollout controls and monitoring."
        : "Financial execution disabled by the global control.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update financial controls.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className="financial-controls-panel">
      <section aria-labelledby="financial-controls-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SUPERADMIN CONTROL</p>
            <h2 id="financial-controls-heading">Global financial execution</h2>
          </div>
          <button type="button" className="text-button" onClick={() => void refresh()} disabled={loading || busy}>
            Refresh
          </button>
        </div>
        {loading && <p className="muted" role="status">Loading control state…</p>}
        {!loading && state && (
          <>
            <div className="financial-control-status">
              <span>New financial execution requests</span>
              <GlowBadge tone={state.enabled ? "green" : "red"}>
                {state.enabled ? "ENABLED" : "DISABLED"}
              </GlowBadge>
            </div>
            <p className="muted">
              {state.updatedAt
                ? `Last changed ${new Date(state.updatedAt).toLocaleString()}${state.updatedBy ? ` · actor ${state.updatedBy}` : ""}`
                : "No recorded changes. The default state is disabled."}
            </p>
            <form className="financial-control-form" onSubmit={(event) => void submit(event)}>
              <label>
                Audit reason
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Explain the operational reason for this change"
                />
              </label>
              {state.enabled && (
                <p className="muted">Disabling blocks new financial execution requests. Existing submitted transactions cannot be reversed.</p>
              )}
              {!state.enabled && (
                <label className="financial-control-confirm">
                  <input
                    type="checkbox"
                    checked={confirmEnable}
                    onChange={(event) => setConfirmEnable(event.target.checked)}
                  />
                  I confirm that enabling financial execution is intentional.
                </label>
              )}
              <FlashButton
                type="submit"
                variant={state.enabled ? "danger" : "success"}
                disabled={busy || !reason.trim() || (!state.enabled && !confirmEnable)}
              >
                {busy ? "Updating…" : state.enabled ? "Disable financial execution" : "Enable financial execution"}
              </FlashButton>
            </form>
          </>
        )}
        {error && <p className="message message--error" role="alert">{error}</p>}
        {notice && <p className="message message--success" role="status">{notice}</p>}
        <p className="muted financial-control-note">
          Backend authorization and the persisted global control remain authoritative. If the state cannot be loaded, this panel provides no change action.
        </p>
      </section>
    </GlassCard>
  );
}
