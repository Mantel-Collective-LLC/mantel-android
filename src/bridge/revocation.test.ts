import { afterEach, describe, expect, it, vi } from "vitest";
import type { TunnelStatus } from "@shared/contract";
import { STALE_HANDSHAKE_MS } from "@shared/contract";
import { DICTIONARIES } from "@shared/i18n";
import { DEAD_TUNNEL_MS, REVOCATION_CHECK_MS, STALE_CHECK_MS } from "@shared/revocation";
import { ACCOUNT_CODE, fakePreferences, fakeServer, fakeVpn, type CallLog } from "../test/fakes";
import { createAndroidBridgeWithController } from "./android-bridge";
import type { FetchLike } from "../lib/api-client";

const TEXT = DICTIONARIES.de.errors;
const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

const offline: FetchLike = async () => {
  throw new TypeError("Failed to fetch");
};

async function connected(options: { killSwitch?: boolean; bypass?: "server" | "offline" | "none" } = {}) {
  const clock = { now: Date.parse("2026-10-24T12:00:00.000Z") };
  const now = () => clock.now;
  const log: CallLog = [];
  const vpn = fakeVpn(log, { now });
  const server = fakeServer(log);
  if (options.killSwitch === false) server.settings = { ...server.settings, killSwitch: false };
  let tunnelFetch: FetchLike = (input, init) => server.fetch(input, init);
  const bypassCalls: string[] = [];
  const bypass: FetchLike | null =
    options.bypass === "none"
      ? null
      : async (input, init) => {
          bypassCalls.push(`${init.method ?? "GET"} ${new URL(input).pathname}`);
          if (options.bypass === "offline") throw new TypeError("Failed to fetch");
          return server.fetch(input, init);
        };
  const { bridge, controller } = createAndroidBridgeWithController({
    vpn,
    preferences: fakePreferences(),
    fetch: (input, init) => tunnelFetch(input, init),
    bypassFetch: bypass,
    visibility: null,
    now,
    randomSuffix: () => "ABCD",
  });
  disposers.push(() => controller.dispose());
  await controller.ready;
  expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
  expect((await bridge.connect("fra")).ok).toBe(true);
  const statuses: TunnelStatus[] = [];
  bridge.onTunnelStatus((status) => statuses.push(status));
  log.length = 0;
  const advance = async (ms: number, handshakeAgo: number | null = 0) => {
    clock.now += ms;
    vpn.native = { ...vpn.native, lastHandshakeAt: handshakeAgo === null ? vpn.native.lastHandshakeAt : clock.now - handshakeAgo };
    await controller.refreshStatus();
  };
  const cutTunnel = () => {
    tunnelFetch = offline;
  };
  return { clock, log, vpn, server, bridge, controller, statuses, advance, cutTunnel, bypassCalls };
}

describe("device removed on the server", () => {
  it("disconnects, forgets the saved tunnel and the device, and says why", async () => {
    const { bridge, controller, server, vpn, log, advance } = await connected();
    expect(server.devices.map((device) => device.id)).toEqual(["dev1"]);
    server.devices = [];

    expect(await controller.checkRevocation()).toBe("device_removed");
    expect(log).toEqual(["api GET /api/v1/account", "vpn.clearSavedTunnel", "vpn.stop", "secure.remove mantel.deviceKeys"]);
    const status = await bridge.tunnelStatus();
    expect(status).toMatchObject({ phase: "disconnected", revoked: "device_removed", error: TEXT.deviceRemoved });
    expect(TEXT.deviceRemoved).toBe("Dieses Gerät wurde entfernt. Verbinde dich neu, um es wieder anzumelden.");
    expect(vpn.clearSavedTunnel).toHaveBeenCalledTimes(1);

    await advance(5_000);
    expect(await bridge.tunnelStatus()).toMatchObject({ phase: "disconnected", revoked: "device_removed" });
    log.length = 0;
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(log).toContain("api POST /api/v1/devices");
    expect(log).not.toContain("api DELETE /api/v1/devices/dev1");
    expect(server.devices.map((device) => device.id)).toEqual(["dev2"]);
    const after = await bridge.tunnelStatus();
    expect(after.phase).toBe("connected");
    expect(after.revoked).toBeUndefined();
    expect(after.error).toBeNull();
  });

  it("checks by itself: every 5 minutes while connected, not on every 2 s poll", async () => {
    const { controller, server, log, advance } = await connected();
    await advance(2_000);
    await advance(REVOCATION_CHECK_MS - 10_000);
    expect(log.filter((line) => line.startsWith("api "))).toEqual([]);
    server.devices = [];
    await advance(10_000);
    await vi.waitFor(async () => expect((controller.getStatus()).revoked).toBe("device_removed"));
    expect(log.filter((line) => line === "api GET /api/v1/account")).toHaveLength(1);
  });

  it("notices it in the account data the UI refreshes anyway (no extra request)", async () => {
    const { bridge, controller, server, log } = await connected();
    server.devices = [];
    expect((await bridge.account()).ok).toBe(true);
    await vi.waitFor(() => expect(controller.getStatus()).toMatchObject({ phase: "disconnected", revoked: "device_removed" }));
    expect(log.filter((line) => line === "api GET /api/v1/account")).toHaveLength(1);
  });

  it("uses the bypass outside the dead tunnel while stale, also with kill switch / lockdown", async () => {
    const { controller, server, advance, cutTunnel, bypassCalls, statuses } = await connected({ bypass: "server" });
    server.devices = [];
    cutTunnel();
    await advance(STALE_HANDSHAKE_MS + 5_000, STALE_HANDSHAKE_MS + 5_000);
    await vi.waitFor(() => expect(controller.getStatus().revoked).toBe("device_removed"));
    expect(statuses.some((status) => status.phase === "stale")).toBe(true);
    expect(bypassCalls).toEqual(["GET /api/v1/account"]);
  });

  it("ignores an answer that arrives after the user disconnected and connected again", async () => {
    const { bridge, controller, server } = await connected();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = server.fetch;
    server.fetch = async (input, init) => {
      if (new URL(input).pathname === "/api/v1/account" && server.devices.length === 0) await gate;
      return original(input, init);
    };
    server.devices = [];
    const check = controller.checkRevocation();
    server.fetch = original;
    expect((await bridge.disconnect()).ok).toBe(true);
    expect((await bridge.connect("fra")).ok).toBe(true);
    release();
    expect(await check).toBeNull();
    expect((await bridge.tunnelStatus()).phase).toBe("connected");
  });
});

describe("network errors and dead tunnels", () => {
  it("never disconnects on a network error while the handshake is fresh or only stale", async () => {
    const { controller, vpn, advance, cutTunnel, log } = await connected({ bypass: "offline" });
    cutTunnel();
    expect(await controller.checkRevocation()).toBeNull();
    await advance(STALE_HANDSHAKE_MS + 1_000, STALE_HANDSHAKE_MS + 1_000);
    expect(controller.getStatus().phase).toBe("stale");
    expect(await controller.checkRevocation()).toBeNull();
    await advance(DEAD_TUNNEL_MS - STALE_HANDSHAKE_MS - 60_000, DEAD_TUNNEL_MS - 60_000);
    expect(await controller.checkRevocation()).toBeNull();
    expect(controller.getStatus().phase).toBe("stale");
    expect(vpn.stop).not.toHaveBeenCalled();
    expect(log).not.toContain("vpn.clearSavedTunnel");
  });

  it("a stale tunnel is re-checked every 30 s", async () => {
    const { advance, cutTunnel, bypassCalls } = await connected({ bypass: "offline" });
    cutTunnel();
    await advance(STALE_HANDSHAKE_MS + 1_000, STALE_HANDSHAKE_MS + 1_000);
    await vi.waitFor(() => expect(bypassCalls).toHaveLength(1));
    await advance(STALE_CHECK_MS - 5_000, null);
    await advance(2_000, null);
    expect(bypassCalls).toHaveLength(1);
    await advance(3_000, null);
    await vi.waitFor(() => expect(bypassCalls).toHaveLength(2));
  });

  it("without kill switch: disconnects after 10 minutes without handshake when the server cannot be asked", async () => {
    const { controller, vpn, advance, cutTunnel } = await connected({ killSwitch: false, bypass: "offline" });
    cutTunnel();
    await advance(DEAD_TUNNEL_MS + 1_000, DEAD_TUNNEL_MS + 1_000);
    await vi.waitFor(() => expect(controller.getStatus()).toMatchObject({ phase: "disconnected", revoked: "tunnel_dead", error: TEXT.tunnelDead }));
    expect(vpn.stop).toHaveBeenCalled();
    expect(vpn.clearSavedTunnel).not.toHaveBeenCalled();
  });

  it("with kill switch: a dead tunnel stays (offline is the user's choice), the UI shows it as interrupted", async () => {
    const { controller, vpn, advance, cutTunnel } = await connected({ killSwitch: true, bypass: "offline" });
    cutTunnel();
    await advance(DEAD_TUNNEL_MS + 60_000, DEAD_TUNNEL_MS + 60_000);
    expect(await controller.checkRevocation()).toBeNull();
    expect(controller.getStatus().phase).toBe("stale");
    expect(vpn.stop).not.toHaveBeenCalled();
  });
});

describe("account and session", () => {
  it("disconnects when the account is past its grace period", async () => {
    const { controller, server, clock } = await connected();
    const original = server.fetch;
    server.fetch = async (input, init) => {
      const response = await original(input, init);
      if (new URL(input).pathname !== "/api/v1/account") return response;
      const body = (await response.json()) as Record<string, unknown>;
      const past = new Date(clock.now - 8 * 86_400_000).toISOString();
      return Response.json({ ...body, paidUntil: past, expired: true, graceUntil: new Date(clock.now - 86_400_000 - 3_600_001).toISOString() });
    };
    expect(await controller.checkRevocation()).toBe("account_locked");
    expect(controller.getStatus()).toMatchObject({ phase: "disconnected", error: TEXT.accountLockedTunnel });
  });

  it("401 with a working tunnel: logged out, tunnel stays (it still works); once stale it is ended", async () => {
    const { bridge, controller, server, vpn, advance } = await connected();
    const ended = vi.fn();
    bridge.onSessionEnded(ended);
    server.token = "tok_revoked_revoked_revoked_revoked";
    expect(await controller.checkRevocation()).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);
    expect((await bridge.session()).loggedIn).toBe(false);
    expect((await bridge.tunnelStatus()).phase).toBe("connected");
    expect(vpn.stop).not.toHaveBeenCalled();

    await advance(STALE_HANDSHAKE_MS + 5_000, STALE_HANDSHAKE_MS + 5_000);
    await vi.waitFor(() =>
      expect(controller.getStatus()).toMatchObject({ phase: "disconnected", revoked: "session_ended", error: TEXT.sessionEndedTunnel }),
    );
    expect(vpn.clearSavedTunnel).toHaveBeenCalled();
  });

  it("logged out with a running tunnel: disconnect still works", async () => {
    const { bridge, server, vpn } = await connected();
    server.token = "tok_revoked_revoked_revoked_revoked";
    await bridge.account();
    expect((await bridge.session()).loggedIn).toBe(false);
    const result = await bridge.disconnect();
    expect(result.ok).toBe(true);
    expect(vpn.stop).toHaveBeenCalled();
    expect((await bridge.tunnelStatus()).phase).toBe("disconnected");
  });

  it("logout stops the tunnel and forgets it (always-on finds nothing to restart)", async () => {
    const { bridge, vpn, log } = await connected();
    expect((await bridge.logout()).ok).toBe(true);
    expect(log).toContain("vpn.clearSavedTunnel");
    expect(log).toContain("vpn.stop");
    expect(vpn.native.state).toBe("down");
    expect((await bridge.tunnelStatus()).phase).toBe("disconnected");
  });
});

describe("bypassFetch adapter", () => {
  it("maps the native answer to a Response and refuses anything but GET", async () => {
    const { bypassFetchOf } = await import("./controller");
    const log: CallLog = [];
    const vpn = fakeVpn(log);
    expect(bypassFetchOf(vpn)).toBeNull();
    vpn.bypassFetch = vi.fn(async () => ({ status: 404, body: '{"code":"not_found"}', contentType: "application/json" }));
    const fetch = bypassFetchOf(vpn, 5_000)!;
    const response = await fetch("https://api.example/api/v1/account", { method: "GET", headers: { authorization: "Bearer x" } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "not_found" });
    expect(vpn.bypassFetch).toHaveBeenCalledWith({ url: "https://api.example/api/v1/account", headers: { authorization: "Bearer x" }, timeoutMs: 5_000 });
    await expect(fetch("https://api.example/api/v1/devices/x", { method: "DELETE" })).rejects.toThrow(/GET only/);
  });
});
