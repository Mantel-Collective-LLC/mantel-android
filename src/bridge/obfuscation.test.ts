import { afterEach, describe, expect, it } from "vitest";
import { deviceSchema, nodesSchema } from "../lib/schemas";
import type { NativeTunnelStatus } from "../native/mantel-vpn";
import { ACCOUNT_CODE, OBFS_PIN, fakePreferences, fakeServer, fakeVpn, obfsTokenOf, type CallLog, type Request } from "../test/fakes";
import { createAndroidBridgeWithController } from "./android-bridge";
import { mapNativeStatus } from "./status";

const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

async function setup(options: { tokens?: boolean; nativeSetting?: boolean } = {}) {
  const log: CallLog = [];
  const vpn = fakeVpn(log);
  if (options.nativeSetting === false) {
    delete (vpn as Partial<typeof vpn>).obfuscation;
    delete (vpn as Partial<typeof vpn>).setObfuscation;
  }
  const server = fakeServer(log);
  server.obfsTokens = options.tokens ?? true;
  const { bridge, controller } = createAndroidBridgeWithController({
    vpn,
    preferences: fakePreferences(),
    fetch: (input, init) => server.fetch(input, init),
    bypassFetch: null,
    visibility: null,
    randomSuffix: () => "ABCD",
  });
  disposers.push(() => controller.dispose());
  await controller.ready;
  expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
  return { bridge, vpn, server, log };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("obfuscation setting", () => {
  it("is auto by default, stored natively and validated", async () => {
    const { bridge, vpn, server } = await setup();
    expect((await bridge.preferences()).obfuscation).toBe("auto");
    expect(await bridge.setObfuscation!("tls" as never)).toMatchObject({ ok: false, code: "invalid" });
    expect(vpn.setObfuscation).not.toHaveBeenCalled();
    expect(await bridge.setObfuscation!("on")).toMatchObject({ ok: true, value: { obfuscation: "on" } });
    expect(vpn.setObfuscation).toHaveBeenCalledWith({ mode: "on" });
    expect(vpn.obfuscationMode).toBe("on");
    expect(server.requests.some((request) => request.path === "/api/v1/settings")).toBe(false);
  });

  it("is not offered with an older native side", async () => {
    const { bridge } = await setup({ nativeSetting: false });
    expect((await bridge.preferences()).obfuscation).toBeUndefined();
    expect((await bridge.setObfuscation!("on")).ok).toBe(false);
  });

  it("switching it while connected reconnects; the same value does not", async () => {
    const { bridge, vpn } = await setup();
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect((await bridge.tunnelStatus()).obfuscated).toBeUndefined();
    await bridge.setObfuscation!("on");
    await settle();
    expect(vpn.start).toHaveBeenCalledTimes(2);
    expect((await bridge.tunnelStatus())).toMatchObject({ phase: "connected", obfuscated: true });
    await bridge.setObfuscation!("on");
    await settle();
    expect(vpn.start).toHaveBeenCalledTimes(2);
  });
});

describe("native start", () => {
  it("gets the node offer and the device token", async () => {
    const { bridge, vpn } = await setup();
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(vpn.lastStart?.obfuscation).toEqual({ host: "198.51.100.7", port: 443, pin: OBFS_PIN, token: obfsTokenOf("dev1") });
    expect((await bridge.setExcludedApps!(["com.example.bank"])).ok).toBe(true);
    expect(vpn.lastStart).toMatchObject({ excludedApps: ["com.example.bank"], obfuscation: { token: obfsTokenOf("dev1") } });
  });

  it("gets nothing without an offer or without a token", async () => {
    const withoutOffer = await setup();
    expect((await withoutOffer.bridge.connect("ams")).ok).toBe(true);
    expect(withoutOffer.vpn.lastStart && "obfuscation" in withoutOffer.vpn.lastStart).toBe(false);

    const olderServer = await setup({ tokens: false });
    expect((await olderServer.bridge.connect("fra")).ok).toBe(true);
    expect(olderServer.vpn.lastStart && "obfuscation" in olderServer.vpn.lastStart).toBe(false);
  });

  it("keeps the token out of the account the UI sees", async () => {
    const { bridge } = await setup();
    await bridge.connect("fra");
    const account = await bridge.account();
    expect(account.ok).toBe(true);
    expect(JSON.stringify(account)).not.toContain("obfs_");
  });

  it("takes the new token of a key rotation", async () => {
    const { bridge, vpn, server } = await setup();
    await bridge.connect("fra");
    await bridge.disconnect();
    server.override.set("POST /api/v1/devices/dev1/key", (request: Request) => ({
      status: 200,
      body: {
        device: { id: "dev1", name: "x", nodeId: "fra", ipv4: "10.64.0.2", createdOn: "2026-10-22T00:00:00.000Z", obfsToken: "obfs_rotated_0123456789" },
        config: {
          address: ["10.64.0.2/32"],
          dns: ["10.64.0.1"],
          serverPublicKey: "h2lcXP+HuIipSc5D9u5MMVC139EotqrfTZ6u/c++XwA=",
          endpoint: "198.51.100.7:51820",
          allowedIps: ["0.0.0.0/0", "::/0"],
        },
        publicKey: (request.body as { publicKey: string }).publicKey,
      },
    }));
    expect((await bridge.rotateDeviceKey!()).ok).toBe(true);
    server.obfsTokens = false;
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(vpn.lastStart?.obfuscation?.token).toBe("obfs_rotated_0123456789");
  });

  it("shows the native error and leaves the tunnel down when 'on' is impossible (fail closed)", async () => {
    const { bridge, vpn } = await setup();
    await bridge.setObfuscation!("on");
    const text = "Verschleierung steht auf „An“, aber dieser Standort oder dieses Gerät bietet sie noch nicht an.";
    vpn.start.mockRejectedValueOnce(Object.assign(new Error(text), { code: "obfs_unavailable" }));
    const result = await bridge.connect("ams");
    expect(result).toMatchObject({ ok: false, error: text });
    expect(vpn.stop).toHaveBeenCalled();
    expect(await bridge.tunnelStatus()).toMatchObject({ phase: "disconnected", error: text });
  });
});

describe("parsing and status", () => {
  it("accepts only version 1 with a valid pin, and valid tokens", () => {
    const base = { id: "x", city: "X", country: "DE", endpointHost: "198.51.100.1", endpointPort: 51820, online: true };
    const [v1, v2, badPin, none] = nodesSchema.parse([
      { ...base, obfuscation: { version: 1, port: 443, pin: OBFS_PIN } },
      { ...base, obfuscation: { version: 2, port: 443, pin: OBFS_PIN } },
      { ...base, obfuscation: { version: 1, port: 443, pin: "nope" } },
      base,
    ]);
    expect(v1!.obfuscation).toEqual({ version: 1, port: 443, pin: OBFS_PIN });
    expect(v2!.obfuscation).toBeUndefined();
    expect(badPin!.obfuscation).toBeUndefined();
    expect(none!.obfuscation).toBeUndefined();

    const device = { id: "d", name: "n", nodeId: "fra", ipv4: "10.64.0.2", createdOn: "2026-10-22T00:00:00.000Z" };
    expect(deviceSchema.parse({ ...device, obfsToken: "tok\r\nX: y_0123456789" }).obfsToken).toBeUndefined();
    expect(deviceSchema.parse({ ...device, obfsToken: "short" }).obfsToken).toBeUndefined();
    expect(deviceSchema.parse({ ...device, obfsToken: obfsTokenOf("d") }).obfsToken).toBe(obfsTokenOf("d"));
  });

  it("maps the native obfuscated flag", () => {
    const native: NativeTunnelStatus = {
      state: "up",
      nodeId: "fra",
      startedAt: 1,
      lastHandshakeAt: 1,
      rxBytes: 0,
      txBytes: 0,
      endpoint: "198.51.100.7:443",
      error: null,
    };
    expect(mapNativeStatus({ ...native, obfuscated: true }, null, 2).obfuscated).toBe(true);
    expect("obfuscated" in mapNativeStatus(native, null, 2)).toBe(false);
    expect("obfuscated" in mapNativeStatus({ ...native, state: "down", obfuscated: true }, null, 2)).toBe(false);
  });
});
