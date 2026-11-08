import { describe, expect, it, vi } from "vitest";
import { errorMessage } from "@shared/i18n";
import { ApiClient, ApiError, MAX_BODY_BYTES, REDIRECTED, UNREACHABLE, type ApiRequestRecord, type FetchLike } from "./api-client";

function client(fetch: FetchLike, options: { token?: string | null; baseUrl?: string; timeoutMs?: number } = {}) {
  return new ApiClient({
    baseUrl: () => options.baseUrl ?? "https://api.example",
    token: () => (options.token === undefined ? "tok_abcdefghijklmnopqrstuvwxyz" : options.token),
    fetch,
    userAgent: () => "MantelAndroid/1.0 (Android)",
    timeoutMs: options.timeoutMs,
  });
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected failure");
}

describe("ApiClient", () => {
  it("reads a location's optional status and ignores values it does not know", async () => {
    const node = { id: "ch-zrh", city: "Zürich", country: "CH", endpointHost: "198.51.100.7", endpointPort: 51820, online: true };
    const nodes = await client(async () =>
      json(200, [node, { ...node, id: "ch-gva", status: "full" }, { ...node, id: "ch-bsl", status: "brand_new" }]),
    ).nodes();
    expect(nodes.map((entry) => entry.status)).toEqual([undefined, "full", undefined]);
  });

  it("sends the desktop's headers, no redirects and the bearer token only on authenticated routes", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, []));
    await client(fetch, { token: null }).nodes();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.example/api/v1/nodes");
    expect(init).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ Accept: "application/json", "User-Agent": "MantelAndroid/1.0 (Android)" });

    fetch.mockResolvedValueOnce(json(200, []));
    await client(fetch).nodes();
    expect(fetch.mock.calls[1]![1].headers).toMatchObject({ Authorization: "Bearer tok_abcdefghijklmnopqrstuvwxyz" });

    fetch.mockResolvedValueOnce(json(200, { killSwitch: true, lanAccess: false, ipv6: true, dns: { ads: false, trackers: false, malware: false, gambling: false, adult: false, social: false } }));
    await client(fetch).updateSettings({ ipv6: true });
    const [, patch] = fetch.mock.calls[2]!;
    expect(patch.headers).toMatchObject({ Authorization: "Bearer tok_abcdefghijklmnopqrstuvwxyz", "Content-Type": "application/json" });
    expect(patch.body).toBe('{"ipv6":true}');
  });

  it("refuses authenticated calls without a token before sending anything", async () => {
    const fetch = vi.fn<FetchLike>();
    const error = await failure(client(fetch, { token: null }).account());
    expect(error).toMatchObject({ message: "Nicht angemeldet.", code: "unauthorized", status: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps HTTP errors like the desktop client", async () => {
    const cases: Array<[Response, string, string]> = [
      [json(401, { error: "Nicht angemeldet oder Sitzung abgelaufen." }), "Nicht angemeldet oder Sitzung abgelaufen.", "unauthorized"],
      [json(401, null), "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.", "unauthorized"],
      [json(429, null), "Zu viele Versuche. Bitte warte kurz.", "rate_limited"],
      [json(403, null), "Keine Berechtigung.", "invalid"],
      [json(409, { error: "Zu viele Geräte." }), "Zu viele Geräte.", "invalid"],
      [json(502, null), "Serverfehler (502).", "server"],
      [
        new Response("<html>nope</html>", { status: 404, headers: { "content-type": "text/html" } }),
        "Der Server antwortet nicht wie die Mantel-API. Versuche es später erneut (HTTP 404, text/html).",
        "server",
      ],
      [
        new Response("<html>challenge</html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } }),
        "Cloudflare blockiert die Anfrage (Bot-Schutz/Challenge) (HTTP 403, text/html).",
        "server",
      ],
      [json(200, [{ id: "x" }]), "Die Antwort des Servers hat ein unerwartetes Format.", "server"],
      [new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }), REDIRECTED, "network"],
    ];
    for (const [response, message, code] of cases) {
      const error = await failure(client(async () => response).nodes());
      expect([error.message, error.code]).toEqual([message, code]);
    }
  });

  it("localizes coded errors by code, never with the server's English text", async () => {
    const cases: Array<[Response, string, string, string, string]> = [
      [json(401, { code: "unknown_code", error: "This account number does not exist." }), "Diese Kontonummer kennen wir nicht.", "We don’t know this account number.", "unauthorized", "unknown_code"],
      [json(429, { code: "rate_limited", error: "Too many requests. Try again in 60 seconds.", params: { retryAfterSeconds: 60 } }), "Zu viele Versuche. Warte eine Minute.", "Too many attempts. Wait a minute.", "rate_limited", "rate_limited"],
      [json(429, { code: "rate_limited", error: "Too many requests. Try again in 600 seconds.", params: { retryAfterSeconds: 600 } }), "Zu viele Versuche. Bitte warte 10 Minuten.", "Too many attempts. Please wait 10 minutes.", "rate_limited", "rate_limited"],
      [json(409, { code: "device_limit_reached", error: "x", params: { max: 5 } }), "Maximal 5 Geräte pro Konto. Entferne zuerst eins.", "At most 5 devices per account. Remove one first.", "invalid", "device_limit_reached"],
      [json(403, { code: "account_expired", error: "x" }), "Dein Konto hat keine Laufzeit. Kaufe Zeit oder löse zuerst einen Gutschein ein, dann kannst du Geräte hinzufügen.", "Your account has no paid time. Buy time or redeem a voucher first, then you can add devices.", "invalid", "account_expired"],
      [json(503, { code: "location_full", error: "x", params: { city: "Wien" } }), "Wien hat gerade keine freien Adressen mehr. Wähle einen anderen Standort.", "Wien has no free addresses left right now. Choose another location.", "server", "location_full"],
      [json(400, { code: "brand_new", error: "Some new English text." }), "Der Server hat die Anfrage abgelehnt (HTTP 400).", "The server rejected the request (HTTP 400).", "invalid", "brand_new"],
      [json(502, { code: "brand_new", error: "Some new English text." }), "Serverfehler (502).", "Server error (502).", "server", "brand_new"],
    ];
    for (const [response, german, english, code, apiCode] of cases) {
      const error = await failure(client(async () => response).nodes());
      expect([error.message, errorMessage(error, "en"), error.code, error.apiCode]).toEqual([german, english, code, apiCode]);
      expect(errorMessage(error, "en")).not.toContain("Some new");
    }
  });

  it("debug flavor: unknown codes show the server's code and English text; the request log records the code", async () => {
    const records: ApiRequestRecord[] = [];
    const api = new ApiClient({
      baseUrl: () => "https://api.example",
      token: () => "tok_abcdefghijklmnopqrstuvwxyz",
      fetch: async () => json(400, { code: "brand_new", error: "Some new English text." }),
      userAgent: () => "MantelAndroid/1.0 (Android)",
      debug: true,
      onRequest: (record) => records.push(record),
    });
    const error = await failure(api.nodes());
    expect(errorMessage(error, "de")).toBe("Der Server hat die Anfrage abgelehnt (HTTP 400). [brand_new: Some new English text.]");
    expect(error.serverMessage).toBe("Some new English text.");
    expect(records[0]).toMatchObject({ route: "/api/v1/nodes", status: 400, error: "invalid", apiCode: "brand_new" });
  });

  it("ends the session by code; old servers without codes by 401", async () => {
    const coded = await failure(client(async () => json(401, { code: "unauthorized", error: "x" })).account());
    expect(coded.sessionEnded).toBe(true);
    const gone = await failure(client(async () => json(401, { code: "account_not_found", error: "x" })).account());
    expect(gone.sessionEnded).toBe(true);
    const wrongCode = await failure(client(async () => json(401, { code: "unknown_code", error: "x" })).login("9999999999999999"));
    expect(wrongCode.sessionEnded).toBe(false);
    const old = await failure(client(async () => json(401, { error: "Nicht angemeldet oder Sitzung abgelaufen." })).account());
    expect(old.sessionEnded).toBe(true);
    expect(old.apiCode).toBeUndefined();
  });

  it("treats a redirect followed by the native layer as an error", async () => {
    const response = json(200, []);
    Object.defineProperty(response, "url", { value: "https://evil.example/api/v1/nodes" });
    expect((await failure(client(async () => response).nodes())).message).toBe(REDIRECTED);
    const proxied = json(200, []);
    Object.defineProperty(proxied, "url", { value: "https://localhost/_capacitor_http_interceptor_?u=https%3A%2F%2Fapi.example" });
    await expect(client(async () => proxied).nodes()).resolves.toEqual([]);
  });

  it("maps network failures, timeouts and oversized bodies", async () => {
    expect(await failure(client(async () => Promise.reject(new TypeError("fetch failed"))).nodes())).toMatchObject({
      message: UNREACHABLE,
      code: "network",
    });

    const hanging = await failure(client(() => new Promise<Response>(() => undefined), { timeoutMs: 20 }).nodes());
    expect(hanging).toMatchObject({ message: UNREACHABLE, code: "network" });

    const big = new Response("x".repeat(MAX_BODY_BYTES + 1), { status: 200 });
    expect(await failure(client(async () => big).nodes())).toMatchObject({ message: "Antwort des Servers ist zu groß.", code: "server" });
    const declared = new Response("[]", { status: 200, headers: { "content-length": String(MAX_BODY_BYTES + 1) } });
    expect((await failure(client(async () => declared).nodes())).message).toBe("Antwort des Servers ist zu groß.");
  });

  it("rejects an invalid base URL", async () => {
    const fetch = vi.fn<FetchLike>();
    expect(await failure(client(fetch, { baseUrl: "file://" }).nodes())).toMatchObject({ message: "Die Server-Adresse ist ungültig.", code: "invalid" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts 204 and 404 when deleting a device", async () => {
    await expect(client(async () => new Response(null, { status: 204 })).deleteDevice("dev1")).resolves.toBeUndefined();
    await expect(client(async () => json(404, { error: "Gerät nicht gefunden." })).deleteDevice("dev1")).resolves.toBeUndefined();
    const fetch = vi.fn<FetchLike>(async () => new Response(null, { status: 204 }));
    await client(fetch).deleteDevice("a/b");
    expect(fetch.mock.calls[0]![0]).toBe("https://api.example/api/v1/devices/a%2Fb");
  });
});
