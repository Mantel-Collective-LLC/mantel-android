import { motion } from "motion/react";
import { useId, useState } from "react";
import { ArrowCircleUpIcon, ArrowClockwiseIcon, ArrowSquareOutIcon, PlugsIcon } from "@phosphor-icons/react";
import type { MantelBridge, TunnelStatus } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { useUpdate, type UpdateCheck } from "../lib/update-check";
import { Button, InlineError, SPRING } from "./primitives";

function useDownload(update: UpdateCheck) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setPending(true);
    setError(null);
    const result = await update.openDownload();
    setPending(false);
    if (!result.ok) setError(result.error || t.errors.openWebsiteFailed);
  };
  return { pending, error, open };
}

function useNotes(update: UpdateCheck): string | null {
  const { language } = useI18n();
  const notes = update.info?.notes;
  return notes ? notes[language] : null;
}

export function UpdateBanner() {
  const update = useUpdate();
  const { t, format } = useI18n();
  const download = useDownload(update);
  const notes = useNotes(update);
  const titleId = useId();
  if (update.state.kind !== "available" || update.snoozed) return null;
  const version = update.state.latest;
  return (
    <motion.section
      aria-labelledby={titleId}
      data-testid="update-banner"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="rounded-2xl border border-zinc-200/80 bg-surface px-4 py-3"
    >
      <div className="flex items-start gap-2.5">
        <ArrowCircleUpIcon weight="fill" aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-strong" />
        <div className="min-w-0 flex-1">
          <p className="sr-only">{t.update.bannerLabel}</p>
          <h2 id={titleId} className="text-[13.5px] font-medium leading-snug text-ink">
            {format(t.update.available, { version })}
          </h2>
          {notes && <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{notes}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button size="sm" pending={download.pending} onClick={() => void download.open()}>
              {t.update.download}
              {!download.pending && <ArrowSquareOutIcon weight="bold" aria-hidden className="size-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={format(t.update.laterLabel, { version })}
              onClick={update.snooze}
            >
              {t.update.later}
            </Button>
          </div>
          <InlineError message={download.error} className="mt-2" />
        </div>
      </div>
    </motion.section>
  );
}

export function UpdateRequiredScreen({
  bridge,
  status,
  currentVersion,
}: {
  bridge: MantelBridge;
  status: TunnelStatus;
  currentVersion: string;
}) {
  const update = useUpdate();
  const { t, format } = useI18n();
  const download = useDownload(update);
  const notes = useNotes(update);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  if (update.state.kind !== "required") return null;
  const { latest, minimum } = update.state;
  const active = status.phase !== "disconnected";
  const facts = [
    { label: t.update.installed, value: currentVersion },
    { label: t.update.minimum, value: minimum },
    { label: t.update.latest, value: latest },
  ];

  const disconnect = async () => {
    setDisconnecting(true);
    setDisconnectError(null);
    const result = await bridge.disconnect();
    setDisconnecting(false);
    if (!result.ok) setDisconnectError(result.error);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      data-testid="update-required"
      className="flex min-h-full flex-col px-6 pb-6 pt-8"
    >
      <p className="text-xs font-medium text-zinc-400">{t.update.requiredEyebrow}</p>
      <h1 className="mt-3 text-[30px] font-medium leading-[1.05] tracking-[-0.04em] text-balance">
        {t.update.requiredTitle}
      </h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-zinc-600">{t.update.requiredBody}</p>

      <dl className="mt-6 divide-y divide-zinc-200/70 rounded-2xl border border-zinc-200/80 bg-surface text-[13px]">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="shrink-0 text-zinc-500">{fact.label}</dt>
            <dd className="min-w-0 truncate text-right font-mono font-medium text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {notes && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-zinc-500">
          <span className="font-medium text-zinc-600">{format(t.update.notes, { version: latest })}:</span> {notes}
        </p>
      )}

      {active && (
        <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
          <PlugsIcon weight="fill" aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>{t.update.connectedNotice}</p>
        </div>
      )}

      <div className="mt-auto space-y-2 pt-8">
        <InlineError message={download.error ?? disconnectError} className="pb-1" />
        <Button size="lg" className="w-full" pending={download.pending} onClick={() => void download.open()}>
          {t.update.download}
          {!download.pending && <ArrowSquareOutIcon weight="bold" aria-hidden className="size-4" />}
        </Button>
        {active && (
          <Button
            size="lg"
            variant="danger"
            className="w-full"
            pending={disconnecting || status.phase === "disconnecting"}
            onClick={() => void disconnect()}
          >
            {t.update.disconnect}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="w-full"
          pending={checking}
          onClick={async () => {
            setChecking(true);
            await update.check();
            setChecking(false);
          }}
        >
          {!checking && <ArrowClockwiseIcon weight="bold" aria-hidden className="size-3.5" />}
          {t.update.retry}
        </Button>
      </div>
    </motion.div>
  );
}

export function VersionLine({ version }: { version: string }) {
  const update = useUpdate();
  const { t, format } = useI18n();
  const outcome =
    update.manual === "current"
      ? t.update.upToDate
      : update.manual === "available" && update.state.kind !== "current"
        ? format(t.update.newer, { version: update.state.latest })
        : update.manual === "failed"
          ? t.update.failed
          : null;
  return (
    <>
      <span>{format(t.update.version, { version })}</span>
      {update.supported && (
        <>
          {" · "}
          <button
            type="button"
            data-testid="check-updates"
            disabled={update.manual === "checking"}
            onClick={() => void update.check({ manual: true })}
            className="rounded underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-ink hover:decoration-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:no-underline"
          >
            {update.manual === "checking" ? t.update.checking : t.update.checkNow}
          </button>
          <span aria-live="polite" className="block">
            {outcome}
          </span>
        </>
      )}
    </>
  );
}
