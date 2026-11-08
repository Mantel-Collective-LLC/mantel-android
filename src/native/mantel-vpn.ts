import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { AppIcon, LanguagePreference, ObfuscationMode, QuantumState, Theme, ThemePreference } from "@shared/contract";

export type NativeTunnelState = "down" | "connecting" | "up";

export type NativeTunnelStatus = {
  state: NativeTunnelState;
  nodeId: string | null;
  startedAt: number | null;
  lastHandshakeAt: number | null;
  rxBytes: number;
  txBytes: number;
  endpoint: string | null;
  error: string | null;
  errorCode?: string | null;
  quantum?: QuantumState;
  obfuscated?: boolean;
};

export type NativeObfuscation = { host: string; port: number; pin: string; token: string };

export type NativeInstalledApp = { packageName: string; label: string; system: boolean; icon: string | null };

export interface MantelVpnPlugin {
  prepare(): Promise<{ granted: boolean }>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  start(options: {
    config: string;
    nodeId: string;
    label: string;
    excludedApps: string[];
    postQuantum?: boolean;
    obfuscation?: NativeObfuscation;
    api?: { baseUrl: string; token: string };
  }): Promise<NativeTunnelStatus>;
  stop(): Promise<NativeTunnelStatus>;
  status(): Promise<NativeTunnelStatus>;
  generateKeyPair(): Promise<{ privateKey: string; publicKey: string }>;
  publicKeyFromPrivate(options: { privateKey: string }): Promise<{ publicKey: string }>;
  secureGet(options: { key: string }): Promise<{ value: string | null }>;
  secureSet(options: { key: string; value: string }): Promise<void>;
  secureRemove(options: { key: string }): Promise<void>;
  clearSavedTunnel(): Promise<void>;
  systemVpnState(): Promise<{ supported: boolean; alwaysOn: boolean; lockdown: boolean }>;
  openVpnSettings(): Promise<void>;
  wifiState?(): Promise<{ security: string; autoConnect: boolean }>;
  setAutoConnectOpenWifi?(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  obfuscation?(): Promise<{ mode: ObfuscationMode }>;
  setObfuscation?(options: { mode: ObfuscationMode }): Promise<{ mode: ObfuscationMode }>;
  bypassFetch?(options: {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
  }): Promise<{ status: number; body: string; contentType: string | null }>;
  measureLatency?(options: {
    targets: { id: string; host: string; port: number }[];
  }): Promise<{ results: { id: string; samples: (number | null)[] }[] }>;
  openUrl?(options: { url: string }): Promise<void>;
  installedApps(): Promise<{ apps: NativeInstalledApp[] }>;
  appInfo(): Promise<{
    versionName: string;
    packageName: string;
    sdkInt: number;
    model?: string;
    versionCode?: number;
    debuggable?: boolean;
    webViewVersion?: string | null;
  }>;
  appIcon(): Promise<{ icon: AppIcon }>;
  setAppIcon(options: { icon: AppIcon }): Promise<{ icon: AppIcon }>;
  locales?(): Promise<{ system: string[]; app: string | null }>;
  setAppLanguage?(options: { language: LanguagePreference }): Promise<{ app: string | null }>;
  setAppTheme?(options: { theme: ThemePreference }): Promise<{ theme: Theme }>;
  addListener(event: "status", listener: (status: NativeTunnelStatus) => void): Promise<PluginListenerHandle>;
  addListener(event: "systemTheme", listener: (event: { theme: Theme }) => void): Promise<PluginListenerHandle>;
}

export const MantelVpn = registerPlugin<MantelVpnPlugin>("MantelVpn");
