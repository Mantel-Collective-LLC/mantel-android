import { STALE_HANDSHAKE_MS, type TunnelPhase } from "../../core/contract";

const HANDSHAKE_GRACE_MS = 30_000;

export function phaseFor(input: {
  now: number;
  connectedAt: number | null;
  lastHandshakeAt: number | null;
}): TunnelPhase {
  if (input.lastHandshakeAt === null) {
    const since = input.connectedAt === null ? Number.POSITIVE_INFINITY : input.now - input.connectedAt;
    return since < HANDSHAKE_GRACE_MS ? "connecting" : "stale";
  }
  return input.now - input.lastHandshakeAt > STALE_HANDSHAKE_MS ? "stale" : "connected";
}
