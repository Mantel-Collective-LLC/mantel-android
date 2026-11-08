import type { LeakProtection, QuantumState, TunnelStatus } from "@shared/contract";
import { phaseFor } from "@desktop-main/wireguard/phase";
import type { NativeTunnelStatus } from "../native/mantel-vpn";

export type RuntimeState = {
  nodeId: string;
  label: string;
  addresses: string[];
  dns: string[];
  endpoint: string | null;
  leakProtection: LeakProtection;
};

export function initialStatus(now = Date.now()): TunnelStatus {
  return {
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
    checkedAt: now,
  };
}

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
const time = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);
const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
const QUANTUM_STATES: readonly QuantumState[] = ["off", "negotiating", "active"];
const quantumOf = (value: unknown): QuantumState | undefined =>
  QUANTUM_STATES.includes(value as QuantumState) && value !== "off" ? (value as QuantumState) : undefined;

export function mapNativeStatus(native: NativeTunnelStatus, runtime: RuntimeState | null, now = Date.now()): TunnelStatus {
  const nodeId = text(native.nodeId, 64);
  const own = runtime !== null && nodeId !== null && runtime.nodeId === nodeId ? runtime : null;
  const error = text(native.error, 500);
  if (native.state !== "up" && native.state !== "connecting") {
    return {
      ...initialStatus(now),
      nodeId: runtime?.nodeId ?? null,
      addresses: runtime?.addresses ?? [],
      dns: runtime?.dns ?? [],
      endpoint: runtime?.endpoint ?? null,
      error,
    };
  }
  const connectedAt = time(native.startedAt) ?? now;
  const lastHandshakeAt = time(native.lastHandshakeAt);
  const phase = native.state === "connecting" ? "connecting" : phaseFor({ now, connectedAt, lastHandshakeAt });
  const quantum = quantumOf(native.quantum);
  return {
    phase,
    nodeId,
    connectedAt,
    lastHandshakeAt,
    rxBytes: count(native.rxBytes),
    txBytes: count(native.txBytes),
    endpoint: text(native.endpoint, 260) ?? own?.endpoint ?? null,
    addresses: own?.addresses ?? [],
    dns: own?.dns ?? [],
    leakProtection: own?.leakProtection ?? "none",
    firewallActive: false,
    serviceState: native.state,
    error,
    checkedAt: now,
    ...(quantum ? { quantum } : {}),
    ...(native.obfuscated === true ? { obfuscated: true } : {}),
  };
}
