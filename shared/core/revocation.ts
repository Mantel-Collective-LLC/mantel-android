import { STALE_HANDSHAKE_MS, type Account, type RevocationReason, type TunnelStatus } from "./contract";

export type { RevocationReason } from "./contract";

export const REVOCATION_CHECK_MS = 5 * 60_000;
export const STALE_CHECK_MS = 30_000;
export const DEAD_TUNNEL_MS = 10 * 60_000;
export const LOCK_CLOCK_MARGIN_MS = 60 * 60_000;

export const REVOCATION_REASONS: readonly RevocationReason[] = ["device_removed", "account_locked", "session_ended", "tunnel_dead"];

export type DeviceCheck = "present" | "removed" | "locked" | "session_ended" | "unknown";

export function checkAccount(account: Pick<Account, "devices" | "graceUntil">, deviceId: string, now: number): DeviceCheck {
  if (!account.devices.some((device) => device.id === deviceId)) return "removed";
  const graceUntil = account.graceUntil ? Date.parse(account.graceUntil) : Number.NaN;
  if (Number.isFinite(graceUntil) && now > graceUntil + LOCK_CLOCK_MARGIN_MS) return "locked";
  return "present";
}

export function checkError(error: unknown): DeviceCheck {
  const sessionEnded = typeof error === "object" && error !== null && (error as { sessionEnded?: unknown }).sessionEnded === true;
  return sessionEnded ? "session_ended" : "unknown";
}

export function tunnelSettled(status: Pick<TunnelStatus, "phase">): boolean {
  return status.phase === "connected" || status.phase === "stale";
}

export function handshakeAge(status: Pick<TunnelStatus, "lastHandshakeAt" | "connectedAt">, now: number): number | null {
  const since = status.lastHandshakeAt ?? status.connectedAt;
  return since === null ? null : Math.max(0, now - since);
}

export function checkDue(input: { status: Pick<TunnelStatus, "phase">; lastCheckAt: number | null; now: number }): boolean {
  if (!tunnelSettled(input.status)) return false;
  if (input.lastCheckAt === null) return true;
  const interval = input.status.phase === "stale" ? STALE_CHECK_MS : REVOCATION_CHECK_MS;
  return input.now - input.lastCheckAt >= interval;
}

export function revocationVerdict(input: {
  check: DeviceCheck;
  status: Pick<TunnelStatus, "phase" | "lastHandshakeAt" | "connectedAt">;
  now: number;
  leakProtected: boolean;
}): RevocationReason | null {
  const { check, status, now } = input;
  if (!tunnelSettled(status)) return null;
  if (check === "removed") return "device_removed";
  if (check === "locked") return "account_locked";
  const age = handshakeAge(status, now);
  if (check === "session_ended") {
    return status.phase === "stale" && age !== null && age > STALE_HANDSHAKE_MS ? "session_ended" : null;
  }
  if (check === "unknown") {
    return !input.leakProtected && age !== null && age >= DEAD_TUNNEL_MS ? "tunnel_dead" : null;
  }
  return null;
}
