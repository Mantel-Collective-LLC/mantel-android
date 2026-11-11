import { Preferences as CapacitorPreferences } from "@capacitor/preferences";
import { z } from "zod";
import { SUPPORT_CATEGORIES, type Environment, type PlatformFeatures, type Preferences, type Result } from "@shared/contract";
import { isSupportText, SUPPORT_ID } from "@shared/support";
import { DICTIONARIES, LANGUAGE_PREFERENCES, languageOfLocale, type Language } from "@shared/i18n";
import { MAX_PING_TARGETS } from "@shared/latency";
import { isTheme, THEME_PREFERENCES } from "@shared/theme";
import { isProxyId, isTelegramProxyLink, parseProxyCreate, parseProxyPatch } from "@shared/proxy";
import {
  accountCodeSchema,
  appIconSchema,
  deviceIdSchema,
  deviceNameSchema,
  excludedAppsSchema,
  forwardPortSchema,
  localPortSchema,
  nodeIdSchema,
  obfuscationModeSchema,
  settingsPatchSchema,
  referralInputSchema,
  totpInputSchema,
} from "../lib/schemas";
import { androidStrings } from "../i18n/strings";
import { ApiError, type FetchLike } from "../lib/api-client";
import type { KeyValueStore } from "../lib/storage";
import { MantelVpn, type MantelVpnPlugin } from "../native/mantel-vpn";
import { AndroidVpnController, codeOf, type ControllerDeps, type Visibility } from "./controller";
import type { AndroidBridge } from "./extras";

export const ANDROID_FEATURES: PlatformFeatures = {
  desktopWindow: false,
  managedWireGuard: false,
  firewallLockdown: false,
  systemLockdown: true,
  appExclusion: true,
  appDisguise: true,
};

const languageSchema = z.enum(LANGUAGE_PREFERENCES);
const themeSchema = z.enum(THEME_PREFERENCES);
const supportIdSchema = z.string().regex(SUPPORT_ID);
const supportCategorySchema = z.enum(SUPPORT_CATEGORIES);
const supportTextSchema = z.string().refine(isSupportText);
const latencyIdsSchema = z.array(nodeIdSchema).max(MAX_PING_TARGETS);

function documentVisibility(): Visibility | null {
  if (typeof document === "undefined") return null;
  return {
    visible: () => document.visibilityState === "visible",
    subscribe: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

const globalFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

export type AndroidBridgeOptions = Partial<ControllerDeps> & { vpn?: MantelVpnPlugin; preferences?: KeyValueStore };

export function createAndroidBridge(options: AndroidBridgeOptions = {}): AndroidBridge {
  return createAndroidBridgeWithController(options).bridge;
}

export function createAndroidBridgeWithController(options: AndroidBridgeOptions = {}): {
  bridge: AndroidBridge;
  controller: AndroidVpnController;
} {
  const vpn = options.vpn ?? MantelVpn;
  const controller = new AndroidVpnController({
    vpn,
    preferences: options.preferences ?? CapacitorPreferences,
    fetch: options.fetch ?? globalFetch,
    visibility: options.visibility === undefined ? documentVisibility() : options.visibility,
    now: options.now,
    pollIntervalMs: options.pollIntervalMs,
    randomSuffix: options.randomSuffix,
    requestTimeoutMs: options.requestTimeoutMs,
    logoutCallTimeoutMs: options.logoutCallTimeoutMs,
    logoutBudgetMs: options.logoutBudgetMs,
    systemLocales: options.systemLocales,
    flavor: options.flavor,
    baseUrl: options.baseUrl,
    onApiRequest: options.onApiRequest,
    bypassFetch: options.bypassFetch,
  });
  const ready = controller.ready.catch(() => undefined);
  const texts = () => DICTIONARIES[controller.language()].errors;
  const invalid = <T,>(): Result<T> => ({ ok: false, error: texts().invalidInput, code: "invalid" });
  const wrap = async <T,>(task: () => Promise<T>): Promise<Result<T>> => {
    try {
      return { ok: true, value: await task() };
    } catch (error) {
      return { ok: false, error: controller.describe(error), code: codeOf(error) };
    }
  };
  const after = async <T>(task: () => T | Promise<T>): Promise<T> => {
    await ready;
    return task();
  };
  const registerError = (error: unknown): string => {
    const texts = androidStrings(controller.language()).register;
    if (!(error instanceof ApiError)) return texts.failed;
    if (error.code === "rate_limited") return texts.rateLimited;
    if (error.code === "network") return controller.describe(error);
    if (error.status === 404 || error.status === 405) return texts.unavailable;
    if (error.code !== "server" && !error.i18n) return error.message;
    return texts.failed;
  };

  const bridge: AndroidBridge = {
    environment: () =>
      after(async (): Promise<Environment> => {
        await controller.refreshLanguage();
        const systemLocale = controller.systemLocales[0];
        const systemLanguage: Language = languageOfLocale(controller.systemLocales[0]);
        return {
          platform: "android",
          elevated: true,
          wireguardInstalled: true,
          wireguardPath: null,
          wireguardSource: null,
          encryptionAvailable: controller.encryptionAvailable,
          appVersion: controller.version,
          features: { ...ANDROID_FEATURES },
          systemLanguage,
          ...(systemLocale ? { systemLocale } : {}),
        };
      }),

    session: () => after(() => controller.getSession()),

    login: async (code, totp) => {
      const parsed = accountCodeSchema.safeParse(code);
      const second = totpInputSchema.safeParse(totp);
      if (!parsed.success || !second.success) return invalid();
      await ready;
      return wrap(() => controller.login(parsed.data, second.data ?? undefined));
    },

    register: async (referralCode?: unknown) => {
      const parsed = referralInputSchema.safeParse(referralCode === undefined ? null : referralCode);
      if (!parsed.success) return { ok: false, error: androidStrings(controller.language()).register.failed, code: "invalid" };
      await ready;
      try {
        return { ok: true, value: await controller.register(parsed.data ?? undefined) };
      } catch (error) {
        return { ok: false, error: registerError(error), code: codeOf(error) };
      }
    },

    pendingRegistration: () => after(() => controller.pendingRegistration()),

    confirmRegistration: async () => {
      await ready;
      return wrap(() => controller.confirmRegistration());
    },

    logout: async () => {
      await ready;
      return wrap(async () => {
        await controller.logout();
        return null;
      });
    },

    account: async () => {
      await ready;
      return wrap(() => controller.account());
    },

    nodes: async () => {
      await ready;
      return wrap(() => controller.nodes());
    },

    measureLatency: async (nodeIds) => {
      const parsed = latencyIdsSchema.safeParse(nodeIds);
      if (!parsed.success) return [];
      await ready;
      return controller.measureLatency(parsed.data);
    },

    recentLogins: async () => {
      await ready;
      return wrap(() => controller.recentLogins());
    },
    markLoginsSeen: async () => {
      await ready;
      return wrap(() => controller.markLoginsSeen());
    },
    logoutOtherSessions: async () => {
      await ready;
      return wrap(() => controller.logoutOtherSessions());
    },
    openSecurityPage: async () => {
      await ready;
      return wrap(async () => {
        await controller.openSecurityPage();
        return null;
      });
    },

    portForwarding: async () => {
      await ready;
      return wrap(() => controller.portForwarding());
    },

    deviceKey: async () => {
      await ready;
      return wrap(() => controller.deviceKey());
    },

    rotateDeviceKey: async () => {
      await ready;
      return wrap(() => controller.rotateDeviceKey());
    },

    setPortForwarding: async (enabled) => {
      const parsed = z.boolean().safeParse(enabled);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.setPortForwarding(parsed.data));
    },

    tor: async () => {
      await ready;
      return wrap(() => controller.tor());
    },

    setTor: async (enabled) => {
      const parsed = z.boolean().safeParse(enabled);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.tor(parsed.data));
    },

    currentDeviceId: () => after(() => controller.currentDeviceId()),
    renameDevice: async (id, name) => {
      const parsedId = deviceIdSchema.safeParse(id);
      const parsedName = deviceNameSchema.safeParse(name);
      if (!parsedId.success || !parsedName.success) return invalid();
      await ready;
      return wrap(() => controller.renameDevice(parsedId.data, parsedName.data));
    },
    removeDevice: async (id) => {
      const parsed = deviceIdSchema.safeParse(id);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(async () => {
        await controller.removeDevice(parsed.data);
        return null;
      });
    },
    devicePortForwarding: async (deviceId) => {
      const parsed = deviceIdSchema.safeParse(deviceId);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.devicePortForwarding(parsed.data));
    },
    addPortForward: async (deviceId, localPort) => {
      const parsed = deviceIdSchema.safeParse(deviceId);
      const parsedLocal = localPortSchema.safeParse(localPort ?? null);
      if (!parsed.success || !parsedLocal.success) return invalid();
      await ready;
      return wrap(() => controller.addPortForward(parsed.data, parsedLocal.data));
    },
    setPortForwardLocalPort: async (deviceId, port, localPort) => {
      const parsedId = deviceIdSchema.safeParse(deviceId);
      const parsedPort = forwardPortSchema.safeParse(port);
      const parsedLocal = localPortSchema.safeParse(localPort);
      if (!parsedId.success || !parsedPort.success || !parsedLocal.success) return invalid();
      await ready;
      return wrap(() => controller.setPortForwardLocalPort(parsedId.data, parsedPort.data, parsedLocal.data));
    },
    removePortForward: async (deviceId, port) => {
      const parsedId = deviceIdSchema.safeParse(deviceId);
      const parsedPort = forwardPortSchema.safeParse(port);
      if (!parsedId.success || !parsedPort.success) return invalid();
      await ready;
      return wrap(() => controller.removePortForward(parsedId.data, parsedPort.data));
    },

    proxies: async () => {
      await ready;
      return wrap(() => controller.proxies());
    },
    createProxy: async (input) => {
      const parsed = parseProxyCreate(input);
      if (!parsed) return invalid();
      await ready;
      return wrap(() => controller.createProxy(parsed));
    },
    updateProxy: async (id, patch) => {
      const parsed = parseProxyPatch(patch);
      if (!isProxyId(id) || !parsed) return invalid();
      await ready;
      return wrap(() => controller.updateProxy(id, parsed));
    },
    deleteProxy: async (id) => {
      if (!isProxyId(id)) return invalid();
      await ready;
      return wrap(async () => {
        await controller.deleteProxy(id);
        return null;
      });
    },
    openTelegramProxy: async (link) => {
      if (!isTelegramProxyLink(link)) return invalid();
      await ready;
      return wrap(async () => {
        await controller.openTelegramProxy(link);
        return null;
      });
    },

    supportOverview: async () => {
      await ready;
      return wrap(() => controller.supportOverview());
    },
    supportUnread: async () => {
      await ready;
      return wrap(() => controller.supportUnread());
    },
    supportTicket: async (id) => {
      const parsed = supportIdSchema.safeParse(id);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.supportTicket(parsed.data));
    },
    supportCreate: async (category, text) => {
      const parsedCategory = supportCategorySchema.safeParse(category);
      const parsedText = supportTextSchema.safeParse(text);
      if (!parsedCategory.success || !parsedText.success) return invalid();
      await ready;
      return wrap(() => controller.supportCreate(parsedCategory.data, parsedText.data));
    },
    supportReply: async (id, text) => {
      const parsedId = supportIdSchema.safeParse(id);
      const parsedText = supportTextSchema.safeParse(text);
      if (!parsedId.success || !parsedText.success) return invalid();
      await ready;
      return wrap(() => controller.supportReply(parsedId.data, parsedText.data));
    },
    supportSetClosed: async (id, closed) => {
      const parsedId = supportIdSchema.safeParse(id);
      if (!parsedId.success || typeof closed !== "boolean") return invalid();
      await ready;
      return wrap(() => controller.supportSetClosed(parsedId.data, closed));
    },

    updateSettings: async (patch) => {
      const parsed = settingsPatchSchema.safeParse(patch);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.updateSettings(parsed.data));
    },

    connect: async (nodeId) => {
      const parsed = nodeIdSchema.safeParse(nodeId);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.connect(parsed.data));
    },

    disconnect: async () => {
      await ready;
      return wrap(() => controller.disconnect());
    },

    tunnelStatus: () => after(() => controller.getStatus()),

    preferences: () =>
      after(async (): Promise<Preferences> => {
        await controller.refreshLanguage();
        return controller.preferences();
      }),

    setLanguage: async (language) => {
      const parsed = languageSchema.safeParse(language);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.setLanguage(parsed.data));
    },

    setTheme: async (theme) => {
      const parsed = themeSchema.safeParse(theme);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.setTheme(parsed.data));
    },

    setPostQuantum: async (enabled) => {
      const parsed = z.boolean().safeParse(enabled);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.setPostQuantum(parsed.data));
    },

    setObfuscation: async (mode) => {
      const parsed = obfuscationModeSchema.safeParse(mode);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.setObfuscation(parsed.data));
    },

    onSystemThemeChange: (listener) => {
      let stopped = false;
      let handle: { remove: () => Promise<void> } | null = null;
      Promise.resolve()
        .then(() =>
          vpn.addListener("systemTheme", (event) => {
            if (!stopped && isTheme(event?.theme)) listener(event.theme);
          }),
        )
        .then((registered) => {
          if (stopped) void registered.remove().catch(() => undefined);
          else handle = registered;
        })
        .catch(() => undefined);
      return () => {
        stopped = true;
        void handle?.remove().catch(() => undefined);
        handle = null;
      };
    },

    setAlwaysOnKillSwitch: async (enabled) => {
      const parsed = z.boolean().safeParse(enabled);
      if (!parsed.success) return invalid();
      await ready;
      if (!parsed.data) return { ok: true, value: controller.preferences() };
      return { ok: false, error: texts().systemKillSwitch, code: "invalid" };
    },

    selectNode: async (nodeId) => {
      const parsed = nodeIdSchema.safeParse(nodeId);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.selectNode(parsed.data));
    },

    openWireGuardDownload: async () => undefined,
    installWireGuard: async () => ({ ok: true, value: { version: "integriert" } }),

    onTunnelStatus: (listener) => controller.onStatus(listener),
    onSessionEnded: (listener) => controller.onSessionEnded(listener),

    systemVpnState: () => after(() => controller.systemVpnState()),
    wifiSecurity: () => after(() => controller.wifiSecurity()),
    setAutoConnectOpenWifi: async (enabled) => {
      const parsed = z.boolean().safeParse(enabled);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.setAutoConnectOpenWifi(parsed.data));
    },
    openSystemVpnSettings: () => after(() => controller.openSystemVpnSettings()),
    openAccountPage: async () => {
      await ready;
      return wrap(async () => {
        await controller.openAccountPage();
        return null;
      });
    },
    checkAppVersion: async () => {
      await ready;
      return wrap(() => controller.checkAppVersion());
    },
    openDownloadPage: async () => {
      await ready;
      return wrap(async () => {
        await controller.openDownloadPage();
        return null;
      });
    },
    installedApps: () => after(() => controller.installedApps()),
    excludedApps: () => after(() => controller.excludedApps()),
    setExcludedApps: async (packages) => {
      const parsed = excludedAppsSchema.safeParse(packages);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.setExcludedApps(parsed.data));
    },
    appIcon: () => after(() => controller.appIcon()),
    setAppIcon: async (icon) => {
      const parsed = appIconSchema.safeParse(icon);
      if (!parsed.success) return invalid();
      await ready;
      return wrap(() => controller.setAppIcon(parsed.data));
    },
  };
  return { bridge, controller };
}
