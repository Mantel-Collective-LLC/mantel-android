import { version as packageVersion } from "../../package.json";
import type {
  Account,
  AccountSettings,
  AppIcon,
  Device,
  DeviceKeyInfo,
  ErrorCode,
  InstalledApp,
  ObfuscationMode,
  LoginOverview,
  PortForwardingState,
  Preferences,
  ProxyCreate,
  ProxyPatch,
  ProxyWithPassword,
  ServerProxy,
  SessionInfo,
  SettingsPatch,
  SystemVpnState,
  WifiSecurity,
  TunnelStatus,
  VpnNode,
} from "@shared/contract";
import { evaluateUpdate, type AppVersionInfo } from "@shared/app-version";
import { keyCreatedAt, keyRotationDue, rotateWithPending } from "@shared/device-key";
import { MAX_PING_TARGETS, pingableNodes, type LatencyMeasurement } from "@shared/latency";
import { accountPageUrl, downloadPageUrl, OBFUSCATION_MODES, PQ_ERROR_CODES, securityPageUrl, torStateFor, type PqErrorCode, type TorState } from "@shared/contract";
import {
  DEFAULT_LANGUAGE_PREFERENCE,
  errorMessage,
  LANGUAGE_PREFERENCES,
  LocalizedError,
  localizedOf,
  resolveLanguage,
  type ErrorKey,
  type Language,
  type LanguagePreference,
  type Params,
} from "@shared/i18n";
import {
  checkAccount,
  checkDue,
  checkError,
  revocationVerdict,
  tunnelSettled,
  type DeviceCheck,
  type RevocationReason,
} from "@shared/revocation";
import { DEFAULT_THEME_PREFERENCE, THEME_PREFERENCES, type ThemePreference } from "@shared/theme";
import { z } from "zod";
import { API_BASE_URL, BUILD_FLAVOR, type Flavor } from "../flavor";
import { ApiClient, ApiError, type ApiRequestRecord, type FetchLike } from "../lib/api-client";
import {
  appIconSchema,
  packageNameSchema,
  storedDeviceIdsSchema,
  storedDeviceKeysSchema,
  storedDeviceMetaSchema,
  storedPendingRegistrationSchema,
  storedPreferencesSchema,
  storedRuntimeSchema,
  storedSessionSchema,
  storedSystemVpnSchema,
  excludedAppsSchema,
} from "../lib/schemas";
import { KEYS, SECURE_KEYS, readJson, type KeyValueStore } from "../lib/storage";
import {
  SupportKeyError,
  SupportService,
  deviceKeyFromPkcs8,
  describeSupportError,
  newDeviceKey,
  type DeviceKey,
  type SupportKeyStore,
} from "@shared/support";
import type { SupportCategory, SupportOverview, SupportThread } from "@shared/contract";
import { buildTunnelConfig, formatEndpoint, parseEndpoint, withServerKey, type ServerTunnelConfig } from "../lib/wireguard-config";
import type { MantelVpnPlugin, NativeObfuscation, NativeTunnelStatus } from "../native/mantel-vpn";
import { initialStatus, mapNativeStatus, type RuntimeState } from "./status";

export class VpnError extends LocalizedError {
  constructor(
    key: ErrorKey,
    readonly code: ErrorCode,
    params?: Params,
  ) {
    super(key, params);
  }
}

export class NativeError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
  ) {
    super(message);
  }
}

export const FALLBACK_VERSION = packageVersion;
const MAX_DEVICE_NAME = 32;
const languagePreferenceSchema = z.enum(LANGUAGE_PREFERENCES);
const themePreferenceSchema = z.enum(THEME_PREFERENCES);

export type Visibility = {
  visible(): boolean;
  subscribe(listener: () => void): () => void;
};

export type ControllerDeps = {
  vpn: MantelVpnPlugin;
  preferences: KeyValueStore;
  fetch: FetchLike;
  visibility: Visibility | null;
  now?: () => number;
  pollIntervalMs?: number;
  randomSuffix?: () => string;
  requestTimeoutMs?: number;
  logoutCallTimeoutMs?: number;
  logoutBudgetMs?: number;
  systemLocales?: () => readonly string[];
  flavor?: Flavor;
  baseUrl?: string;
  onApiRequest?: (record: ApiRequestRecord) => void;
  bypassFetch?: FetchLike | null;
};

const REVOCATION_KEYS: Record<RevocationReason, ErrorKey> = {
  device_removed: "deviceRemoved",
  account_locked: "accountLockedTunnel",
  session_ended: "sessionEndedTunnel",
  tunnel_dead: "tunnelDead",
};

export function bypassFetchOf(vpn: MantelVpnPlugin, timeoutMs = 10_000): FetchLike | null {
  if (typeof vpn.bypassFetch !== "function") return null;
  return async (input, init) => {
    if ((init.method ?? "GET").toUpperCase() !== "GET") throw new TypeError("bypassFetch: GET only");
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const result = await vpn.bypassFetch!({ url: input, headers, timeoutMs });
    if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status > 599) {
      throw new TypeError("bypassFetch: no response");
    }
    const noBody = result.status === 204 || result.status === 205 || result.status === 304;
    return new Response(noBody ? null : typeof result.body === "string" ? result.body : "", {
      status: result.status,
      headers: result.contentType ? { "content-type": result.contentType } : {},
    });
  };
}

type PendingRegistration = { code: string; token: string; accountId: string; paidUntil: string };

export type ControllerDiagnostics = {
  flavor: Flavor;
  baseUrl: string;
  version: string;
  language: Language;
  encryptionAvailable: boolean;
  session: { loggedIn: boolean; accountId: string | null; paidUntil: string | null; pendingRegistration: boolean };
  device: { id: string; nodeId: string; keySource: "local" | "server"; hasPrivateKey: boolean; endpoint: string } | null;
  staleDevices: number;
  excludedApps: number;
  status: TunnelStatus;
  systemVpn: { alwaysOn: boolean; lockdown: boolean } | null;
};

type Session = { token: string | null; accountId: string | null; paidUntil: string | null };

type StoredDevice = {
  id: string;
  nodeId: string;
  publicKey: string | null;
  privateKey: string | null;
  keySource: "local" | "server";
  config: ServerTunnelConfig;
  keyCreatedAt?: number;
  pendingKey?: { publicKey: string; privateKey: string } | null;
  obfsToken?: string;
};

type ActiveTunnel = {
  config: string;
  nodeId: string;
  label: string;
  postQuantum: boolean;
  obfuscation?: NativeObfuscation;
  api?: { baseUrl: string; token: string };
};

const PQ_ERROR_KEYS: Record<PqErrorCode, ErrorKey> = {
  pq_unsupported: "pqUnsupported",
  pq_failed: "pqFailed",
  pq_mismatch: "pqMismatch",
  pq_not_active: "pqNotActive",
};

export function pqStartError(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && (PQ_ERROR_CODES as readonly string[]).includes(code)) {
    const pq = code as PqErrorCode;
    return new VpnError(PQ_ERROR_KEYS[pq], pq);
  }
  return error;
}

const EMPTY_SESSION: Session = { token: null, accountId: null, paidUntil: null };

export function messageOf(error: unknown, language: Language): string {
  return errorMessage(error, language);
}

function reasonOf(error: unknown): Params[string] {
  const localized = localizedOf(error);
  if (localized) return localized;
  return error instanceof Error && error.message ? error.message : String(error);
}

function browserLocales(): string[] {
  if (typeof navigator === "undefined") return [];
  const list = navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
  return [...list];
}

function preferenceOfAppLocale(tag: string | null): LanguagePreference {
  const language = tag?.trim().toLowerCase().split(/[-_]/)[0];
  return language === "de" || language === "en" ? language : DEFAULT_LANGUAGE_PREFERENCE;
}

function deviceLimitReached(error: ApiError): boolean {
  return error.apiCode !== undefined ? error.apiCode === "device_limit_reached" : error.status === 409;
}

export function codeOf(error: unknown): ErrorCode {
  if (error instanceof VpnError || error instanceof ApiError || error instanceof NativeError) return error.code;
  return "internal";
}

const INVISIBLE = new RegExp("[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]", "g");

function cleanText(value: string): string {
  return value.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

function defaultRandomSuffix(): string {
  const bytes = new Uint8Array(2);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export class AndroidVpnController {
  private status: TunnelStatus;
  private readonly statusListeners = new Set<(status: TunnelStatus) => void>();
  private readonly sessionListeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private operation: "connecting" | "disconnecting" | null = null;
  private polling = false;
  private lastSettings: AccountSettings | null = null;
  private session: Session = { ...EMPTY_SESSION };
  private device: StoredDevice | null = null;
  private prefs: { baseUrl: string; lastNodeId: string | null; postQuantum?: boolean } = { baseUrl: API_BASE_URL, lastNodeId: null };
  private runtime: RuntimeState | null = null;
  private excluded: string[] = [];
  private staleDevices: string[] = [];
  private lastSystemVpn: { alwaysOn: boolean; lockdown: boolean } | null = null;
  private autoConnectOpenWifi = false;
  private obfuscationMode: ObfuscationMode | null = null;
  private secureAvailable = true;
  private appVersion = FALLBACK_VERSION;
  private deviceModel: string | null = null;
  private notificationsAsked = false;
  private languagePref: LanguagePreference = DEFAULT_LANGUAGE_PREFERENCE;
  private themePref: ThemePreference = DEFAULT_THEME_PREFERENCE;
  private systemLocaleList: string[] = [];
  private localeRefresh: Promise<void> | null = null;
  private activeTunnel: ActiveTunnel | null = null;
  private pending: PendingRegistration | null = null;
  private ignoredNativeError: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastRevocationCheck: number | null = null;
  private revocationRunning = false;
  private tunnelGeneration = 0;
  private readonly bypassApi: ApiClient | null;
  private readonly cleanups: Array<() => void> = [];
  private readonly vpn: MantelVpnPlugin;
  private readonly kv: KeyValueStore;
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly randomSuffix: () => string;
  private readonly logoutCallTimeoutMs: number;
  private readonly logoutBudgetMs: number;
  readonly api: ApiClient;
  readonly support: SupportService;
  private updateRequired = false;
  readonly ready: Promise<void>;
  readonly flavor: Flavor;
  private readonly fixedBaseUrl: string;

  constructor(private readonly deps: ControllerDeps) {
    this.vpn = deps.vpn;
    this.kv = deps.preferences;
    this.now = deps.now ?? Date.now;
    this.pollIntervalMs = deps.pollIntervalMs ?? 2000;
    this.randomSuffix = deps.randomSuffix ?? defaultRandomSuffix;
    this.logoutCallTimeoutMs = deps.logoutCallTimeoutMs ?? 5000;
    this.logoutBudgetMs = deps.logoutBudgetMs ?? 10_000;
    this.status = initialStatus(this.now());
    this.flavor = deps.flavor ?? BUILD_FLAVOR;
    this.fixedBaseUrl = deps.baseUrl ?? API_BASE_URL;
    this.prefs = { baseUrl: this.fixedBaseUrl, lastNodeId: null };
    const apiOptions = {
      baseUrl: () => this.baseUrl,
      token: () => this.session.token,
      userAgent: () => `MantelAndroid/${this.appVersion} (Android)`,
      timeoutMs: deps.requestTimeoutMs,
      language: () => this.language(),
      debug: this.flavor === "debug",
      onRequest: deps.onApiRequest,
      now: this.now,
    };
    this.api = new ApiClient({ ...apiOptions, fetch: deps.fetch });
    this.support = new SupportService({ transport: this.api.tickets, keys: this.ticketKeyStore(), platform: "android", now: this.now });
    const bypass = deps.bypassFetch === undefined ? bypassFetchOf(deps.vpn) : deps.bypassFetch;
    this.bypassApi = bypass ? new ApiClient({ ...apiOptions, fetch: bypass }) : null;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const [prefs, deviceMeta, runtime, excluded, stale, systemVpn, language, theme] = await Promise.all([
      readJson(() => this.kv.get({ key: KEYS.preferences }), storedPreferencesSchema),
      readJson(() => this.kv.get({ key: KEYS.device }), storedDeviceMetaSchema),
      readJson(() => this.kv.get({ key: KEYS.runtime }), storedRuntimeSchema),
      readJson(() => this.kv.get({ key: KEYS.excludedApps }), excludedAppsSchema),
      readJson(() => this.kv.get({ key: KEYS.staleDevices }), storedDeviceIdsSchema),
      readJson(() => this.kv.get({ key: KEYS.systemVpn }), storedSystemVpnSchema),
      readJson(() => this.kv.get({ key: KEYS.language }), languagePreferenceSchema),
      readJson(() => this.kv.get({ key: KEYS.theme }), themePreferenceSchema),
    ]);
    if (language) this.languagePref = language;
    if (theme) this.themePref = theme;
    this.lastSystemVpn = systemVpn;
    this.autoConnectOpenWifi = (await this.vpn.wifiState?.().catch(() => null))?.autoConnect === true;
    if (this.vpn.obfuscation) {
      const mode = (await this.vpn.obfuscation().catch(() => null))?.mode;
      this.obfuscationMode = mode && (OBFUSCATION_MODES as readonly string[]).includes(mode) ? mode : "auto";
    }
    if (prefs) {
      this.prefs = { ...prefs, baseUrl: this.fixedBaseUrl };
      if (prefs.baseUrl !== this.fixedBaseUrl) await this.savePrefs();
    }
    this.runtime = runtime;
    this.excluded = excluded ?? [];
    this.staleDevices = stale ?? [];

    let sessionRaw: string | null = null;
    let keysRaw: string | null = null;
    let pendingRaw: string | null = null;
    try {
      sessionRaw = (await this.vpn.secureGet({ key: SECURE_KEYS.session })).value;
      keysRaw = (await this.vpn.secureGet({ key: SECURE_KEYS.deviceKeys })).value;
      pendingRaw = (await this.vpn.secureGet({ key: SECURE_KEYS.pendingRegistration })).value;
    } catch {
      this.secureAvailable = false;
    }
    this.pending = await readJson(async () => ({ value: pendingRaw }), storedPendingRegistrationSchema);
    const session = await readJson(async () => ({ value: sessionRaw }), storedSessionSchema);
    if (session) this.session = session;
    const keys = await readJson(async () => ({ value: keysRaw }), storedDeviceKeysSchema);
    if (deviceMeta) {
      this.device = {
        ...deviceMeta,
        privateKey: keys?.privateKey ?? null,
        pendingKey: keys?.pendingKey ?? null,
        config: { ...deviceMeta.config, ...(keys?.presharedKey ? { presharedKey: keys.presharedKey } : {}) },
      };
    }

    try {
      const info = await this.vpn.appInfo();
      if (typeof info.versionName === "string" && info.versionName) this.appVersion = info.versionName.slice(0, 64);
      if (typeof info.model === "string") this.deviceModel = cleanText(info.model) || null;
    } catch {
    }

    try {
      const handle = await this.vpn.addListener("status", (native) => this.onNativeStatus(native));
      this.cleanups.push(() => void handle.remove());
    } catch {
    }

    await this.refreshLanguage();

    await this.refreshStatus();
    this.startPolling();
  }

  private startPolling(): void {
    const visibility = this.deps.visibility;
    if (!visibility) return;
    const stop = () => {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
    };
    const start = () => {
      stop();
      this.pollTimer = setInterval(() => void this.refreshStatus(), this.pollIntervalMs);
    };
    if (visibility.visible()) start();
    this.cleanups.push(
      visibility.subscribe(() => {
        if (visibility.visible()) {
          this.lastRevocationCheck = null;
          void this.refreshStatus();
          start();
        } else {
          stop();
        }
      }),
    );
    this.cleanups.push(stop);
  }

  dispose(): void {
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
  }

  getStatus(): TunnelStatus {
    return this.status;
  }

  onStatus(listener: (status: TunnelStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onSessionEnded(listener: () => void): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  private emitStatus(): void {
    for (const listener of this.statusListeners) {
      try {
        listener(this.status);
      } catch {
      }
    }
  }

  private publish(patch: Partial<TunnelStatus>): void {
    this.status = { ...this.status, ...patch, firewallActive: false, checkedAt: this.now() };
    this.emitStatus();
  }

  private publishNative(native: NativeTunnelStatus): void {
    const visibleError = native.error && native.error !== this.ignoredNativeError ? native.error : null;
    const next = mapNativeStatus({ ...native, error: visibleError }, this.runtime, this.now());
    if (next.phase === "disconnected") {
      if (next.error === null) next.error = this.status.error;
      if (this.status.revoked) next.revoked = this.status.revoked;
    }
    this.status = next;
    this.emitStatus();
  }

  private onNativeStatus(native: NativeTunnelStatus): void {
    if (this.operation || !native || typeof native !== "object") return;
    this.publishNative(native);
  }

  async refreshStatus(): Promise<void> {
    if (this.polling || this.operation) return;
    this.polling = true;
    try {
      const native = await this.vpn.status();
      if (!this.operation) this.publishNative(native);
    } catch {
    } finally {
      this.polling = false;
    }
    this.maybeCheckRevocation();
  }

  private maybeCheckRevocation(): void {
    if (this.revocationRunning || this.operation) return;
    if (!checkDue({ status: this.status, lastCheckAt: this.lastRevocationCheck, now: this.now() })) return;
    void this.checkRevocation().catch(() => undefined);
  }

  private leakProtected(): boolean {
    return this.status.leakProtection !== "none" || this.lastSettings?.killSwitch === true || this.lastSystemVpn?.lockdown === true;
  }

  async checkRevocation(): Promise<RevocationReason | null> {
    if (this.revocationRunning || this.operation || !tunnelSettled(this.status)) return null;
    this.revocationRunning = true;
    this.lastRevocationCheck = this.now();
    const generation = this.tunnelGeneration;
    const device = this.device;
    try {
      let check: DeviceCheck;
      if (!this.session.token) {
        check = "session_ended";
      } else if (!device || (this.status.nodeId !== null && device.nodeId !== this.status.nodeId)) {
        check = "unknown";
      } else {
        const api = this.status.phase === "stale" && this.bypassApi ? this.bypassApi : this.api;
        try {
          const account = await this.authed(() => api.account());
          check = checkAccount(account, device.id, this.now());
        } catch (error) {
          check = checkError(error);
        }
      }
      return await this.applyRevocation(check, generation);
    } finally {
      this.revocationRunning = false;
    }
  }

  private noteAccount(account: Account, generation: number, deviceId: string | null): void {
    if (!deviceId || this.device?.id !== deviceId) return;
    const check = checkAccount(account, deviceId, this.now());
    if (check === "present") return;
    void this.applyRevocation(check, generation).catch(() => undefined);
  }

  private async applyRevocation(check: DeviceCheck, generation: number): Promise<RevocationReason | null> {
    if (generation !== this.tunnelGeneration || this.operation) return null;
    const verdict = revocationVerdict({ check, status: this.status, now: this.now(), leakProtected: this.leakProtected() });
    if (!verdict) return null;
    await this.endRevokedTunnel(verdict, generation);
    return verdict;
  }

  private endRevokedTunnel(reason: RevocationReason, generation: number): Promise<void> {
    return this.serialize(async () => {
      if (generation !== this.tunnelGeneration || !tunnelSettled(this.status)) return;
      this.tunnelGeneration += 1;
      this.operation = "disconnecting";
      this.publish({ phase: "disconnecting", error: null });
      const forget = reason !== "tunnel_dead";
      let native: NativeTunnelStatus | null = null;
      try {
        if (forget) await this.vpn.clearSavedTunnel();
        native = await this.vpn.stop();
      } catch {
        native = await this.vpn.status().catch(() => null);
      }
      this.operation = null;
      this.activeTunnel = null;
      if (reason === "device_removed" && this.device) {
        this.device = null;
        await this.saveDevice();
      }
      this.ignoredNativeError = native?.error ?? null;
      const message = this.describe(new VpnError(REVOCATION_KEYS[reason], "server"));
      this.status = { ...this.status, error: message, revoked: reason };
      if (native) this.publishNative({ ...native, error: null });
      this.publish({ error: message, revoked: reason });
    });
  }

  private tunnelNodeId(): string | null {
    if (this.status.phase === "disconnected") return null;
    return this.status.nodeId ?? this.runtime?.nodeId ?? null;
  }

  private async secureWrite(key: string, value: string | null): Promise<void> {
    try {
      if (value === null) await this.vpn.secureRemove({ key });
      else await this.vpn.secureSet({ key, value });
    } catch {
      this.secureAvailable = false;
    }
  }

  private async kvWrite(key: string, value: unknown): Promise<void> {
    try {
      if (value === null) await this.kv.remove({ key });
      else await this.kv.set({ key, value: JSON.stringify(value) });
    } catch {
    }
  }

  private saveSession(): Promise<void> {
    const empty = this.session.token === null && this.session.accountId === null;
    return this.secureWrite(SECURE_KEYS.session, empty ? null : JSON.stringify(this.session));
  }

  private async saveDevice(): Promise<void> {
    const device = this.device;
    if (!device) {
      await this.secureWrite(SECURE_KEYS.deviceKeys, null);
      await this.kvWrite(KEYS.device, null);
      return;
    }
    const { presharedKey, ...config } = device.config;
    if (device.privateKey) {
      await this.secureWrite(
        SECURE_KEYS.deviceKeys,
        JSON.stringify({ privateKey: device.privateKey, presharedKey: presharedKey ?? null, ...(device.pendingKey ? { pendingKey: device.pendingKey } : {}) }),
      );
    }
    await this.kvWrite(KEYS.device, {
      id: device.id,
      nodeId: device.nodeId,
      publicKey: device.publicKey,
      keySource: device.keySource,
      config,
      ...(device.keyCreatedAt === undefined ? {} : { keyCreatedAt: device.keyCreatedAt }),
    });
  }

  private savePrefs(): Promise<void> {
    return this.kvWrite(KEYS.preferences, this.prefs);
  }

  get encryptionAvailable(): boolean {
    return this.secureAvailable;
  }

  get version(): string {
    return this.appVersion;
  }

  get baseUrl(): string {
    return this.fixedBaseUrl;
  }

  preferences(): Preferences {
    return {
      baseUrl: this.baseUrl,
      alwaysOnKillSwitch: false,
      lastNodeId: this.prefs.lastNodeId,
      language: this.languagePref,
      theme: this.themePref,
      postQuantum: this.postQuantum,
      autoConnectOpenWifi: this.autoConnectOpenWifi,
      ...(this.obfuscationMode ? { obfuscation: this.obfuscationMode } : {}),
    };
  }

  async wifiSecurity(): Promise<WifiSecurity> {
    const security = (await this.vpn.wifiState?.().catch(() => null))?.security;
    return security === "open" || security === "secured" || security === "none" ? security : "unknown";
  }

  async setAutoConnectOpenWifi(enabled: boolean): Promise<Preferences> {
    if (!this.vpn.setAutoConnectOpenWifi) throw new Error("setAutoConnectOpenWifi unavailable");
    this.autoConnectOpenWifi = (await this.vpn.setAutoConnectOpenWifi({ enabled })).enabled === true;
    return this.preferences();
  }

  setObfuscation(mode: ObfuscationMode): Promise<Preferences> {
    return this.serialize(async () => {
      if (!this.vpn.setObfuscation) throw new Error("setObfuscation unavailable");
      const changed = this.obfuscationMode !== mode;
      this.obfuscationMode = (await this.vpn.setObfuscation({ mode })).mode;
      const nodeId = this.tunnelNodeId();
      if (changed && nodeId) {
        void this.connect(nodeId).catch((error: unknown) => this.publish({ error: this.describe(error) }));
      }
      return this.preferences();
    });
  }

  get postQuantum(): boolean {
    return this.prefs.postQuantum === true;
  }

  setPostQuantum(enabled: boolean): Promise<Preferences> {
    return this.serialize(async () => {
      const changed = this.postQuantum !== enabled;
      this.prefs = { ...this.prefs, postQuantum: enabled };
      await this.savePrefs();
      const nodeId = this.tunnelNodeId();
      if (changed && nodeId) {
        void this.connect(nodeId).catch((error: unknown) => this.publish({ error: this.describe(error) }));
      }
      return this.preferences();
    });
  }

  async setTheme(theme: ThemePreference): Promise<Preferences> {
    this.themePref = theme;
    await this.kvWrite(KEYS.theme, theme === DEFAULT_THEME_PREFERENCE ? null : theme);
    try {
      await this.vpn.setAppTheme?.({ theme });
    } catch {
    }
    return this.preferences();
  }

  language(): Language {
    return resolveLanguage(this.languagePref);
  }

  describe(error: unknown): string {
    return messageOf(error, this.language());
  }

  get systemLocales(): readonly string[] {
    return this.systemLocaleList;
  }

  refreshLanguage(): Promise<void> {
    this.localeRefresh ??= this.readLocales().finally(() => {
      this.localeRefresh = null;
    });
    return this.localeRefresh;
  }

  private async readLocales(): Promise<void> {
    let info: { system: string[]; app: string | null } | null = null;
    try {
      const raw = await this.vpn.locales?.();
      if (raw && Array.isArray(raw.system)) {
        info = {
          system: raw.system.filter((tag): tag is string => typeof tag === "string" && tag.length > 0).slice(0, 16),
          app: typeof raw.app === "string" && raw.app ? raw.app : null,
        };
      }
    } catch {
    }
    const override = this.deps.systemLocales?.();
    this.systemLocaleList = override ? [...override] : info?.system.length ? info.system : browserLocales();
    if (!info) return;
    const native = preferenceOfAppLocale(info.app);
    if (native !== this.languagePref) {
      this.languagePref = native;
      await this.kvWrite(KEYS.language, native === DEFAULT_LANGUAGE_PREFERENCE ? null : native);
    }
  }

  async setLanguage(choice: LanguagePreference): Promise<Preferences> {
    const language = resolveLanguage(choice);
    this.languagePref = language;
    await this.kvWrite(KEYS.language, language === DEFAULT_LANGUAGE_PREFERENCE ? null : language);
    try {
      await this.vpn.setAppLanguage?.({ language });
    } catch {
    }
    return this.preferences();
  }

  async selectNode(nodeId: string): Promise<Preferences> {
    this.prefs = { ...this.prefs, lastNodeId: nodeId };
    await this.savePrefs();
    return this.preferences();
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async authed<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof ApiError && error.sessionEnded && this.session.token) {
        this.session = { ...this.session, token: null };
        await this.saveSession();
        for (const listener of this.sessionListeners) {
          try {
            listener();
          } catch {
          }
        }
      }
      throw error;
    }
  }

  getSession(): SessionInfo {
    const { token, accountId, paidUntil } = this.session;
    return { loggedIn: token !== null, accountId: token ? accountId : null, paidUntil: token ? paidUntil : null };
  }

  login(code: string, totp?: string): Promise<SessionInfo> {
    return this.serialize(async () => {
      const response = await this.api.login(code, totp);
      const sameAccount = this.session.accountId === response.account.id;
      if (!sameAccount && this.device) await this.forgetTunnelAndDevice();
      this.session = { token: response.token, accountId: response.account.id, paidUntil: response.account.paidUntil };
      await this.saveSession();
      return this.getSession();
    });
  }

  register(referralCode?: string): Promise<{ code: string; accountId: string; paidUntil: string; referralDays: number | null }> {
    return this.serialize(async () => {
      const response = await this.api.register(referralCode);
      this.pending = {
        code: response.code,
        token: response.token,
        accountId: response.account.id,
        paidUntil: response.account.paidUntil,
      };
      await this.savePending();
      return { code: response.code, accountId: response.account.id, paidUntil: response.account.paidUntil, referralDays: response.referralDays ?? null };
    });
  }

  pendingRegistration(): { code: string; accountId: string; paidUntil: string } | null {
    const pending = this.pending;
    return pending ? { code: pending.code, accountId: pending.accountId, paidUntil: pending.paidUntil } : null;
  }

  confirmRegistration(): Promise<SessionInfo> {
    return this.serialize(async () => {
      const pending = this.pending;
      if (!pending) throw new VpnError("invalidInput", "invalid");
      if (this.session.accountId !== pending.accountId && this.device) await this.forgetTunnelAndDevice();
      this.session = { token: pending.token, accountId: pending.accountId, paidUntil: pending.paidUntil };
      await this.saveSession();
      this.pending = null;
      await this.savePending();
      return this.getSession();
    });
  }

  private savePending(): Promise<void> {
    return this.secureWrite(SECURE_KEYS.pendingRegistration, this.pending ? JSON.stringify(this.pending) : null);
  }

  private async forgetTunnelAndDevice(): Promise<void> {
    await this.vpn.clearSavedTunnel().catch(() => undefined);
    this.tunnelGeneration += 1;
    this.device = null;
    this.activeTunnel = null;
    this.runtime = null;
    this.staleDevices = [];
    this.lastSettings = null;
    await this.saveDevice();
    await this.kvWrite(KEYS.runtime, null);
    await this.kvWrite(KEYS.staleDevices, null);
    await this.refreshStatus();
  }

  private async bestEffort(call: () => Promise<unknown>, ms: number): Promise<boolean> {
    if (ms <= 0) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    });
    try {
      return await Promise.race([call().then(() => true, () => false), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  logout(): Promise<void> {
    return this.serialize(async () => {
      const failures: unknown[] = [];
      const token = this.session.token;
      const device = this.device;
      const deadline = this.now() + this.logoutBudgetMs;
      const budget = () => Math.min(this.logoutCallTimeoutMs, deadline - this.now());
      this.tunnelGeneration += 1;
      this.activeTunnel = null;
      let revoked = false;
      if (token) {
        await this.bestEffort(() => this.support.unregister(), budget());
        const stale = this.staleDevices.filter((id) => id !== device?.id);
        for (const id of stale) await this.bestEffort(() => this.api.deleteDevice(id), budget());
        const tunnelUp = this.status.phase !== "disconnected";
        const deviceDeleted = device ? await this.bestEffort(() => this.api.deleteDevice(device.id), budget()) : false;
        if (!(deviceDeleted && tunnelUp)) revoked = await this.bestEffort(() => this.api.logout(), budget());
      }
      try {
        await this.vpn.clearSavedTunnel();
      } catch (error) {
        failures.push(error);
      }
      try {
        const native = await this.vpn.stop();
        if (native?.state && native.state !== "down") failures.push(new LocalizedError("tunnelStillRunning"));
      } catch (error) {
        failures.push(error);
      }
      if (token && !revoked) await this.bestEffort(() => this.api.logout(), Math.max(budget(), 2000));
      this.session = { ...EMPTY_SESSION };
      if (this.pending) {
        this.pending = null;
        await this.savePending();
      }
      this.device = null;
      this.runtime = null;
      this.staleDevices = [];
      this.lastSettings = null;
      await this.secureWrite(SECURE_KEYS.session, null);
      await this.secureWrite(SECURE_KEYS.deviceKeys, null);
      await this.support.forget();
      await this.kvWrite(KEYS.device, null);
      await this.kvWrite(KEYS.runtime, null);
      await this.kvWrite(KEYS.staleDevices, null);
      this.ignoredNativeError = null;
      this.status = initialStatus(this.now());
      this.emitStatus();
      if (failures.length > 0) {
        throw new VpnError("logoutPartial", "internal", { reason: reasonOf(failures[0]) });
      }
    });
  }

  private ticketKeyStore(): SupportKeyStore {
    let cached: { pkcs8: string; key: DeviceKey } | null = null;
    return {
      load: async () => {
        let pkcs8: string | null = null;
        try {
          pkcs8 = (await this.vpn.secureGet({ key: SECURE_KEYS.ticketKey })).value ?? null;
        } catch {
          return null;
        }
        if (!pkcs8) {
          cached = null;
          return null;
        }
        if (cached?.pkcs8 === pkcs8) return cached.key;
        try {
          cached = { pkcs8, key: await deviceKeyFromPkcs8(pkcs8) };
          return cached.key;
        } catch {
          cached = null;
          return null;
        }
      },
      create: async () => {
        if (!this.secureAvailable) throw new SupportKeyError();
        const generated = await newDeviceKey(true);
        if (!generated.pkcs8) throw new SupportKeyError();
        try {
          await this.vpn.secureSet({ key: SECURE_KEYS.ticketKey, value: generated.pkcs8 });
        } catch {
          throw new SupportKeyError();
        }
        cached = { pkcs8: generated.pkcs8, key: await deviceKeyFromPkcs8(generated.pkcs8) };
        return cached.key;
      },
      clear: async () => {
        cached = null;
        await this.secureWrite(SECURE_KEYS.ticketKey, null);
      },
    };
  }

  private async supportCall<T>(task: () => Promise<T>): Promise<T> {
    return this.authed(async () => {
      try {
        return await task();
      } catch (error) {
        const failure = describeSupportError(error, { debug: this.flavor === "debug" });
        if (!failure) throw error;
        throw new ApiError(failure.message, failure.code, failure.status, {
          ...(failure.apiCode ? { apiCode: failure.apiCode } : {}),
          ...(failure.serverMessage ? { serverMessage: failure.serverMessage } : {}),
        });
      }
    });
  }

  supportOverview(): Promise<SupportOverview> {
    return this.supportCall(() => this.support.overview());
  }

  supportUnread(): Promise<{ available: boolean; unread: number }> {
    return this.supportCall(() => this.support.unread());
  }

  supportTicket(id: string): Promise<SupportThread> {
    return this.supportCall(() => this.support.ticket(id));
  }

  supportCreate(category: SupportCategory, text: string): Promise<{ id: string; number: number }> {
    return this.supportCall(() => this.support.create(category, text));
  }

  supportReply(id: string, text: string): Promise<SupportThread> {
    return this.supportCall(() => this.support.reply(id, text));
  }

  supportSetClosed(id: string, closed: boolean): Promise<SupportThread> {
    return this.supportCall(() => this.support.setClosed(id, closed));
  }

  async account(): Promise<Account> {
    const generation = this.tunnelGeneration;
    const deviceId = this.device?.id ?? null;
    const fetched = await this.authed(() => this.api.account());
    const own = fetched.devices.find((device) => device.id === deviceId);
    if (own?.obfsToken && this.device?.id === deviceId) this.device = { ...this.device, obfsToken: own.obfsToken };
    const account: Account = { ...fetched, devices: fetched.devices.map(({ obfsToken: _token, ...device }) => device) };
    this.noteAccount(account, generation, deviceId);
    this.lastSettings = account.settings;
    if (this.session.token && this.session.paidUntil !== account.paidUntil) {
      this.session = { ...this.session, paidUntil: account.paidUntil };
      await this.saveSession();
    }
    return account;
  }

  recentLogins(): Promise<LoginOverview> {
    return this.authed(() => this.api.logins());
  }

  async markLoginsSeen(): Promise<null> {
    await this.authed(() => this.api.loginsSeen());
    return null;
  }

  async logoutOtherSessions(): Promise<null> {
    await this.authed(() => this.api.logoutOthers());
    return null;
  }

  async openSecurityPage(): Promise<void> {
    await this.openWebsite(securityPageUrl(this.baseUrl));
  }

  async portForwarding(): Promise<PortForwardingState | null> {
    return this.forwarding("get");
  }

  async setPortForwarding(enabled: boolean): Promise<PortForwardingState | null> {
    return this.forwarding(enabled ? "enable" : "disable");
  }

  private async forwarding(action: "get" | "enable" | "disable"): Promise<PortForwardingState | null> {
    const device = this.device;
    if (!device) return null;
    return this.forwardingOf(device.id, action);
  }

  currentDeviceId(): string | null {
    return this.device?.id ?? null;
  }

  renameDevice(id: string, name: string): Promise<Device> {
    return this.authed(() => this.api.renameDevice(id, name));
  }

  async removeDevice(id: string): Promise<void> {
    if (this.device?.id === id && this.status.phase !== "disconnected") await this.disconnect();
    await this.serialize(async () => {
      await this.authed(() => this.api.deleteDevice(id));
      if (this.staleDevices.includes(id)) {
        this.staleDevices = this.staleDevices.filter((entry) => entry !== id);
        await this.kvWrite(KEYS.staleDevices, this.staleDevices.length > 0 ? this.staleDevices : null);
      }
      if (this.device?.id !== id) return;
      await this.vpn.clearSavedTunnel().catch(() => undefined);
      this.tunnelGeneration += 1;
      this.device = null;
      this.activeTunnel = null;
      await this.saveDevice();
    });
  }

  devicePortForwarding(deviceId: string): Promise<PortForwardingState | null> {
    return this.forwardingOf(deviceId, "get");
  }

  addPortForward(deviceId: string, localPort: number | null = null): Promise<PortForwardingState | null> {
    return this.forwardingOf(deviceId, "enable", undefined, localPort);
  }

  setPortForwardLocalPort(deviceId: string, port: number, localPort: number | null): Promise<PortForwardingState | null> {
    return this.forwardingOf(deviceId, "local", port, localPort);
  }

  removePortForward(deviceId: string, port: number): Promise<PortForwardingState | null> {
    return this.forwardingOf(deviceId, "disable", port);
  }

  private async forwardingOf(
    deviceId: string,
    action: "get" | "enable" | "disable" | "local",
    port?: number,
    localPort: number | null = null,
  ): Promise<PortForwardingState | null> {
    try {
      return await this.authed(() => this.api.portForwarding(deviceId, action, port, localPort));
    } catch (error) {
      if (error instanceof ApiError && error.apiCode === "device_not_found") return null;
      throw error;
    }
  }

  async tor(enabled?: boolean): Promise<TorState | null> {
    const device = this.device;
    if (!device) return null;
    try {
      const own =
        enabled === undefined
          ? (await this.authed(() => this.api.account())).devices.find((entry) => entry.id === device.id)
          : await this.authed(() => this.api.setDeviceTor(device.id, enabled));
      return own ? torStateFor(own, await this.api.nodes()) : null;
    } catch (error) {
      if (error instanceof ApiError && error.apiCode === "device_not_found") return null;
      throw error;
    }
  }

  private lastNodes: readonly VpnNode[] = [];
  private measuringLatency = false;

  async nodes(): Promise<VpnNode[]> {
    const nodes = await this.api.nodes();
    this.lastNodes = nodes;
    return nodes;
  }

  async measureLatency(ids: readonly string[]): Promise<LatencyMeasurement[]> {
    if (!this.vpn.measureLatency || this.status.phase !== "disconnected" || this.measuringLatency) return [];
    const wanted = new Set(ids.slice(0, MAX_PING_TARGETS));
    const targets = pingableNodes(this.lastNodes)
      .filter((node) => wanted.has(node.id))
      .map((node) => ({ id: node.id, host: node.endpointHost, port: node.pingPort as number }));
    if (targets.length === 0) return [];
    this.measuringLatency = true;
    try {
      const { results } = await this.vpn.measureLatency({ targets });
      const known = new Set(targets.map((target) => target.id));
      return (Array.isArray(results) ? results : [])
        .filter((result) => known.has(result.id) && Array.isArray(result.samples))
        .map((result) => ({
          id: result.id,
          samples: result.samples.slice(0, 10).map((sample) => (typeof sample === "number" && Number.isFinite(sample) ? sample : null)),
        }));
    } catch {
      return [];
    } finally {
      this.measuringLatency = false;
    }
  }

  updateSettings(patch: SettingsPatch): Promise<AccountSettings> {
    return this.serialize(async () => {
      const before = this.lastSettings;
      const next = await this.authed(() => this.api.updateSettings(patch));
      this.lastSettings = next;
      const routingChanged =
        !before || before.killSwitch !== next.killSwitch || before.lanAccess !== next.lanAccess || before.ipv6 !== next.ipv6;
      const nodeId = this.tunnelNodeId();
      if (routingChanged && nodeId) {
        void this.connect(nodeId).catch((error: unknown) => this.publish({ error: this.describe(error) }));
      }
      return next;
    });
  }

  private deviceName(): string {
    if (this.deviceModel) return `Android · ${this.deviceModel}`.slice(0, MAX_DEVICE_NAME).trim();
    return `Android ${this.randomSuffix()}`;
  }

  private async ensureDevice(account: Account, nodeId: string, tunnelIdle: boolean): Promise<StoredDevice & { privateKey: string }> {
    const existing = this.device;
    const registered = existing !== null && account.devices.some((device) => device.id === existing.id);
    if (existing && registered && existing.nodeId === nodeId && existing.privateKey) {
      const entry = account.devices.find((device) => device.id === existing.id);
      const due = keyRotationDue(keyCreatedAt(existing.keyCreatedAt, entry), this.now());
      if (tunnelIdle && (existing.pendingKey || due)) {
        const renewed = await this.renewDeviceKey(existing).catch(() => null);
        if (renewed) return renewed;
      }
      const current = this.device ?? existing;
      return { ...current, privateKey: current.privateKey ?? existing.privateKey };
    }

    const keys = await this.vpn.generateKeyPair();
    const register = () =>
      this.authed(() => this.api.registerDevice({ name: this.deviceName(), nodeId, publicKey: keys.publicKey }));
    let response: Awaited<ReturnType<ApiClient["registerDevice"]>>;
    let oldDeleted = false;
    try {
      response = await register();
    } catch (error) {
      if (!(existing && registered && error instanceof ApiError && deviceLimitReached(error))) throw error;
      await this.authed(() => this.api.deleteDevice(existing.id));
      oldDeleted = true;
      response = await register();
    }

    const serverKey = response.privateKey;
    let publicKey: string | null = keys.publicKey;
    if (serverKey) {
      publicKey = await this.vpn
        .publicKeyFromPrivate({ privateKey: serverKey })
        .then((result) => result.publicKey)
        .catch(() => null);
    }
    const privateKey = serverKey ?? keys.privateKey;
    const device = {
      id: response.device.id,
      nodeId: response.device.nodeId,
      publicKey,
      privateKey,
      keySource: serverKey ? ("server" as const) : ("local" as const),
      config: response.config,
      keyCreatedAt: this.now(),
      ...(response.device.obfsToken ? { obfsToken: response.device.obfsToken } : {}),
    };
    if (existing && registered && !oldDeleted && existing.id !== device.id) {
      this.staleDevices = [...new Set([...this.staleDevices, existing.id])].slice(-32);
      await this.kvWrite(KEYS.staleDevices, this.staleDevices);
    }
    this.device = device;
    await this.saveDevice();
    return device;
  }

  private async renewDeviceKey(device: StoredDevice): Promise<StoredDevice & { privateKey: string; keyCreatedAt: number }> {
    const { pair, response } = await rotateWithPending({
      pending: device.pendingKey,
      generate: () => this.vpn.generateKeyPair(),
      storePending: async (pendingKey) => {
        this.device = { ...device, pendingKey };
        await this.saveDevice();
      },
      send: (publicKey) => this.authed(() => this.api.rotateDeviceKey(device.id, publicKey)),
      answered: (error) => error instanceof ApiError && error.status !== null && error.status >= 400,
    });
    const next = {
      id: device.id,
      nodeId: response.device.nodeId,
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      keySource: "local" as const,
      config: response.config,
      keyCreatedAt: this.now(),
      pendingKey: null,
      ...((response.device.obfsToken ?? device.obfsToken) ? { obfsToken: response.device.obfsToken ?? device.obfsToken } : {}),
    };
    this.device = next;
    await this.saveDevice();
    return next;
  }

  async deviceKey(): Promise<DeviceKeyInfo | null> {
    const device = this.device;
    if (!device) return null;
    if (device.keyCreatedAt !== undefined) return { createdAt: device.keyCreatedAt };
    const account = await this.account();
    return { createdAt: keyCreatedAt(undefined, account.devices.find((entry) => entry.id === device.id)) };
  }

  async rotateDeviceKey(): Promise<DeviceKeyInfo | null> {
    if (!this.device) return null;
    const reconnect = this.status.phase !== "disconnected" && this.runtime?.nodeId ? this.runtime.nodeId : null;
    if (reconnect) await this.disconnect();
    try {
      return await this.serialize(async () => {
        const device = this.device;
        if (!device) return null;
        const next = await this.renewDeviceKey(device);
        return { createdAt: next.keyCreatedAt };
      });
    } finally {
      if (reconnect) await this.connect(reconnect).catch((error: unknown) => this.publish({ error: this.describe(error) }));
    }
  }

  async cleanupStaleDevices(): Promise<void> {
    const ids = [...this.staleDevices];
    if (ids.length === 0 || !this.session.token) return;
    const done: string[] = [];
    for (const id of ids) {
      try {
        await this.authed(() => this.api.deleteDevice(id));
        done.push(id);
      } catch {
      }
    }
    if (done.length === 0) return;
    this.staleDevices = this.staleDevices.filter((id) => !done.includes(id));
    await this.kvWrite(KEYS.staleDevices, this.staleDevices.length > 0 ? this.staleDevices : null);
  }

  connect(nodeId: string): Promise<TunnelStatus> {
    if (this.updateRequired && this.status.phase === "disconnected") {
      return Promise.reject(new VpnError("updateRequired", "update_required"));
    }
    return this.serialize(() => this.startTunnel(nodeId));
  }

  async checkAppVersion(): Promise<AppVersionInfo> {
    const info = await this.api.appVersion("android");
    this.updateRequired = evaluateUpdate(this.appVersion, info).kind === "required";
    return info;
  }

  private async askNotificationsOnce(): Promise<void> {
    if (this.notificationsAsked) return;
    this.notificationsAsked = true;
    await this.vpn.requestNotificationPermission().catch(() => undefined);
  }

  private async startTunnel(nodeId: string): Promise<TunnelStatus> {
    const postQuantum = this.postQuantum;
    const tunnelIdle = this.status.phase === "disconnected";
    this.tunnelGeneration += 1;
    this.operation = "connecting";
    this.publish({ phase: "connecting", nodeId, error: null, revoked: undefined, quantum: postQuantum ? "negotiating" : undefined });
    let startAttempted = false;
    try {
      const permission = await this.vpn.prepare().catch(() => ({ granted: false }));
      if (!permission?.granted) throw new VpnError("vpnPermissionDenied", "elevation");
      await this.askNotificationsOnce();

      const [account, nodes] = await Promise.all([this.account(), this.api.nodes()]);
      const node = nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new VpnError("locationGone", "invalid");
      if (!node.online) throw new VpnError("locationOffline", "server", { city: node.city });
      if (postQuantum && node.postQuantum !== true) {
        const running = await this.vpn.status().catch(() => null);
        if (running && running.state !== "down" && running.quantum !== "active") startAttempted = true;
        throw new VpnError("pqUnsupported", "pq_unsupported");
      }

      const device = await this.ensureDevice(account, node.id, tunnelIdle);
      const endpoint = parseEndpoint(device.config.endpoint) ?? { host: node.endpointHost, port: node.endpointPort };
      const tunnel = buildTunnelConfig({
        privateKey: device.privateKey,
        server: node.serverPublicKey ? { ...device.config, serverPublicKey: node.serverPublicKey } : device.config,
        endpoint,
        settings: account.settings,
        postQuantum,
      });

      const obfuscation: NativeObfuscation | undefined =
        node.obfuscation && device.obfsToken
          ? { host: endpoint.host, port: node.obfuscation.port, pin: node.obfuscation.pin, token: device.obfsToken }
          : undefined;

      const runtime: RuntimeState = {
        nodeId,
        label: node.city,
        addresses: tunnel.addresses,
        dns: tunnel.dns,
        endpoint: formatEndpoint(endpoint),
        leakProtection: tunnel.leakProtection,
      };
      const api = this.session.token ? { baseUrl: this.baseUrl, token: this.session.token } : undefined;
      const active: ActiveTunnel = { config: tunnel.text, nodeId, label: node.city, postQuantum, ...(obfuscation ? { obfuscation } : {}), ...(api ? { api } : {}) };
      startAttempted = true;
      const native = await this.vpn.start({ ...active, excludedApps: [...this.excluded] }).catch((error: unknown) => {
        throw pqStartError(error);
      });
      this.runtime = runtime;
      this.activeTunnel = active;
      this.ignoredNativeError = null;
      await this.kvWrite(KEYS.runtime, runtime);
      this.prefs = { ...this.prefs, lastNodeId: nodeId };
      await this.savePrefs();
      if (!native || native.state === "down") {
        throw native?.error ? new NativeError(native.error, "internal") : new VpnError("tunnelStartFailed", "internal");
      }
      this.operation = null;
      this.lastRevocationCheck = this.now();
      this.publishNative(native);
      void this.cleanupStaleDevices();
      return this.status;
    } catch (error) {
      this.operation = null;
      if (startAttempted) {
        this.activeTunnel = null;
        await this.vpn.stop().catch(() => undefined);
      }
      const native = await this.vpn.status().catch(() => null);
      if (native) this.publishNative(native);
      else this.publish({ ...initialStatus(this.now()) });
      this.publish({ error: this.describe(error) });
      throw error;
    }
  }

  disconnect(): Promise<TunnelStatus> {
    if (this.operation === "connecting" && this.status.quantum === "negotiating") {
      void this.vpn.stop().catch(() => undefined);
    }
    return this.serialize(async () => {
      this.tunnelGeneration += 1;
      this.operation = "disconnecting";
      this.publish({ phase: "disconnecting", error: null, revoked: undefined });
      try {
        const native = await this.vpn.stop();
        this.operation = null;
        this.activeTunnel = null;
        this.ignoredNativeError = native?.error ?? null;
        this.status = { ...this.status, error: null };
        this.publishNative(native);
        return this.status;
      } catch (error) {
        this.operation = null;
        await this.refreshStatus();
        this.publish({ error: this.describe(error) });
        throw error;
      }
    });
  }

  async proxies(): Promise<ServerProxy[] | null> {
    try {
      return await this.authed(() => this.api.proxies());
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && error.apiCode === "not_found") return null;
      throw error;
    }
  }

  createProxy(input: ProxyCreate): Promise<ProxyWithPassword> {
    return this.authed(() => this.api.createProxy(input));
  }

  updateProxy(id: string, patch: ProxyPatch): Promise<ProxyWithPassword> {
    return this.authed(() => this.api.updateProxy(id, patch));
  }

  async deleteProxy(id: string): Promise<void> {
    await this.authed(() => this.api.deleteProxy(id));
  }

  excludedApps(): string[] {
    return [...this.excluded];
  }

  setExcludedApps(packages: string[]): Promise<string[]> {
    return this.serialize(async () => {
      const previous = this.excluded;
      this.excluded = [...packages];
      await this.kvWrite(KEYS.excludedApps, this.excluded);
      const nodeId = this.tunnelNodeId();
      if (!nodeId) return [...this.excluded];
      try {
        await this.restartTunnel(nodeId);
      } catch (error) {
        this.excluded = previous;
        await this.kvWrite(KEYS.excludedApps, previous);
        throw error;
      }
      return [...this.excluded];
    });
  }

  private async restartTunnel(nodeId: string): Promise<void> {
    const active = this.activeTunnel;
    if (!active || active.nodeId !== nodeId || active.postQuantum !== this.postQuantum) {
      await this.startTunnel(nodeId);
      return;
    }
    const stale = this.status.phase === "stale";
    this.tunnelGeneration += 1;
    this.operation = "connecting";
    this.publish({ phase: "connecting", error: null, revoked: undefined, quantum: active.postQuantum ? "negotiating" : undefined });
    try {
      const current = await this.withCurrentNodeKeys(active, stale);
      const native = await this.vpn.start({ ...current, excludedApps: [...this.excluded] }).catch((error: unknown) => {
        throw pqStartError(error);
      });
      this.activeTunnel = current;
      this.operation = null;
      if (!native || native.state === "down") {
        throw native?.error ? new NativeError(native.error, "internal") : new VpnError("tunnelRestartFailed", "internal");
      }
      this.publishNative(native);
    } catch (error) {
      this.operation = null;
      await this.refreshStatus();
      this.publish({ error: this.describe(error) });
      throw error;
    }
  }

  private async withCurrentNodeKeys(active: ActiveTunnel, stale: boolean): Promise<ActiveTunnel> {
    const api = stale && this.bypassApi ? this.bypassApi : this.api;
    const node = (await api.nodes().catch(() => null))?.find((entry) => entry.id === active.nodeId);
    if (!node) return active;
    const config = node.serverPublicKey ? withServerKey(active.config, node.serverPublicKey) : active.config;
    const obfuscation = active.obfuscation && node.obfuscation ? { ...active.obfuscation, port: node.obfuscation.port, pin: node.obfuscation.pin } : active.obfuscation;
    return { ...active, config, ...(obfuscation ? { obfuscation } : {}) };
  }

  async systemVpnState(): Promise<SystemVpnState> {
    try {
      const state = await this.vpn.systemVpnState();
      if (state.supported === true) {
        const next = { alwaysOn: state.alwaysOn === true, lockdown: state.lockdown === true };
        const last = this.lastSystemVpn;
        if (!last || last.alwaysOn !== next.alwaysOn || last.lockdown !== next.lockdown) {
          this.lastSystemVpn = next;
          await this.kvWrite(KEYS.systemVpn, next);
        }
        return { supported: true, ...next };
      }
    } catch {
    }
    if (this.lastSystemVpn) return { supported: true, ...this.lastSystemVpn, cached: true };
    return { supported: false, alwaysOn: false, lockdown: false };
  }

  async openSystemVpnSettings(): Promise<void> {
    this.lastSystemVpn = null;
    await this.kvWrite(KEYS.systemVpn, null);
    await this.vpn.openVpnSettings().catch(() => undefined);
  }

  async openAccountPage(): Promise<void> {
    await this.openWebsite(accountPageUrl(this.baseUrl));
  }

  async openTelegramProxy(link: string): Promise<void> {
    await this.openWebsite(link);
  }

  async openDownloadPage(): Promise<void> {
    await this.openWebsite(downloadPageUrl(this.baseUrl));
  }

  private async openWebsite(url: string): Promise<void> {
    try {
      if (!this.vpn.openUrl) throw new Error("openUrl missing");
      await this.vpn.openUrl({ url });
    } catch {
      const open = (globalThis as { open?: (url: string, target: string, features: string) => unknown }).open;
      if (typeof open !== "function") throw new VpnError("openWebsiteFailed", "internal");
      open(url, "_blank", "noopener");
    }
  }

  async appIcon(): Promise<AppIcon> {
    try {
      const parsed = appIconSchema.safeParse((await this.vpn.appIcon())?.icon);
      return parsed.success ? parsed.data : "default";
    } catch {
      return "default";
    }
  }

  async setAppIcon(icon: AppIcon): Promise<AppIcon> {
    let result: unknown;
    try {
      result = (await this.vpn.setAppIcon({ icon }))?.icon;
    } catch {
      throw new VpnError("appIconFailed", "internal");
    }
    const parsed = appIconSchema.safeParse(result);
    if (!parsed.success) throw new VpnError("appIconFailed", "internal");
    return parsed.data;
  }

  async installedApps(): Promise<InstalledApp[]> {
    const { apps } = await this.vpn.installedApps();
    const seen = new Set<string>();
    const result: InstalledApp[] = [];
    for (const app of Array.isArray(apps) ? apps : []) {
      if (!app || !packageNameSchema.safeParse(app.packageName).success || seen.has(app.packageName)) continue;
      seen.add(app.packageName);
      const label = typeof app.label === "string" ? cleanText(app.label).slice(0, 128) : "";
      const icon =
        typeof app.icon === "string" && app.icon.length <= 256 * 1024 && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(app.icon)
          ? app.icon
          : null;
      result.push({ packageName: app.packageName, label: label || app.packageName, system: app.system === true, icon });
    }
    return result.sort((a, b) => a.label.localeCompare(b.label, "de"));
  }

  diagnostics(): ControllerDiagnostics {
    const device = this.device;
    return {
      flavor: this.flavor,
      baseUrl: this.baseUrl,
      version: this.appVersion,
      language: this.language(),
      encryptionAvailable: this.secureAvailable,
      session: { ...this.getSession(), pendingRegistration: this.pending !== null },
      device: device
        ? {
            id: device.id,
            nodeId: device.nodeId,
            keySource: device.keySource,
            hasPrivateKey: device.privateKey !== null,
            endpoint: device.config.endpoint,
          }
        : null,
      staleDevices: this.staleDevices.length,
      excludedApps: this.excluded.length,
      status: this.status,
      systemVpn: this.lastSystemVpn,
    };
  }

  secretsForRedaction(): string[] {
    return [
      this.session.token,
      this.pending?.token,
      this.pending?.code,
      this.device?.privateKey,
      this.device?.config.presharedKey,
      this.device?.obfsToken,
    ].filter((value): value is string => typeof value === "string" && value.length >= 8);
  }

  async wipeLocalData(): Promise<void> {
    await this.logout().catch(() => undefined);
    for (const key of Object.values(SECURE_KEYS)) await this.secureWrite(key, null);
    for (const key of Object.values(KEYS)) await this.kvWrite(key, null);
    this.prefs = { baseUrl: this.fixedBaseUrl, lastNodeId: null };
    this.excluded = [];
    this.lastSystemVpn = null;
    this.languagePref = DEFAULT_LANGUAGE_PREFERENCE;
    this.themePref = DEFAULT_THEME_PREFERENCE;
    try {
      await this.vpn.setAppLanguage?.({ language: DEFAULT_LANGUAGE_PREFERENCE });
    } catch {
    }
    try {
      await this.vpn.setAppTheme?.({ theme: DEFAULT_THEME_PREFERENCE });
    } catch {
    }
  }
}
