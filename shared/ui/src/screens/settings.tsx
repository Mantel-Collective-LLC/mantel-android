import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowSquareOutIcon, CaretRightIcon, CheckCircleIcon, ShieldWarningIcon, WallIcon } from "@phosphor-icons/react";
import {
  DNS_FILTER_GROUPS,
  dnsGroupActive,
  dnsGroupPatch,
  type Account,
  type AccountSettings,
  type AppIcon,
  type AutostartState,
  type Environment,
  type MantelBridge,
  type Preferences,
  type QuitAction,
  type Result,
  type SettingsPatch,
  type SystemVpnState,
  type TunnelPhase,
  type VpnNode,
} from "../../../core/contract";
import { useI18n } from "../i18n/context";
import { cn } from "../lib/cn";
import { useAppIcon, type SaveState } from "../lib/hooks";
import { IS_DEBUG } from "../lib/flavor";
import { isAndroid } from "../lib/platform";
import { Badge, Button, Card, InlineError, SaveIndicator, Segmented, Switch } from "../ui/primitives";
import type { LoginNotices } from "../lib/logins";
import { DeviceKeyRow } from "../ui/device-key";
import { LoginsPage } from "../ui/login-notices";
import { PortForwardingRow } from "../ui/port-forwarding";
import { TorRow, withTorState } from "../ui/tor";
import { ObfuscationSettingRow } from "../ui/obfuscation";
import { VersionLine } from "../ui/update";
import { DevicesPage } from "./devices";
import { PortForwardsPage } from "./port-forwards";
import { ProxiesPage } from "./proxies";
import { ConfirmSheet, SettingsOverview, UPCOMING, type SettingsPage } from "./settings-overview";

export type { SettingsPage } from "./settings-overview";

const SAVED_VISIBLE_MS = 2500;

type GroupVariant = "card" | "page";

export function Group({
  title,
  description,
  aside,
  children,
  variant = "card",
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
  variant?: GroupVariant;
}) {
  if (variant === "page") {
    return (
      <section className="space-y-4">
        <header className="flex items-start justify-between gap-3 px-1 pt-1">
          <div className="min-w-0">
            <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em] text-ink">{title}</h1>
            {description && <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-500">{description}</p>}
          </div>
          {aside && <div className="shrink-0 pt-2">{aside}</div>}
        </header>
        <Card className="overflow-hidden">
          <div className="divide-y divide-zinc-100">{children}</div>
        </Card>
      </section>
    );
  }
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-medium tracking-[-0.02em]">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{description}</p>}
        </div>
        {aside}
      </div>
      <div className="divide-y divide-zinc-100">{children}</div>
    </Card>
  );
}

export function Row({ label, description, control, muted = false }: { label: string; description?: string; control: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 android:min-h-16">
      <div className="min-w-0">
        <p className={muted ? "text-[14px] text-zinc-400" : "text-[14px] text-ink"}>{label}</p>
        {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function StateBadge({ on }: { on: boolean }) {
  const { t } = useI18n();
  return on ? <Badge tone="accent">{t.settings.active}</Badge> : <Badge>{t.settings.off}</Badge>;
}

function SystemLockdownCard({
  bridge,
  state,
  loading,
}: {
  bridge: MantelBridge;
  state: SystemVpnState | null;
  loading: boolean;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const known = state?.supported === true;
  const protectedFully = known && state.alwaysOn && state.lockdown;

  const open = async () => {
    setError(null);
    try {
      await bridge.openSystemVpnSettings?.();
    } catch {
      setError(t.settings.openAndroidSettingsFailed);
    }
  };

  return (
    <Group
      variant="page"
      title={t.settings.systemLockdownTitle}
      description={t.settings.systemLockdownDescription}
      aside={known ? <StateBadge on={protectedFully} /> : undefined}
    >
      {loading && !state ? (
        <div className="px-5 py-4">
          <div className="h-10 animate-pulse rounded-xl bg-zinc-100/80" />
        </div>
      ) : known ? (
        <>
          <Row
            label={t.settings.alwaysOnVpn}
            description={t.settings.alwaysOnVpnDescription}
            control={<StateBadge on={state.alwaysOn} />}
          />
          <Row
            label={t.settings.blockWithoutVpn}
            description={t.settings.blockWithoutVpnDescription}
            control={<StateBadge on={state.lockdown} />}
          />
        </>
      ) : (
        <div className="px-5 py-4 text-[12.5px] leading-relaxed text-zinc-500">
          {t.settings.systemLockdownHowTo}
        </div>
      )}
      <div className="space-y-2 px-5 py-4">
        {known && state.cached && (
          <p className="text-[12.5px] leading-relaxed text-zinc-500">
            {t.settings.systemLockdownCached}
          </p>
        )}
        {known && !protectedFully && (
          <p className="text-[12.5px] leading-relaxed text-zinc-500">
            {t.settings.systemLockdownEnableBoth}
          </p>
        )}
        <Button size="sm" variant="secondary" onClick={() => void open()}>
          {t.settings.openAndroidSettings}
          <ArrowSquareOutIcon weight="bold" className="size-3.5" />
        </Button>
        <InlineError message={error} />
      </div>
    </Group>
  );
}

function AlwaysOnPage({
  bridge,
  environment,
  preferences,
  firewallActive,
  onPreferences,
  onError,
}: {
  bridge: MantelBridge;
  environment: Environment;
  preferences: Preferences;
  firewallActive: boolean;
  onPreferences: (next: Preferences) => void;
  onError: (message: string | null) => void;
}) {
  const { t, format } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const mac = environment.platform === "darwin";
  const rowDescription = mac
    ? format(t.mac.alwaysOnRowDescription, {
        command: IS_DEBUG ? "/Library/PrivilegedHelperTools/net.mantel.helper.debug" : "/Library/PrivilegedHelperTools/net.mantel.helper",
        flavor: IS_DEBUG ? "debug" : "prod",
      })
    : t.settings.alwaysOnRowDescription;

  const apply = async (enabled: boolean) => {
    setPending(true);
    onError(null);
    const result = await bridge.setAlwaysOnKillSwitch(enabled);
    setPending(false);
    setConfirm(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onPreferences(result.value);
  };

  return (
    <>
      <Group
        variant="page"
        title={t.settings.alwaysOnTitle}
        description={t.settings.alwaysOnDescription}
        aside={firewallActive ? <Badge tone="accent">{t.settings.active}</Badge> : undefined}
      >
        <Row
          label={t.settings.alwaysOnRow}
          description={rowDescription}
          control={
            <Switch
              label={t.settings.alwaysOnSwitch}
              checked={preferences.alwaysOnKillSwitch}
              disabled={pending || !environment.elevated}
              onChange={(value) => (value ? setConfirm(true) : void apply(false))}
            />
          }
        />
        {!environment.elevated && (
          <p className="flex gap-2 px-5 py-3.5 text-[12.5px] leading-relaxed text-amber-700">
            <ShieldWarningIcon weight="fill" className="mt-0.5 size-4 shrink-0" aria-hidden />
            {mac ? t.mac.alwaysOnNeedsHelper : t.settings.alwaysOnNeedsAdmin}
          </p>
        )}
      </Group>
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t.settings.alwaysOnTitle}
        description={t.settings.alwaysOnConfirm}
        confirmLabel={t.settings.alwaysOnEnable}
        icon={<WallIcon weight="bold" className="size-4" />}
        pending={pending}
        onConfirm={() => void apply(true)}
      />
    </>
  );
}

const CALCULATOR_PATH =
  "M39,27H69A6,6 0 0 1 75,33V75A6,6 0 0 1 69,81H39A6,6 0 0 1 33,75V33A6,6 0 0 1 39,27Z" +
  "M40,32H68A2,2 0 0 1 70,34V42A2,2 0 0 1 68,44H40A2,2 0 0 1 38,42V34A2,2 0 0 1 40,32Z" +
  [50, 60, 70]
    .flatMap((y) => [38, 50, 62].map((x) => `M${x + 1.5},${y}h5a1.5,1.5 0 0 1 1.5,1.5v4a1.5,1.5 0 0 1 -1.5,1.5h-5a1.5,1.5 0 0 1 -1.5,-1.5v-4a1.5,1.5 0 0 1 1.5,-1.5Z`))
    .join("");

function DisguiseIcon({ icon }: { icon: AppIcon }) {
  if (icon === "calculator") {
    return (
      <svg viewBox="18 18 72 72" className="size-12 rounded-[14px]" aria-hidden>
        <rect x="18" y="18" width="72" height="72" fill="#5F6368" />
        <path d={CALCULATOR_PATH} fill="white" fillRule="evenodd" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="size-12 rounded-[14px]" aria-hidden>
      <rect width="24" height="24" fill="#18181B" />
      <path
        d="M7 16.5V8.2c0-.5.6-.8 1-.4l4 3.7 4-3.7c.4-.4 1-.1 1 .4v8.3"
        fill="none"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="16.6" r="1.4" className="fill-accent" />
    </svg>
  );
}

const DISGUISES: readonly AppIcon[] = ["default", "calculator"];

function AppDisguiseCard({ bridge }: { bridge: MantelBridge }) {
  const { t } = useI18n();
  const { current, pending, error, choose } = useAppIcon(bridge);

  return (
    <Group variant="page" title={t.settings.disguiseTitle} description={t.settings.disguiseDescription}>
      <div role="radiogroup" aria-label={t.settings.disguiseIconLabel} className="grid grid-cols-2 gap-3 px-5 py-4">
        {DISGUISES.map((icon) => {
          const name = icon === "calculator" ? t.settings.disguiseCalculator : t.settings.disguiseDefault;
          const selected = (pending ?? current) === icon;
          return (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={current === null || pending !== null}
              onClick={() => void choose(icon)}
              className={cn(
                "relative flex min-h-11 flex-col items-center gap-2 rounded-2xl border px-3 py-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default",
                selected ? "border-ink bg-zinc-50" : "border-zinc-200 bg-surface active:bg-zinc-50",
              )}
            >
              {selected && (
                <CheckCircleIcon weight="fill" className="absolute right-2.5 top-2.5 size-4 text-ink" aria-hidden />
              )}
              <DisguiseIcon icon={icon} />
              <span className="text-[13px] font-medium text-ink">{name}</span>
            </button>
          );
        })}
      </div>
      <div className="space-y-2 px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-zinc-500">
          {t.settings.disguiseLauncherNote}
        </p>
        <p className="text-[12.5px] leading-relaxed text-zinc-500">
          {t.settings.disguiseVisibleNote}
        </p>
        <InlineError message={error} />
      </div>
    </Group>
  );
}

export function SettingsScreen({
  bridge,
  account,
  environment,
  preferences,
  firewallActive,
  phase,
  systemVpn,
  excludedCount,
  logins,
  onOpenApps,
  onAccount,
  onPreferences,
  onLoggedOut,
  onOpenDebug,
  page = null,
  onOpenPage,
  nodes = [],
  onShowConnect,
}: {
  bridge: MantelBridge;
  account: Account | null;
  environment: Environment;
  preferences: Preferences;
  firewallActive: boolean;
  phase: TunnelPhase;
  systemVpn: { state: SystemVpnState | null; loading: boolean };
  excludedCount: number | null;
  logins: LoginNotices;
  onOpenApps: () => void;
  onAccount: (next: Account) => void;
  onPreferences: (next: Preferences) => void;
  onLoggedOut: () => void;
  onOpenDebug?: () => void;
  page?: SettingsPage | null;
  onOpenPage?: (page: SettingsPage) => void;
  nodes?: readonly VpnNode[];
  onShowConnect?: () => void;
}) {
  const { features } = environment;
  const android = isAndroid(environment);
  const { t, format } = useI18n();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [torVersion, setTorVersion] = useState(0);
  const version = useRef(0);

  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = setTimeout(() => setSaveState("idle"), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [saveState]);

  if (!account) {
    return <div className="h-40 animate-pulse rounded-[28px] bg-zinc-100/80" />;
  }
  const settings = account.settings;

  const commit = async (patch: SettingsPatch, optimistic: AccountSettings) => {
    const previous = account;
    onAccount({ ...account, settings: optimistic });
    setSaveState("saving");
    setError(null);
    version.current += 1;
    const mine = version.current;
    const result = await bridge.updateSettings(patch);
    if (mine !== version.current) return;
    if (!result.ok) {
      onAccount(previous);
      setSaveState("error");
      setError(result.error);
      return;
    }
    onAccount({ ...account, settings: result.value });
    setSaveState("saved");
  };

  const setFlag = (key: "killSwitch" | "lanAccess" | "ipv6", value: boolean) =>
    void commit({ [key]: value }, { ...settings, [key]: value });

  const setFilter = (group: (typeof DNS_FILTER_GROUPS)[number], value: boolean) => {
    const patch = dnsGroupPatch(group, value);
    void commit({ dns: patch }, { ...settings, dns: { ...settings.dns, ...patch } });
  };

  const setAutoConnect = async (enabled: boolean) => {
    if (!bridge.setAutoConnectOpenWifi) return;
    onPreferences({ ...preferences, autoConnectOpenWifi: enabled });
    setError(null);
    const result = await bridge.setAutoConnectOpenWifi(enabled);
    if (result.ok) onPreferences(result.value);
    else {
      onPreferences(preferences);
      setError(result.error);
    }
  };

  const logout = async () => {
    setLogoutPending(true);
    const result = await bridge.logout();
    setLogoutPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onLoggedOut();
  };

  const connectionPage = (
    <Group variant="page" title={t.settings.connectionTitle} description={t.settings.connectionDescription}>
      <Row
        label={t.settings.killSwitch}
        description={android ? t.settings.killSwitchAndroid : t.settings.killSwitchDesktop}
        control={
          <Switch label={t.settings.killSwitch} checked={settings.killSwitch} onChange={(value) => setFlag("killSwitch", value)} />
        }
      />
      <Row
        label={t.settings.lan}
        description={
          settings.killSwitch && features.firewallLockdown
            ? environment.platform === "darwin"
              ? t.mac.lanFirewall
              : t.settings.lanFirewall
            : t.settings.lanDefault
        }
        control={<Switch label={t.settings.lan} checked={settings.lanAccess} onChange={(value) => setFlag("lanAccess", value)} />}
      />
      <Row
        label={t.settings.ipv6}
        description={t.settings.ipv6Description}
        control={<Switch label={t.settings.ipv6} checked={settings.ipv6} onChange={(value) => setFlag("ipv6", value)} />}
      />
      {bridge.setAutoConnectOpenWifi && (
        <Row
          label={t.settings.autoConnectOpenWifi}
          description={t.settings.autoConnectOpenWifiDescription}
          control={
            <Switch
              label={t.settings.autoConnectOpenWifi}
              checked={preferences.autoConnectOpenWifi === true}
              onChange={(value) => void setAutoConnect(value)}
            />
          }
        />
      )}
      <ObfuscationSettingRow bridge={bridge} preferences={preferences} onPreferences={onPreferences} />
      <TorRow
        bridge={bridge}
        onChange={(state) => {
          onAccount(withTorState(account, state));
          setTorVersion((value) => value + 1);
        }}
      />
      {bridge.devicePortForwarding ? (
        <button
          type="button"
          onClick={() => onOpenPage?.("forwards")}
          className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left outline-none transition-colors hover:bg-zinc-50/70 focus-visible:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent android:min-h-16"
        >
          <span className="min-w-0">
            <span className="block text-[14px] text-ink">{t.settings.portForwarding}</span>
            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-zinc-500">{t.manage.forwardsSummary}</span>
          </span>
          <CaretRightIcon weight="bold" className="size-4 shrink-0 text-zinc-300" aria-hidden />
        </button>
      ) : (
        <PortForwardingRow key={torVersion} bridge={bridge} />
      )}
      <DeviceKeyRow bridge={bridge} />
      <AppStartRows bridge={bridge} environment={environment} preferences={preferences} onPreferences={onPreferences} onError={setError} />
    </Group>
  );

  const dnsPage = (
    <Group variant="page" title={t.settings.dnsTitle} description={t.settings.dnsDescription}>
      {DNS_FILTER_GROUPS.map((group) => (
        <Row
          key={group.id}
          label={t.settings.blocklists[group.id]}
          control={
            <Switch
              label={format(t.settings.blocklistSwitch, { label: t.settings.blocklists[group.id] })}
              checked={dnsGroupActive(settings.dns, group)}
              onChange={(value) => setFilter(group, value)}
            />
          }
        />
      ))}
    </Group>
  );

  const upcomingPage = (
    <Group variant="page" title={t.settings.upcomingTitle} description={t.settings.upcomingDescription}>
      {UPCOMING.map((id) => (
        <Row
          key={id}
          label={t.settings.upcoming[id].label}
          description={t.settings.upcoming[id].description}
          muted
          control={<Badge>{t.settings.upcomingBadge}</Badge>}
        />
      ))}
    </Group>
  );

  const versionLine = (
    <p className="px-2 pb-2 text-center font-mono text-[11px] leading-relaxed text-zinc-400">
      <VersionLine version={environment.appVersion} />
      <span className="block">
        {features.managedWireGuard
          ? format(environment.platform === "darwin" ? t.mac.helperPath : t.settings.wireguardPath, {
              path: environment.wireguardPath ?? t.settings.wireguardNotFound,
            })
          : t.settings.wireguardBundled}
      </span>
    </p>
  );

  const pages: Record<SettingsPage, ReactNode> = {
    connection: connectionPage,
    protection: features.systemLockdown ? (
      <SystemLockdownCard bridge={bridge} state={systemVpn.state} loading={systemVpn.loading} />
    ) : null,
    alwaysOn: features.firewallLockdown ? (
      <AlwaysOnPage
        bridge={bridge}
        environment={environment}
        preferences={preferences}
        firewallActive={firewallActive}
        onPreferences={onPreferences}
        onError={setError}
      />
    ) : null,
    dns: dnsPage,
    disguise: features.appDisguise && bridge.appIcon && bridge.setAppIcon ? <AppDisguiseCard bridge={bridge} /> : null,
    upcoming: upcomingPage,
    devices: bridge.removeDevice ? (
      <DevicesPage
        bridge={bridge}
        account={account}
        nodes={nodes}
        onAccount={onAccount}
        onOpenForwards={() => onOpenPage?.("forwards")}
        onShowConnect={() => onShowConnect?.()}
      />
    ) : null,
    forwards: bridge.devicePortForwarding ? (
      <PortForwardsPage bridge={bridge} account={account} nodes={nodes} onShowConnect={() => onShowConnect?.()} />
    ) : null,
    proxies: bridge.proxies ? <ProxiesPage bridge={bridge} nodes={nodes} /> : null,
    logins: logins.available ? <LoginsPage bridge={bridge} notices={logins} /> : null,
  };

  return (
    <div className="space-y-3">
      <div className="pointer-events-none sticky top-0 z-20 flex h-0 justify-end">
        <div className="translate-y-3 pr-3">
          <SaveIndicator state={saveState} />
        </div>
      </div>
      <InlineError message={error} className="rounded-2xl border border-red-100 bg-surface px-4 py-3" />
      {page ? (
        pages[page]
      ) : (
        <SettingsOverview
          bridge={bridge}
          account={account}
          environment={environment}
          preferences={preferences}
          systemVpn={systemVpn}
          firewallActive={firewallActive}
          phase={phase}
          excludedCount={excludedCount}
          logins={logins}
          footer={versionLine}
          logoutPending={logoutPending}
          onOpenPage={(next) => onOpenPage?.(next)}
          onOpenApps={onOpenApps}
          onPreferences={onPreferences}
          onLogout={logout}
          onOpenDebug={onOpenDebug}
        />
      )}
    </div>
  );
}

function AppStartRows({
  bridge,
  environment,
  preferences,
  onPreferences,
  onError,
}: {
  bridge: MantelBridge;
  environment: Environment;
  preferences: Preferences;
  onPreferences: (next: Preferences) => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [autostart, setAutostart] = useState<AutostartState | null>(null);
  const [pending, setPending] = useState(false);
  const { autostart: readAutostart, setAutostart: writeAutostart, setConnectOnLaunch, setQuitAction } = bridge;

  useEffect(() => {
    if (!readAutostart) return;
    let live = true;
    void readAutostart()
      .then((state) => {
        if (live) setAutostart(state);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [readAutostart]);

  if (!readAutostart || !setQuitAction) return null;
  const mac = environment.platform === "darwin";
  const launchLabel = mac ? t.mac.launchAtLogin : t.settings.launchAtLogin;
  const enabled = autostart?.enabled === true;

  const toggleAutostart = async (next: boolean) => {
    if (!writeAutostart) return;
    setPending(true);
    onError(null);
    const result = await writeAutostart(next);
    setPending(false);
    if (result.ok) setAutostart(result.value);
    else onError(result.error);
  };

  const save = async (task: () => Promise<Result<Preferences>>) => {
    onError(null);
    const result = await task();
    if (result.ok) onPreferences(result.value);
    else onError(result.error);
  };

  const quitOptions: { value: QuitAction; label: string }[] = [
    { value: "ask", label: t.settings.quitActionAsk },
    { value: "keep", label: t.settings.quitActionKeep },
    { value: "disconnect", label: t.settings.quitActionDisconnect },
  ];

  return (
    <>
      {autostart?.supported && (
        <>
          <Row
            label={launchLabel}
            description={mac ? t.mac.launchAtLoginDescription : t.settings.launchAtLoginDescription}
            control={<Switch label={launchLabel} checked={enabled} disabled={pending} onChange={(next) => void toggleAutostart(next)} />}
          />
          {setConnectOnLaunch && (
            <Row
              label={t.settings.connectOnLaunch}
              description={t.settings.connectOnLaunchDescription}
              muted={!enabled}
              control={
                <Switch
                  label={t.settings.connectOnLaunch}
                  checked={enabled && preferences.connectOnLaunch === true}
                  disabled={!enabled}
                  onChange={(next) => void save(() => setConnectOnLaunch(next))}
                />
              }
            />
          )}
        </>
      )}
      <div className="px-5 py-3.5">
        <p className="text-[14px] text-ink">{t.settings.quitAction}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{t.settings.quitActionDescription}</p>
        <Segmented
          className="mt-3"
          label={t.settings.quitAction}
          layoutId="quit-action"
          options={quitOptions}
          value={preferences.quitAction ?? "ask"}
          onChange={(next) => void save(() => setQuitAction(next))}
        />
      </div>
    </>
  );
}
