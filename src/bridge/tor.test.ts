import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT_CODE, fakePreferences, fakeServer, fakeVpn, NODES, type CallLog } from "../test/fakes";
import { createAndroidBridgeWithController } from "./android-bridge";

const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

async function setup() {
  const log: CallLog = [];
  const vpn = fakeVpn(log);
  const server = fakeServer(log);
  let tor = false;
  const device = (id: string) => {
    const own = server.devices.find((entry) => entry.id === id)!;
    return { id, name: own.name, nodeId: own.nodeId, ipv4: own.ipv4, ipv6: null, createdOn: "2026-10-01T00:00:00.000Z", tor, torSocks: tor ? "10.8.0.1:9050" : null };
  };
  server.override.set("GET /api/v1/nodes", () => ({ status: 200, body: NODES.map((node) => (node.id === "fra" ? { ...node, tor: "ready" } : node)) }));
  server.override.set("GET /api/v1/account", () => ({
    status: 200,
    body: { id: "acc1", paidUntil: "2027-01-01T00:00:00.000Z", settings: server.settings, devices: server.devices.map((entry) => device(entry.id)) },
  }));
  const { bridge, controller } = createAndroidBridgeWithController({
    vpn,
    preferences: fakePreferences(),
    fetch: (input, init) => {
      const path = new URL(input).pathname;
      const match = /^\/api\/v1\/devices\/([\w-]+)\/tor$/.exec(path);
      if (match && !server.override.has(`PUT ${path}`)) {
        server.override.set(`PUT ${path}`, (request) => {
          if (!server.devices.some((entry) => entry.id === match[1])) return { status: 404, body: { code: "device_not_found", error: "x" } };
          tor = (request.body as { enabled: boolean }).enabled;
          return { status: 200, body: device(match[1]!) };
        });
      }
      return server.fetch(input, init);
    },
    bypassFetch: null,
    visibility: null,
    randomSuffix: () => "ABCD",
  });
  disposers.push(() => controller.dispose());
  await controller.ready;
  return { bridge, server, log };
}

describe("tor bridge", () => {
  it("before the first connect there is no device: null, no PUT", async () => {
    const { bridge, log } = await setup();
    expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
    expect(await bridge.tor!()).toEqual({ ok: true, value: null });
    expect(await bridge.setTor!(true)).toEqual({ ok: true, value: null });
    expect(log.filter((entry) => entry.includes("/tor"))).toEqual([]);
  });

  it("reads and switches the connected device; the node's Tor state comes from /nodes", async () => {
    const { bridge, server } = await setup();
    expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
    expect((await bridge.connect("fra")).ok).toBe(true);
    const deviceId = server.devices[0]!.id;
    const off = { deviceId, nodeId: "fra", city: "Frankfurt", enabled: false, availability: "ready", socks: null };
    expect(await bridge.tor!()).toEqual({ ok: true, value: off });
    expect(await bridge.setTor!(true)).toEqual({ ok: true, value: { ...off, enabled: true, socks: "10.8.0.1:9050" } });
    const put = server.requests.find((request) => request.method === "PUT");
    expect(put?.path).toBe(`/api/v1/devices/${deviceId}/tor`);
    expect(put?.body).toEqual({ enabled: true });
    expect(put?.headers.authorization).toBe(`Bearer ${server.token}`);
  });

  it("translates tor_unavailable and node_unavailable; a deleted device reads as null", async () => {
    const { bridge, server } = await setup();
    expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
    expect((await bridge.connect("fra")).ok).toBe(true);
    const path = `/api/v1/devices/${server.devices[0]!.id}/tor`;
    server.override.set(`PUT ${path}`, () => ({ status: 409, body: { code: "tor_unavailable", error: "x", params: { city: "Frankfurt" } } }));
    const refused = await bridge.setTor!(true);
    expect(!refused.ok && refused.error).toBe("Frankfurt bietet Tor gerade nicht an.");
    server.override.set(`PUT ${path}`, () => ({ status: 503, body: { code: "node_unavailable", error: "x", params: { city: "Frankfurt" } } }));
    const unreachable = await bridge.setTor!(true);
    expect(!unreachable.ok && unreachable.error).toContain("Frankfurt");
    server.devices = [];
    expect(await bridge.tor!()).toEqual({ ok: true, value: null });
  });

  it("rejects a non-boolean switch value", async () => {
    const { bridge } = await setup();
    expect((await bridge.setTor!("yes" as never)).ok).toBe(false);
  });
});
