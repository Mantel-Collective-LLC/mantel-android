import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { ArrowSquareOutIcon, HourglassMediumIcon } from "@phosphor-icons/react";
import type { Account, MantelBridge } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";
import { useNow, useRenew } from "../lib/hooks";
import { paidTexts, paidTime, type PaidState, type PaidTime } from "../lib/paid-time";
import { Button, InlineError } from "./primitives";

const RING_STROKE: Record<PaidState, string> = {
  active: "stroke-accent",
  expiring: "stroke-amber-500",
  grace: "stroke-red-500",
  expired: "stroke-red-500",
  new: "stroke-zinc-300",
};

const PILL: Record<PaidState, string> = {
  active: "bg-accent-soft text-accent-strong",
  expiring: "bg-amber-50 text-amber-700",
  grace: "bg-red-50 text-red-600",
  expired: "bg-red-50 text-red-600",
  new: "bg-zinc-100 text-zinc-600",
};

export function usePaidTime(account: Pick<Account, "paidUntil" | "graceUntil" | "noTimeYet"> | null): PaidTime | null {
  const now = useNow(60_000, account !== null);
  return account ? paidTime(account.paidUntil, account.graceUntil, now, account.noTimeYet === true) : null;
}

function renewLabel(paid: PaidTime, t: ReturnType<typeof useI18n>["t"]): string {
  return paid.state === "new" ? t.paid.start : t.paid.renew;
}

function urgent(state: PaidState): boolean {
  return state !== "active";
}

export function PaidStatePill({ paid }: { paid: PaidTime }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium", PILL[paid.state])}>
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          paid.state === "active" && "bg-accent",
          paid.state === "expiring" && "bg-amber-500",
          (paid.state === "grace" || paid.state === "expired") && "bg-red-500",
          paid.state === "new" && "bg-zinc-400",
        )}
      />
      {t.paid.states[paid.state]}
    </span>
  );
}

export function PaidRing({
  paid,
  size,
  stroke,
  children,
}: {
  paid: PaidTime;
  size: number;
  stroke: number;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const radius = 50 - (stroke / size) * 50;
  const width = (stroke / size) * 100;
  const shown = paid.progress > 0 ? Math.max(paid.progress, 0.04) : 0;
  const offset = 100 - shown * 100;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth={width} className="stroke-zinc-200/70" />
        {paid.progress > 0 && (
          <motion.circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth={width}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100 100"
            className={RING_STROKE[paid.state]}
            initial={reduce ? false : { strokeDashoffset: 100 }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </svg>
      <span className="relative grid place-items-center text-center">{children}</span>
    </span>
  );
}

function RingCenter({ paid, large }: { paid: PaidTime; large: boolean }) {
  const i18n = useI18n();
  const texts = paidTexts(paid, i18n);
  if (!texts.ring) {
    return <HourglassMediumIcon weight="fill" className={cn(paid.state === "new" ? "text-zinc-400" : "text-red-500", large ? "size-7" : "size-4")} />;
  }
  return (
    <>
      <span
        className={cn(
          "font-medium leading-none tracking-[-0.03em] tabular-nums text-ink",
          large ? "text-[26px]" : "text-[13px]",
        )}
      >
        {texts.ring.value}
      </span>
      {large && <span className="mt-1 text-[10.5px] font-medium leading-none text-zinc-500">{texts.ring.unit}</span>}
    </>
  );
}

export function PaidTimeCard({
  bridge,
  account,
  onOpen,
}: {
  bridge: MantelBridge;
  account: Account | null;
  onOpen?: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const paid = usePaidTime(account);
  const renew = useRenew(bridge);
  if (!account || !paid) return null;
  const texts = paidTexts(paid, i18n);
  const label = i18n.format(t.paid.ringLabel, { remaining: texts.title, until: texts.subtitle });
  const summary = (
    <>
      <PaidRing paid={paid} size={44} stroke={5}>
        <RingCenter paid={paid} large={false} />
      </PaidRing>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[14.5px] font-medium tracking-[-0.01em]",
            paid.state === "grace" || paid.state === "expired" ? "text-red-600" : "text-ink",
          )}
        >
          {texts.title}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-zinc-500">{texts.subtitle}</span>
      </span>
    </>
  );
  return (
    <section
      aria-label={label}
      className="rounded-[28px] border border-zinc-200/70 bg-surface p-2 shadow-card"
    >
      <div className="flex items-center gap-2">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-[20px] px-2 py-1 text-left outline-none transition-colors hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-accent active:bg-zinc-50"
          >
            {summary}
          </button>
        ) : (
          <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 px-2 py-1">{summary}</div>
        )}
        {urgent(paid.state) ? (
          <span className="mr-2 shrink-0">
            <PaidStatePill paid={paid} />
          </span>
        ) : (
          renew.available && (
            <Button size="sm" variant="secondary" pending={renew.pending} onClick={() => void renew.renew()} className="mr-1 shrink-0">
              {renewLabel(paid, t)}
            </Button>
          )
        )}
      </div>
      {urgent(paid.state) && (
        <div className="space-y-2.5 px-1 pb-1 pt-1.5">
          {texts.note && <p className="px-2 text-[12.5px] leading-relaxed text-zinc-500">{texts.note}</p>}
          {renew.available && (
            <Button pending={renew.pending} onClick={() => void renew.renew()} className="w-full">
              {renewLabel(paid, t)}
              <ArrowSquareOutIcon weight="bold" className="size-4" />
            </Button>
          )}
        </div>
      )}
      <InlineError message={renew.error} className="px-3 pb-1.5 pt-1" />
    </section>
  );
}

export function AccountHero({ bridge, account }: { bridge: MantelBridge; account: Account }) {
  const i18n = useI18n();
  const { t } = i18n;
  const paid = usePaidTime(account);
  const renew = useRenew(bridge);
  if (!paid) return null;
  const texts = paidTexts(paid, i18n);
  const expired = paid.state === "grace" || paid.state === "expired";
  return (
    <section
      aria-label={t.settings.accountTitle}
      className="rounded-[28px] border border-zinc-200/80 bg-surface p-2 shadow-raised"
    >
      <div className="rounded-[22px] border border-zinc-100 bg-zinc-50/70 p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-xs font-medium text-zinc-400">
            {t.settings.accountTitle} · <span className="font-mono">{account.id}</span>
          </span>
          <PaidStatePill paid={paid} />
        </div>
        <div className="mt-5 flex items-center gap-5">
          <PaidRing paid={paid} size={88} stroke={7}>
            <RingCenter paid={paid} large />
          </PaidRing>
          <div className="min-w-0">
            <p className="text-[12px] text-zinc-500">{t.paid.eyebrow}</p>
            <p className={cn("mt-0.5 text-[21px] font-medium leading-tight tracking-[-0.02em]", expired ? "text-red-600" : "text-ink")}>
              {texts.title}
            </p>
            <p className="mt-1 text-[12.5px] text-zinc-500">{texts.subtitle}</p>
          </div>
        </div>
      </div>
      {texts.note && (
        <p
          className={cn(
            "px-3 pt-3 text-[12.5px] leading-relaxed",
            paid.state === "expiring" ? "text-amber-700" : expired ? "text-red-600" : "text-zinc-500",
          )}
        >
          {texts.note}
        </p>
      )}
      {renew.available && (
        <div className="px-1 pb-1 pt-3">
          <Button
            variant={urgent(paid.state) ? "primary" : "secondary"}
            pending={renew.pending}
            onClick={() => void renew.renew()}
            className="w-full android:h-12"
          >
            {renewLabel(paid, t)}
            <ArrowSquareOutIcon weight="bold" className="size-4" />
          </Button>
          <p className="px-2 pt-2 text-center text-[11.5px] leading-relaxed text-zinc-400">{t.paid.renewHint}</p>
          <InlineError message={renew.error} className="px-2 pt-1 text-center" />
        </div>
      )}
    </section>
  );
}
