import { useEffect, useState } from "react";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import type { UserRole } from "@next/types";
import { useAuth } from "../auth/AuthContext";
import {
  assignAdminUserRole,
  fetchAdminUsers,
  setAdminUserStatus,
} from "./usersClient";
import type { AccountRestrictionReason, AdminUser } from "./usersClient";

const apiUrl = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/+$/, "");
const roles: readonly UserRole[] = [
  "SuperAdmin",
  "EnterpriseAdmin",
  "Trader",
  "Viewer",
  "Guest",
];
const restrictionReasons: ReadonlyArray<{ value: AccountRestrictionReason; label: string }> = [
  { value: "account_compromise", label: "Account compromise" },
  { value: "policy_review", label: "Policy review" },
  { value: "legal_request", label: "Legal request" },
  { value: "other", label: "Other" },
];

export function UserManagementPanel({ accessToken }: { accessToken: string }) {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [confirmPromotion, setConfirmPromotion] = useState<Record<string, boolean>>({});
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, AccountRestrictionReason>>({});
  const [confirmRestrict, setConfirmRestrict] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadFirstPage() {
    setLoading(true);
    setError(null);
    try {
      const firstPage = await fetchAdminUsers(apiUrl, accessToken);
      setUsers(firstPage);
      setCursor(firstPage.length > 0 ? firstPage[firstPage.length - 1]?.id ?? null : null);
      setHasMore(firstPage.length === 50);
      setRoleDrafts(Object.fromEntries(firstPage.map((entry) => [entry.id, entry.role])));
      setConfirmPromotion({});
      setReasonDrafts({});
      setConfirmRestrict({});
    } catch (cause) {
      setUsers([]);
      setCursor(null);
      setHasMore(false);
      setError(cause instanceof Error ? cause.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchAdminUsers(apiUrl, accessToken)
      .then((page) => {
        if (!active) return;
        setUsers(page);
        setCursor(page.length > 0 ? page[page.length - 1]?.id ?? null : null);
        setHasMore(page.length === 50);
        setRoleDrafts(Object.fromEntries(page.map((entry) => [entry.id, entry.role])));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load users.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);

  async function loadMore() {
    if (!cursor || loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const nextPage = await fetchAdminUsers(apiUrl, accessToken, cursor);
      setUsers((existing) => {
        const known = new Set(existing.map((entry) => entry.id));
        const unique = nextPage.filter((entry) => !known.has(entry.id));
        return [...existing, ...unique];
      });
      setRoleDrafts((existing) => ({
        ...existing,
        ...Object.fromEntries(nextPage.map((entry) => [entry.id, entry.role])),
      }));
      setCursor(nextPage.length > 0 ? nextPage[nextPage.length - 1]?.id ?? null : null);
      setHasMore(nextPage.length === 50);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load more users.");
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(target: AdminUser) {
    const role = roleDrafts[target.id];
    if (!role || role === target.role || busyUserId) return;
    if (role === "SuperAdmin" && !confirmPromotion[target.id]) return;
    setBusyUserId(target.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await assignAdminUserRole(apiUrl, accessToken, target.id, role);
      setUsers((existing) => existing.map((entry) =>
        entry.id === updated.id ? { ...entry, role: updated.role } : entry,
      ));
      setRoleDrafts((existing) => ({ ...existing, [target.id]: updated.role }));
      setConfirmPromotion((existing) => ({ ...existing, [target.id]: false }));
      setNotice(`Role updated for ${updated.email}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the account role.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function changeStatus(target: AdminUser) {
    const nextStatus = target.accountStatus === "Active" ? "Restricted" : "Active";
    if (nextStatus === "Restricted" && !confirmRestrict[target.id]) return;
    setBusyUserId(target.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await setAdminUserStatus(
        apiUrl,
        accessToken,
        target.id,
        nextStatus,
        reasonDrafts[target.id] ?? "other",
      );
      setUsers((existing) => existing.map((entry) => entry.id === updated.id ? updated : entry));
      setConfirmRestrict((existing) => ({ ...existing, [target.id]: false }));
      setNotice(updated.accountStatus === "Restricted"
        ? `Account restricted: ${updated.email}. Active refresh sessions were revoked.`
        : `Account restored: ${updated.email}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the account status.");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <GlassCard className="user-management-panel">
      <section aria-labelledby="user-management-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SUPERADMIN ACCESS</p>
            <h2 id="user-management-heading">User management</h2>
          </div>
          <button type="button" className="text-button" onClick={() => void loadFirstPage()} disabled={loading || busyUserId !== null}>
            Refresh
          </button>
        </div>
        <p className="muted">Changes are audited. Restricting an account revokes refresh sessions; issued access tokens can remain valid until they expire.</p>
        {loading && <p className="muted" role="status">Loading users…</p>}
        {!loading && users.length === 0 && !error && <p className="muted">No user accounts found.</p>}
        <div className="admin-user-list">
          {users.map((target) => {
            const isCurrentUser = target.id === currentUser?.id;
            const targetBusy = busyUserId === target.id;
            const roleChanged = roleDrafts[target.id] !== target.role;
            const promotionPending = roleDrafts[target.id] === "SuperAdmin" && target.role !== "SuperAdmin";
            const canSubmitStatus = target.accountStatus === "Restricted"
              || (!isCurrentUser && confirmRestrict[target.id] === true);
            return (
              <article className="admin-user-row" key={target.id}>
                <div className="admin-user-heading">
                  <div>
                    <strong>{target.email}</strong>
                    <span className="muted">Created {new Date(target.createdAt).toLocaleDateString()}</span>
                  </div>
                  <GlowBadge tone={target.accountStatus === "Active" ? "green" : "red"}>
                    {target.accountStatus.toUpperCase()}
                  </GlowBadge>
                </div>
                <div className="admin-user-actions">
                  <label>
                    Role
                    <select
                      value={roleDrafts[target.id] ?? target.role}
                      disabled={targetBusy || busyUserId !== null}
                      onChange={(event) => {
                        const role = event.target.value as UserRole;
                        setRoleDrafts((existing) => ({ ...existing, [target.id]: role }));
                        if (role !== "SuperAdmin") {
                          setConfirmPromotion((existing) => ({ ...existing, [target.id]: false }));
                        }
                      }}
                    >
                      {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </label>
                  {promotionPending && (
                    <label className="admin-user-confirm">
                      <input
                        type="checkbox"
                        checked={confirmPromotion[target.id] ?? false}
                        disabled={targetBusy || busyUserId !== null}
                        onChange={(event) => setConfirmPromotion((existing) => ({
                          ...existing,
                          [target.id]: event.target.checked,
                        }))}
                      />
                      Confirm SuperAdmin promotion
                    </label>
                  )}
                  <FlashButton
                    type="button"
                    disabled={targetBusy || busyUserId !== null || !roleChanged
                      || (promotionPending && !confirmPromotion[target.id])}
                    onClick={() => void changeRole(target)}
                  >
                    {targetBusy && roleChanged ? "Saving…" : "Save role"}
                  </FlashButton>
                </div>
                <div className="admin-user-actions">
                  <label>
                    Status-change reason
                    <select
                      value={reasonDrafts[target.id] ?? "other"}
                      disabled={targetBusy || busyUserId !== null}
                      onChange={(event) => setReasonDrafts((existing) => ({
                        ...existing,
                        [target.id]: event.target.value as AccountRestrictionReason,
                      }))}
                    >
                      {restrictionReasons.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  {target.accountStatus === "Active" && (
                    <label className="admin-user-confirm">
                      <input
                        type="checkbox"
                        checked={confirmRestrict[target.id] ?? false}
                        disabled={isCurrentUser || targetBusy || busyUserId !== null}
                        onChange={(event) => setConfirmRestrict((existing) => ({
                          ...existing,
                          [target.id]: event.target.checked,
                        }))}
                      />
                      Confirm restriction
                    </label>
                  )}
                  <FlashButton
                    type="button"
                    variant={target.accountStatus === "Active" ? "danger" : "success"}
                    disabled={targetBusy || busyUserId !== null || !canSubmitStatus}
                    onClick={() => void changeStatus(target)}
                  >
                    {targetBusy
                      ? "Updating…"
                      : target.accountStatus === "Active" ? "Restrict account" : "Restore account"}
                  </FlashButton>
                </div>
                {isCurrentUser && <span className="muted">Your own account cannot be restricted here.</span>}
              </article>
            );
          })}
        </div>
        {hasMore && (
          <div className="admin-users-more">
            <FlashButton type="button" disabled={loading || busyUserId !== null} onClick={() => void loadMore()}>
              {loading ? "Loading…" : "Load more users"}
            </FlashButton>
          </div>
        )}
        {error && <p className="message message--error" role="alert">{error}</p>}
        {notice && <p className="message message--success" role="status">{notice}</p>}
        <p className="muted admin-users-note">Role and restriction actions are SuperAdmin-only server operations. Restriction is an administrative control, not KYC, AML, or sanctions screening.</p>
      </section>
    </GlassCard>
  );
}
