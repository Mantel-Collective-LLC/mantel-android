import type { TunnelPhase, WifiSecurity } from "./contract";

export function showOpenWifiWarning(security: WifiSecurity | null, phase: TunnelPhase): boolean {
  return security === "open" && phase === "disconnected";
}

export function shouldAutoConnect(input: {
  previous: WifiSecurity | null;
  current: WifiSecurity;
  enabled: boolean;
  phase: TunnelPhase;
  hasLocation: boolean;
}): boolean {
  return (
    input.enabled &&
    input.hasLocation &&
    input.current === "open" &&
    input.previous !== "open" &&
    input.phase === "disconnected"
  );
}
