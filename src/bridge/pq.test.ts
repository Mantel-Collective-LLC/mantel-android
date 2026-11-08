import { afterEach, describe, expect, it } from "vitest";
import { PQ_ADDRESS, type TunnelStatus } from "@shared/contract";
import { DICTIONARIES } from "@shared/i18n";
import { nodesSchema } from "../lib/schemas";
import { KEYS } from "../lib/storage";
import { buildTunnelConfig, planAllowedIps } from "../lib/wireguard-config";
import type { NativeTunnelStatus } from "../native/mantel-vpn";
import { ACCOUNT_CODE, SERVER_PUBLIC_KEY, fakePreferences, fakeServer, fakeVpn, wgKey, type CallLog } from "../test/fakes";
import { createAndroidBridgeWithController } from "./android-bridge";
import { pqStartError } from "./controller";
import { mapNativeStatus } from "./status";

const DE = DICTIONARIES.de.errors;

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});

async function setup(prefsInit: Record<string, unknown> = {}) {
  const log: CallLog = [];
  const vpn = fakeVpn(log);
  const server = fakeServer(log);
  const prefs = fakePreferences(prefsInit);
  const { bridge, controller } = createAndroidBridgeWithController({
    vpn,
    preferences: prefs,
    fetch: (input, init) => server.fetch(input, init),
    visibility: null,
    randomSuffix: () => "ABCD",
  });
  disposers.push(() => controller.dispose());
  await controller.ready;
  const statuses: TunnelStatus[] = [];
  bridge.onTunnelStatus((status) => statuses.push(status));
  expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
  log.length = 0;
  return { log, vpn, server, prefs, bridge, controller, statuses };
}

const storedPrefs = (prefs: ReturnType<typeof fakePreferences>) =>
  JSON.parse(prefs.data.get(KEYS.preferences) ?? "null") as Record<string, unknown> | null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("post-quantum setting", () => {
  it("is off by default and connects classically", async () => {
    const { bridge, vpn } = await setup();
    expect((await bridge.preferences()).postQuantum).toBe(false);
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(vpn.lastStart?.postQuantum).toBe(false);
    expect((await bridge.tunnelStatus()).quantum).toBeUndefined();
  });

  it("is stored per device, survives a restart and validates its input", async () => {
    const first = await setup();
    expect(await first.bridge.setPostQuantum!("yes" as unknown as boolean)).toMatchObject({ ok: false, code: "invalid" });
    const on = await first.bridge.setPostQuantum!(true);
    expect(on).toMatchObject({ ok: true, value: { postQuantum: true } });
    expect(storedPrefs(first.prefs)).toMatchObject({ postQuantum: true });
    expect(first.server.requests.some((request) => request.path === "/api/v1/settings")).toBe(false);

    const second = await setup({ [KEYS.preferences]: storedPrefs(first.prefs) });
    expect((await second.bridge.preferences()).postQuantum).toBe(true);
    expect((await second.bridge.setPostQuantum!(false)).ok).toBe(true);
    expect((await second.bridge.preferences()).postQuantum).toBe(false);
  });

  it("preferences of an older app version (no field) mean off", async () => {
    const { bridge } = await setup({ [KEYS.preferences]: { baseUrl: "https://api.example", lastNodeId: "fra" } });
    expect((await bridge.preferences()).postQuantum).toBe(false);
  });
});

describe("connecting with the post-quantum setting on", () => {
  it("passes postQuantum to the native start and reports the active quantum state", async () => {
    const { bridge, vpn, statuses } = await setup();
    await bridge.setPostQuantum!(true);
    const result = await bridge.connect("fra");
    expect(result).toMatchObject({ ok: true, value: { phase: "connected", quantum: "active" } });
    expect(vpn.lastStart?.postQuantum).toBe(true);
    expect(statuses.some((status) => status.phase === "connecting" && status.quantum === "negotiating")).toBe(true);
  });

  it("refuses a location without PQ capability before any tunnel (fail closed)", async () => {
    const { bridge, vpn } = await setup();
    await bridge.setPostQuantum!(true);
    const result = await bridge.connect("ams");
    expect(result).toEqual({ ok: false, code: "pq_unsupported", error: DE.pqUnsupported });
    expect(vpn.start).not.toHaveBeenCalled();
    expect(vpn.stop).not.toHaveBeenCalled();
    expect((await bridge.tunnelStatus()).phase).toBe("disconnected");
  });

  it("takes a still running classic tunnel down when the location cannot do PQ", async () => {
    const { bridge, vpn } = await setup();
    expect((await bridge.connect("ams")).ok).toBe(true);
    expect(vpn.start).toHaveBeenCalledTimes(1);
    await bridge.setPostQuantum!(true);
    await bridge.tunnelStatus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = await bridge.tunnelStatus();
    expect(vpn.start).toHaveBeenCalledTimes(1);
    expect(vpn.stop).toHaveBeenCalled();
    expect(status.phase).toBe("disconnected");
    expect(status.error).toBe(DE.pqUnsupported);
  });

  it("maps native PQ failures to the shared codes and texts, tunnel down", async () => {
    for (const [code, text] of [
      ["pq_failed", DE.pqFailed],
      ["pq_mismatch", DE.pqMismatch],
      ["pq_not_active", DE.pqNotActive],
      ["pq_unsupported", DE.pqUnsupported],
    ] as const) {
      const { bridge, vpn } = await setup();
      await bridge.setPostQuantum!(true);
      vpn.start.mockRejectedValueOnce(Object.assign(new Error("native text"), { code }));
      const result = await bridge.connect("fra");
      expect(result).toEqual({ ok: false, code, error: text });
      const status = await bridge.tunnelStatus();
      expect(status.phase).toBe("disconnected");
      expect(status.error).toBe(text);
    }
  });

  it("switching the setting while connected reconnects with it", async () => {
    const { bridge, vpn } = await setup();
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(vpn.lastStart?.postQuantum).toBe(false);
    expect((await bridge.setPostQuantum!(true)).ok).toBe(true);
    await bridge.tunnelStatus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vpn.start).toHaveBeenCalledTimes(2);
    expect(vpn.lastStart?.postQuantum).toBe(true);
    expect((await bridge.tunnelStatus()).quantum).toBe("active");
    await bridge.setPostQuantum!(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vpn.start).toHaveBeenCalledTimes(2);
  });

  it("excluded-app changes keep the PQ setting of the running tunnel", async () => {
    const { bridge, vpn } = await setup();
    await bridge.setPostQuantum!(true);
    await bridge.connect("fra");
    expect((await bridge.setExcludedApps!(["com.example.bank"])).ok).toBe(true);
    expect(vpn.lastStart).toMatchObject({ postQuantum: true, excludedApps: ["com.example.bank"] });
  });

  it("disconnect during the negotiation cancels it natively at once", async () => {
    const { bridge, vpn, log } = await setup();
    await bridge.setPostQuantum!(true);
    const pending = deferred<NativeTunnelStatus>();
    vpn.start.mockImplementationOnce(() => {
      log.push("vpn.start (negotiating)");
      return pending.promise;
    });
    const connecting = bridge.connect("fra");
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 20 && !log.includes("vpn.start (negotiating)"); i++) await new Promise((r) => setTimeout(r, 0));
    expect((await bridge.tunnelStatus()).quantum).toBe("negotiating");
    const disconnecting = bridge.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vpn.stop).toHaveBeenCalledTimes(1);
    pending.reject(Object.assign(new Error("Der Verbindungsaufbau wurde abgebrochen."), { code: "cancelled" }));
    expect((await connecting).ok).toBe(false);
    expect((await disconnecting).ok).toBe(true);
    const status = await bridge.tunnelStatus();
    expect(status.phase).toBe("disconnected");
    expect(status.error).toBeNull();
  });
});

describe("pieces", () => {
  it("nodes keep the postQuantum capability; older servers without it mean none", () => {
    const base = { id: "x", city: "X", country: "DE", endpointHost: "198.51.100.1", endpointPort: 51820, online: true };
    const parsed = nodesSchema.parse([{ ...base, postQuantum: true }, { ...base, postQuantum: false }, base]);
    expect(parsed.map((node) => node.postQuantum)).toEqual([true, false, false]);
  });

  it("routes the PQ endpoint through the tunnel in LAN mode only when PQ is on", () => {
    const lan = { killSwitch: true, lanAccess: true };
    const covers = (cidrs: string[]) => cidrs.includes(`${PQ_ADDRESS}/32`);
    expect(covers(planAllowedIps(lan, ["10.8.0.1"], true))).toBe(true);
    expect(covers(planAllowedIps(lan, ["10.8.0.1"], false))).toBe(false);
    const config = buildTunnelConfig({
      privateKey: wgKey(1),
      server: {
        address: ["10.8.0.2/32"],
        dns: ["10.8.0.1"],
        serverPublicKey: SERVER_PUBLIC_KEY,
        endpoint: "198.51.100.7:51820",
        allowedIps: [],
      },
      endpoint: { host: "198.51.100.7", port: 51820 },
      settings: { ...lan, ipv6: false },
      postQuantum: true,
    });
    expect(config.allowedIps).toContain(`${PQ_ADDRESS}/32`);
  });

  it("maps the native quantum state; unknown values are ignored", () => {
    const native: NativeTunnelStatus = {
      state: "connecting",
      nodeId: "fra",
      startedAt: 1,
      lastHandshakeAt: null,
      rxBytes: 0,
      txBytes: 0,
      endpoint: null,
      error: null,
      quantum: "negotiating",
    };
    expect(mapNativeStatus(native, null, 10)).toMatchObject({ phase: "connecting", quantum: "negotiating" });
    expect(mapNativeStatus({ ...native, state: "up", lastHandshakeAt: 5, quantum: "active" }, null, 10).quantum).toBe("active");
    expect(mapNativeStatus({ ...native, quantum: "off" }, null, 10).quantum).toBeUndefined();
    expect(mapNativeStatus({ ...native, quantum: "bogus" as never }, null, 10).quantum).toBeUndefined();
    expect(mapNativeStatus({ ...native, state: "down" }, null, 10).quantum).toBeUndefined();
  });

  it("only PQ codes of native rejections are mapped", () => {
    const other = Object.assign(new Error("x"), { code: "backend" });
    expect(pqStartError(other)).toBe(other);
    expect(pqStartError(null)).toBeNull();
    expect(pqStartError(Object.assign(new Error("x"), { code: "pq_failed" }))).toMatchObject({ code: "pq_failed" });
  });
});
