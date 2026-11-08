import type { Environment, PlatformFeatures } from "../../../core/contract";

export const DESKTOP_FEATURES: PlatformFeatures = {
  desktopWindow: true,
  managedWireGuard: true,
  firewallLockdown: true,
  systemLockdown: false,
  appExclusion: false,
};

export const ANDROID_FEATURES: PlatformFeatures = {
  desktopWindow: false,
  managedWireGuard: false,
  firewallLockdown: false,
  systemLockdown: true,
  appExclusion: true,
  appDisguise: true,
};

export function withFeatures(environment: Environment): Environment {
  return environment.features ? environment : { ...environment, features: { ...DESKTOP_FEATURES } };
}

export function isAndroid(environment: Pick<Environment, "platform">): boolean {
  return environment.platform === "android";
}

export function isMac(environment: Pick<Environment, "platform">): boolean {
  return environment.platform === "darwin";
}

export function showsDesktopTitleBar(environment: Pick<Environment, "platform" | "features"> | null, platform: string): boolean {
  if (platform === "android" || environment?.platform === "android") return false;
  return environment ? environment.features.desktopWindow : true;
}

export function applyPlatform(platform: string): void {
  document.documentElement.dataset.platform = platform;
}

export function guessPlatform(): string {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("platform") === "android") {
    return "android";
  }
  return /\bAndroid\b/i.test(navigator.userAgent) ? "android" : "desktop";
}
