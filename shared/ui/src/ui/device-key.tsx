import { useEffect, useRef, useState } from "react";
import { ArrowsClockwiseIcon, CheckIcon } from "@phosphor-icons/react";
import type { DeviceKeyInfo, MantelBridge } from "../../../core/contract";
import { KEY_ROTATION_DAYS } from "../../../core/device-key";
import type { Translator } from "../../../core/i18n";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";
import { Button, InlineError } from "./primitives";

export type DeviceKeyLoad =
  | { kind: "loading" }
  | { kind: "ready"; info: DeviceKeyInfo | null }
  | { kind: "failed"; error: string };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RENEWED_MS = 2400;

export function keyAgeText(ageMs: number, i18n: Pick<Translator, "t" | "format" | "plural">): string {
  const { t } = i18n;
  const age = Math.max(0, ageMs);
  if (age < MINUTE) return t.settings.deviceKeyAgeNow;
  if (age < HOUR) return i18n.format(t.settings.deviceKeyAgeMinutes, { count: Math.floor(age / MINUTE) });
  if (age < DAY) return i18n.format(t.settings.deviceKeyAgeHours, { count: Math.floor(age / HOUR) });
  return i18n.plural(t.settings.deviceKeyAgeDays, Math.floor(age / DAY));
}

export function DeviceKeyRow({ bridge }: { bridge: MantelBridge }) {
  const [load, setLoad] = useState<DeviceKeyLoad>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  const [renewed, setRenewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const read = bridge.deviceKey;
    if (read) {
      void read().then((result) => {
        if (!alive.current) return;
        setLoad(result.ok ? { kind: "ready", info: result.value } : { kind: "failed", error: result.error });
      });
    }
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [bridge]);

  useEffect(() => {
    if (!renewed) return;
    const timer = setTimeout(() => setRenewed(false), RENEWED_MS);
    return () => clearTimeout(timer);
  }, [renewed]);

  const rotate = bridge.rotateDeviceKey;
  if (!bridge.deviceKey || !rotate) return null;

  const renew = async () => {
    setPending(true);
    setError(null);
    const result = await rotate();
    if (!alive.current) return;
    setPending(false);
    setNow(Date.now());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLoad({ kind: "ready", info: result.value });
    setRenewed(result.value !== null);
  };

  return <DeviceKeyView load={load} now={now} pending={pending} renewed={renewed} error={error} onRenew={() => void renew()} />;
}

export function DeviceKeyView({
  load,
  now,
  pending,
  renewed,
  error,
  onRenew,
}: {
  load: DeviceKeyLoad;
  now: number;
  pending: boolean;
  renewed: boolean;
  error: string | null;
  onRenew: () => void;
}) {
  const i18n = useI18n();
  const { t, format } = i18n;
  const info = load.kind === "ready" ? load.info : null;
  const createdAt = info?.createdAt ?? null;
  const fresh = createdAt !== null && now - createdAt < HOUR;
  const status =
    load.kind === "ready" && info === null ? t.settings.deviceKeyNoDevice : createdAt !== null ? keyAgeText(now - createdAt, i18n) : null;

  return (
    <div className="px-5 py-3.5 android:py-4" data-testid="device-key">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[14px] text-ink">{t.settings.deviceKey}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500" aria-live="polite">
            {status && (
              <span className={cn("tabular-nums", fresh && "text-accent-strong")}>{status}</span>
            )}
            {info !== null && (
              <>
                {status && <span className="text-zinc-300"> · </span>}
                {format(t.settings.deviceKeyAuto, { days: KEY_ROTATION_DAYS })}
              </>
            )}
          </p>
        </div>
        <div className="shrink-0">
          <Button
            variant="secondary"
            size="sm"
            pending={pending}
            disabled={load.kind !== "ready" || info === null}
            aria-label={t.settings.deviceKeyRenewLabel}
            onClick={onRenew}
            icon={
              renewed ? (
                <CheckIcon weight="bold" className="size-4 text-accent-strong" aria-hidden />
              ) : (
                <ArrowsClockwiseIcon weight="bold" className="size-4" aria-hidden />
              )
            }
          >
            {pending ? t.settings.deviceKeyRenewing : renewed ? t.settings.deviceKeyRenewed : t.settings.deviceKeyRenew}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-500">{t.settings.deviceKeyDescription}</p>
      <InlineError message={load.kind === "failed" ? load.error : error} className="mt-2" />
    </div>
  );
}
