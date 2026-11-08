import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRightIcon, CheckIcon, CopyIcon, WarningIcon } from "@phosphor-icons/react";
import { groupDigits } from "@renderer/lib/format";
import { Button, InlineError } from "@renderer/ui/primitives";
import type { AndroidStrings } from "../i18n/strings";
import { copyText } from "./clipboard";

type CopyState = "idle" | "copied" | "failed";

export function CodeReveal({
  code,
  texts,
  pending,
  error,
  onContinue,
}: {
  code: string;
  texts: AndroidStrings["reveal"];
  pending: boolean;
  error: string | null;
  onContinue: () => void;
}) {
  const checkboxId = useId();
  const [saved, setSaved] = useState(false);
  const [copy, setCopy] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const grouped = groupDigits(code);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = async () => {
    const ok = await copyText(code);
    setCopy(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy("idle"), 2500);
  };

  return (
    <div>
      <div className="rounded-3xl border border-zinc-200/80 bg-surface p-5">
        <p className="text-xs font-medium text-zinc-400">{texts.heading}</p>
        <p
          className="mt-3 whitespace-nowrap font-mono text-[clamp(1.05rem,6.4vw,1.6rem)] font-medium leading-none tracking-[0.02em] tabular-nums text-ink select-all"
          aria-label={`${texts.codeAriaLabel} ${grouped}`}
          data-testid="new-account-code"
        >
          {grouped}
        </p>
        <Button variant="secondary" size="sm" className="mt-5" onClick={() => void onCopy()}>
          {copy === "copied" ? <CheckIcon weight="bold" className="size-4" /> : <CopyIcon className="size-4" />}
          {copy === "copied" ? texts.copied : copy === "failed" ? texts.copyFailed : texts.copy}
        </Button>
      </div>

      <div className="mt-4 flex gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/60 p-4 text-[13.5px] leading-relaxed text-zinc-700">
        <WarningIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <p>{texts.warning}</p>
      </div>

      <label
        htmlFor={checkboxId}
        className="mt-4 flex min-h-11 cursor-pointer select-none items-center gap-3 text-[14px] text-zinc-700"
      >
        <span className="relative grid size-5 shrink-0 place-items-center">
          <input
            id={checkboxId}
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
            className="peer absolute inset-0 cursor-pointer appearance-none rounded-md border border-zinc-300 bg-surface transition-colors checked:border-ink checked:bg-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-900/10"
          />
          <motion.span
            initial={false}
            animate={{ scale: saved ? 1 : 0.4, opacity: saved ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 600, damping: 28 }}
            className="pointer-events-none relative"
          >
            <CheckIcon weight="bold" className="size-3 text-on-ink" />
          </motion.span>
        </span>
        {texts.confirm}
      </label>

      <Button size="lg" className="group mt-3 w-full" disabled={!saved} pending={pending} onClick={onContinue}>
        {texts.continue}
        {!pending && (
          <ArrowRightIcon
            weight="bold"
            className="size-4 transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5"
          />
        )}
      </Button>
      <InlineError message={error} className="mt-3" />
    </div>
  );
}
