import { afterEach, describe, expect, it } from "vitest";
import type { ApiRequestRecord } from "../lib/api-client";
import { ACCOUNT_CODE, fakePreferences, fakeServer, fakeVpn, type CallLog } from "../test/fakes";
import { createAndroidBridgeWithController } from "./android-bridge";

const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

async function setup() {
  const log: CallLog = [];
  const vpn = fakeVpn(log);
  const server = fakeServer(log);
  const preferences = fakePreferences();
  const records: ApiRequestRecord[] = [];
  const { bridge, controller } = createAndroidBridgeWithController({
    vpn,
    preferences,
    fetch: server.fetch,
    bypassFetch: null,
    visibility: null,
    onApiRequest: (record) => records.push(record),
  });
  disposers.push(() => controller.dispose());
  await controller.ready;
  expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
  log.length = 0;
  records.length = 0;
  return { bridge, server, vpn, preferences, records, log };
}

const create = { name: "  Browser  ", nodeId: "fra", protocol: "socks5", exit: "tor" } as const;

describe("server proxies bridge", () => {
  it("lists the account's proxies; a server without the API → null", async () => {
    const { bridge, server } = await setup();
    expect(await bridge.proxies!()).toEqual({ ok: true, value: [] });
    server.proxies = null;
    expect(await bridge.proxies!()).toEqual({ ok: true, value: null });
  });

  it("creates a proxy: cleaned body, password only in that answer, never stored", async () => {
    const { bridge, server, vpn, preferences, records } = await setup();
    const created = await bridge.createProxy!({ ...create });
    expect(created).toEqual({
      ok: true,
      value: {
        proxy: { id: "px1", name: "Browser", nodeId: "fra", host: "198.51.100.7", port: 20001, protocol: "socks5", exit: "tor", username: "u1", enabled: true, status: "pending" },
        password: "secret-1",
      },
    });
    expect(server.requests.at(-1)?.body).toEqual({ name: "Browser", nodeId: "fra", protocol: "socks5", exit: "tor" });
    const listed = await bridge.proxies!();
    expect(listed.ok && listed.value?.[0]).not.toHaveProperty("password");
    const stored = [...preferences.data.values(), ...vpn.secure.values()].join("\n");
    expect(stored).not.toContain("secret-1");
    expect(JSON.stringify(records)).not.toContain("secret-1");
    expect(records.map((record) => `${record.method} ${record.route}`)).toEqual(["POST /api/v1/proxies", "GET /api/v1/proxies"]);
  });

  it("updates: rename/off without a password, rotatePassword returns the new one, newCircuit is passed on", async () => {
    const { bridge, server } = await setup();
    await bridge.createProxy!({ ...create });
    const renamed = await bridge.updateProxy!("px1", { name: "Torrent", enabled: false });
    expect(renamed).toMatchObject({ ok: true, value: { proxy: { name: "Torrent", enabled: false } } });
    expect(renamed.ok && renamed.value).not.toHaveProperty("password");
    const rotated = await bridge.updateProxy!("px1", { rotatePassword: true });
    expect(rotated.ok && rotated.value.password).toBe("renewed-px1");
    expect((await bridge.updateProxy!("px1", { newCircuit: true, exit: "direct" })).ok).toBe(true);
    const patches = server.requests.filter((request) => request.method === "PATCH");
    expect(patches.map((request) => [request.path, request.body])).toEqual([
      ["/api/v1/proxies/px1", { name: "Torrent", enabled: false }],
      ["/api/v1/proxies/px1", { rotatePassword: true }],
      ["/api/v1/proxies/px1", { newCircuit: true, exit: "direct" }],
    ]);
  });

  it("deletes a proxy", async () => {
    const { bridge, server, log } = await setup();
    await bridge.createProxy!({ ...create });
    expect(await bridge.deleteProxy!("px1")).toEqual({ ok: true, value: null });
    expect(server.proxies).toEqual([]);
    expect(log.at(-1)).toBe("api DELETE /api/v1/proxies/px1");
  });

  it("refuses invalid input without a request", async () => {
    const { bridge, log } = await setup();
    const invalid = { ok: false, error: "Ungültige Eingabe.", code: "invalid" };
    expect(await bridge.createProxy!({ ...create, name: "   " })).toEqual(invalid);
    expect(await bridge.createProxy!({ ...create, protocol: "ftp" } as never)).toEqual(invalid);
    expect(await bridge.createProxy!({ ...create, exit: "vpn" } as never)).toEqual(invalid);
    expect(await bridge.createProxy!({ ...create, nodeId: "../x" })).toEqual(invalid);
    expect(await bridge.createProxy!(null as never)).toEqual(invalid);
    expect(await bridge.updateProxy!("px1", {})).toEqual(invalid);
    expect(await bridge.updateProxy!("px1", { rotatePassword: false } as never)).toEqual(invalid);
    expect(await bridge.updateProxy!("px1", { port: 1080 } as never)).toEqual(invalid);
    expect(await bridge.updateProxy!("../x", { enabled: true })).toEqual(invalid);
    expect(await bridge.deleteProxy!(42 as never)).toEqual(invalid);
    expect(log).toEqual([]);
  });

  it("passes API errors through translated, with their code", async () => {
    const { bridge, server } = await setup();
    server.override.set("POST /api/v1/proxies", () => ({ status: 429, body: { code: "rate_limited", error: "Too many requests." } }));
    expect(await bridge.createProxy!({ ...create })).toEqual({ ok: false, error: "Zu viele Versuche. Bitte warte kurz.", code: "rate_limited" });
    const gone = await bridge.deleteProxy!("px404");
    expect(gone).toMatchObject({ ok: false, code: "invalid" });
    expect((await bridge.updateProxy!("px404", { enabled: true })).ok).toBe(false);
  });

  it("drops list entries this app cannot show; an unknown status counts as unavailable", async () => {
    const { bridge, server } = await setup();
    const base = { id: "px1", name: "A", nodeId: "fra", host: "198.51.100.7", port: 20001, protocol: "socks5", exit: "tor", username: "u1", enabled: true, status: "active" } as const;
    server.proxies = [base, { ...base, id: "px2", status: "rebuilding" as never }, { ...base, id: "px3", protocol: "quic" as never }];
    const listed = await bridge.proxies!();
    expect(listed.ok && listed.value?.map((proxy) => [proxy.id, proxy.status])).toEqual([
      ["px1", "active"],
      ["px2", "unavailable"],
    ]);
  });
});
