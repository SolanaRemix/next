import { useEffect, useState, type FormEvent } from "react";
import { GlassCard, GlowBadge } from "@next/ui";
import { fetchAuditLogs } from "./auditLogsClient";
import type { AuditLogEntry, AuditLogPage } from "./auditLogsClient";

const apiUrl = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/+$/, "");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function AuditLogPanel({ accessToken }: { accessToken: string }) {
  const [page, setPage] = useState<AuditLogPage>({ entries: [], nextCursor: null });
  const [actionDraft, setActionDraft] = useState("");
  const [actorDraft, setActorDraft] = useState("");
  const [filters, setFilters] = useState<{ action?: string; actorId?: string }>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadFirst(nextFilters = filters) {
    setLoading(true);
    setError(null);
    try {
      setPage(await fetchAuditLogs(apiUrl, accessToken, nextFilters));
    } catch (cause) {
      setPage({ entries: [], nextCursor: null });
      setError(cause instanceof Error ? cause.message : "Unable to load audit logs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchAuditLogs(apiUrl, accessToken)
      .then((result) => { if (active) setPage(result); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load audit logs.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = actionDraft.trim();
    const actorId = actorDraft.trim();
    if (actorId && !uuidPattern.test(actorId)) {
      setError("Enter a valid actor UUID.");
      return;
    }
    const nextFilters = {
      ...(action ? { action } : {}),
      ...(actorId ? { actorId } : {}),
    };
    setFilters(nextFilters);
    await loadFirst(nextFilters);
  }

  async function loadMore() {
    if (!page.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await fetchAuditLogs(apiUrl, accessToken, { ...filters, cursor: page.nextCursor });
      setPage((current) => ({
        entries: [...current.entries, ...next.entries],
        nextCursor: next.nextCursor,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load more audit logs.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <GlassCard className="audit-log-panel">
      <section aria-labelledby="audit-log-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SECURITY & COMPLIANCE</p>
            <h2 id="audit-log-heading">Audit log</h2>
          </div>
          <button type="button" className="text-button" onClick={() => void loadFirst()} disabled={loading || loadingMore}>
            Refresh
          </button>
        </div>
        <p className="muted">Newest events first. Filters use exact action and actor ID matches.</p>
        <form className="audit-filter-form" onSubmit={(event) => void applyFilters(event)}>
          <label>
            Action
            <input
              maxLength={120}
              value={actionDraft}
              onChange={(event) => setActionDraft(event.target.value)}
              placeholder="e.g. admin.user.role_changed"
            />
          </label>
          <label>
            Actor UUID
            <input
              maxLength={36}
              value={actorDraft}
              onChange={(event) => setActorDraft(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <div className="button-row">
            <button type="submit" className="text-button" disabled={loading || loadingMore}>Apply filters</button>
            {(filters.action || filters.actorId) && (
              <button
                type="button"
                className="text-button"
                disabled={loading || loadingMore}
                onClick={() => {
                  setActionDraft("");
                  setActorDraft("");
                  setFilters({});
                  void loadFirst({});
                }}
              >
                Clear
              </button>
            )}
          </div>
        </form>
        {loading && <p className="muted" role="status">Loading audit entries…</p>}
        {!loading && page.entries.length === 0 && !error && <p className="muted">No matching audit entries.</p>}
        <div className="audit-entry-list">
          {page.entries.map((entry) => <AuditEntryCard entry={entry} key={entry.id} />)}
        </div>
        {page.nextCursor && (
          <div className="audit-load-more">
            <button type="button" className="text-button" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load older entries"}
            </button>
          </div>
        )}
        {error && <p className="message message--error" role="alert">{error}</p>}
        <p className="muted audit-log-note">Audit records are read-only here. Sensitive request bodies and credentials are not displayed as raw request data.</p>
      </section>
    </GlassCard>
  );
}

function AuditEntryCard({ entry }: { entry: AuditLogEntry }) {
  const outcome = entry.metadata && typeof entry.metadata === "object"
    && !Array.isArray(entry.metadata)
    && "outcome" in entry.metadata
    ? entry.metadata.outcome
    : null;
  const outcomeTone = outcome === "failure" ? "red" : outcome === "success" ? "green" : "neutral";

  return (
    <article className="audit-entry">
      <div className="audit-entry-heading">
        <div>
          <strong>{entry.action}</strong>
          <span className="muted">{new Date(entry.createdAt).toLocaleString()}</span>
        </div>
        {typeof outcome === "string" && <GlowBadge tone={outcomeTone}>{outcome.toUpperCase()}</GlowBadge>}
      </div>
      <p className="muted audit-actor">
        Actor: {entry.actorEmail ?? "System / unknown"}{entry.actorId ? ` · ${entry.actorId}` : ""}
      </p>
      <details>
        <summary>Event metadata</summary>
        <pre>{JSON.stringify(entry.metadata, null, 2)}</pre>
      </details>
    </article>
  );
}
