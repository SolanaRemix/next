import { useMemo, useState } from "react";
import { GlassCard } from "@next/ui";
import { Onboarding } from "./onboarding/Onboarding";
import { backendOnboardingStore, localOnboardingStore } from "./onboarding/onboardingStore";
import { WalletPanel } from "./wallet/WalletPanel";
import { useWallet } from "./wallet/WalletContext";

export function App() {
  const [replayOnboarding, setReplayOnboarding] = useState(false);
  const { connect } = useWallet();
  const apiUrl = import.meta.env.VITE_API_URL;
  const onboardingStore = useMemo(
    () => apiUrl ? backendOnboardingStore(apiUrl) : localOnboardingStore,
    [apiUrl],
  );
  const connectWallet = (chain: "evm" | "solana") => {
    void connect(chain).catch(() => undefined);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Mega Gods Prompt NEXT home"><span className="brand-mark">M</span> MEGA GODS <span>NEXT</span></a>
        <button className="text-button" type="button" onClick={() => setReplayOnboarding(true)}>Replay onboarding</button>
      </header>
      <section className="hero">
        <p className="eyebrow">MULTI-CHAIN · SELF-CUSTODY</p>
        <h1>Your portfolio, <span>in your control.</span></h1>
        <p className="muted">Connect a wallet to inspect native balances and initiate wallet-approved transfers.</p>
      </section>
      <div className="dashboard-grid">
        <WalletPanel />
        <GlassCard className="security-card">
          <p className="eyebrow">SECURITY FIRST</p>
          <h2>Your keys never leave your wallet.</h2>
          <p className="muted">This client does not request, store, or transmit private keys or recovery phrases. All transfers require wallet approval.</p>
        </GlassCard>
      </div>
      <footer>Self-custody wallet access · Always verify transaction details</footer>
      <Onboarding
        store={onboardingStore}
        onConnectWallet={connectWallet}
        onComplete={() => setReplayOnboarding(false)}
      />
      {replayOnboarding && (
        <Onboarding
          store={onboardingStore}
          replay
          onComplete={() => setReplayOnboarding(false)}
          onConnectWallet={connectWallet}
        />
      )}
    </main>
  );
}
