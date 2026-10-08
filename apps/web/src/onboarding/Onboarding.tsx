import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { OnboardingPreferenceStore, OnboardingProgress } from "@next/types";
import { FlashButton, GlassCard } from "@next/ui";

const steps = [
  {
    title: "Welcome to Mega Gods Prompt NEXT",
    detail: "A clear view of your digital assets, with tools designed for informed decisions.",
    bullets: ["AI-assisted token screening", "Perpetual trading tools", "Multi-aggregator swaps", "Risk-gated flash-loan and arbitrage workflows"],
  },
  {
    title: "Connect your wallets",
    detail: "Connect an EVM or Solana wallet when you're ready. Your keys and recovery phrases stay in your wallet.",
    bullets: ["Use a wallet you control", "Review every signature request", "Disconnect at any time"],
  },
  {
    title: "Understand the risks",
    detail: "Digital assets are volatile. Leveraged positions can be liquidated, and transactions may be irreversible.",
    bullets: ["Never trade more than you can afford to lose", "Confirm network, token, recipient, and fees", "Past performance does not predict future results"],
  },
  {
    title: "Ready when you are",
    detail: "You can add an invite code below or continue without one.",
    bullets: ["Onboarding can be replayed from Settings", "Progress is saved on this device"],
  },
] as const;

export interface OnboardingProps {
  store?: OnboardingPreferenceStore;
  onComplete?: () => void;
  onConnectWallet?: (chain: "evm" | "solana") => void;
  replay?: boolean;
}

export function Onboarding({ store, onComplete, onConnectWallet, replay = false }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [inviteCode, setInviteCode] = useState("");
  const [ready, setReady] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (replay) {
      setStep(0);
      setReady(true);
      void store?.save({ step: 0, completed: false, skipped: false, updatedAt: new Date().toISOString() }).catch(() => undefined);
      return;
    }
    let active = true;
    void (store?.load() ?? Promise.resolve(null))
      .catch(() => null)
      .then((progress) => {
        if (active && progress && (progress.completed || progress.skipped)) setStep(4);
        setReady(active);
      });
    return () => { active = false; };
  }, [store, replay]);

  async function saveProgress(nextStep: number, completed: boolean, skipped: boolean, referralCode?: string) {
    const progress: OnboardingProgress = {
      step: nextStep,
      completed,
      skipped,
      updatedAt: new Date().toISOString(),
      ...(referralCode ? { referralCode } : {}),
    };
    await store?.save(progress);
  }

  async function finish(skipped: boolean) {
    await saveProgress(4, !skipped, skipped, inviteCode.trim() || undefined);
    setStep(4);
    onComplete?.();
  }

  async function advance() {
    const next = Math.min(step + 1, steps.length - 1);
    await saveProgress(next, false, false);
    setStep(next);
  }

  if (!ready || step === 4) return null;
  const content = steps[step];
  if (!content) return null;

  return (
    <div className="onboarding-backdrop">
      <GlassCard className="onboarding-card" glowColor="orange">
        <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((item, index) => <span key={item.title} className={index <= step ? "is-active" : ""} />)}
        </div>
        <AnimatePresence mode="wait">
          <motion.section
            key={step}
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            aria-labelledby="onboarding-title"
          >
            <p className="eyebrow">GETTING STARTED · {step + 1}/{steps.length}</p>
            <h1 id="onboarding-title">{content.title}</h1>
            <p className="muted">{content.detail}</p>
            <ul>{content.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
            {step === 1 && (
              <div className="button-row onboarding-wallets">
                <FlashButton onClick={() => onConnectWallet?.("evm")}>Connect EVM</FlashButton>
                <FlashButton variant="success" onClick={() => onConnectWallet?.("solana")}>Connect Solana</FlashButton>
              </div>
            )}
            {step === 3 && (
              <label className="invite-input">Invite code (optional)
                <input autoComplete="off" maxLength={64} value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} />
              </label>
            )}
          </motion.section>
        </AnimatePresence>
        <div className="onboarding-actions">
          <button type="button" className="text-button" onClick={() => void finish(true)}>Skip onboarding</button>
          <div className="button-row">
            {step > 0 && <button type="button" className="text-button" onClick={() => setStep(step - 1)}>Back</button>}
            {step < steps.length - 1
              ? <FlashButton onClick={() => void advance()}>Continue</FlashButton>
              : <FlashButton onClick={() => void finish(false)}>Finish</FlashButton>}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
