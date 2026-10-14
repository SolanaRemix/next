import { useEffect, useState, type FormEvent } from "react";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { useAuth } from "./AuthContext";
import { changePassword, fetchSessions, revokeOtherSessions, revokeSession } from "./sessionsClient";
import type { SessionSummary } from "./sessionsClient";

const apiUrl = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/+$/, "");

function SessionManager({
  accessToken,
  logout,
  updateAccessToken,
}: {
  accessToken: string;
  logout: () => Promise<void>;
  updateAccessToken: (accessToken: string, expiresIn: number) => void;
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadSessions() {
    setLoading(true);
    setError(null);
    try {
      setSessions(await fetchSessions(apiUrl, accessToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load sessions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchSessions(apiUrl, accessToken)
      .then((result) => { if (active) setSessions(result); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load sessions.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);

  async function revoke(id: string, current: boolean) {
    setBusySessionId(id);
    setError(null);
    setNotice(null);
    try {
      await revokeSession(apiUrl, accessToken, id);
      if (current) {
        await logout();
        return;
      }
      await loadSessions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke session.");
    } finally {
      setBusySessionId(null);
    }
  }

  async function revokeOthers() {
    if (!window.confirm("Sign out all other active sessions? This device will stay signed in.")) return;
    setRevokingOthers(true);
    setError(null);
    setNotice(null);
    try {
      const revokedCount = await revokeOtherSessions(apiUrl, accessToken);
      await loadSessions();
      setNotice(`${revokedCount} other active session${revokedCount === 1 ? "" : "s"} revoked.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke other sessions.");
    } finally {
      setRevokingOthers(false);
    }
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setChangingPassword(true);
    try {
      const result = await changePassword(
        apiUrl,
        accessToken,
        currentPassword,
        newPassword,
      );
      updateAccessToken(result.accessToken, result.expiresIn);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice(
        `Password updated. ${result.revokedOtherSessions} other session${result.revokedOtherSessions === 1 ? "" : "s"} signed out.`,
      );
      await loadSessions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to change password.");
    } finally {
      setChangingPassword(false);
    }
  }

  const activeOtherSessions = sessions.filter((session) =>
    !session.current &&
    session.revokedAt === null &&
    Date.parse(session.expiresAt) > Date.now(),
  ).length;

  return (
    <section className="session-manager" aria-labelledby="sessions-heading">
      <div className="section-heading">
        <div><p className="eyebrow">ACCOUNT SECURITY</p><h3 id="sessions-heading">Signed-in sessions</h3></div>
        <div className="button-row">
          {activeOtherSessions > 0 && (
            <button
              type="button"
              className="text-button session-revoke"
              onClick={() => void revokeOthers()}
              disabled={loading || revokingOthers || changingPassword || busySessionId !== null}
            >
              {revokingOthers ? "Revoking…" : "Sign out other devices"}
            </button>
          )}
          <button type="button" className="text-button" onClick={() => void loadSessions()} disabled={loading}>Refresh</button>
        </div>
      </div>
      {loading && <p className="muted" role="status">Loading sessions…</p>}
      {!loading && sessions.length === 0 && <p className="muted">No refresh sessions found.</p>}
      {sessions.map((session) => {
        const revoked = session.revokedAt !== null;
        const expired = Date.parse(session.expiresAt) <= Date.now();
        const canRevoke = !revoked && !expired;
        return (
          <div className="session-row" key={session.id}>
            <div>
              <div className="button-row">
                <strong>{session.current ? "This device" : "Signed-in device"}</strong>
                <GlowBadge tone={session.current ? "green" : revoked || expired ? "neutral" : "orange"}>
                  {session.current ? "CURRENT" : revoked ? "REVOKED" : expired ? "EXPIRED" : "ACTIVE"}
                </GlowBadge>
              </div>
              <span className="muted">Signed in {new Date(session.createdAt).toLocaleString()}</span>
              <span className="muted">Expires {new Date(session.expiresAt).toLocaleString()}</span>
            </div>
            {canRevoke && (
              <button
                type="button"
                className="text-button session-revoke"
                disabled={busySessionId !== null || changingPassword || revokingOthers}
                onClick={() => void revoke(session.id, session.current)}
              >
                {busySessionId === session.id ? "Revoking…" : session.current ? "Sign out this device" : "Revoke"}
              </button>
            )}
          </div>
        );
      })}
      {error && <p className="message message--error" role="alert">{error}</p>}
      {notice && <p className="message message--success" role="status">{notice}</p>}
      <p className="muted session-note">Revoking a session prevents future token refresh. Access already issued to a device may remain valid for up to 15 minutes.</p>
      <form className="auth-form password-change-form" onSubmit={(event) => void submitPasswordChange(event)}>
        <div className="section-heading">
          <div><p className="eyebrow">PASSWORD SECURITY</p><h3>Change password</h3></div>
        </div>
        <label>Current password
          <input
            required
            autoComplete="current-password"
            minLength={12}
            maxLength={128}
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        <label>New password
          <input
            required
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
        <label>Confirm new password
          <input
            required
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>
        <div className="auth-actions">
          <FlashButton type="submit" disabled={changingPassword || revokingOthers || busySessionId !== null}>
            {changingPassword ? "Updating…" : "Update password"}
          </FlashButton>
        </div>
        <p className="muted session-note">Other refresh sessions are revoked after the change. Access tokens already issued elsewhere may remain valid for up to 15 minutes.</p>
      </form>
    </section>
  );
}

export function AuthPanel() {
  const {
    accessToken,
    user,
    loading,
    error,
    login,
    register,
    logout,
    updateAccessToken,
    clearError,
  } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    clearError();
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), password);
      setPassword("");
    } catch {
      return;
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <GlassCard className="auth-panel">
        <div className="auth-session">
          <div><p className="eyebrow">SIGNED IN</p><strong>{user.email}</strong></div>
          <div className="button-row">
            <GlowBadge tone={user.role === "Guest" ? "neutral" : "green"}>{user.role}</GlowBadge>
            <button type="button" className="text-button" onClick={() => void logout()}>Sign out</button>
          </div>
        </div>
        {accessToken && (
          <SessionManager
            accessToken={accessToken}
            logout={logout}
            updateAccessToken={updateAccessToken}
          />
        )}
      </GlassCard>
    );
  }

  return (
    <GlassCard className="auth-panel">
      <div className="section-heading">
        <div><p className="eyebrow">ACCOUNT ACCESS</p><h2>{mode === "login" ? "Sign in" : "Create account"}</h2></div>
        {loading && <span className="muted">Checking session…</span>}
      </div>
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <label>Email<input required autoComplete="email" maxLength={254} type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input required autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={12} maxLength={128} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {mode === "register" && <p className="muted auth-note">New accounts are assigned Guest access. Administrator roles cannot be selected during registration.</p>}
        <div className="auth-actions">
          <FlashButton type="submit" disabled={busy || loading}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</FlashButton>
          <button type="button" className="text-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); clearError(); }}>
            {mode === "login" ? "Create account" : "Already registered? Sign in"}
          </button>
        </div>
      </form>
      {error && <p role="alert" className="message message--error">{error}</p>}
    </GlassCard>
  );
}
