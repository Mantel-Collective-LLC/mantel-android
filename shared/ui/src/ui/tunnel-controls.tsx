import { useState } from "react";
import { GearSixIcon, PlugsIcon, ShieldWarningIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { Environment, MantelBridge, Preferences, TunnelStatus } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { useSystemVpnState } from "../lib/hooks";
import type { BlockReason } from "../lib/protection";
import { Button, InlineError } from "./primitives";

export function TunnelControls({
  bridge,
  environment,
  status,
  className,
}: {
  bridge: MantelBridge;
  environment: Environment;
  status: TunnelStatus;
  className?: string;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = status.phase !== "disconnected";
  const systemVpn = useSystemVpnState(bridge, environment.features.systemLockdown, status.phase);
  const alwaysOn = environment.features.systemLockdown && systemVpn.state?.alwaysOn === true;
  if (!active && !status.revoked && !alwaysOn) return null;

  const disconnect = async () => {
    setPending(true);
    setError(null);
    const result = await bridge.disconnect();
    setPending(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <div className={className} data-testid="tunnel-controls">
      {active ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-300/40">
          <div className="flex items-start gap-2.5">
            <PlugsIcon weight="fill" aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <div className="min-w-0 text-[13px] leading-relaxed">
              <p className="font-medium">{t.app.tunnelUpTitle}</p>
              <p className="mt-0.5 text-amber-800">{status.phase === "stale" ? t.app.tunnelUpStale : t.app.tunnelUpLoggedOut}</p>
            </div>
          </div>
          <InlineError message={error} className="pt-2" />
          <Button
            variant="stop"
            className="mt-3 w-full"
            pending={pending || status.phase === "disconnecting"}
            onClick={() => void disconnect()}
          >
            {t.home.disconnect}
          </Button>
        </div>
      ) : status.revoked && status.error ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-2xl border border-zinc-200/80 bg-surface px-4 py-3 text-[13px] leading-relaxed text-zinc-700"
        >
          <WarningCircleIcon weight="fill" aria-hidden className="mt-0.5 size-4 shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="font-medium text-ink">{t.app.tunnelEnded}</p>
            <p className="mt-0.5">{status.error}</p>
          </div>
        </div>
      ) : null}
      {alwaysOn && <AlwaysOnHint bridge={bridge} className={active || status.revoked ? "mt-2" : ""} />}
    </div>
  );
}

export function AlwaysOnHint({ bridge, className }: { bridge: MantelBridge; className?: string }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const open = bridge.openSystemVpnSettings;
  return (
    <div
      data-testid="always-on-hint"
      className={`flex items-start gap-2.5 rounded-2xl border border-zinc-200/80 bg-surface px-4 py-3 text-[12.5px] leading-relaxed text-zinc-600 ${className ?? ""}`}
    >
      <GearSixIcon weight="fill" aria-hidden className="mt-0.5 size-4 shrink-0 text-zinc-400" />
      <div className="min-w-0">
        <p>{t.app.alwaysOnHint}</p>
        {open && (
          <button
            type="button"
            className="mt-1.5 font-medium text-accent-strong underline-offset-2 hover:underline"
            onClick={() => {
              setFailed(false);
              void open().catch(() => setFailed(true));
            }}
          >
            {t.settings.openAndroidSettings}
          </button>
        )}
        {failed && <p className="mt-1 text-red-600">{t.settings.openAndroidSettingsFailed}</p>}
      </div>
    </div>
  );
}

export async function liftBlock(
  bridge: Pick<MantelBridge, "disconnect" | "setAlwaysOnKillSwitch" | "openSystemVpnSettings">,
  reason: BlockReason,
  onPreferences?: (next: Preferences) => void,
): Promise<string | null> {
  if (reason === "android") {
    await bridge.openSystemVpnSettings?.();
    return null;
  }
  if (reason === "alwaysOn") {
    const result = await bridge.setAlwaysOnKillSwitch(false);
    if (!result.ok) return result.error;
    onPreferences?.(result.value);
    return null;
  }
  const result = await bridge.disconnect();
  return result.ok ? null : result.error;
}

export function KillSwitchBanner({
  bridge,
  reason,
  onPreferences,
  onReconnect,
  className,
}: {
  bridge: MantelBridge;
  reason: BlockReason;
  onPreferences?: (next: Preferences) => void;
  onReconnect?: () => Promise<void>;
  className?: string;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState<"reconnect" | "lift" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const android = reason === "android";
  const openSettings = bridge.openSystemVpnSettings;

  const run = async (kind: "reconnect" | "lift", task: () => Promise<string | null>) => {
    setPending(kind);
    setError(null);
    const failure = await task().catch((cause: unknown) => (cause instanceof Error ? cause.message : String(cause)));
    setPending(null);
    setError(failure);
  };

  const lift = () => run("lift", () => liftBlock(bridge, reason, onPreferences));

  const text = android
    ? t.home.blockedAndroid
    : reason === "alwaysOn"
      ? t.home.blockedAlwaysOn
      : reason === "leftover"
        ? t.home.blockedLeftover
        : t.home.blockedLost;

  return (
    <section
      role="alert"
      aria-labelledby="kill-switch-blocked-title"
      data-testid="kill-switch-banner"
      className={`rounded-[22px] border border-amber-200 bg-surface px-4 py-3.5 shadow-card dark:border-amber-300/40 ${className ?? ""}`}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">
          <ShieldWarningIcon weight="fill" className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="kill-switch-blocked-title" className="text-[14px] font-medium tracking-[-0.01em] text-ink">
            {t.home.blockedTitle}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{text}</p>
          {!android && <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-500">{t.home.blockedCaptive}</p>}
          <InlineError message={error} className="pt-2" />
          <div className="mt-3 flex flex-wrap gap-2">
            {onReconnect && (
              <Button
                variant="accent"
                size="sm"
                pending={pending === "reconnect"}
                disabled={pending !== null}
                onClick={() =>
                  void run("reconnect", async () => {
                    await onReconnect();
                    return null;
                  })
                }
              >
                {t.home.blockedReconnect}
              </Button>
            )}
            {(!android || openSettings) && (
              <Button variant="ghost" size="sm" pending={pending === "lift"} disabled={pending !== null} onClick={() => void lift()}>
                {android ? t.settings.openAndroidSettings : t.home.blockedLift}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
