import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeftIcon, ArrowRightIcon, ShieldWarningIcon, UserPlusIcon } from "@phosphor-icons/react";
import type { MantelBridge, Preferences, SessionInfo } from "@shared/contract";
import { useI18n } from "@renderer/i18n/context";
import { Button, CodeInput, InlineError, SPRING, TotpInput, totpComplete } from "@renderer/ui/primitives";
import { androidExtras, type CreatedAccount } from "../bridge/extras";
import { DebugLoginFooter } from "../debug/login-footer";
import { androidStrings } from "../i18n/strings";
import { CodeReveal } from "./code-reveal";

export function LoginScreen({
  bridge,
  preferences,
  firewallActive,
  onPreferences,
  onLoggedIn,
}: {
  bridge: MantelBridge;
  preferences: Preferences;
  firewallActive: boolean;
  onPreferences: (next: Preferences) => void;
  onLoggedIn: (session: SessionInfo) => void;
}) {
  const { t, language } = useI18n();
  const texts = androidStrings(language);
  const extras = androidExtras(bridge);
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [totp, setTotp] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (!extras) return;
    let disposed = false;
    void extras
      .pendingRegistration()
      .then((account) => {
        if (!disposed && account) setCreated(account);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

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

  const register = async () => {
    if (!extras || registering) return;
    setRegistering(true);
    setRegisterError(null);
    try {
      const result = await extras.register();
      if (!result.ok) {
        setRegisterError(result.error);
        return;
      }
      setCreated(result.value);
    } catch {
      setRegisterError(texts.register.failed);
    } finally {
      setRegistering(false);
    }
  };

  const confirm = async () => {
    if (!extras) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const result = await extras.confirmRegistration();
      if (!result.ok) {
        setConfirmError(result.error);
        return;
      }
      setCreated(null);
      onLoggedIn(result.value);
    } catch {
      setConfirmError(texts.register.failed);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {created ? (
        <motion.div
          key="reveal"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={SPRING}
          className="flex min-h-full flex-col px-6 pb-6 pt-8 sm:mx-auto sm:w-full sm:max-w-[608px]"
        >
          <p className="text-xs font-medium text-accent-strong">{texts.reveal.eyebrow}</p>
          <h1 className="mt-3 text-[30px] font-medium leading-[1.05] tracking-[-0.04em] text-balance">{texts.reveal.title}</h1>
          <p className="mb-7 mt-3 text-[14.5px] leading-relaxed text-zinc-600">{texts.reveal.body}</p>
          <CodeReveal
            code={created.code}
            texts={texts.reveal}
            pending={confirming}
            error={confirmError}
            onContinue={() => void confirm()}
          />
        </motion.div>
      ) : (
        <motion.div
          key="login"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={SPRING}
          className="flex min-h-full flex-col px-6 pb-6 pt-8 sm:justify-center sm:py-10"
        >
          <div className="sm:mx-auto sm:w-full sm:max-w-[560px] sm:rounded-[28px] sm:border sm:border-zinc-200/70 sm:bg-surface sm:p-8 sm:shadow-raised">
          {firewallActive && (
            <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-zinc-200/80 bg-surface px-4 py-3 text-[13px] leading-relaxed text-zinc-600">
              <ShieldWarningIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-amber-600" />
              {t.login.firewallActive}
            </div>
          )}
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

          {extras && totp === null && (
            <div className="mt-8 border-t border-zinc-200/70 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[14px] text-zinc-500">{texts.register.noAccount}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  pending={registering}
                  icon={<UserPlusIcon className="size-4" aria-hidden />}
                  onClick={() => void register()}
                >
                  {registering ? texts.register.submitting : texts.register.submit}
                </Button>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-400">{texts.register.hint}</p>
              <InlineError message={registerError} className="mt-3" />
            </div>
          )}
          </div>

          {__MANTEL_FLAVOR__ === "debug" && (
            <div className="mt-auto pt-10 sm:mx-auto sm:mt-0 sm:w-full sm:max-w-[560px]">
              <DebugLoginFooter preferences={preferences} />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
