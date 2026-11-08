import { useEffect, useRef, useState } from "react";
import type { Account, MantelBridge, TorState, TunnelStatus } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";
import { InlineError, Switch } from "./primitives";

export type TorLoad = { kind: "loading" } | { kind: "ready"; state: TorState | null } | { kind: "failed"; error: string };

export function TorRow({ bridge, onChange }: { bridge: MantelBridge; onChange?: (state: TorState) => void }) {
  const [load, setLoad] = useState<TorLoad>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const read = bridge.tor;
    if (read) {
      void read().then((result) => {
        if (!alive.current) return;
        setLoad(result.ok ? { kind: "ready", state: result.value } : { kind: "failed", error: result.error });
      });
    }
    return () => {
      alive.current = false;
    };
  }, [bridge]);

  const write = bridge.setTor;
  if (!bridge.tor || !write) return null;

  const toggle = async (next: boolean) => {
    setPending(true);
    setError(null);
    const result = await write(next);
    if (!alive.current) return;
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLoad({ kind: "ready", state: result.value });
    if (result.value) onChange?.(result.value);
  };

  return <TorView load={load} pending={pending} error={error} onToggle={(next) => void toggle(next)} />;
}

export function TorView({
  load,
  pending,
  error,
  onToggle,
}: {
  load: TorLoad;
  pending: boolean;
  error: string | null;
  onToggle: (next: boolean) => void;
}) {
  const { t, format } = useI18n();
  const state = load.kind === "ready" ? load.state : null;
  const on = state?.enabled === true;
  const city = state?.city ?? "";
  const offered = state !== null && state.availability !== "unavailable";
  const hint =
    state === null
      ? load.kind === "ready"
        ? t.settings.torNoDevice
        : null
      : state.availability === "starting"
        ? format(t.settings.torStarting, { city })
        : state.availability === "unavailable"
          ? format(t.settings.torUnavailable, { city })
          : null;

  return (
    <div className="px-5 py-3.5 android:py-4" data-testid="tor">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[14px] text-ink">{t.settings.tor}</p>
          {state && <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{format(t.settings.torDescription, { city })}</p>}
        </div>
        <div className="shrink-0">
          <Switch label={t.settings.tor} checked={on} disabled={pending || state === null || (!on && !offered)} onChange={onToggle} />
        </div>
      </div>
      {hint && <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-600">{hint}</p>}
      <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-zinc-500">
        <li>{t.settings.torLimits}</li>
        <li>{t.settings.torOnion}</li>
        <li>{t.settings.torFingerprint}</li>
        <li>{t.settings.torPortForwarding}</li>
      </ul>
      <InlineError message={load.kind === "failed" ? load.error : error} className="mt-2" />
    </div>
  );
}

export function torActive(account: Account | null, status: Pick<TunnelStatus, "phase" | "nodeId" | "addresses">): boolean {
  if (!account || status.phase === "disconnected" || !status.nodeId) return false;
  const addresses = new Set(status.addresses.map((address) => address.split("/")[0]));
  return account.devices.some((device) => device.tor === true && device.nodeId === status.nodeId && addresses.has(device.ipv4));
}

export function withTorState(account: Account, state: TorState): Account {
  return {
    ...account,
    devices: account.devices.map((device) =>
      device.id === state.deviceId ? { ...device, tor: state.enabled, torSocks: state.socks } : device,
    ),
  };
}

export function TorBadge({ active, className }: { active: boolean; className?: string }) {
  const { t } = useI18n();
  if (!active) return null;
  return (
    <p className={cn("flex", className)}>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[11.5px] font-medium text-zinc-600">
        {t.home.torBadge}
      </span>
    </p>
  );
}
