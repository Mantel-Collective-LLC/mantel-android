import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { ArrowLeftIcon, ArrowRightIcon, BugIcon, KeyIcon } from "@phosphor-icons/react";
import type { MantelBridge, Preferences, SessionInfo } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { IS_DEBUG } from "../lib/flavor";
import { Button, CodeInput, InlineError, SPRING, TotpInput, totpComplete } from "../ui/primitives";
import { InviteCodeField } from "../ui/invite-field";
import { RegistrationReveal } from "./register";

export function LoginScreen({
  bridge,
  preferences,
  onLoggedIn,
  onOpenDebug,
}: {
  bridge: MantelBridge;
  preferences: Preferences;
  firewallActive: boolean;
  onPreferences?: (next: Preferences) => void;
  onLoggedIn: (session: SessionInfo) => void;
  onOpenDebug?: () => void;
}) {
  const { t } = useI18n();
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [totp, setTotp] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [referral, setReferral] = useState("");
  const [referralDays, setReferralDays] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const canRegister = Boolean(bridge.register && bridge.confirmRegistration);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (digits.length !== 16) {
      setError(t.login.invalidLength);
      return;
    }
    if (totp !== null && !totpComplete(totp)) return;
    setPending(true);
    setError(null);
    const result = await bridge.login(digits, totp ?? undefined);
    setPending(false);
    if (!result.ok) {
      if (result.code === "totp_required" && totp === null) setTotp("");
      else setError(result.error);
      return;
    }
    setDigits("");
    setTotp(null);
    onLoggedIn(result.value);
  };

  const createAccount = async () => {
    if (!bridge.register) return;
    setRegistering(true);
    setRegisterError(null);
    const result = await bridge.register(referral === "" ? undefined : referral);
    setRegistering(false);
    if (!result.ok) {
      setRegisterError(result.code === "rate_limited" ? t.login.registerRateLimited : result.error);
      return;
    }
    setReferralDays(result.value.referralDays ?? null);
    setNewCode(result.value.code);
  };

  const confirmRegistration = async () => {
    if (!bridge.confirmRegistration) return;
    setConfirming(true);
    setConfirmError(null);
    const result = await bridge.confirmRegistration();
    setConfirming(false);
    if (!result.ok) {
      setConfirmError(result.error);
      return;
    }
    onLoggedIn(result.value);
  };

  if (newCode) {
    return (
      <RegistrationReveal
        bridge={bridge}
        code={newCode}
        referralDays={referralDays}
        pending={confirming}
        error={confirmError}
        onContinue={() => void confirmRegistration()}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="flex min-h-full flex-col px-6 pb-6 pt-8 sm:justify-center sm:py-10"
    >
      <div className="sm:rounded-[28px] sm:border sm:border-zinc-200/70 sm:bg-surface sm:p-8 sm:shadow-raised">
      <h1 className="text-[30px] font-medium leading-[1.05] tracking-[-0.04em] text-balance">{totp === null ? t.login.title : t.login.totpTitle}</h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-zinc-600">{totp === null ? t.login.body : t.login.totpBody}</p>

      <form onSubmit={submit} className="mt-8" noValidate>
        {totp !== null ? (
          <TotpInput
            id="login-totp"
            label={t.login.totpLabel}
            value={totp}
            onChange={(next) => {
              setTotp(next);
              if (error) setError(null);
            }}
            invalid={Boolean(error)}
            disabled={pending}
          />
        ) : (
        <CodeInput
          id="account-code"
          label={t.login.accountNumber}
          value={digits}
          onChange={(next) => {
            setDigits(next);
            if (error) setError(null);
          }}
          invalid={Boolean(error)}
          disabled={pending}
        />
        )}
        <InlineError message={error} className="mt-3" />
        <Button type="submit" size="lg" pending={pending} disabled={totp !== null && !totpComplete(totp)} className="group mt-4 w-full">
          {pending ? (totp === null ? t.login.checking : t.login.totpChecking) : totp === null ? t.login.submit : t.login.totpSubmit}
          {!pending && (
            <ArrowRightIcon
              weight="bold"
              className="size-4 transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5"
            />
          )}
        </Button>
      </form>
      {totp !== null && (
        <button
          type="button"
          onClick={() => {
            setTotp(null);
            setError(null);
          }}
          className="mt-5 inline-flex items-center gap-1.5 text-[13.5px] text-zinc-500 transition-colors hover:text-ink"
        >
          <ArrowLeftIcon className="size-3.5" />
          {t.login.totpBack}
        </button>
      )}

      {canRegister && totp === null && (
        <div className="mt-8 border-t border-zinc-200/70 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13.5px] text-zinc-500">{t.login.noAccount}</p>
            <Button
              variant="secondary"
              size="sm"
              pending={registering}
              icon={<KeyIcon className="size-4" aria-hidden />}
              onClick={() => void createAccount()}
            >
              {registering ? t.login.creatingAccount : t.login.createAccount}
            </Button>
          </div>
          <InviteCodeField
            value={referral}
            disabled={registering}
            onChange={(value) => {
              setReferral(value);
              if (registerError) setRegisterError(null);
            }}
          />
          <InlineError message={registerError} className="mt-3" />
        </div>
      )}

      </div>

      {(IS_DEBUG || onOpenDebug) && (
        <div className="mt-auto pt-10 sm:mt-0">
          {IS_DEBUG && (
            <p className="py-2 text-[13px] text-zinc-500">
              {t.login.server} <span className="font-mono text-[12px] text-zinc-400">{preferences.baseUrl}</span>
            </p>
          )}
          {onOpenDebug && (
            <button
              type="button"
              onClick={onOpenDebug}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg py-1 text-[12.5px] text-amber-700 transition-colors hover:text-amber-900"
            >
              <BugIcon className="size-3.5" />
              {t.login.openDebug}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
