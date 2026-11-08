import { afterEach, describe, expect, it, vi } from "vitest";
import { NODES, ACCOUNT_CODE, fakePreferences, fakeServer, fakeVpn, type CallLog } from "../test/fakes";
import { createAndroidBridgeWithController } from "./android-bridge";

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});

const WITH_ECHO = NODES.map((node) => (node.id === "off" ? node : { ...node, pingPort: 51821, latencyMs: null }));

async function setup(measure?: ReturnType<typeof vi.fn>) {
  const log: CallLog = [];
  const vpn = Object.assign(fakeVpn(log), measure ? { measureLatency: measure } : {});
  const server = fakeServer(log);
  server.override.set("GET /api/v1/nodes", () => ({ status: 200, body: WITH_ECHO }));
  const { bridge, controller } = createAndroidBridgeWithController({
    vpn,
    preferences: fakePreferences(),
    fetch: (input, init) => server.fetch(input, init),
    visibility: null,
    randomSuffix: () => "ABCD",
  });
  disposers.push(() => controller.dispose());
  await controller.ready;
  expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
  return { bridge, controller, vpn };
}

describe("measureLatency (Android)", () => {
  it("pings only nodes from GET /nodes that have an echo, by id, and cleans the samples", async () => {
    const measure = vi.fn(async ({ targets }: { targets: { id: string; host: string; port: number }[] }) => ({
      results: [
        ...targets.map((target) => ({ id: target.id, samples: [12.5, null, 14] })),
        { id: "stranger", samples: [1, 1, 1] },
        { id: "fra", samples: "x" },
      ],
    }));
    const { bridge } = await setup(measure);
    const nodes = await bridge.nodes();
    expect(nodes.ok && nodes.value.find((node) => node.id === "fra")?.pingPort).toBe(51821);
    expect(nodes.ok && nodes.value.every((node) => node.latencyMs === undefined)).toBe(true);

    const results = await bridge.measureLatency!(["fra", "ams", "off", "unknown"]);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measure.mock.calls[0]?.[0]).toEqual({
      targets: [
        { id: "fra", host: "198.51.100.7", port: 51821 },
        { id: "ams", host: "ams.vpn.example", port: 51821 },
      ],
    });
    expect(results).toEqual([
      { id: "fra", samples: [12.5, null, 14] },
      { id: "ams", samples: [12.5, null, 14] },
    ]);
  });

  it("does nothing while a tunnel is up, for invalid input, or without native support", async () => {
    const measure = vi.fn(async () => ({ results: [] }));
    const { bridge } = await setup(measure);
    await bridge.nodes();
    expect(await bridge.measureLatency!("fra" as unknown as string[])).toEqual([]);
    expect(await bridge.measureLatency!(["bad id!"])).toEqual([]);
    expect((await bridge.connect("fra")).ok).toBe(true);
    expect(await bridge.measureLatency!(["fra"])).toEqual([]);
    expect(measure).not.toHaveBeenCalled();

    const old = await setup();
    await old.bridge.nodes();
    expect(await old.bridge.measureLatency!(["fra"])).toEqual([]);
  });

  it("a native failure means no ratings, not an error", async () => {
    const { bridge } = await setup(vi.fn(async () => Promise.reject(new Error("boom"))));
    await bridge.nodes();
    expect(await bridge.measureLatency!(["fra"])).toEqual([]);
  });
});
