import { DOWNLOAD_PAGE_PATH, type AppVersionInfo } from "./app-version";
import type { Language, LanguagePreference } from "./i18n";
import type { LatencyMeasurement } from "./latency";
import type { ProxyCreate, ProxyPatch, ProxyWithPassword, ServerProxy } from "./proxy";
import type { Theme, ThemePreference } from "./theme";

export type { AppVersionInfo } from "./app-version";
export type { LatencyMeasurement } from "./latency";
export type { Language, LanguagePreference } from "./i18n";
export type { Theme, ThemePreference } from "./theme";
export type { ProxyCreate, ProxyExit, ProxyPatch, ProxyProtocol, ProxyState, ProxyWithPassword, ServerProxy } from "./proxy";

export const BLOCKLIST_IDS = ["ads", "trackers", "malware", "gambling", "adult", "social"] as const;
export type BlocklistId = (typeof BLOCKLIST_IDS)[number];

export type DnsBlocklists = Record<BlocklistId, boolean>;

export const DNS_FILTER_GROUPS = [
  { id: "core", lists: ["ads", "trackers", "malware"] },
  { id: "adult", lists: ["adult"] },
  { id: "social", lists: ["social"] },
  { id: "gambling", lists: ["gambling"] },
] as const satisfies readonly { id: string; lists: readonly BlocklistId[] }[];
export type DnsFilterGroupId = (typeof DNS_FILTER_GROUPS)[number]["id"];

export function dnsGroupActive(dns: DnsBlocklists, group: (typeof DNS_FILTER_GROUPS)[number]): boolean {
  return group.lists.some((list) => dns[list]);
}

export function dnsGroupPatch(group: (typeof DNS_FILTER_GROUPS)[number], value: boolean): Partial<DnsBlocklists> {
  return Object.fromEntries(group.lists.map((list) => [list, value])) as Partial<DnsBlocklists>;
}

export type AccountSettings = {
  killSwitch: boolean;
  lanAccess: boolean;
  ipv6: boolean;
  dns: DnsBlocklists;
};

export type SettingsPatch = {
  killSwitch?: boolean;
  lanAccess?: boolean;
  ipv6?: boolean;
  dns?: Partial<DnsBlocklists>;
};

export const MAX_DEVICE_NAME = 32;

export type Device = {
  id: string;
  name: string;
  nodeId: string;
  ipv4: string;
  ipv6?: string;
  createdOn: string;
  keyRotatedOn?: string;
  tor?: boolean;
  torSocks?: string | null;
};

export type DeviceKeyInfo = { createdAt: number | null };

export type Account = {
  id: string;
  paidUntil: string;
  graceUntil?: string;
  noTimeYet?: boolean;
  settings: AccountSettings;
  devices: Device[];
};

export const LOCATION_STATUSES = ["paused", "upgrading", "full"] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export type VpnNode = {
  id: string;
  city: string;
  country: string;
  endpointHost: string;
  endpointPort: number;
  online: boolean;
  latencyMs?: number;
  pingPort?: number;
  postQuantum?: boolean;
  portForwarding?: boolean;
  obfuscation?: ObfuscationEndpoint;
  status?: LocationStatus;
  tor?: TorAvailability;
  serverPublicKey?: string;
};

export const TOR_AVAILABILITIES = ["ready", "starting", "unavailable"] as const;
export type TorAvailability = (typeof TOR_AVAILABILITIES)[number];

export type TorState = {
  deviceId: string;
  nodeId: string;
  city: string;
  enabled: boolean;
  availability: TorAvailability;
  socks: string | null;
};

export function torStateFor(device: Device, nodes: readonly VpnNode[]): TorState {
  const node = nodes.find((entry) => entry.id === device.nodeId);
  return {
    deviceId: device.id,
    nodeId: device.nodeId,
    city: node?.city ?? "",
    enabled: device.tor === true,
    availability: node?.tor ?? "unavailable",
    socks: device.torSocks ?? null,
  };
}

export type ObfuscationEndpoint = { version: number; port: number; pin: string };

export const OBFUSCATION_MODES = ["auto", "off", "on"] as const;
export type ObfuscationMode = (typeof OBFUSCATION_MODES)[number];

export const PORT_FORWARD_REASONS = ["unsupported", "disabled", "expired", "offline", "tor"] as const;
export type PortForwardReason = (typeof PORT_FORWARD_REASONS)[number];

export type PortForward = { port: number; host: string; localPort: number | null };

export type PortForwardingState = {
  nodeId: string;
  city: string;
  available: boolean;
  reason: PortForwardReason | null;
  max: number;
  localPort: boolean;
  forwards: PortForward[];
};

export type TunnelPhase = "disconnected" | "connecting" | "connected" | "stale" | "disconnecting";

export type LeakProtection = "wireguard" | "firewall" | "none";

export type QuantumState = "off" | "negotiating" | "active";

export type TunnelStatus = {
  phase: TunnelPhase;
  nodeId: string | null;
  connectedAt: number | null;
  lastHandshakeAt: number | null;
  rxBytes: number;
  txBytes: number;
  endpoint: string | null;
  addresses: string[];
  dns: string[];
  leakProtection: LeakProtection;
  firewallActive: boolean;
  serviceState: string | null;
  error: string | null;
  checkedAt: number;
  quantum?: QuantumState;
  obfuscated?: boolean;
  revoked?: RevocationReason;
};

export type RevocationReason = "device_removed" | "account_locked" | "session_ended" | "tunnel_dead";

export type Environment = {
  platform: string;
  elevated: boolean;
  wireguardInstalled: boolean;
  wireguardPath: string | null;
  wireguardSource: "managed" | "system" | null;
  encryptionAvailable: boolean;
  appVersion: string;
  features: PlatformFeatures;
  systemLanguage?: Language;
  systemLocale?: string;
};

export type PlatformFeatures = {
  desktopWindow: boolean;
  managedWireGuard: boolean;
  firewallLockdown: boolean;
  systemLockdown: boolean;
  appExclusion: boolean;
  appDisguise?: boolean;
};

export type AppIcon = "default" | "calculator";

export type SystemVpnState = {
  supported: boolean;
  alwaysOn: boolean;
  lockdown: boolean;
  cached?: boolean;
};

export type InstalledApp = {
  packageName: string;
  label: string;
  system: boolean;
  icon: string | null;
};

export type Preferences = {
  baseUrl: string;
  alwaysOnKillSwitch: boolean;
  lastNodeId: string | null;
  language?: LanguagePreference;
  theme?: ThemePreference;
  postQuantum?: boolean;
  autoConnectOpenWifi?: boolean;
  obfuscation?: ObfuscationMode;
  connectOnLaunch?: boolean;
  quitAction?: QuitAction;
};

export const QUIT_ACTIONS = ["ask", "keep", "disconnect"] as const;
export type QuitAction = (typeof QUIT_ACTIONS)[number];

export type AutostartState = {
  supported: boolean;
  enabled: boolean;
};

export type WifiSecurity = "open" | "secured" | "none" | "unknown";

export type SessionInfo = {
  loggedIn: boolean;
  accountId: string | null;
  paidUntil: string | null;
};

export type ErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "network"
  | "invalid"
  | "elevation"
  | "wireguard_missing"
  | "server"
  | "internal"
  | "totp_required"
  | "update_required"
  | "pq_unsupported"
  | "pq_failed"
  | "pq_mismatch"
  | "pq_not_active";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code: ErrorCode };

export type Registration = { code: string; referralDays?: number | null };

export type Flavor = "prod" | "debug";

export type DebugInfo = {
  flavor: Flavor;
  productName: string;
  appId: string;
  appVersion: string;
  electron: string;
  chrome: string;
  node: string;
  v8: string;
  platform: string;
  arch: string;
  buildTime: string | null;
  commit: string | null;
  packaged: boolean;
  elevated: boolean;
  baseUrl: string;
  userData: string;
  tunnelName: string;
  serviceName: string;
  firewallGroup: string;
  verbose: boolean;
  loggedIn: boolean;
};

export type ApiLogEntry = {
  id: number;
  at: number;
  method: string;
  route: string;
  status: number | null;
  durationMs: number;
  code?: ErrorCode;
  apiCode?: string;
};

export type HealthCheck = {
  baseUrl: string;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  nodes: number | null;
  error: string | null;
  checkedAt: number;
};

export type DebugBridge = {
  info: () => Promise<DebugInfo>;
  requestLog: () => Promise<ApiLogEntry[]>;
  clearRequestLog: () => Promise<void>;
  healthCheck: () => Promise<HealthCheck>;
  setVerbose: (enabled: boolean) => Promise<DebugInfo>;
  copyDiagnostics: () => Promise<Result<string>>;
  resetLocalData: () => Promise<Result<null>>;
  openDevTools: () => Promise<void>;
};

export const SUPPORT_CATEGORIES = ["connection", "account", "payment", "app", "other"] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_MAX_CHARS = 4000;
export type SupportTicketSummary = {
  id: string;
  number: number;
  category: SupportCategory;
  status: "open" | "waiting" | "closed";
  title: string | null;
  readable: boolean;
  unread: number;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  lastActor: "user" | "team";
  messageCount: number;
};
export type SupportMessage = { seq: number; role: "user" | "team"; text: string | null; createdAt: number };
export type SupportThread = SupportTicketSummary & { messages: SupportMessage[] };
export type SupportOverview = { available: boolean; unread: number; tickets: SupportTicketSummary[] };

export const LOGIN_CLIENTS = ["browser", "windows", "macos", "android", "cli", "app"] as const;
export type LoginClient = (typeof LOGIN_CLIENTS)[number];
export const LOGIN_METHODS = ["code", "passkey"] as const;
export type LoginMethod = (typeof LOGIN_METHODS)[number];
export type PendingLogin = { client: LoginClient; method: LoginMethod };
export type LoginOverview = { logins: PendingLogin[] };

export type MantelBridge = {
  environment: () => Promise<Environment>;
  session: () => Promise<SessionInfo>;
  login: (code: string, totp?: string) => Promise<Result<SessionInfo>>;
  register?: (referralCode?: string) => Promise<Result<Registration>>;
  confirmRegistration?: () => Promise<Result<SessionInfo>>;
  logout: () => Promise<Result<null>>;
  account: () => Promise<Result<Account>>;
  nodes: () => Promise<Result<VpnNode[]>>;
  updateSettings: (patch: SettingsPatch) => Promise<Result<AccountSettings>>;
  connect: (nodeId: string) => Promise<Result<TunnelStatus>>;
  disconnect: () => Promise<Result<TunnelStatus>>;
  tunnelStatus: () => Promise<TunnelStatus>;
  preferences: () => Promise<Preferences>;
  setAlwaysOnKillSwitch: (enabled: boolean) => Promise<Result<Preferences>>;
  selectNode: (nodeId: string) => Promise<Result<Preferences>>;
  openWireGuardDownload: () => Promise<void>;
  installWireGuard: () => Promise<Result<{ version: string }>>;
  onTunnelStatus: (listener: (status: TunnelStatus) => void) => () => void;
  onSessionEnded: (listener: () => void) => () => void;
  systemVpnState?: () => Promise<SystemVpnState>;
  openSystemVpnSettings?: () => Promise<void>;
  installedApps?: () => Promise<InstalledApp[]>;
  excludedApps?: () => Promise<string[]>;
  setExcludedApps?: (packages: string[]) => Promise<Result<string[]>>;
  appIcon?: () => Promise<AppIcon>;
  setAppIcon?: (icon: AppIcon) => Promise<Result<AppIcon>>;
  setLanguage?: (language: LanguagePreference) => Promise<Result<Preferences>>;
  setTheme?: (theme: ThemePreference) => Promise<Result<Preferences>>;
  setPostQuantum?: (enabled: boolean) => Promise<Result<Preferences>>;
  wifiSecurity?: () => Promise<WifiSecurity>;
  setAutoConnectOpenWifi?: (enabled: boolean) => Promise<Result<Preferences>>;
  setObfuscation?: (mode: ObfuscationMode) => Promise<Result<Preferences>>;
  autostart?: () => Promise<AutostartState>;
  setAutostart?: (enabled: boolean) => Promise<Result<AutostartState>>;
  setConnectOnLaunch?: (enabled: boolean) => Promise<Result<Preferences>>;
  setQuitAction?: (action: QuitAction) => Promise<Result<Preferences>>;
  onSystemThemeChange?: (listener: (theme: Theme) => void) => () => void;
  copyText?: (text: string) => Promise<Result<null>>;
  openAccountPage?: () => Promise<Result<null>>;
  checkAppVersion?: () => Promise<Result<AppVersionInfo>>;
  openDownloadPage?: () => Promise<Result<null>>;
  measureLatency?: (nodeIds: string[]) => Promise<LatencyMeasurement[]>;
  portForwarding?: () => Promise<Result<PortForwardingState | null>>;
  setPortForwarding?: (enabled: boolean) => Promise<Result<PortForwardingState | null>>;
  tor?: () => Promise<Result<TorState | null>>;
  setTor?: (enabled: boolean) => Promise<Result<TorState | null>>;
  deviceKey?: () => Promise<Result<DeviceKeyInfo | null>>;
  rotateDeviceKey?: () => Promise<Result<DeviceKeyInfo | null>>;
  supportOverview?: () => Promise<Result<SupportOverview>>;
  supportUnread?: () => Promise<Result<{ available: boolean; unread: number }>>;
  supportTicket?: (id: string) => Promise<Result<SupportThread>>;
  supportCreate?: (category: SupportCategory, text: string) => Promise<Result<{ id: string; number: number }>>;
  supportReply?: (id: string, text: string) => Promise<Result<SupportThread>>;
  supportSetClosed?: (id: string, closed: boolean) => Promise<Result<SupportThread>>;
  currentDeviceId?: () => Promise<string | null>;
  renameDevice?: (id: string, name: string) => Promise<Result<Device>>;
  removeDevice?: (id: string) => Promise<Result<null>>;
  devicePortForwarding?: (deviceId: string) => Promise<Result<PortForwardingState | null>>;
  addPortForward?: (deviceId: string, localPort?: number | null) => Promise<Result<PortForwardingState | null>>;
  setPortForwardLocalPort?: (deviceId: string, port: number, localPort: number | null) => Promise<Result<PortForwardingState | null>>;
  removePortForward?: (deviceId: string, port: number) => Promise<Result<PortForwardingState | null>>;
  proxies?: () => Promise<Result<ServerProxy[] | null>>;
  createProxy?: (input: ProxyCreate) => Promise<Result<ProxyWithPassword>>;
  updateProxy?: (id: string, patch: ProxyPatch) => Promise<Result<ProxyWithPassword>>;
  deleteProxy?: (id: string) => Promise<Result<null>>;
  openTelegramProxy?: (link: string) => Promise<Result<null>>;
  recentLogins?: () => Promise<Result<LoginOverview>>;
  markLoginsSeen?: () => Promise<Result<null>>;
  logoutOtherSessions?: () => Promise<Result<null>>;
  openSecurityPage?: () => Promise<Result<null>>;
  debug?: DebugBridge;
  openDebugMenu?: () => void;
};

export const IPC = {
  environment: "mantel:environment",
  session: "mantel:session",
  login: "mantel:login",
  register: "mantel:register",
  confirmRegistration: "mantel:confirm-registration",
  logout: "mantel:logout",
  account: "mantel:account",
  nodes: "mantel:nodes",
  updateSettings: "mantel:update-settings",
  connect: "mantel:connect",
  disconnect: "mantel:disconnect",
  tunnelStatus: "mantel:tunnel-status",
  preferences: "mantel:preferences",
  setAlwaysOnKillSwitch: "mantel:set-always-on",
  selectNode: "mantel:select-node",
  setLanguage: "mantel:set-language",
  setTheme: "mantel:set-theme",
  setPostQuantum: "mantel:set-post-quantum",
  wifiSecurity: "mantel:wifi-security",
  setAutoConnectOpenWifi: "mantel:set-auto-connect-open-wifi",
  setObfuscation: "mantel:set-obfuscation",
  autostart: "mantel:autostart",
  setAutostart: "mantel:set-autostart",
  setConnectOnLaunch: "mantel:set-connect-on-launch",
  setQuitAction: "mantel:set-quit-action",
  openWireGuardDownload: "mantel:open-wireguard-download",
  installWireGuard: "mantel:install-wireguard",
  copyText: "mantel:copy-text",
  openAccountPage: "mantel:open-account-page",
  checkAppVersion: "mantel:check-app-version",
  openDownloadPage: "mantel:open-download-page",
  measureLatency: "mantel:measure-latency",
  portForwarding: "mantel:port-forwarding",
  setPortForwarding: "mantel:set-port-forwarding",
  tor: "mantel:tor",
  setTor: "mantel:set-tor",
  deviceKey: "mantel:device-key",
  rotateDeviceKey: "mantel:rotate-device-key",
  currentDeviceId: "mantel:current-device-id",
  renameDevice: "mantel:rename-device",
  removeDevice: "mantel:remove-device",
  devicePortForwarding: "mantel:device-port-forwarding",
  addPortForward: "mantel:add-port-forward",
  removePortForward: "mantel:remove-port-forward",
  setPortForwardLocalPort: "mantel:set-port-forward-local-port",
  proxies: "mantel:proxies",
  createProxy: "mantel:create-proxy",
  updateProxy: "mantel:update-proxy",
  deleteProxy: "mantel:delete-proxy",
  openTelegramProxy: "mantel:open-telegram-proxy",
  supportOverview: "mantel:support-overview",
  supportUnread: "mantel:support-unread",
  supportTicket: "mantel:support-ticket",
  supportCreate: "mantel:support-create",
  supportReply: "mantel:support-reply",
  supportSetClosed: "mantel:support-set-closed",
  recentLogins: "mantel:recent-logins",
  markLoginsSeen: "mantel:mark-logins-seen",
  logoutOtherSessions: "mantel:logout-other-sessions",
  openSecurityPage: "mantel:open-security-page",
  tunnelStatusEvent: "mantel:tunnel-status-event",
  sessionEndedEvent: "mantel:session-ended-event",
  systemThemeEvent: "mantel:system-theme-event",
} as const;

export const ACCOUNT_PAGE_PATH = "/dashboard/abo";
export const SECURITY_PAGE_PATH = "/dashboard/konto";

export function downloadPageUrl(baseUrl: string): string {
  return new URL(DOWNLOAD_PAGE_PATH, baseUrl).toString();
}

export function accountPageUrl(baseUrl: string): string {
  return new URL(ACCOUNT_PAGE_PATH, baseUrl).toString();
}

export function securityPageUrl(baseUrl: string): string {
  return new URL(SECURITY_PAGE_PATH, baseUrl).toString();
}
export const WIREGUARD_DOWNLOAD_URL = "https://www.wireguard.com/install/";
export const TUNNEL_NAME = "mantel";
export const STALE_HANDSHAKE_MS = 180_000;

export const PQ_ADDRESS = "10.8.255.1";
export const PQ_PORT = 1337;

export const PQ_ERROR_CODES = ["pq_unsupported", "pq_failed", "pq_mismatch", "pq_not_active"] as const;
export type PqErrorCode = (typeof PQ_ERROR_CODES)[number];
