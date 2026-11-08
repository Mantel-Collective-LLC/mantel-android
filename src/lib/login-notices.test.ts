import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, type FetchLike } from "./api-client";

const client = (fetch: FetchLike) =>
  new ApiClient({ baseUrl: () => "https://api.example", token: () => "tok_abcdefghijklmnopqrstuvwxyz", fetch, userAgent: () => "MantelAndroid/1.0 (Android)" });

describe("login notices", () => {
  it("lists, confirms and signs out the other sessions with the bearer token", async () => {
    const body = { logins: [{ client: "windows", method: "code" }] };
    const fetch = vi.fn<FetchLike>(async (url) =>
      String(url).endsWith("/logins") ? new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) : new Response(null, { status: 204 }),
    );
    const api = client(fetch);
    expect(await api.logins()).toEqual({ logins: [{ client: "windows", method: "code" }] });
    await api.loginsSeen();
    await api.logoutOthers();
    expect(fetch.mock.calls.map(([url, init]) => `${init.method} ${url} ${(init.headers as Record<string, string>).Authorization}`)).toEqual([
      "GET https://api.example/api/v1/account/logins Bearer tok_abcdefghijklmnopqrstuvwxyz",
      "POST https://api.example/api/v1/account/logins/seen Bearer tok_abcdefghijklmnopqrstuvwxyz",
      "POST https://api.example/api/v1/auth/logout-others Bearer tok_abcdefghijklmnopqrstuvwxyz",
    ]);
  });

  it("a 401 surfaces as an ApiError that ends the session", async () => {
    const fetch: FetchLike = async () =>
      new Response(JSON.stringify({ code: "unauthorized", error: "x" }), { status: 401, headers: { "content-type": "application/json" } });
    const error = await client(fetch).logins().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).sessionEnded).toBe(true);
  });
});
