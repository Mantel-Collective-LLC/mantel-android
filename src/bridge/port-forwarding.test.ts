import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT_CODE, fakePreferences, fakeServer, fakeVpn, type CallLog, type Request } from "../test/fakes";
import { createAndroidBridgeWithController } from "./android-bridge";

const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

async function setup() {
  const log: CallLog = [];
  const vpn = fakeVpn(log);
  const server = fakeServer(log);
  let port: number | null = null;
  const view = (deviceId: string, available = true) => ({
    deviceId,
    nodeId: "fra",
    city: "Frankfurt",
    country: "DE",
    available,
    reason: available ? null : "unsupported",
    max: 1,
    forwards: port ? [{ port, host: "198.51.100.7", protocols: ["tcp", "udp"] }] : [],
  });
  const forwarding = (request: Request) => {
    const match = /^\/api\/v1\/devices\/([\w-]+)\/port-forwarding$/.exec(request.path);
    const id = match?.[1];
    if (!id) return undefined;
    if (!server.devices.some((device) => device.id === id)) return { status: 404, body: { code: "device_not_found", error: "Device not found." } };
    if (request.method === "POST") {
      port = 41234;
      return { status: 201, body: view(id) };
    }
    if (request.method === "DELETE") port = null;
    return { status: 200, body: view(id) };
  };
  const { bridge, controller } = createAndroidBridgeWithController({
    vpn,
    preferences: fakePreferences(),
    fetch: (input, init) => {
      const path = new URL(input).pathname;
      if (path.endsWith("/port-forwarding")) {
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
  return { bridge, controller, server, log };
}

describe("port forwarding bridge", () => {
  it("is offered by the Android bridge", async () => {
    const { bridge } = await setup();
    expect(typeof bridge.portForwarding).toBe("function");
    expect(typeof bridge.setPortForwarding).toBe("function");
  });

  it("before the first connect there is no device: null, no API call", async () => {
    const { bridge, log } = await setup();
    expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
    log.length = 0;
    expect(await bridge.portForwarding!()).toEqual({ ok: true, value: null });
    expect(await bridge.setPortForwarding!(true)).toEqual({ ok: true, value: null });
    expect(log.filter((entry) => entry.includes("port-forwarding"))).toEqual([]);
  });

  it("works on the connected device: on → port, off → released", async () => {
    const { bridge, server, log } = await setup();
    expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
    expect((await bridge.connect("fra")).ok).toBe(true);
    const deviceId = server.devices[0]!.id;
    log.length = 0;
    expect(await bridge.portForwarding!()).toEqual({ ok: true, value: { nodeId: "fra", city: "Frankfurt", available: true, reason: null, max: 1, forwards: [] } });
    const on = await bridge.setPortForwarding!(true);
    expect(on).toEqual({ ok: true, value: { nodeId: "fra", city: "Frankfurt", available: true, reason: null, max: 1, forwards: [{ port: 41234, host: "198.51.100.7" }] } });
    const off = await bridge.setPortForwarding!(false);
    expect(off.ok && off.value?.forwards).toEqual([]);
    expect(log.filter((entry) => entry.includes("port-forwarding"))).toEqual([
      `api GET /api/v1/devices/${deviceId}/port-forwarding`,
      `api POST /api/v1/devices/${deviceId}/port-forwarding`,
      `api DELETE /api/v1/devices/${deviceId}/port-forwarding`,
    ]);
    const post = server.requests.find((request) => request.method === "POST" && request.path.endsWith("/port-forwarding"));
    expect(post?.body).toEqual({});
    expect(post?.headers.authorization).toBe(`Bearer ${server.token}`);
  });

  it("device deleted on the website: null instead of an error; other errors are translated", async () => {
    const { bridge, server } = await setup();
    expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
    expect((await bridge.connect("fra")).ok).toBe(true);
    const deviceId = server.devices[0]!.id;
    server.override.set(`POST /api/v1/devices/${deviceId}/port-forwarding`, () => ({
      status: 503,
      body: { code: "port_forwarding_unavailable", error: "Frankfurt does not offer port forwarding right now.", params: { city: "Frankfurt" } },
    }));
    const refused = await bridge.setPortForwarding!(true);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toBe("Frankfurt bietet gerade keine Portweiterleitung an.");
    server.devices = [];
    expect(await bridge.portForwarding!()).toEqual({ ok: true, value: null });
  });

  it("rejects a non-boolean switch value", async () => {
    const { bridge } = await setup();
    const result = await bridge.setPortForwarding!("yes" as never);
    expect(result.ok).toBe(false);
  });
});
