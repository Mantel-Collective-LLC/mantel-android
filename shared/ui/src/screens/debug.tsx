import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowClockwiseIcon,
  CaretLeftIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  CodeIcon,
  PulseIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type {
  ApiLogEntry,
  DebugBridge,
  DebugInfo,
  HealthCheck,
  MantelBridge,
  Preferences,
  TunnelStatus,
} from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";
import { formatAgo, formatBytes } from "../lib/format";
import { useNow } from "../lib/hooks";
import { Badge, Button, InlineError, Switch } from "../ui/primitives";
import { Group, Row } from "./settings";

const LOG_REFRESH_MS = 2000;

function KeyValues({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-5 py-4 text-[12.5px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-zinc-500">{label}</dt>
          <dd className="min-w-0 break-words text-right font-mono text-[12px] text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function clock(at: number, locale: string): string {
  return new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function statusTone(status: number | null): string {
  if (status === null) return "text-red-600";
  if (status >= 500) return "text-red-600";
  if (status >= 400) return "text-amber-700";
  return "text-accent-strong";
}

export default function DebugScreen({
  bridge,
  debug,
  preferences,
  status,
  onPreferences,
  onBack,
  onReset,
}: {
  bridge: MantelBridge;
  debug: DebugBridge;
  preferences: Preferences;
  status: TunnelStatus;
  onPreferences: (next: Preferences) => void;
  onBack: () => void;
  onReset: () => void;
}) {
  const i18n = useI18n();
  const { t, format } = i18n;
  const d = t.debug;
  const now = useNow(1000);
  const [info, setInfo] = useState<DebugInfo | null>(null);
  const [log, setLog] = useState<ApiLogEntry[]>([]);
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const refreshInfo = useCallback(() => {
    void debug.info().then(setInfo).catch(() => undefined);
  }, [debug]);

  const refreshLog = useCallback(() => {
    void debug.requestLog().then(setLog).catch(() => undefined);
  }, [debug]);

  useEffect(() => {
    refreshInfo();
  }, [refreshInfo, preferences.baseUrl]);

  useEffect(() => {
    refreshLog();
    const id = window.setInterval(refreshLog, LOG_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refreshLog]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(id);
  }, [notice]);

  const runHealthCheck = async () => {
    setChecking(true);
    setHealth(await debug.healthCheck());
    setChecking(false);
    refreshLog();
  };

  const copyDiagnostics = async () => {
    setError(null);
    const result = await debug.copyDiagnostics();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(d.copied);
  };

  const reset = async () => {
    setResetting(true);
    setError(null);
    const result = await debug.resetLocalData();
    setResetting(false);
    setConfirmReset(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(d.resetDone);
    const next = await bridge.preferences();
    onPreferences(next);
    refreshInfo();
    refreshLog();
    onReset();
  };

  const tunnelRows: Array<[string, ReactNode]> = [
    [d.tunnel.phase, t.tray.status[status.phase]],
    [d.tunnel.service, status.serviceState ?? d.none],
    [d.tunnel.node, status.nodeId ?? d.none],
    [d.tunnel.endpoint, status.endpoint ?? d.none],
    [d.tunnel.handshake, status.lastHandshakeAt ? formatAgo(now - status.lastHandshakeAt, i18n) : d.tunnel.never],
    [d.tunnel.received, formatBytes(status.rxBytes, i18n)],
    [d.tunnel.sent, formatBytes(status.txBytes, i18n)],
    [d.tunnel.addresses, status.addresses.length > 0 ? status.addresses.join(", ") : d.none],
    [d.tunnel.dns, status.dns.length > 0 ? status.dns.join(", ") : d.none],
    [d.tunnel.leakProtection, status.leakProtection],
    [d.tunnel.firewall, status.firewallActive ? d.yes : d.no],
    [d.tunnel.checked, clock(status.checkedAt, i18n.locale)],
  ];
  if (status.error) tunnelRows.push([d.tunnel.error, <span className="font-sans text-red-600">{status.error}</span>]);

  const buildRows: Array<[string, ReactNode]> = info
    ? [
        [d.build.version, info.appVersion],
        [d.build.flavor, info.flavor],
        [d.build.electron, info.electron],
        [d.build.chrome, info.chrome],
        [d.build.node, info.node],
        [d.build.v8, info.v8],
        [d.build.platform, `${info.platform} ${info.arch}`],
        [d.build.buildTime, info.buildTime ? new Date(info.buildTime).toLocaleString(i18n.locale) : d.none],
        [d.build.commit, info.commit ?? <span className="font-sans text-zinc-400">{d.build.commitUnknown}</span>],
        [d.build.packaged, info.packaged ? d.yes : d.no],
        [d.build.elevated, info.elevated ? d.yes : d.no],
        [d.build.appId, info.appId],
        [d.build.userData, info.userData],
        [d.build.service, info.serviceName],
        [d.build.firewallGroup, info.firewallGroup],
      ]
    : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 flex h-9 items-center gap-1 rounded-xl pl-1.5 pr-3 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <CaretLeftIcon weight="bold" className="size-4" />
          {d.back}
        </button>
        <Badge tone="warn">{d.badge}</Badge>
      </div>
      <div className="px-1">
        <h1 className="text-[22px] font-medium tracking-[-0.03em]">{d.title}</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">{d.description}</p>
      </div>

      <AnimatePresence initial={false}>
        {notice && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="status"
            className="flex items-center gap-2 rounded-2xl border border-zinc-200/80 bg-surface px-4 py-3 text-[13px] text-zinc-600"
          >
            <CheckCircleIcon weight="fill" className="size-4 text-accent-strong" />
            {notice}
          </motion.p>
        )}
      </AnimatePresence>
      <InlineError message={error} className="rounded-2xl border border-red-100 bg-surface px-4 py-3" />

      <Group title={d.serverTitle} description={d.serverDescription}>
        <div className="px-5 py-4">
          <p className="mb-2 break-all font-mono text-[12px] text-zinc-500">{info?.baseUrl ?? preferences.baseUrl}</p>
        </div>
      </Group>

      <Group
        title={d.healthTitle}
        description={d.healthDescription}
        aside={
          <Button size="sm" variant="secondary" pending={checking} onClick={() => void runHealthCheck()}>
            {!checking && <PulseIcon className="size-4" />}
            {d.healthRun}
          </Button>
        }
      >
        {health && (
          <p
            className={cn(
              "flex items-start gap-2 px-5 py-3.5 text-[12.5px] leading-relaxed",
              health.ok ? "text-accent-strong" : "text-red-600",
            )}
          >
            {health.ok ? (
              <CheckCircleIcon weight="fill" className="mt-0.5 size-4 shrink-0" />
            ) : (
              <WarningCircleIcon weight="fill" className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              {health.ok
                ? format(d.healthOk, { status: health.status ?? 0, latency: health.latencyMs, nodes: health.nodes ?? 0 })
                : format(d.healthFailed, { latency: health.latencyMs, error: health.error ?? d.none })}
              <span className="ml-1.5 font-mono text-[11px] text-zinc-400">{clock(health.checkedAt, i18n.locale)}</span>
            </span>
          </p>
        )}
      </Group>

      <Group
        title={d.logTitle}
        description={d.logDescription}
        aside={
          <Button
            size="sm"
            variant="ghost"
            disabled={log.length === 0}
            onClick={() => void debug.clearRequestLog().then(refreshLog)}
          >
            {d.logClear}
          </Button>
        }
      >
        {log.length === 0 ? (
          <p className="px-5 py-3.5 text-[12.5px] text-zinc-400">{d.logEmpty}</p>
        ) : (
          <ol className="max-h-64 overflow-y-auto px-3 py-2 font-mono text-[11.5px]" data-testid="debug-request-log">
            {[...log].reverse().map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[3.5rem_2.75rem_minmax(0,1fr)_auto] items-baseline gap-x-1.5 rounded-lg px-2 py-1 hover:bg-zinc-50"
              >
                <span className="text-zinc-400">{clock(entry.at, i18n.locale)}</span>
                <span className="font-semibold text-zinc-600">{entry.method}</span>
                <span className="truncate text-ink" title={entry.route}>
                  {entry.route}
                </span>
                <span className="min-w-[5.25rem] whitespace-nowrap text-right tabular-nums">
                  <span className={statusTone(entry.status)} title={entry.apiCode ? `${entry.code} · ${entry.apiCode}` : entry.code}>
                    {entry.status ?? d.logNetwork}
                  </span>
                  <span className="ml-1.5 text-zinc-400">{entry.durationMs} ms</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Group>

      <Group title={d.tunnelTitle} description={d.tunnelDescription}>
        <KeyValues rows={tunnelRows} />
      </Group>

      <Group
        title={d.buildTitle}
        aside={
          <Button size="sm" variant="ghost" onClick={refreshInfo} aria-label={d.buildTitle}>
            <ArrowClockwiseIcon className="size-4" />
          </Button>
        }
      >
        {info ? <KeyValues rows={buildRows} /> : <div className="h-24 animate-pulse bg-zinc-50" />}
      </Group>

      <Group title={d.toolsTitle}>
        <Row
          label={d.verboseTitle}
          description={d.verboseDescription}
          control={
            <Switch
              label={d.verboseTitle}
              checked={info?.verbose ?? false}
              disabled={!info}
              onChange={(value) => void debug.setVerbose(value).then(setInfo)}
            />
          }
        />
        <Row
          label={d.copyDiagnostics}
          description={d.copyDiagnosticsDescription}
          control={
            <Button size="sm" variant="secondary" onClick={() => void copyDiagnostics()} aria-label={d.copyDiagnostics}>
              <ClipboardTextIcon className="size-4" />
            </Button>
          }
        />
        <div className="px-5 py-3.5">
          <Button size="sm" variant="secondary" onClick={() => void debug.openDevTools()}>
            <CodeIcon className="size-4" />
            {d.openDevTools}
          </Button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <p className="text-[14px] text-ink">{d.reset}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{d.resetDescription}</p>
          </div>
          {confirmReset ? (
            <div className="space-y-3">
              <p className="text-[12.5px] leading-relaxed text-zinc-600">{d.resetConfirm}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                  {d.cancel}
                </Button>
                <Button size="sm" variant="danger" pending={resetting} onClick={() => void reset()}>
                  {d.reset}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirmReset(true)}>
              <TrashIcon className="size-4" />
              {d.reset}
            </Button>
          )}
        </div>
      </Group>
    </div>
  );
}
