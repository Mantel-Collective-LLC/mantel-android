import { useState, type ReactNode } from "react";
import {
  AndroidLogoIcon,
  BugIcon,
  CaretRightIcon,
  CircleHalfIcon,
  ClockCounterClockwiseIcon,
  DeviceMobileIcon,
  DevicesIcon,
  DoorOpenIcon,
  FunnelIcon,
  GlobeIcon,
  LockKeyIcon,
  MaskHappyIcon,
  MonitorIcon,
  MoonIcon,
  NetworkIcon,
  ShieldCheckIcon,
  ShareNetworkIcon,
  SignOutIcon,
  SparkleIcon,
  SquaresFourIcon,
  SunIcon,
  TranslateIcon,
  WallIcon,
} from "@phosphor-icons/react";
import {
  DNS_FILTER_GROUPS,
  dnsGroupActive,
  type Account,
  type Environment,
  type MantelBridge,
  type Preferences,
  type SystemVpnState,
  type TunnelPhase,
} from "../../../core/contract";
import { LANGUAGE_NAMES, LANGUAGES, resolveLanguage, type LanguagePreference } from "../../../core/i18n";
import type { Theme, ThemePreference } from "../../../core/theme";
import { useI18n } from "../i18n/context";
import { excludedSummary } from "../lib/apps";
import type { LoginNotices } from "../lib/logins";
import { loginSummary } from "../ui/login-notices";
import { cn } from "../lib/cn";
import { useAppIcon, useLanguageChoice } from "../lib/hooks";
import { isAndroid } from "../lib/platform";
import { protectionSummary, type ProtectionItem } from "../lib/protection";
import { effectiveThemePreference, useSystemTheme, useThemeChoice } from "../lib/theme";
import { AccountHero } from "../ui/paid-time";
import { Badge, Button, Card, InlineError } from "../ui/primitives";
import { PqSettingRow } from "../ui/pq-setting-row";
import { Sheet, SheetOptions, type SheetOption } from "../ui/sheet";

export type SettingsPage =
  | "connection"
  | "protection"
  | "alwaysOn"
  | "dns"
  | "disguise"
  | "upcoming"
  | "devices"
  | "forwards"
  | "proxies"
  | "logins";

export const UPCOMING = ["multihop", "customPort"] as const;

function languageLabel(preference: LanguagePreference | undefined): string {
  return LANGUAGE_NAMES[resolveLanguage(preference)];
}

function ListSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="px-4 pb-2 text-xs font-medium text-zinc-400">{title}</h2>
      <Card className="overflow-hidden">
        <div className="divide-y divide-zinc-100">{children}</div>
      </Card>
    </section>
  );
}

type Tone = "neutral" | "danger" | "debug";

function StatusText({ tone, children }: { tone: "accent" | "warn" | "neutral"; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", tone === "accent" && "text-accent-strong", tone === "warn" && "text-amber-700")}>
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone === "accent" && "bg-accent",
          tone === "warn" && "bg-amber-500",
          tone === "neutral" && "bg-zinc-300",
        )}
      />
      {children}
    </span>
  );
}

const TONE_OF = { on: "accent", warn: "warn", idle: "neutral" } as const;

function ProtectionSection({
  items,
}: {
  items: ReadonlyArray<{ id: string; icon: ReactNode; label: string; item: ProtectionItem; onClick: () => void }>;
}) {
  const { t } = useI18n();
  return (
    <ListSection title={t.settings.protection.title}>
      {items.map(({ id, icon, label, item, onClick }) => (
        <NavRow
          key={id}
          icon={icon}
          label={label}
          description={<StatusText tone={TONE_OF[item.level]}>{t.settings.protection.states[item.state]}</StatusText>}
          onClick={onClick}
        />
      ))}
    </ListSection>
  );
}

function IconTile({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl [&>svg]:size-[18px]",
        tone === "neutral" && "bg-zinc-100 text-zinc-700",
        tone === "danger" && "bg-red-50 text-red-600",
        tone === "debug" && "bg-amber-100 text-amber-800",
      )}
    >
      {children}
    </span>
  );
}

function NavRow({
  icon,
  label,
  description,
  trailing,
  tone = "neutral",
  chevron = true,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  description?: ReactNode;
  trailing?: ReactNode;
  tone?: Tone;
  chevron?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[60px] w-full items-center gap-3.5 px-4 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-zinc-50/70 focus-visible:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent active:bg-zinc-100/70"
    >
      <IconTile tone={tone}>{icon}</IconTile>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px] tracking-[-0.01em]", tone === "danger" ? "font-medium text-red-600" : "text-ink")}>
          {label}
        </span>
        {description && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-zinc-500">{description}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center">{trailing}</span>}
      {chevron && <CaretRightIcon weight="bold" className="size-4 shrink-0 text-zinc-300" aria-hidden />}
    </button>
  );
}

function LanguageSheet({
  open,
  onClose,
  bridge,
  environment,
  preferences,
  onPreferences,
}: {
  open: boolean;
  onClose: () => void;
  bridge: MantelBridge;
  environment: Environment;
  preferences: Preferences;
  onPreferences: (next: Preferences) => void;
}) {
  const { t } = useI18n();
  const language = useLanguageChoice(bridge, preferences, onPreferences);
  const options: ReadonlyArray<{ value: LanguagePreference; label: string }> = LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] }));

  const choose = async (next: LanguagePreference) => {
    await language.choose(next);
    window.setTimeout(onClose, 180);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t.language.title}
      description={isAndroid(environment) ? t.language.descriptionAndroid : t.language.descriptionDesktop}
    >
      <SheetOptions
        label={t.language.control}
        options={options}
        value={language.current}
        onChoose={(next) => void choose(next)}
      />
      <InlineError message={language.error} className="px-3 pt-2" />
    </Sheet>
  );
}

function themeLabel(preference: ThemePreference, system: Theme, names: Record<ThemePreference, string>): string {
  return preference === "system" ? `${names.system} (${names[system]})` : names[preference];
}

function ThemeSheet({
  open,
  onClose,
  bridge,
  system,
  mobile,
  preferences,
  onPreferences,
}: {
  open: boolean;
  onClose: () => void;
  bridge: MantelBridge;
  system: Theme;
  mobile: boolean;
  preferences: Preferences;
  onPreferences: (next: Preferences) => void;
}) {
  const { t, format } = useI18n();
  const theme = useThemeChoice(bridge, preferences, onPreferences);
  const options: ReadonlyArray<SheetOption<ThemePreference>> = [
    {
      value: "system",
      label: t.theme.system,
      hint: format(t.theme.systemHint, { theme: t.theme[system] }),
      icon: mobile ? <DeviceMobileIcon weight="bold" /> : <MonitorIcon weight="bold" />,
    },
    { value: "light", label: t.theme.light, icon: <SunIcon weight="bold" /> },
    { value: "dark", label: t.theme.dark, icon: <MoonIcon weight="bold" /> },
  ];

  const choose = async (next: ThemePreference) => {
    await theme.choose(next);
    window.setTimeout(onClose, 180);
  };

  return (
    <Sheet open={open} onClose={onClose} title={t.theme.title} description={t.theme.description}>
      <SheetOptions label={t.theme.control} options={options} value={theme.current} onChoose={(next) => void choose(next)} />
      <InlineError message={theme.error} className="px-3 pt-2" />
    </Sheet>
  );
}

export function ConfirmSheet({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  icon,
  pending,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  icon?: ReactNode;
  pending: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={title} description={description}>
      {children}
      <div className="space-y-2 px-1 pt-2">
        <Button variant="destructive" size="lg" pending={pending} icon={icon} onClick={onConfirm} className="w-full">
          {confirmLabel}
        </Button>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending} className="w-full">
          {t.settings.cancel}
        </Button>
      </div>
    </Sheet>
  );
}

export function SettingsOverview({
  bridge,
  account,
  environment,
  preferences,
  systemVpn,
  firewallActive,
  phase,
  excludedCount,
  logins,
  footer,
  logoutPending,
  onOpenPage,
  onOpenApps,
  onPreferences,
  onLogout,
  onOpenDebug,
}: {
  bridge: MantelBridge;
  account: Account;
  environment: Environment;
  preferences: Preferences;
  systemVpn: { state: SystemVpnState | null; loading: boolean };
  firewallActive: boolean;
  phase: TunnelPhase;
  excludedCount: number | null;
  logins: LoginNotices;
  footer: ReactNode;
  logoutPending: boolean;
  onOpenPage: (page: SettingsPage) => void;
  onOpenApps: () => void;
  onPreferences: (next: Preferences) => void;
  onLogout: () => Promise<void>;
  onOpenDebug?: () => void;
}) {
  const i18n = useI18n();
  const { t, format } = i18n;
  const { features } = environment;
  const mobile = isAndroid(environment);
  const [sheet, setSheet] = useState<"language" | "theme" | "logout" | null>(null);
  const systemTheme = useSystemTheme(bridge);
  const disguise = features.appDisguise === true && Boolean(bridge.appIcon && bridge.setAppIcon);
  const appIcon = useAppIcon(bridge);
  const settings = account.settings;
  const dnsActive = DNS_FILTER_GROUPS.filter((group) => dnsGroupActive(settings.dns, group)).length;
  const lockdown = systemVpn.state?.supported ? systemVpn.state : null;
  const closeSheet = () => setSheet(null);
  const protection = protectionSummary({
    android: mobile,
    settings,
    phase,
    blocking: mobile ? lockdown?.lockdown === true : firewallActive || preferences.alwaysOnKillSwitch,
  });
  const openConnection = () => onOpenPage("connection");

  return (
    <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:grid-rows-[auto_auto_auto_1fr] lg:items-start lg:gap-x-6 lg:gap-y-4 lg:space-y-0">
      <header className="px-1 pt-1 lg:col-span-2">
        <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em] text-ink">{t.app.tabSettings}</h1>
      </header>
      <div className="lg:col-start-1 lg:row-start-2">
        <AccountHero bridge={bridge} account={account} />
      </div>

      <div className="space-y-6 lg:col-start-2 lg:row-span-3 lg:row-start-2">
      <ProtectionSection
        items={[
          {
            id: "killSwitch",
            icon: <LockKeyIcon weight="bold" />,
            label: t.settings.protection.killSwitch,
            item: protection.killSwitch,
            onClick: () => onOpenPage(mobile && features.systemLockdown ? "protection" : "connection"),
          },
          { id: "dns", icon: <GlobeIcon weight="bold" />, label: t.settings.protection.dns, item: protection.dns, onClick: openConnection },
          { id: "ipv6", icon: <NetworkIcon weight="bold" />, label: t.settings.protection.ipv6, item: protection.ipv6, onClick: openConnection },
        ]}
      />
      {logins.available && (
        <ListSection title={t.logins.section}>
          <NavRow
            icon={<ClockCounterClockwiseIcon weight="bold" />}
            label={t.logins.title}
            description={
              <StatusText tone={!logins.overview ? "neutral" : logins.overview.logins.length > 0 ? "warn" : "accent"}>
                {loginSummary(logins, i18n)}
              </StatusText>
            }
            trailing={logins.overview?.logins.length ? <Badge tone="warn">{logins.overview.logins.length}</Badge> : undefined}
            onClick={() => onOpenPage("logins")}
          />
        </ListSection>
      )}

      <ListSection title={t.settings.mobile.sectionVpn}>
        <NavRow
          icon={<ShieldCheckIcon weight="bold" />}
          label={t.settings.connectionTitle}
          description={
            settings.killSwitch ? (
              <StatusText tone="accent">{t.settings.mobile.killSwitchOn}</StatusText>
            ) : (
              <StatusText tone="warn">{t.settings.mobile.killSwitchOff}</StatusText>
            )
          }
          onClick={() => onOpenPage("connection")}
        />
        <PqSettingRow bridge={bridge} preferences={preferences} onPreferences={onPreferences} lockdownHint={mobile && lockdown?.lockdown !== true} />
        {features.systemLockdown && (
          <NavRow
            icon={<AndroidLogoIcon weight="bold" />}
            label={t.settings.systemLockdownTitle}
            description={
              systemVpn.loading && !systemVpn.state ? (
                t.settings.loading
              ) : lockdown ? (
                lockdown.alwaysOn && lockdown.lockdown ? (
                  <StatusText tone="accent">{t.settings.active}</StatusText>
                ) : (
                  <StatusText tone="warn">{t.settings.mobile.lockdownPartial}</StatusText>
                )
              ) : (
                <StatusText tone="neutral">{t.settings.mobile.lockdownSetup}</StatusText>
              )
            }
            onClick={() => onOpenPage("protection")}
          />
        )}
        {features.firewallLockdown && (
          <NavRow
            icon={<WallIcon weight="bold" />}
            label={t.settings.alwaysOnTitle}
            description={
              preferences.alwaysOnKillSwitch || firewallActive ? (
                <StatusText tone="accent">{t.settings.active}</StatusText>
              ) : (
                <StatusText tone="neutral">{t.settings.off}</StatusText>
              )
            }
            onClick={() => onOpenPage("alwaysOn")}
          />
        )}
        {features.appExclusion && (
          <NavRow
            icon={<SquaresFourIcon weight="bold" />}
            label={t.settings.excludeAppsTitle}
            description={excludedCount === null ? t.settings.loading : excludedSummary(excludedCount, i18n)}
            trailing={excludedCount !== null && excludedCount > 0 ? <Badge tone="warn">{excludedCount}</Badge> : undefined}
            onClick={onOpenApps}
          />
        )}
        <NavRow
          icon={<FunnelIcon weight="bold" />}
          label={t.settings.dnsTitle}
          description={
            dnsActive === 0
              ? t.settings.mobile.dnsNone
              : format(t.settings.mobile.dnsSummary, { count: dnsActive, total: DNS_FILTER_GROUPS.length })
          }
          onClick={() => onOpenPage("dns")}
        />
      </ListSection>

      {(bridge.renameDevice || bridge.devicePortForwarding || bridge.proxies) && (
        <ListSection title={t.manage.section}>
          {bridge.removeDevice && (
            <NavRow
              icon={<DevicesIcon weight="bold" />}
              label={t.manage.devicesRow}
              description={i18n.plural(t.manage.devicesSummary, account.devices.length)}
              onClick={() => onOpenPage("devices")}
            />
          )}
          {bridge.devicePortForwarding && (
            <NavRow
              icon={<DoorOpenIcon weight="bold" />}
              label={t.manage.forwardsRow}
              description={t.manage.forwardsSummary}
              onClick={() => onOpenPage("forwards")}
            />
          )}
          {bridge.proxies && (
            <NavRow
              icon={<ShareNetworkIcon weight="bold" />}
              label={t.manage.proxiesRow}
              description={t.manage.proxiesSummary}
              onClick={() => onOpenPage("proxies")}
            />
          )}
        </ListSection>
      )}

      <ListSection title={t.settings.mobile.sectionApp}>
        <NavRow
          icon={<TranslateIcon weight="bold" />}
          label={t.language.title}
          description={languageLabel(preferences.language)}
          onClick={() => setSheet("language")}
        />
        <NavRow
          icon={<CircleHalfIcon weight="bold" />}
          label={t.theme.title}
          description={themeLabel(effectiveThemePreference(preferences), systemTheme, {
            system: t.theme.system,
            light: t.theme.light,
            dark: t.theme.dark,
          })}
          onClick={() => setSheet("theme")}
        />
        {disguise && (
          <NavRow
            icon={<MaskHappyIcon weight="bold" />}
            label={t.settings.disguiseTitle}
            description={
              appIcon.current === null
                ? t.settings.loading
                : appIcon.current === "calculator"
                  ? t.settings.disguiseCalculator
                  : t.settings.disguiseDefault
            }
            onClick={() => onOpenPage("disguise")}
          />
        )}
        <NavRow
          icon={<SparkleIcon weight="bold" />}
          label={t.settings.upcomingTitle}
          description={format(t.settings.mobile.upcomingCount, { count: UPCOMING.length })}
          onClick={() => onOpenPage("upcoming")}
        />
      </ListSection>

      {onOpenDebug && (
        <ListSection title={t.settings.mobile.sectionMore}>
          <NavRow
            icon={<BugIcon weight="bold" />}
            tone="debug"
            label={t.settings.debugTitle}
            description={t.settings.debugDescription}
            onClick={onOpenDebug}
          />
        </ListSection>
      )}

      </div>

      <Card className="overflow-hidden lg:col-start-1 lg:row-start-3">
        <NavRow
          icon={<SignOutIcon weight="bold" />}
          tone="danger"
          chevron={false}
          label={t.settings.logout}
          onClick={() => setSheet("logout")}
        />
      </Card>

      <div className="lg:col-start-1 lg:row-start-4">{footer}</div>

      <LanguageSheet
        open={sheet === "language"}
        onClose={closeSheet}
        bridge={bridge}
        environment={environment}
        preferences={preferences}
        onPreferences={onPreferences}
      />
      <ThemeSheet
        open={sheet === "theme"}
        onClose={closeSheet}
        bridge={bridge}
        system={systemTheme}
        mobile={mobile}
        preferences={preferences}
        onPreferences={onPreferences}
      />
      <ConfirmSheet
        open={sheet === "logout"}
        onClose={closeSheet}
        title={t.settings.mobile.logoutTitle}
        description={t.settings.logoutConfirm}
        confirmLabel={t.settings.logout}
        icon={<SignOutIcon weight="bold" className="size-4" />}
        pending={logoutPending}
        onConfirm={() => void onLogout().finally(closeSheet)}
      />
    </div>
  );
}
