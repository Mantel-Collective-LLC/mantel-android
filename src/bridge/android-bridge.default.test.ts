import { afterEach, describe, expect, it, vi } from "vitest";
import { version as packageVersion } from "../../package.json";

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    preferences: {
      get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => void store.set(key, value)),
      remove: vi.fn(async ({ key }: { key: string }) => void store.delete(key)),
    },
    vpn: {
      secureGet: vi.fn(async () => ({ value: null })),
      secureSet: vi.fn(async () => undefined),
      secureRemove: vi.fn(async () => undefined),
      appInfo: vi.fn(async () => ({ versionName: "2.0.0", packageName: "net.mantel.app", sdkInt: 36 })),
      addListener: vi.fn(async () => ({ remove: async () => undefined })),
      status: vi.fn(async () => ({
        state: "down",
        nodeId: null,
        startedAt: null,
        lastHandshakeAt: null,
        rxBytes: 0,
        txBytes: 0,
        endpoint: null,
        error: null,
      })),
    },
  };
});

vi.mock("@capacitor/preferences", () => ({ Preferences: mocks.preferences }));
vi.mock("../native/mantel-vpn", () => ({ MantelVpn: mocks.vpn }));

import { createAndroidBridge } from "./android-bridge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAndroidBridge() default wiring", () => {
  it("uses MantelVpn, Capacitor Preferences and the global fetch", async () => {
    const fetch = vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const bridge = createAndroidBridge();
    const env = await bridge.environment();
    expect(env).toMatchObject({ platform: "android", appVersion: "2.0.0", encryptionAvailable: true });
    expect(mocks.vpn.secureGet).toHaveBeenCalled();
    expect(mocks.vpn.status).toHaveBeenCalled();
    expect(mocks.vpn.addListener).toHaveBeenCalledWith("status", expect.any(Function));

    expect(await bridge.nodes()).toEqual({ ok: true, value: [] });
    expect(fetch).toHaveBeenCalledWith("http://10.0.2.2:3000/api/v1/nodes", expect.objectContaining({ method: "GET" }));
  });

  it("still answers when the native plugin is missing (plain browser)", async () => {
    mocks.vpn.appInfo.mockRejectedValueOnce(new Error("not implemented on web"));
    mocks.vpn.secureGet.mockRejectedValueOnce(new Error("not implemented on web"));
    mocks.vpn.status.mockRejectedValueOnce(new Error("not implemented on web"));
    const bridge = createAndroidBridge();
    const env = await bridge.environment();
    expect(env.appVersion).toBe(packageVersion);
    expect(env.encryptionAvailable).toBe(false);
    expect((await bridge.tunnelStatus()).phase).toBe("disconnected");
    expect(() => bridge.onTunnelStatus(() => {})()).not.toThrow();
    expect(() => bridge.onSessionEnded(() => {})()).not.toThrow();
  });
});
