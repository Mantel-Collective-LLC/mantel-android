import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain .mjs without types
import { handleTickets } from "../test/mock-tickets.mjs";
import { SECURE_KEYS } from "../lib/storage";
import { ACCOUNT_CODE, fakePreferences, fakeServer, fakeVpn, type CallLog, type Request } from "../test/fakes";
import { createAndroidBridgeWithController } from "./android-bridge";

const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

async function setup() {
  const log: CallLog = [];
  const vpn = fakeVpn(log);
  const server = fakeServer(log);
  const account = { id: `acc-${Math.random()}` };
  const tickets = (request: Request & { query?: string }) => {
    if (request.headers.authorization !== `Bearer ${server.token}`) return { status: 401, body: { code: "unauthorized", error: "x" } };
    let reply: { status: number; body?: unknown } = { status: 500 };
    const url = new URL(`http://x${request.path}${request.query ?? ""}`);
    handleTickets({
      method: request.method,
      path: url.pathname,
      url,
      body: request.body,
      account,
      send: (status: number, body: unknown) => (reply = { status, body }),
      fail: (status: number, code: string, error: string, params?: unknown) => (reply = { status, body: { code, error, ...(params ? { params } : {}) } }),
    });
    return reply;
  };
  const prefs = fakePreferences();
  const { bridge, controller } = createAndroidBridgeWithController({
    vpn,
    preferences: prefs,
    fetch: (input, init) => {
      const url = new URL(input);
      if (url.pathname.startsWith("/api/v1/tickets")) {
        const key = `${init.method ?? "GET"} ${url.pathname}`;
        server.override.set(key, (request) => tickets({ ...request, query: url.search } as Request & { query: string }));
      }
      return server.fetch(input, init);
    },
    bypassFetch: null,
    visibility: null,
    randomSuffix: () => "ABCD",
  });
  disposers.push(() => controller.dispose());
  await controller.ready;
  return { bridge, controller, server, log, vpn, prefs };
}

describe("support bridge", () => {
  it("opens a ticket, reads the team's answer, replies; key only in the secure storage", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const { bridge, vpn, prefs, server } = await setup();
      expect((await bridge.login(ACCOUNT_CODE)).ok).toBe(true);
      const overview = await bridge.supportOverview!();
      expect(overview).toMatchObject({ ok: true, value: { available: true, tickets: [] } });
      expect(vpn.secure.get(SECURE_KEYS.ticketKey)).toMatch(/^[A-Za-z0-9_-]{100,400}$/);
      expect([...prefs.data.values()].join()).not.toContain(vpn.secure.get(SECURE_KEYS.ticketKey)!);
      const created = await bridge.supportCreate!("payment", "Zahlung hängt seit gestern");
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await vi.advanceTimersByTimeAsync(2_000);
      const thread = await bridge.supportTicket!(created.value.id);
      expect(thread.ok && thread.value.messages.map((message) => message.role)).toEqual(["user", "team"]);
      expect(thread.ok && thread.value.messages[0]!.text).toBe("Zahlung hängt seit gestern");
      const replied = await bridge.supportReply!(created.value.id, "Danke");
      expect(replied.ok && replied.value.messages.length).toBe(3);
      expect(JSON.stringify(server.requests)).not.toContain("Zahlung hängt");
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates input like the desktop IPC", async () => {
    const { bridge } = await setup();
    await bridge.login(ACCOUNT_CODE);
    expect(await bridge.supportTicket!("../etc")).toMatchObject({ ok: false, code: "invalid" });
    expect(await bridge.supportCreate!("nope" as never, "x")).toMatchObject({ ok: false, code: "invalid" });
    expect(await bridge.supportReply!("a".repeat(32), "x".repeat(4001))).toMatchObject({ ok: false, code: "invalid" });
    expect(await bridge.supportCreate!("other", "   ")).toMatchObject({ ok: false, code: "invalid" });
  });

  it("logout unregisters the key at the server and removes it from the secure storage", async () => {
    const { bridge, vpn, log } = await setup();
    await bridge.login(ACCOUNT_CODE);
    await bridge.supportOverview!();
    expect(vpn.secure.has(SECURE_KEYS.ticketKey)).toBe(true);
    log.length = 0;
    await bridge.logout();
    expect(log.some((entry) => /^api DELETE \/api\/v1\/tickets\/keys\/[a-f0-9]{32}$/.test(entry))).toBe(true);
    expect(vpn.secure.has(SECURE_KEYS.ticketKey)).toBe(false);
  });
});
