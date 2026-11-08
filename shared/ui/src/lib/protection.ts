import type { AccountSettings, TunnelPhase } from "../../../core/contract";

export type ProtectionLevel = "on" | "warn" | "idle";

export type ProtectionState =
  | "killSwitchOn"
  | "killSwitchAndroid"
  | "killSwitchAppOnly"
  | "killSwitchOff"
  | "dnsTunnel"
  | "dnsMayLeak"
  | "blocked"
  | "ipv6Tunnel"
  | "ipv6Blocked"
  | "idle";

export type ProtectionItem = { level: ProtectionLevel; state: ProtectionState };

export type ProtectionSummary = { killSwitch: ProtectionItem; dns: ProtectionItem; ipv6: ProtectionItem };

export function protectionSummary(input: {
  android: boolean;
  settings: Pick<AccountSettings, "killSwitch" | "ipv6">;
  phase: TunnelPhase;
  blocking: boolean;
}): ProtectionSummary {
  const { android, settings, phase, blocking } = input;
  const tunnel = phase !== "disconnected";
  const item = (level: ProtectionLevel, state: ProtectionState): ProtectionItem => ({ level, state });

  const killSwitch = android
    ? blocking
      ? item("on", "killSwitchAndroid")
      : item("warn", settings.killSwitch ? "killSwitchAppOnly" : "killSwitchOff")
    : settings.killSwitch
      ? item("on", "killSwitchOn")
      : item("warn", "killSwitchOff");

  const dnsSafe = android || settings.killSwitch;
  const dns = tunnel
    ? dnsSafe
      ? item("on", "dnsTunnel")
      : item("warn", "dnsMayLeak")
    : blocking
      ? item("on", "blocked")
      : item("idle", "idle");

  const ipv6 = tunnel
    ? item("on", settings.ipv6 ? "ipv6Tunnel" : "ipv6Blocked")
    : blocking
      ? item("on", "blocked")
      : item("idle", "idle");

  return { killSwitch, dns, ipv6 };
}

export type BlockReason = "lost" | "alwaysOn" | "leftover" | "android";

export function blockReason(input: {
  android: boolean;
  phase: TunnelPhase;
  firewallActive: boolean;
  alwaysOnKillSwitch: boolean;
  systemLockdown: boolean | null;
}): BlockReason | null {
  if (input.android) return input.phase === "disconnected" && input.systemLockdown === true ? "android" : null;
  if (!input.firewallActive) return null;
  if (input.phase === "stale") return "lost";
  if (input.phase !== "disconnected") return null;
  return input.alwaysOnKillSwitch ? "alwaysOn" : "leftover";
}
