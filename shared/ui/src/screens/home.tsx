import type { ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClockIcon,
  HandshakeIcon,
  PowerIcon,
  ShieldCheckIcon,
  ShieldSlashIcon,
  ShieldWarningIcon,
  WarningIcon,
  WifiHighIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { Environment, TunnelPhase, TunnelStatus, VpnNode } from "../../../core/contract";
import { cn } from "../lib/cn";
import { formatAgo, formatBytes, formatClock } from "../lib/format";
import { countryName } from "../lib/locations";
import { useI18n } from "../i18n/context";
import { useNow } from "../lib/hooks";
import { Button, InlineError } from "../ui/primitives";
import { ObfuscatedBadge } from "../ui/obfuscation";
import { QuantumBadge } from "../ui/quantum-badge";
import { TorBadge } from "../ui/tor";

function StatusPill({ phase }: { phase: TunnelPhase }) {
  const { t } = useI18n();
  const on = phase === "connected";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium",
        on && "bg-accent-soft text-accent-strong",
        phase === "stale" && "bg-red-50 text-red-600",
        !on && phase !== "stale" && "bg-zinc-100 text-zinc-500",
      )}
    >
      <span className="relative flex size-1.5">
        {on && <span className="absolute inset-0 animate-ping-slow rounded-full bg-accent" />}
        <span
          className={cn(
            "relative size-1.5 rounded-full",
            phase === "disconnected" && "bg-rose-500",
            (phase === "connecting" || phase === "disconnecting") && "bg-amber-500",
            phase === "stale" && "bg-red-500",
            on && "bg-accent",
          )}
        />
      </span>
      <span key={phase} className="motion-safe:animate-view-in">
        {t.home.status[phase]}
      </span>
    </span>
  );
}

function Stat({ label, value, icon: StatIcon }: { label: string; value: string; icon: Icon }) {
  return (
    <div className="min-w-0 rounded-2xl border border-zinc-200/60 bg-zinc-50/70 px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <StatIcon weight="bold" className="size-3 shrink-0 text-zinc-400" aria-hidden />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1 truncate font-mono text-[14px] font-medium tabular-nums tracking-[-0.01em] text-ink">{value}</dd>
    </div>
  );
}

export type ProtectionContext = { android: boolean; systemLockdown: boolean | null };

function ProtectionNote({ status, context, blocked }: { status: TunnelStatus; context: ProtectionContext; blocked: boolean }) {
  const { t } = useI18n();
  const active = status.phase !== "disconnected";
  if (blocked && !active) return null;
  if (context.android) return <AndroidProtectionNote status={status} lockdown={context.systemLockdown} />;
  if (!active && status.firewallActive) {
    return (
      <Note icon={<ShieldWarningIcon weight="fill" className="size-4 text-amber-600" />}>{t.home.noteFirewallLockdown}</Note>
    );
  }
  if (!active) {
    return <Note icon={<ShieldSlashIcon weight="fill" className="size-4 text-zinc-400" />}>{t.home.noteDirect}</Note>;
  }
  if (status.leakProtection === "wireguard") {
    return (
      <Note icon={<ShieldCheckIcon weight="fill" className="size-4 text-accent-strong" />}>{t.home.noteKillSwitchWireGuard}</Note>
    );
  }
  if (status.leakProtection === "firewall") {
    return (
      <Note icon={<ShieldCheckIcon weight="fill" className="size-4 text-accent-strong" />}>{t.home.noteKillSwitchFirewall}</Note>
    );
  }
  return <Note icon={<ShieldWarningIcon weight="fill" className="size-4 text-amber-600" />}>{t.home.noteNoKillSwitch}</Note>;
}

function AndroidProtectionNote({ status, lockdown }: { status: TunnelStatus; lockdown: boolean | null }) {
  const { t } = useI18n();
  const active = status.phase !== "disconnected";
  if (!active && lockdown) {
    return <Note icon={<ShieldWarningIcon weight="fill" className="size-4 text-amber-600" />}>{t.home.noteAndroidLockdown}</Note>;
  }
  if (!active) {
    return <Note icon={<ShieldSlashIcon weight="fill" className="size-4 text-zinc-400" />}>{t.home.noteDirect}</Note>;
  }
  if (status.leakProtection === "none") {
    return <Note icon={<ShieldWarningIcon weight="fill" className="size-4 text-amber-600" />}>{t.home.noteNoKillSwitch}</Note>;
  }
  return (
    <Note icon={<ShieldCheckIcon weight="fill" className="size-4 text-accent-strong" />}>
      {status.leakProtection === "firewall" ? t.home.noteAndroidKillSwitchLan : t.home.noteAndroidKillSwitch}
      {lockdown === false && ` ${t.home.noteAndroidLockdownHint}`}
    </Note>
  );
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 px-1 pb-1 pt-3 text-[12.5px] leading-relaxed text-zinc-500">
      <span className="mt-px shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

function LiveStats({ status, hidden }: { status: TunnelStatus; hidden: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const live = status.phase === "connected" || status.phase === "stale";
  const now = useNow(1000, live);
  const runtime = live && status.connectedAt ? formatClock(now - status.connectedAt) : "—";
  const handshake =
    live && status.lastHandshakeAt ? formatAgo(now - status.lastHandshakeAt, i18n) : live ? t.home.noHandshakeYet : "—";
  return (
    <dl hidden={hidden} className="mt-3 grid grid-cols-2 gap-2 @md:grid-cols-4">
      <Stat icon={ClockIcon} label={t.home.runtime} value={runtime} />
      <Stat icon={HandshakeIcon} label={t.home.lastHandshake} value={handshake} />
      <Stat icon={ArrowDownIcon} label={t.home.received} value={live ? formatBytes(status.rxBytes, i18n) : "—"} />
      <Stat icon={ArrowUpIcon} label={t.home.sent} value={live ? formatBytes(status.txBytes, i18n) : "—"} />
    </dl>
  );
}

export function ConnectCard({
  status,
  node,
  busy,
  canConnect,
  error,
  notice = null,
  protection,
  location,
  tor = false,
  blocked = false,
  onToggle,
}: {
  status: TunnelStatus;
  protection: ProtectionContext;
  node: VpnNode | null;
  busy: boolean;
  canConnect: boolean;
  error: string | null;
  notice?: string | null;
  location?: ReactNode;
  tor?: boolean;
  blocked?: boolean;
  onToggle: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const pending = status.phase === "connecting" || status.phase === "disconnecting" || busy;
  const disconnected = status.phase === "disconnected";
  const disabled = !canConnect && disconnected;
  const actionLabel = disconnected ? t.home.connect : t.home.disconnect;
  const buttonVariant = disconnected || status.phase === "connecting" ? "accent" : "stop";
  const pendingLabel =
    status.phase === "connecting" || status.phase === "disconnecting"
      ? t.home.status[status.phase]
      : disconnected
        ? t.home.status.connecting
        : t.home.status.disconnecting;

  return (
    <section className="@container rounded-[28px] border border-zinc-200/70 bg-surface p-3 shadow-raised sm:p-4">
      <div className="flex items-center justify-between gap-3 px-1 pt-0.5">
        <StatusPill phase={status.phase} />
        <span className="truncate font-mono text-[11px] text-zinc-400">
          WireGuard
        </span>
      </div>

      {location ? (
        <div className="mt-3">{location}</div>
      ) : (
        <div className="mt-3 px-1">
          <p className="text-[12px] text-zinc-500">{t.home.location}</p>
          <p className="mt-0.5 truncate text-[20px] font-medium tracking-tight text-ink">{node?.city ?? t.home.noLocation}</p>
          <p className="mt-0.5 truncate text-[12px] text-zinc-500">
            {node ? (
              <>
                {countryName(node.country.toUpperCase(), i18n.locale)}
              </>
            ) : (
              t.home.pickLocation
            )}
          </p>
        </div>
      )}

      <Button
        variant={buttonVariant}
        size="xl"
        onClick={onToggle}
        disabled={disabled}
        pending={pending}
        aria-pressed={!disconnected}
        aria-label={actionLabel}
        icon={<PowerIcon weight="bold" className="size-5 shrink-0" aria-hidden />}
        className="mt-3 w-full"
      >
        {pending ? pendingLabel : actionLabel}
      </Button>
      {status.phase === "connecting" && (
        <Button variant="ghost" size="sm" onClick={onToggle} className="mt-2 w-full">
          {t.home.cancelConnect}
        </Button>
      )}

      <LiveStats status={status} hidden={disconnected} />
      <QuantumBadge quantum={status.quantum} className="mt-3 px-1" />
      <ObfuscatedBadge obfuscated={status.obfuscated} className="mt-2 px-1" />
      <TorBadge active={tor && !disconnected} className="mt-3 px-1" />
      <ProtectionNote status={status} context={protection} blocked={blocked} />
      {status.phase === "stale" && !blocked && (
        <p className="flex items-start gap-2 px-1 pt-2 text-[12.5px] leading-relaxed text-red-600">
          <WarningIcon weight="bold" className="mt-0.5 size-4 shrink-0" />
          {t.home.staleWarning}
        </p>
      )}
      <InlineError message={error ?? status.error} className="px-1 pb-1 pt-2" />
      {!(error ?? status.error) && notice && (
        <p role="status" className="px-1 pb-1 pt-2 text-[13px] leading-snug text-zinc-500">
          {notice}
        </p>
      )}
    </section>
  );
}

export function EnvironmentBanner({ environment }: { environment: Environment }) {
  const { t } = useI18n();
  const android = environment.platform === "android";
  const mac = environment.platform === "darwin";
  const needsElevation = environment.features.managedWireGuard && !environment.elevated;
  if (!needsElevation && environment.encryptionAvailable) return null;
  return (
    <div className="space-y-2">
      {needsElevation && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-zinc-200/80 bg-surface px-4 py-3 text-[12.5px] leading-relaxed text-zinc-600">
          <ShieldWarningIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-amber-600" />
          {mac ? t.mac.noHelper : t.home.noAdmin}
        </div>
      )}
      {!environment.encryptionAvailable && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-zinc-200/80 bg-surface px-4 py-3 text-[12.5px] leading-relaxed text-zinc-600">
          <ShieldWarningIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-amber-600" />
          {android ? t.home.noKeystoreAndroid : mac ? t.mac.noKeychain : t.home.noKeystoreWindows}
        </div>
      )}
    </div>
  );
}

export function OpenWifiNotice({
  canConnect,
  busy,
  autoConnect,
  onConnect,
  onAlwaysConnect,
}: {
  canConnect: boolean;
  busy: boolean;
  autoConnect: boolean | null;
  onConnect: () => void;
  onAlwaysConnect: () => void;
}) {
  const { t } = useI18n();
  return (
    <section
      aria-labelledby="open-wifi-title"
      className="rounded-[22px] border border-zinc-200/70 bg-surface px-4 py-3.5 shadow-card motion-safe:animate-view-in"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">
          <WifiHighIcon weight="bold" className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="open-wifi-title" className="text-[14px] font-medium tracking-[-0.01em] text-ink">
            {t.home.openWifiTitle}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{t.home.openWifiText}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="accent" size="sm" pending={busy} disabled={!canConnect} onClick={onConnect}>
              {t.home.openWifiConnect}
            </Button>
            {autoConnect === false && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={onAlwaysConnect}>
                {t.home.openWifiAlways}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
