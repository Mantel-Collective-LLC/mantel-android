import type {
  Account,
  AccountSettings,
  ApiLogEntry,
  DebugBridge,
  Device,
  Environment,
  InstalledApp,
  MantelBridge,
  PortForwardingState,
  ProxyWithPassword,
  Preferences,
  Result,
  ServerProxy,
  SessionInfo,
  SystemVpnState,
  TorState,
  TunnelStatus,
  VpnNode,
} from "../../../core/contract";
import { accountPageUrl, downloadPageUrl, securityPageUrl, type LoginOverview, type QuitAction } from "../../../core/contract";
import { parseAppVersionInfo, type AppVersionInfo } from "../../../core/app-version";
import { version as packageVersion } from "../../../../package.json";
import { describeApiError, endsSession, parseApiErrorPayload } from "../../../core/api-errors";
import { DICTIONARIES, isLanguagePreference, languageOfLocale, resolveLanguage, translate } from "../../../core/i18n";
import { IS_DEBUG } from "../lib/flavor";
import { readStoredTheme } from "../lib/theme-dom";
import { isThemePreference } from "../../../core/theme";
import { ANDROID_FEATURES, DESKTOP_FEATURES } from "../lib/platform";
import { describeSupportError, newDeviceKey, supportRoute, SupportService, type DeviceKey, type TicketTransport } from "../../../core/support";

const MOCK_PORT = new URLSearchParams(window.location.search).get("mockport") ?? "";
const MOCK_URL = `http://127.0.0.1:${/^\d{2,5}$/.test(MOCK_PORT) ? MOCK_PORT : "3101"}`;

const FAKE_APPS: Array<[string, string, boolean, string?]> = [
  ["Bahn Navigator", "de.hafas.android.db", false, "#ec0016"],
  ["Banking", "de.sparkasse.banking", false, "#e60000"],
  ["Bluetooth", "com.android.bluetooth", true],
  ["Kalender", "com.google.android.calendar", false, "#1a73e8"],
  ["Kamera", "com.android.camera2", true],
  ["Chrome", "com.android.chrome", false, "#f9ab00"],
  ["Uhr", "com.google.android.deskclock", true],
  ["Kontakte", "com.google.android.contacts", true],
  ["DB Fahrkarten", "de.db.fahrkarten", false],
  ["Dateien", "com.google.android.documentsui", true],
  ["DuckDuckGo", "com.duckduckgo.mobile.android", false, "#de5833"],
  ["Firefox", "org.mozilla.firefox", false, "#ff7139"],
  ["Fotos", "com.google.android.apps.photos", false],
  ["Gmail", "com.google.android.gm", false, "#ea4335"],
  ["Google Play Store", "com.android.vending", true],
  ["Google Play-Dienste", "com.google.android.gms", true],
  ["Home Assistant", "io.homeassistant.companion.android", false],
  ["Instagram", "com.instagram.android", false],
  ["Kleinanzeigen", "com.ebay.kleinanzeigen", false],
  ["Maps", "com.google.android.apps.maps", false, "#34a853"],
  ["Nachrichten", "com.google.android.apps.messaging", true],
  ["Netflix", "com.netflix.mediaclient", false],
  ["Nextcloud", "com.nextcloud.client", false],
  ["Notizen", "com.google.android.keep", false],
  ["PayPal", "com.paypal.android.p2pmobile", false],
  ["Rechner", "com.google.android.calculator", true],
  ["Signal", "org.thoughtcrime.securesms", false, "#3a76f0"],
  ["Einstellungen", "com.android.settings", true],
  ["Spotify", "com.spotify.music", false],
  ["Systemoberfläche", "com.android.systemui", true],
  ["Tagesschau", "de.tagesschau", false],
  ["Telefon", "com.google.android.dialer", true],
  ["Telegram", "org.telegram.messenger", false],
  ["Threema", "ch.threema.app", false],
  ["Uber", "com.ubercab", false],
  ["Wetter", "com.google.android.apps.weather", false],
  ["WhatsApp", "com.whatsapp", false],
  ["Wikipedia", "org.wikipedia", false],
  ["YouTube", "com.google.android.youtube", false],
  ["Zoom", "us.zoom.videomeetings", false],
  ["Android System WebView", "com.google.android.webview", true],
  ["Druckdienst", "com.android.printspooler", true],
];

function fakeIcon(label: string, color: string): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(0, 0, 48, 48, 12);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "600 22px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label.slice(0, 1), 24, 25);
  return canvas.toDataURL("image/png");
}

function fakeApps(): InstalledApp[] {
  return FAKE_APPS.map(([label, packageName, system, color]) => ({
    label,
    packageName,
    system,
    icon: color ? fakeIcon(label, color) : null,
  })).sort((a, b) => a.label.localeCompare(b.label, "de"));
}

export function createBrowserBridge(): MantelBridge {
  const params = new URLSearchParams(window.location.search);
  const android = params.get("platform") === "android";
  const systemVpn: SystemVpnState = {
    supported: params.get("vpnapi") !== "0",
    alwaysOn: params.get("alwayson") === "1",
    lockdown: params.get("lockdown") === "1",
  };
  let excludedApps: string[] = ["com.netflix.mediaclient"];
  const listeners = new Set<(status: TunnelStatus) => void>();
  const sessionListeners = new Set<() => void>();
  let token: string | null = null;
  let pendingRegistration: { token: string; session: SessionInfo } | null = null;
  const requestLog: ApiLogEntry[] = [];
  let nextLogId = 1;
  let verbose = false;
  let wireguardInstalled = params.get("wg") !== "0";
  let session: SessionInfo = { loggedIn: false, accountId: null, paidUntil: null };
  const systemLocale = params.get("lang") ?? navigator.language ?? "de-DE";
  const APP_VERSION = /^\d{4}\.\d{1,2}\.\d{1,3}$/.test(params.get("appversion") ?? "")
    ? `${params.get("appversion")}-browser`
    : `${packageVersion}-browser`;
  let preferences: Preferences = { baseUrl: MOCK_URL, alwaysOnKillSwitch: false, lastNodeId: null, language: "system", theme: readStoredTheme(), obfuscation: "auto" };
  const errors = () => DICTIONARIES[resolveLanguage(preferences.language)].errors;
  let autostartEnabled = false;
  let timer: number | undefined;
  let revokeTimer: number | undefined;
  const revoke = params.get("revoke");
  const revokeAfter = Number(params.get("revokeafter") ?? 5000);
  let status: TunnelStatus = {
    phase: "disconnected",
    nodeId: null,
    connectedAt: null,
    lastHandshakeAt: null,
    rxBytes: 0,
    txBytes: 0,
    endpoint: null,
    addresses: [],
    dns: [],
    leakProtection: "none",
    firewallActive: false,
    serviceState: null,
    error: null,
    checkedAt: Date.now(),
  };

  const emit = (patch: Partial<TunnelStatus>) => {
    status = { ...status, ...patch, checkedAt: Date.now() };
    listeners.forEach((listener) => listener(status));
  };

  const forwardPorts = new Map<string, number>();
  let keyCreatedAt = Date.now() - 12 * 86_400_000;
  async function simulatedForwarding(): Promise<PortForwardingState | null> {
    const nodeId = status.nodeId;
    if (!nodeId) return null;
    const nodes = await call<VpnNode[]>("GET", "/api/v1/nodes");
    const node = nodes.ok ? nodes.value.find((entry) => entry.id === nodeId) : undefined;
    if (!node) return null;
    const port = forwardPorts.get(nodeId);
    const available = node.online && node.portForwarding === true;
    return {
      nodeId,
      city: node.city,
      available,
      reason: available ? null : node.online ? "unsupported" : "offline",
      max: 1,
      forwards: port ? [{ port, host: node.endpointHost }] : [],
    };
  }

  const torNodes = new Set<string>();
  async function simulatedTor(): Promise<TorState | null> {
    const nodeId = status.nodeId;
    if (!nodeId) return null;
    const nodes = await call<VpnNode[]>("GET", "/api/v1/nodes");
    const node = nodes.ok ? nodes.value.find((entry) => entry.id === nodeId) : undefined;
    if (!node) return null;
    const enabled = torNodes.has(nodeId);
    return {
      deviceId: `dev-${nodeId}`,
      nodeId,
      city: node.city,
      enabled,
      availability: node.tor ?? (node.online ? "ready" : "unavailable"),
      socks: enabled ? "10.8.0.1:9050" : null,
    };
  }

  let loginOverview: LoginOverview =
    params.get("logins") === "0" ? { logins: [] } : { logins: [{ client: "browser", method: "passkey" }] };

  async function call<T>(
    method: string,
    route: string,
    body?: unknown,
    options: { anonymous?: boolean; notFoundAsNull?: boolean } = {},
  ): Promise<Result<T>> {
    const started = performance.now();
    const record = (status: number | null) => {
      requestLog.push({
        id: nextLogId++,
        at: Date.now(),
        method,
        route: route.replace(/^(\/api\/v1\/(?:devices|proxies)\/)[^/]+/, "$1:id"),
        status,
        durationMs: Math.round(performance.now() - started),
      });
      if (requestLog.length > 200) requestLog.shift();
    };
    try {
      const response = await fetch(`${MOCK_URL}${route}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token && !options.anonymous ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      record(response.status);
      const text = await response.text();
      const parsed: unknown = text ? JSON.parse(text) : null;
      if (response.status === 404 && options.notFoundAsNull) return { ok: true, value: null as T };
      if (!response.ok) {
        const described = describeApiError(response.status, parseApiErrorPayload(parsed), { debug: IS_DEBUG });
        if (endsSession(response.status, described.apiCode)) sessionListeners.forEach((listener) => listener());
        const language = resolveLanguage(preferences.language);
        const error = typeof described.message === "string" ? described.message : translate(language, described.message);
        return { ok: false, error, code: described.code };
      }
      return { ok: true, value: parsed as T };
    } catch {
      record(null);
      return { ok: false, error: "Mock-API nicht erreichbar (npm run mock).", code: "network" };
    }
  }

  const ticketTransport: TicketTransport = async (request) => {
    const response = await fetch(`${MOCK_URL}${supportRoute(request)}`, {
      method: request.method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
  };
  let ticketKey: DeviceKey | null = null;
  const support = new SupportService({
    transport: ticketTransport,
    platform: "web",
    keys: {
      load: async () => ticketKey,
      create: async () => (ticketKey = await newDeviceKey(false)),
      clear: async () => {
        ticketKey = null;
      },
    },
  });
  async function supportCall<T>(task: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, value: await task() };
    } catch (error) {
      const failure = describeSupportError(error, { debug: IS_DEBUG });
      const language = resolveLanguage(preferences.language);
      if (!failure) return { ok: false, error: "Mock-API nicht erreichbar (npm run mock).", code: "network" };
      const message = typeof failure.message === "string" ? failure.message : translate(language, failure.message);
      return { ok: false, error: message, code: failure.code };
    }
  }

  const environment = async (): Promise<Environment> =>
    android
      ? {
          platform: "android",
          elevated: true,
          wireguardInstalled: true,
          wireguardPath: null,
          wireguardSource: null,
          encryptionAvailable: params.get("keystore") !== "0",
          appVersion: APP_VERSION,
          features: { ...ANDROID_FEATURES },
          systemLanguage: languageOfLocale(systemLocale),
          systemLocale,
        }
      : {
          platform: "win32",
          elevated: params.get("admin") !== "0",
          wireguardInstalled,
          wireguardPath: wireguardInstalled ? "C:\\ProgramData\\Mantel\\wireguard" : null,
          wireguardSource: wireguardInstalled ? "managed" : null,
          encryptionAvailable: true,
          appVersion: APP_VERSION,
          features: { ...DESKTOP_FEATURES },
          systemLanguage: languageOfLocale(systemLocale),
          systemLocale,
        };

  const androidOnly: Partial<MantelBridge> = android
    ? {
        systemVpnState: async () => ({ ...systemVpn }),
        openSystemVpnSettings: async () => undefined,
        installedApps: async () => {
          await new Promise((resolve) => window.setTimeout(resolve, 700));
          return fakeApps();
        },
        excludedApps: async () => [...excludedApps],
        setExcludedApps: async (packages) => {
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          if (params.get("excludefail") === "1") {
            return { ok: false, error: errors().tunnelRestartFailed, code: "internal" };
          }
          excludedApps = [...new Set(packages)].sort();
          return { ok: true, value: [...excludedApps] };
        },
      }
    : {};

  const debug: DebugBridge = {
    info: async () => ({
      flavor: "debug",
      productName: "Mantel Debug",
      appId: "net.mantel.desktop.debug",
      appVersion: `${packageVersion}-browser`,
      electron: "– (Browser)",
      chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "–",
      node: "–",
      v8: "–",
      platform: "browser",
      arch: "–",
      buildTime: import.meta.env.MANTEL_BUILD_TIME ?? null,
      commit: null,
      packaged: false,
      elevated: params.get("admin") !== "0",
      baseUrl: preferences.baseUrl,
      userData: "%APPDATA%\\Mantel-Debug-Dev",
      tunnelName: "mantel-debug",
      serviceName: "WireGuardTunnel$mantel-debug",
      firewallGroup: "Mantel Debug Kill Switch",
      verbose,
      loggedIn: session.loggedIn,
    }),
    requestLog: async () => requestLog.map((entry) => ({ ...entry })),
    clearRequestLog: async () => {
      requestLog.length = 0;
    },
    healthCheck: async () => {
      const started = performance.now();
      const result = await call<VpnNode[]>("GET", "/api/v1/nodes");
      return {
        baseUrl: preferences.baseUrl,
        ok: result.ok,
        status: result.ok ? 200 : null,
        latencyMs: Math.round(performance.now() - started),
        nodes: result.ok ? result.value.length : null,
        error: result.ok ? null : result.error,
        checkedAt: Date.now(),
      };
    },
    setVerbose: async (enabled) => {
      verbose = enabled;
      return debug.info();
    },
    copyDiagnostics: async () => {
      const text = JSON.stringify({ build: await debug.info(), tunnel: status, requestLog }, null, 2);
      await navigator.clipboard.writeText(text).catch(() => undefined);
      return { ok: true, value: text };
    },
    resetLocalData: async () => {
      window.clearInterval(timer);
      token = null;
      pendingRegistration = null;
      session = { loggedIn: false, accountId: null, paidUntil: null };
      preferences = { baseUrl: MOCK_URL, alwaysOnKillSwitch: false, lastNodeId: null, language: "system", theme: "system" };
      requestLog.length = 0;
      emit({ phase: "disconnected", connectedAt: null, lastHandshakeAt: null, rxBytes: 0, txBytes: 0, firewallActive: false });
      return { ok: true, value: null };
    },
    openDevTools: async () => undefined,
  };

  const bridge: MantelBridge = {
    environment,
    session: async () => session,
    login: async (code, totp) => {
      const result = await call<{ token: string; account: { id: string; paidUntil: string } }>("POST", "/api/v1/auth/login", { code, totp: totp ?? null });
      if (!result.ok) return result;
      token = result.value.token;
      session = { loggedIn: true, accountId: result.value.account.id, paidUntil: result.value.account.paidUntil };
      pendingRegistration = null;
      return { ok: true, value: session };
    },
    register: async () => {
      if (params.get("registerfail") === "1") {
        return { ok: false, error: "Zu viele neue Konten in kurzer Zeit. Versuch es später erneut.", code: "rate_limited" };
      }
      const result = await call<{ code: string; token: string; account: { id: string; paidUntil: string } }>(
        "POST",
        "/api/v1/auth/register",
        {},
      );
      if (!result.ok) return result;
      pendingRegistration = {
        token: result.value.token,
        session: { loggedIn: true, accountId: result.value.account.id, paidUntil: result.value.account.paidUntil },
      };
      return { ok: true, value: { code: result.value.code } };
    },
    confirmRegistration: async () => {
      if (!pendingRegistration) return { ok: false, error: errors().registrationMissing, code: "invalid" };
      token = pendingRegistration.token;
      session = pendingRegistration.session;
      pendingRegistration = null;
      return { ok: true, value: session };
    },
    copyText: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return { ok: true, value: null };
      } catch {
        return { ok: false, error: "Zwischenablage nicht verfügbar.", code: "internal" };
      }
    },
    logout: async () => {
      window.clearInterval(timer);
      window.clearTimeout(revokeTimer);
      emit({ phase: "disconnected", connectedAt: null, lastHandshakeAt: null });
      await support.logout();
      await call("POST", "/api/v1/auth/logout");
      token = null;
      session = { loggedIn: false, accountId: null, paidUntil: null };
      return { ok: true, value: null };
    },
    account: () => call<Account>("GET", "/api/v1/account"),
    nodes: () => call<VpnNode[]>("GET", "/api/v1/nodes"),
    measureLatency: async (nodeIds) => {
      if (status.phase !== "disconnected") return [];
      const simulated = await call<Record<string, number>>("GET", "/__mock/latency", undefined, { anonymous: true });
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      if (!simulated.ok) return [];
      return nodeIds.map((id) => {
        const rtt = simulated.value[id];
        return { id, samples: rtt === undefined ? [null, null, null] : [rtt + 2, rtt, rtt + 5] };
      });
    },
    updateSettings: (patch) => call<AccountSettings>("PATCH", "/api/v1/settings", patch),
    portForwarding: async () => ({ ok: true, value: await simulatedForwarding() }),
    currentDeviceId: async () => {
      const account = await call<Account>("GET", "/api/v1/account");
      return account.ok ? (account.value.devices[0]?.id ?? null) : null;
    },
    renameDevice: (id, name) => call<Device>("PATCH", `/api/v1/devices/${encodeURIComponent(id)}`, { name }),
    removeDevice: async (id) => {
      const result = await call<null>("DELETE", `/api/v1/devices/${encodeURIComponent(id)}`);
      return result.ok ? { ok: true, value: null } : result;
    },
    devicePortForwarding: (id) =>
      call<PortForwardingState | null>("GET", `/api/v1/devices/${encodeURIComponent(id)}/port-forwarding`, undefined, { notFoundAsNull: true }),
    addPortForward: (id) =>
      call<PortForwardingState | null>("POST", `/api/v1/devices/${encodeURIComponent(id)}/port-forwarding`, {}, { notFoundAsNull: true }),
    removePortForward: (id, port) =>
      call<PortForwardingState | null>("DELETE", `/api/v1/devices/${encodeURIComponent(id)}/port-forwarding/${port}`, undefined, {
        notFoundAsNull: false,
      }),
    proxies: async () => {
      const result = await call<{ proxies: ServerProxy[] } | null>("GET", "/api/v1/proxies", undefined, { notFoundAsNull: true });
      return result.ok ? { ok: true, value: result.value?.proxies ?? null } : result;
    },
    createProxy: (input) => call<ProxyWithPassword>("POST", "/api/v1/proxies", input),
    updateProxy: (id, patch) => call<ProxyWithPassword>("PATCH", `/api/v1/proxies/${encodeURIComponent(id)}`, patch),
    deleteProxy: async (id) => {
      const result = await call<null>("DELETE", `/api/v1/proxies/${encodeURIComponent(id)}`);
      return result.ok ? { ok: true, value: null } : result;
    },
    openTelegramProxy: async (link) => {
      window.open(link, "_blank", "noopener");
      return { ok: true, value: null };
    },
    recentLogins: async () => ({ ok: true, value: loginOverview }),
    markLoginsSeen: async () => {
      loginOverview = { logins: [] };
      return { ok: true, value: null };
    },
    logoutOtherSessions: async () => {
      loginOverview = { logins: [] };
      return { ok: true, value: null };
    },
    openSecurityPage: async () => {
      window.open(securityPageUrl(preferences.baseUrl), "_blank", "noopener");
      return { ok: true, value: null };
    },
    supportOverview: () => supportCall(() => support.overview()),
    supportUnread: () => supportCall(() => support.unread()),
    supportTicket: (id) => supportCall(() => support.ticket(id)),
    supportCreate: (category, text) => supportCall(() => support.create(category, text)),
    supportReply: (id, text) => supportCall(() => support.reply(id, text)),
    supportSetClosed: (id, closed) => supportCall(() => support.setClosed(id, closed)),
    deviceKey: async () => ({ ok: true, value: status.nodeId || preferences.lastNodeId ? { createdAt: keyCreatedAt } : null }),
    rotateDeviceKey: async () => {
      if (!status.nodeId && !preferences.lastNodeId) return { ok: true, value: null };
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      keyCreatedAt = Date.now();
      return { ok: true, value: { createdAt: keyCreatedAt } };
    },
    setPortForwarding: async (enabled) => {
      const state = await simulatedForwarding();
      if (!state) return { ok: true, value: null };
      if (enabled && !state.available) return { ok: false, error: errors().apiPortForwardingUnavailable.replace("{city}", state.city), code: "server" };
      if (enabled) forwardPorts.set(state.nodeId, 20000 + Math.floor(Math.random() * 30000));
      else forwardPorts.delete(state.nodeId);
      return { ok: true, value: await simulatedForwarding() };
    },
    tor: async () => ({ ok: true, value: await simulatedTor() }),
    setTor: async (enabled) => {
      const state = await simulatedTor();
      if (!state) return { ok: true, value: null };
      if (enabled && state.availability === "unavailable") return { ok: false, error: errors().apiTorUnavailable.replace("{city}", state.city), code: "server" };
      if (enabled) torNodes.add(state.nodeId);
      else torNodes.delete(state.nodeId);
      return { ok: true, value: await simulatedTor() };
    },
    connect: async (nodeId) => {
      window.clearInterval(timer);
      const postQuantum = preferences.postQuantum === true;
      if (postQuantum) {
        const nodes = await call<VpnNode[]>("GET", "/api/v1/nodes");
        if (nodes.ok && nodes.value.find((node) => node.id === nodeId)?.postQuantum !== true) {
          const error = errors().pqUnsupported;
          emit({ phase: "disconnected", error, quantum: "off" });
          return { ok: false, error, code: "pq_unsupported" };
        }
      }
      emit({ phase: "connecting", nodeId, error: null, revoked: undefined, quantum: postQuantum ? "negotiating" : "off" });
      await new Promise((resolve) => window.setTimeout(resolve, postQuantum ? 2200 : 1100));
      const connectedAt = Date.now();
      emit({
        quantum: postQuantum ? "active" : "off",
        obfuscated: preferences.obfuscation === "on" || (preferences.obfuscation !== "off" && params.get("obfs") === "1"),
        phase: "connected",
        connectedAt,
        lastHandshakeAt: connectedAt,
        endpoint: "198.51.100.20:51820",
        addresses: ["10.64.12.7/32", "fd00:6d61:6e74::c07/128"],
        dns: ["10.64.0.1"],
        leakProtection: "wireguard",
      });
      timer = window.setInterval(() => {
        emit({ rxBytes: status.rxBytes + 182_311, txBytes: status.txBytes + 21_004, lastHandshakeAt: status.lastHandshakeAt });
      }, 1000);
      window.clearTimeout(revokeTimer);
      if (revoke === "device" || revoke === "session" || revoke === "stale") {
        revokeTimer = window.setTimeout(() => {
          if (status.phase !== "connected") return;
          if (revoke === "stale") {
            window.clearInterval(timer);
            emit({ phase: "stale", lastHandshakeAt: Date.now() - 200_000 });
          } else if (revoke === "session") {
            token = null;
            session = { loggedIn: false, accountId: null, paidUntil: null };
            sessionListeners.forEach((listener) => listener());
          } else {
            window.clearInterval(timer);
            emit({ phase: "disconnected", connectedAt: null, lastHandshakeAt: null, rxBytes: 0, txBytes: 0, quantum: "off", revoked: "device_removed", error: errors().deviceRemoved });
          }
        }, revokeAfter);
      }
      return { ok: true, value: status };
    },
    disconnect: async () => {
      window.clearInterval(timer);
      window.clearTimeout(revokeTimer);
      emit({ phase: "disconnecting", revoked: undefined, error: null });
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      emit({ phase: "disconnected", connectedAt: null, lastHandshakeAt: null, rxBytes: 0, txBytes: 0, quantum: "off", obfuscated: false });
      return { ok: true, value: status };
    },
    tunnelStatus: async () => status,
    preferences: async () => preferences,
    setAlwaysOnKillSwitch: async (enabled) => {
      preferences = { ...preferences, alwaysOnKillSwitch: enabled };
      emit({ firewallActive: enabled });
      return { ok: true, value: preferences };
    },
    selectNode: async (nodeId) => {
      preferences = { ...preferences, lastNodeId: nodeId };
      return { ok: true, value: preferences };
    },
    ...(android
      ? {}
      : {
          autostart: async () => ({ supported: true, enabled: autostartEnabled }),
          setAutostart: async (enabled: boolean) => {
            autostartEnabled = enabled;
            return { ok: true as const, value: { supported: true, enabled } };
          },
          setConnectOnLaunch: async (enabled: boolean) => {
            preferences = { ...preferences, connectOnLaunch: enabled };
            return { ok: true as const, value: preferences };
          },
          setQuitAction: async (action: QuitAction) => {
            preferences = { ...preferences, quitAction: action };
            return { ok: true as const, value: preferences };
          },
        }),
    setPostQuantum: async (enabled) => {
      preferences = { ...preferences, postQuantum: enabled === true };
      if (status.phase !== "disconnected" && status.nodeId) void bridge.connect(status.nodeId);
      return { ok: true, value: preferences };
    },
    setObfuscation: async (mode) => {
      preferences = { ...preferences, obfuscation: mode };
      if (status.phase !== "disconnected" && status.nodeId) void bridge.connect(status.nodeId);
      return { ok: true, value: preferences };
    },
    setLanguage: async (language) => {
      if (!isLanguagePreference(language)) return { ok: false, error: errors().invalidInput, code: "invalid" };
      preferences = { ...preferences, language };
      return { ok: true, value: preferences };
    },
    setTheme: async (theme) => {
      if (!isThemePreference(theme)) return { ok: false, error: errors().invalidInput, code: "invalid" };
      preferences = { ...preferences, theme };
      return { ok: true, value: preferences };
    },
    openWireGuardDownload: async () => undefined,
    checkAppVersion: async () => {
      const platform = android ? "android" : "windows";
      const result = await call<unknown>("GET", `/api/v1/app-version?platform=${platform}`, undefined, { anonymous: true });
      if (!result.ok) return result;
      const info: AppVersionInfo | null = parseAppVersionInfo(result.value, platform);
      return info ? { ok: true, value: info } : { ok: false, error: errors().apiUnexpectedFormat, code: "server" };
    },
    openDownloadPage: async () => {
      window.open(downloadPageUrl(preferences.baseUrl), "_blank", "noopener");
      return { ok: true, value: null };
    },
    openAccountPage: async () => {
      window.open(accountPageUrl(preferences.baseUrl), "_blank", "noopener");
      return { ok: true, value: null };
    },
    installWireGuard: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (params.get("wgfail") === "1") {
        return { ok: false, error: errors().downloadUnreachable, code: "network" };
      }
      wireguardInstalled = true;
      return { ok: true, value: { version: "1.1.1" } };
    },
    onTunnelStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onSessionEnded: (listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    ...androidOnly,
    ...(IS_DEBUG && !android ? { debug } : {}),
  };
  return bridge;
}
