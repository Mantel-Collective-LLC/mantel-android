import { useCallback, useEffect, useState } from "react";
import { PlusIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import type { Account, Device, MantelBridge, PortForward, PortForwardingState, VpnNode } from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";
import { Flag } from "../ui/flag";
import { CopyButton, DeviceKindIcon, deviceKind, EmptyState, FIELD, PageHeader } from "../ui/manage";
import { Badge, Button, Card, InlineError } from "../ui/primitives";

export function parseLocalPort(text: string): number | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  if (!/^\d{1,5}$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : undefined;
}

type Load = { kind: "loading" } | { kind: "ready"; state: PortForwardingState | null } | { kind: "failed"; error: string };

export function PortForwardsPage({
  bridge,
  account,
  nodes,
  onShowConnect,
}: {
  bridge: MantelBridge;
  account: Account;
  nodes: readonly VpnNode[];
  onShowConnect: () => void;
}) {
  const { t } = useI18n();
  const devices = account.devices;
  return (
    <div className="space-y-4">
      <PageHeader title={t.forwards.title} description={t.forwards.description} />
      {devices.length === 0 ? (
        <EmptyState
          title={t.forwards.emptyTitle}
          text={t.forwards.empty}
          action={
            <Button variant="secondary" onClick={onShowConnect}>
              {t.manage.toConnect}
            </Button>
          }
        />
      ) : (
        <>
          {devices.map((device) => (
            <DeviceForwards key={device.id} bridge={bridge} device={device} node={nodes.find((node) => node.id === device.nodeId) ?? null} />
          ))}
          <div className="space-y-2 px-1 text-[12.5px] leading-relaxed text-zinc-500">
            <p>{t.forwards.hint}</p>
            <p>{t.forwards.switchNote}</p>
            <p className="flex items-start gap-1.5 text-amber-700">
              <WarningIcon weight="fill" className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t.forwards.warning}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function DeviceForwards({ bridge, device, node }: { bridge: MantelBridge; device: Device; node: VpnNode | null }) {
  const { t, format } = useI18n();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [pending, setPending] = useState<number | "add" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localText, setLocalText] = useState("");
  const localPort = parseLocalPort(localText);

  const read = useCallback(async () => {
    const result = await bridge.devicePortForwarding?.(device.id);
    if (!result) return;
    setLoad(result.ok ? { kind: "ready", state: result.value } : { kind: "failed", error: result.error });
  }, [bridge, device.id]);

  useEffect(() => {
    void read();
  }, [read]);

  const change = async (action: number | "add") => {
    setPending(action);
    setError(null);
    const result =
      action === "add" ? await bridge.addPortForward?.(device.id, localPort ?? null) : await bridge.removePortForward?.(device.id, action);
    setPending(null);
    if (!result) return;
    if (result.ok) {
      setLoad({ kind: "ready", state: result.value });
      if (action === "add") setLocalText("");
    } else setError(result.error);
  };

  const saveLocal = async (port: number, value: number | null): Promise<boolean> => {
    setPending(port);
    setError(null);
    const result = await bridge.setPortForwardLocalPort?.(device.id, port, value);
    setPending(null);
    if (!result) return false;
    if (result.ok) setLoad({ kind: "ready", state: result.value });
    else setError(result.error);
    return result.ok;
  };

  const state = load.kind === "ready" ? load.state : null;
  const forwards = state?.forwards ?? [];
  const city = state?.city ?? node?.city ?? t.devices.unknownLocation;
  const reasons = t.settings.portForwardingReasons;
  const reason = state?.reason ? format(reasons[state.reason] ?? reasons.unsupported, { city }) : null;
  const canAdd = state !== null && state.available && forwards.length < state.max && localPort !== undefined;
  const showLocal = state !== null && state.localPort && state.available;
  const localId = `pf-local-${device.id}`;

  return (
    <Card className="overflow-hidden">
      <section aria-label={device.name}>
        <header className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700">
            <DeviceKindIcon kind={deviceKind(device.name)} className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] tracking-[-0.01em] text-ink">{device.name}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-zinc-500">
              {node && <Flag code={node.country} className="size-3.5" />}
              {city}
            </p>
          </div>
          {state && <Badge>{format(t.forwards.count, { count: forwards.length, max: state.max })}</Badge>}
        </header>
        <div className="space-y-2 px-4 py-3">
          {load.kind === "loading" && <span className="block h-10 animate-pulse rounded-2xl bg-zinc-100" />}
          {load.kind === "ready" && state === null && <p className="text-[13px] text-zinc-500">{t.forwards.noForward}</p>}
          {state && forwards.length === 0 && !reason && <p className="text-[13px] text-zinc-500">{t.forwards.none}</p>}
          {reason && <p className="text-[13px] leading-relaxed text-zinc-600">{reason}</p>}
          {forwards.map((forward) => (
            <div key={forward.port} className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 py-2 pl-3.5 pr-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-[15px] tabular-nums tracking-[-0.02em] text-ink">
                    {forward.port}
                    {forward.localPort !== null && <span className="text-zinc-500"> → :{forward.localPort}</span>}
                  </p>
                  <p className="font-mono text-[11.5px] text-zinc-400 [overflow-wrap:anywhere]">
                    {forward.host}:{forward.port} · {t.settings.portForwardingProtocols}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <CopyButton bridge={bridge} text={`${forward.host}:${forward.port}`} label={`${forward.host}:${forward.port}`} compact />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={format(t.forwards.remove, { port: forward.port })}
                    pending={pending === forward.port}
                    disabled={pending !== null}
                    onClick={() => void change(forward.port)}
                    icon={<XIcon weight="bold" className="size-4" aria-hidden />}
                  >
                    {null}
                  </Button>
                </div>
              </div>
              {state?.localPort && bridge.setPortForwardLocalPort && (
                <LocalPortEditor forward={forward} disabled={pending !== null} onSave={(value) => saveLocal(forward.port, value)} />
              )}
            </div>
          ))}
          {showLocal && forwards.length < (state?.max ?? 0) && (
            <div className="space-y-1 pt-1">
              <label htmlFor={localId} className="block text-[12.5px] font-medium text-zinc-600">
                {t.forwards.localPort}
              </label>
              <input
                id={localId}
                inputMode="numeric"
                autoComplete="off"
                maxLength={5}
                value={localText}
                placeholder={t.forwards.localPortPlaceholder}
                aria-invalid={localPort === undefined || undefined}
                aria-describedby={`${localId}-help`}
                onChange={(event) => setLocalText(event.target.value)}
                className={cn(FIELD, "max-w-40 font-mono tabular-nums", localPort === undefined && "border-red-400")}
              />
              <p id={`${localId}-help`} aria-live="polite" className={cn("text-[12.5px]", localPort === undefined ? "text-red-600" : "text-zinc-500")}>
                {localPort === undefined ? t.forwards.localPortInvalid : t.forwards.localPortHelp}
              </p>
            </div>
          )}
          {(showLocal || forwards.some((forward) => forward.localPort !== null)) && (
            <p className="text-[12.5px] leading-relaxed text-zinc-500">{t.forwards.listenHint}</p>
          )}
          {state && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {state.available && forwards.length >= state.max ? (
                <p className="text-[12.5px] text-zinc-500">{format(t.forwards.limitNote, { max: state.max })}</p>
              ) : (
                <span />
              )}
              <Button
                variant="secondary"
                size="sm"
                pending={pending === "add"}
                disabled={!canAdd || pending !== null}
                onClick={() => void change("add")}
                icon={<PlusIcon weight="bold" className="size-4" aria-hidden />}
              >
                {t.forwards.add}
              </Button>
            </div>
          )}
          <InlineError message={load.kind === "failed" ? load.error : error} />
          {load.kind === "failed" && (
            <Button variant="ghost" size="sm" onClick={() => void read()}>
              {t.manage.retry}
            </Button>
          )}
        </div>
      </section>
    </Card>
  );
}

function LocalPortEditor({ forward, disabled, onSave }: { forward: PortForward; disabled: boolean; onSave: (value: number | null) => Promise<boolean> }) {
  const { t, format } = useI18n();
  const [text, setText] = useState(forward.localPort === null ? "" : String(forward.localPort));
  useEffect(() => setText(forward.localPort === null ? "" : String(forward.localPort)), [forward.localPort]);
  const value = parseLocalPort(text);
  const normalized = value === forward.port ? null : value;
  const dirty = value !== undefined && normalized !== forward.localPort;
  const id = `pf-edit-${forward.port}`;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 pr-1.5">
      <label htmlFor={id} className="sr-only">
        {format(t.forwards.localPortFor, { port: forward.port })}
      </label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        value={text}
        placeholder={t.forwards.localPortPlaceholder}
        aria-invalid={value === undefined || undefined}
        onChange={(event) => setText(event.target.value)}
        className={cn(FIELD, "h-9 max-w-36 py-0 font-mono tabular-nums", value === undefined && "border-red-400")}
      />
      <Button variant="secondary" size="sm" disabled={!dirty || disabled} onClick={() => void onSave(value ?? null)}>
        {t.forwards.save}
      </Button>
      {value === undefined && <span className="text-[12.5px] text-red-600">{t.forwards.localPortInvalid}</span>}
    </div>
  );
}
