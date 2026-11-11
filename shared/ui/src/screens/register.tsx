import { motion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { ArrowRightIcon, CheckIcon, CopyIcon, WarningIcon } from "@phosphor-icons/react";
import type { MantelBridge } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { copyText } from "../lib/clipboard";
import { cn } from "../lib/cn";
import { groupDigits } from "../lib/format";
import { Button, InlineError, SPRING } from "../ui/primitives";

type CopyState = "idle" | "copied" | "failed";

export function RegistrationReveal({
  bridge,
  code,
  referralDays = null,
  pending,
  error,
  onContinue,
}: {
  bridge: MantelBridge;
  code: string;
  referralDays?: number | null;
  pending: boolean;
  error: string | null;
  onContinue: () => void;
}) {
  const { t, format } = useI18n();
  const checkboxId = useId();
  const [saved, setSaved] = useState(false);
  const [copy, setCopy] = useState<CopyState>("idle");
  const grouped = groupDigits(code);

  useEffect(() => {
    if (copy === "idle") return;
    const timer = window.setTimeout(() => setCopy("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [copy]);

  const onCopy = async () => {
    setCopy((await copyText(bridge, grouped)) ? "copied" : "failed");
  };

  return (
    <motion.div
      key="reveal"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="flex min-h-full flex-col px-6 pb-6 pt-8"
    >
      <p className="text-xs font-medium text-accent-strong">{t.register.eyebrow}</p>
      <h1 className="mt-3 text-[30px] font-medium leading-[1.05] tracking-[-0.04em] text-balance">{t.register.title}</h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-zinc-600">{t.register.body}</p>
      {referralDays !== null && (
        <p className="mt-3 text-[14px] font-medium text-accent-strong">{format(t.register.inviteAdded, { days: referralDays })}</p>
      )}

      <div className="mt-7 rounded-3xl border border-zinc-200/80 bg-surface p-5 shadow-card">
        <p className="text-xs font-medium text-zinc-400">{t.register.heading}</p>
        <p
          data-testid="new-account-code"
          className="mt-3 select-all whitespace-nowrap font-mono text-[25px] font-medium leading-none tracking-[0.02em] tabular-nums text-ink android:text-[22px]"
          aria-label={format(t.register.codeLabel, { code: grouped })}
        >
          {grouped}
        </p>
        <Button variant="secondary" size="sm" className="mt-5" onClick={() => void onCopy()}>
          {copy === "copied" ? (
            <CheckIcon weight="bold" className="size-4 text-accent-strong" />
          ) : (
            <CopyIcon className="size-4" />
          )}
          {copy === "copied" ? t.register.copied : copy === "failed" ? t.register.copyFailed : t.register.copy}
        </Button>
      </div>

      <div className="mt-4 flex gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/60 p-4 text-[13px] leading-relaxed text-zinc-700">
        <WarningIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <p>{t.register.warning}</p>
      </div>

      <label
        htmlFor={checkboxId}
        className="mt-5 flex cursor-pointer select-none items-center gap-3 text-[14px] text-zinc-700 android:min-h-11"
      >
        <input
          id={checkboxId}
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="size-5 shrink-0 cursor-pointer rounded-md accent-ink"
        />
        {t.register.confirm}
      </label>

      <InlineError message={error} className="mt-3" />
      <Button
        size="lg"
        pending={pending}
        disabled={!saved}
        onClick={onContinue}
        className={cn("group mt-5 w-full", !saved && "opacity-90")}
      >
        {pending ? t.register.continuing : t.register.continue}
        {!pending && (
          <ArrowRightIcon
            weight="bold"
            className="size-4 transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5"
          />
        )}
      </Button>
    </motion.div>
  );
}
