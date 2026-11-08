import { describe, expect, it } from "vitest";
import { STALE_HANDSHAKE_MS } from "@shared/contract";
import type { NativeTunnelStatus } from "../native/mantel-vpn";
import { mapNativeStatus, type RuntimeState } from "./status";

const NOW = 1_800_000_000_000;
const runtime: RuntimeState = {
  nodeId: "fra",
  label: "Frankfurt",
  addresses: ["10.64.0.2/32"],
  dns: ["10.64.0.1"],
  endpoint: "198.51.100.7:51820",
  leakProtection: "wireguard",
};
const up = (patch: Partial<NativeTunnelStatus> = {}): NativeTunnelStatus => ({
  state: "up",
  nodeId: "fra",
  startedAt: NOW - 60_000,
  lastHandshakeAt: NOW - 10_000,
  rxBytes: 5,
  txBytes: 6,
  endpoint: "198.51.100.7:51820",
  error: null,
  ...patch,
});

describe("mapNativeStatus", () => {
  it("maps a running tunnel with a fresh handshake to connected", () => {
    expect(mapNativeStatus(up(), runtime, NOW)).toEqual({
      phase: "connected",
      nodeId: "fra",
      connectedAt: NOW - 60_000,
      lastHandshakeAt: NOW - 10_000,
      rxBytes: 5,
      txBytes: 6,
      endpoint: "198.51.100.7:51820",
      addresses: ["10.64.0.2/32"],
      dns: ["10.64.0.1"],
      leakProtection: "wireguard",
      firewallActive: false,
      serviceState: "up",
      error: null,
      checkedAt: NOW,
    });
  });

  it("uses the desktop stale rules", () => {
    expect(mapNativeStatus(up({ lastHandshakeAt: NOW - STALE_HANDSHAKE_MS - 1 }), runtime, NOW).phase).toBe("stale");
    expect(mapNativeStatus(up({ lastHandshakeAt: NOW - STALE_HANDSHAKE_MS + 1 }), runtime, NOW).phase).toBe("connected");
    expect(mapNativeStatus(up({ lastHandshakeAt: null, startedAt: NOW - 5_000 }), runtime, NOW).phase).toBe("connecting");
    expect(mapNativeStatus(up({ lastHandshakeAt: null, startedAt: NOW - 60_000 }), runtime, NOW).phase).toBe("stale");
    expect(mapNativeStatus(up({ state: "connecting" }), runtime, NOW).phase).toBe("connecting");
  });

  it("does not attribute another node's runtime to the tunnel", () => {
    const status = mapNativeStatus(up({ nodeId: "ams", endpoint: null }), runtime, NOW);
    expect(status).toMatchObject({ nodeId: "ams", addresses: [], dns: [], endpoint: null, leakProtection: "none" });
  });

  it("maps a stopped tunnel to disconnected and keeps the native error", () => {
    const status = mapNativeStatus({ ...up(), state: "down", error: "Handshake fehlgeschlagen." }, runtime, NOW);
    expect(status).toMatchObject({
      phase: "disconnected",
      connectedAt: null,
      lastHandshakeAt: null,
      rxBytes: 0,
      txBytes: 0,
      leakProtection: "none",
      error: "Handshake fehlgeschlagen.",
    });
  });

  it("sanitizes odd native values", () => {
    const status = mapNativeStatus(up({ rxBytes: -1, txBytes: Number.NaN, startedAt: null }), null, NOW);
    expect(status).toMatchObject({ rxBytes: 0, txBytes: 0, connectedAt: NOW });
  });
});
