import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, WarningIcon } from "@phosphor-icons/react";
import type { MantelBridge, PortForwardingState } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { copyText } from "../lib/clipboard";
import { Badge, Button, InlineError, Switch } from "./primitives";

export type PortForwardingLoad =
  | { kind: "loading" }
  | { kind: "ready"; state: PortForwardingState | null }
  | { kind: "failed"; error: string };

const COPIED_MS = 1800;

export function PortForwardingRow({ bridge }: { bridge: MantelBridge }) {
  const [load, setLoad] = useState<PortForwardingLoad>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const read = bridge.portForwarding;
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

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const write = bridge.setPortForwarding;
  if (!bridge.portForwarding || !write) return null;

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
  };

  const copy = async (port: number) => {
    if (await copyText(bridge, String(port))) setCopied(true);
  };

  return (
    <PortForwardingView
      load={load}
      pending={pending}
      error={error}
      copied={copied}
      onToggle={(next) => void toggle(next)}
      onCopy={(port) => void copy(port)}
    />
  );
}

export function PortForwardingView({
  load,
  pending,
  error,
  copied,
  onToggle,
  onCopy,
}: {
  load: PortForwardingLoad;
  pending: boolean;
  error: string | null;
  copied: boolean;
  onToggle: (next: boolean) => void;
  onCopy: (port: number) => void;
}) {
  const { t, format } = useI18n();
  const state = load.kind === "ready" ? load.state : null;
  const forward = state?.forwards[0] ?? null;
  const on = forward !== null;
  const city = state?.city ?? "";
  const reasons = t.settings.portForwardingReasons;
  const reason = state?.reason ? format(reasons[state.reason] ?? reasons.unsupported, { city }) : null;
  const description = state
    ? format(t.settings.portForwardingDescription, { city })
    : load.kind === "ready"
      ? t.settings.portForwardingNoDevice
      : undefined;

  return (
    <div className="px-5 py-3.5 android:py-4" data-testid="port-forwarding">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[14px] text-ink">
            {t.settings.portForwarding}
            {on && state && !state.available && <Badge tone="warn">{t.settings.portForwardingPaused}</Badge>}
          </p>
          {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{description}</p>}
        </div>
        <div className="shrink-0">
          <Switch
            label={t.settings.portForwarding}
            checked={on}
            disabled={pending || state === null || (!on && !state.available)}
            onChange={onToggle}
          />
        </div>
      </div>

      {reason && <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-600">{reason}</p>}

      {on && forward && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-zinc-50/60 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="font-mono text-[15px] tabular-nums tracking-[-0.02em] text-ink">
                {format(t.settings.portForwardingActive, { port: forward.port, city })}
              </p>
              <p className="mt-0.5 font-mono text-[11.5px] text-zinc-400 [overflow-wrap:anywhere]">
                {forward.host}:{forward.port} · {t.settings.portForwardingProtocols}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onCopy(forward.port)}
              icon={copied ? <CheckIcon weight="bold" className="size-4" aria-hidden /> : <CopyIcon className="size-4" aria-hidden />}
            >
              {copied ? t.settings.portForwardingCopied : t.settings.portForwardingCopy}
            </Button>
          </div>
          <p className="text-[12.5px] leading-relaxed text-zinc-500">{t.settings.portForwardingHint}</p>
          <p className="text-[12.5px] leading-relaxed text-zinc-500">{t.settings.portForwardingSwitchLocation}</p>
        </div>
      )}

      <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-amber-700">
        <WarningIcon weight="fill" className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t.settings.portForwardingWarning}
      </p>
      <InlineError message={load.kind === "failed" ? load.error : error} className="mt-2" />
    </div>
  );
}
