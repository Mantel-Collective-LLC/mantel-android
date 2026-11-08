import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowClockwiseIcon, CheckIcon, CopyIcon, SignOutIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import type { Preferences, SystemVpnState } from "@shared/contract";
import { useI18n } from "@renderer/i18n/context";
import { formatBytes } from "@renderer/lib/format";
import { Badge, Button, Card, Switch } from "@renderer/ui/primitives";
import type { AndroidBridge } from "../bridge/extras";
import type { AndroidVpnController, ControllerDiagnostics } from "../bridge/controller";
import { copyText } from "../ui/clipboard";
import { checkHealth, diagnosticsReport, type HealthResult, type NativeAppInfo } from "./diagnostics";
import type { RequestLog } from "./request-log";
import { debugStrings, type DebugStrings } from "./strings";
import type { VerboseLog } from "./verbose";

export type DebugTools = {
  bridge: AndroidBridge;
  controller: AndroidVpnController;
  log: RequestLog;
  verbose: VerboseLog;
  appInfo: NativeAppInfo | null;
};

function Section({ title, description, aside, children }: { title: string; description?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium tracking-[-0.02em]">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{description}</p>}
        </div>
        {aside}
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-2 text-[12.5px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-zinc-500">{label}</dt>
          <dd className="min-w-0 break-words font-mono text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function useTicker(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

function statusTone(status: number | null): string {
  if (status === null) return "text-red-600";
  if (status >= 500 || status === 429) return "text-red-600";
  if (status >= 400) return "text-amber-700";
  return "text-accent-strong";
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString("de-DE", { hour12: false });
}

function HealthSection({ tools, texts }: { tools: DebugTools; texts: DebugStrings["debug"] }) {
  const { format } = useI18n();
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [checking, setChecking] = useState(false);
  const run = useCallback(async () => {
    setChecking(true);
    setHealth(await checkHealth(tools.controller));
    setChecking(false);
  }, [tools.controller]);
  useEffect(() => {
    void run();
  }, [run]);
  return (
    <Section
      title={texts.healthTitle}
      description={texts.healthDescription}
      aside={
        <Button size="sm" variant="secondary" pending={checking} onClick={() => void run()}>
          {!checking && <ArrowClockwiseIcon className="size-4" />}
          {checking ? texts.healthChecking : texts.healthCheck}
        </Button>
      }
    >
      {health === null ? (
        <p className="text-[13px] text-zinc-500">{texts.healthChecking}</p>
      ) : health.state === "ok" ? (
        <p className="text-[13px] font-medium text-accent-strong" data-testid="debug-health">
          {format(texts.healthOk, { nodes: health.nodes, ms: health.ms })}
        </p>
      ) : (
        <p className="text-[13px] text-red-600" data-testid="debug-health">
          {format(texts.healthFailed, { ms: health.ms, error: health.status ? `HTTP ${health.status} · ${health.error}` : health.error })}
        </p>
      )}
    </Section>
  );
}

function RequestLogSection({ log, texts }: { log: RequestLog; texts: DebugStrings["debug"] }) {
  const { format } = useI18n();
  const entries = useSyncExternalStore(
    (listener) => log.subscribe(listener),
    () => log.list(),
  );
  return (
    <Section
      title={texts.logTitle}
      description={format(texts.logDescription, { count: log.capacity })}
      aside={
        <Button size="sm" variant="ghost" disabled={entries.length === 0} onClick={() => log.clear()}>
          {texts.logClear}
        </Button>
      }
    >
      {entries.length === 0 ? (
        <p className="text-[13px] text-zinc-500">{texts.logEmpty}</p>
      ) : (
        <ol className="-mx-1 max-h-72 space-y-1 overflow-y-auto font-mono text-[11.5px]" data-testid="debug-request-log">
          {entries.map((entry) => (
            <li key={entry.id} className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-lg px-1 py-0.5">
              <span className="text-zinc-400">{time(entry.at)}</span>
              <span className="font-medium text-zinc-600">{entry.method}</span>
              <span className="truncate text-ink">{entry.route}</span>
              <span className={`text-right tabular-nums ${statusTone(entry.status)}`}>
                {entry.status ?? entry.error ?? "–"}
                {entry.apiCode ? ` ${entry.apiCode}` : ""} · {entry.durationMs} ms
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function VpnSection({ tools, texts }: { tools: DebugTools; texts: DebugStrings["debug"] }) {
  const i18n = useI18n();
  const now = useTicker(1000);
  const [systemVpn, setSystemVpn] = useState<SystemVpnState | null>(null);
  const [diag, setDiag] = useState<ControllerDiagnostics>(() => tools.controller.diagnostics());
  useEffect(() => setDiag(tools.controller.diagnostics()), [now, tools.controller]);
  useEffect(() => {
    void tools.bridge.systemVpnState?.().then(setSystemVpn).catch(() => undefined);
  }, [tools.bridge, diag.status.phase]);
  const status = diag.status;
  const handshake = status.lastHandshakeAt
    ? i18n.format(texts.secondsAgo, { seconds: Math.max(0, Math.round((now - status.lastHandshakeAt) / 1000)) })
    : texts.never;
  const rows: Array<[string, ReactNode]> = [
    [texts.state, `${status.phase}${status.serviceState ? ` (${status.serviceState})` : ""}`],
    [texts.node, status.nodeId ?? "–"],
    [texts.endpoint, status.endpoint ?? "–"],
    [texts.handshake, handshake],
    [texts.received, formatBytes(status.rxBytes, i18n)],
    [texts.sent, formatBytes(status.txBytes, i18n)],
    [texts.addresses, status.addresses.join(", ") || "–"],
    [texts.dns, status.dns.join(", ") || "–"],
    [texts.device, diag.device ? `${diag.device.id} · ${diag.device.nodeId} · ${diag.device.keySource}` : "–"],
    [
      texts.systemVpn,
      systemVpn?.supported
        ? `${systemVpn.alwaysOn ? "on" : "off"} / ${systemVpn.lockdown ? "on" : "off"}${systemVpn.cached ? " (cached)" : ""}`
        : texts.unknown,
    ],
    [texts.excludedApps, String(diag.excludedApps)],
    [texts.session, diag.session.loggedIn ? texts.loggedIn : texts.loggedOut],
  ];
  if (status.error) rows.push([texts.error, <span className="text-red-600">{status.error}</span>]);
  return (
    <Section title={texts.vpnTitle} aside={<Badge tone={status.phase === "connected" ? "accent" : status.phase === "stale" ? "warn" : "neutral"}>{status.phase}</Badge>}>
      <Facts rows={rows} />
    </Section>
  );
}

function DataSection({ tools, texts }: { tools: DebugTools; texts: DebugStrings["debug"] }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState<"logout" | "reset" | null>(null);
  const logout = async () => {
    setBusy("logout");
    await tools.bridge.logout().catch(() => undefined);
    window.location.reload();
  };
  const reset = async () => {
    setBusy("reset");
    await tools.controller.wipeLocalData().catch(() => undefined);
    await tools.verbose.set(false);
    window.location.reload();
  };
  return (
    <Section title={texts.dataTitle} description={texts.resetDescription}>
      <AnimatePresence mode="wait" initial={false}>
        {confirmReset ? (
          <motion.div key="confirm" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-zinc-600">{texts.resetConfirm}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                {texts.cancel}
              </Button>
              <Button size="sm" variant="danger" pending={busy === "reset"} onClick={() => void reset()}>
                <TrashIcon className="size-4" />
                {texts.reset}
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" pending={busy === "logout"} onClick={() => void logout()}>
              <SignOutIcon className="size-4" />
              {texts.logout}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmReset(true)}>
              <TrashIcon className="size-4" />
              {texts.reset}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </Section>
  );
}

export function DebugScreen({
  tools,
  preferences,
  onClose,
}: {
  tools: DebugTools;
  preferences: Preferences;
  onPreferences?: (next: Preferences) => void;
  onClose: () => void;
}) {
  const i18n = useI18n();
  const texts = debugStrings(i18n.language).debug;
  const verbose = useSyncExternalStore(
    (listener) => tools.verbose.subscribe(listener),
    () => tools.verbose.on,
  );
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const diag = tools.controller.diagnostics();
  const info = tools.appInfo;
  const build = __MANTEL_BUILD_INFO__;

  const copyDiagnostics = async () => {
    const health = await checkHealth(tools.controller);
    const systemVpn = (await tools.bridge.systemVpnState?.().catch(() => null)) ?? null;
    const ok = await copyText(diagnosticsReport({ controller: tools.controller, appInfo: info, log: tools.log, systemVpn, health }));
    setCopied(ok ? "copied" : "failed");
    window.setTimeout(() => setCopied("idle"), 2500);
  };

  return (
    <div className="space-y-3">
      <Section title={texts.serverTitle} description={texts.serverDescription}>
        <p className="break-all font-mono text-[12.5px] text-ink">{preferences.baseUrl}</p>
      </Section>

      <HealthSection key={preferences.baseUrl} tools={tools} texts={texts} />

      <Section title={texts.buildTitle}>
        <Facts
          rows={[
            [texts.version, info?.versionName || diag.version],
            [texts.versionCode, info?.versionCode != null ? String(info.versionCode) : texts.unknown],
            [texts.flavor, `${diag.flavor}${info?.debuggable === undefined ? "" : info.debuggable ? " · debuggable" : " · release"}`],
            [texts.packageName, info?.packageName ?? texts.unknown],
            [texts.builtAt, `${build.builtAt} (${build.mode}, web ${build.webVersion})`],
            [texts.capacitor, build.capacitorVersion],
            [texts.webView, info?.webViewVersion ?? (navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || texts.unknown)],
            [texts.android, info ? `SDK ${info.sdkInt}${info.model ? ` · ${info.model}` : ""}` : texts.unknown],
          ]}
        />
      </Section>

      <VpnSection tools={tools} texts={texts} />

      <RequestLogSection log={tools.log} texts={texts} />

      <Section title={texts.loggingTitle}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-ink">{texts.verbose}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{texts.verboseDescription}</p>
          </div>
          <Switch label={texts.verbose} checked={verbose} onChange={(value) => void tools.verbose.set(value)} />
        </div>
        <Button size="sm" variant="secondary" className="mt-4" onClick={() => void copyDiagnostics()}>
          {copied === "copied" ? <CheckIcon weight="bold" className="size-4" /> : <CopyIcon className="size-4" />}
          {copied === "copied" ? texts.copied : copied === "failed" ? texts.copyFailed : texts.copyDiagnostics}
        </Button>
      </Section>

      <DataSection tools={tools} texts={texts} />

      <Button size="md" variant="ghost" className="w-full" onClick={onClose}>
        <XIcon className="size-4" />
        {texts.close}
      </Button>
    </div>
  );
}
