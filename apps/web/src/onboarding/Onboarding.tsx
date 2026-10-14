import { useEffect, useRef, useState } from "react";
import type { OnboardingPreferenceStore, OnboardingProgress } from "@next/types";
import { FlashButton, GlassCard } from "@next/ui";

const steps = [
  {
    title: "Welcome to Mega Gods Prompt NEXT",
    detail: "A clear view of your digital assets, with tools designed for informed decisions.",
    bullets: ["Provider-reported token indicators", "Perpetual risk simulations", "Indicative multi-provider swap quotes", "Wallet-approved swaps and cross-chain quote tools"],
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
    bullets: ["Replay onboarding from the page header", "Progress is saved with your onboarding preferences"],
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

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
        if (active && progress) setStep(
          progress.completed || progress.skipped ? 4 : Math.min(Math.max(progress.step, 0), steps.length - 1),
        );
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
    setSaving(true);
    setSaveError(null);
    try {
      await saveProgress(4, !skipped, skipped, inviteCode.trim() || undefined);
      setStep(4);
      onComplete?.();
    } catch {
      setSaveError("Your progress could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function advance() {
    const next = Math.min(step + 1, steps.length - 1);
    setSaving(true);
    setSaveError(null);
    try {
      await saveProgress(next, false, false);
      setStep(next);
    } catch {
      setSaveError("Your progress could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!ready || step === 4) return;
    const dialog = dialogRef.current;
    const firstControl = dialog?.querySelector<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled])",
    );
    firstControl?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled])",
      )];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [ready, step]);

  if (!ready || step === 4) return null;
  const content = steps[step];
  if (!content) return null;

  return (
    <div className="onboarding-backdrop">
      <GlassCard
        ref={dialogRef}
        className="onboarding-card"
        glowColor="orange"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        tabIndex={-1}
      >
        <div
          className="onboarding-progress"
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={step + 1}
        >
          {steps.map((item, index) => <span key={item.title} className={index <= step ? "is-active" : ""} />)}
        </div>
        <section key={step} className="onboarding-step" aria-labelledby="onboarding-title">
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
        </section>
        {saveError && <p className="message message--error" role="alert">{saveError}</p>}
        <div className="onboarding-actions">
          <button type="button" className="text-button" disabled={saving} onClick={() => void finish(true)}>Skip onboarding</button>
          <div className="button-row">
            {step > 0 && <button type="button" className="text-button" disabled={saving} onClick={() => setStep(step - 1)}>Back</button>}
            {step < steps.length - 1
              ? <FlashButton disabled={saving} onClick={() => void advance()}>{saving ? "Saving…" : "Continue"}</FlashButton>
              : <FlashButton disabled={saving} onClick={() => void finish(false)}>{saving ? "Saving…" : "Finish"}</FlashButton>}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
