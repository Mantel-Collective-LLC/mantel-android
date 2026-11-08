import { afterEach, describe, expect, it, vi } from "vitest";
import type { TunnelStatus } from "@shared/contract";
import { STALE_HANDSHAKE_MS } from "@shared/contract";
import { DICTIONARIES } from "@shared/i18n";
import type { ApiRequestRecord } from "../lib/api-client";
import { KEYS, SECURE_KEYS } from "../lib/storage";
import {
  ACCOUNT_CODE,
  NODES,
  PRESHARED_KEY,
  TOKEN,
  fakePreferences,
  fakeServer,
  fakeVpn,
  wgKey,
  type CallLog,
} from "../test/fakes";
import { createAndroidBridgeWithController } from "./android-bridge";
import type { Visibility } from "./controller";
import { API_BASE_URL } from "../flavor";

const SYSTEM_KILL_SWITCH = DICTIONARIES.de.errors.systemKillSwitch;
const PERMISSION_DENIED = DICTIONARIES.de.errors.vpnPermissionDenied;

type SetupOptions = {
  prefs?: Record<string, unknown>;
  secure?: Record<string, string>;
  visibility?: Visibility | null;
  pollIntervalMs?: number;
  secureBroken?: boolean;
  native?: Partial<ReturnType<typeof fakeVpn>["native"]>;
  logoutCallTimeoutMs?: number;
  logoutBudgetMs?: number;
  nativeLocales?: boolean;
  flavor?: "debug" | "prod";
  baseUrl?: string;
  onApiRequest?: (record: ApiRequestRecord) => void;
  appVersion?: string;
};

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});

async function setup(options: SetupOptions = {}) {
  const log: CallLog = [];
  const vpn = fakeVpn(log);
  if (options.native) vpn.native = { ...vpn.native, ...options.native };
  if (options.appVersion) {
    vi.mocked(vpn.appInfo!).mockResolvedValue({ versionName: options.appVersion, packageName: "net.mantel.app", sdkInt: 36 });
  }
  if (options.nativeLocales === false) {
    vi.mocked(vpn.locales!).mockRejectedValue(new Error("not implemented"));
  }
  for (const [key, value] of Object.entries(options.secure ?? {})) vpn.secure.set(key, value);
  if (options.secureBroken) {
    vpn.secureGet.mockRejectedValue(new Error("Keystore kaputt"));
    vpn.secureSet.mockRejectedValue(new Error("Keystore kaputt"));
  }
  const server = fakeServer(log);
  const prefs = fakePreferences(options.prefs);
  const { bridge, controller } = createAndroidBridgeWithController({
    vpn,
    preferences: prefs,
    fetch: (input, init) => server.fetch(input, init),
    visibility: options.visibility ?? null,
    pollIntervalMs: options.pollIntervalMs,
    randomSuffix: () => "ABCD",
    logoutCallTimeoutMs: options.logoutCallTimeoutMs,
    logoutBudgetMs: options.logoutBudgetMs,
    flavor: options.flavor,
    baseUrl: options.baseUrl,
    onApiRequest: options.onApiRequest,
  });
  disposers.push(() => controller.dispose());
  await controller.ready;
  const statuses: TunnelStatus[] = [];
  bridge.onTunnelStatus((status) => statuses.push(status));
  return { log, vpn, server, prefs, bridge, controller, statuses };
}

async function loggedIn(options: SetupOptions = {}) {
  const context = await setup(options);
  const result = await context.bridge.login(ACCOUNT_CODE);
  expect(result.ok).toBe(true);
  context.log.length = 0;
  return context;
}

function prefValue(prefs: ReturnType<typeof fakePreferences>, key: string): unknown {
  const raw = prefs.data.get(key);
  return raw === undefined ? undefined : JSON.parse(raw);
}

function configLine(config: string, name: string): string | undefined {
  return config
    .split("\n")
    .find((line) => line.startsWith(`${name} = `))
    ?.slice(name.length + 3);
}

describe("language", () => {
  it("is English unless German is chosen, whatever the OS language; still reports the OS language", async () => {
    const { bridge, vpn } = await setup();
    expect(await bridge.login("12345")).toEqual({ ok: false, error: "Ungültige Eingabe.", code: "invalid" });
    vpn.appLanguage = null;
    expect((await bridge.preferences()).language).toBe("en");
    expect(await bridge.environment()).toMatchObject({ systemLanguage: "de", systemLocale: "de-DE" });
    expect(await bridge.login("12345")).toEqual({ ok: false, error: "Invalid input.", code: "invalid" });
    vpn.systemLocales = ["en-US", "de-DE"];
    expect((await bridge.environment()).systemLanguage).toBe("en");
  });

  it("stores an explicit choice, applies it natively and translates errors with it", async () => {
    const { bridge, vpn, prefs, server, log } = await loggedIn();
    expect(await bridge.setLanguage!("en")).toMatchObject({ ok: true, value: { language: "en" } });
    expect(log).toContain("vpn.setAppLanguage en");
    expect(vpn.appLanguage).toBe("en");
    expect(prefs.data.has(KEYS.language)).toBe(false);
    expect((await bridge.environment()).systemLanguage).toBe("de");
    expect(await bridge.setAlwaysOnKillSwitch(true)).toEqual({
      ok: false,
      error: DICTIONARIES.en.errors.systemKillSwitch,
      code: "invalid",
    });
    expect(await bridge.connect("off")).toEqual({ ok: false, error: "Wien is not reachable right now. Choose another location or try again later.", code: "server" });
    expect(server.requests.at(-1)?.headers["accept-language"]).toBe("en");
    expect(await bridge.setLanguage!("fr" as never)).toMatchObject({ ok: false, code: "invalid" });

    expect(await bridge.setLanguage!("de")).toMatchObject({ ok: true, value: { language: "de" } });
    expect(vpn.appLanguage).toBe("de");
    expect(prefValue(prefs, KEYS.language)).toBe("de");
    expect(await bridge.connect("off")).toEqual({ ok: false, error: "Wien ist gerade nicht erreichbar. Wähle einen anderen Standort oder versuch es später.", code: "server" });

    expect(await bridge.setLanguage!("system")).toMatchObject({ ok: true, value: { language: "en" } });
    expect(vpn.appLanguage).toBe("en");
    expect(prefs.data.has(KEYS.language)).toBe(false);
    expect(await bridge.connect("off")).toEqual({ ok: false, error: "Wien is not reachable right now. Choose another location or try again later.", code: "server" });
  });

  it("adopts a per-app language set in the Android settings", async () => {
    const { bridge, vpn, prefs } = await setup({ prefs: { [KEYS.language]: "de" } });
    vpn.appLanguage = "en-GB";
    expect((await bridge.preferences()).language).toBe("en");
    expect(prefs.data.has(KEYS.language)).toBe(false);
    vpn.appLanguage = null;
    expect((await bridge.preferences()).language).toBe("en");
  });

  it("keeps the stored choice when the native side cannot tell (older build)", async () => {
    const { bridge, vpn } = await setup({ prefs: { [KEYS.language]: "en" }, nativeLocales: false });
    expect((await bridge.preferences()).language).toBe("en");
    expect(await bridge.login("12345")).toEqual({ ok: false, error: "Invalid input.", code: "invalid" });
    expect(vpn.setAppLanguage).not.toHaveBeenCalled();
  });
});

describe("design (light/dark)", () => {
  it("defaults to System and does not touch the native side on startup", async () => {
    const { bridge, vpn } = await setup();
    expect((await bridge.preferences()).theme).toBe("system");
    expect(vpn.setAppTheme).not.toHaveBeenCalled();
  });

  it("stores an explicit choice, applies it natively and restores it on the next start", async () => {
    const { bridge, vpn, prefs, log } = await setup();
    expect(await bridge.setTheme!("dark")).toMatchObject({ ok: true, value: { theme: "dark" } });
    expect(log).toContain("vpn.setAppTheme dark");
    expect(vpn.appTheme).toBe("dark");
    expect(prefValue(prefs, KEYS.theme)).toBe("dark");

    const next = await setup({ prefs: { [KEYS.theme]: "dark" } });
    expect((await next.bridge.preferences()).theme).toBe("dark");

    expect(await bridge.setTheme!("system")).toMatchObject({ ok: true, value: { theme: "system" } });
    expect(vpn.appTheme).toBe("system");
    expect(prefs.data.has(KEYS.theme)).toBe(false);
  });

  it("rejects unknown values and ignores a corrupt stored one", async () => {
    const { bridge, vpn } = await setup({ prefs: { [KEYS.theme]: "sepia" } });
    expect((await bridge.preferences()).theme).toBe("system");
    expect(await bridge.setTheme!("sepia" as never)).toMatchObject({ ok: false, code: "invalid" });
    expect(vpn.setAppTheme).not.toHaveBeenCalled();
  });

  it("keeps the choice when the native side fails (older build)", async () => {
    const { bridge, vpn, prefs } = await setup();
    vi.mocked(vpn.setAppTheme!).mockRejectedValue(new Error("not implemented"));
    expect(await bridge.setTheme!("light")).toMatchObject({ ok: true, value: { theme: "light" } });
    expect(prefValue(prefs, KEYS.theme)).toBe("light");
  });

  it("reports native night-mode switches until unsubscribed", async () => {
    const { bridge, vpn } = await setup();
    const seen: string[] = [];
    const stop = bridge.onSystemThemeChange!((theme) => seen.push(theme));
    await vi.waitFor(() => expect(vpn.themeListeners).toHaveLength(1));
    vpn.emitSystemTheme("dark");
    vpn.emitSystemTheme("light");
    expect(seen).toEqual(["dark", "light"]);
    stop();
    await vi.waitFor(() => expect(vpn.themeListeners).toHaveLength(0));
    vpn.emitSystemTheme("dark");
    expect(seen).toEqual(["dark", "light"]);
  });

  it("is reset by the debug wipe", async () => {
    const { bridge, controller, vpn, prefs } = await setup();
    await bridge.setTheme!("dark");
    await controller.wipeLocalData();
    expect(prefs.data.has(KEYS.theme)).toBe(false);
    expect(controller.preferences().theme).toBe("system");
    expect(vpn.appTheme).toBe("system");
  });
});

describe("environment and preferences", () => {
  it("reports Android, its features and the native app version", async () => {
    const { bridge } = await setup();
    expect(await bridge.environment()).toEqual({
      platform: "android",
      elevated: true,
      wireguardInstalled: true,
      wireguardPath: null,
      wireguardSource: null,
      encryptionAvailable: true,
      appVersion: "1.2.3",
      features: { desktopWindow: false, managedWireGuard: false, firewallLockdown: false, systemLockdown: true, appExclusion: true, appDisguise: true },
      systemLanguage: "de",
      systemLocale: "de-DE",
    });
  });

  it("reports encryption as unavailable when the Keystore fails", async () => {
    const { bridge } = await setup({ secureBroken: true });
    expect((await bridge.environment()).encryptionAvailable).toBe(false);
  });

  it("starts logged out and disconnected with default preferences", async () => {
    const { bridge } = await setup();
    expect(await bridge.session()).toEqual({ loggedIn: false, accountId: null, paidUntil: null });
    expect((await bridge.tunnelStatus()).phase).toBe("disconnected");
    expect(await bridge.preferences()).toEqual({
      baseUrl: API_BASE_URL,
      alwaysOnKillSwitch: false,
      lastNodeId: null,
      language: "de",
      theme: "system",
      postQuantum: false,
      autoConnectOpenWifi: false,
      obfuscation: "auto",
    });
  });

  it("refuses the desktop kill switch and treats the WireGuard setup as done", async () => {
    const { bridge } = await setup();
    expect(await bridge.setAlwaysOnKillSwitch(true)).toEqual({ ok: false, error: SYSTEM_KILL_SWITCH, code: "invalid" });
    expect(await bridge.setAlwaysOnKillSwitch(false)).toMatchObject({ ok: true, value: { alwaysOnKillSwitch: false } });
    expect(await bridge.setAlwaysOnKillSwitch("yes" as unknown as boolean)).toMatchObject({ ok: false, code: "invalid" });
    expect((await bridge.installWireGuard()).ok).toBe(true);
    await expect(bridge.openWireGuardDownload()).resolves.toBeUndefined();
    expect((await bridge.preferences()).alwaysOnKillSwitch).toBe(false);
  });

  it("has no way to change the server: it is fixed when the bundle is built", async () => {
    const { bridge, server } = await setup();
    expect("setBaseUrl" in bridge).toBe(false);
    expect(API_BASE_URL).toBe("http://10.0.2.2:3000");
    expect(await bridge.nodes()).toMatchObject({ ok: true });
    expect(server.requests.at(-1)?.path).toBe("/api/v1/nodes");
  });

  it("loads persisted preferences and remembers the selected node", async () => {
    const { bridge, prefs } = await setup({ prefs: { [KEYS.preferences]: { baseUrl: API_BASE_URL, lastNodeId: "fra" } } });
    expect((await bridge.preferences()).lastNodeId).toBe("fra");
    expect(await bridge.selectNode("../etc")).toMatchObject({ ok: false, code: "invalid" });
    expect(await bridge.selectNode("ams")).toMatchObject({ ok: true, value: { lastNodeId: "ams" } });
    expect(prefValue(prefs, KEYS.preferences)).toEqual({ baseUrl: API_BASE_URL, lastNodeId: "ams" });
  });
});

describe("login and session", () => {
  it("logs in and keeps the token in the Keystore only", async () => {
    const { bridge, vpn, prefs } = await setup();
    const result = await bridge.login(ACCOUNT_CODE);
    expect(result).toEqual({ ok: true, value: { loggedIn: true, accountId: "acc1", paidUntil: "2027-01-01T00:00:00.000Z" } });
    expect(JSON.parse(vpn.secure.get(SECURE_KEYS.session) ?? "{}")).toMatchObject({ token: TOKEN, accountId: "acc1" });
    for (const value of prefs.data.values()) expect(value).not.toContain(TOKEN);
    expect(await bridge.session()).toMatchObject({ loggedIn: true });
  });

  it("restores a persisted session", async () => {
    const { bridge } = await setup({
      secure: { [SECURE_KEYS.session]: JSON.stringify({ token: TOKEN, accountId: "acc1", paidUntil: null }) },
    });
    expect(await bridge.session()).toEqual({ loggedIn: true, accountId: "acc1", paidUntil: null });
    expect((await bridge.account()).ok).toBe(true);
  });

  it("maps login failures to the server's message and error codes", async () => {
    const { bridge, server } = await setup();
    const ended = vi.fn();
    bridge.onSessionEnded(ended);
    expect(await bridge.login("1111222233334444")).toEqual({ ok: false, error: "Diese Kontonummer kennen wir nicht.", code: "unauthorized" });
    expect(ended).not.toHaveBeenCalled();

    server.override.set("POST /api/v1/auth/login", () => ({ status: 429, body: { error: "Zu viele Versuche." } }));
    expect(await bridge.login(ACCOUNT_CODE)).toEqual({ ok: false, error: "Zu viele Versuche.", code: "rate_limited" });

    server.override.set("POST /api/v1/auth/login", () => ({ status: 503, raw: "" }));
    expect(await bridge.login(ACCOUNT_CODE)).toEqual({ ok: false, error: "Serverfehler (503).", code: "server" });

    const requests = server.requests.length;
    expect(await bridge.login("12345")).toEqual({ ok: false, error: "Ungültige Eingabe.", code: "invalid" });
    expect(await bridge.login(1234567812345678 as unknown as string)).toMatchObject({ code: "invalid" });
    expect(server.requests).toHaveLength(requests);
  });

  it("two-factor login: totp is always sent, totp_required asks for the code, the second call carries it", async () => {
    const { bridge, server } = await setup();
    const bodies: unknown[] = [];
    server.override.set("POST /api/v1/auth/login", (request) => {
      bodies.push(request.body);
      const { totp } = request.body as { totp?: string | null };
      if (!totp) return { status: 401, body: { code: "totp_required", error: "x" } };
      if (totp !== "123456") return { status: 401, body: { code: "totp_invalid", error: "x" } };
      return undefined;
    });
    expect(await bridge.login(ACCOUNT_CODE)).toMatchObject({ ok: false, code: "totp_required" });
    expect(await bridge.login(ACCOUNT_CODE, "000000")).toEqual({ ok: false, error: "Der Code stimmt nicht oder wurde schon benutzt. Warte auf den nächsten Code in der App.", code: "invalid" });
    expect(await bridge.login(ACCOUNT_CODE, "123456")).toMatchObject({ ok: true, value: { loggedIn: true } });
    expect(bodies).toEqual([
      { code: ACCOUNT_CODE, totp: null },
      { code: ACCOUNT_CODE, totp: "000000" },
      { code: ACCOUNT_CODE, totp: "123456" },
    ]);
    expect(await bridge.login(ACCOUNT_CODE, "<script>")).toMatchObject({ ok: false, code: "invalid" });
  });

  it("reports an unreachable server", async () => {
    const { bridge, server } = await setup();
    server.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await bridge.login(ACCOUNT_CODE)).toEqual({
      ok: false,
      error: "Server nicht erreichbar. Prüfe deine Verbindung.",
      code: "network",
    });
  });

  it("ends the session on 401 from an authenticated call", async () => {
    const { bridge, server, vpn } = await loggedIn();
    const ended = vi.fn();
    bridge.onSessionEnded(ended);
    server.token = "tok_revoked_revoked_revoked_revoked";
    const result = await bridge.account();
    expect(result).toEqual({ ok: false, error: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.", code: "unauthorized" });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(await bridge.session()).toEqual({ loggedIn: false, accountId: null, paidUntil: null });
    expect(JSON.parse(vpn.secure.get(SECURE_KEYS.session) ?? "{}").token).toBeNull();
    expect(await bridge.updateSettings({ ipv6: false })).toEqual({ ok: false, error: "Nicht angemeldet.", code: "unauthorized" });
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("validates settings patches like the desktop IPC layer", async () => {
    const { bridge, server } = await loggedIn();
    const before = server.requests.length;
    for (const patch of [{ killSwitch: "ja" }, { unknown: true }, { dns: { porn: true } }, null]) {
      expect(await bridge.updateSettings(patch as never)).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(server.requests).toHaveLength(before);
    expect(await bridge.updateSettings({ dns: { ads: true } })).toMatchObject({ ok: true, value: { dns: { ads: true } } });
  });
});

describe("connect", () => {
  it("prepares, registers a device and starts the tunnel with the built config", async () => {
    const { bridge, vpn, server, prefs, log } = await loggedIn({ prefs: { [KEYS.excludedApps]: ["org.example.bank"] } });
    const result = await bridge.connect("fra");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(log.indexOf("vpn.prepare")).toBe(0);
    expect(log).toContain("vpn.requestNotificationPermission");
    expect(log.indexOf("api POST /api/v1/devices")).toBeGreaterThan(log.indexOf("api GET /api/v1/account"));
    expect(log.indexOf("vpn.start fra")).toBeGreaterThan(log.indexOf("api POST /api/v1/devices"));

    const register = server.requests.find((request) => request.method === "POST" && request.path === "/api/v1/devices");
    expect(register?.body).toEqual({ name: "Android ABCD", nodeId: "fra", publicKey: wgKey(101) });
    expect(register?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(register?.headers["user-agent"]).toBe("MantelAndroid/1.2.3 (Android)");

    const start = vpn.lastStart!;
    expect(start.nodeId).toBe("fra");
    expect(start.label).toBe("Frankfurt");
    expect(start.excludedApps).toEqual(["org.example.bank"]);
    expect(configLine(start.config, "PrivateKey")).toBe(wgKey(52));
    expect(configLine(start.config, "PresharedKey")).toBe(PRESHARED_KEY);
    expect(configLine(start.config, "Address")).toBe("10.64.0.2/32, fd00:6d61:6e74::7/128");
    expect(configLine(start.config, "DNS")).toBe("10.64.0.1, fd00:6d61:6e74::1");
    expect(configLine(start.config, "AllowedIPs")).toBe("0.0.0.0/0, ::/0");
    expect(configLine(start.config, "Endpoint")).toBe("198.51.100.7:51820");

    expect(result.value).toMatchObject({
      phase: "connected",
      nodeId: "fra",
      addresses: ["10.64.0.2/32", "fd00:6d61:6e74::7/128"],
      dns: ["10.64.0.1", "fd00:6d61:6e74::1"],
      leakProtection: "wireguard",
      firewallActive: false,
      error: null,
    });
    expect((await bridge.preferences()).lastNodeId).toBe("fra");

    const keys = JSON.parse(vpn.secure.get(SECURE_KEYS.deviceKeys) ?? "{}");
    expect(keys).toEqual({ privateKey: wgKey(52), presharedKey: PRESHARED_KEY });
    const meta = prefs.data.get(KEYS.device) ?? "";
    expect(JSON.parse(meta)).toMatchObject({ id: "dev1", nodeId: "fra", keySource: "server" });
    expect(meta).not.toContain(wgKey(52));
    expect(meta).not.toContain(PRESHARED_KEY);
  });

  it("uses the locally generated key when the server does not send one", async () => {
    const { bridge, vpn, server } = await loggedIn();
    server.serverKeys = false;
    await bridge.connect("fra");
    expect(configLine(vpn.lastStart!.config, "PrivateKey")).toBe(wgKey(1));
  });

  it("routes LAN outside the tunnel with LAN access (no /0, tunnel DNS re-added)", async () => {
    const { bridge, vpn, server } = await loggedIn();
    server.settings = { ...server.settings, killSwitch: true, lanAccess: true };
    const result = await bridge.connect("fra");
    const allowed = configLine(vpn.lastStart!.config, "AllowedIPs")!.split(", ");
    expect(allowed.some((cidr) => cidr.endsWith("/0"))).toBe(false);
    expect(allowed).toContain("10.64.0.1/32");
    expect(allowed).not.toContain("192.168.0.0/16");
    expect(result.ok && result.value.leakProtection).toBe("firewall");
  });

  it("uses split default routes without kill switch and drops IPv6 when it is off", async () => {
    const { bridge, vpn, server } = await loggedIn();
    server.settings = { ...server.settings, killSwitch: false, lanAccess: false, ipv6: false };
    const result = await bridge.connect("fra");
    const config = vpn.lastStart!.config;
    expect(configLine(config, "AllowedIPs")).toBe("0.0.0.0/1, 128.0.0.0/1, ::/1, 8000::/1");
    expect(configLine(config, "Address")).toBe("10.64.0.2/32");
    expect(configLine(config, "DNS")).toBe("10.64.0.1");
    expect(result.ok && result.value).toMatchObject({ leakProtection: "none", addresses: ["10.64.0.2/32"], dns: ["10.64.0.1"] });
  });

  it("passes host name endpoints through to wireguard-go", async () => {
    const { bridge, vpn } = await loggedIn();
    await bridge.connect("ams");
    expect(configLine(vpn.lastStart!.config, "Endpoint")).toBe("ams.vpn.example:51820");
  });

  it("stops before touching the API when the VPN permission is denied", async () => {
    const { bridge, vpn, server, log } = await loggedIn();
    vpn.prepare.mockResolvedValueOnce({ granted: false });
    const requests = server.requests.length;
    const result = await bridge.connect("fra");
    expect(result).toEqual({ ok: false, error: PERMISSION_DENIED, code: "elevation" });
    expect(server.requests).toHaveLength(requests);
    expect(log).not.toContain("vpn.start fra");
    expect(await bridge.tunnelStatus()).toMatchObject({ phase: "disconnected", error: PERMISSION_DENIED });
  });

  it("asks for the notification permission only once and does not fail when it is denied", async () => {
    const { bridge, vpn } = await loggedIn();
    vpn.requestNotificationPermission.mockRejectedValueOnce(new Error("no activity"));
    expect((await bridge.connect("fra")).ok).toBe(true);
    await bridge.disconnect();
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(vpn.requestNotificationPermission).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown and offline locations and invalid ids", async () => {
    const { bridge, vpn } = await loggedIn();
    expect(await bridge.connect("nope")).toEqual({ ok: false, error: "Diesen Standort gibt es nicht mehr.", code: "invalid" });
    expect(await bridge.connect("off")).toEqual({ ok: false, error: "Wien ist gerade nicht erreichbar. Wähle einen anderen Standort oder versuch es später.", code: "server" });
    expect(await bridge.connect("fra; rm -rf /")).toEqual({ ok: false, error: "Ungültige Eingabe.", code: "invalid" });
    expect(vpn.start).not.toHaveBeenCalled();
  });

  it("stops the tunnel again and reports the error when the native start fails", async () => {
    const { bridge, vpn } = await loggedIn();
    vpn.start.mockRejectedValueOnce(new Error("Der Tunnel konnte nicht gestartet werden."));
    const result = await bridge.connect("fra");
    expect(result).toEqual({ ok: false, error: "Der Tunnel konnte nicht gestartet werden.", code: "internal" });
    expect(vpn.stop).toHaveBeenCalled();
    expect(await bridge.tunnelStatus()).toMatchObject({ phase: "disconnected", error: "Der Tunnel konnte nicht gestartet werden." });
  });

  it("serializes double taps", async () => {
    const { bridge, server, log } = await loggedIn();
    const [first, second] = await Promise.all([bridge.connect("fra"), bridge.connect("fra")]);
    expect(first.ok && second.ok).toBe(true);
    expect(server.requests.filter((request) => request.method === "POST" && request.path === "/api/v1/devices")).toHaveLength(1);
    const starts = log.map((entry, index) => (entry === "vpn.start fra" ? index : -1)).filter((index) => index >= 0);
    const prepares = log.map((entry, index) => (entry === "vpn.prepare" ? index : -1)).filter((index) => index >= 0);
    expect(prepares[1]).toBeGreaterThan(starts[0]!);
  });
});

describe("device lifecycle", () => {
  it("reuses the device for the same node while the server still lists it", async () => {
    const { bridge, server, vpn } = await loggedIn();
    await bridge.connect("fra");
    await bridge.disconnect();
    await bridge.connect("fra");
    expect(server.requests.filter((request) => request.path === "/api/v1/devices")).toHaveLength(1);
    expect(vpn.generateKeyPair).toHaveBeenCalledTimes(1);
    expect(server.devices.map((device) => device.id)).toEqual(["dev1"]);
  });

  it("replaces the device on a node switch: new device, new tunnel, then the old device is deleted", async () => {
    const { bridge, server, prefs, log } = await loggedIn();
    await bridge.connect("fra");
    log.length = 0;
    const result = await bridge.connect("ams");
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(log).toContain("api DELETE /api/v1/devices/dev1"));
    expect(log.indexOf("api POST /api/v1/devices")).toBeLessThan(log.indexOf("vpn.start ams"));
    expect(log.indexOf("vpn.start ams")).toBeLessThan(log.indexOf("api DELETE /api/v1/devices/dev1"));
    expect(server.devices.map((device) => device.nodeId)).toEqual(["ams"]);
    expect(prefValue(prefs, KEYS.device)).toMatchObject({ id: "dev2", nodeId: "ams" });
    await vi.waitFor(() => expect(prefs.data.has(KEYS.staleDevices)).toBe(false));
  });

  it("frees the old slot first when the account is at its device limit", async () => {
    const { bridge, server, log } = await loggedIn();
    await bridge.connect("fra");
    let refused = false;
    server.override.set("POST /api/v1/devices", () => {
      if (refused) return undefined;
      refused = true;
      return { status: 409, body: { error: "Zu viele Geräte." } };
    });
    log.length = 0;
    expect((await bridge.connect("ams")).ok).toBe(true);
    expect(log.filter((entry) => entry.startsWith("api ")).slice(2)).toEqual([
      "api POST /api/v1/devices",
      "api DELETE /api/v1/devices/dev1",
      "api POST /api/v1/devices",
    ]);
    expect(server.devices.map((device) => device.id)).toEqual(["dev2"]);
  });

  it("frees the slot only for device_limit_reached, not for other 409 codes", async () => {
    const limited = await loggedIn();
    await limited.bridge.connect("fra");
    let refused = false;
    limited.server.override.set("POST /api/v1/devices", () => {
      if (refused) return undefined;
      refused = true;
      return { status: 409, body: { code: "device_limit_reached", error: "An account can have at most 5 devices.", params: { max: 5 } } };
    });
    expect((await limited.bridge.connect("ams")).ok).toBe(true);
    expect(limited.server.devices.map((device) => device.id)).toEqual(["dev2"]);

    const taken = await loggedIn();
    await taken.bridge.connect("fra");
    taken.server.override.set("POST /api/v1/devices", () => ({
      status: 409,
      body: { code: "public_key_taken", error: "This public key is already registered for a device." },
    }));
    taken.log.length = 0;
    const result = await taken.bridge.connect("ams");
    expect(result).toMatchObject({ ok: false, error: "Dieser Geräteschlüssel ist schon registriert. Versuch es erneut." });
    expect(taken.log.some((entry) => entry.startsWith("api DELETE"))).toBe(false);
    expect(taken.server.devices.map((device) => device.id)).toEqual(["dev1"]);
  });

  it("registers a new device without deleting when the old one is gone on the server", async () => {
    const { bridge, server, log } = await loggedIn();
    await bridge.connect("fra");
    server.devices = [];
    log.length = 0;
    await bridge.connect("fra");
    expect(log).toContain("api POST /api/v1/devices");
    expect(log.some((entry) => entry.startsWith("api DELETE"))).toBe(false);
  });

  it("replaces a device whose private key was lost from the Keystore", async () => {
    const first = await loggedIn();
    await first.bridge.connect("fra");
    first.vpn.secure.delete(SECURE_KEYS.deviceKeys);
    const log: CallLog = [];
    const vpn = fakeVpn(log);
    vpn.secure = first.vpn.secure;
    vpn.keyCounter = 10;
    const { bridge, controller } = createAndroidBridgeWithController({
      vpn,
      preferences: first.prefs,
      fetch: first.server.fetch,
      visibility: null,
      randomSuffix: () => "ABCD",
    });
    disposers.push(() => controller.dispose());
    await controller.ready;
    expect((await bridge.connect("fra")).ok).toBe(true);
    await vi.waitFor(() => expect(first.server.devices.map((device) => device.id)).toEqual(["dev2"]));
  });

  it("names the device after the phone model when the plugin reports one", async () => {
    const log: CallLog = [];
    const vpn = fakeVpn(log);
    vpn.appInfo.mockResolvedValue({ versionName: "1.2.3", packageName: "net.mantel.app", sdkInt: 36, model: " Pixel​ 8   Pro " });
    const server = fakeServer(log);
    const { bridge, controller } = createAndroidBridgeWithController({
      vpn,
      preferences: fakePreferences(),
      fetch: server.fetch,
      visibility: null,
    });
    disposers.push(() => controller.dispose());
    await bridge.login(ACCOUNT_CODE);
    await bridge.connect("fra");
    expect(server.devices[0]?.name).toBe("Android · Pixel 8 Pro");
  });
});

describe("logout", () => {
  it("cleans up on the server first, then stops and forgets the tunnel, then wipes secrets", async () => {
    const { bridge, vpn, server, prefs, log } = await loggedIn();
    await bridge.connect("fra");
    log.length = 0;
    expect(await bridge.logout()).toEqual({ ok: true, value: null });
    expect(log).toEqual([
      "api DELETE /api/v1/devices/dev1",
      "vpn.clearSavedTunnel",
      "vpn.stop",
      "api POST /api/v1/auth/logout",
      `secure.remove ${SECURE_KEYS.session}`,
      `secure.remove ${SECURE_KEYS.deviceKeys}`,
      `secure.remove ${SECURE_KEYS.ticketKey}`,
    ]);
    expect(vpn.secure.size).toBe(0);
    expect(server.devices).toEqual([]);
    expect(prefs.data.has(KEYS.device)).toBe(false);
    expect(prefs.data.has(KEYS.runtime)).toBe(false);
    expect(await bridge.session()).toEqual({ loggedIn: false, accountId: null, paidUntil: null });
    expect((await bridge.tunnelStatus()).phase).toBe("disconnected");
  });

  it("revokes the token before touching the tunnel when no tunnel runs", async () => {
    const { bridge, server, log } = await loggedIn();
    await bridge.connect("fra");
    await bridge.disconnect();
    log.length = 0;
    expect((await bridge.logout()).ok).toBe(true);
    expect(log.slice(0, 4)).toEqual([
      "api DELETE /api/v1/devices/dev1",
      "api POST /api/v1/auth/logout",
      "vpn.clearSavedTunnel",
      "vpn.stop",
    ]);
    expect(server.devices).toEqual([]);
  });

  it("deletes the device under lockdown (API only reachable while the tunnel is up)", async () => {
    const { bridge, vpn, server, log } = await loggedIn();
    await bridge.connect("fra");
    const reachable = server.fetch;
    server.fetch = async (input, init) => {
      if (vpn.native.state !== "up") throw new TypeError("Failed to fetch");
      return reachable(input, init);
    };
    log.length = 0;
    expect((await bridge.logout()).ok).toBe(true);
    expect(server.devices).toEqual([]);
    expect(log.indexOf("api DELETE /api/v1/devices/dev1")).toBeLessThan(log.indexOf("vpn.clearSavedTunnel"));
    expect(vpn.clearSavedTunnel).toHaveBeenCalled();
    expect(vpn.secure.size).toBe(0);
    expect(await bridge.session()).toEqual({ loggedIn: false, accountId: null, paidUntil: null });
  });

  it("deletes devices replaced earlier before the current one", async () => {
    const { bridge, server, log } = await loggedIn();
    await bridge.connect("fra");
    server.override.set("DELETE /api/v1/devices/dev1", () => ({ status: 500, body: { error: "kaputt" } }));
    await bridge.connect("ams");
    await vi.waitFor(() => expect(log.filter((entry) => entry === "api DELETE /api/v1/devices/dev1")).toHaveLength(1));
    server.override.clear();
    log.length = 0;
    expect((await bridge.logout()).ok).toBe(true);
    expect(log.slice(0, 2)).toEqual(["api DELETE /api/v1/devices/dev1", "api DELETE /api/v1/devices/dev2"]);
    expect(server.devices).toEqual([]);
  });

  it("gives up on a hanging server after the logout budget and still wipes everything", async () => {
    const { bridge, vpn, server } = await loggedIn({ logoutCallTimeoutMs: 50, logoutBudgetMs: 120 });
    await bridge.connect("fra");
    server.fetch = () => new Promise<Response>(() => undefined);
    const started = Date.now();
    expect((await bridge.logout()).ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(vpn.clearSavedTunnel).toHaveBeenCalled();
    expect(vpn.secure.size).toBe(0);
  });

  it("still wipes everything when the server is unreachable", async () => {
    const { bridge, vpn, server } = await loggedIn({ logoutCallTimeoutMs: 200 });
    await bridge.connect("fra");
    server.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect((await bridge.logout()).ok).toBe(true);
    expect(vpn.clearSavedTunnel).toHaveBeenCalled();
    expect(vpn.secure.size).toBe(0);
  });

  it("drops the old account's device and tunnel when another account logs in", async () => {
    const { bridge, server, vpn, prefs } = await loggedIn();
    await bridge.connect("fra");
    server.override.set("POST /api/v1/auth/login", () => ({
      status: 200,
      body: { token: "tok_other_other_other_other_other", account: { id: "acc2", paidUntil: "2027-01-01T00:00:00.000Z" } },
    }));
    server.token = "tok_other_other_other_other_other";
    await bridge.account();
    expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
    expect(vpn.clearSavedTunnel).toHaveBeenCalled();
    expect(prefs.data.has(KEYS.device)).toBe(false);
    expect(vpn.secure.has(SECURE_KEYS.deviceKeys)).toBe(false);
    expect((await bridge.tunnelStatus()).phase).toBe("disconnected");
  });
});

describe("settings while connected", () => {
  it("rebuilds and restarts the tunnel when routing settings change", async () => {
    const { bridge, vpn } = await loggedIn();
    await bridge.connect("fra");
    expect(vpn.start).toHaveBeenCalledTimes(1);
    expect((await bridge.updateSettings({ lanAccess: true })).ok).toBe(true);
    await vi.waitFor(() => expect(vpn.start).toHaveBeenCalledTimes(2));
    const allowed = configLine(vpn.lastStart!.config, "AllowedIPs")!;
    expect(allowed).not.toContain("0.0.0.0/0");
    await vi.waitFor(async () => expect((await bridge.tunnelStatus()).phase).toBe("connected"));
    expect((await bridge.tunnelStatus()).leakProtection).toBe("firewall");

    await bridge.updateSettings({ ipv6: false });
    await vi.waitFor(() => expect(vpn.start).toHaveBeenCalledTimes(3));
    expect(configLine(vpn.lastStart!.config, "Address")).toBe("10.64.0.2/32");
  });

  it("does not restart for DNS blocklist changes or when disconnected", async () => {
    const { bridge, vpn } = await loggedIn();
    await bridge.account();
    await bridge.updateSettings({ killSwitch: false });
    await bridge.connect("fra");
    await bridge.updateSettings({ dns: { ads: true } });
    await bridge.disconnect();
    await bridge.updateSettings({ killSwitch: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vpn.start).toHaveBeenCalledTimes(1);
  });
});

describe("excluded apps", () => {
  it("validates, deduplicates, sorts and persists the list", async () => {
    const { bridge, prefs, vpn } = await loggedIn();
    for (const bad of [["not a package"], ["com"], ["1com.example"], ["com.example;rm"], "com.example", [42]]) {
      expect(await bridge.setExcludedApps!(bad as string[])).toEqual({ ok: false, error: "Ungültige Eingabe.", code: "invalid" });
    }
    const tooMany = Array.from({ length: 501 }, (_, index) => `com.example.app${index}`);
    expect((await bridge.setExcludedApps!(tooMany)).ok).toBe(false);

    const result = await bridge.setExcludedApps!(["org.mozilla.firefox", "com.whatsapp", "org.mozilla.firefox"]);
    expect(result).toEqual({ ok: true, value: ["com.whatsapp", "org.mozilla.firefox"] });
    expect(await bridge.excludedApps!()).toEqual(["com.whatsapp", "org.mozilla.firefox"]);
    expect(prefValue(prefs, KEYS.excludedApps)).toEqual(["com.whatsapp", "org.mozilla.firefox"]);
    expect(vpn.start).not.toHaveBeenCalled();
  });

  it("restarts a running tunnel with the new list (same config, only the node list is asked)", async () => {
    const { bridge, vpn, server } = await loggedIn();
    await bridge.connect("fra");
    const config = vpn.lastStart!.config;
    const requests = server.requests.length;
    expect((await bridge.setExcludedApps!(["com.netflix.mediaclient"])).ok).toBe(true);
    expect(vpn.start).toHaveBeenCalledTimes(2);
    expect(vpn.lastStart).toEqual({
      config,
      nodeId: "fra",
      label: "Frankfurt",
      excludedApps: ["com.netflix.mediaclient"],
      postQuantum: false,
      api: { baseUrl: API_BASE_URL, token: TOKEN },
    });
    expect(server.requests.slice(requests).map((request) => request.path)).toEqual(["/api/v1/nodes"]);
    expect((await bridge.tunnelStatus()).phase).toBe("connected");
  });

  it("restarts with the node's new key when the node restarted meanwhile (RAM-only node)", async () => {
    const { bridge, vpn, server } = await loggedIn();
    await bridge.connect("fra");
    const config = vpn.lastStart!.config;
    const oldKey = /^PublicKey = (.*)$/m.exec(config)![1]!;
    const newKey = "HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=";
    const newPin = "Q".repeat(43) + "=";
    server.override.set("GET /api/v1/nodes", () => ({
      status: 200,
      body: NODES.map((node) => (node.id === "fra" ? { ...node, serverPublicKey: newKey, obfuscation: { version: 1, port: 8443, pin: newPin } } : node)),
    }));
    expect((await bridge.setExcludedApps!(["com.netflix.mediaclient"])).ok).toBe(true);
    expect(vpn.lastStart!.config).toBe(config.replace(`PublicKey = ${oldKey}`, `PublicKey = ${newKey}`));
    server.override.delete("GET /api/v1/nodes");
    server.override.set("GET /api/v1/nodes", () => ({ status: 503, body: { code: "unavailable", error: "down" } }));
    expect((await bridge.setExcludedApps!(["com.whatsapp"])).ok).toBe(true);
    expect(vpn.lastStart!.config).toContain(`PublicKey = ${newKey}`);
  });

  it("does a full connect for a tunnel this process did not start", async () => {
    const { bridge, vpn, server } = await loggedIn({
      native: { state: "up", nodeId: "fra", startedAt: Date.now(), lastHandshakeAt: Date.now() },
    });
    expect((await bridge.tunnelStatus()).phase).toBe("connected");
    expect((await bridge.setExcludedApps!(["com.netflix.mediaclient"])).ok).toBe(true);
    expect(server.requests.some((request) => request.path === "/api/v1/devices")).toBe(true);
    expect(vpn.lastStart?.excludedApps).toEqual(["com.netflix.mediaclient"]);
  });

  it("restores the previous list when the restart fails", async () => {
    const { bridge, vpn } = await loggedIn({ prefs: { [KEYS.excludedApps]: ["com.whatsapp"] } });
    await bridge.connect("fra");
    vpn.start.mockRejectedValueOnce(new Error("Der Tunnel konnte nicht neu aufgebaut werden."));
    expect(await bridge.setExcludedApps!(["com.whatsapp", "de.bank.app"])).toEqual({
      ok: false,
      error: "Der Tunnel konnte nicht neu aufgebaut werden.",
      code: "internal",
    });
    expect(await bridge.excludedApps!()).toEqual(["com.whatsapp"]);
  });

  it("maps installed apps: valid package names, safe icons, sorted by label", async () => {
    const { bridge, vpn } = await setup();
    vpn.apps = [
      { packageName: "org.mozilla.firefox", label: "Firefox", system: false, icon: "data:image/png;base64,iVBORw0KGgo=" },
      { packageName: "com.android.settings", label: "Einstellungen", system: true, icon: "javascript:alert(1)" },
      { packageName: "bad package", label: "Kaputt", system: false, icon: null },
      { packageName: "de.bank.app", label: "‮Bank", system: false, icon: null },
    ];
    expect(await bridge.installedApps!()).toEqual([
      { packageName: "de.bank.app", label: "Bank", system: false, icon: null },
      { packageName: "com.android.settings", label: "Einstellungen", system: true, icon: null },
      { packageName: "org.mozilla.firefox", label: "Firefox", system: false, icon: "data:image/png;base64,iVBORw0KGgo=" },
    ]);
  });

  it("reads the system VPN state and opens the settings", async () => {
    const { bridge, vpn } = await setup();
    vpn.systemVpnState.mockRejectedValueOnce(new Error("nope"));
    expect(await bridge.systemVpnState!()).toEqual({ supported: false, alwaysOn: false, lockdown: false });
    expect(await bridge.systemVpnState!()).toEqual({ supported: true, alwaysOn: true, lockdown: false });
    await bridge.openSystemVpnSettings!();
    expect(vpn.openVpnSettings).toHaveBeenCalled();
  });

  it("open Wi-Fi: passes only known security values and stores the setting natively", async () => {
    const { bridge, vpn } = await setup();
    expect(await bridge.wifiSecurity!()).toBe("none");
    vpn.wifi.security = "open";
    expect(await bridge.wifiSecurity!()).toBe("open");
    vpn.wifi.security = "<script>";
    expect(await bridge.wifiSecurity!()).toBe("unknown");
    vi.mocked(vpn.wifiState!).mockRejectedValueOnce(new Error("not implemented"));
    expect(await bridge.wifiSecurity!()).toBe("unknown");
    expect(await bridge.setAutoConnectOpenWifi!("yes" as unknown as boolean)).toMatchObject({ ok: false, code: "invalid" });
    const saved = await bridge.setAutoConnectOpenWifi!(true);
    expect(saved).toMatchObject({ ok: true, value: { autoConnectOpenWifi: true } });
    expect(vpn.setAutoConnectOpenWifi).toHaveBeenCalledWith({ enabled: true });
    expect((await bridge.preferences()).autoConnectOpenWifi).toBe(true);
  });
});

describe("paid time and account page", () => {
  it("passes paidUntil and the grace period through", async () => {
    const { bridge } = await loggedIn();
    const result = await bridge.account();
    expect(result.ok && result.value).toMatchObject({
      paidUntil: "2027-01-01T00:00:00.000Z",
      graceUntil: "2027-01-08T00:00:00.000Z",
    });
  });

  it("opens the website's account page of the build's server", async () => {
    const { bridge, log } = await setup({ flavor: "prod", baseUrl: "https://api.example.org" });
    expect(await bridge.openAccountPage!()).toEqual({ ok: true, value: null });
    expect(log).toContain("vpn.openUrl https://api.example.org/dashboard/abo");
  });

  it("opens the account page of the local server in debug", async () => {
    const { bridge, log } = await setup();
    await bridge.openAccountPage!();
    expect(log).toContain("vpn.openUrl http://10.0.2.2:3000/dashboard/abo");
  });

  it("reports a failure in the UI language", async () => {
    const { bridge, vpn } = await setup();
    vi.mocked(vpn.openUrl!).mockRejectedValueOnce(new Error("no browser"));
    expect(await bridge.openAccountPage!()).toEqual({
      ok: false,
      error: DICTIONARIES.de.errors.openWebsiteFailed,
      code: "internal",
    });
  });
});

describe("version check", () => {
  const answer = (latest: string | null, minimum: string | null) => () => ({
    status: 200,
    body: { platform: "android", latest, minimum, downloadUrl: "/download", notes: null, sha256: null },
  });

  it("asks GET /api/v1/app-version without the session", async () => {
    const { bridge, server } = await loggedIn({ appVersion: "2026.0.1" });
    server.override.set("GET /api/v1/app-version", answer("2026.1.0", "2026.0.1"));
    const result = await bridge.checkAppVersion!();
    expect(result).toEqual({
      ok: true,
      value: { platform: "android", latest: "2026.1.0", minimum: "2026.0.1", downloadUrl: "/download", notes: null, sha256: null },
    });
    const request = server.requests.find((entry) => entry.path === "/api/v1/app-version");
    expect(request?.headers.authorization).toBeUndefined();
    expect(request?.headers["user-agent"]).toBe("MantelAndroid/2026.0.1 (Android)");
  });

  it("below the minimum: refuses new connections, a running tunnel can still be disconnected", async () => {
    const { bridge, server } = await loggedIn({ appVersion: "2026.0.0" });
    expect((await bridge.connect("fra")).ok).toBe(true);
    server.override.set("GET /api/v1/app-version", answer("2026.1.0", "2026.0.1"));
    expect((await bridge.checkAppVersion!()).ok).toBe(true);
    expect(await bridge.disconnect()).toMatchObject({ ok: true, value: { phase: "disconnected" } });
    expect(await bridge.connect("fra")).toEqual({
      ok: false,
      error: DICTIONARIES.de.errors.updateRequired,
      code: "update_required",
    });
    server.override.set("GET /api/v1/app-version", answer("2026.1.0", "2026.0.0"));
    await bridge.checkAppVersion!();
    expect((await bridge.connect("fra")).ok).toBe(true);
  });

  it("offline or a broken answer never blocks", async () => {
    const { bridge, server } = await loggedIn({ appVersion: "2026.0.0" });
    server.override.set("GET /api/v1/app-version", () => ({ status: 500, body: { code: "internal", error: "x" } }));
    expect((await bridge.checkAppVersion!()).ok).toBe(false);
    server.override.set("GET /api/v1/app-version", () => ({ status: 200, body: { platform: "windows", latest: "2027.0.0" } }));
    expect(await bridge.checkAppVersion!()).toMatchObject({ ok: false, code: "server" });
    expect((await bridge.connect("fra")).ok).toBe(true);
  });

  it("opens the download page of the build's server", async () => {
    const { bridge, log } = await setup({ flavor: "prod", baseUrl: "https://api.example.org" });
    expect(await bridge.openDownloadPage!()).toEqual({ ok: true, value: null });
    expect(log).toContain("vpn.openUrl https://api.example.org/download");
  });
});

describe("app disguise", () => {
  it("reads and switches the launcher icon", async () => {
    const { bridge, vpn, log } = await setup();
    expect(await bridge.appIcon!()).toBe("default");
    expect(await bridge.setAppIcon!("calculator")).toEqual({ ok: true, value: "calculator" });
    expect(log).toContain("vpn.setAppIcon calculator");
    expect(await bridge.appIcon!()).toBe("calculator");
    expect(await bridge.setAppIcon!("default")).toEqual({ ok: true, value: "default" });
    expect(vpn.icon).toBe("default");
  });

  it("rejects unknown icons without calling the plugin", async () => {
    const { bridge, vpn } = await setup();
    for (const bad of ["Rechner", "", null, 1, { icon: "calculator" }]) {
      expect(await bridge.setAppIcon!(bad as never)).toEqual({ ok: false, error: "Ungültige Eingabe.", code: "invalid" });
    }
    expect(vpn.setAppIcon).not.toHaveBeenCalled();
  });

  it("reports failures in German and falls back to the default icon when unknown", async () => {
    const { bridge, vpn } = await setup();
    vpn.setAppIcon.mockRejectedValueOnce(new Error("SecurityException"));
    expect(await bridge.setAppIcon!("calculator")).toEqual({
      ok: false,
      error: "Das App-Symbol ließ sich nicht ändern.",
      code: "internal",
    });
    vpn.appIcon.mockResolvedValueOnce({ icon: "weird" as never });
    expect(await bridge.appIcon!()).toBe("default");
    vpn.appIcon.mockRejectedValueOnce(new Error("not implemented"));
    expect(await bridge.appIcon!()).toBe("default");
  });
});

describe("system VPN state while the tunnel is down", () => {
  it("reports the last answer Android gave while the tunnel ran (also after a restart)", async () => {
    const first = await setup();
    first.vpn.systemVpnState.mockResolvedValue({ supported: true, alwaysOn: true, lockdown: true });
    expect(await first.bridge.systemVpnState!()).toEqual({ supported: true, alwaysOn: true, lockdown: true });
    first.vpn.systemVpnState.mockResolvedValue({ supported: false, alwaysOn: false, lockdown: false });
    expect(await first.bridge.systemVpnState!()).toEqual({ supported: true, alwaysOn: true, lockdown: true, cached: true });

    const prefs = Object.fromEntries([...first.prefs.data].map(([key, value]) => [key, JSON.parse(value)]));
    const second = await setup({ prefs });
    second.vpn.systemVpnState.mockResolvedValue({ supported: false, alwaysOn: false, lockdown: false });
    expect(await second.bridge.systemVpnState!()).toEqual({ supported: true, alwaysOn: true, lockdown: true, cached: true });
    second.vpn.systemVpnState.mockResolvedValueOnce({ supported: true, alwaysOn: false, lockdown: false });
    expect(await second.bridge.systemVpnState!()).toEqual({ supported: true, alwaysOn: false, lockdown: false });
    expect(await second.bridge.systemVpnState!()).toEqual({ supported: true, alwaysOn: false, lockdown: false, cached: true });
  });

  it("forgets the remembered answer when the system VPN settings are opened", async () => {
    const { bridge, vpn, prefs } = await setup();
    vpn.systemVpnState.mockResolvedValueOnce({ supported: true, alwaysOn: true, lockdown: true });
    await bridge.systemVpnState!();
    expect(prefs.data.has(KEYS.systemVpn)).toBe(true);
    await bridge.openSystemVpnSettings!();
    expect(prefs.data.has(KEYS.systemVpn)).toBe(false);
    vpn.systemVpnState.mockResolvedValue({ supported: false, alwaysOn: false, lockdown: false });
    expect(await bridge.systemVpnState!()).toEqual({ supported: false, alwaysOn: false, lockdown: false });
  });

  it("stays unknown when Android never answered", async () => {
    const { bridge, vpn } = await setup();
    vpn.systemVpnState.mockResolvedValue({ supported: false, alwaysOn: false, lockdown: false });
    expect(await bridge.systemVpnState!()).toEqual({ supported: false, alwaysOn: false, lockdown: false });
  });
});

describe("status", () => {
  it("adopts a tunnel that is already running at startup", async () => {
    const startedAt = Date.now() - 60_000;
    const { bridge } = await setup({
      native: { state: "up", nodeId: "fra", startedAt, lastHandshakeAt: Date.now() - 5_000, rxBytes: 10, txBytes: 20, endpoint: "198.51.100.7:51820" },
      prefs: {
        [KEYS.runtime]: {
          nodeId: "fra",
          label: "Frankfurt",
          addresses: ["10.64.0.2/32"],
          dns: ["10.64.0.1"],
          endpoint: "198.51.100.7:51820",
          leakProtection: "wireguard",
        },
      },
    });
    expect(await bridge.tunnelStatus()).toMatchObject({
      phase: "connected",
      nodeId: "fra",
      connectedAt: startedAt,
      rxBytes: 10,
      txBytes: 20,
      addresses: ["10.64.0.2/32"],
      dns: ["10.64.0.1"],
      leakProtection: "wireguard",
    });
  });

  it("adopts a running tunnel without remembered details", async () => {
    const { bridge } = await setup({ native: { state: "connecting", nodeId: "ams", startedAt: Date.now() } });
    expect(await bridge.tunnelStatus()).toMatchObject({ phase: "connecting", nodeId: "ams", addresses: [] });
  });

  it("follows native status events (e.g. disconnect from the notification) and detects stale tunnels", async () => {
    const { bridge, vpn, statuses } = await loggedIn();
    await bridge.connect("fra");
    vpn.emit({ ...vpn.native, lastHandshakeAt: Date.now() - STALE_HANDSHAKE_MS - 1_000 });
    expect(statuses.at(-1)?.phase).toBe("stale");
    vpn.emit({ state: "down", nodeId: null, startedAt: null, lastHandshakeAt: null, rxBytes: 0, txBytes: 0, endpoint: null, error: null });
    expect(statuses.at(-1)).toMatchObject({ phase: "disconnected", connectedAt: null, rxBytes: 0 });
  });

  it("polls every 2 s while visible and refreshes when the app becomes visible again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let visible = true;
    const listeners = new Set<() => void>();
    const visibility: Visibility = {
      visible: () => visible,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const { vpn, bridge } = await setup({ visibility, pollIntervalMs: 2000 });
    const calls = () => vpn.status.mock.calls.length;
    const initial = calls();
    await vi.advanceTimersByTimeAsync(4000);
    expect(calls()).toBe(initial + 2);

    visible = false;
    listeners.forEach((listener) => listener());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls()).toBe(initial + 2);

    vpn.native = { state: "up", nodeId: "fra", startedAt: Date.now(), lastHandshakeAt: Date.now(), rxBytes: 0, txBytes: 0, endpoint: null, error: null };
    visible = true;
    listeners.forEach((listener) => listener());
    await vi.waitFor(async () => expect((await bridge.tunnelStatus()).phase).toBe("connected"));
    expect(calls()).toBe(initial + 3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls()).toBe(initial + 4);
  });

  it("disconnects and keeps a Mantel error visible while down", async () => {
    const { bridge, vpn, controller } = await loggedIn();
    await bridge.connect("fra");
    const result = await bridge.disconnect();
    expect(result).toMatchObject({ ok: true, value: { phase: "disconnected", connectedAt: null, error: null } });
    vpn.prepare.mockResolvedValueOnce({ granted: false });
    await bridge.connect("fra");
    await controller.refreshStatus();
    expect((await bridge.tunnelStatus()).error).toBe(PERMISSION_DENIED);
    await bridge.disconnect();
    expect((await bridge.tunnelStatus()).error).toBeNull();
  });

  it("does not resurrect a native error the user already dismissed by disconnecting", async () => {
    const { bridge, vpn, controller } = await loggedIn();
    await bridge.connect("fra");
    vpn.emit({ ...vpn.native, state: "down", error: "Handshake fehlgeschlagen." });
    expect((await bridge.tunnelStatus()).error).toBe("Handshake fehlgeschlagen.");
    vpn.stop.mockResolvedValueOnce({ ...vpn.native });
    await bridge.disconnect();
    await controller.refreshStatus();
    expect((await bridge.tunnelStatus()).error).toBeNull();
  });
});

describe("flavors", () => {
  for (const flavor of ["prod", "debug"] as const) {
    it(`${flavor}: a server URL stored by an older version (server field) is ignored and overwritten`, async () => {
      const { bridge, prefs, server } = await setup({
        flavor,
        prefs: { [KEYS.preferences]: { baseUrl: "http://192.168.1.20:3001", lastNodeId: "fra" } },
      });
      expect(await bridge.preferences()).toMatchObject({ baseUrl: API_BASE_URL, lastNodeId: "fra" });
      expect(prefValue(prefs, KEYS.preferences)).toEqual({ baseUrl: API_BASE_URL, lastNodeId: "fra" });
      expect(await bridge.nodes()).toMatchObject({ ok: true });
      expect(server.requests.at(-1)?.path).toBe("/api/v1/nodes");
    });
  }

  it("reports every API call to onApiRequest without ids, tokens or bodies", async () => {
    const records: ApiRequestRecord[] = [];
    const { bridge } = await setup({ onApiRequest: (record) => records.push(record) });
    await bridge.login(ACCOUNT_CODE);
    await bridge.login("1111222233334444");
    await bridge.connect("fra");
    await bridge.logout();
    const routes = records.map((record) => [record.method, record.route, record.status, record.error].join(" "));
    expect(routes).toContain("POST /api/v1/auth/login 200 ");
    expect(routes).toContain("POST /api/v1/auth/login 401 unauthorized");
    expect(routes).toContain("DELETE /api/v1/devices/:id 204 ");
    const text = JSON.stringify(records);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(ACCOUNT_CODE);
    expect(text).not.toContain("dev1");
    for (const record of records) expect(record.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("register (Konto erstellen)", () => {
  const NEW_CODE = "8765432187654321";
  const NEW_TOKEN = "tok_new_abcdefghijklmnopqrstuvwxyz";

  function withRegister(server: ReturnType<typeof fakeServer>) {
    server.override.set("POST /api/v1/auth/register", (request) => {
      expect(request.body).toEqual({});
      server.token = NEW_TOKEN;
      return {
        status: 200,
        body: { code: NEW_CODE, token: NEW_TOKEN, account: { id: "acc2", paidUntil: "2026-10-29T00:00:00.000Z" } },
      };
    });
  }

  it("creates an account, keeps it pending until the code is confirmed, then logs it in", async () => {
    const { bridge, server, vpn, prefs } = await setup();
    withRegister(server);
    expect(await bridge.register()).toEqual({
      ok: true,
      value: { code: NEW_CODE, accountId: "acc2", paidUntil: "2026-10-29T00:00:00.000Z" },
    });
    expect(await bridge.session()).toMatchObject({ loggedIn: false });
    expect(await bridge.pendingRegistration()).toMatchObject({ code: NEW_CODE });
    expect(JSON.parse(vpn.secure.get(SECURE_KEYS.pendingRegistration) ?? "{}")).toMatchObject({ code: NEW_CODE, token: NEW_TOKEN });
    for (const value of prefs.data.values()) {
      expect(value).not.toContain(NEW_TOKEN);
      expect(value).not.toContain(NEW_CODE);
    }

    expect(await bridge.confirmRegistration()).toEqual({
      ok: true,
      value: { loggedIn: true, accountId: "acc2", paidUntil: "2026-10-29T00:00:00.000Z" },
    });
    expect(JSON.parse(vpn.secure.get(SECURE_KEYS.session) ?? "{}")).toMatchObject({ token: NEW_TOKEN, accountId: "acc2" });
    expect(vpn.secure.has(SECURE_KEYS.pendingRegistration)).toBe(false);
    expect(await bridge.pendingRegistration()).toBeNull();
    const account = await bridge.account();
    expect(account.ok).toBe(true);
    expect(server.requests.at(-1)?.headers.authorization).toBe(`Bearer ${NEW_TOKEN}`);
    expect(await bridge.confirmRegistration()).toMatchObject({ ok: false, code: "invalid" });
  });

  it("shows the code again after a restart before it was confirmed", async () => {
    const pending = JSON.stringify({ code: NEW_CODE, token: NEW_TOKEN, accountId: "acc2", paidUntil: "2026-10-29T00:00:00.000Z" });
    const { bridge } = await setup({ secure: { [SECURE_KEYS.pendingRegistration]: pending } });
    expect(await bridge.session()).toMatchObject({ loggedIn: false });
    expect(await bridge.pendingRegistration()).toEqual({ code: NEW_CODE, accountId: "acc2", paidUntil: "2026-10-29T00:00:00.000Z" });
    expect(await bridge.confirmRegistration()).toMatchObject({ ok: true, value: { loggedIn: true, accountId: "acc2" } });
  });

  it("explains rate limits, a missing endpoint, server and network errors in plain words", async () => {
    const { bridge, server } = await setup();
    server.override.set("POST /api/v1/auth/register", () => ({ status: 429, body: { error: "Zu viele Anfragen." } }));
    expect(await bridge.register()).toEqual({
      ok: false,
      error: "Zu viele neue Konten in kurzer Zeit. Versuch es später erneut.",
      code: "rate_limited",
    });
    server.override.set("POST /api/v1/auth/register", () => ({
      status: 404,
      raw: "<!doctype html><title>404</title>",
      headers: { "content-type": "text/html" },
    }));
    expect(await bridge.register()).toEqual({ ok: false, error: "Dieser Server bietet keine Kontoerstellung an.", code: "server" });
    server.override.set("POST /api/v1/auth/register", () => ({ status: 503, raw: "" }));
    expect(await bridge.register()).toEqual({
      ok: false,
      error: "Das Konto konnte nicht erstellt werden. Versuch es später erneut.",
      code: "server",
    });
    server.override.set("POST /api/v1/auth/register", () => ({ status: 200, body: { code: "123", token: "x" } }));
    expect(await bridge.register()).toMatchObject({ ok: false, code: "server" });
    server.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await bridge.register()).toMatchObject({ ok: false, code: "network", error: expect.stringContaining("nicht erreichbar") });
    expect(await bridge.pendingRegistration()).toBeNull();
    expect(await bridge.session()).toMatchObject({ loggedIn: false });
  });

  it("logout forgets a pending registration", async () => {
    const { bridge, server, vpn } = await setup();
    withRegister(server);
    await bridge.register();
    expect(await bridge.logout()).toMatchObject({ ok: true });
    expect(await bridge.pendingRegistration()).toBeNull();
    expect(vpn.secure.has(SECURE_KEYS.pendingRegistration)).toBe(false);
  });
});

describe("debug helpers", () => {
  it("diagnostics carry no secrets, wipeLocalData removes everything", async () => {
    const { controller, vpn, prefs, bridge } = await loggedIn();
    await bridge.connect("fra");
    await bridge.setExcludedApps!(["com.whatsapp"]);
    const text = JSON.stringify(controller.diagnostics());
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(ACCOUNT_CODE);
    for (const secret of controller.secretsForRedaction()) expect(text).not.toContain(secret);
    expect(controller.secretsForRedaction()).toContain(TOKEN);

    await controller.wipeLocalData();
    expect([...vpn.secure.keys()]).toEqual([]);
    expect([...prefs.data.keys()]).toEqual([]);
    expect(await bridge.session()).toMatchObject({ loggedIn: false });
    expect(await bridge.excludedApps!()).toEqual([]);
  });
});
