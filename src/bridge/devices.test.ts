import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT_CODE, fakePreferences, fakeServer, fakeVpn, type CallLog, type Request } from "../test/fakes";
import { createAndroidBridgeWithController } from "./android-bridge";

const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

async function setup() {
  const log: CallLog = [];
  const vpn = fakeVpn(log);
  const server = fakeServer(log);
  const ports = new Map<string, { port: number; localPort: number | null }[]>();
  const view = (deviceId: string) => ({
    deviceId,
    nodeId: "fra",
    city: "Frankfurt",
    available: true,
    reason: null,
    max: 2,
    localPort: true,
    forwards: (ports.get(deviceId) ?? []).map(({ port, localPort }) => ({ port, host: "198.51.100.7", localPort })),
  });
  const forwarding = (request: Request) => {
    const match = /^\/api\/v1\/devices\/([\w-]+)\/port-forwarding(?:\/(\d+))?$/.exec(request.path);
    const id = match?.[1];
    if (!id) return undefined;
    if (!server.devices.some((device) => device.id === id)) return { status: 404, body: { code: "device_not_found", error: "Device not found." } };
    const list = ports.get(id) ?? [];
    const localPort = (request.body as { localPort?: number | null } | undefined)?.localPort ?? null;
    if (request.method === "POST") {
      ports.set(id, [...list, { port: 41234 + list.length, localPort }]);
      return { status: 201, body: view(id) };
    }
    if (request.method === "PATCH") ports.set(id, list.map((entry) => (entry.port === Number(match[2]) ? { ...entry, localPort } : entry)));
    if (request.method === "DELETE") ports.set(id, match[2] ? list.filter((entry) => entry.port !== Number(match[2])) : []);
    return { status: 200, body: view(id) };
  };
  const { bridge, controller } = createAndroidBridgeWithController({
    vpn,
    preferences: fakePreferences(),
    fetch: (input, init) => {
      const path = new URL(input).pathname;
      if (path.includes("/port-forwarding")) {
        const key = `${init.method ?? "GET"} ${path}`;
        if (!server.override.has(key)) server.override.set(key, forwarding);
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
  return { bridge, controller, server, vpn, log };
}

describe("device management bridge", () => {
  it("knows this installation's device only after the first connect", async () => {
    const { bridge, server } = await setup();
    expect(await bridge.currentDeviceId!()).toBeNull();
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(await bridge.currentDeviceId!()).toBe(server.devices[0]!.id);
  });

  it("renames a device: trimmed name in the PATCH body, the device back", async () => {
    const { bridge, server } = await setup();
    expect((await bridge.connect("fra")).ok).toBe(true);
    const id = server.devices[0]!.id;
    const result = await bridge.renameDevice!(id, "  Laptop  ");
    expect(result).toEqual({
      ok: true,
      value: { id, name: "Laptop", nodeId: "fra", ipv4: server.devices[0]!.ipv4, createdOn: "2026-10-01T00:00:00.000Z" },
    });
    const patch = server.requests.find((request) => request.method === "PATCH");
    expect(patch?.path).toBe(`/api/v1/devices/${id}`);
    expect(patch?.body).toEqual({ name: "Laptop" });
  });

  it("checks rename input at the bridge and translates server errors", async () => {
    const { bridge, server, log } = await setup();
    expect((await bridge.connect("fra")).ok).toBe(true);
    const id = server.devices[0]!.id;
    log.length = 0;
    for (const [badId, name] of [
      ["../x", "Laptop"],
      [id, "   "],
      [id, "x".repeat(65)],
      [id, 42],
    ] as const) {
      const result = await bridge.renameDevice!(badId, name as string);
      expect(result).toEqual({ ok: false, error: "Ungültige Eingabe.", code: "invalid" });
    }
    expect(log).toEqual([]);
    const tooLong = await bridge.renameDevice!(id, "x".repeat(40));
    expect(tooLong).toMatchObject({ ok: false, error: "Gerätenamen dürfen höchstens 32 Zeichen haben." });
    const gone = await bridge.renameDevice!("dev999", "Laptop");
    expect(gone.ok).toBe(false);
  });

  it("removes another device without touching the tunnel", async () => {
    const { bridge, server, log } = await setup();
    expect((await bridge.connect("fra")).ok).toBe(true);
    const own = server.devices[0]!.id;
    server.devices.push({ id: "other1", name: "Phone", nodeId: "ams", ipv4: "10.64.0.99", publicKey: "x" });
    log.length = 0;
    expect(await bridge.removeDevice!("other1")).toEqual({ ok: true, value: null });
    expect(log).toEqual(["api DELETE /api/v1/devices/other1"]);
    expect(await bridge.currentDeviceId!()).toBe(own);
    expect((await bridge.tunnelStatus()).phase).toBe("connected");
  });

  it("removing this installation's device ends the tunnel first and forgets the device; the next connect registers anew", async () => {
    const { bridge, server, log } = await setup();
    expect((await bridge.connect("fra")).ok).toBe(true);
    const own = server.devices[0]!.id;
    log.length = 0;
    expect(await bridge.removeDevice!(own)).toEqual({ ok: true, value: null });
    expect(log).toEqual(["vpn.stop", `api DELETE /api/v1/devices/${own}`, "vpn.clearSavedTunnel", "secure.remove mantel.deviceKeys"]);
    expect(await bridge.currentDeviceId!()).toBeNull();
    expect((await bridge.session()).loggedIn).toBe(true);
    expect((await bridge.tunnelStatus()).phase).toBe("disconnected");
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(server.devices).toHaveLength(1);
    expect(await bridge.currentDeviceId!()).toBe(server.devices[0]!.id);
    expect(server.devices[0]!.id).not.toBe(own);
  });

  it("port forwards of any device: list, add, release one port; unknown device → null", async () => {
    const { bridge, server, log } = await setup();
    server.devices.push({ id: "other1", name: "Phone", nodeId: "fra", ipv4: "10.64.0.99", publicKey: "x" });
    log.length = 0;
    expect(await bridge.devicePortForwarding!("other1")).toMatchObject({ ok: true, value: { forwards: [] } });
    await bridge.addPortForward!("other1");
    const two = await bridge.addPortForward!("other1");
    expect(two.ok && two.value?.forwards.map((forward) => forward.port)).toEqual([41234, 41235]);
    const one = await bridge.removePortForward!("other1", 41234);
    expect(one.ok && one.value?.forwards).toEqual([{ port: 41235, host: "198.51.100.7", localPort: null }]);
    expect(log).toEqual([
      "api GET /api/v1/devices/other1/port-forwarding",
      "api POST /api/v1/devices/other1/port-forwarding",
      "api POST /api/v1/devices/other1/port-forwarding",
      "api DELETE /api/v1/devices/other1/port-forwarding/41234",
    ]);
    expect(await bridge.devicePortForwarding!("gone1")).toEqual({ ok: true, value: null });
    for (const port of [80, 70000, 1.5, "41234"]) {
      expect((await bridge.removePortForward!("other1", port as number)).ok).toBe(false);
    }
    expect((await bridge.addPortForward!("../x")).ok).toBe(false);
  });

  it("port forwards with a local port (agent 2.13): POST {localPort}, PATCH changes it, {} without one", async () => {
    const { bridge, server } = await setup();
    server.devices.push({ id: "other1", name: "Phone", nodeId: "fra", ipv4: "10.64.0.99", publicKey: "x" });
    const added = await bridge.addPortForward!("other1", 3000);
    expect(added.ok && added.value?.localPort).toBe(true);
    expect(added.ok && added.value?.forwards).toEqual([{ port: 41234, host: "198.51.100.7", localPort: 3000 }]);
    const changed = await bridge.setPortForwardLocalPort!("other1", 41234, 8080);
    expect(changed.ok && changed.value?.forwards[0]?.localPort).toBe(8080);
    const reset = await bridge.setPortForwardLocalPort!("other1", 41234, null);
    expect(reset.ok && reset.value?.forwards[0]?.localPort).toBeNull();
    await bridge.addPortForward!("other1");
    const bodies = server.requests.filter((request) => request.path.startsWith("/api/v1/devices/other1/port-forwarding") && request.method !== "GET");
    expect(bodies.map((request) => [request.method, request.path, request.body])).toEqual([
      ["POST", "/api/v1/devices/other1/port-forwarding", { localPort: 3000 }],
      ["PATCH", "/api/v1/devices/other1/port-forwarding/41234", { localPort: 8080 }],
      ["PATCH", "/api/v1/devices/other1/port-forwarding/41234", { localPort: null }],
      ["POST", "/api/v1/devices/other1/port-forwarding", {}],
    ]);
    for (const bad of [0, 65536, 1.5, "3000"]) {
      expect((await bridge.addPortForward!("other1", bad as number)).ok).toBe(false);
      expect((await bridge.setPortForwardLocalPort!("other1", 41234, bad as number)).ok).toBe(false);
    }
  });
});
