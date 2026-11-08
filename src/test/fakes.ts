import { vi, type Mocked } from "vitest";
import type { AccountSettings, ServerProxy, VpnNode } from "@shared/contract";
import type { MantelVpnPlugin, NativeInstalledApp, NativeObfuscation, NativeTunnelStatus } from "../native/mantel-vpn";
import type { KeyValueStore } from "../lib/storage";
import { API_BASE_URL } from "../flavor";

export function wgKey(seed: number): string {
  return Buffer.from(Array.from({ length: 32 }, (_, index) => (seed * 31 + index) & 0xff)).toString("base64");
}

export const SERVER_PUBLIC_KEY = wgKey(200);
export const PRESHARED_KEY = wgKey(201);
export const TOKEN = "tok_abcdefghijklmnopqrstuvwxyz012345";
export const ACCOUNT_CODE = "1234567812345678";
export const OBFS_PIN = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

export type CallLog = string[];

export function downStatus(): NativeTunnelStatus {
  return {
    state: "down",
    nodeId: null,
    startedAt: null,
    lastHandshakeAt: null,
    rxBytes: 0,
    txBytes: 0,
    endpoint: null,
    error: null,
  };
}

type StartInput = {
  config: string;
  nodeId: string;
  label: string;
  excludedApps: string[];
  postQuantum?: boolean;
  obfuscation?: NativeObfuscation;
};

export type FakeVpn = Mocked<MantelVpnPlugin> & {
  native: NativeTunnelStatus;
  secure: Map<string, string>;
  emit(status: NativeTunnelStatus): void;
  listeners: Array<(status: NativeTunnelStatus) => void>;
  emitSystemTheme(theme: "light" | "dark"): void;
  themeListeners: Array<(event: { theme: "light" | "dark" }) => void>;
  appTheme: string;
  lastStart: StartInput | null;
  obfuscationMode: "auto" | "off" | "on";
  keyCounter: number;
  apps: NativeInstalledApp[];
  icon: "default" | "calculator";
  wifi: { security: string; autoConnect: boolean };
  systemLocales: string[];
  appLanguage: string | null;
};

export function fakeVpn(log: CallLog, options: { now?: () => number } = {}): FakeVpn {
  const now = options.now ?? Date.now;
  const vpn = {
    native: downStatus(),
    secure: new Map<string, string>(),
    listeners: [] as Array<(status: NativeTunnelStatus) => void>,
    themeListeners: [] as Array<(event: { theme: "light" | "dark" }) => void>,
    appTheme: "system",
    lastStart: null as FakeVpn["lastStart"],
    obfuscationMode: "auto" as FakeVpn["obfuscationMode"],
    keyCounter: 0,
    apps: [] as NativeInstalledApp[],
    icon: "default" as "default" | "calculator",
    systemLocales: ["de-DE"],
    appLanguage: "de" as string | null,
    emit(status: NativeTunnelStatus) {
      vpn.native = status;
      vpn.listeners.forEach((listener) => listener(status));
    },
    emitSystemTheme(theme: "light" | "dark") {
      vpn.themeListeners.forEach((listener) => listener({ theme }));
    },
    prepare: vi.fn(async () => {
      log.push("vpn.prepare");
      return { granted: true };
    }),
    requestNotificationPermission: vi.fn(async () => {
      log.push("vpn.requestNotificationPermission");
      return { granted: false };
    }),
    start: vi.fn(async (input: StartInput) => {
      log.push(`vpn.start ${input.nodeId}${input.postQuantum ? " pq" : ""}${input.obfuscation ? " obfs" : ""}`);
      vpn.lastStart = input;
      const startedAt = now();
      vpn.native = {
        state: "up",
        nodeId: input.nodeId,
        startedAt,
        lastHandshakeAt: startedAt,
        rxBytes: 0,
        txBytes: 0,
        endpoint: "198.51.100.7:51820",
        error: null,
        ...(input.postQuantum ? { quantum: "active" as const } : {}),
        ...(input.obfuscation && vpn.obfuscationMode === "on" ? { obfuscated: true } : {}),
      };
      return { ...vpn.native };
    }),
    stop: vi.fn(async () => {
      log.push("vpn.stop");
      vpn.native = downStatus();
      return { ...vpn.native };
    }),
    status: vi.fn(async () => ({ ...vpn.native })),
    generateKeyPair: vi.fn(async () => {
      vpn.keyCounter += 1;
      log.push("vpn.generateKeyPair");
      return { privateKey: wgKey(vpn.keyCounter), publicKey: wgKey(100 + vpn.keyCounter) };
    }),
    publicKeyFromPrivate: vi.fn(async ({ privateKey }: { privateKey: string }) => ({
      publicKey: `${privateKey.slice(0, 40)}AAA=`,
    })),
    secureGet: vi.fn(async ({ key }: { key: string }) => ({ value: vpn.secure.get(key) ?? null })),
    secureSet: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      log.push(`secure.set ${key}`);
      vpn.secure.set(key, value);
    }),
    secureRemove: vi.fn(async ({ key }: { key: string }) => {
      log.push(`secure.remove ${key}`);
      vpn.secure.delete(key);
    }),
    clearSavedTunnel: vi.fn(async () => {
      log.push("vpn.clearSavedTunnel");
      vpn.native = downStatus();
    }),
    systemVpnState: vi.fn(async () => ({ supported: true, alwaysOn: true, lockdown: false })),
    wifi: { security: "none", autoConnect: false },
    wifiState: vi.fn(async () => ({ ...vpn.wifi })),
    setAutoConnectOpenWifi: vi.fn(async ({ enabled }: { enabled: boolean }) => {
      log.push(`vpn.setAutoConnectOpenWifi ${enabled}`);
      vpn.wifi.autoConnect = enabled;
      return { enabled };
    }),
    obfuscation: vi.fn(async () => ({ mode: vpn.obfuscationMode })),
    setObfuscation: vi.fn(async ({ mode }: { mode: "auto" | "off" | "on" }) => {
      log.push(`vpn.setObfuscation ${mode}`);
      vpn.obfuscationMode = mode;
      return { mode };
    }),
    openVpnSettings: vi.fn(async () => {
      log.push("vpn.openVpnSettings");
    }),
    openUrl: vi.fn(async ({ url }: { url: string }) => {
      log.push(`vpn.openUrl ${url}`);
    }),
    installedApps: vi.fn(async () => ({ apps: vpn.apps })),
    appInfo: vi.fn(async () => ({ versionName: "1.2.3", packageName: "net.mantel.app", sdkInt: 36 })),
    appIcon: vi.fn(async () => ({ icon: vpn.icon })),
    setAppIcon: vi.fn(async ({ icon }: { icon: "default" | "calculator" }) => {
      log.push(`vpn.setAppIcon ${icon}`);
      vpn.icon = icon;
      return { icon: vpn.icon };
    }),
    locales: vi.fn(async () => ({ system: [...vpn.systemLocales], app: vpn.appLanguage })),
    setAppLanguage: vi.fn(async ({ language }: { language: string }) => {
      log.push(`vpn.setAppLanguage ${language}`);
      vpn.appLanguage = language === "system" ? "en" : language;
      return { app: vpn.appLanguage };
    }),
    setAppTheme: vi.fn(async ({ theme }: { theme: string }) => {
      log.push(`vpn.setAppTheme ${theme}`);
      vpn.appTheme = theme;
      return { theme: theme === "dark" ? "dark" : "light" };
    }),
    addListener: vi.fn(async (event: "status" | "systemTheme", listener: (payload: never) => void) => {
      if (event === "systemTheme") {
        const themeListener = listener as (event: { theme: "light" | "dark" }) => void;
        vpn.themeListeners.push(themeListener);
        return {
          remove: async () => {
            vpn.themeListeners = vpn.themeListeners.filter((entry) => entry !== themeListener);
          },
        };
      }
      const statusListener = listener as (status: NativeTunnelStatus) => void;
      vpn.listeners.push(statusListener);
      return {
        remove: async () => {
          vpn.listeners = vpn.listeners.filter((entry) => entry !== statusListener);
        },
      };
    }),
  };
  return vpn as unknown as FakeVpn;
}

export function fakePreferences(initial: Record<string, unknown> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    data,
    get: vi.fn(async ({ key }: { key: string }) => ({ value: data.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      data.set(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      data.delete(key);
    }),
  };
}

export type ServerDevice = { id: string; name: string; nodeId: string; ipv4: string; publicKey: string };

export type Request = { method: string; path: string; headers: Record<string, string>; body: unknown };

export type Reply = { status: number; body?: unknown; headers?: Record<string, string>; raw?: string };

export const NODES: VpnNode[] = [
  {
    id: "fra",
    city: "Frankfurt",
    country: "DE",
    endpointHost: "198.51.100.7",
    endpointPort: 51820,
    online: true,
    postQuantum: true,
    obfuscation: { version: 1, port: 443, pin: OBFS_PIN },
  },
  { id: "ams", city: "Amsterdam", country: "NL", endpointHost: "ams.vpn.example", endpointPort: 51820, online: true },
  { id: "off", city: "Wien", country: "AT", endpointHost: "198.51.100.9", endpointPort: 51820, online: false },
];

export type FakeServer = {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  requests: Request[];
  devices: ServerDevice[];
  settings: AccountSettings;
  serverKeys: boolean;
  obfsTokens: boolean;
  override: Map<string, (request: Request) => Reply | undefined>;
  proxies: ServerProxy[] | null;
  token: string;
  nextId: number;
};

export const obfsTokenOf = (deviceId: string) => `obfs_${deviceId}_0123456789abcdef`;

export function fakeServer(log: CallLog, base = API_BASE_URL): FakeServer {
  const server: FakeServer = {
    requests: [],
    devices: [],
    settings: {
      killSwitch: true,
      lanAccess: false,
      ipv6: true,
      dns: { ads: false, trackers: false, malware: false, gambling: false, adult: false, social: false },
    },
    serverKeys: true,
    obfsTokens: false,
    override: new Map(),
    proxies: [],
    token: TOKEN,
    nextId: 1,
    fetch: async () => new Response(null),
  };

  const authorized = (request: Request) => request.headers.authorization === `Bearer ${server.token}`;
  const unauthorized: Reply = { status: 401, body: { code: "unauthorized", error: "Not signed in or the session has expired." } };

  const proxyRoute = (request: Request): Reply | undefined => {
    const list = server.proxies;
    if (!list || !request.path.startsWith("/api/v1/proxies")) return undefined;
    if (!authorized(request)) return unauthorized;
    const notFound: Reply = { status: 404, body: { code: "proxy_not_found", error: "Proxy not found." } };
    if (request.path === "/api/v1/proxies") {
      if (request.method === "GET") return { status: 200, body: { proxies: list } };
      if (request.method !== "POST") return undefined;
      const body = request.body as { name: string; nodeId: string; protocol: "socks5" | "http"; exit: "tor" | "direct" };
      const node = NODES.find((entry) => entry.id === body.nodeId);
      if (!node) return { status: 404, body: { code: "unknown_location", error: "Unknown location." } };
      const n = server.nextId++;
      const proxy: ServerProxy = {
        id: `px${n}`,
        name: body.name,
        nodeId: node.id,
        host: node.endpointHost,
        port: 20000 + n,
        protocol: body.protocol,
        exit: body.exit,
        username: `u${n}`,
        enabled: true,
        status: "pending",
      };
      list.push(proxy);
      return { status: 201, body: { proxy, password: `secret-${n}` } };
    }
    const id = /^\/api\/v1\/proxies\/([\w-]+)$/.exec(request.path)?.[1];
    const index = list.findIndex((proxy) => proxy.id === id);
    if (!id || index < 0) return notFound;
    if (request.method === "DELETE") {
      list.splice(index, 1);
      return { status: 204 };
    }
    if (request.method !== "PATCH") return undefined;
    const { rotatePassword, newCircuit, ...changes } = request.body as Record<string, unknown>;
    const proxy = { ...list[index]!, ...changes } as ServerProxy;
    list[index] = proxy;
    void newCircuit;
    return { status: 200, body: rotatePassword === true ? { proxy, password: `renewed-${proxy.id}` } : { proxy } };
  };

  const route = (request: Request): Reply => {
    const key = `${request.method} ${request.path}`;
    const custom = server.override.get(key)?.(request);
    if (custom) return custom;
    if (key === "POST /api/v1/auth/login") {
      const code = (request.body as { code?: string }).code;
      if (code !== ACCOUNT_CODE) return { status: 401, body: { code: "unknown_code", error: "This account number does not exist." } };
      return { status: 200, body: { token: server.token, account: { id: "acc1", paidUntil: "2027-01-01T00:00:00.000Z" } } };
    }
    if (key === "POST /api/v1/auth/logout") return authorized(request) ? { status: 204 } : unauthorized;
    if (key === "GET /api/v1/nodes") return { status: 200, body: NODES };
    if (key === "GET /api/v1/account") {
      if (!authorized(request)) return unauthorized;
      return {
        status: 200,
        body: {
          id: "acc1",
          paidUntil: "2027-01-01T00:00:00.000Z",
          expired: false,
          graceUntil: "2027-01-08T00:00:00.000Z",
          settings: server.settings,
          devices: server.devices.map((device) => ({
            id: device.id,
            name: device.name,
            nodeId: device.nodeId,
            ipv4: device.ipv4,
            ipv6: null,
            createdOn: "2026-10-01T00:00:00.000Z",
            legacy: false,
            missing: false,
            ...(server.obfsTokens ? { obfsToken: obfsTokenOf(device.id) } : {}),
          })),
        },
      };
    }
    if (key === "PATCH /api/v1/settings") {
      if (!authorized(request)) return unauthorized;
      const patch = request.body as Partial<AccountSettings>;
      server.settings = { ...server.settings, ...patch, dns: { ...server.settings.dns, ...(patch.dns ?? {}) } };
      return { status: 200, body: server.settings };
    }
    if (key === "POST /api/v1/devices") {
      if (!authorized(request)) return unauthorized;
      const body = request.body as { name: string; nodeId: string; publicKey: string };
      const node = NODES.find((entry) => entry.id === body.nodeId);
      if (!node) return { status: 404, body: { code: "unknown_location", error: "Unknown location." } };
      const id = `dev${server.nextId++}`;
      const ipv4 = `10.64.0.${server.nextId}`;
      server.devices.push({ id, name: body.name, nodeId: body.nodeId, ipv4, publicKey: body.publicKey });
      const privateKey = server.serverKeys ? wgKey(50 + server.nextId) : undefined;
      return {
        status: 201,
        body: {
          device: {
            id,
            name: body.name,
            nodeId: body.nodeId,
            ipv4,
            ipv6: "fd00::7",
            createdOn: "2026-10-22T00:00:00.000Z",
            ...(server.obfsTokens ? { obfsToken: obfsTokenOf(id) } : {}),
          },
          config: {
            address: [`${ipv4}/32`, "fd00:6d61:6e74::7/128"],
            dns: ["10.64.0.1", "fd00:6d61:6e74::1"],
            serverPublicKey: SERVER_PUBLIC_KEY,
            presharedKey: PRESHARED_KEY,
            endpoint: `${node.endpointHost}:${node.endpointPort}`,
            allowedIps: ["0.0.0.0/0", "::/0"],
            mtu: 1420,
            ...(privateKey ? { privateKey } : {}),
          },
          ...(privateKey ? { privateKey } : {}),
          killSwitchCompatible: true,
        },
      };
    }
    const proxyReply = proxyRoute(request);
    if (proxyReply) return proxyReply;
    const patchMatch = /^PATCH \/api\/v1\/devices\/([\w-]+)$/.exec(key);
    if (patchMatch) {
      if (!authorized(request)) return unauthorized;
      const device = server.devices.find((entry) => entry.id === patchMatch[1]);
      if (!device) return { status: 404, body: { code: "device_not_found", error: "Device not found." } };
      const name = (request.body as { name?: unknown }).name;
      if (typeof name !== "string" || name.length > 32) {
        return { status: 400, body: { code: "device_name_too_long", error: "Device names can have at most 32 characters.", params: { max: 32 } } };
      }
      device.name = name;
      return {
        status: 200,
        body: { id: device.id, name, nodeId: device.nodeId, ipv4: device.ipv4, ipv6: null, createdOn: "2026-10-01T00:00:00.000Z" },
      };
    }
    const deleteMatch = /^DELETE \/api\/v1\/devices\/([\w-]+)$/.exec(key);
    if (deleteMatch) {
      if (!authorized(request)) return unauthorized;
      const before = server.devices.length;
      server.devices = server.devices.filter((device) => device.id !== deleteMatch[1]);
      return server.devices.length === before ? { status: 404, body: { code: "device_not_found", error: "Device not found." } } : { status: 204 };
    }
    return { status: 404, body: { code: "not_found", error: "Not found." } };
  };

  server.fetch = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.origin !== new URL(base).origin) throw new TypeError("fetch failed");
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const request: Request = {
      method: init.method ?? "GET",
      path: url.pathname,
      headers,
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    };
    server.requests.push(request);
    log.push(`api ${request.method} ${request.path}`);
    const reply = route(request);
    const text = reply.raw ?? (reply.body === undefined ? null : JSON.stringify(reply.body));
    return new Response(reply.status === 204 ? null : text, {
      status: reply.status,
      headers: { "content-type": "application/json; charset=utf-8", ...(reply.headers ?? {}) },
    });
  };
  return server;
}
