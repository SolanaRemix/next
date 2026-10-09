import { useState, type FormEvent } from "react";
import { FlashButton, GlassCard, GlowBadge } from "@next/ui";
import { useAuth } from "./AuthContext";

export function AuthPanel() {
  const { user, loading, error, login, register, logout, clearError } = useAuth();
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
