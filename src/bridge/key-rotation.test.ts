import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT_CODE, fakePreferences, fakeServer, fakeVpn, type CallLog, type Request } from "../test/fakes";
import { createAndroidBridgeWithController } from "./android-bridge";

const DAY = 86_400_000;
const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

async function setup() {
  const log: CallLog = [];
  const vpn = fakeVpn(log);
  const server = fakeServer(log);
  const clock = { now: Date.parse("2026-11-04T12:00:00.000Z") };
  const rotations: string[] = [];
  const failures: Array<"network" | 503> = [];
  const rotate = (request: Request) => {
    const id = /^\/api\/v1\/devices\/([\w-]+)\/key$/.exec(request.path)?.[1];
    const device = server.devices.find((entry) => entry.id === id);
    if (!device) return { status: 404, body: { code: "device_not_found", error: "Device not found." } };
    const publicKey = (request.body as { publicKey: string }).publicKey;
    rotations.push(publicKey);
    if (failures[0] === 503) {
      failures.shift();
      return { status: 503, body: { code: "node_unavailable", error: "Frankfurt can't be reached right now.", params: { city: "Frankfurt" } } };
    }
    device.publicKey = publicKey;
    return {
      status: 200,
      body: {
        device: { id: device.id, name: device.name, nodeId: device.nodeId, ipv4: device.ipv4, ipv6: null, createdOn: "2026-10-22T00:00:00.000Z", keyRotatedOn: "2026-11-04" },
        config: { address: [`${device.ipv4}/32`], dns: ["10.64.0.1"], serverPublicKey: "h2lcXP+HuIipSc5D9u5MMVC139EotqrfTZ6u/c++XwA=", endpoint: "198.51.100.7:51820", allowedIps: ["0.0.0.0/0", "::/0"] },
        killSwitchCompatible: true,
      },
    };
  };
  const { bridge, controller } = createAndroidBridgeWithController({
    vpn,
    preferences: fakePreferences(),
    now: () => clock.now,
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path.endsWith("/key")) {
        const key = `${init.method ?? "GET"} ${path}`;
        if (!server.override.has(key)) server.override.set(key, rotate);
        if (failures[0] === "network") {
          failures.shift();
          rotate({ method: "POST", path, headers: {}, body: JSON.parse(String(init.body)) } as Request);
          throw new TypeError("Failed to fetch");
        }
      }
      return server.fetch(input, init);
    },
    bypassFetch: null,
    visibility: null,
    randomSuffix: () => "ABCD",
  });
  disposers.push(() => controller.dispose());
  await controller.ready;
  expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
  const lastConfig = () => String(vpn.start.mock.calls.at(-1)?.[0]?.config ?? "");
  return { bridge, controller, server, vpn, log, clock, rotations, failures, lastConfig };
}

describe("key rotation (Android)", () => {
  it("is offered by the bridge; no device yet → null without API call", async () => {
    const { bridge, rotations } = await setup();
    expect(await bridge.deviceKey!()).toEqual({ ok: true, value: null });
    expect(await bridge.rotateDeviceKey!()).toEqual({ ok: true, value: null });
    expect(rotations).toEqual([]);
  });

  it("a fresh device is not rotated; after 30 days the next connect renews it silently, same device", async () => {
    const { bridge, server, clock, rotations, lastConfig } = await setup();
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(await bridge.deviceKey!()).toEqual({ ok: true, value: { createdAt: clock.now } });
    const firstConfig = lastConfig();
    expect((await bridge.disconnect()).ok).toBe(true);
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(rotations).toEqual([]);

    expect((await bridge.disconnect()).ok).toBe(true);
    clock.now += 30 * DAY;
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(rotations).toHaveLength(1);
    expect(server.devices).toHaveLength(1);
    expect(server.devices[0]!.publicKey).toBe(rotations[0]);
    const privateKey = /^PrivateKey = (.+)$/m.exec(lastConfig())?.[1];
    expect(privateKey).toBeTruthy();
    expect(privateKey).not.toBe(/^PrivateKey = (.+)$/m.exec(firstConfig)?.[1]);
    expect(await bridge.deviceKey!()).toEqual({ ok: true, value: { createdAt: clock.now } });
  });

  it("manual while connected: stop, rotate, start with the new key", async () => {
    const { bridge, vpn, log, clock, rotations } = await setup();
    expect((await bridge.connect("fra")).ok).toBe(true);
    log.length = 0;
    clock.now += 60_000;
    const result = await bridge.rotateDeviceKey!();
    expect(result).toEqual({ ok: true, value: { createdAt: clock.now } });
    expect(rotations).toHaveLength(1);
    const order = log.filter((entry) => entry === "vpn.stop" || entry.includes("/key") || entry.startsWith("vpn.start"));
    expect(order[0]).toBe("vpn.stop");
    expect(order.findIndex((entry) => entry.includes("/key"))).toBeGreaterThan(0);
    expect(order.at(-1)).toMatch(/^vpn\.start/);
    expect(vpn.native.state).not.toBe("down");
  });

  it("server refuses: error shown, old key stays, tunnel comes back", async () => {
    const { bridge, server, failures, lastConfig } = await setup();
    expect((await bridge.connect("fra")).ok).toBe(true);
    const before = server.devices[0]!.publicKey;
    const config = lastConfig();
    failures.push(503);
    const result = await bridge.rotateDeviceKey!();
    expect(result.ok).toBe(false);
    expect(server.devices[0]!.publicKey).toBe(before);
    expect(lastConfig()).toBe(config);
  });

  it("lost answer: the pending pair is sent again before the next connect and then used", async () => {
    const { bridge, server, clock, failures, rotations, lastConfig } = await setup();
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect((await bridge.disconnect()).ok).toBe(true);
    clock.now += 31 * DAY;
    failures.push("network");
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(rotations).toHaveLength(1);
    expect((await bridge.disconnect()).ok).toBe(true);
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(rotations).toHaveLength(2);
    expect(rotations[1]).toBe(rotations[0]);
    expect(server.devices[0]!.publicKey).toBe(rotations[0]);
    expect(lastConfig()).toMatch(/^PrivateKey = /m);
  });
});
